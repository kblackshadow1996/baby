// cloudfunctions/allergy/index.js
// 过敏观察云函数：统一入口按 event.action 分发（Task 10）。
// 权限校验全部在云函数内完成（家庭共享集合不走客户端直连），
// 思路与 meal 云函数一致：assertBabyAccess / assertCanEdit / resolveAccess。
// 云函数之间不共享代码，这些 helper 在本文件内各自实现。
//
// 契约（docs/data-model.md）：
//   allergy_records: babyId, mealRecordId(可空), date(Date), symptoms[string],
//                    suspectedFoods[string], severity(mild/moderate/severe,预留),
//                    note, photos[](预留), recorderOpenid, createdAt
//   allergy_alerts:  babyId, foodName, status(suspected/confirmed/cleared),
//                    firstOccurrence(Date), lastOccurrence(Date), recordIds[],
//                    symptomsSummary[], createdAt, updatedAt
//   （建议 babyId+foodName 唯一联合索引，避免重复预警）
//
// 日期处理：'YYYY-MM-DD' 按东八区解析为当天 0 点（dayStartOf）。
const cloud = require("wx-server-sdk");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const babiesCol = db.collection("babies");
const membersCol = db.collection("family_members");
const mealsCol = db.collection("meal_records");
const timelineCol = db.collection("food_timeline");
const allergyRecordsCol = db.collection("allergy_records");
const allergyAlertsCol = db.collection("allergy_alerts");

/** 合法过敏预警状态 */
const ALERT_STATUSES = ["suspected", "confirmed", "cleared"];
/** 合法严重程度（预留） */
const SEVERITIES = ["mild", "moderate", "severe"];

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
 * 把任意输入规范为去重后的非空字符串数组（trim、去空、去重，保序）。
 * @param {*} arr
 * @returns {string[]}
 */
function normalizeStringList(arr) {
  if (!Array.isArray(arr)) {
    return [];
  }
  const seen = {};
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    const s = typeof arr[i] === "string" ? arr[i].trim() : "";
    if (s && !seen[s]) {
      seen[s] = true;
      out.push(s);
    }
  }
  return out;
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
 * 把某餐 meal_record 的 hasAllergyFlag 置 true（失败只 warning，不抛错）。
 * @param {string} mealRecordId
 */
async function flagMealRecord(mealRecordId) {
  if (!mealRecordId) {
    return;
  }
  try {
    await mealsCol.doc(mealRecordId).update({ data: { hasAllergyFlag: true } });
  } catch (e) {
    console.warn("[allergy] flagMealRecord failed for", mealRecordId, e && (e.errMsg || e));
  }
}

/**
 * 把 food_timeline 中该 babyId+foodName 的 reaction 置为 'allergy'。
 * 若不存在则不处理。失败只 warning，不抛错。
 * @param {string} babyId
 * @param {string} foodName
 */
async function markTimelineAllergy(babyId, foodName) {
  try {
    await timelineCol
      .where({ babyId: babyId, foodName: foodName })
      .update({ data: { reaction: "allergy" } });
  } catch (e) {
    console.warn("[allergy] markTimelineAllergy failed for", foodName, e && (e.errMsg || e));
  }
}

/**
 * 自动聚合 allergy_alerts：对每个疑似食物维护一条预警记录。
 * - 不存在该 babyId+foodName → 新增（status=suspected）。
 * - 已存在 → 合并：lastOccurrence、recordIds 追加去重、symptomsSummary 合并去重、updatedAt。
 *   status 原则上保持不变；若原为 cleared 则重新置 suspected（又出现反应）。
 * - 靠 babyId+foodName 判重（建议该组合唯一索引），避免重复 alert。
 * 失败只 warning，不影响过敏记录主流程。
 * @param {string} babyId
 * @param {string[]} suspectedFoods 去重后的疑似食物
 * @param {string[]} symptoms 去重后的症状
 * @param {Date} date 发生日期（当天 0 点）
 * @param {string} recordId 新 allergy_record 的 _id
 */
async function updateAllergyAlerts(babyId, suspectedFoods, symptoms, date, recordId) {
  const now = db.serverDate();
  for (let i = 0; i < suspectedFoods.length; i++) {
    const foodName = suspectedFoods[i];
    try {
      const existRes = await allergyAlertsCol
        .where({ babyId: babyId, foodName: foodName })
        .limit(1)
        .get();
      const exist = existRes.data && existRes.data.length > 0 ? existRes.data[0] : null;
      if (!exist) {
        // 新增预警
        await allergyAlertsCol.add({
          data: {
            babyId: babyId,
            foodName: foodName,
            status: "suspected",
            firstOccurrence: date,
            lastOccurrence: date,
            recordIds: recordId ? [recordId] : [],
            symptomsSummary: symptoms.slice(),
            createdAt: now,
            updatedAt: now
          }
        });
      } else {
        // 合并更新：读后合并去重，避免并发/重复
        const mergedRecordIds = normalizeStringList(
          (Array.isArray(exist.recordIds) ? exist.recordIds : []).concat(recordId ? [recordId] : [])
        );
        const mergedSymptoms = normalizeStringList(
          (Array.isArray(exist.symptomsSummary) ? exist.symptomsSummary : []).concat(symptoms)
        );
        const patch = {
          lastOccurrence: date,
          recordIds: mergedRecordIds,
          symptomsSummary: mergedSymptoms,
          updatedAt: now
        };
        // 原为 cleared 又出现反应 → 重新置 suspected；其余状态保持不变
        if (exist.status === "cleared") {
          patch.status = "suspected";
        }
        await allergyAlertsCol.doc(exist._id).update({ data: patch });
      }
      // 同步 food_timeline 反应标记（独立 try/catch 在函数内）
      await markTimelineAllergy(babyId, foodName);
    } catch (e) {
      console.warn("[allergy] updateAllergyAlerts failed for", foodName, e && (e.errMsg || e));
    }
  }
}

/**
 * action=add 新增过敏记录，并自动聚合 allergy_alerts、标记关联餐次与时间线。
 * 入参 { babyId, mealRecordId(可空), date('YYYY-MM-DD'), symptoms[], suspectedFoods[], severity(可空), note(可空) }
 */
async function addRecord(event, OPENID) {
  const babyId = event.babyId;
  const access = await assertBabyAccess(babyId, OPENID);
  assertCanEdit(access);
  const symptoms = normalizeStringList(event.symptoms);
  if (symptoms.length === 0) {
    return fail("请至少选择一个症状");
  }
  const suspectedFoods = normalizeStringList(event.suspectedFoods);
  if (suspectedFoods.length === 0) {
    return fail("请至少选择一个疑似过敏原");
  }
  // date 缺省今天（东八区）
  let dayStart;
  if (event.date === undefined || event.date === "") {
    const nowStr = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
    dayStart = dayStartOf(nowStr);
  } else {
    dayStart = dayStartOf(event.date);
  }
  if (!dayStart) {
    return fail("date 格式应为 YYYY-MM-DD");
  }
  let severity = "";
  if (event.severity !== undefined && event.severity !== "" && event.severity !== null) {
    if (SEVERITIES.indexOf(event.severity) < 0) {
      return fail("severity 不合法");
    }
    severity = event.severity;
  }
  const mealRecordId = typeof event.mealRecordId === "string" ? event.mealRecordId : "";
  const now = db.serverDate();
  const doc = {
    babyId: babyId,
    mealRecordId: mealRecordId,
    date: dayStart,
    symptoms: symptoms,
    suspectedFoods: suspectedFoods,
    severity: severity,
    note: typeof event.note === "string" ? event.note.trim() : "",
    photos: [], // 预留
    recorderOpenid: OPENID,
    createdAt: now
  };
  const addRes = await allergyRecordsCol.add({ data: doc });
  const recordId = addRes._id;
  // 标记关联餐次（失败仅 warning）
  if (mealRecordId) {
    await flagMealRecord(mealRecordId);
  }
  // 自动聚合 allergy_alerts + 标记 food_timeline（失败仅 warning，不影响主流程）
  try {
    await updateAllergyAlerts(babyId, suspectedFoods, symptoms, dayStart, recordId);
  } catch (e) {
    console.warn("[allergy] alerts aggregation skipped:", e && (e.errMsg || e));
  }
  const fresh = await allergyRecordsCol.doc(recordId).get().catch(() => ({ data: null }));
  const record = fresh && fresh.data ? fresh.data : Object.assign({ _id: recordId }, doc);
  return ok(record);
}

/**
 * action=list 列出某宝贝的过敏记录（时间线）与过敏原汇总。
 * 入参 { babyId }
 * 返回 { records:[...按 date 倒序], alerts:[...该宝贝 allergy_alerts] }
 */
async function listRecords(event, OPENID) {
  const babyId = event.babyId;
  await assertBabyAccess(babyId, OPENID);
  const recRes = await allergyRecordsCol
    .where({ babyId: babyId })
    .orderBy("date", "desc")
    .orderBy("createdAt", "desc")
    .get();
  const records = recRes.data || [];
  const alertRes = await allergyAlertsCol
    .where({ babyId: babyId })
    .orderBy("updatedAt", "desc")
    .get();
  const alerts = alertRes.data || [];
  return ok({ records: records, alerts: alerts });
}

/**
 * action=get 读取单条过敏记录（供查看详情）。
 * 入参 { recordId }
 */
async function getRecord(event, OPENID) {
  const recordId = event.recordId;
  if (!recordId) {
    return fail("recordId 必填");
  }
  const res = await allergyRecordsCol.doc(recordId).get().catch(() => ({ data: null }));
  const record = res && res.data ? res.data : null;
  if (!record) {
    return fail("记录不存在");
  }
  await assertBabyAccess(record.babyId, OPENID);
  return ok(record);
}

/**
 * action=listAlerts 列出某宝贝的过敏预警（供全局加载过敏原名称）。
 * 入参 { babyId }
 * 返回 { alerts:[...] }
 */
async function listAlerts(event, OPENID) {
  const babyId = event.babyId;
  await assertBabyAccess(babyId, OPENID);
  const alertRes = await allergyAlertsCol
    .where({ babyId: babyId })
    .orderBy("updatedAt", "desc")
    .get();
  const alerts = alertRes.data || [];
  return ok({ alerts: alerts });
}

/**
 * action=updateAlertStatus 更新过敏预警状态（预留"确认/排除"）。
 * 入参 { alertId, status(suspected/confirmed/cleared) }
 */
async function updateAlertStatus(event, OPENID) {
  const alertId = event.alertId;
  if (!alertId) {
    return fail("alertId 必填");
  }
  if (ALERT_STATUSES.indexOf(event.status) < 0) {
    return fail("status 不合法");
  }
  const res = await allergyAlertsCol.doc(alertId).get().catch(() => ({ data: null }));
  const alert = res && res.data ? res.data : null;
  if (!alert) {
    return fail("预警不存在");
  }
  const access = await assertBabyAccess(alert.babyId, OPENID);
  assertCanEdit(access);
  await allergyAlertsCol.doc(alertId).update({
    data: { status: event.status, updatedAt: db.serverDate() }
  });
  const fresh = await allergyAlertsCol.doc(alertId).get().catch(() => ({ data: null }));
  const updated = fresh && fresh.data ? fresh.data : Object.assign({}, alert, { status: event.status });
  return ok(updated);
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
      case "add":
        return await addRecord(event, OPENID);
      case "list":
        return await listRecords(event, OPENID);
      case "get":
        return await getRecord(event, OPENID);
      case "listAlerts":
        return await listAlerts(event, OPENID);
      case "updateAlertStatus":
        return await updateAlertStatus(event, OPENID);
      default:
        return fail("未知 action: " + action);
    }
  } catch (err) {
    return fail((err && err.errMsg) || String(err));
  }
};
