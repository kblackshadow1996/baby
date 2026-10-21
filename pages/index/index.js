// pages/index/index.js —— 首页（Task 4 结构 + Task 17 真实数据接入）
const {
  calcAgeText,
  calcMonthAge,
  getStageByMonth,
  formatDate
} = require("../../utils/date.js");
const { callFunction } = require("../../utils/cloud.js");
const app = getApp();
/**
 * 辅食阶段 emoji 映射（按 utils/date.js STAGES 的 stage.key）
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
 * 性别图标映射（gender: 0 未知 / 1 男 / 2 女），未知不显示
 */
const GENDER_ICON = {
  1: "♂",
  2: "♀"
};
/**
 * 常显餐别兜底定义（当天无记录时展示“未记录 去记录+”）。
 * mealType 对齐 docs/data-model.md meal_records.mealType。
 */
const BASE_SLOTS = [
  { mealType: "breakfast", name: "早餐", icon: "🌅" },
  { mealType: "lunch", name: "午餐", icon: "☀" },
  { mealType: "dinner", name: "晚餐", icon: "🌙" }
];
/**
 * 餐别展示名与图标映射（含加餐/夜奶/自定义）
 */
const MEAL_META = {
  breakfast: { name: "早餐", icon: "🌅" },
  lunch: { name: "午餐", icon: "☀" },
  dinner: { name: "晚餐", icon: "🌙" },
  snack_am: { name: "上午加餐", icon: "🍎" },
  snack_pm: { name: "下午加餐", icon: "🍎" },
  night: { name: "夜奶", icon: "🌛" },
  custom: { name: "加餐", icon: "🍽" }
};
/** 展示顺序权重 */
const MEAL_ORDER = {
  breakfast: 1,
  snack_am: 2,
  lunch: 3,
  snack_pm: 4,
  dinner: 5,
  night: 6,
  custom: 7
};
/**
 * 快捷功能入口（彩色网格）
 */
const QUICK_ENTRIES = [
  { key: "recipe", icon: "🍲", label: "食谱库", url: "/pages/recipe/list/list", tone: "green" },
  { key: "record", icon: "📝", label: "添加记录", url: "/pages/record/add/add", tone: "pink" },
  { key: "allergy", icon: "⚠", label: "过敏观察", url: "/pages/allergy/list/list", tone: "warning" },
  { key: "growth", icon: "📈", label: "成长曲线", url: "/pages/growth/growth", tone: "blue" },
  { key: "timeline", icon: "🕒", label: "辅食时间线", url: "/pages/timeline/timeline", tone: "yellow" },
  { key: "family", icon: "👨👩👧", label: "家庭成员", url: "/pages/family/members/members", tone: "pink" },
  { key: "export", icon: "📤", label: "数据导出", url: "/pages/export/export", tone: "blue" },
  { key: "babyMgr", icon: "🍼", label: "宝贝管理", url: "/pages/baby/manage/manage", tone: "green" }
];
Page({
  data: {
    ready: false,
    hasBaby: false,
    // 宝贝信息区
    babyName: "",
    avatarUrl: "",
    genderIcon: "",
    ageText: "",
    month: 0,
    // 月龄阶段卡
    stageName: "",
    stageRange: "",
    stageTip: "",
    stageEmoji: "🍚",
    // 今日摘要卡
    todayDate: "",
    isMilkStage: false,
    mealsLoading: false,
    mealSummarySlots: [],
    hasMealRecords: false,
    // 推荐食谱区
    recipesLoading: false,
    recommendRecipes: [],
    // 过敏提醒卡
    allergyTip: null,
    // 快捷入口
    quickEntries: QUICK_ENTRIES
  },
  onShow() {
    this.refresh();
  },
  /**
   * 统一刷新：ensureLogin → loadBabies → loadAllergyAlerts → render（宝贝信息）
   * → 并行加载今日餐次与推荐食谱。
   */
  async refresh() {
    try {
      await app.ensureLogin();
      await app.loadBabies();
      // loadBabies 内部在有当前宝贝时会触发 loadAllergyAlerts；此处再确保一次
      await app.loadAllergyAlerts();
    } catch (e) {
      // callFunction 已统一 toast
    }
    this.render();
    // 异步加载真实数据（不阻塞基础信息渲染）
    this.loadTodayMeals();
    this.loadRecommendRecipes();
  },
  /**
   * 从 globalData.currentBaby 计算并一次性 setData 基础信息与过敏提醒
   */
  render() {
    const current = app.globalData.currentBaby;
    const todayDate = formatDate(new Date(), "MM月DD日");
    if (!current) {
      this.setData({
        ready: true,
        hasBaby: false,
        babyName: "",
        avatarUrl: "",
        genderIcon: "",
        ageText: "",
        month: 0,
        stageName: "",
        stageRange: "",
        stageTip: "",
        stageEmoji: "🍚",
        todayDate,
        isMilkStage: false,
        mealSummarySlots: [],
        hasMealRecords: false,
        recommendRecipes: [],
        allergyTip: null
      });
      return;
    }
    const month = current.birthday ? calcMonthAge(current.birthday) : 0;
    const ageText = current.birthday ? calcAgeText(current.birthday) : "";
    const stage = getStageByMonth(month);
    const stageEmoji = STAGE_EMOJI[stage.key] || "🍚";
    const genderIcon = GENDER_ICON[current.gender] || "";
    this.setData({
      ready: true,
      hasBaby: true,
      babyName: current.name || "",
      avatarUrl: current.avatarUrl || "",
      genderIcon,
      ageText,
      month,
      stageName: stage.name,
      stageRange: stage.range,
      stageTip: stage.tip,
      stageEmoji,
      todayDate,
      // 纯奶期（<6 月）隐藏餐次，展示温馨提示
      isMilkStage: month < 6,
      allergyTip: this.buildAllergyTip(current)
    });
  },
  /**
   * 构造过敏提醒卡数据：读取 globalData.allergyAlerts。
   * @param {Object} baby 当前宝贝
   * @returns {{count:number, names:string, babyName:string}|null}
   */
  buildAllergyTip(baby) {
    const alerts = app.globalData.allergyAlerts;
    if (!Array.isArray(alerts) || alerts.length === 0) {
      return null;
    }
    const shown = alerts.slice(0, 3);
    let names = shown.join("、");
    if (alerts.length > shown.length) {
      names += " 等";
    }
    return {
      count: alerts.length,
      names,
      babyName: (baby && baby.name) || "宝宝"
    };
  },
  /**
   * 加载今日餐次：有当前宝贝且非纯奶期时调 meal listByDate。
   * 用真实记录 + 常显餐别兜底构造 mealSummarySlots：
   * - 命中记录：status=recorded，显示食物数量；
   * - 常显餐别（早/午/晚）无记录：status=empty，显示“未记录 去记录+”；
   * - 加餐等非常显餐别仅在有记录时出现。
   */
  loadTodayMeals() {
    const current = app.globalData.currentBaby;
    const month = this.data.month;
    if (!current || !current._id || month < 6) {
      this.setData({ mealSummarySlots: [], hasMealRecords: false, mealsLoading: false });
      return;
    }
    const babyId = current._id;
    const date = formatDate(new Date(), "YYYY-MM-DD");
    this.setData({ mealsLoading: true });
    callFunction("meal", { action: "listByDate", babyId, date })
      .then((res) => {
        // 竞态保护：返回时当前宝贝若已切换，丢弃
        const stillCurrent = app.globalData.currentBaby && app.globalData.currentBaby._id === babyId;
        if (!stillCurrent) {
          return;
        }
        const records = res && res.success === true && res.data && Array.isArray(res.data.records)
          ? res.data.records
          : [];
        this.setData({
          mealSummarySlots: this.buildMealSummary(records),
          hasMealRecords: records.length > 0,
          mealsLoading: false
        });
      })
      .catch(() => {
        this.setData({ mealSummarySlots: this.buildMealSummary([]), hasMealRecords: false, mealsLoading: false });
      });
  },
  /**
   * 把今日记录与常显餐别合并为展示用 slots。
   * @param {Array} records meal_records 数组
   * @returns {Array} [{ mealType, name, icon, status, foodCount, foodsText }]
   */
  buildMealSummary(records) {
    // 按餐别聚合记录
    const byType = {};
    records.forEach((r) => {
      const type = r && r.mealType ? r.mealType : "custom";
      if (!byType[type]) {
        byType[type] = { foods: [], customName: r && r.customMealName ? r.customMealName : "" };
      }
      const foods = Array.isArray(r.foods) ? r.foods : [];
      foods.forEach((f) => {
        if (f && f.name) {
          byType[type].foods.push(f.name);
        }
      });
    });
    const slots = [];
    const seen = {};
    // 1) 常显餐别（早/午/晚）始终出现
    BASE_SLOTS.forEach((base) => {
      seen[base.mealType] = true;
      const agg = byType[base.mealType];
      if (agg) {
        slots.push(this.makeSlot(base.mealType, agg));
      } else {
        slots.push({
          mealType: base.mealType,
          name: base.name,
          icon: base.icon,
          status: "empty",
          foodCount: 0,
          foodsText: ""
        });
      }
    });
    // 2) 其它有记录的餐别（加餐/夜奶/自定义）追加
    Object.keys(byType).forEach((type) => {
      if (seen[type]) {
        return;
      }
      slots.push(this.makeSlot(type, byType[type]));
    });
    // 3) 排序
    slots.sort((a, b) => (MEAL_ORDER[a.mealType] || 99) - (MEAL_ORDER[b.mealType] || 99));
    return slots;
  },
  /**
   * 构造一个已记录的 slot
   */
  makeSlot(type, agg) {
    const meta = MEAL_META[type] || { name: agg.customName || "加餐", icon: "🍽" };
    const foods = agg.foods || [];
    const name = type === "custom" && agg.customName ? agg.customName : meta.name;
    return {
      mealType: type,
      name,
      icon: meta.icon,
      status: "recorded",
      foodCount: foods.length,
      foodsText: foods.slice(0, 3).join("、") + (foods.length > 3 ? " 等" : "")
    };
  },
  /**
   * 加载推荐食谱：按当前宝贝月龄段调 recipe list（official，当前月龄段，pageSize 6），取前 3 个。
   * 无当前宝贝或无结果则不展示该区块。
   */
  loadRecommendRecipes() {
    const current = app.globalData.currentBaby;
    const month = this.data.month;
    if (!current || !current._id) {
      this.setData({ recommendRecipes: [], recipesLoading: false });
      return;
    }
    const stage = getStageByMonth(month);
    this.setData({ recipesLoading: true });
    callFunction("recipe", {
      action: "list",
      tab: "official",
      page: 1,
      pageSize: 6,
      monthAgeMin: stage.min,
      monthAgeMax: stage.max,
      babyId: current._id
    })
      .then((res) => {
        const list = res && res.success === true && res.data && Array.isArray(res.data.list)
          ? res.data.list
          : [];
        const recommend = list.slice(0, 3).map((r) => ({
          _id: r._id,
          name: r.title || r.name || "",
          imageUrl: r.imageUrl || "",
          monthText: (r.monthAgeMin !== undefined && r.monthAgeMax !== undefined)
            ? `${r.monthAgeMin}-${r.monthAgeMax}月`
            : ""
        }));
        this.setData({ recommendRecipes: recommend, recipesLoading: false });
      })
      .catch(() => {
        this.setData({ recommendRecipes: [], recipesLoading: false });
      });
  },
  /** 进入宝贝管理 / 切换宝贝 */
  onManageBaby() {
    wx.navigateTo({ url: "/pages/baby/manage/manage" });
  },
  /** 点击月龄阶段卡 → 食谱列表，带上当前月龄 */
  onTapStage() {
    wx.navigateTo({ url: `/pages/recipe/list/list?month=${this.data.month}` });
  },
  /** 点击某餐次 → 添加记录，带餐次类型 */
  onTapMeal(e) {
    const mealType = e.currentTarget.dataset.mealType;
    wx.navigateTo({ url: `/pages/record/add/add?mealType=${mealType}` });
  },
  /** 点击推荐食谱卡 → 食谱详情 */
  onTapRecipe(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) {
      return;
    }
    wx.navigateTo({ url: `/pages/recipe/detail/detail?id=${id}` });
  },
  /** 点击过敏提醒卡 → 过敏观察列表 */
  onTapAllergy() {
    wx.navigateTo({ url: "/pages/allergy/list/list" });
  },
  /** 点击快捷入口 */
  onTapEntry(e) {
    const url = e.currentTarget.dataset.url;
    if (!url) {
      return;
    }
    wx.navigateTo({ url });
  },
  /** 无宝贝引导 → 新增宝贝 */
  onAddBaby() {
    wx.navigateTo({ url: "/pages/baby/profile/profile" });
  },
  /** 转发好友：邀请使用小饭团成长记（Task18） */
  onShareAppMessage() {
    return {
      title: "小饭团成长记 - 记录宝宝的每一餐成长",
      path: "/pages/index/index"
    };
  },
  /** 分享到朋友圈（Task18） */
  onShareTimeline() {
    return {
      title: "小饭团成长记 - 记录宝宝的每一餐成长"
    };
  }
});
