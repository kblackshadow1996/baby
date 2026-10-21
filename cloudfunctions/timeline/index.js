// cloudfunctions/timeline/index.js
// 辅食时间线云函数：统一入口按 event.action 分发。
// 数据来源：meal 云函数在首次尝试新食物时写入 food_timeline；allergy 云函数会把
// 对应 food_timeline 的 reaction 置为 'allergy'。本函数只负责读取/删除。
// 权限校验全部在云函数内完成（家庭共享集合不走客户端直连），思路同 meal 的 resolveAccess。
// food_timeline 契约（docs/data-model.md food_timeline）：
//   babyId, foodName, category(grain/veggie/fruit/meat/egg_dairy/seafood/other),
//   firstTriedDate(Date), reaction(normal/allergy), mealRecordId, createdAt
// 契约（action=list）：
//   入参 { babyId, category?(筛选), reaction?(筛选 normal/allergy) }
//   返回 { success:true, data:{ items:[...], stats:{ total, allergyCount, byCategory } } }
//   stats 基于该宝贝全部时间线统计（不受 category/reaction 筛选影响），便于顶部总览展示。
const cloud = require("wx-server-sdk");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const babiesCol = db.collection("babies");
const membersCol = db.collection("family_members");
const timelineCol = db.collection("food_timeline");
/** 合法分类 */
const CATEGORIES = ["grain", "veggie", "fruit", "meat", "egg_dairy", "seafood", "other"];
/** 合法反应 */
const REACTIONS = ["normal", "allergy"];
/** 成功响应 */
function ok(data) {
  return { success: true, data };
}
/** 失败响应 */
function fail(error) {
  return { success: false, error: String(error) };
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
 * 拉取该宝贝的全部时间线（用于统计，不分页；单宝贝食材量级可控）。
 * @param {string} babyId
 * @returns {Promise<Object[]>}
 */
async function fetchAllTimeline(babyId) {
  const out = [];
  const MAX = 1000; // 安全上限，避免异常数据导致无限循环
  // 云数据库单次最多返回 100 条，循环分页取全量。
  for (let skip = 0; skip < MAX; skip += 100) {
    const res = await timelineCol
      .where({ babyId: babyId })
      .skip(skip)
      .limit(100)
      .get();
    const batch = res.data || [];
    for (let i = 0; i < batch.length; i++) {
      out.push(batch[i]);
    }
    if (batch.length < 100) {
      break;
    }
  }
  return out;
}
/**
 * 统计该宝贝全部时间线：总数、过敏数、按分类计数。
 * @param {Object[]} all 全部时间线文档
 * @returns {{ total:number, allergyCount:number, byCategory:Object }}
 */
function buildStats(all) {
  const byCategory = {};
  CATEGORIES.forEach((c) => {
    byCategory[c] = 0;
  });
  let allergyCount = 0;
  for (let i = 0; i < all.length; i++) {
    const item = all[i];
    const cat = CATEGORIES.indexOf(item.category) >= 0 ? item.category : "other";
    byCategory[cat] += 1;
    if (item.reaction === "allergy") {
      allergyCount += 1;
    }
  }
  return { total: all.length, allergyCount: allergyCount, byCategory: byCategory };
}
/**
 * 取 firstTriedDate 的毫秒值用于排序，无效日期按 0 处理。
 * @param {Object} item
 * @returns {number}
 */
function triedTime(item) {
  if (!item || !item.firstTriedDate) {
    return 0;
  }
  const d = item.firstTriedDate instanceof Date ? item.firstTriedDate : new Date(item.firstTriedDate);
  const t = d.getTime();
  return isNaN(t) ? 0 : t;
}
/**
 * action=list 查某宝贝的辅食时间线。
 * 入参 { babyId, category?, reaction? }
 * - 先 assertBabyAccess；
 * - 取全部时间线做 stats（不受筛选影响），再按 category/reaction 过滤出 items；
 * - items 按 firstTriedDate 降序（最近尝试在前）。
 */
async function listTimeline(event, OPENID) {
  const babyId = event.babyId;
  await assertBabyAccess(babyId, OPENID);
  // 校验筛选参数（非法值视为未筛选，避免误传导致空结果）
  const category =
    typeof event.category === "string" && CATEGORIES.indexOf(event.category) >= 0
      ? event.category
      : null;
  const reaction =
    typeof event.reaction === "string" && REACTIONS.indexOf(event.reaction) >= 0
      ? event.reaction
      : null;
  const all = await fetchAllTimeline(babyId);
  const stats = buildStats(all);
  let items = all.slice();
  if (category) {
    items = items.filter((it) => it.category === category);
  }
  if (reaction) {
    items = items.filter((it) => it.reaction === reaction);
  }
  // firstTriedDate 降序；同日期按 createdAt 降序兜底
  items.sort((a, b) => {
    const ta = triedTime(a);
    const tb = triedTime(b);
    if (tb !== ta) {
      return tb - ta;
    }
    const ca = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const cb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return cb - ca;
  });
  return ok({ items: items, stats: stats });
}
/**
 * action=delete 删除一条时间线记录（用户误记可删）。owner 或 edit 权限。
 * 入参 { recordId }
 */
async function deleteTimeline(event, OPENID) {
  const recordId = event.recordId;
  if (!recordId) {
    return fail("recordId 必填");
  }
  const curRes = await timelineCol.doc(recordId).get().catch(() => ({ data: null }));
  const current = curRes && curRes.data ? curRes.data : null;
  if (!current) {
    return fail("记录不存在");
  }
  const access = await assertBabyAccess(current.babyId, OPENID);
  assertCanEdit(access);
  await timelineCol.doc(recordId).remove();
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
      case "list":
        return await listTimeline(event, OPENID);
      case "delete":
        return await deleteTimeline(event, OPENID);
      default:
        return fail("未知 action: " + action);
    }
  } catch (err) {
    return fail((err && err.errMsg) || String(err));
  }
};
