// pages/allergy/detail/detail.js —— 过敏记录新增 / 查看详情
// 两种模式（options.mode 区分）：
//   mode=add  —— 记录过敏反应（可从 record/add 的"标记异常反应"跳来，带 mealRecordId/babyId/date；
//                也可从过敏列表浮动 + 手动新增，带 babyId/date 但无 mealRecordId）。
//   mode=view —— 过敏记录详情（从时间线点击某条跳来，带 recordId），只读展示。
// 契约见 docs/data-model.md allergy_records / allergy_alerts。
const app = getApp();
const { callFunction } = require("../../../utils/cloud.js");
const { formatDate } = require("../../../utils/date.js");

// 症状多选常量（含"其他"开自定义输入）
const SYMPTOM_OPTIONS = [
  { value: "皮疹/红疹", label: "皮疹/红疹" },
  { value: "腹泻", label: "腹泻" },
  { value: "呕吐", label: "呕吐" },
  { value: "湿疹加重", label: "湿疹加重" },
  { value: "嘴唇肿胀", label: "嘴唇肿胀" },
  { value: "腹痛哭闹", label: "腹痛哭闹" },
  { value: "其他", label: "其他" }
];
// 严重程度单选（可选，预留）
const SEVERITY_OPTIONS = [
  { value: "mild", label: "轻微" },
  { value: "moderate", label: "中等" },
  { value: "severe", label: "严重" }
];
const SEVERITY_LABEL = { mild: "轻微", moderate: "中等", severe: "严重" };

/**
 * 东八区展示日期：云端 Date 转 YYYY-MM-DD（+8h 后取日期部分）。
 * @param {*} value 云端返回的 Date / 字符串
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
    mode: "add", // add | view
    navTitle: "记录过敏反应",
    loading: false,
    saving: false,

    symptomOptions: SYMPTOM_OPTIONS,
    severityOptions: SEVERITY_OPTIONS,

    // ===== add 模式表单 =====
    date: "", // YYYY-MM-DD
    mealRecordId: "",
    // 疑似过敏原候选：来自当餐食物（selected 可切换）
    foodCandidates: [], // [{ name, selected }]
    manualFood: "", // 手动补充的额外过敏原
    // 症状选中集合
    selectedSymptoms: [], // [string]
    otherSymptom: "", // 选"其他"时的自定义输入
    severity: "", // mild/moderate/severe，可空
    note: "",

    // ===== view 模式展示 =====
    viewRecord: null // { dateText, severityLabel, symptoms, suspectedFoods, note, mealRecordId }
  },

  onLoad(options) {
    const opts = options || {};
    const mode = opts.mode === "view" ? "view" : "add";
    if (mode === "view") {
      const recordId = opts.recordId ? String(opts.recordId) : "";
      this.setData({ mode: "view", navTitle: "过敏记录详情" });
      if (!recordId) {
        wx.showToast({ title: "参数缺失", icon: "none" });
        setTimeout(() => wx.navigateBack({ delta: 1 }), 800);
        return;
      }
      this._recordId = recordId;
      this.fetchRecord(recordId);
      return;
    }
    // add 模式
    const baby = app.getCurrentBaby ? app.getCurrentBaby() : (app.globalData && app.globalData.currentBaby);
    const babyId = opts.babyId ? String(opts.babyId) : (baby && baby._id ? baby._id : "");
    if (!babyId) {
      wx.showToast({ title: "请先选择宝贝", icon: "none" });
      setTimeout(() => wx.navigateBack({ delta: 1 }), 800);
      return;
    }
    this._babyId = babyId;
    const date =
      typeof opts.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(opts.date)
        ? opts.date
        : formatDate(new Date(), "YYYY-MM-DD");
    const mealRecordId = opts.mealRecordId ? String(opts.mealRecordId) : "";
    this.setData({
      mode: "add",
      navTitle: "记录过敏反应",
      date: date,
      mealRecordId: mealRecordId
    });
    // 若带 mealRecordId，拉当餐食物作为疑似过敏原候选（默认全选）
    if (mealRecordId) {
      this.fetchMealFoods(mealRecordId);
    }
  },

  /* ============ view 模式 ============ */
  fetchRecord(recordId) {
    this.setData({ loading: true });
    callFunction("allergy", { action: "get", recordId: recordId })
      .then((res) => {
        if (!res || res.success !== true || !res.data) {
          throw new Error(res && res.error ? res.error : "记录不存在");
        }
        const r = res.data;
        this.setData({
          loading: false,
          viewRecord: {
            dateText: formatCloudDate(r.date),
            severityLabel: r.severity ? SEVERITY_LABEL[r.severity] || "" : "",
            symptoms: Array.isArray(r.symptoms) ? r.symptoms : [],
            suspectedFoods: Array.isArray(r.suspectedFoods) ? r.suspectedFoods : [],
            note: r.note || "",
            mealRecordId: r.mealRecordId || ""
          }
        });
      })
      .catch((err) => {
        console.error("[allergy/detail] fetch failed:", err);
        this.setData({ loading: false });
        wx.showToast({ title: "记录加载失败", icon: "none" });
        setTimeout(() => wx.navigateBack({ delta: 1 }), 800);
      });
  },

  /* ============ add 模式：当餐食物候选 ============ */
  fetchMealFoods(mealRecordId) {
    this.setData({ loading: true });
    callFunction("meal", { action: "getById", recordId: mealRecordId })
      .then((res) => {
        let candidates = [];
        if (res && res.success === true && res.data && Array.isArray(res.data.foods)) {
          const seen = {};
          res.data.foods.forEach((f) => {
            const name = f && typeof f.name === "string" ? f.name.trim() : "";
            if (name && !seen[name]) {
              seen[name] = true;
              candidates.push({ name: name, selected: true }); // 默认全选
            }
          });
        }
        this.setData({ loading: false, foodCandidates: candidates });
      })
      .catch((err) => {
        console.error("[allergy/detail] fetch meal foods failed:", err);
        this.setData({ loading: false, foodCandidates: [] });
      });
  },

  /* ============ 症状多选 ============ */
  onToggleSymptom(e) {
    const value = e.currentTarget.dataset.value;
    if (!value) {
      return;
    }
    const selected = this.data.selectedSymptoms.slice();
    const idx = selected.indexOf(value);
    if (idx >= 0) {
      selected.splice(idx, 1);
    } else {
      selected.push(value);
    }
    this.setData({ selectedSymptoms: selected });
  },
  onOtherSymptomInput(e) {
    this.setData({ otherSymptom: e.detail.value });
  },

  /* ============ 疑似过敏原（当餐食物候选切换 + 手动补充） ============ */
  onToggleFood(e) {
    const idx = Number(e.currentTarget.dataset.index);
    if (isNaN(idx) || idx < 0 || idx >= this.data.foodCandidates.length) {
      return;
    }
    const cur = this.data.foodCandidates[idx];
    this.setData({ [`foodCandidates[${idx}].selected`]: !cur.selected });
  },
  onManualFoodInput(e) {
    this.setData({ manualFood: e.detail.value });
  },

  /* ============ 严重程度 ============ */
  onSelectSeverity(e) {
    const value = e.currentTarget.dataset.value;
    // 再次点击取消选择
    this.setData({ severity: this.data.severity === value ? "" : value });
  },

  /* ============ 备注 ============ */
  onNoteInput(e) {
    this.setData({ note: e.detail.value });
  },

  /* ============ 组装 symptoms / suspectedFoods ============ */
  buildSymptoms() {
    const out = [];
    const seen = {};
    this.data.selectedSymptoms.forEach((s) => {
      if (s === "其他") {
        const custom = String(this.data.otherSymptom || "").trim();
        if (custom && !seen[custom]) {
          seen[custom] = true;
          out.push(custom);
        }
      } else if (s && !seen[s]) {
        seen[s] = true;
        out.push(s);
      }
    });
    return out;
  },
  buildSuspectedFoods() {
    const out = [];
    const seen = {};
    this.data.foodCandidates.forEach((f) => {
      if (f.selected && f.name && !seen[f.name]) {
        seen[f.name] = true;
        out.push(f.name);
      }
    });
    const manual = String(this.data.manualFood || "").trim();
    if (manual && !seen[manual]) {
      seen[manual] = true;
      out.push(manual);
    }
    return out;
  },

  /* ============ 保存 ============ */
  onSave() {
    if (this.data.saving) {
      return;
    }
    const symptoms = this.buildSymptoms();
    if (symptoms.length === 0) {
      wx.showToast({ title: "请至少选择一个症状", icon: "none" });
      return;
    }
    const suspectedFoods = this.buildSuspectedFoods();
    if (suspectedFoods.length === 0) {
      wx.showToast({ title: "请至少选择一个疑似过敏原", icon: "none" });
      return;
    }
    const babyId = this._babyId;
    if (!babyId) {
      wx.showToast({ title: "请先选择宝贝", icon: "none" });
      return;
    }
    this.setData({ saving: true });
    const req = {
      action: "add",
      babyId: babyId,
      mealRecordId: this.data.mealRecordId || "",
      date: this.data.date,
      symptoms: symptoms,
      suspectedFoods: suspectedFoods,
      severity: this.data.severity || "",
      note: String(this.data.note || "").trim()
    };
    callFunction("allergy", req)
      .then((res) => {
        if (!res || res.success !== true || !res.data) {
          throw new Error(res && res.error ? res.error : "保存失败");
        }
        this.setData({ saving: false });
        wx.showToast({ title: "已记录", icon: "success" });
        // 刷新全局过敏原（供食谱页/Task 11 过敏提醒）
        this.refreshGlobalAlerts(babyId);
        setTimeout(() => wx.navigateBack({ delta: 1 }), 600);
      })
      .catch((err) => {
        console.error("[allergy/detail] save failed:", err);
        this.setData({ saving: false });
        wx.showToast({ title: (err && err.message) || "保存失败", icon: "none" });
      });
  },

  /**
   * 保存成功后重新拉 listAlerts，把 foodName 数组写入 app.globalData.allergyAlerts。
   * @param {string} babyId
   */
  refreshGlobalAlerts(babyId) {
    callFunction("allergy", { action: "listAlerts", babyId: babyId })
      .then((res) => {
        if (res && res.success === true && res.data && Array.isArray(res.data.alerts)) {
          const names = res.data.alerts
            .map((a) => (a && typeof a.foodName === "string" ? a.foodName : ""))
            .filter((n) => !!n);
          if (app.globalData) {
            app.globalData.allergyAlerts = names;
          }
        }
      })
      .catch((err) => {
        console.warn("[allergy/detail] refresh global alerts failed:", err);
      });
  }
});
