// cloudfunctions/family/index.js
// 家庭共享云函数：邀请与成员管理。统一入口按 event.action 分发。
// 权限校验全部在云函数内完成（family_members / invitations 不走客户端直连）。
// 契约（docs/data-model.md）：
//   family_members: babyId, userOpenid, role, permissions('view'|'edit'), joinedAt(Date)
//   invitations: babyId, inviterOpenid, code, type('code'|'share'),
//                status('pending'|'used'|'expired'), expireAt(Date),
//                role, permissions, usedBy, createdAt(Date)
//   babies: ownerId(创建者openid) 等；users: _openid, nickName, avatarUrl
// 注意：云函数端 add 不自动带 _openid，归属用显式字段记录。
const cloud = require("wx-server-sdk");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const babiesCol = db.collection("babies");
const membersCol = db.collection("family_members");
const invitationsCol = db.collection("invitations");
const usersCol = db.collection("users");

// 与 baby 云函数一致的角色集合
const MEMBER_ROLES = [
  "mom",
  "dad",
  "grandpa_pat",
  "grandma_pat",
  "grandpa_mat",
  "grandma_mat",
  "other"
];
const PERMISSIONS = ["view", "edit"];

// 邀请码：大写字母+数字，排除易混字符 0 O 1 l I（同时排除小写 l）
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;
const INVITE_TTL_MS = 24 * 60 * 60 * 1000; // 24 小时

/** 成功响应 */
function ok(data) {
  return { success: true, data };
}
/** 失败响应 */
function fail(error) {
  return { success: false, error: String(error) };
}

/** 归一化 role，非法则返回默认值 */
function normalizeRole(value, fallback) {
  return MEMBER_ROLES.indexOf(value) >= 0 ? value : fallback;
}
/** 归一化 permissions，非法则返回默认值 */
function normalizePermissions(value, fallback) {
  return PERMISSIONS.indexOf(value) >= 0 ? value : fallback;
}

/** 生成一个随机 6 位邀请码 */
function genCode() {
  let s = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    s += CODE_ALPHABET.charAt(Math.floor(Math.random() * CODE_ALPHABET.length));
  }
  return s;
}

/** 把任意时间字段转为毫秒时间戳（兼容 Date / 字符串 / 时间戳） */
function toMillis(value) {
  if (!value) {
    return 0;
  }
  if (value instanceof Date) {
    return value.getTime();
  }
  const t = new Date(value).getTime();
  return isNaN(t) ? 0 : t;
}

/**
 * 查询某用户对某宝贝的访问权限（与 baby 云函数 resolveAccess 一致）。
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

/** 读取单个用户资料（昵称/头像），失败返回空对象 */
async function getUserProfiles(openids) {
  const unique = Array.from(new Set((openids || []).filter(Boolean)));
  const map = {};
  if (unique.length === 0) {
    return map;
  }
  const res = await usersCol
    .where({ _openid: _.in(unique) })
    .get()
    .catch(() => ({ data: [] }));
  (res.data || []).forEach((u) => {
    map[u._openid] = { nickName: u.nickName || "", avatarUrl: u.avatarUrl || "" };
  });
  return map;
}

/**
 * action=createInvite 生成邀请码（仅 owner 可邀请）
 * 入参 { babyId, role, permissions }
 */
async function createInvite(event, OPENID) {
  const babyId = event.babyId;
  if (!babyId) {
    return fail("babyId 必填");
  }
  const { baby, isOwner } = await resolveAccess(babyId, OPENID);
  if (!baby) {
    return fail("宝贝不存在");
  }
  if (!isOwner) {
    return fail("仅创建者可邀请成员");
  }
  const role = normalizeRole(event.role, "other");
  const permissions = normalizePermissions(event.permissions, "view");
  const now = Date.now();
  const expireMs = now + INVITE_TTL_MS;

  // 生成唯一邀请码：排除已存在且 pending 未过期的同码，冲突重试
  let code = "";
  let attempt = 0;
  const maxAttempts = 8;
  while (attempt < maxAttempts) {
    const candidate = genCode();
    const dupRes = await invitationsCol
      .where({ code: candidate, status: "pending" })
      .limit(1)
      .get();
    const dup = dupRes.data && dupRes.data.length > 0 ? dupRes.data[0] : null;
    // 同码仅在仍 pending 且未过期时视为冲突
    if (!dup || toMillis(dup.expireAt) < now) {
      code = candidate;
      break;
    }
    attempt++;
  }
  if (!code) {
    return fail("邀请码生成失败，请重试");
  }

  const doc = {
    babyId: babyId,
    inviterOpenid: OPENID,
    code: code,
    type: "code",
    status: "pending",
    expireAt: new Date(expireMs),
    role: role,
    permissions: permissions,
    usedBy: "",
    createdAt: db.serverDate()
  };
  await invitationsCol.add({ data: doc });
  return ok({ code: code, expireAt: expireMs, babyId: babyId });
}

/**
 * action=joinByCode 使用邀请码加入家庭
 * 入参 { code }
 */
async function joinByCode(event, OPENID) {
  const code = typeof event.code === "string" ? event.code.trim().toUpperCase() : "";
  if (!code) {
    return fail("请输入邀请码");
  }
  const invRes = await invitationsCol.where({ code: code }).limit(1).get();
  const invitation = invRes.data && invRes.data.length > 0 ? invRes.data[0] : null;
  if (!invitation) {
    return fail("邀请码无效");
  }
  if (invitation.status !== "pending") {
    return fail("邀请码已被使用");
  }
  if (toMillis(invitation.expireAt) < Date.now()) {
    await invitationsCol.doc(invitation._id).update({ data: { status: "expired" } });
    return fail("邀请码已过期");
  }

  const babyId = invitation.babyId;
  const babyRes = await babiesCol.doc(babyId).get().catch(() => ({ data: null }));
  const baby = babyRes && babyRes.data ? babyRes.data : null;
  if (!baby) {
    return fail("该宝贝不存在或已被删除");
  }
  // owner 本就是成员，不能加入自己创建的宝贝
  if (baby.ownerId === OPENID) {
    return fail("你已经是该宝贝的家庭成员");
  }
  // 已是成员
  const memRes = await membersCol
    .where({ babyId: babyId, userOpenid: OPENID })
    .limit(1)
    .get();
  if (memRes.data && memRes.data.length > 0) {
    return fail("你已经是该宝贝的家庭成员");
  }

  const role = normalizeRole(invitation.role, "other");
  const permissions = normalizePermissions(invitation.permissions, "view");
  await membersCol.add({
    data: {
      babyId: babyId,
      userOpenid: OPENID,
      role: role,
      permissions: permissions,
      joinedAt: db.serverDate()
    }
  });
  await invitationsCol.doc(invitation._id).update({
    data: { status: "used", usedBy: OPENID }
  });

  return ok({
    babyId: babyId,
    baby: {
      _id: baby._id,
      name: baby.name,
      avatarUrl: baby.avatarUrl || "",
      gender: baby.gender,
      birthday: baby.birthday
    },
    role: role,
    permissions: permissions
  });
}

/**
 * action=getInviteInfo 预览邀请详情（不改状态）
 * 入参 { code }
 */
async function getInviteInfo(event) {
  const code = typeof event.code === "string" ? event.code.trim().toUpperCase() : "";
  if (!code) {
    return fail("请输入邀请码");
  }
  const invRes = await invitationsCol.where({ code: code }).limit(1).get();
  const invitation = invRes.data && invRes.data.length > 0 ? invRes.data[0] : null;
  if (!invitation) {
    return fail("邀请码无效");
  }
  const expired = toMillis(invitation.expireAt) < Date.now();
  const valid = invitation.status === "pending" && !expired;
  let reason = "";
  if (invitation.status === "used") {
    reason = "邀请码已被使用";
  } else if (invitation.status === "expired" || expired) {
    reason = "邀请码已过期";
  }

  const babyRes = await babiesCol.doc(invitation.babyId).get().catch(() => ({ data: null }));
  const baby = babyRes && babyRes.data ? babyRes.data : null;
  const profiles = await getUserProfiles([invitation.inviterOpenid]);
  const inviter = profiles[invitation.inviterOpenid] || { nickName: "", avatarUrl: "" };

  return ok({
    valid: valid,
    reason: reason,
    code: code,
    babyId: invitation.babyId,
    babyName: baby ? baby.name : "",
    babyAvatarUrl: baby ? baby.avatarUrl || "" : "",
    inviterNickName: inviter.nickName,
    inviterAvatarUrl: inviter.avatarUrl,
    role: invitation.role || "other",
    permissions: invitation.permissions || "view",
    expireAt: toMillis(invitation.expireAt)
  });
}

/**
 * action=listMembers 列出宝贝家庭成员（需访问权）
 * 入参 { babyId }
 */
async function listMembers(event, OPENID) {
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
  const ownerOpenid = baby.ownerId;
  const memRes = await membersCol.where({ babyId: babyId }).get();
  const rows = memRes.data || [];
  const profiles = await getUserProfiles(rows.map((m) => m.userOpenid));
  // 保证 owner 排在最前，其余按加入时间升序
  rows.sort((a, b) => {
    const ao = a.userOpenid === ownerOpenid ? 0 : 1;
    const bo = b.userOpenid === ownerOpenid ? 0 : 1;
    if (ao !== bo) {
      return ao - bo;
    }
    return toMillis(a.joinedAt) - toMillis(b.joinedAt);
  });
  const members = rows.map((m) => {
    const p = profiles[m.userOpenid] || { nickName: "", avatarUrl: "" };
    return {
      _id: m._id,
      userOpenid: m.userOpenid,
      role: m.role,
      permissions: m.permissions,
      nickName: p.nickName,
      avatarUrl: p.avatarUrl,
      isOwner: m.userOpenid === ownerOpenid,
      isSelf: m.userOpenid === OPENID
    };
  });
  return ok({ members: members, ownerOpenid: ownerOpenid });
}

/**
 * 根据 memberId 或 memberOpenid 定位一条成员记录（限定该 babyId）
 * @returns {Promise<Object|null>}
 */
async function findMember(babyId, event) {
  if (event.memberId) {
    const res = await membersCol.doc(event.memberId).get().catch(() => ({ data: null }));
    const m = res && res.data ? res.data : null;
    return m && m.babyId === babyId ? m : null;
  }
  if (event.memberOpenid) {
    const res = await membersCol
      .where({ babyId: babyId, userOpenid: event.memberOpenid })
      .limit(1)
      .get();
    return res.data && res.data.length > 0 ? res.data[0] : null;
  }
  return null;
}

/**
 * action=removeMember 移除家庭成员（仅 owner，不能移除 owner 自己）
 * 入参 { babyId, memberId | memberOpenid }
 */
async function removeMember(event, OPENID) {
  const babyId = event.babyId;
  if (!babyId) {
    return fail("babyId 必填");
  }
  const { baby, isOwner } = await resolveAccess(babyId, OPENID);
  if (!baby) {
    return fail("宝贝不存在");
  }
  if (!isOwner) {
    return fail("仅创建者可移除成员");
  }
  const target = await findMember(babyId, event);
  if (!target) {
    return fail("成员不存在");
  }
  if (target.userOpenid === baby.ownerId) {
    return fail("不能移除创建者");
  }
  await membersCol.doc(target._id).remove();
  return ok({ babyId: babyId, memberId: target._id, removed: true });
}

/**
 * action=updateMemberRole 修改成员角色/权限（仅 owner）
 * 入参 { babyId, memberId | memberOpenid, role?, permissions? }
 */
async function updateMemberRole(event, OPENID) {
  const babyId = event.babyId;
  if (!babyId) {
    return fail("babyId 必填");
  }
  const { baby, isOwner } = await resolveAccess(babyId, OPENID);
  if (!baby) {
    return fail("宝贝不存在");
  }
  if (!isOwner) {
    return fail("仅创建者可修改成员");
  }
  const target = await findMember(babyId, event);
  if (!target) {
    return fail("成员不存在");
  }
  if (target.userOpenid === baby.ownerId) {
    return fail("不能修改创建者的角色");
  }
  const patch = {};
  if (event.role !== undefined) {
    if (MEMBER_ROLES.indexOf(event.role) < 0) {
      return fail("角色不合法");
    }
    patch.role = event.role;
  }
  if (event.permissions !== undefined) {
    if (PERMISSIONS.indexOf(event.permissions) < 0) {
      return fail("权限不合法");
    }
    patch.permissions = event.permissions;
  }
  if (Object.keys(patch).length === 0) {
    return fail("没有要更新的字段");
  }
  await membersCol.doc(target._id).update({ data: patch });
  return ok({ babyId: babyId, memberId: target._id, updated: true });
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
      case "createInvite":
        return await createInvite(event, OPENID);
      case "joinByCode":
        return await joinByCode(event, OPENID);
      case "getInviteInfo":
        return await getInviteInfo(event);
      case "listMembers":
        return await listMembers(event, OPENID);
      case "removeMember":
        return await removeMember(event, OPENID);
      case "updateMemberRole":
        return await updateMemberRole(event, OPENID);
      default:
        return fail("未知 action: " + action);
    }
  } catch (err) {
    return fail((err && err.errMsg) || String(err));
  }
};
