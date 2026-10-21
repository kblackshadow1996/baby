// cloudfunctions/login/index.js
// 用户登录云函数：根据微信上下文 openid 查询/创建 users 记录。
// 契约（docs/data-model.md · users）：
//   _openid, nickName, avatarUrl, createdAt(Date), updatedAt(Date)
// 注意：云函数端 add 的文档不会自动带 _openid，需显式写入 _openid:OPENID。
const cloud = require("wx-server-sdk");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const usersCol = db.collection("users");

/**
 * 云函数入口。
 * 入参 event 可选携带 { nickName, avatarUrl } 微信用户信息。
 * @param {Object} event
 * @returns {Promise<{success:boolean, openid?:string, user?:Object, isNew?:boolean, error?:string}>}
 */
exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) {
    return { success: false, error: "无法获取用户身份（OPENID 为空）" };
  }

  const nickName = typeof event.nickName === "string" ? event.nickName : undefined;
  const avatarUrl = typeof event.avatarUrl === "string" ? event.avatarUrl : undefined;

  try {
    const existRes = await usersCol.where({ _openid: OPENID }).limit(1).get();
    const now = db.serverDate();

    // 已存在用户
    if (existRes.data && existRes.data.length > 0) {
      const existing = existRes.data[0];

      // 若 event 携带了昵称/头像则更新并刷新 updatedAt
      const patch = { updatedAt: now };
      let changed = false;
      if (nickName !== undefined && nickName !== existing.nickName) {
        patch.nickName = nickName;
        changed = true;
      }
      if (avatarUrl !== undefined && avatarUrl !== existing.avatarUrl) {
        patch.avatarUrl = avatarUrl;
        changed = true;
      }

      if (changed) {
        await usersCol.doc(existing._id).update({ data: patch });
      }

      const user = Object.assign({}, existing, changed ? patch : { updatedAt: existing.updatedAt });
      // serverDate 占位无法直接回传真实值，统一回读以保证返回真实数据
      const fresh = await usersCol.doc(existing._id).get();
      return {
        success: true,
        openid: OPENID,
        user: fresh.data || user,
        isNew: false
      };
    }

    // 新用户：显式写入 _openid
    const doc = {
      _openid: OPENID,
      nickName: nickName || "",
      avatarUrl: avatarUrl || "",
      createdAt: now,
      updatedAt: now
    };
    const addRes = await usersCol.add({ data: doc });
    const fresh = await usersCol.doc(addRes._id).get();

    return {
      success: true,
      openid: OPENID,
      user: fresh.data || Object.assign({ _id: addRes._id }, doc),
      isNew: true
    };
  } catch (err) {
    return {
      success: false,
      error: (err && err.errMsg) || String(err)
    };
  }
};
