// cloudfunctions/growth/index.js
// 成长记录云函数：统一入口按 event.action 分发。
// 契约（docs/data-model.md growth_records）：
//   babyId, date(Date), height(number cm), weight(number kg),
//   headCircumference(number cm), recorderOpenid, createdAt
// 权限校验全部在云函数内完成（家庭共享集合不走客户端直连），思路同 meal 的 resolveAccess。
//   - action=list   { babyId }                         -> assertBabyAccess，按 date 升序返回全部
//   - action=add    { babyId, date, height?, weight?, headCircumference? }
//   - action=update { recordId, date?, height?, weight?, headCircumference? }
//   - action=delete { recordId }
// 数值字段：接受 number 或可转数字的字符串，空字符串/未传表示该次不记录该项（存 null）。
//   每次写入至少需要一项有效（正数）。
// 日期处理：'YYYY-MM-DD' 按东八区解析为当天 0 点（dayStartOf），避免 UTC 偏移。
const cloud = require("wx-server-sdk");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const babiesCol = db.collection("babies");
const membersCol = db.collection("family_members");
const growthCol = db.collection("growth_records");

/** 成功响应 */
function ok(data) {
  return { success: true, data };
}
/** 失败响应 */
function fail(error) {
  return { success: false, error: String(error) };
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
 * 解析成长指标数值。
 * 返回 { provided, value }：
 *   provided=false 表示未传/空字符串，调用方应视为"该次不记录该项"。
 *   provided=true  则 value 为合法正数；非法时抛错。
 * @param {*} raw
 * @param {string} label 字段中文名（用于报错）
 * @returns {{ provided: boolean, value: number|null }}
 */
function parseMetric(raw, label) {
  if (raw === undefined || raw === null || raw === "") {
    return { provided: false, value: null };
  }
  const n = Number(raw);
  if (isNaN(n) || !isFinite(n) || n <= 0) {
    throw new Error(`${label}需为正数`);
  }
  return { provided: true, value: n };
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
 * action=list 查某宝贝全部成长记录，按 date 升序。
 * 入参 { babyId }
 */
async function listGrowth(event, OPENID) {
  const babyId = event.babyId;
  await assertBabyAccess(babyId, OPENID);
  const res = await growthCol
    .where({ babyId: babyId })
    .orderBy("date", "asc")
    .limit(1000)
    .get();
  const records = res.data || [];
  return ok({ records: records });
}

/**
 * action=add 新增成长记录。
 * 入参 { babyId, date('YYYY-MM-DD'), height?, weight?, headCircumference? }
 */
async function addGrowth(event, OPENID) {
  const babyId = event.babyId;
  const access = await assertBabyAccess(babyId, OPENID);
  assertCanEdit(access);
  const dayStart = dayStartOf(event.date);
  if (!dayStart) {
    return fail("date 格式应为 YYYY-MM-DD");
  }
  const height = parseMetric(event.height, "身高");
  const weight = parseMetric(event.weight, "体重");
  const head = parseMetric(event.headCircumference, "头围");
  if (!height.provided && !weight.provided && !head.provided) {
    return fail("身高/体重/头围至少填写一项");
  }
  const now = db.serverDate();
  const doc = {
    babyId: babyId,
    date: dayStart,
    height: height.provided ? height.value : null,
    weight: weight.provided ? weight.value : null,
    headCircumference: head.provided ? head.value : null,
    recorderOpenid: OPENID,
    createdAt: now
  };
  const addRes = await growthCol.add({ data: doc });
  const recordId = addRes._id;
  const fresh = await growthCol.doc(recordId).get().catch(() => ({ data: null }));
  const record = fresh && fresh.data ? fresh.data : Object.assign({ _id: recordId }, doc);
  return ok(record);
}

/**
 * action=update 更新成长记录可改字段。
 * 入参 { recordId, date?, height?, weight?, headCircumference? }
 * 传空字符串表示清除该项（置 null）；未传则保持不变。
 */
async function updateGrowth(event, OPENID) {
  const recordId = event.recordId;
  if (!recordId) {
    return fail("recordId 必填");
  }
  const curRes = await growthCol.doc(recordId).get().catch(() => ({ data: null }));
  const current = curRes && curRes.data ? curRes.data : null;
  if (!current) {
    return fail("记录不存在");
  }
  const access = await assertBabyAccess(current.babyId, OPENID);
  assertCanEdit(access);

  const patch = {};
  if (event.date !== undefined) {
    const ds = dayStartOf(event.date);
    if (!ds) {
      return fail("date 格式应为 YYYY-MM-DD");
    }
    patch.date = ds;
  }
  // 数值字段：undefined 表示不改；空字符串表示清除（null）；其它须为正数。
  if (event.height !== undefined) {
    const m = parseMetric(event.height, "身高");
    patch.height = m.provided ? m.value : null;
  }
  if (event.weight !== undefined) {
    const m = parseMetric(event.weight, "体重");
    patch.weight = m.provided ? m.value : null;
  }
  if (event.headCircumference !== undefined) {
    const m = parseMetric(event.headCircumference, "头围");
    patch.headCircumference = m.provided ? m.value : null;
  }

  // 校验更新后至少一项有值
  const nextHeight = patch.height !== undefined ? patch.height : current.height;
  const nextWeight = patch.weight !== undefined ? patch.weight : current.weight;
  const nextHead =
    patch.headCircumference !== undefined ? patch.headCircumference : current.headCircumference;
  if (!isPositive(nextHeight) && !isPositive(nextWeight) && !isPositive(nextHead)) {
    return fail("身高/体重/头围至少保留一项");
  }

  if (Object.keys(patch).length === 0) {
    return ok(current);
  }
  await growthCol.doc(recordId).update({ data: patch });
  const fresh = await growthCol.doc(recordId).get().catch(() => ({ data: null }));
  const record = fresh && fresh.data ? fresh.data : Object.assign({}, current, patch);
  return ok(record);
}

/** 是否为正数 */
function isPositive(v) {
  return typeof v === "number" && isFinite(v) && v > 0;
}

/**
 * action=delete 删除成长记录（owner 或 edit 权限）。
 * 入参 { recordId }
 */
async function deleteGrowth(event, OPENID) {
  const recordId = event.recordId;
  if (!recordId) {
    return fail("recordId 必填");
  }
  const curRes = await growthCol.doc(recordId).get().catch(() => ({ data: null }));
  const current = curRes && curRes.data ? curRes.data : null;
  if (!current) {
    return fail("记录不存在");
  }
  const access = await assertBabyAccess(current.babyId, OPENID);
  assertCanEdit(access);
  await growthCol.doc(recordId).remove();
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
        return await listGrowth(event, OPENID);
      case "add":
        return await addGrowth(event, OPENID);
      case "update":
        return await updateGrowth(event, OPENID);
      case "delete":
        return await deleteGrowth(event, OPENID);
      default:
        return fail("未知 action: " + action);
    }
  } catch (err) {
    return fail((err && err.errMsg) || String(err));
  }
};
