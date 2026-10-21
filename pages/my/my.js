// pages/my/my.js —— 个人中心（Task 17）
const {
  calcAgeText,
  calcMonthAge,
  getStageByMonth
} = require("../../utils/date.js");
const { callFunction } = require("../../utils/cloud.js");
const app = getApp();

/**
 * 辅食阶段 emoji 映射（对齐 utils/date.js STAGES 的 stage.key）
 */
const STAGE_EMOJI = {
  milk: "🍼",
  swallow: "🥣",
  chew: "🥄",
  mince: "🍲",
  bite: "🍚",
  toddlerA: "🍱",
  toddlerB: "🍱",
  toddlerC: "🍱"
};

/**
 * 辅食知识小贴士常量：按阶段 key 提供一条该阶段的小知识文案。
 * key 对齐 utils/date.js STAGES 的 stage.key。
 */
const TIPS = {
  milk: "纯奶期以母乳/配方奶为主，满 6 月龄（约 180 天）且能稳定坐立、对食物感兴趣时再引入辅食。",
  swallow: "第一口辅食推荐高铁米粉，用母乳或配方奶冲调成稀泥糊。每引入一种新食物，连续观察 3 天再加下一种。",
  chew: "可尝试蛋黄、肉泥、肝泥补铁。质地从稀泥糊逐步过渡到稠糊，用小勺少量多次喂。",
  mince: "引入碎末与小块，鼓励抓握“手指食物”锻炼咀嚼与手眼协调。继续坚持少盐少糖、原味为主。",
  bite: "过渡到小块软食，接近家庭饮食。每天 3 顿辅食 + 奶，注意食物多样、荤素搭配。",
  toddlerA: "三餐规律化，可与家人同桌进食。注意补充铁、钙、维生素 D，少吃零食与含糖饮料。",
  toddlerB: "饮食基本同成人，但仍要清淡少调味。培养自主进食，固定进餐时间与座位。",
  toddlerC: "均衡饮食、细嚼慢咽，培养独立吃饭的好习惯。警惕坚果、果冻等易呛噎食物整颗喂食。"
};

/**
 * 功能入口列表（cell）。kind=modal 的项走弹层，其余 navigateTo url。
 */
const ENTRIES = [
  { key: "babyMgr", icon: "🍼", label: "宝贝管理", url: "/pages/baby/manage/manage" },
  { key: "family", icon: "👨‍👩‍👧", label: "家庭成员", url: "/pages/family/members/members" },
  { key: "export", icon: "📤", label: "数据导出", url: "/pages/export/export" },
  { key: "growth", icon: "📈", label: "成长曲线", url: "/pages/growth/growth" },
  { key: "timeline", icon: "🕒", label: "辅食时间线", url: "/pages/timeline/timeline" },
  { key: "about", icon: "💗", label: "关于我们", kind: "modal" }
];

/** 关于我们弹层文案：含食谱来源声明 */
const ABOUT = {
  appName: "小饭团成长记",
  slogan: "陪伴宝宝的每一餐成长",
  intro:
    "小饭团成长记是一款专为 0-3 岁宝宝家庭打造的辅食与成长记录小程序，帮助爸爸妈妈科学添加辅食、记录每日用餐、观察过敏反应、追踪成长曲线。",
  recipeSource:
    "食谱来源说明：本程序内的官方食谱参考自《中国居民膳食指南》《婴幼儿喂养与营养指南》等权威资料整理编写，食材与月龄建议仅供参考，所标注页码为参考出处。每个宝宝体质不同，请结合实际情况并在必要时咨询儿科或营养专业人士。"
};

Page({
  data: {
    ready: false,
    // 用户卡
    avatarUrl: "",
    nickName: "",
    hasUserInfo: false,
    // 当前宝贝卡
    hasBaby: false,
    babyName: "",
    babyAvatar: "",
    babyEmoji: "🍚",
    ageText: "",
    month: 0,
    // 知识贴士卡
    stageName: "",
    stageTip: "",
    stageEmoji: "🍚",
    knowledgeTip: "",
    // 功能入口
    entries: ENTRIES,
    // 完善资料弹层
    profileModal: false,
    formAvatar: "",
    formNickName: "",
    saving: false,
    // 关于我们弹层
    aboutModal: false,
    about: ABOUT
  },

  onShow() {
    this.refresh();
  },

  /**
   * 登录就绪 → 加载宝贝 → 渲染
   */
  async refresh() {
    try {
      await app.ensureLogin();
      await app.loadBabies();
    } catch (e) {
      // callFunction 已统一 toast
    }
    this.render();
  },

  /**
   * 从 globalData 渲染用户卡、宝贝卡、知识贴士卡
   */
  render() {
    const user = app.globalData.userInfo || {};
    const current = app.globalData.currentBaby;
    const data = {
      ready: true,
      avatarUrl: user.avatarUrl || "",
      nickName: user.nickName || "",
      hasUserInfo: !!(user.avatarUrl || user.nickName)
    };
    if (current) {
      const month = current.birthday ? calcMonthAge(current.birthday) : 0;
      const stage = getStageByMonth(month);
      data.hasBaby = true;
      data.babyName = current.name || "";
      data.babyAvatar = current.avatarUrl || "";
      data.babyEmoji = STAGE_EMOJI[stage.key] || "🍚";
      data.ageText = current.birthday ? calcAgeText(current.birthday) : "";
      data.month = month;
      data.stageName = stage.name;
      data.stageTip = stage.tip;
      data.stageEmoji = STAGE_EMOJI[stage.key] || "🍚";
      data.knowledgeTip = TIPS[stage.key] || "";
    } else {
      data.hasBaby = false;
      data.babyName = "";
      data.babyAvatar = "";
      data.ageText = "";
      data.month = 0;
      data.stageName = "";
      data.stageTip = "";
      data.knowledgeTip = "";
    }
    this.setData(data);
  },

  /* ===== 完善资料弹层 ===== */

  /** 打开完善资料弹层，预填当前资料 */
  onOpenProfileModal() {
    const user = app.globalData.userInfo || {};
    this.setData({
      profileModal: true,
      formAvatar: user.avatarUrl || "",
      formNickName: user.nickName || ""
    });
  },

  /** 关闭完善资料弹层 */
  onCloseProfileModal() {
    if (this.data.saving) {
      return;
    }
    this.setData({ profileModal: false });
  },

  /** 阻止弹层内容区点击冒泡到遮罩 */
  noop() {},

  /** chooseAvatar 回调：拿到临时头像路径 */
  onChooseAvatar(e) {
    const avatarUrl = e.detail && e.detail.avatarUrl ? e.detail.avatarUrl : "";
    if (avatarUrl) {
      this.setData({ formAvatar: avatarUrl });
    }
  },

  /** 昵称 input（type=nickname）输入 */
  onNickInput(e) {
    this.setData({ formNickName: (e.detail && e.detail.value) || "" });
  },

  /**
   * 保存资料：调 login 云函数更新 nickName/avatarUrl，刷新 globalData.userInfo。
   * 说明：头像为本地临时路径，示例项目中直接作为 avatarUrl 保存；
   * 生产环境可先 wx.cloud.uploadFile 上传再存 fileID。
   */
  async onSaveProfile() {
    if (this.data.saving) {
      return;
    }
    const nickName = (this.data.formNickName || "").trim();
    const avatarUrl = this.data.formAvatar || "";
    if (!nickName) {
      wx.showToast({ title: "请填写昵称", icon: "none" });
      return;
    }
    this.setData({ saving: true });
    try {
      const res = await callFunction("login", { nickName, avatarUrl });
      if (!res || res.success !== true) {
        throw new Error((res && res.error) || "保存失败");
      }
      const user = res.user || {};
      app.globalData.userInfo = Object.assign({}, user, {
        openid: res.openid || (app.globalData.userInfo && app.globalData.userInfo.openid)
      });
      this.setData({ saving: false, profileModal: false });
      wx.showToast({ title: "已保存", icon: "success" });
      this.render();
    } catch (e) {
      this.setData({ saving: false });
      // callFunction 已对网络异常 toast；此处兜底
      wx.showToast({ title: "保存失败，请重试", icon: "none" });
    }
  },

  /* ===== 当前宝贝卡 ===== */

  /** 进入宝贝管理（切换/管理） */
  onManageBaby() {
    wx.navigateTo({ url: "/pages/baby/manage/manage" });
  },

  /** 无宝贝引导 → 新增宝贝 */
  onAddBaby() {
    wx.navigateTo({ url: "/pages/baby/profile/profile" });
  },

  /* ===== 功能入口 ===== */

  /** 点击功能入口 cell */
  onTapEntry(e) {
    const kind = e.currentTarget.dataset.kind;
    const url = e.currentTarget.dataset.url;
    if (kind === "modal") {
      this.setData({ aboutModal: true });
      return;
    }
    if (url) {
      wx.navigateTo({ url });
    }
  },

  /** 关闭关于我们弹层 */
  onCloseAbout() {
    this.setData({ aboutModal: false });
  }
});
