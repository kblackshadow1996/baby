// cloudfunctions/initRecipes/index.js
// 管理员用云函数：导入官方预置食谱到云数据库 recipes 集合。
//
// 数据来源：随云函数一起打包的 ./recipes.json（它是项目根 data/recipes.json 的副本，
//           因为云函数运行时访问不到项目根的 data/ 目录，必须把数据复制进函数目录）。
//
// 入参 event.mode：
//   - "reset"  ：先删除所有 isOfficial==true 的旧官方食谱，再全量导入（首次/重置用）。
//   - "upsert" ：默认。按 title + monthAgeMin 判重，不存在才插入（增量补充用）。
//
// 返回：{ success, mode, inserted, skipped, deleted, total, failures }
const cloud = require("wx-server-sdk");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const COLLECTION = "recipes";
const BATCH_SIZE = 20; // 云函数单次操作有限制，分批写入

// 随函数打包的数据副本（务必与项目根 data/recipes.json 保持一致）
const RECIPES = require("./recipes.json");

/**
 * 规范化单条食谱为写入文档：强制 isOfficial，补 createdAt=serverDate，官方食谱无归属。
 * @param {object} r 原始食谱
 * @returns {object} 待写入文档
 */
function toDoc(r) {
  return Object.assign({}, r, {
    isOfficial: true,
    creatorOpenid: "",
    babyId: "",
    createdAt: db.serverDate()
  });
}

/**
 * 删除所有官方食谱（isOfficial==true）。
 * 云数据库 where().remove() 服务端单次最多删除 1000 条，循环直到删完。
 * @returns {Promise<number>} 删除总数
 */
async function deleteAllOfficial() {
  let deleted = 0;
  // 先统计一次，循环删除直到清空
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const res = await db
      .collection(COLLECTION)
      .where({ isOfficial: true })
      .remove();
    const n = (res && res.stats && res.stats.removed) || 0;
    deleted += n;
    if (n === 0) break;
  }
  return deleted;
}

/**
 * 判断某条官方食谱是否已存在（title + monthAgeMin 唯一键）。
 * @param {object} r 食谱
 * @returns {Promise<boolean>}
 */
async function exists(r) {
  const res = await db
    .collection(COLLECTION)
    .where({ isOfficial: true, title: r.title, monthAgeMin: r.monthAgeMin })
    .count();
  return (res && res.total) > 0;
}

/**
 * 云函数入口。
 * @param {{ mode?: "reset"|"upsert" }} event
 */
exports.main = async (event = {}) => {
  const mode = event.mode === "reset" ? "reset" : "upsert";
  const total = RECIPES.length;
  let inserted = 0;
  let skipped = 0;
  let deleted = 0;
  const failures = [];

  try {
    // reset 模式：先清空旧官方食谱
    if (mode === "reset") {
      deleted = await deleteAllOfficial();
    }

    // 组装待插入列表
    const toInsert = [];
    for (const r of RECIPES) {
      try {
        if (mode === "upsert") {
          // 判重：已存在则跳过
          const dup = await exists(r);
          if (dup) {
            skipped += 1;
            continue;
          }
        }
        toInsert.push(r);
      } catch (probeErr) {
        failures.push({
          title: r && r.title,
          stage: "probe",
          error: (probeErr && probeErr.errMsg) || String(probeErr)
        });
      }
    }

    // 分批插入（逐条 add，便于精确记录失败条目；按 BATCH_SIZE 并发一批）
    for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
      const batch = toInsert.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(
        batch.map(async (r) => {
          try {
            await db.collection(COLLECTION).add({ data: toDoc(r) });
            return { ok: true };
          } catch (addErr) {
            return {
              ok: false,
              title: r && r.title,
              error: (addErr && addErr.errMsg) || String(addErr)
            };
          }
        })
      );
      for (const res of results) {
        if (res.ok) {
          inserted += 1;
        } else {
          failures.push({ title: res.title, stage: "add", error: res.error });
        }
      }
    }

    return {
      success: failures.length === 0,
      mode,
      inserted,
      skipped,
      deleted,
      total,
      failures
    };
  } catch (err) {
    // 兜底：返回已完成的进度与错误，便于定位
    return {
      success: false,
      mode,
      inserted,
      skipped,
      deleted,
      total,
      error: (err && err.errMsg) || String(err),
      failures
    };
  }
};
