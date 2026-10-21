// cloudfunctions/meal/index.js
// 用餐记录云函数：统一入口按 event.action 分发。
// Task 8 实现 listByDate / listRange；Task 9 补全 getById / add / update / delete。
// 权限校验全部在云函数内完成（家庭共享集合不走客户端直连），思路同 baby 的 resolveAccess。
// 契约（docs/data-model.md meal_records）：
//   babyId, date(Date), mealType(breakfast/lunch/dinner/snack_am/snack_pm/night/custom),
//   customMealName, mealTime('HH:mm'),
//   foods[{ name, amountMode(preset/custom), amountLevel(little/half/most/all),
//           amountValue, amountUnit, recipeId }],
//   note, hasAllergyFlag, recorderOpenid, createdAt
// food_timeline 契约（docs/data-model.md food_timeline）：
//   babyId, foodName, category(grain/veggie/fruit/meat/egg_dairy/seafood/other),
//   firstTriedDate(Date), reaction(normal/allergy), mealRecordId, createdAt
// 日期处理：'YYYY-MM-DD' 按东八区解析为当天 0 点，dayStart/dayEnd 用 Date 对象比较。
const cloud = require("wx-server-sdk");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const babiesCol = db.collection("babies");
const membersCol = db.collection("family_members");
const mealsCol = db.collection("meal_records");
const timelineCol = db.collection("food_timeline");

/** 合法餐别 */
const MEAL_TYPES = [
  "breakfast",
  "lunch",
  "dinner",
  "snack_am",
  "snack_pm",
  "night",
  "custom"
];
/** 合法份量档位 */
const AMOUNT_LEVELS = ["little", "half", "most", "all"];
/** 合法份量单位 */
const AMOUNT_UNITS = ["ml", "g", "勺", "个"];

/**
 * guessCategory 关键词表：按 food_timeline.category 分类的可维护关键词映射。
 * 命中顺序：先 seafood（海鲜中也含"鱼/虾"等，优先于 meat），再 egg_dairy、meat、fruit、veggie、grain。
 * 每项的关键词只要被食物名 includes 命中即归为该类。
 */
const CATEGORY_KEYWORDS = [
  { category: "seafood", keywords: ["鱼", "虾", "蟹", "贝", "鳕", "三文", "蛤", "蛎", "鲈", "鲅", "黄花", "鳝"] },
  { category: "egg_dairy", keywords: ["蛋", "奶", "酸奶", "奶酪", "芝士", "豆腐", "豆浆", "黄油", "乳"] },
  { category: "meat", keywords: ["肉", "猪", "牛", "鸡", "鸭", "羊", "肝", "排骨", "里脊", "瘦"] },
  { category: "fruit", keywords: ["果", "苹果", "香蕉", "梨", "莓", "橙", "橘", "桃", "葡萄", "西瓜", "枣", "柚", "猕猴桃", "芒果"] },
  { category: "veggie", keywords: ["菜", "瓜", "萝卜", "菠菜", "西兰花", "番茄", "西红柿", "土豆", "豆角", "茄", "椒", "蘑菇", "菌", "芹", "笋", "藕", "南瓜", "胡萝卜"] },
  { category: "grain", keywords: ["米", "面", "粥", "粉", "饭", "麦", "燕麦", "糊", "馒头", "饼", "藜麦", "玉米", "红薯", "山药", "通心"] }
];

/** 成功响应 */
function ok(data) {
  return { success: true, data };
}
/** 失败响应 */
function fail(error) {
  return { success: false, error: String(error) };
}

/**
 * 根据食物名关键词推断 food_timeline.category。
 * @param {string} name 食物名称
 * @returns {string} grain/veggie/fruit/meat/egg_dairy/seafood/other
 */
function guessCategory(name) {
  const s = typeof name === "string" ? name : "";
  if (!s) {
    return "other";
  }
  for (let i = 0; i < CATEGORY_KEYWORDS.length; i++) {
    const group = CATEGORY_KEYWORDS[i];
    for (let j = 0; j < group.keywords.length; j++) {
      if (s.indexOf(group.keywords[j]) !== -1) {
        return group.category;
      }
    }
  }
  return "other";
}

/**
 * 校验 "YYYY-MM-DD" 字符串格式
 * @param {*} value
 * @returns {boolean}
 */
function isDateString(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}
/**
 * 把 "YYYY-MM-DD" 解析为东八区当天 0 点的 Date 对象。
 * 统一用 'T00:00:00.000+08:00' 构造，避免云函数 UTC 环境下的时区偏移。
 * @param {string} dateStr
 * @returns {Date|null}
 */
function dayStartOf(dateStr) {
  if (!isDateString(dateStr)) {
    return null;
  }
  const d = new Date(`${dateStr}T00:00:00.000+08:00`);
  return isNaN(d.getTime()) ? null : d;
}
/**
 * 返回当天 0 点往后 24 小时的 Date（次日 0 点）。
 * @param {Date} dayStart
 * @returns {Date}
 */
function nextDay(dayStart) {
  return new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
}

/**
 * 校验 mealTime 是否为 "HH:mm"（可空）
 * @param {*} value
 * @returns {boolean}
 */
function isMealTime(value) {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/**
 * 规范化单个 food 元素，仅保留契约字段并做基础清洗/校验。
 * @param {Object} raw 原始 food
 * @returns {{ food: Object|null, error: string|null }}
 */
function normalizeFood(raw) {
  if (!raw || typeof raw !== "object") {
    return { food: null, error: "食物项格式错误" };
  }
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name) {
    return { food: null, error: "每个食物都需要填写名称" };
  }
  const mode = raw.amountMode === "custom" ? "custom" : "preset";
  const food = { name: name, amountMode: mode };
  if (mode === "preset") {
    const level = AMOUNT_LEVELS.indexOf(raw.amountLevel) >= 0 ? raw.amountLevel : "all";
    food.amountLevel = level;
  } else {
    const v = Number(raw.amountValue);
    if (isNaN(v) || v < 0) {
      return { food: null, error: `「${name}」的精确份量需填写有效数值` };
    }
    food.amountValue = v;
    food.amountUnit = AMOUNT_UNITS.indexOf(raw.amountUnit) >= 0 ? raw.amountUnit : "g";
  }
  if (typeof raw.recipeId === "string" && raw.recipeId) {
    food.recipeId = raw.recipeId;
  }
  return { food: food, error: null };
}

/**
 * 规范化整个 foods 数组。
 * @param {*} foods
 * @returns {{ foods: Object[]|null, error: string|null }}
 */
function normalizeFoods(foods) {
  if (!Array.isArray(foods) || foods.length === 0) {
    return { foods: null, error: "请至少添加一个食物" };
  }
  const out = [];
  for (let i = 0; i < foods.length; i++) {
    const { food, error } = normalizeFood(foods[i]);
    if (error) {
      return { foods: null, error: error };
    }
    out.push(food);
  }
  return { foods: out, error: null };
}

/**
 * 查询某用户对某宝贝的访问权限。owner 或在 family_members 中即有权访问。
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
 * 断言用户对宝贝有访问权，否则抛出错误（供统一 catch 转 fail）。
 * @param {string} babyId
 * @param {string} openid
 * @returns {Promise<{baby:Object, isOwner:boolean, member:Object|null}>}
 */
async function assertBabyAccess(babyId, openid) {
  if (!babyId) {
    throw new Error("babyId 必填");
  }
  const access = await resolveAccess(babyId, openid);
  if (!access.baby) {
    throw new Error("宝贝不存在");
  }
  if (!access.isOwner && !access.member) {
    throw new Error("无权访问该宝贝");
  }
  return access;
}

/**
 * 断言有编辑权（owner 或 member.permissions==='edit'），否则抛错。
 * @param {{isOwner:boolean, member:Object|null}} access
 */
function assertCanEdit(access) {
  const canEdit = access.isOwner || (access.member && access.member.permissions === "edit");
  if (!canEdit) {
    throw new Error("无编辑权限");
  }
}

/**
 * 按 mealTime 升序排序；无 mealTime 的靠后，按 createdAt 升序兜底。
 */
function sortRecords(records) {
  return records.slice().sort((a, b) => {
    const ta = typeof a.mealTime === "string" && a.mealTime ? a.mealTime : null;
    const tb = typeof b.mealTime === "string" && b.mealTime ? b.mealTime : null;
    if (ta && tb) {
      if (ta < tb) return -1;
      if (ta > tb) return 1;
    } else if (ta && !tb) {
      return -1;
    } else if (!ta && tb) {
      return 1;
    }
    const ca = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const cb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return ca - cb;
  });
}

/**
 * 辅食首尝检测：对 foods 中每个 food.name，若该 babyId+foodName 在 food_timeline
 * 不存在则补写一条首尝记录；已存在则跳过（不覆盖首尝日期）。
 * 失败只记 warning，不抛错（由调用方 try/catch 包裹）。
 * @param {string} babyId
 * @param {Object[]} foods 已规范化的 foods
 * @param {Date} firstTriedDate 该餐日期
 * @param {string} mealRecordId 关联用餐记录 _id
 */
async function updateFoodTimeline(babyId, foods, firstTriedDate, mealRecordId) {
  const now = db.serverDate();
  // 去重同一餐内重复食物名
  const seen = {};
  const names = [];
  foods.forEach((f) => {
    const n = f && f.name ? f.name : "";
    if (n && !seen[n]) {
      seen[n] = true;
      names.push(n);
    }
  });
  for (let i = 0; i < names.length; i++) {
    const foodName = names[i];
    try {
      const existRes = await timelineCol
        .where({ babyId: babyId, foodName: foodName })
        .limit(1)
        .get();
      if (existRes.data && existRes.data.length > 0) {
        continue; // 已有首尝记录，保留原首尝日期
      }
      await timelineCol.add({
        data: {
          babyId: babyId,
          foodName: foodName,
          category: guessCategory(foodName),
          firstTriedDate: firstTriedDate,
          reaction: "normal",
          mealRecordId: mealRecordId,
          createdAt: now
        }
      });
    } catch (e) {
      console.warn("[meal] updateFoodTimeline failed for", foodName, e && (e.errMsg || e));
    }
  }
}

/**
 * action=listByDate 查某宝贝某天的用餐记录。
 * 入参 { babyId, date('YYYY-MM-DD') }
 */
async function listByDate(event, OPENID) {
  const babyId = event.babyId;
  const date = event.date;
  await assertBabyAccess(babyId, OPENID);
  const dayStart = dayStartOf(date);
  if (!dayStart) {
    return fail("date 格式应为 YYYY-MM-DD");
  }
  const dayEnd = nextDay(dayStart);
  const res = await mealsCol
    .where({
      babyId: babyId,
      date: _.gte(dayStart).and(_.lt(dayEnd))
    })
    .get();
  const records = sortRecords(res.data || []);
  return ok({ date: date, records: records });
}

/**
 * action=listRange 查区间内所有用餐记录（用于周日历"哪些天有记录"打点）。
 * 入参 { babyId, startDate, endDate }（含起止，endDate 取当天 24 点为上界）
 */
async function listRange(event, OPENID) {
  const babyId = event.babyId;
  const startDate = event.startDate;
  const endDate = event.endDate;
  await assertBabyAccess(babyId, OPENID);
  const rangeStart = dayStartOf(startDate);
  const endDayStart = dayStartOf(endDate);
  if (!rangeStart || !endDayStart) {
    return fail("startDate/endDate 格式应为 YYYY-MM-DD");
  }
  const rangeEnd = nextDay(endDayStart);
  const res = await mealsCol
    .where({
      babyId: babyId,
      date: _.gte(rangeStart).and(_.lt(rangeEnd))
    })
    .get();
  const records = res.data || [];
  return ok({ records: records });
}

/**
 * action=getById 读取单条用餐记录（供编辑回填）。
 * 入参 { recordId }
 */
async function getById(event, OPENID) {
  const recordId = event.recordId;
  if (!recordId) {
    return fail("recordId 必填");
  }
  const res = await mealsCol.doc(recordId).get().catch(() => ({ data: null }));
  const record = res && res.data ? res.data : null;
  if (!record) {
    return fail("记录不存在");
  }
  await assertBabyAccess(record.babyId, OPENID);
  return ok(record);
}

/**
 * action=add 新增用餐记录，并做辅食首尝检测写 food_timeline。
 * 入参 { babyId, date('YYYY-MM-DD'), mealType, customMealName, mealTime, foods[], note }
 */
async function addMeal(event, OPENID) {
  const babyId = event.babyId;
  const access = await assertBabyAccess(babyId, OPENID);
  assertCanEdit(access);

  const mealType = event.mealType;
  if (MEAL_TYPES.indexOf(mealType) < 0) {
    return fail("mealType 不合法");
  }
  const dayStart = dayStartOf(event.date);
  if (!dayStart) {
    return fail("date 格式应为 YYYY-MM-DD");
  }
  const { foods, error } = normalizeFoods(event.foods);
  if (error) {
    return fail(error);
  }
  if (event.mealTime !== undefined && event.mealTime !== "" && !isMealTime(event.mealTime)) {
    return fail("mealTime 格式应为 HH:mm");
  }

  const now = db.serverDate();
  const doc = {
    babyId: babyId,
    date: dayStart,
    mealType: mealType,
    customMealName:
      mealType === "custom" && typeof event.customMealName === "string"
        ? event.customMealName.trim()
        : "",
    mealTime: typeof event.mealTime === "string" ? event.mealTime : "",
    foods: foods,
    note: typeof event.note === "string" ? event.note.trim() : "",
    hasAllergyFlag: false, // Task 10 过敏标记会置 true
    recorderOpenid: OPENID,
    createdAt: now
  };

  const addRes = await mealsCol.add({ data: doc });
  const recordId = addRes._id;

  // 辅食首尝检测：失败不影响 add 主流程
  try {
    await updateFoodTimeline(babyId, foods, dayStart, recordId);
  } catch (e) {
    console.warn("[meal] food_timeline update skipped:", e && (e.errMsg || e));
  }

  const fresh = await mealsCol.doc(recordId).get().catch(() => ({ data: null }));
  const record = fresh && fresh.data ? fresh.data : Object.assign({ _id: recordId }, doc);
  return ok(record);
}

/**
 * action=update 更新用餐记录可改字段，并对新增食物补 food_timeline。
 * 入参 { recordId, date?, mealType?, customMealName?, mealTime?, foods?, note? }
 */
async function updateMeal(event, OPENID) {
  const recordId = event.recordId;
  if (!recordId) {
    return fail("recordId 必填");
  }
  const curRes = await mealsCol.doc(recordId).get().catch(() => ({ data: null }));
  const current = curRes && curRes.data ? curRes.data : null;
  if (!current) {
    return fail("记录不存在");
  }
  const access = await assertBabyAccess(current.babyId, OPENID);
  assertCanEdit(access);

  const patch = {};

  // mealType（校验合法）
  let effectiveMealType = current.mealType;
  if (event.mealType !== undefined) {
    if (MEAL_TYPES.indexOf(event.mealType) < 0) {
      return fail("mealType 不合法");
    }
    patch.mealType = event.mealType;
    effectiveMealType = event.mealType;
  }
  // customMealName（随 mealType 语义）
  if (event.customMealName !== undefined) {
    patch.customMealName =
      effectiveMealType === "custom" && typeof event.customMealName === "string"
        ? event.customMealName.trim()
        : "";
  } else if (patch.mealType && effectiveMealType !== "custom") {
    // 若把餐别改成非自定义，清空自定义名
    patch.customMealName = "";
  }
  // date
  let effectiveDate = current.date;
  if (event.date !== undefined) {
    const ds = dayStartOf(event.date);
    if (!ds) {
      return fail("date 格式应为 YYYY-MM-DD");
    }
    patch.date = ds;
    effectiveDate = ds;
  }
  // mealTime
  if (event.mealTime !== undefined) {
    if (event.mealTime !== "" && !isMealTime(event.mealTime)) {
      return fail("mealTime 格式应为 HH:mm");
    }
    patch.mealTime = typeof event.mealTime === "string" ? event.mealTime : "";
  }
  // note
  if (event.note !== undefined) {
    patch.note = typeof event.note === "string" ? event.note.trim() : "";
  }
  // foods（整组替换）
  let newFoods = null;
  if (event.foods !== undefined) {
    const { foods, error } = normalizeFoods(event.foods);
    if (error) {
      return fail(error);
    }
    newFoods = foods;
    patch.foods = foods;
  }

  if (Object.keys(patch).length === 0) {
    return ok(current);
  }

  await mealsCol.doc(recordId).update({ data: patch });

  // 对新增出现的 food 补 food_timeline（已存在跳过），日期用更新后的 date
  if (newFoods) {
    try {
      await updateFoodTimeline(current.babyId, newFoods, effectiveDate, recordId);
    } catch (e) {
      console.warn("[meal] food_timeline update skipped on update:", e && (e.errMsg || e));
    }
  }

  const fresh = await mealsCol.doc(recordId).get().catch(() => ({ data: null }));
  const record = fresh && fresh.data ? fresh.data : Object.assign({}, current, patch);
  return ok(record);
}

/**
 * action=delete 删除用餐记录（owner 或 edit 权限）。food_timeline 不回滚（首尝历史保留）。
 * 入参 { recordId }
 */
async function deleteMeal(event, OPENID) {
  const recordId = event.recordId;
  if (!recordId) {
    return fail("recordId 必填");
  }
  const curRes = await mealsCol.doc(recordId).get().catch(() => ({ data: null }));
  const current = curRes && curRes.data ? curRes.data : null;
  if (!current) {
    return fail("记录不存在");
  }
  const access = await assertBabyAccess(current.babyId, OPENID);
  assertCanEdit(access);
  await mealsCol.doc(recordId).remove();
  return ok({ recordId: recordId, deleted: true });
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
      case "listByDate":
        return await listByDate(event, OPENID);
      case "listRange":
        return await listRange(event, OPENID);
      case "getById":
        return await getById(event, OPENID);
      case "add":
        return await addMeal(event, OPENID);
      case "update":
        return await updateMeal(event, OPENID);
      case "delete":
        return await deleteMeal(event, OPENID);
      default:
        return fail("未知 action: " + action);
    }
  } catch (err) {
    return fail((err && err.errMsg) || String(err));
  }
};
