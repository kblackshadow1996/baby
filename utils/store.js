// utils/store.js —— 全局状态辅助：登录、宝贝列表与当前宝贝管理（CommonJS）
// 约定：切换宝贝后，各页面在 onShow 中重新读取 getApp().globalData.currentBaby。
const { callFunction } = require("./cloud.js");
const STORAGE_CURRENT_BABY_ID = "currentBabyId";
/**
 * 调用 login 云函数，返回标准化的 userInfo（含 openid）。
 * @returns {Promise<Object>} { openid, _openid, nickName, avatarUrl, ... }
 */
function login() {
  return callFunction("login", {}).then((res) => {
    if (!res || res.success !== true) {
      throw new Error((res && res.error) || "登录失败");
    }
    const user = res.user || {};
    return Object.assign({}, user, {
      openid: res.openid,
      isNew: res.isNew === true
    });
  });
}
/**
 * 从本地存储读取上次选中的宝贝 id
 * @returns {string} 为空时返回 ""
 */
function getStoredBabyId() {
  try {
    return wx.getStorageSync(STORAGE_CURRENT_BABY_ID) || "";
  } catch (e) {
    return "";
  }
}
/**
 * 持久化当前宝贝 id
 * @param {string} babyId
 */
function storeBabyId(babyId) {
  try {
    if (babyId) {
      wx.setStorageSync(STORAGE_CURRENT_BABY_ID, babyId);
    } else {
      wx.removeStorageSync(STORAGE_CURRENT_BABY_ID);
    }
  } catch (e) {
    // 忽略存储异常
  }
}
/**
 * 设置当前宝贝并同步到 globalData 与 storage。
 * 切换宝贝后清空旧过敏原缓存（allergyAlerts / allergyAlertMap），
 * 由调用方在合适时机调用 loadAllergyAlerts 重新加载新宝贝的过敏原。
 * @param {Object} globalData app.globalData
 * @param {Object|null} baby
 */
function setCurrentBaby(globalData, baby) {
  const prevId = globalData.currentBaby && globalData.currentBaby._id ? globalData.currentBaby._id : "";
  const nextId = baby && baby._id ? baby._id : "";
  globalData.currentBaby = baby || null;
  storeBabyId(nextId);
  // 宝贝发生变化（含置空）时清空过敏原缓存，避免跨宝贝误报
  if (prevId !== nextId) {
    globalData.allergyAlerts = [];
    globalData.allergyAlertMap = {};
  }
}
/**
 * 调用 baby list 云函数，写入 globalData.babyList；
 * 并根据 storage 中的 currentBabyId 恢复当前宝贝，
 * 若无有效当前宝贝且列表非空则默认选第一个并持久化。
 * @param {Object} globalData app.globalData
 * @returns {Promise<Array>} babyList
 */
function loadBabies(globalData) {
  return callFunction("baby", { action: "list" }).then((res) => {
    if (!res || res.success !== true) {
      throw new Error((res && res.error) || "加载宝贝列表失败");
    }
    const list = Array.isArray(res.data) ? res.data : [];
    globalData.babyList = list;
    if (list.length === 0) {
      setCurrentBaby(globalData, null);
      return list;
    }
    // 优先用 storage 中记录的 id 匹配
    const storedId = getStoredBabyId();
    let current = storedId ? list.find((b) => b._id === storedId) : null;
    // 其次保留内存中的当前宝贝（若仍在列表中）
    if (!current && globalData.currentBaby) {
      current = list.find((b) => b._id === globalData.currentBaby._id);
    }
    // 默认选第一个
    if (!current) {
      current = list[0];
    }
    setCurrentBaby(globalData, current);
    return list;
  });
}
/**
 * 加载当前宝贝的过敏原到 globalData。
 * - 调用 allergy listAlerts（用 globalData.currentBaby._id）；
 * - 把 alerts 的 foodName 数组写入 globalData.allergyAlerts；
 * - 同时写 globalData.allergyAlertMap（{ foodName: { status, symptomsSummary[] } }），
 *   供添加餐次提醒展示"上次反应"。
 * 无当前宝贝则置空数组/空映射。失败返回已有/空数组，不抛错（提醒为增强功能，不应阻断主流程）。
 * @param {Object} globalData app.globalData
 * @returns {Promise<string[]>} 过敏原名称数组
 */
function loadAllergyAlerts(globalData) {
  const baby = globalData && globalData.currentBaby;
  if (!baby || !baby._id) {
    globalData.allergyAlerts = [];
    globalData.allergyAlertMap = {};
    return Promise.resolve([]);
  }
  const babyId = baby._id;
  return callFunction("allergy", { action: "listAlerts", babyId: babyId })
    .then((res) => {
      // 竞态保护：返回时当前宝贝若已切换，丢弃本次结果
      const stillCurrent = globalData.currentBaby && globalData.currentBaby._id === babyId;
      if (!stillCurrent) {
        return Array.isArray(globalData.allergyAlerts) ? globalData.allergyAlerts : [];
      }
      if (!res || res.success !== true || !res.data || !Array.isArray(res.data.alerts)) {
        globalData.allergyAlerts = [];
        globalData.allergyAlertMap = {};
        return [];
      }
      const names = [];
      const map = {};
      res.data.alerts.forEach((a) => {
        const foodName = a && typeof a.foodName === "string" ? a.foodName.trim() : "";
        if (!foodName) {
          return;
        }
        if (names.indexOf(foodName) === -1) {
          names.push(foodName);
        }
        map[foodName] = {
          status: a.status || "suspected",
          symptomsSummary: Array.isArray(a.symptomsSummary) ? a.symptomsSummary.slice() : []
        };
      });
      globalData.allergyAlerts = names;
      globalData.allergyAlertMap = map;
      return names;
    })
    .catch((err) => {
      console.warn("[store] loadAllergyAlerts failed:", err && (err.errMsg || err.message || err));
      return Array.isArray(globalData.allergyAlerts) ? globalData.allergyAlerts : [];
    });
}
module.exports = {
  STORAGE_CURRENT_BABY_ID,
  login,
  loadBabies,
  setCurrentBaby,
  loadAllergyAlerts,
  getStoredBabyId,
  storeBabyId
};
