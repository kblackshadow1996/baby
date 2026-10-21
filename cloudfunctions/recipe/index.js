// cloudfunctions/recipe/index.js
// 食谱库云函数：统一入口按 event.action 分发 list / get / create / update / delete。
// 权限校验在云函数内完成：
//   - 官方食谱（isOfficial==true）任何登录用户可读、不可写/删。
//   - 自建食谱（isOfficial!=true）：
//       * 读/可见：创建者本人（creatorOpenid==OPENID）∪ 归属于我家庭宝贝的自建食谱
//         （babyId ∈ 我作为 owner 或 family_members 成员的 babyId 列表）。
//       * 更新/删除：仅创建者本人（creatorOpenid==OPENID）。
// 契约（docs/data-model.md recipes）：
//   title, monthAgeMin, monthAgeMax, type(staple/meat/veggie/soup/snack),
//   ingredients[{name,amount,isAllergen}], steps[], nutrition{}, source{name,chapter,page},
//   imageUrl, tags[], allergens[], isOfficial, creatorOpenid, babyId, createdAt
// 注意：云函数端 add 不自动带 _openid，归属用显式 creatorOpenid=OPENID。
const cloud = require("wx-server-sdk");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const recipesCol = db.collection("recipes");
const babiesCol = db.collection("babies");
const membersCol = db.collection("family_members");
const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 50;
const RECIPE_TYPES = ["staple", "meat", "veggie", "soup", "snack"];

// ---- 过敏原同义/包含词表（与 utils/allergen.js 保持一致；云函数不共享代码，此处内联）----
const ALLERGEN_SYNONYMS = {
  鸡蛋: ["蛋", "蛋黄", "蛋白", "鸡蛋羹", "蒸蛋", "蛋花"],
  牛奶: ["奶", "配方奶", "酸奶", "奶酪", "黄油", "乳"],
  小麦: ["面", "面条", "馒头", "面包", "饼", "麸"],
  大豆: ["豆", "豆腐", "豆浆", "豆干"],
  花生: ["花生", "花生酱"],
  坚果: ["核桃", "杏仁", "腰果", "开心果", "榛子"],
  鱼: ["鱼", "鳕鱼", "三文鱼", "鲈鱼", "龙利鱼"],
  "虾蟹贝类（海鲜）": ["虾", "蟹", "贝", "蛤", "蛎", "海鲜"],
  芝麻: ["芝麻", "芝麻酱"]
};
/** 成功响应 */
function ok(data) {
  return { success: true, data };
}
/** 失败响应 */
function fail(error) {
  return { success: false, error: String(error) };
}
/**
 * 安全转字符串并 trim；非字符串/空值返回空字符串。
 * @param {*} v
 * @returns {string}
 */
function toStr(v) {
  if (v === undefined || v === null) {
    return "";
  }
  return String(v).trim();
}
/**
 * 把食材名/过敏原名归一化到规范过敏原名（与 utils/allergen.normalizeAllergenName 同逻辑）。
 * @param {string} name
 * @returns {string}
 */
function normalizeAllergenName(name) {
  const n = toStr(name);
  if (!n) {
    return n;
  }
  if (Object.prototype.hasOwnProperty.call(ALLERGEN_SYNONYMS, n)) {
    return n;
  }
  const keys = Object.keys(ALLERGEN_SYNONYMS);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const syns = ALLERGEN_SYNONYMS[key];
    for (let j = 0; j < syns.length; j++) {
      const s = syns[j];
      if (!s) {
        continue;
      }
      if (n === s || n.includes(s) || s.includes(n)) {
        return key;
      }
    }
  }
  return n;
}
/**
 * 由 ingredients 中 isAllergen=true 的食材名推断规范过敏原名数组（去重保序）。
 * @param {Array} ingredients
 * @returns {string[]}
 */
function inferAllergens(ingredients) {
  const out = [];
  if (!Array.isArray(ingredients)) {
    return out;
  }
  ingredients.forEach((ing) => {
    if (!ing || ing.isAllergen !== true) {
      return;
    }
    const name = toStr(ing.name);
    if (!name) {
      return;
    }
    const norm = normalizeAllergenName(name);
    if (norm && out.indexOf(norm) === -1) {
      out.push(norm);
    }
  });
  return out;
}
/**
 * 将入参转为非负整数，非法时返回 fallback
 */
function toPositiveInt(value, fallback) {
  const n = parseInt(value, 10);
  if (isNaN(n) || n < 0) {
    return fallback;
  }
  return n;
}
/**
 * 查询某用户对某宝贝的访问权限（思路同 baby/meal 的 resolveAccess）。
 * owner 或在 family_members 中即有权访问。
 * @param {string} babyId
 * @param {string} openid
 * @returns {Promise<{baby:Object|null, isOwner:boolean, member:Object|null}>}
 */
async function resolveAccess(babyId, openid) {
  const babyRes = await babiesCol.doc(babyId).get().catch(() => ({ data: null }));
  const baby = babyRes && babyRes.data ? babyRes.data : null;
  if (!baby) {
    return { baby: null, isOwner: false, member: null };
  }
  const isOwner = baby.ownerId === openid;
  let member = null;
  if (!isOwner) {
    const memRes = await membersCol
      .where({ babyId: babyId, userOpenid: openid })
      .limit(1)
      .get();
    member = memRes.data && memRes.data.length > 0 ? memRes.data[0] : null;
  }
  return { baby, isOwner, member };
}
/**
 * 查询当前用户可访问的全部宝贝 _id 列表（owner ∪ family_members 成员）。
 * @param {string} openid
 * @returns {Promise<string[]>}
 */
async function listAccessibleBabyIds(openid) {
  const set = {};
  const ownRes = await babiesCol.where({ ownerId: openid }).field({ _id: true }).get();
  (ownRes.data || []).forEach((b) => {
    if (b && b._id) {
      set[b._id] = true;
    }
  });
  const memRes = await membersCol.where({ userOpenid: openid }).field({ babyId: true }).get();
  (memRes.data || []).forEach((m) => {
    if (m && m.babyId) {
      set[m.babyId] = true;
    }
  });
  return Object.keys(set);
}
/**
 * 构建月龄区间重叠查询条件。
 * 目标月龄段 [targetMin, targetMax]，食谱适用区间 [monthAgeMin, monthAgeMax]。
 * 有交集条件：monthAgeMin <= targetMax 且 monthAgeMax >= targetMin。
 * @param {Object} event 入参
 * @returns {Object|null} 可并入 where 的条件片段；无月龄筛选时返回 null
 */
function buildMonthOverlap(event) {
  let targetMin = null;
  let targetMax = null;
  // 优先使用 monthAgeMin/monthAgeMax 表示目标段
  if (event.monthAgeMin !== undefined && event.monthAgeMin !== null && event.monthAgeMin !== "") {
    targetMin = toPositiveInt(event.monthAgeMin, null);
  }
  if (event.monthAgeMax !== undefined && event.monthAgeMax !== null && event.monthAgeMax !== "") {
    targetMax = toPositiveInt(event.monthAgeMax, null);
  }
  // 兼容只传单个月龄 month 的情况：目标段退化为 [month, month]
  if (
    targetMin === null &&
    targetMax === null &&
    event.month !== undefined &&
    event.month !== null &&
    event.month !== ""
  ) {
    const m = toPositiveInt(event.month, null);
    if (m !== null) {
      targetMin = m;
      targetMax = m;
    }
  }
  if (targetMin === null && targetMax === null) {
    return null;
  }
  // 若只给了一端，用另一端兜底
  if (targetMin === null) {
    targetMin = 0;
  }
  if (targetMax === null) {
    targetMax = targetMin;
  }
  // 区间重叠：monthAgeMin <= targetMax 且 monthAgeMax >= targetMin
  return {
    monthAgeMin: _.lte(targetMax),
    monthAgeMax: _.gte(targetMin)
  };
}
/**
 * 转义正则特殊字符，避免用户输入破坏正则
 */
function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
/**
 * 判断一条食谱是否满足 event 的筛选（月龄重叠 / type / tag / keyword）。
 * 用于 mine tab 合并后在内存侧应用同样的筛选条件。
 * @param {Object} recipe
 * @param {Object} event
 * @returns {boolean}
 */
function matchFilters(recipe, event) {
  // 月龄重叠
  let targetMin = null;
  let targetMax = null;
  if (event.monthAgeMin !== undefined && event.monthAgeMin !== null && event.monthAgeMin !== "") {
    targetMin = toPositiveInt(event.monthAgeMin, null);
  }
  if (event.monthAgeMax !== undefined && event.monthAgeMax !== null && event.monthAgeMax !== "") {
    targetMax = toPositiveInt(event.monthAgeMax, null);
  }
  if (targetMin === null && targetMax === null && event.month !== undefined && event.month !== null && event.month !== "") {
    const m = toPositiveInt(event.month, null);
    if (m !== null) {
      targetMin = m;
      targetMax = m;
    }
  }
  if (targetMin !== null || targetMax !== null) {
    if (targetMin === null) {
      targetMin = 0;
    }
    if (targetMax === null) {
      targetMax = targetMin;
    }
    const rMin = typeof recipe.monthAgeMin === "number" ? recipe.monthAgeMin : toPositiveInt(recipe.monthAgeMin, 0);
    const rMax = typeof recipe.monthAgeMax === "number" ? recipe.monthAgeMax : toPositiveInt(recipe.monthAgeMax, 0);
    if (!(rMin <= targetMax && rMax >= targetMin)) {
      return false;
    }
  }
  // type
  if (typeof event.type === "string" && event.type && recipe.type !== event.type) {
    return false;
  }
  // tag
  if (typeof event.tag === "string" && event.tag && event.tag !== "全部") {
    const tags = Array.isArray(recipe.tags) ? recipe.tags : [];
    if (tags.indexOf(event.tag) === -1) {
      return false;
    }
  }
  // keyword 标题包含（忽略大小写）
  if (typeof event.keyword === "string" && event.keyword.trim()) {
    const kw = event.keyword.trim().toLowerCase();
    const title = toStr(recipe.title).toLowerCase();
    if (title.indexOf(kw) === -1) {
      return false;
    }
  }
  return true;
}
/**
 * mine tab：返回我创建的自建食谱(creatorOpenid==OPENID)
 * ∪ 归属于我家庭宝贝的自建食谱(babyId ∈ 我可访问的宝贝, 且 isOfficial!=true)。
 * 合并去重后在内存应用筛选与分页（自建食谱数量不大）。
 * @param {Object} event
 * @param {string} OPENID
 */
async function listMineRecipes(event, OPENID) {
  const page = Math.max(1, toPositiveInt(event.page, 1));
  let pageSize = toPositiveInt(event.pageSize, DEFAULT_PAGE_SIZE) || DEFAULT_PAGE_SIZE;
  pageSize = Math.min(pageSize, MAX_PAGE_SIZE);
  const map = {};
  // 1) 我创建的自建食谱
  const mineRes = await recipesCol
    .where({ creatorOpenid: OPENID, isOfficial: _.neq(true) })
    .limit(1000)
    .get();
  (mineRes.data || []).forEach((r) => {
    if (r && r._id) {
      map[r._id] = r;
    }
  });
  // 2) 归属于我家庭宝贝的自建食谱
  const babyIds = await listAccessibleBabyIds(OPENID);
  if (babyIds.length > 0) {
    const sharedRes = await recipesCol
      .where({ babyId: _.in(babyIds), isOfficial: _.neq(true) })
      .limit(1000)
      .get();
    (sharedRes.data || []).forEach((r) => {
      if (r && r._id) {
        map[r._id] = r;
      }
    });
  }
  // 合并去重 → 内存筛选
  let all = Object.keys(map).map((k) => map[k]);
  all = all.filter((r) => matchFilters(r, event));
  // 排序：monthAgeMin 升序，createdAt 降序（与官方 tab 一致）
  all.sort((a, b) => {
    const am = typeof a.monthAgeMin === "number" ? a.monthAgeMin : 0;
    const bm = typeof b.monthAgeMin === "number" ? b.monthAgeMin : 0;
    if (am !== bm) {
      return am - bm;
    }
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return tb - ta;
  });
  const total = all.length;
  const start = (page - 1) * pageSize;
  const list = all.slice(start, start + pageSize);
  const hasMore = page * pageSize < total;
  return ok({ list, page, pageSize, hasMore, total });
}
/**
 * action=list 按条件分页查询食谱
 * 入参：{ monthAgeMin, monthAgeMax, month, type, tag, tab, keyword, page, pageSize, babyId }
 */
async function listRecipes(event, OPENID) {
  const tab = event.tab === "mine" ? "mine" : "official";
  if (tab === "mine") {
    // 我的 tab：家庭共享合并（创建者本人 ∪ 家庭宝贝归属）
    return await listMineRecipes(event, OPENID);
  }
  const page = Math.max(1, toPositiveInt(event.page, 1));
  let pageSize = toPositiveInt(event.pageSize, DEFAULT_PAGE_SIZE) || DEFAULT_PAGE_SIZE;
  pageSize = Math.min(pageSize, MAX_PAGE_SIZE);
  // 官方 tab：isOfficial==true
  const where = { isOfficial: true };
  // 月龄区间重叠
  const monthCond = buildMonthOverlap(event);
  if (monthCond) {
    where.monthAgeMin = monthCond.monthAgeMin;
    where.monthAgeMax = monthCond.monthAgeMax;
  }
  // type 精确匹配
  if (typeof event.type === "string" && event.type) {
    where.type = event.type;
  }
  // tag 数组 contains
  if (typeof event.tag === "string" && event.tag && event.tag !== "全部") {
    where.tags = _.all([event.tag]);
  }
  // keyword 标题模糊（正则，忽略大小写）
  if (typeof event.keyword === "string" && event.keyword.trim()) {
    const kw = event.keyword.trim();
    where.title = db.RegExp({ regexp: escapeRegExp(kw), options: "i" });
  }
  const query = recipesCol.where(where);
  // 统计总数（countQuery 与 query 共用同一 where）
  const countRes = await recipesCol.where(where).count();
  const total = countRes.total || 0;
  const listRes = await query
    .orderBy("monthAgeMin", "asc")
    .orderBy("createdAt", "desc")
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .get();
  const list = listRes.data || [];
  const hasMore = page * pageSize < total;
  return ok({ list, page, pageSize, hasMore, total });
}
/**
 * action=get 读取单条食谱
 * 入参：{ recipeId }
 * 官方食谱任何人可取；自建食谱：创建者本人 ∪ 归属家庭宝贝的成员可取。
 */
async function getRecipe(event, OPENID) {
  const recipeId = event.recipeId;
  if (!recipeId) {
    return fail("recipeId 必填");
  }
  const res = await recipesCol
    .doc(recipeId)
    .get()
    .catch(() => ({ data: null }));
  const recipe = res && res.data ? res.data : null;
  if (!recipe) {
    return fail("食谱不存在");
  }
  if (recipe.isOfficial === true) {
    return ok(recipe);
  }
  if (recipe.creatorOpenid && recipe.creatorOpenid === OPENID) {
    return ok(recipe);
  }
  // 归属家庭宝贝 → 成员可读
  if (recipe.babyId) {
    const { baby, isOwner, member } = await resolveAccess(recipe.babyId, OPENID);
    if (baby && (isOwner || member)) {
      return ok(recipe);
    }
  }
  return fail("无权访问该食谱");
}
/**
 * 规范化 ingredients 入参：数组，每项 { name, amount, isAllergen }。
 * @param {*} input
 * @returns {{ok:boolean, value?:Array, error?:string}}
 */
function normalizeIngredients(input) {
  if (!Array.isArray(input) || input.length === 0) {
    return { ok: false, error: "食材不能为空" };
  }
  const out = [];
  for (let i = 0; i < input.length; i++) {
    const item = input[i] || {};
    const name = toStr(item.name);
    if (!name) {
      return { ok: false, error: "每项食材必须填写名称" };
    }
    out.push({
      name: name,
      amount: toStr(item.amount),
      isAllergen: item.isAllergen === true
    });
  }
  return { ok: true, value: out };
}
/**
 * 规范化 steps 入参：字符串数组（过滤空白），至少 1 步。
 * @param {*} input
 * @returns {{ok:boolean, value?:string[], error?:string}}
 */
function normalizeSteps(input) {
  if (!Array.isArray(input)) {
    return { ok: false, error: "制作步骤不能为空" };
  }
  const out = [];
  input.forEach((s) => {
    const t = toStr(s);
    if (t) {
      out.push(t);
    }
  });
  if (out.length === 0) {
    return { ok: false, error: "制作步骤不能为空" };
  }
  return { ok: true, value: out };
}
/**
 * 规范化 nutrition / source / tags（可空）。
 */
function normalizeNutrition(input) {
  if (!input || typeof input !== "object") {
    return {};
  }
  const out = {};
  ["calories", "protein", "iron", "calcium", "vitamin"].forEach((k) => {
    if (input[k] !== undefined && input[k] !== null && String(input[k]).trim() !== "") {
      out[k] = input[k];
    }
  });
  return out;
}
function normalizeSource(input) {
  if (!input || typeof input !== "object") {
    return {};
  }
  const out = {};
  if (toStr(input.name)) {
    out.name = toStr(input.name);
  }
  if (toStr(input.chapter)) {
    out.chapter = toStr(input.chapter);
  }
  if (input.page !== undefined && input.page !== null && String(input.page).trim() !== "") {
    out.page = input.page;
  }
  return out;
}
function normalizeTags(input) {
  if (!Array.isArray(input)) {
    return [];
  }
  const out = [];
  input.forEach((t) => {
    const s = toStr(t);
    if (s && out.indexOf(s) === -1) {
      out.push(s);
    }
  });
  return out;
}
/**
 * action=create 创建自建食谱
 * 入参：{ title, monthAgeMin, monthAgeMax, type, ingredients[], steps[],
 *        nutrition, source, imageUrl, tags[], allergens[], babyId }
 */
async function createRecipe(event, OPENID) {
  const title = toStr(event.title);
  if (!title) {
    return fail("食谱名称不能为空");
  }
  const monthAgeMin = toPositiveInt(event.monthAgeMin, null);
  const monthAgeMax = toPositiveInt(event.monthAgeMax, null);
  if (monthAgeMin === null || monthAgeMax === null) {
    return fail("适用月龄必须为整数");
  }
  if (monthAgeMin > monthAgeMax) {
    return fail("最小月龄不能大于最大月龄");
  }
  if (RECIPE_TYPES.indexOf(event.type) === -1) {
    return fail("食谱分类不合法");
  }
  const ingRes = normalizeIngredients(event.ingredients);
  if (!ingRes.ok) {
    return fail(ingRes.error);
  }
  const stepRes = normalizeSteps(event.steps);
  if (!stepRes.ok) {
    return fail(stepRes.error);
  }
  // babyId 校验访问权
  let babyId = "";
  if (event.babyId !== undefined && event.babyId !== null && toStr(event.babyId)) {
    babyId = toStr(event.babyId);
    const { baby, isOwner, member } = await resolveAccess(babyId, OPENID);
    if (!baby) {
      return fail("归属宝贝不存在");
    }
    if (!isOwner && !member) {
      return fail("无权将食谱归属到该宝贝");
    }
  }
  // allergens：入参给了用入参，否则由 ingredients 推断
  let allergens;
  if (Array.isArray(event.allergens) && event.allergens.length > 0) {
    allergens = normalizeTags(event.allergens);
  } else {
    allergens = inferAllergens(ingRes.value);
  }
  const now = db.serverDate();
  const doc = {
    title: title,
    monthAgeMin: monthAgeMin,
    monthAgeMax: monthAgeMax,
    type: event.type,
    ingredients: ingRes.value,
    steps: stepRes.value,
    nutrition: normalizeNutrition(event.nutrition),
    source: normalizeSource(event.source),
    imageUrl: toStr(event.imageUrl),
    tags: normalizeTags(event.tags),
    allergens: allergens,
    isOfficial: false,
    creatorOpenid: OPENID,
    babyId: babyId,
    createdAt: now
  };
  const addRes = await recipesCol.add({ data: doc });
  const recipeId = addRes._id;
  const fresh = await recipesCol.doc(recipeId).get().catch(() => ({ data: null }));
  return ok((fresh && fresh.data) || Object.assign({ _id: recipeId }, doc));
}
/**
 * action=update 更新自建食谱
 * 入参：{ recipeId, ...可改字段 }
 * 限制：必须是自建(isOfficial!=true)且 creatorOpenid==OPENID；不允许改 isOfficial/creatorOpenid。
 */
async function updateRecipe(event, OPENID) {
  const recipeId = event.recipeId;
  if (!recipeId) {
    return fail("recipeId 必填");
  }
  const res = await recipesCol.doc(recipeId).get().catch(() => ({ data: null }));
  const recipe = res && res.data ? res.data : null;
  if (!recipe) {
    return fail("食谱不存在");
  }
  if (recipe.isOfficial === true) {
    return fail("官方食谱不可编辑");
  }
  if (!recipe.creatorOpenid || recipe.creatorOpenid !== OPENID) {
    return fail("仅创建者本人可编辑该食谱");
  }
  const patch = {};
  if (event.title !== undefined) {
    const t = toStr(event.title);
    if (!t) {
      return fail("食谱名称不能为空");
    }
    patch.title = t;
  }
  // 月龄：允许只传其中一个，但最终 min<=max
  let nextMin = recipe.monthAgeMin;
  let nextMax = recipe.monthAgeMax;
  if (event.monthAgeMin !== undefined) {
    const m = toPositiveInt(event.monthAgeMin, null);
    if (m === null) {
      return fail("最小月龄必须为整数");
    }
    nextMin = m;
  }
  if (event.monthAgeMax !== undefined) {
    const m = toPositiveInt(event.monthAgeMax, null);
    if (m === null) {
      return fail("最大月龄必须为整数");
    }
    nextMax = m;
  }
  if (event.monthAgeMin !== undefined || event.monthAgeMax !== undefined) {
    if (nextMin > nextMax) {
      return fail("最小月龄不能大于最大月龄");
    }
    patch.monthAgeMin = nextMin;
    patch.monthAgeMax = nextMax;
  }
  if (event.type !== undefined) {
    if (RECIPE_TYPES.indexOf(event.type) === -1) {
      return fail("食谱分类不合法");
    }
    patch.type = event.type;
  }
  let nextIngredients = recipe.ingredients;
  if (event.ingredients !== undefined) {
    const ingRes = normalizeIngredients(event.ingredients);
    if (!ingRes.ok) {
      return fail(ingRes.error);
    }
    patch.ingredients = ingRes.value;
    nextIngredients = ingRes.value;
  }
  if (event.steps !== undefined) {
    const stepRes = normalizeSteps(event.steps);
    if (!stepRes.ok) {
      return fail(stepRes.error);
    }
    patch.steps = stepRes.value;
  }
  if (event.nutrition !== undefined) {
    patch.nutrition = normalizeNutrition(event.nutrition);
  }
  if (event.source !== undefined) {
    patch.source = normalizeSource(event.source);
  }
  if (event.imageUrl !== undefined) {
    patch.imageUrl = toStr(event.imageUrl);
  }
  if (event.tags !== undefined) {
    patch.tags = normalizeTags(event.tags);
  }
  // babyId 归属变更：需校验访问权（空字符串表示不归属）
  if (event.babyId !== undefined) {
    const newBabyId = toStr(event.babyId);
    if (newBabyId) {
      const { baby, isOwner, member } = await resolveAccess(newBabyId, OPENID);
      if (!baby) {
        return fail("归属宝贝不存在");
      }
      if (!isOwner && !member) {
        return fail("无权将食谱归属到该宝贝");
      }
    }
    patch.babyId = newBabyId;
  }
  // allergens：入参显式给了用入参；否则若 ingredients 有变更则重新推断
  if (event.allergens !== undefined) {
    patch.allergens = normalizeTags(event.allergens);
  } else if (event.ingredients !== undefined) {
    patch.allergens = inferAllergens(nextIngredients);
  }
  // 禁止改 isOfficial/creatorOpenid（即便入参传了也不写入）
  patch.updatedAt = db.serverDate();
  await recipesCol.doc(recipeId).update({ data: patch });
  const fresh = await recipesCol.doc(recipeId).get().catch(() => ({ data: null }));
  return ok((fresh && fresh.data) || null);
}
/**
 * action=delete 删除自建食谱
 * 入参：{ recipeId }。仅创建者本人可删自建食谱（isOfficial!=true）。官方食谱禁止删。
 */
async function deleteRecipe(event, OPENID) {
  const recipeId = event.recipeId;
  if (!recipeId) {
    return fail("recipeId 必填");
  }
  const res = await recipesCol.doc(recipeId).get().catch(() => ({ data: null }));
  const recipe = res && res.data ? res.data : null;
  if (!recipe) {
    return fail("食谱不存在");
  }
  if (recipe.isOfficial === true) {
    return fail("官方食谱不可删除");
  }
  if (!recipe.creatorOpenid || recipe.creatorOpenid !== OPENID) {
    return fail("仅创建者本人可删除该食谱");
  }
  await recipesCol.doc(recipeId).remove();
  return ok({ recipeId: recipeId, deleted: true });
}
/**
 * 云函数入口
 */
exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) {
    return fail("无法获取用户身份（OPENID 为空）");
  }
  const action = event.action;
  try {
    switch (action) {
      case "list":
        return await listRecipes(event, OPENID);
      case "get":
        return await getRecipe(event, OPENID);
      case "create":
        return await createRecipe(event, OPENID);
      case "update":
        return await updateRecipe(event, OPENID);
      case "delete":
        return await deleteRecipe(event, OPENID);
      default:
        return fail("未知 action: " + action);
    }
  } catch (err) {
    return fail((err && err.errMsg) || String(err));
  }
};
