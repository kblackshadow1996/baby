// utils/cloud.js —— 云开发调用封装

/**
 * 所有云数据库集合名
 */
const collection = {
  users: "users",
  babies: "babies",
  family_members: "family_members",
  invitations: "invitations",
  recipes: "recipes",
  meal_records: "meal_records",
  allergy_records: "allergy_records",
  allergy_alerts: "allergy_alerts",
  growth_records: "growth_records",
  food_timeline: "food_timeline"
};

/**
 * 调用云函数，统一 try/catch 和错误 toast
 * @param {string} name 云函数名
 * @param {Object} data 入参
 * @returns {Promise<any>} 云函数返回的 result
 */
function callFunction(name, data = {}) {
  return new Promise((resolve, reject) => {
    if (!wx.cloud) {
      wx.showToast({ title: "云开发未初始化", icon: "none" });
      reject(new Error("wx.cloud is not available"));
      return;
    }
    wx.cloud
      .callFunction({ name, data })
      .then((res) => {
        resolve(res.result);
      })
      .catch((err) => {
        console.error(`[cloud] callFunction "${name}" failed:`, err);
        wx.showToast({ title: "网络异常，请稍后重试", icon: "none" });
        reject(err);
      });
  });
}

/**
 * 获取云数据库实例
 * @returns {Object} wx.cloud.database()
 */
function db() {
  if (!wx.cloud) {
    throw new Error("wx.cloud is not available");
  }
  return wx.cloud.database();
}

module.exports = {
  callFunction,
  db,
  collection
};
