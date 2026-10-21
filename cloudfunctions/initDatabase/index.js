// cloudfunctions/initDatabase/index.js
// 管理员用数据库初始化云函数
// 作用：触发 10 个云数据库集合的自动创建。
// 原理：微信云开发无法用脚本"CREATE TABLE"式建集合，但云函数侧对一个
//       不存在的集合执行 db.collection(name).add() 会自动创建该集合。
//       本函数对每个集合：先 count() 探测是否存在；不存在则写入一条占位
//       文档触发创建，随后立即删除该占位文档，使集合存在但为空。
const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

// 需要初始化的全部集合名（与 utils/cloud.js 的 collection 常量保持一致）
const COLLECTIONS = [
  "users",
  "babies",
  "family_members",
  "invitations",
  "recipes",
  "meal_records",
  "allergy_records",
  "allergy_alerts",
  "growth_records",
  "food_timeline"
];

/**
 * 确保单个集合存在。
 * 若集合已存在返回 { collection, status: 'exists' }；
 * 若不存在则写入并删除占位文档以触发创建，返回 { status: 'created' }；
 * 任一步骤出错返回 { status: 'error', error }，不抛出以免阻断其余集合。
 * @param {string} name 集合名
 * @returns {Promise<{collection:string,status:string,error?:string}>}
 */
async function ensureCollection(name) {
  // 1) 探测集合是否已存在：对不存在的集合 count() 会抛错
  try {
    await db.collection(name).count();
    return { collection: name, status: "exists" };
  } catch (probeErr) {
    // 集合不存在（或暂时不可读），进入创建流程
  }

  // 2) 写入占位文档触发集合自动创建
  let placeholderId;
  try {
    const addRes = await db.collection(name).add({
      data: { _init: true, createdAt: db.serverDate() }
    });
    placeholderId = addRes._id;
  } catch (addErr) {
    return {
      collection: name,
      status: "error",
      error: (addErr && addErr.errMsg) || String(addErr)
    };
  }

  // 3) 删除占位文档，保持集合为空
  try {
    if (placeholderId) {
      await db.collection(name).doc(placeholderId).remove();
    }
    return { collection: name, status: "created" };
  } catch (removeErr) {
    // 集合已创建成功，仅占位文档清理失败——视为创建成功但附带告警
    return {
      collection: name,
      status: "created_with_leftover",
      error: (removeErr && removeErr.errMsg) || String(removeErr)
    };
  }
}

/**
 * 云函数入口。
 * 依次初始化全部集合，单个集合失败不影响其余。
 * @returns {Promise<{success:boolean, results:Array}>}
 */
exports.main = async () => {
  const results = [];

  for (const name of COLLECTIONS) {
    try {
      const res = await ensureCollection(name);
      results.push(res);
    } catch (err) {
      // 兜底：ensureCollection 内部已自行捕获，这里是最后一道防线
      results.push({
        collection: name,
        status: "error",
        error: (err && err.errMsg) || String(err)
      });
    }
  }

  return { success: true, results };
};
