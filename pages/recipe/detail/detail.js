// pages/recipe/detail/detail.js —— 食谱详情
const { callFunction } = require("../../../utils/cloud.js");
const allergen = require("../../../utils/allergen.js");
const app = getApp();
/** type 中文映射（docs/data-model.md recipes.type） */
const TYPE_LABEL = {
  staple: "主食",
  meat: "荤菜",
  veggie: "素菜",
  soup: "汤",
  snack: "点心"
};
/** 彩色胶囊轮转样式 */
const TAG_TONES = ["tag", "tag-blue", "tag-green", "tag-yellow"];
/** 收藏集合在本地 storage 的 key */
const FAVORITE_KEY = "favoriteRecipes";
/** 营养项展示配置（顺序即网格顺序），vitamin 单独作为说明行 */
const NUTRITION_ITEMS = [
  { key: "calories", emoji: "🔥", label: "热量", tone: "nutri-orange" },
  { key: "protein", emoji: "🥚", label: "蛋白质", tone: "nutri-yellow" },
  { key: "iron", emoji: "🩸", label: "铁", tone: "nutri-red" },
  { key: "calcium", emoji: "🦴", label: "钙", tone: "nutri-blue" }
];
/**
 * 单个值是否“存在”（非 null/undefined/空字符串），数字 0 视为有效
 * @param {*} v
 * @returns {boolean}
 */
function hasValue(v) {
  return v !== undefined && v !== null && String(v).trim() !== "";
}
/**
 * 单个食材是否命中当前宝贝过敏原：统一走 utils/allergen.isFoodAllergicTo（含同义词增强）。
 * @param {Object} ing 食材 { name }
 * @param {string[]} alerts 过敏原名称数组
 * @returns {boolean}
 */
function isIngredientHit(ing, alerts) {
  if (!ing || !ing.name || !Array.isArray(alerts) || alerts.length === 0) {
    return false;
  }
  for (let i = 0; i < alerts.length; i++) {
    if (allergen.isFoodAllergicTo(ing.name, alerts[i])) {
      return true;
    }
  }
  return false;
}
/**
 * 求食谱与 alerts 的命中交集，用于顶部总览提示条。
 * 统一走 utils/allergen.recipeHitAllergens（含 allergens[] 与 ingredients[].name、同义词增强）。
 * @param {Object} recipe
 * @param {string[]} alerts
 * @returns {string[]} 命中的过敏原名称（去重）
 */
function matchedAllergens(recipe, alerts) {
  return allergen.recipeHitAllergens(recipe, alerts);
}
Page({
  data: {
    loading: true,
    error: false,
    recipeId: "",
    recipe: null,
    // 视图预处理字段
    typeLabel: "",
    monthText: "",
    viewTags: [],
    viewIngredients: [],
    nutritionItems: [],
    vitaminText: "",
    hasNutrition: false,
    // 过敏
    allergyAlerts: [],
    babyName: "宝宝",
    allergenHits: [],
    allergenHitsText: "",
    hasAllergenHit: false,
    // 来源
    hasSource: false,
    sourceExpanded: false,
    // 收藏
    isFavorite: false,
    // 编辑入口
    canEdit: false,
    // 顶部大图加载失败
    _imgError: false
  },
  onLoad(options) {
    const id = options && options.id ? String(options.id) : "";
    const alerts = this.readAlerts();
    const baby = app.globalData && app.globalData.currentBaby;
    const babyName = baby && baby.name ? baby.name : "宝宝";
    this.setData({
      recipeId: id,
      allergyAlerts: alerts,
      babyName: babyName,
      isFavorite: this.readIsFavorite(id)
    });
    if (!id) {
      this.setData({ loading: false, error: true });
      wx.showToast({ title: "缺少食谱参数", icon: "none" });
      return;
    }
    // 若全局过敏原为空且有当前宝贝，先加载再拉取详情（避免漏标）
    this.ensureAlerts().then((latest) => {
      this.setData({ allergyAlerts: latest });
      this.fetchRecipe(id);
    });
  },
  /** 读取当前宝贝过敏原名称数组（缺省 []） */
  readAlerts() {
    const alerts = app.globalData && app.globalData.allergyAlerts;
    return Array.isArray(alerts) ? alerts : [];
  },
  /**
   * 确保全局过敏原已加载：为空且有当前宝贝时触发 app.loadAllergyAlerts()。
   * @returns {Promise<string[]>}
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
  /** 从 storage 读收藏集合，判断某 id 是否已收藏 */
  readIsFavorite(id) {
    if (!id) {
      return false;
    }
    const list = this.readFavorites();
    return list.indexOf(id) !== -1;
  },
  /** 读本地收藏数组（容错为数组） */
  readFavorites() {
    let list = [];
    try {
      list = wx.getStorageSync(FAVORITE_KEY) || [];
    } catch (e) {
      list = [];
    }
    return Array.isArray(list) ? list : [];
  },
  /** 拉取食谱详情 */
  fetchRecipe(id) {
    this.setData({ loading: true, error: false });
    callFunction("recipe", { action: "get", recipeId: id })
      .then((res) => {
        if (!res || res.success !== true || !res.data) {
          throw new Error(res && res.error ? res.error : "食谱不存在");
        }
        this.decorate(res.data);
      })
      .catch((err) => {
        console.error("[recipe/detail] fetch failed:", err);
        this.setData({ loading: false, error: true });
        wx.showToast({ title: "食谱加载失败", icon: "none" });
      });
  },
  /**
   * 把原始 recipe 预处理为视图字段并 setData
   * @param {Object} recipe
   */
  decorate(recipe) {
    const alerts = this.data.allergyAlerts;
    // type 中文 + 月龄文本
    const typeLabel = TYPE_LABEL[recipe.type] || "";
    const monthText = `${recipe.monthAgeMin}-${recipe.monthAgeMax}月`;
    // 标签彩色胶囊
    const tags = Array.isArray(recipe.tags) ? recipe.tags : [];
    const viewTags = tags
      .filter((t) => hasValue(t))
      .map((t, idx) => ({ name: String(t), tone: TAG_TONES[idx % TAG_TONES.length] }));
    // 食材行：过敏原标签 + 命中高亮
    const ingredients = Array.isArray(recipe.ingredients) ? recipe.ingredients : [];
    const viewIngredients = ingredients.map((ing) => {
      const item = ing || {};
      return {
        name: item.name || "",
        amount: item.amount || "",
        isAllergen: item.isAllergen === true,
        isHit: isIngredientHit(item, alerts)
      };
    });
    // 营养网格（缺失跳过），vitamin 单独说明行
    const nutrition = recipe.nutrition && typeof recipe.nutrition === "object" ? recipe.nutrition : {};
    const nutritionItems = NUTRITION_ITEMS.filter((cfg) => hasValue(nutrition[cfg.key])).map((cfg) => ({
      emoji: cfg.emoji,
      label: cfg.label,
      tone: cfg.tone,
      value: String(nutrition[cfg.key])
    }));
    const vitaminText = hasValue(nutrition.vitamin) ? String(nutrition.vitamin) : "";
    const hasNutrition = nutritionItems.length > 0 || vitaminText !== "";
    // 来源
    const source = recipe.source && typeof recipe.source === "object" ? recipe.source : null;
    const hasSource = !!(source && (hasValue(source.name) || hasValue(source.chapter) || hasValue(source.page)));
    // 顶部过敏总览（统一工具）
    const allergenHits = matchedAllergens(recipe, alerts);
    // 编辑入口：自建食谱且创建者为当前用户
    const userInfo = app.globalData && app.globalData.userInfo;
    const openid = userInfo && userInfo.openid ? userInfo.openid : "";
    const canEdit = recipe.isOfficial === false && !!recipe.creatorOpenid && recipe.creatorOpenid === openid;
    this.setData({
      loading: false,
      error: false,
      recipe: recipe,
      typeLabel: typeLabel,
      monthText: monthText,
      viewTags: viewTags,
      viewIngredients: viewIngredients,
      nutritionItems: nutritionItems,
      vitaminText: vitaminText,
      hasNutrition: hasNutrition,
      hasSource: hasSource,
      allergenHits: allergenHits,
      allergenHitsText: allergenHits.join("、"),
      hasAllergenHit: allergenHits.length > 0,
      canEdit: canEdit,
      _imgError: false
    });
  },
  /** 顶部大图加载失败：回退为 emoji 底 */
  onImgError() {
    this.setData({ _imgError: true });
  },
  /** 切换收藏状态：更新 storage 与 data.isFavorite */
  toggleFavorite() {
    const id = this.data.recipeId;
    if (!id) {
      return;
    }
    const list = this.readFavorites();
    const idx = list.indexOf(id);
    let isFavorite;
    if (idx === -1) {
      list.push(id);
      isFavorite = true;
    } else {
      list.splice(idx, 1);
      isFavorite = false;
    }
    try {
      wx.setStorageSync(FAVORITE_KEY, list);
    } catch (e) {
      console.error("[recipe/detail] save favorite failed:", e);
    }
    this.setData({ isFavorite: isFavorite });
    wx.showToast({ title: isFavorite ? "已收藏" : "已取消收藏", icon: "none" });
  },
  /** 展开/收起来源说明 */
  toggleSource() {
    this.setData({ sourceExpanded: !this.data.sourceExpanded });
  },
  /** 加入今日记录：跳转 record/add 并传参（Task 9 实现） */
  onAddRecord() {
    const recipe = this.data.recipe;
    if (!recipe) {
      return;
    }
    const id = this.data.recipeId;
    const title = recipe.title || "";
    wx.navigateTo({
      url: `/pages/record/add/add?recipeId=${id}&recipeTitle=${encodeURIComponent(title)}`
    });
  },
  /** 编辑食谱：跳转 recipe/create 并传 id（Task 12 实现） */
  onEdit() {
    const id = this.data.recipeId;
    if (!id) {
      return;
    }
    wx.navigateTo({ url: `/pages/recipe/create/create?id=${id}` });
  },
  /** 重试加载 */
  onRetry() {
    if (this.data.recipeId) {
      this.fetchRecipe(this.data.recipeId);
    }
  },
  /** 转发好友：用食谱名与月龄拼标题（Task18，纯分享无副作用） */
  onShareAppMessage() {
    const recipe = this.data.recipe;
    const monthText = this.data.monthText;
    const title =
      recipe && recipe.title
        ? `${recipe.title}${monthText ? ` - 适合${monthText}的辅食` : ""}`
        : "小饭团成长记 - 宝宝辅食食谱";
    return {
      title,
      path: `/pages/recipe/detail/detail?id=${this.data.recipeId}`
    };
  }
});
// 导出模块函数，供测试/复用（小程序运行环境 module.exports 可被 require）
module.exports.isIngredientHit = isIngredientHit;
module.exports.matchedAllergens = matchedAllergens;
