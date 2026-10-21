// pages/allergy/list/list.js —— 过敏观察
// 展示：当前宝贝 + 过敏食物汇总卡（alerts）+ 过敏记录时间线（records，按 date 倒序）。
// 右下浮动 + 手动新增过敏记录；点击时间线条目看详情；点击汇总标签展开该过敏原详情。
// 契约见 docs/data-model.md allergy_records / allergy_alerts。
const app = getApp();
const { callFunction } = require("../../../utils/cloud.js");
const { formatDate } = require("../../../utils/date.js");

// alert 状态 → 展示文案 / 标签样式
const STATUS_META = {
  suspected: { label: "疑似", cls: "alert-tag--suspected" },
  confirmed: { label: "确认", cls: "alert-tag--confirmed" },
  cleared: { label: "已排除", cls: "alert-tag--cleared" }
};

/**
 * 东八区展示日期：云端 Date 转 YYYY-MM-DD。
 * @param {*} value
 * @returns {string}
 */
function formatCloudDate(value) {
  if (!value) {
    return "";
  }
  try {
    const d = value instanceof Date ? value : new Date(value);
    if (isNaN(d.getTime())) {
      return typeof value === "string" ? value : "";
    }
    const shifted = new Date(d.getTime() + 8 * 60 * 60 * 1000);
    return shifted.toISOString().slice(0, 10);
  } catch (e) {
    return "";
  }
}

Page({
  data: {
    hasBaby: false,
    babyName: "",
    loading: false,

    alerts: [], // [{ _id, foodName, status, statusLabel, statusCls, firstText, lastText, symptomsSummary, expanded }]
    alertCount: 0,
    records: [], // [{ _id, dateText, symptoms, suspectedFoods, note, mealRecordId }]

    today: ""
  },

  onLoad() {
    this.setData({ today: formatDate(new Date(), "YYYY-MM-DD") });
  },

  onShow() {
    this.refresh();
  },

  /**
   * 读取当前宝贝并拉取 list。切换宝贝后在 onShow 重新读取。
   */
  refresh() {
    const baby = app.getCurrentBaby ? app.getCurrentBaby() : (app.globalData && app.globalData.currentBaby);
    if (!baby || !baby._id) {
      this.setData({ hasBaby: false, babyName: "", alerts: [], alertCount: 0, records: [] });
      return;
    }
    this._babyId = baby._id;
    this.setData({ hasBaby: true, babyName: baby.name || "宝贝" });
    this.fetchData(baby._id);
  },

  fetchData(babyId) {
    this.setData({ loading: true });
    callFunction("allergy", { action: "list", babyId: babyId })
      .then((res) => {
        if (!res || res.success !== true || !res.data) {
          throw new Error(res && res.error ? res.error : "加载失败");
        }
        const rawAlerts = Array.isArray(res.data.alerts) ? res.data.alerts : [];
        const rawRecords = Array.isArray(res.data.records) ? res.data.records : [];
        const alerts = rawAlerts.map((a) => {
          const meta = STATUS_META[a.status] || STATUS_META.suspected;
          return {
            _id: a._id,
            foodName: a.foodName || "",
            status: a.status || "suspected",
            statusLabel: meta.label,
            statusCls: meta.cls,
            firstText: formatCloudDate(a.firstOccurrence),
            lastText: formatCloudDate(a.lastOccurrence),
            symptomsSummary: Array.isArray(a.symptomsSummary) ? a.symptomsSummary : [],
            expanded: false
          };
        });
        const records = rawRecords.map((r) => ({
          _id: r._id,
          dateText: formatCloudDate(r.date),
          symptoms: Array.isArray(r.symptoms) ? r.symptoms : [],
          suspectedFoods: Array.isArray(r.suspectedFoods) ? r.suspectedFoods : [],
          note: r.note || "",
          mealRecordId: r.mealRecordId || ""
        }));
        this.setData({
          loading: false,
          alerts: alerts,
          alertCount: alerts.length,
          records: records
        });
        // 顺带刷新全局过敏原名称（供食谱页/Task 11）
        if (app.globalData) {
          app.globalData.allergyAlerts = alerts
            .map((a) => a.foodName)
            .filter((n) => !!n);
        }
      })
      .catch((err) => {
        console.error("[allergy/list] fetch failed:", err);
        this.setData({ loading: false });
      });
  },

  /* ============ 汇总标签展开/收起 ============ */
  onToggleAlert(e) {
    const idx = Number(e.currentTarget.dataset.index);
    if (isNaN(idx) || idx < 0 || idx >= this.data.alerts.length) {
      return;
    }
    const cur = this.data.alerts[idx];
    this.setData({ [`alerts[${idx}].expanded`]: !cur.expanded });
  },

  /* ============ 点击时间线条目 → 详情 ============ */
  onTapRecord(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) {
      return;
    }
    wx.navigateTo({ url: `/pages/allergy/detail/detail?mode=view&recordId=${id}` });
  },

  /* ============ 浮动 + 手动新增 ============ */
  onAddRecord() {
    if (!this._babyId) {
      wx.showToast({ title: "请先选择宝贝", icon: "none" });
      return;
    }
    const url =
      `/pages/allergy/detail/detail?mode=add` +
      `&babyId=${this._babyId}` +
      `&date=${this.data.today}`;
    wx.navigateTo({ url: url });
  },

  /* ============ 无宝贝引导 ============ */
  onGoAddBaby() {
    wx.navigateTo({ url: "/pages/baby/manage/manage" });
  }
});
