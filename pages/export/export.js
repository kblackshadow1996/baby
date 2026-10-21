// pages/export/export.js —— 数据导出（健康报告，方便就医给医生看）
// 流程：
//   1. 选时间范围（近1周/近1月/近3月/自定义）+ 导出内容多选（辅食/过敏/成长，默认全选）
//      + 导出格式（PDF 可直接打开转发，需云端放字体；网页版中文无忧，电脑端打开）。
//   2. "生成报告" 调 exportReport 云函数，拿到结构化 report + fileID。
//   3. 页面内用 report 渲染"报告预览"卡（核心体验，即便不下载也能看汇总）。
//   4. 下载/打开：
//      - PDF：wx.cloud.downloadFile → wx.openDocument({fileType:'pdf', showMenu:true})，
//              可转发给医生/家人；fontMissing 时提示改用网页版。
//      - HTML：wx.cloud.downloadFile 后提示在电脑端打开；尝试 openDocument（html 可能不支持），
//              并提供复制 fileID 兜底。
const app = getApp();
const { callFunction } = require("../../utils/cloud.js");
const { formatDate } = require("../../utils/date.js");

// 时间范围选项
const RANGE_OPTIONS = [
  { key: "week", label: "近1周" },
  { key: "month", label: "近1月" },
  { key: "3month", label: "近3月" },
  { key: "custom", label: "自定义" }
];
// 导出内容项
const CONTENT_OPTIONS = [
  { key: "meal", label: "辅食记录" },
  { key: "allergy", label: "过敏信息" },
  { key: "growth", label: "成长数据" }
];
// 导出格式
const FORMAT_OPTIONS = [
  { key: "pdf", label: "PDF" },
  { key: "html", label: "网页版" }
];

Page({
  data: {
    hasBaby: false,
    babyName: "",
    // 选项状态
    rangeOptions: RANGE_OPTIONS,
    range: "month",
    contentOptions: CONTENT_OPTIONS,
    // 内容选中映射
    contentSel: { meal: true, allergy: true, growth: true },
    formatOptions: FORMAT_OPTIONS,
    format: "pdf",
    // 自定义区间
    customStart: "",
    customEnd: "",
    today: "",
    // 生成状态
    generating: false,
    // 结果
    hasReport: false,
    report: null,
    fileID: "",
    resultFormat: "",
    fontMissing: false,
    downloading: false
  },

  onLoad() {
    const today = formatDate(new Date(), "YYYY-MM-DD");
    // 默认自定义区间：近一月
    const start = formatDate(new Date(Date.now() - 29 * 24 * 60 * 60 * 1000), "YYYY-MM-DD");
    this.setData({ today: today, customStart: start, customEnd: today });
  },

  onShow() {
    this.refreshBaby();
  },

  refreshBaby() {
    const baby =
      app.getCurrentBaby ? app.getCurrentBaby() : app.globalData && app.globalData.currentBaby;
    if (!baby || !baby._id) {
      this.setData({ hasBaby: false, babyName: "", hasReport: false, report: null });
      return;
    }
    this._baby = baby;
    this._babyId = baby._id;
    this.setData({ hasBaby: true, babyName: baby.name || "宝贝" });
  },

  /* ============ 选项交互 ============ */
  onSelectRange(e) {
    const key = e.currentTarget.dataset.key;
    if (key) {
      this.setData({ range: key });
    }
  },
  onToggleContent(e) {
    const key = e.currentTarget.dataset.key;
    if (!key) {
      return;
    }
    const next = Object.assign({}, this.data.contentSel);
    next[key] = !next[key];
    this.setData({ contentSel: next });
  },
  onSelectFormat(e) {
    const key = e.currentTarget.dataset.key;
    if (key) {
      this.setData({ format: key });
    }
  },
  onCustomStartChange(e) {
    this.setData({ customStart: e.detail.value });
  },
  onCustomEndChange(e) {
    this.setData({ customEnd: e.detail.value });
  },

  /** 收集已选内容 key 数组 */
  selectedContents() {
    const sel = this.data.contentSel;
    return CONTENT_OPTIONS.map((o) => o.key).filter((k) => sel[k]);
  },

  /* ============ 生成报告 ============ */
  onGenerate() {
    if (this.data.generating) {
      return;
    }
    if (!this.data.hasBaby) {
      wx.showToast({ title: "请先选择宝贝", icon: "none" });
      return;
    }
    const contents = this.selectedContents();
    if (contents.length === 0) {
      wx.showToast({ title: "请至少选一项导出内容", icon: "none" });
      return;
    }
    const payload = {
      babyId: this._babyId,
      range: this.data.range,
      contents: contents,
      format: this.data.format
    };
    if (this.data.range === "custom") {
      const s = this.data.customStart;
      const en = this.data.customEnd;
      if (!s || !en) {
        wx.showToast({ title: "请选择自定义起止日期", icon: "none" });
        return;
      }
      if (s > en) {
        wx.showToast({ title: "开始日期不能晚于结束", icon: "none" });
        return;
      }
      payload.startDate = s;
      payload.endDate = en;
    }
    this.setData({ generating: true });
    wx.showLoading({ title: "生成中...", mask: true });
    callFunction("exportReport", payload)
      .then((res) => {
        wx.hideLoading();
        if (!res || res.success !== true || !res.data) {
          throw new Error(res && res.error ? res.error : "生成失败");
        }
        const data = res.data;
        this.setData({
          generating: false,
          hasReport: true,
          report: this.decorateReport(data.report),
          fileID: data.fileID || "",
          resultFormat: data.format || this.data.format,
          fontMissing: !!data.fontMissing
        });
        wx.showToast({ title: "报告已生成", icon: "success" });
        if (data.format === "pdf" && data.fontMissing) {
          setTimeout(() => {
            wx.showToast({
              title: "PDF 中文字体未配置，建议改用网页版",
              icon: "none",
              duration: 3000
            });
          }, 1200);
        }
      })
      .catch((err) => {
        wx.hideLoading();
        console.error("[export] generate failed:", err);
        this.setData({ generating: false });
        wx.showToast({ title: (err && err.message) || "生成失败", icon: "none" });
      });
  },

  /**
   * 把结构化 report 加工为预览友好的展示字段（拼接数组文本、数值占位等）。
   * @param {Object} report
   * @returns {Object}
   */
  decorateReport(report) {
    if (!report) {
      return null;
    }
    const r = JSON.parse(JSON.stringify(report));
    // 成长
    if (r.growth && r.growth.latest) {
      const l = r.growth.latest;
      l.heightText = numText(l.height, "cm");
      l.weightText = numText(l.weight, "kg");
      l.headText = numText(l.headCircumference, "cm");
    }
    if (r.growth && Array.isArray(r.growth.records)) {
      r.growth.records = r.growth.records.map((it) => ({
        date: it.date,
        heightText: numText(it.height, "cm"),
        weightText: numText(it.weight, "kg"),
        headText: numText(it.headCircumference, "cm")
      }));
    }
    // 辅食：分类计数转数组
    if (r.meal && r.meal.triedByCategory) {
      r.meal.categoryList = Object.keys(r.meal.triedByCategory).map((c) => ({
        name: c,
        count: r.meal.triedByCategory[c]
      }));
    }
    // 过敏：数组转文本
    if (r.allergy && Array.isArray(r.allergy.allergens)) {
      r.allergy.allergens = r.allergy.allergens.map((a) => ({
        foodName: a.foodName,
        status: a.status,
        firstOccurrence: a.firstOccurrence || "—",
        lastOccurrence: a.lastOccurrence || "—",
        symptomsText: (a.symptomsSummary || []).join("、")
      }));
    }
    if (r.allergy && Array.isArray(r.allergy.records)) {
      r.allergy.records = r.allergy.records.map((it) => ({
        date: it.date,
        symptomsText: (it.symptoms || []).join("、") || "—",
        suspectedText: (it.suspectedFoods || []).join("、") || "—",
        note: it.note || ""
      }));
    }
    return r;
  },

  /* ============ 下载 / 打开 ============ */
  onOpenFile() {
    if (this.data.downloading) {
      return;
    }
    const fileID = this.data.fileID;
    if (!fileID) {
      wx.showToast({ title: "无可下载文件", icon: "none" });
      return;
    }
    if (!wx.cloud || !wx.cloud.downloadFile) {
      wx.showToast({ title: "云开发不可用", icon: "none" });
      return;
    }
    this.setData({ downloading: true });
    wx.showLoading({ title: "下载中...", mask: true });
    wx.cloud
      .downloadFile({ fileID: fileID })
      .then((res) => {
        wx.hideLoading();
        this.setData({ downloading: false });
        const filePath = res.tempFilePath;
        if (!filePath) {
          throw new Error("下载失败");
        }
        if (this.data.resultFormat === "pdf") {
          this.openPdf(filePath);
        } else {
          this.openHtml(filePath);
        }
      })
      .catch((err) => {
        wx.hideLoading();
        this.setData({ downloading: false });
        console.error("[export] download failed:", err);
        wx.showToast({ title: "下载失败", icon: "none" });
      });
  },

  /** 打开 PDF：showMenu 允许右上角转发给医生/家人 */
  openPdf(filePath) {
    wx.openDocument({
      filePath: filePath,
      fileType: "pdf",
      showMenu: true,
      fail: (err) => {
        console.error("[export] openDocument pdf failed:", err);
        wx.showToast({ title: "打开失败，可改用网页版导出", icon: "none" });
      }
    });
  },

  /** 打开 HTML：openDocument 多不支持 html，失败兜底提示电脑端打开/复制 fileID */
  openHtml(filePath) {
    wx.openDocument({
      filePath: filePath,
      showMenu: true,
      fail: () => {
        wx.showModal({
          title: "网页版报告已生成",
          content: "手机端可能无法直接打开网页文件，建议在电脑端浏览器打开。可复制文件链接保存。",
          confirmText: "复制链接",
          cancelText: "知道了",
          success: (r) => {
            if (r.confirm) {
              wx.setClipboardData({
                data: this.data.fileID,
                success: () => wx.showToast({ title: "链接已复制", icon: "success" })
              });
            }
          }
        });
      }
    });
  }
});

/* ============ 纯函数工具 ============ */
/** 数值 → "12.5cm"；空值 "—" */
function numText(v, unit) {
  if (typeof v === "number" && isFinite(v) && v > 0) {
    return `${v}${unit}`;
  }
  return "—";
}
