// pages/recipe/list/list.js —— 食谱库（按月龄浏览与筛选）
const { callFunction } = require("../../../utils/cloud.js");
const { STAGES, calcMonthAge } = require("../../../utils/date.js");
const allergen = require("../../../utils/allergen.js");
const app = getApp();
/** type 角标文案映射（docs/data-model.md recipes.type） */
const TYPE_LABEL = {
  staple: "主食",
  meat: "荤菜",
  veggie: "素菜",
  soup: "汤",
  snack: "点心"
};
/** 预设标签筛选集合（第一项“全部”表示不筛选） */
const TAG_OPTIONS = ["全部", "高铁", "补钙", "防便秘", "手指食物", "补锌", "易消化", "补脑"];
/** 彩色胶囊轮转样式，用于营养标签 */
const TAG_TONES = ["tag", "tag-blue", "tag-green", "tag-yellow"];
const PAGE_SIZE = 10;
/**
 * 过敏原匹配：alerts（当前宝贝过敏原名称数组）为空返回 false；
 * 统一走 utils/allergen.recipeHitAllergens（含同义词增强的模糊匹配）。
 * 保留模块级导出，兼容既有引用。
 * @param {Object} recipe 食谱
 * @param {string[]} alerts 过敏原名称数组
 * @returns {boolean}
 */
function matchAllergen(recipe, alerts) {
  return allergen.recipeHitAllergens(recipe, alerts).length > 0;
}
/**
 * 为单条食谱补充视图字段（适用月龄文本、食材摘要、营养标签、type 角标、过敏标记）
 */
function decorateRecipe(recipe, alerts) {
  const ingredients = Array.isArray(recipe.ingredients) ? recipe.ingredients : [];
  const ingredientSummary = ingredients
    .slice(0, 3)
    .map((i) => (i && i.name ? i.name : ""))
    .filter((n) => n)
    .join(" · ");
  const tags = Array.isArray(recipe.tags) ? recipe.tags.slice(0, 3) : [];
  const viewTags = tags.map((t, idx) => ({
    name: t,
    tone: TAG_TONES[idx % TAG_TONES.length]
  }));
  return Object.assign({}, recipe, {
    _monthText: `${recipe.monthAgeMin}-${recipe.monthAgeMax}月`,
    _ingredientSummary: ingredientSummary,
    _viewTags: viewTags,
    _typeLabel: TYPE_LABEL[recipe.type] || "",
    _hasAllergen: matchAllergen(recipe, alerts),
    _imgError: false
  });
}
Page({
  data: {
    // tab
    tab: "official", // official | mine
    // 月龄段
    stages: STAGES,
    activeStageKey: "",
    // 标签
    tagOptions: TAG_OPTIONS,
    activeTag: "全部",
    // 列表
    recipes: [],
    page: 1,
    pageSize: PAGE_SIZE,
    hasMore: true,
    total: 0,
    // 状态
    loading: false,
    loadingMore: false,
    inited: false,
    // 过敏原（只读自 globalData，加载在 Task 11）
    allergyAlerts: [],
    // 滚动定位
    scrollIntoStage: "",
    // 当前宝贝引用（用于 onShow 检测变化）
    _currentBabyId: ""
  },
  onLoad(options) {
    this.locateStage(options || {});
  },
  /**
   * 根据 options.month / 当前宝贝月龄 / 默认第一个辅食段 定位默认月龄段
   */
  locateStage(options) {
    let month = null;
    if (options.month !== undefined && options.month !== null && options.month !== "") {
      const m = parseInt(options.month, 10);
      if (!isNaN(m)) {
        month = m;
      }
    }
    if (month === null) {
      const baby = app.globalData && app.globalData.currentBaby;
      if (baby && baby.birthday) {
        try {
          month = calcMonthAge(baby.birthday);
        } catch (e) {
          month = null;
        }
      }
    }
    let stage = null;
    if (month !== null) {
      stage = STAGES.find((s) => {
        if (s.max === 36) {
          return month >= s.min && month <= s.max;
        }
        return month >= s.min && month < s.max;
      });
      if (!stage && month > 36) {
        stage = STAGES[STAGES.length - 1];
      }
    }
    // 再无则默认第一个辅食段（排除纯奶期 milk，取 swallow）
    if (!stage) {
      stage = STAGES.find((s) => s.key !== "milk") || STAGES[0];
    }
    const babyId = app.globalData && app.globalData.currentBaby ? app.globalData.currentBaby._id : "";
    // 若全局过敏原为空但有当前宝贝，先尝试加载再定位（避免首次漏标）
    this.ensureAlerts().then((alerts) => {
      this.setData(
        {
          activeStageKey: stage.key,
          scrollIntoStage: "stage-" + stage.key,
          allergyAlerts: alerts,
          _currentBabyId: babyId || ""
        },
        () => {
          this.resetAndQuery();
        }
      );
    });
  },
  /**
   * 从 globalData 读取当前宝贝过敏原名称数组（缺省空数组，只读不负责加载）
   */
  readAlerts() {
    const alerts = app.globalData && app.globalData.allergyAlerts;
    return Array.isArray(alerts) ? alerts : [];
  },
  /**
   * 确保全局过敏原已加载：为空且有当前宝贝时触发 app.loadAllergyAlerts()。
   * @returns {Promise<string[]>} 最新过敏原名称数组
   */
  ensureAlerts() {
    const alerts = this.readAlerts();
    const baby = app.globalData && app.globalData.currentBaby;
    if (alerts.length === 0 && baby && baby._id && typeof app.loadAllergyAlerts === "function") {
      return app
        .loadAllergyAlerts()
        .then(() => this.readAlerts())
        .catch(() => this.readAlerts());
    }
    return Promise.resolve(alerts);
  },
  onShow() {
    if (!this.data.inited) {
      return;
    }
    // 当前宝贝变化则刷新过敏原显示并重查
    const baby = app.globalData && app.globalData.currentBaby;
    const babyId = baby ? baby._id : "";
    if (babyId !== this.data._currentBabyId) {
      // 切换宝贝：全局缓存已被清空，拉取新宝贝过敏原后重查
      this.setData({ _currentBabyId: babyId || "" });
      this.ensureAlerts().then((alerts) => {
        this.setData({ allergyAlerts: alerts });
        this.resetAndQuery();
      });
      return;
    }
    // 同一宝贝：全局为空则补拉一次，随后按需重新装饰
    this.ensureAlerts().then((alerts) => {
      if (JSON.stringify(alerts) !== JSON.stringify(this.data.allergyAlerts)) {
        this.setData({ allergyAlerts: alerts });
        this.redecorate(alerts);
      }
    });
  },
  /**
   * 用新的 alerts 重新装饰现有列表的过敏标记
   */
  redecorate(alerts) {
    const recipes = this.data.recipes.map((r) => Object.assign({}, r, { _hasAllergen: matchAllergen(r, alerts) }));
    this.setData({ recipes });
  },
  /** 切换 tab */
  onTabTap(e) {
    const tab = e.currentTarget.dataset.tab;
    if (tab === this.data.tab) {
      return;
    }
    this.setData({ tab }, () => this.resetAndQuery());
  },
  /** 切换月龄段 */
  onStageTap(e) {
    const key = e.currentTarget.dataset.key;
    if (key === this.data.activeStageKey) {
      return;
    }
    this.setData({ activeStageKey: key }, () => this.resetAndQuery());
  },
  /** 切换标签 */
  onTagTap(e) {
    const tag = e.currentTarget.dataset.tag;
    if (tag === this.data.activeTag) {
      return;
    }
    this.setData({ activeTag: tag }, () => this.resetAndQuery());
  },
  /** 重置到第 1 页并查询（替换列表） */
  resetAndQuery() {
    this.setData({ page: 1, hasMore: true, recipes: [] });
    this.query(1, true);
  },
  /**
   * 组合当前筛选条件查询 recipe list 云函数。
   * @param {number} page 目标页
   * @param {boolean} replace true=第 1 页替换；false=追加
   */
  query(page, replace) {
    if (this.data.loading || this.data.loadingMore) {
      return;
    }
    const stage = STAGES.find((s) => s.key === this.data.activeStageKey);
    const params = {
      action: "list",
      tab: this.data.tab,
      page: page,
      pageSize: this.data.pageSize
    };
    if (stage) {
      params.monthAgeMin = stage.min;
      params.monthAgeMax = stage.max;
    }
    if (this.data.activeTag && this.data.activeTag !== "全部") {
      params.tag = this.data.activeTag;
    }
    const baby = app.globalData && app.globalData.currentBaby;
    if (baby && baby._id) {
      params.babyId = baby._id;
    }
    this.setData(replace ? { loading: true } : { loadingMore: true });
    callFunction("recipe", params)
      .then((res) => {
        if (!res || res.success !== true || !res.data) {
          throw new Error(res && res.error ? res.error : "查询失败");
        }
        const alerts = this.data.allergyAlerts;
        const incoming = (res.data.list || []).map((r) => decorateRecipe(r, alerts));
        const recipes = replace ? incoming : this.data.recipes.concat(incoming);
        this.setData({
          recipes: recipes,
          page: res.data.page || page,
          hasMore: !!res.data.hasMore,
          total: res.data.total || 0,
          loading: false,
          loadingMore: false,
          inited: true
        });
      })
      .catch((err) => {
        console.error("[recipe/list] query failed:", err);
        this.setData({ loading: false, loadingMore: false, inited: true });
      })
      .then(() => {
        if (wx.stopPullDownRefresh) {
          wx.stopPullDownRefresh();
        }
      });
  },
  /** 下拉刷新：重置第 1 页 */
  onPullDownRefresh() {
    this.resetAndQuery();
  },
  /** 触底加载更多 */
  onReachBottom() {
    if (!this.data.hasMore || this.data.loading || this.data.loadingMore) {
      return;
    }
    this.query(this.data.page + 1, false);
  },
  /** 图片加载失败：切到 emoji 背景 */
  onImgError(e) {
    const idx = e.currentTarget.dataset.index;
    if (idx === undefined || idx === null) {
      return;
    }
    this.setData({ [`recipes[${idx}]._imgError`]: true });
  },
  /** 点击卡片进入详情 */
  onCardTap(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) {
      return;
    }
    wx.navigateTo({ url: `/pages/recipe/detail/detail?id=${id}` });
  },
  /** 我的食谱空态：创建食谱 */
  onCreateTap() {
    wx.navigateTo({ url: "/pages/recipe/create/create" });
  },
  /** 转发好友（Task18，纯分享无副作用） */
  onShareAppMessage() {
    return {
      title: "小饭团成长记 - 记录宝宝的每一餐成长",
      path: "/pages/index/index"
    };
  }
});
// 导出模块函数，供复用（在小程序运行环境中 module.exports 可被 require）
module.exports.matchAllergen = matchAllergen;
