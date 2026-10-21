// pages/record/daily/daily.js —— 每日记录：周日历选择 + 当天餐次列表
const app = getApp();
const { callFunction } = require("../../../utils/cloud.js");
const { getWeekDates, formatDate, isSameDay, calcAgeText } = require("../../../utils/date.js");

// 餐次中文名
const MEAL_TYPE_LABEL = {
  breakfast: "早餐",
  lunch: "午餐",
  dinner: "晚餐",
  snack_am: "上午加餐",
  snack_pm: "下午加餐",
  night: "夜宵",
  custom: "自定义"
};
// 餐次 emoji 图标
const MEAL_TYPE_ICON = {
  breakfast: "🌅",
  lunch: "☀️",
  dinner: "🌙",
  snack_am: "🍎",
  snack_pm: "🍪",
  night: "🌛",
  custom: "🍽"
};
// 份量档位中文
const AMOUNT_LEVEL_LABEL = {
  little: "一点点",
  half: "一半",
  most: "大部分",
  all: "全部吃光"
};
// 星期标签（周一~周日）
const WEEK_LABELS = ["一", "二", "三", "四", "五", "六", "日"];

Page({
  data: {
    hasBaby: false,
    babyName: "",
    babyAgeText: "",
    weekMonthText: "", // 当前周所属 "X月"
    weekDays: [], // [{ dateStr, day, weekLabel, isSelected, isToday, hasRecord }]
    selectedDate: "", // YYYY-MM-DD
    selectedDateText: "", // 友好文本
    records: [],
    loading: false
  },

  onLoad() {
    const today = new Date();
    this._centerDate = today; // 当前周中心
    this.data.selectedDate = formatDate(today, "YYYY-MM-DD");
    this._markedDates = {}; // { 'YYYY-MM-DD': true }
  },

  onShow() {
    // 从新增/编辑页返回或切换宝贝后刷新
    this.refresh();
  },

  /**
   * 统一刷新：读取当前宝贝 → 若无则引导，否则重建周日历并加载选中日
   */
  refresh() {
    const baby = app.getCurrentBaby ? app.getCurrentBaby() : (app.globalData && app.globalData.currentBaby);
    if (!baby || !baby._id) {
      this.setData({ hasBaby: false, babyName: "", babyAgeText: "", records: [], weekDays: [] });
      this._currentBabyId = null;
      return;
    }
    const babyChanged = this._currentBabyId !== baby._id;
    this._currentBabyId = baby._id;
    this.setData({
      hasBaby: true,
      babyName: baby.name || "宝贝",
      babyAgeText: baby.birthday ? calcAgeText(baby.birthday) : ""
    });
    if (babyChanged) {
      // 切换宝贝：回到今天
      this._centerDate = new Date();
      this.setData({ selectedDate: formatDate(new Date(), "YYYY-MM-DD") });
    }
    this.rebuildWeek();
    this.loadWeekMarks().then(() => this.syncWeekMarks());
    this.loadDayRecords(this.data.selectedDate);
  },

  /**
   * 重建当前周的 weekDays 渲染数组（不含打点结果，打点随后 syncWeekMarks 合并）
   */
  rebuildWeek() {
    const week = getWeekDates(this._centerDate);
    const todayStr = formatDate(new Date(), "YYYY-MM-DD");
    const selected = this.data.selectedDate;
    const weekDays = week.map((d, i) => {
      const dateStr = formatDate(d, "YYYY-MM-DD");
      return {
        dateStr,
        day: formatDate(d, "DD"),
        weekLabel: WEEK_LABELS[i],
        isSelected: dateStr === selected,
        isToday: dateStr === todayStr,
        hasRecord: !!this._markedDates[dateStr]
      };
    });
    // 当前周所属月份：取周中间（周四）那天的月份更直观，这里用第一天的月份
    const monthText = formatDate(week[0], "MM") + "月";
    this.setData({ weekDays, weekMonthText: monthText });
  },

  /**
   * 把 _markedDates 合并进 weekDays 的 hasRecord
   */
  syncWeekMarks() {
    const weekDays = this.data.weekDays.map((wd) => ({
      ...wd,
      hasRecord: !!this._markedDates[wd.dateStr]
    }));
    this.setData({ weekDays });
  },

  /**
   * 查询当前周区间内有记录的日期集合，更新 _markedDates
   */
  loadWeekMarks() {
    if (!this._currentBabyId) {
      return Promise.resolve();
    }
    const week = getWeekDates(this._centerDate);
    const startDate = formatDate(week[0], "YYYY-MM-DD");
    const endDate = formatDate(week[6], "YYYY-MM-DD");
    return callFunction("meal", {
      action: "listRange",
      babyId: this._currentBabyId,
      startDate,
      endDate
    })
      .then((res) => {
        const marks = {};
        if (res && res.success && res.data && Array.isArray(res.data.records)) {
          res.data.records.forEach((r) => {
            const key = this.recordDateKey(r.date);
            if (key) {
              marks[key] = true;
            }
          });
        }
        this._markedDates = marks;
      })
      .catch(() => {
        this._markedDates = {};
      });
  },

  /**
   * 把记录里的 date（云端 Date，序列化为 ISO 字符串或对象）转为 YYYY-MM-DD（东八区）
   */
  recordDateKey(date) {
    if (!date) {
      return "";
    }
    let d;
    if (typeof date === "string") {
      d = new Date(date);
    } else if (typeof date === "object" && date.$date) {
      d = new Date(date.$date);
    } else {
      d = new Date(date);
    }
    if (isNaN(d.getTime())) {
      return "";
    }
    // 转东八区日历日期
    const utc8 = new Date(d.getTime() + 8 * 60 * 60 * 1000);
    const y = utc8.getUTCFullYear();
    const m = utc8.getUTCMonth() + 1;
    const day = utc8.getUTCDate();
    return `${y}-${m < 10 ? "0" + m : m}-${day < 10 ? "0" + day : day}`;
  },

  /**
   * 加载某天记录并做展示预处理
   */
  loadDayRecords(dateStr) {
    if (!this._currentBabyId) {
      this.setData({ records: [], selectedDateText: this.friendlyDateText(dateStr) });
      return;
    }
    this.setData({ loading: true, selectedDateText: this.friendlyDateText(dateStr) });
    callFunction("meal", {
      action: "listByDate",
      babyId: this._currentBabyId,
      date: dateStr
    })
      .then((res) => {
        let records = [];
        if (res && res.success && res.data && Array.isArray(res.data.records)) {
          records = res.data.records.map((r) => this.decorateRecord(r));
        }
        this.setData({ records, loading: false });
      })
      .catch(() => {
        this.setData({ records: [], loading: false });
      });
  },

  /**
   * 给单条记录补充展示字段
   */
  decorateRecord(r) {
    const type = r.mealType || "custom";
    const label =
      type === "custom"
        ? (r.customMealName && r.customMealName.trim()) || "自定义"
        : MEAL_TYPE_LABEL[type] || "其他";
    const foods = Array.isArray(r.foods) ? r.foods : [];
    const foodsView = foods.map((f) => ({
      name: f.name || "",
      amountText: this.amountText(f)
    }));
    return {
      _id: r._id,
      mealTypeLabel: label,
      mealIcon: MEAL_TYPE_ICON[type] || MEAL_TYPE_ICON.custom,
      mealTime: r.mealTime || "",
      note: r.note || "",
      hasAllergyFlag: !!r.hasAllergyFlag,
      foods: foodsView
    };
  },

  /**
   * 份量文本：preset→档位中文；custom→数值+单位
   */
  amountText(food) {
    if (!food) {
      return "";
    }
    if (food.amountMode === "custom") {
      const v = food.amountValue !== undefined && food.amountValue !== null ? food.amountValue : "";
      const u = food.amountUnit || "";
      return `${v}${u}`.trim();
    }
    if (food.amountMode === "preset") {
      return AMOUNT_LEVEL_LABEL[food.amountLevel] || "";
    }
    return "";
  },

  /**
   * 友好日期文本：今天显示"今天"，否则 "M月D日 周X"
   */
  friendlyDateText(dateStr) {
    if (!dateStr) {
      return "";
    }
    const parts = dateStr.split("-").map((n) => parseInt(n, 10));
    const d = new Date(parts[0], parts[1] - 1, parts[2]);
    const weekLabel = WEEK_LABELS[(d.getDay() + 6) % 7];
    const base = `${d.getMonth() + 1}月${d.getDate()}日 周${weekLabel}`;
    if (isSameDay(d, new Date())) {
      return `今天 · ${base}`;
    }
    return base;
  },

  /**
   * 点击某天：选中并加载
   */
  onSelectDay(e) {
    const dateStr = e.currentTarget.dataset.date;
    if (!dateStr || dateStr === this.data.selectedDate) {
      return;
    }
    this.setData({ selectedDate: dateStr });
    const weekDays = this.data.weekDays.map((wd) => ({
      ...wd,
      isSelected: wd.dateStr === dateStr
    }));
    this.setData({ weekDays });
    this.loadDayRecords(dateStr);
  },

  /**
   * 上一周
   */
  onPrevWeek() {
    this._centerDate = new Date(this._centerDate.getTime() - 7 * 24 * 60 * 60 * 1000);
    this.rebuildWeek();
    this.loadWeekMarks().then(() => this.syncWeekMarks());
  },

  /**
   * 下一周
   */
  onNextWeek() {
    this._centerDate = new Date(this._centerDate.getTime() + 7 * 24 * 60 * 60 * 1000);
    this.rebuildWeek();
    this.loadWeekMarks().then(() => this.syncWeekMarks());
  },

  /**
   * 点击记录卡片 → 编辑（Task 9 实现）
   */
  onEditRecord(e) {
    const recordId = e.currentTarget.dataset.id;
    if (!recordId) {
      return;
    }
    wx.navigateTo({
      url: `/pages/record/add/add?recordId=${recordId}&date=${this.data.selectedDate}`
    });
  },

  /**
   * 浮动 + 新增记录
   */
  onAddRecord() {
    wx.navigateTo({
      url: `/pages/record/add/add?date=${this.data.selectedDate}`
    });
  },

  /**
   * 无宝贝 → 去添加宝贝
   */
  onGoAddBaby() {
    wx.navigateTo({ url: "/pages/baby/profile/profile" });
  },
  /** 转发好友（Task18，纯分享无副作用） */
  onShareAppMessage() {
    return {
      title: "小饭团成长记 - 记录宝宝的每一餐成长",
      path: "/pages/index/index"
    };
  }
});
