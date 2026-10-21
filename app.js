// app.js
const store = require("./utils/store.js");
App({
  onLaunch() {
    if (wx.cloud) {
      wx.cloud.init({
        env: "REPLACE_WITH_YOUR_ENV_ID",
        traceUser: true
      });
    } else {
      console.warn("当前基础库不支持云开发，请使用 2.2.3 及以上的基础库");
    }
    // 启动即发起登录；页面可 await app.ensureLogin()
    this.userReady = this.ensureLogin();
  },
  globalData: {
    userInfo: null,
    currentBaby: null,
    babyList: [],
    // 当前宝贝过敏原名称数组（供食谱页/添加餐次模糊匹配，Task 11）
    allergyAlerts: [],
    // 过敏原详情映射 { foodName: { status, symptomsSummary[] } }，供添加餐次提醒展示"上次反应"
    allergyAlertMap: {}
  },
  /** 登录就绪 Promise（onLaunch 中赋值），供页面 await */
  userReady: null,
  /**
   * 确保已登录：调用 login 云函数，把 user + openid 写入 globalData.userInfo。
   * 重复调用返回同一个进行中的 Promise，避免并发重复登录。
   * @returns {Promise<Object|null>} userInfo（含 openid）
   */
  ensureLogin() {
    if (this.globalData.userInfo && this.globalData.userInfo.openid) {
      return Promise.resolve(this.globalData.userInfo);
    }
    if (this._loginPromise) {
      return this._loginPromise;
    }
    this._loginPromise = store
      .login()
      .then((userInfo) => {
        this.globalData.userInfo = userInfo;
        return userInfo;
      })
      .catch((err) => {
        console.error("[app] ensureLogin failed:", err);
        this._loginPromise = null;
        return null;
      });
    return this._loginPromise;
  },
  /**
   * 加载当前用户可见的宝贝列表到 globalData.babyList，并恢复/默认 currentBaby。
   * 成功且存在 currentBaby 后自动加载一次其过敏原（供首页/食谱页读取）。
   * @returns {Promise<Array>} babyList
   */
  loadBabies() {
    return store.loadBabies(this.globalData).then((list) => {
      if (this.globalData.currentBaby && this.globalData.currentBaby._id) {
        // 过敏原加载为增强功能，失败不影响宝贝列表返回
        this.loadAllergyAlerts();
      }
      return list;
    });
  },
  /**
   * 加载当前宝贝的过敏原到 globalData.allergyAlerts / allergyAlertMap。
   * 供页面 onShow 在全局为空时触发；返回过敏原名称数组。
   * @returns {Promise<string[]>}
   */
  loadAllergyAlerts() {
    return store.loadAllergyAlerts(this.globalData);
  },
  /**
   * 设置当前宝贝并持久化到 storage（切换时 store 内部会清空旧过敏原缓存）。
   * @param {Object} baby 宝贝对象
   */
  setCurrentBaby(baby) {
    store.setCurrentBaby(this.globalData, baby);
  },
  /**
   * 获取当前宝贝
   * @returns {Object|null}
   */
  getCurrentBaby() {
    return this.globalData.currentBaby;
  }
});
