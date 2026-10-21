// cloudfunctions/baby/index.js
// 宝贝管理云函数：统一入口按 event.action 分发 list / get / add / update / delete。
// 权限校验全部在云函数内完成（家庭共享集合不走客户端直连）。
// 契约（docs/data-model.md）：
//   babies: name, gender(0/1/2), birthday(Date), avatarUrl, ownerId(创建者openid),
//           createdAt(Date), updatedAt(Date)
//   family_members: babyId, userOpenid, role, permissions('view'|'edit'), joinedAt(Date)
// 注意：云函数端 add 不自动带 _openid，归属用显式 ownerId=OPENID。
const cloud = require("wx-server-sdk");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const babiesCol = db.collection("babies");
const membersCol = db.collection("family_members");

const MEMBER_ROLES = [
  "mom",
  "dad",
  "grandpa_pat",
  "grandma_pat",
  "grandpa_mat",
  "grandma_mat",
  "other"
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
 * 将入参 birthday 规范化为 Date（支持 Date / 时间戳 / "YYYY-MM-DD" 字符串）
 * @param {*} value
 * @returns {Date|null}
 */
function toBirthdayDate(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "number") {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === "string") {
    const parts = value.split(/[-/]/).map((n) => parseInt(n, 10));
    if (parts.length >= 3 && !parts.some(isNaN)) {
      const d = new Date(parts[0], parts[1] - 1, parts[2]);
      return isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/**
 * 归一化 gender 为 0/1/2，默认 0
 */
function normalizeGender(value) {
  const g = Number(value);
  return g === 1 || g === 2 ? g : 0;
}

/**
 * 查询某用户对某宝贝的访问权限。
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
 * action=add 新增宝贝 + 创建者家庭成员记录
 */
async function addBaby(event, OPENID) {
  const name = typeof event.name === "string" ? event.name.trim() : "";
  const birthday = toBirthdayDate(event.birthday);
  if (!name) {
    return fail("宝贝名字必填");
  }
  if (!birthday) {
    return fail("宝贝生日必填且格式有误");
  }
  const now = db.serverDate();
  const doc = {
    name: name,
    gender: normalizeGender(event.gender),
    birthday: birthday,
    avatarUrl: typeof event.avatarUrl === "string" ? event.avatarUrl : "",
    ownerId: OPENID,
    createdAt: now,
    updatedAt: now
  };
  const addRes = await babiesCol.add({ data: doc });
  const babyId = addRes._id;

  // 创建者自己写入一条家庭成员记录（默认 mom，前端可传 role）
  const role = MEMBER_ROLES.indexOf(event.role) >= 0 ? event.role : "mom";
  await membersCol.add({
    data: {
      babyId: babyId,
      userOpenid: OPENID,
      role: role,
      permissions: "edit",
      joinedAt: now
    }
  });

  const fresh = await babiesCol.doc(babyId).get();
  return ok(fresh.data || Object.assign({ _id: babyId }, doc));
}

/**
 * action=list 当前用户可见的全部宝贝（owner ∪ family_members 加入）
 */
async function listBabies(OPENID) {
  // 自己创建的
  const ownRes = await babiesCol
    .where({ ownerId: OPENID })
    .orderBy("createdAt", "asc")
    .get();
  const map = {};
  (ownRes.data || []).forEach((b) => {
    map[b._id] = b;
  });

  // 作为家庭成员加入的 babyId 列表
  const memRes = await membersCol.where({ userOpenid: OPENID }).get();
  const memberBabyIds = Array.from(
    new Set((memRes.data || []).map((m) => m.babyId).filter((id) => id && !map[id]))
  );

  if (memberBabyIds.length > 0) {
    // doc id 批量查询
    const joinedRes = await babiesCol
      .where({ _id: _.in(memberBabyIds) })
      .get();
    (joinedRes.data || []).forEach((b) => {
      map[b._id] = b;
    });
  }

  const list = Object.keys(map).map((k) => map[k]);
  // 按 createdAt 升序；serverDate 存储为 Date，直接比较
  list.sort((a, b) => {
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return ta - tb;
  });
  return ok(list);
}

/**
 * action=get 读取单个宝贝（需访问权）
 */
async function getBaby(event, OPENID) {
  const babyId = event.babyId;
  if (!babyId) {
    return fail("babyId 必填");
  }
  const { baby, isOwner, member } = await resolveAccess(babyId, OPENID);
  if (!baby) {
    return fail("宝贝不存在");
  }
  if (!isOwner && !member) {
    return fail("无权访问该宝贝");
  }
  return ok(baby);
}

/**
 * action=update 更新宝贝字段（owner 或 permissions==edit 的成员）
 */
async function updateBaby(event, OPENID) {
  const babyId = event.babyId;
  if (!babyId) {
    return fail("babyId 必填");
  }
  const { baby, isOwner, member } = await resolveAccess(babyId, OPENID);
  if (!baby) {
    return fail("宝贝不存在");
  }
  const canEdit = isOwner || (member && member.permissions === "edit");
  if (!canEdit) {
    return fail("无权编辑该宝贝");
  }

  const patch = { updatedAt: db.serverDate() };
  if (typeof event.name === "string") {
    const n = event.name.trim();
    if (!n) {
      return fail("宝贝名字不能为空");
    }
    patch.name = n;
  }
  if (event.gender !== undefined) {
    patch.gender = normalizeGender(event.gender);
  }
  if (event.birthday !== undefined) {
    const bd = toBirthdayDate(event.birthday);
    if (!bd) {
      return fail("生日格式有误");
    }
    patch.birthday = bd;
  }
  if (typeof event.avatarUrl === "string") {
    patch.avatarUrl = event.avatarUrl;
  }

  await babiesCol.doc(babyId).update({ data: patch });
  const fresh = await babiesCol.doc(babyId).get();
  return ok(fresh.data);
}

/**
 * action=delete 删除宝贝（仅 owner）并级联删除其 family_members
 */
async function deleteBaby(event, OPENID) {
  const babyId = event.babyId;
  if (!babyId) {
    return fail("babyId 必填");
  }
  const babyRes = await babiesCol.doc(babyId).get().catch(() => ({ data: null }));
  const baby = babyRes && babyRes.data ? babyRes.data : null;
  if (!baby) {
    return fail("宝贝不存在");
  }
  if (baby.ownerId !== OPENID) {
    return fail("仅创建者可删除该宝贝");
  }

  // 级联删除家庭成员记录（其它集合的级联留到后续 Task）
  await membersCol.where({ babyId: babyId }).remove();
  await babiesCol.doc(babyId).remove();
  return ok({ babyId: babyId, deleted: true });
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
        return await addBaby(event, OPENID);
      case "list":
        return await listBabies(OPENID);
      case "get":
        return await getBaby(event, OPENID);
      case "update":
        return await updateBaby(event, OPENID);
      case "delete":
        return await deleteBaby(event, OPENID);
      default:
        return fail("未知 action: " + action);
    }
  } catch (err) {
    return fail((err && err.errMsg) || String(err));
  }
};
