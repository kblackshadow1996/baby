// pages/growth/growth.js —— 成长曲线（身高/体重/头围记录与可视化）
// - 顶部最新数据卡 + 指标切换 tab + canvas 曲线（WHO 参考线 + 宝贝实际折线）
// - 添加/编辑/删除记录（弹层表单），调 growth 云函数（list/add/update/delete）
// - canvas 用新版 Canvas 2D 接口；获取失败降级为仅列表。
const app = getApp();
const { callFunction } = require("../../utils/cloud.js");
const { formatDate, calcMonthAge } = require("../../utils/date.js");
const WHO = require("../../utils/who-growth.js");

// 指标元数据：label/unit/宝贝记录字段(field)/WHO 数据键(who)
const METRICS = {
  height: { label: "身高", unit: "cm", field: "height", who: "height" },
  weight: { label: "体重", unit: "kg", field: "weight", who: "weight" },
  head: { label: "头围", unit: "cm", field: "headCircumference", who: "head" }
};
const METRIC_ORDER = ["height", "weight", "head"];
// WHO 五条参考线由浅到深的颜色（P50 为主线）
const WHO_LINES = [
  { key: "P3", color: "#F3C6CE", label: "P3" },
  { key: "P15", color: "#E8A7B4", label: "P15" },
  { key: "P50", color: "#C77B8B", label: "P50（中位）", main: true },
  { key: "P85", color: "#E8A7B4", label: "P85" },
  { key: "P97", color: "#F3C6CE", label: "P97" }
];
const BABY_COLOR = "#FF8FA3"; // 主粉：宝贝实际数据折线

/**
 * 东八区展示日期：云端 Date 转 YYYY-MM-DD 字符串。
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

/** 性别(0未知/1男/2女) → WHO 数据键 */
function sexKey(gender) {
  // 女用 girl，其余（男/未知）用 boy 做合理默认
  return Number(gender) === 2 ? "girl" : "boy";
}

Page({
  data: {
    hasBaby: false,
    babyName: "",
    babyGender: 0,
    loading: false,
    metric: "height", // 当前指标
    metricLabel: "身高",
    metricUnit: "cm",
    tabs: METRIC_ORDER.map((k) => ({ key: k, label: METRICS[k].label })),

    // 最新数据卡
    latest: null, // { dateText, heightText, weightText, headText }
    hasLatest: false,

    // 历史列表（按 date 倒序）
    historyList: [], // [{ _id, dateText, heightText, weightText, headText }]
    recordCount: 0,

    // 图表降级标记
    chartFailed: false,
    hasChartData: false,

    // 添加/编辑弹层
    formVisible: false,
    formMode: "add", // add | edit
    formRecordId: "",
    formDate: "",
    formHeight: "",
    formWeight: "",
    formHead: "",
    formSubmitting: false,
    today: ""
  },

  onLoad() {
    this.setData({ today: formatDate(new Date(), "YYYY-MM-DD") });
    this._records = []; // 原始记录（按 date 升序）
    this._canvasReady = false;
  },

  onShow() {
    this.refresh();
  },

  /**
   * 读取当前宝贝并拉取记录；切换宝贝后在 onShow 重新读取。
   */
  refresh() {
    const baby =
      app.getCurrentBaby ? app.getCurrentBaby() : app.globalData && app.globalData.currentBaby;
    if (!baby || !baby._id) {
      this.setData({
        hasBaby: false,
        babyName: "",
        latest: null,
        hasLatest: false,
        historyList: [],
        recordCount: 0,
        hasChartData: false
      });
      return;
    }
    this._baby = baby;
    this._babyId = baby._id;
    this.setData({
      hasBaby: true,
      babyName: baby.name || "宝贝",
      babyGender: baby.gender || 0
    });
    this.fetchData(baby._id);
  },

  fetchData(babyId) {
    this.setData({ loading: true });
    callFunction("growth", { action: "list", babyId: babyId })
      .then((res) => {
        if (!res || res.success !== true || !res.data) {
          throw new Error(res && res.error ? res.error : "加载失败");
        }
        const records = Array.isArray(res.data.records) ? res.data.records : [];
        this._records = records; // 已按 date 升序
        this.applyRecords();
      })
      .catch((err) => {
        console.error("[growth] fetch failed:", err);
        this.setData({ loading: false });
      });
  },

  /**
   * 把原始记录投影成最新卡 + 历史列表，并触发重绘。
   */
  applyRecords() {
    const records = this._records || [];
    // 最新一条：升序数组最后一条
    let latest = null;
    let hasLatest = false;
    if (records.length > 0) {
      const last = records[records.length - 1];
      latest = {
        dateText: formatCloudDate(last.date),
        heightText: metricText(last.height, "cm"),
        weightText: metricText(last.weight, "kg"),
        headText: metricText(last.headCircumference, "cm")
      };
      hasLatest = true;
    }
    // 历史列表：倒序
    const historyList = records
      .slice()
      .reverse()
      .map((r) => ({
        _id: r._id,
        dateText: formatCloudDate(r.date),
        heightText: metricText(r.height, "cm"),
        weightText: metricText(r.weight, "kg"),
        headText: metricText(r.headCircumference, "cm")
      }));

    this.setData(
      {
        loading: false,
        latest: latest,
        hasLatest: hasLatest,
        historyList: historyList,
        recordCount: records.length
      },
      () => {
        this.drawChart(this.data.metric);
      }
    );
  },

  /* ============ 指标切换 ============ */
  onSwitchMetric(e) {
    const key = e.currentTarget.dataset.key;
    if (!key || !METRICS[key] || key === this.data.metric) {
      return;
    }
    this.setData(
      {
        metric: key,
        metricLabel: METRICS[key].label,
        metricUnit: METRICS[key].unit
      },
      () => {
        this.drawChart(key);
      }
    );
  },

  /* ============ Canvas 绘制 ============ */
  /**
   * 根据当前指标取 WHO 数据与宝贝数据点，计算坐标映射并重绘。
   * canvas 2D 节点获取失败时降级（chartFailed=true），不抛错。
   * @param {string} metric
   */
  drawChart(metric) {
    const meta = METRICS[metric] || METRICS.height;
    const baby = this._baby;
    const records = this._records || [];

    // 宝贝数据点：{ month, value }
    const points = [];
    if (baby && baby.birthday) {
      records.forEach((r) => {
        const v = r[meta.field];
        if (typeof v === "number" && isFinite(v) && v > 0) {
          const month = calcMonthAge(baby.birthday, formatCloudDate(r.date) || r.date);
          points.push({ month: clamp(month, 0, 36), value: v });
        }
      });
    }
    const hasChartData = points.length > 0;
    this.setData({ hasChartData: hasChartData });

    const query = wx.createSelectorQuery().in(this);
    query
      .select("#growthCanvas")
      .fields({ node: true, size: true })
      .exec((resArr) => {
        const res = resArr && resArr[0];
        if (!res || !res.node) {
          // 降级：不画图，仅保留列表
          this.setData({ chartFailed: true });
          return;
        }
        try {
          this.renderCanvas(res, meta, points);
          this.setData({ chartFailed: false });
        } catch (err) {
          console.error("[growth] canvas render failed:", err);
          this.setData({ chartFailed: true });
        }
      });
  },

  /**
   * 实际绘制逻辑：处理 dpr 缩放、坐标映射、WHO 五线、宝贝折线、坐标轴与刻度。
   * @param {{node:Object,width:number,height:number}} res selectorQuery 结果
   * @param {Object} meta 指标元数据
   * @param {Array<{month:number,value:number}>} points 宝贝数据点
   */
  renderCanvas(res, meta, points) {
    const canvas = res.node;
    const ctx = canvas.getContext("2d");
    const dpr = (wx.getWindowInfo && wx.getWindowInfo().pixelRatio) || 2;
    const cssW = res.width;
    const cssH = res.height;
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, cssW, cssH);

    // 内边距（留坐标轴与标签空间）
    const padL = 42;
    const padR = 14;
    const padT = 14;
    const padB = 28;
    const plotW = cssW - padL - padR;
    const plotH = cssH - padT - padB;

    // X 轴范围：0..maxMonth（覆盖已有数据点，至少到宝贝当前月龄，下限 12）
    let maxMonth = 12;
    const baby = this._baby;
    if (baby && baby.birthday) {
      maxMonth = Math.max(maxMonth, clamp(calcMonthAge(baby.birthday, new Date()), 0, 36));
    }
    points.forEach((p) => {
      maxMonth = Math.max(maxMonth, p.month);
    });
    maxMonth = Math.min(36, Math.ceil(maxMonth));
    if (maxMonth < 1) {
      maxMonth = 1;
    }

    const sk = sexKey(this.data.babyGender);
    const who = WHO[sk] && WHO[sk][meta.who];
    const months = who ? who.months : [];

    // Y 轴范围：含 WHO 参考线(在 0..maxMonth 区间)与宝贝数据的 min/max，加 padding
    let yMin = Infinity;
    let yMax = -Infinity;
    if (who) {
      for (let i = 0; i < months.length; i++) {
        if (months[i] > maxMonth) {
          break;
        }
        yMin = Math.min(yMin, who.P3[i]);
        yMax = Math.max(yMax, who.P97[i]);
      }
    }
    points.forEach((p) => {
      yMin = Math.min(yMin, p.value);
      yMax = Math.max(yMax, p.value);
    });
    if (!isFinite(yMin) || !isFinite(yMax)) {
      yMin = 0;
      yMax = 1;
    }
    if (yMin === yMax) {
      yMin -= 1;
      yMax += 1;
    }
    const yPad = (yMax - yMin) * 0.08;
    yMin -= yPad;
    yMax += yPad;

    // 坐标映射
    const xOf = (m) => padL + (m / maxMonth) * plotW;
    const yOf = (v) => padT + (1 - (v - yMin) / (yMax - yMin)) * plotH;

    // --- 坐标轴 ---
    ctx.strokeStyle = "#EADFE0";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padL, padT);
    ctx.lineTo(padL, padT + plotH);
    ctx.lineTo(padL + plotW, padT + plotH);
    ctx.stroke();

    // Y 轴刻度（4 段）
    ctx.fillStyle = "#9B9B9B";
    ctx.font = "10px sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    const ySteps = 4;
    for (let i = 0; i <= ySteps; i++) {
      const val = yMin + ((yMax - yMin) * i) / ySteps;
      const y = yOf(val);
      ctx.fillText(val.toFixed(0), padL - 6, y);
      if (i > 0 && i < ySteps) {
        ctx.strokeStyle = "#F5ECEC";
        ctx.beginPath();
        ctx.moveTo(padL, y);
        ctx.lineTo(padL + plotW, y);
        ctx.stroke();
      }
    }

    // X 轴刻度（月龄，按 maxMonth 选步长）
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const xStep = maxMonth <= 12 ? 3 : maxMonth <= 24 ? 6 : 6;
    for (let m = 0; m <= maxMonth; m += xStep) {
      const x = xOf(m);
      ctx.fillStyle = "#9B9B9B";
      ctx.fillText(m + "月", x, padT + plotH + 6);
    }

    // --- WHO 五条参考线 ---
    if (who) {
      WHO_LINES.forEach((line) => {
        ctx.strokeStyle = line.color;
        ctx.lineWidth = line.main ? 2 : 1;
        ctx.beginPath();
        let started = false;
        for (let i = 0; i < months.length; i++) {
          if (months[i] > maxMonth) {
            // 画到 maxMonth 处的插值点后停止
            break;
          }
          const x = xOf(months[i]);
          const y = yOf(who[line.key][i]);
          if (!started) {
            ctx.moveTo(x, y);
            started = true;
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.stroke();
      });
    }

    // --- 宝贝实际数据折线 + 圆点 ---
    if (points.length > 0) {
      const sorted = points.slice().sort((a, b) => a.month - b.month);
      ctx.strokeStyle = BABY_COLOR;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      sorted.forEach((p, idx) => {
        const x = xOf(p.month);
        const y = yOf(p.value);
        if (idx === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });
      ctx.stroke();
      // 圆点
      ctx.fillStyle = BABY_COLOR;
      sorted.forEach((p) => {
        const x = xOf(p.month);
        const y = yOf(p.value);
        ctx.beginPath();
        ctx.arc(x, y, 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.fillStyle = "#FFFFFF";
        ctx.arc(x, y, 1.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = BABY_COLOR;
      });
    }
  },

  /* ============ 添加/编辑弹层 ============ */
  openAddForm() {
    if (!this.data.hasBaby) {
      return;
    }
    this.setData({
      formVisible: true,
      formMode: "add",
      formRecordId: "",
      formDate: this.data.today,
      formHeight: "",
      formWeight: "",
      formHead: "",
      formSubmitting: false
    });
  },

  onTapHistory(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) {
      return;
    }
    const record = (this._records || []).find((r) => r._id === id);
    if (!record) {
      return;
    }
    this.setData({
      formVisible: true,
      formMode: "edit",
      formRecordId: id,
      formDate: formatCloudDate(record.date) || this.data.today,
      formHeight: numToInput(record.height),
      formWeight: numToInput(record.weight),
      formHead: numToInput(record.headCircumference),
      formSubmitting: false
    });
  },

  closeForm() {
    this.setData({ formVisible: false });
  },

  // 阻止弹层内容点击冒泡到遮罩
  noop() {},

  onFormDateChange(e) {
    this.setData({ formDate: e.detail.value });
  },
  onFormHeightInput(e) {
    this.setData({ formHeight: e.detail.value });
  },
  onFormWeightInput(e) {
    this.setData({ formWeight: e.detail.value });
  },
  onFormHeadInput(e) {
    this.setData({ formHead: e.detail.value });
  },

  submitForm() {
    if (this.data.formSubmitting) {
      return;
    }
    const { formMode, formRecordId, formDate, formHeight, formWeight, formHead } = this.data;
    // 前端快速校验：至少一项有值
    const hasAny =
      String(formHeight).trim() !== "" ||
      String(formWeight).trim() !== "" ||
      String(formHead).trim() !== "";
    if (!hasAny) {
      wx.showToast({ title: "身高/体重/头围至少填一项", icon: "none" });
      return;
    }
    // 格式校验：填了的须为正数
    const invalid = [formHeight, formWeight, formHead].some((v) => {
      const s = String(v).trim();
      if (s === "") {
        return false;
      }
      const n = Number(s);
      return isNaN(n) || n <= 0;
    });
    if (invalid) {
      wx.showToast({ title: "数值需为正数", icon: "none" });
      return;
    }

    this.setData({ formSubmitting: true });
    let payload;
    let action;
    if (formMode === "edit") {
      action = "update";
      payload = {
        action: "update",
        recordId: formRecordId,
        date: formDate,
        height: String(formHeight).trim(),
        weight: String(formWeight).trim(),
        headCircumference: String(formHead).trim()
      };
    } else {
      action = "add";
      payload = {
        action: "add",
        babyId: this._babyId,
        date: formDate,
        height: String(formHeight).trim(),
        weight: String(formWeight).trim(),
        headCircumference: String(formHead).trim()
      };
    }
    callFunction("growth", payload)
      .then((res) => {
        if (!res || res.success !== true) {
          throw new Error(res && res.error ? res.error : "保存失败");
        }
        wx.showToast({ title: formMode === "edit" ? "已更新" : "已添加", icon: "success" });
        this.setData({ formVisible: false, formSubmitting: false });
        this.fetchData(this._babyId);
      })
      .catch((err) => {
        console.error("[growth] submit failed:", err);
        this.setData({ formSubmitting: false });
        wx.showToast({ title: (err && err.message) || "保存失败", icon: "none" });
      });
  },

  deleteRecord() {
    const recordId = this.data.formRecordId;
    if (!recordId) {
      return;
    }
    wx.showModal({
      title: "删除记录",
      content: "确定删除这条成长记录吗？",
      confirmColor: "#FF6B6B",
      success: (r) => {
        if (!r.confirm) {
          return;
        }
        this.setData({ formSubmitting: true });
        callFunction("growth", { action: "delete", recordId: recordId })
          .then((res) => {
            if (!res || res.success !== true) {
              throw new Error(res && res.error ? res.error : "删除失败");
            }
            wx.showToast({ title: "已删除", icon: "success" });
            this.setData({ formVisible: false, formSubmitting: false });
            this.fetchData(this._babyId);
          })
          .catch((err) => {
            console.error("[growth] delete failed:", err);
            this.setData({ formSubmitting: false });
            wx.showToast({ title: (err && err.message) || "删除失败", icon: "none" });
          });
      }
    });
  }
});

/* ============ 纯函数工具 ============ */
/** 数值 → "12.5cm" 文本；无值显示 "—" */
function metricText(v, unit) {
  if (typeof v === "number" && isFinite(v) && v > 0) {
    return `${trimNum(v)}${unit}`;
  }
  return "—";
}
/** 去掉多余 .0，保留最多 1 位小数 */
function trimNum(v) {
  const n = Math.round(v * 10) / 10;
  return Number.isInteger(n) ? String(n) : String(n);
}
/** 数值 → 表单输入初值（空值为 ""） */
function numToInput(v) {
  return typeof v === "number" && isFinite(v) && v > 0 ? String(trimNum(v)) : "";
}
/** 限幅 */
function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
