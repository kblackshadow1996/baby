// pages/timeline/timeline.js —— 辅食时间线
// - 顶部统计卡（已尝试 X 种 / Y 种过敏，来自云端 stats）
// - 横向类别筛选条（全部 + 7 类），切换时带 category 入参重新查询
// - 纵向时间轴：按"YYYY年M月"分组（东八区 firstTriedDate），组内按日期降序节点
// - 无当前宝贝 / 无数据 分别用 empty-state 引导
// 调 timeline 云函数 action=list。
const app = getApp();
const { callFunction } = require("../../utils/cloud.js");
/**
 * 类别元数据：label 中文名 / icon emoji / tone 配色类名（见 wxss）。
 * tone 同时用于时间轴圆点与节点卡片背景色。
 */
const CATEGORY_META = {
  grain: { label: "谷物", icon: "🌾", tone: "cat-grain" },
  veggie: { label: "蔬菜", icon: "🥦", tone: "cat-veggie" },
  fruit: { label: "水果", icon: "🍎", tone: "cat-fruit" },
  meat: { label: "肉类", icon: "🍖", tone: "cat-meat" },
  egg_dairy: { label: "蛋奶", icon: "🥚", tone: "cat-egg-dairy" },
  seafood: { label: "海鲜", icon: "🐟", tone: "cat-seafood" },
  other: { label: "其他", icon: "🍽", tone: "cat-other" }
};
/** 筛选条顺序：全部 + 7 类 */
const CATEGORY_ORDER = ["grain", "veggie", "fruit", "meat", "egg_dairy", "seafood", "other"];
/** 兜底取某类别的元数据 */
function metaOf(category) {
  return CATEGORY_META[category] || CATEGORY_META.other;
}
/**
 * 把云端 Date 转为东八区的年月日分量，避免云函数 UTC 环境下的时区偏移。
 * @param {*} value Date 或可被 new Date 解析的值
 * @returns {{ year:number, month:number, day:number }|null}
 */
function east8Parts(value) {
  if (!value) {
    return null;
  }
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) {
    return null;
  }
  const shifted = new Date(d.getTime() + 8 * 60 * 60 * 1000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate()
  };
}
/**
 * 东八区展示日期 "YYYY-MM-DD"。
 * @param {*} value
 * @returns {string}
 */
function formatTriedDate(value) {
  const p = east8Parts(value);
  if (!p) {
    return "";
  }
  const mm = p.month < 10 ? "0" + p.month : "" + p.month;
  const dd = p.day < 10 ? "0" + p.day : "" + p.day;
  return `${p.year}-${mm}-${dd}`;
}
/**
 * 分组键 "YYYY年M月"（东八区）。
 * @param {*} value
 * @returns {string}
 */
function monthKeyOf(value) {
  const p = east8Parts(value);
  if (!p) {
    return "未知日期";
  }
  return `${p.year}年${p.month}月`;
}
/**
 * 把时间线 items 投影为页面视图模型并按月份分组。
 * items 已由云端按 firstTriedDate 降序排好，这里保持顺序分组即保持降序。
 * @param {Object[]} items
 * @returns {Array<{ monthKey:string, nodes:Array }>}
 */
function groupByMonth(items) {
  const groups = [];
  const indexByKey = {};
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const meta = metaOf(it.category);
    const isAllergy = it.reaction === "allergy";
    const node = {
      _id: it._id,
      foodName: it.foodName || "",
      dateText: formatTriedDate(it.firstTriedDate),
      category: it.category || "other",
      categoryLabel: meta.label,
      icon: meta.icon,
      tone: meta.tone,
      isAllergy: isAllergy
    };
    const key = monthKeyOf(it.firstTriedDate);
    if (indexByKey[key] === undefined) {
      indexByKey[key] = groups.length;
      groups.push({ monthKey: key, nodes: [] });
    }
    groups[indexByKey[key]].nodes.push(node);
  }
  return groups;
}
Page({
  data: {
    hasBaby: false,
    babyName: "",
    loading: false,
    // 统计（来自云端 stats）
    total: 0,
    allergyCount: 0,
    // 类别筛选
    filters: [{ key: "all", label: "全部", icon: "🍱" }].concat(
      CATEGORY_ORDER.map((k) => ({ key: k, label: CATEGORY_META[k].label, icon: CATEGORY_META[k].icon }))
    ),
    activeCategory: "all",
    // 分组后的时间轴 [{ monthKey, nodes:[...] }]
    groups: [],
    hasTimeline: false
  },
  onLoad() {
    this._babyId = "";
  },
  onShow() {
    this.refresh();
  },
  /**
   * 读取当前宝贝；切换宝贝后在 onShow 重新读取并拉取。
   */
  refresh() {
    const baby =
      app.getCurrentBaby ? app.getCurrentBaby() : app.globalData && app.globalData.currentBaby;
    if (!baby || !baby._id) {
      this._babyId = "";
      this.setData({
        hasBaby: false,
        babyName: "",
        total: 0,
        allergyCount: 0,
        groups: [],
        hasTimeline: false
      });
      return;
    }
    this._babyId = baby._id;
    this.setData({ hasBaby: true, babyName: baby.name || "宝贝" });
    this.fetchData();
  },
  /**
   * 调 timeline/list 拉取数据。activeCategory 为 all 时不传 category。
   */
  fetchData() {
    if (!this._babyId) {
      return;
    }
    const payload = { action: "list", babyId: this._babyId };
    if (this.data.activeCategory && this.data.activeCategory !== "all") {
      payload.category = this.data.activeCategory;
    }
    this.setData({ loading: true });
    callFunction("timeline", payload)
      .then((res) => {
        if (!res || res.success !== true || !res.data) {
          throw new Error(res && res.error ? res.error : "加载失败");
        }
        const items = Array.isArray(res.data.items) ? res.data.items : [];
        const stats = res.data.stats || { total: 0, allergyCount: 0 };
        const groups = groupByMonth(items);
        this.setData({
          loading: false,
          total: Number(stats.total) || 0,
          allergyCount: Number(stats.allergyCount) || 0,
          groups: groups,
          hasTimeline: items.length > 0
        });
      })
      .catch((err) => {
        console.error("[timeline] fetch failed:", err);
        this.setData({ loading: false });
      });
  },
  /**
   * 切换类别筛选：更新 activeCategory 并重新查询（带 category 入参）。
   */
  onSelectCategory(e) {
    const key = e.currentTarget.dataset.key;
    if (!key || key === this.data.activeCategory) {
      return;
    }
    this.setData({ activeCategory: key }, () => {
      this.fetchData();
    });
  },
  /**
   * 空态引导：去「添加记录」记录第一口辅食。
   */
  goAddRecord() {
    wx.navigateTo({
      url: "/pages/record/add/add",
      fail: () => {
        wx.switchTab({ url: "/pages/record/daily/daily", fail: () => {} });
      }
    });
  }
});
