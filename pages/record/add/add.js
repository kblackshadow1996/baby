// pages/record/add/add.js —— 添加/编辑餐次记录
// 入口参数（options）：
//   date        YYYY-MM-DD，缺省今天
//   recordId    有则进入编辑模式（meal getById 回填）
//   mealType    来自首页快捷入口，预选餐别
//   recipeId    来自食谱详情"加入记录"，预填一个 food
//   recipeTitle 同上（encodeURIComponent 过），作为 food.name
// 契约见 docs/data-model.md meal_records / food_timeline。
const app = getApp();
const { callFunction } = require("../../../utils/cloud.js");
const { formatDate, calcMonthAge, getStageByMonth } = require("../../../utils/date.js");
const allergen = require("../../../utils/allergen.js");
// 预设餐别选项（与 daily 页语义一致，custom 单列）
const MEAL_TYPE_OPTIONS = [
  { value: "breakfast", label: "早餐", icon: "🌅" },
  { value: "lunch", label: "午餐", icon: "☀" },
  { value: "dinner", label: "晚餐", icon: "🌙" },
  { value: "snack_am", label: "上午加餐", icon: "🍎" },
  { value: "snack_pm", label: "下午加餐", icon: "🍪" },
  { value: "night", label: "夜宵", icon: "🌛" },
  { value: "custom", label: "自定义", icon: "🍽" }
];
// 份量档位（与 daily 的 AMOUNT_LEVEL_LABEL 对齐）
const AMOUNT_LEVEL_OPTIONS = [
  { value: "little", label: "一点点" },
  { value: "half", label: "一半" },
  { value: "most", label: "大部分" },
  { value: "all", label: "全部吃光" }
];
// 份量单位
const AMOUNT_UNITS = ["ml", "g", "勺", "个"];
// 食谱选择弹层加载条数
const RECIPE_PICKER_SIZE = 20;
/**
 * 构造一个默认 food 条目
 * @param {Object} [init]
 * @returns {Object}
 */
function makeFood(init) {
  const base = {
    name: "",
    amountMode: "preset",
    amountLevel: "all",
    amountValue: "",
    amountUnit: "g",
    recipeId: ""
  };
  return Object.assign(base, init || {});
}
Page({
  data: {
    isEdit: false,
    pageTitle: "添加记录",
    loading: false,
    saving: false,
    date: "", // YYYY-MM-DD
    mealTypeOptions: MEAL_TYPE_OPTIONS,
    amountLevelOptions: AMOUNT_LEVEL_OPTIONS,
    amountUnits: AMOUNT_UNITS,
    mealType: "breakfast",
    customMealName: "",
    mealTime: "",
    foods: [makeFood()],
    note: "",
    // 食谱选择弹层
    recipePickerVisible: false,
    recipePickerLoading: false,
    recipeList: [], // [{ _id, title }]
    recipePickerIndex: -1 // 当前为哪个 food 条目选择
  },
  onLoad(options) {
    const opts = options || {};
    const baby = app.getCurrentBaby ? app.getCurrentBaby() : (app.globalData && app.globalData.currentBaby);
    if (!baby || !baby._id) {
      wx.showToast({ title: "请先选择宝贝", icon: "none" });
      setTimeout(() => wx.navigateBack({ delta: 1 }), 800);
      return;
    }
    this._baby = baby;
    // 记录用户已确认过的命中食物名，避免输入时+保存时重复打扰
    this._confirmedFoods = {};
    // 全局过敏原若为空则异步加载一次（供输入提醒用）
    this.ensureAlerts();
    const date =
      typeof opts.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(opts.date)
        ? opts.date
        : formatDate(new Date(), "YYYY-MM-DD");
    const recordId = opts.recordId ? String(opts.recordId) : "";
    if (recordId) {
      // 编辑模式：回填
      this.setData({
        isEdit: true,
        pageTitle: "编辑记录",
        date: date
      });
      this._recordId = recordId;
      this.fetchRecord(recordId);
      return;
    }
    // 新增模式
    const patch = {
      isEdit: false,
      pageTitle: "添加记录",
      date: date,
      mealTime: formatDate(new Date(), "HH:mm")
    };
    // 首页快捷入口预选餐别
    if (opts.mealType && MEAL_TYPE_OPTIONS.some((o) => o.value === opts.mealType)) {
      patch.mealType = opts.mealType;
    }
    // 食谱详情"加入记录"预填一个 food
    if (opts.recipeId || opts.recipeTitle) {
      const title = opts.recipeTitle ? decodeURIComponent(opts.recipeTitle) : "";
      patch.foods = [
        makeFood({
          name: title,
          recipeId: opts.recipeId ? String(opts.recipeId) : "",
          amountMode: "preset",
          amountLevel: "all"
        })
      ];
    }
    this.setData(patch, () => {
      // 从食谱回填的食物名也做一次提醒（回填后立即检测）
      if (patch.foods && patch.foods[0] && patch.foods[0].name) {
        this.checkFoodAllergy(0, patch.foods[0].name);
      }
    });
  },
  /**
   * 确保全局过敏原已加载：为空且有当前宝贝时触发 app.loadAllergyAlerts()。
   * @returns {Promise<string[]>}
   */
  ensureAlerts() {
    const alerts = this.readAlerts();
    const baby = this._baby;
    if (alerts.length === 0 && baby && baby._id && typeof app.loadAllergyAlerts === "function") {
      return app
        .loadAllergyAlerts()
        .then(() => this.readAlerts())
        .catch(() => this.readAlerts());
    }
    return Promise.resolve(alerts);
  },
  /** 读取当前宝贝过敏原名称数组（缺省 []） */
  readAlerts() {
    const alerts = app.globalData && app.globalData.allergyAlerts;
    return Array.isArray(alerts) ? alerts : [];
  },
  /** 读取过敏原详情映射（{ foodName: { status, symptomsSummary[] } }） */
  readAlertMap() {
    const map = app.globalData && app.globalData.allergyAlertMap;
    return map && typeof map === "object" ? map : {};
  },
  /**
   * 编辑模式拉取记录并回填
   */
  fetchRecord(recordId) {
    this.setData({ loading: true });
    callFunction("meal", { action: "getById", recordId: recordId })
      .then((res) => {
        if (!res || res.success !== true || !res.data) {
          throw new Error(res && res.error ? res.error : "记录不存在");
        }
        const r = res.data;
        const foods = Array.isArray(r.foods) && r.foods.length > 0
          ? r.foods.map((f) => makeFood({
              name: f.name || "",
              amountMode: f.amountMode === "custom" ? "custom" : "preset",
              amountLevel: f.amountLevel || "all",
              amountValue: f.amountValue !== undefined && f.amountValue !== null ? String(f.amountValue) : "",
              amountUnit: f.amountUnit || "g",
              recipeId: f.recipeId || ""
            }))
          : [makeFood()];
        this.setData({
          loading: false,
          mealType: r.mealType || "breakfast",
          customMealName: r.customMealName || "",
          mealTime: r.mealTime || "",
          foods: foods,
          note: r.note || ""
        });
      })
      .catch((err) => {
        console.error("[record/add] fetch failed:", err);
        this.setData({ loading: false });
        wx.showToast({ title: "记录加载失败", icon: "none" });
        setTimeout(() => wx.navigateBack({ delta: 1 }), 800);
      });
  },
  /* ============ 餐别 ============ */
  onSelectMealType(e) {
    const value = e.currentTarget.dataset.value;
    if (!value) {
      return;
    }
    this.setData({ mealType: value });
  },
  onCustomMealNameInput(e) {
    this.setData({ customMealName: e.detail.value });
  },
  /* ============ 用餐时间 ============ */
  onTimeChange(e) {
    this.setData({ mealTime: e.detail.value });
  },
  /* ============ 食物条目 ============ */
  onFoodNameInput(e) {
    const idx = e.currentTarget.dataset.index;
    this.setData({ [`foods[${idx}].name`]: e.detail.value });
  },
  /**
   * 食物名输入失焦：对该条食物名做过敏原检测并提醒。
   */
  onFoodNameBlur(e) {
    const idx = e.currentTarget.dataset.index;
    if (idx === undefined || idx === null) {
      return;
    }
    const food = this.data.foods[idx];
    const name = food ? String(food.name || "").trim() : "";
    this.checkFoodAllergy(Number(idx), name);
  },
  /**
   * 拼接"上次反应"说明：从 allergyAlertMap 取对应过敏原的 symptomsSummary。
   * 命中多条取第一条有症状的；取不到返回空串（提示语省略该部分）。
   * @param {string[]} allergenNames 命中的过敏原名
   * @returns {string}
   */
  buildLastReactionText(allergenNames) {
    const map = this.readAlertMap();
    for (let i = 0; i < allergenNames.length; i++) {
      const info = map[allergenNames[i]];
      if (info && Array.isArray(info.symptomsSummary) && info.symptomsSummary.length > 0) {
        return info.symptomsSummary.join("、");
      }
    }
    return "";
  },
  /**
   * 检测单条食物名是否命中过敏原并弹提醒。
   * 命中→wx.showModal；取消清空该食物名；仍然添加→记入 _confirmedFoods。
   * @param {number} idx foods 下标
   * @param {string} name 食物名
   */
  checkFoodAllergy(idx, name) {
    const foodName = String(name || "").trim();
    if (!foodName || idx < 0 || idx >= this.data.foods.length) {
      return;
    }
    const alerts = this.readAlerts();
    if (!allergen.matchName(foodName, alerts)) {
      return;
    }
    const hitAllergens = allergen.matchedAllergensForFood(foodName, alerts);
    const allergenText = hitAllergens.join("、");
    const babyName = this._baby && this._baby.name ? this._baby.name : "宝宝";
    const lastReaction = this.buildLastReactionText(hitAllergens);
    let content = `⚠️ ${foodName} 命中 ${babyName} 的疑似过敏原【${allergenText}】。`;
    if (lastReaction) {
      content += `上次反应：${lastReaction}。`;
    }
    content += "是否仍然添加？";
    wx.showModal({
      title: "过敏原提醒",
      content: content,
      confirmText: "仍然添加",
      cancelText: "取消",
      confirmColor: "#FF6B6B",
      success: (r) => {
        if (r.confirm) {
          // 记为已确认，保存时不再重复提醒
          this._confirmedFoods[foodName] = true;
        } else if (r.cancel) {
          // 取消：清空该食物名，让用户修改
          this.setData({ [`foods[${idx}].name`]: "" });
        }
      }
    });
  },
  onAmountModeChange(e) {
    const idx = e.currentTarget.dataset.index;
    const mode = e.currentTarget.dataset.mode;
    if (mode !== "preset" && mode !== "custom") {
      return;
    }
    this.setData({ [`foods[${idx}].amountMode`]: mode });
  },
  onAmountLevelSelect(e) {
    const idx = e.currentTarget.dataset.index;
    const level = e.currentTarget.dataset.level;
    this.setData({ [`foods[${idx}].amountLevel`]: level });
  },
  onAmountValueInput(e) {
    const idx = e.currentTarget.dataset.index;
    this.setData({ [`foods[${idx}].amountValue`]: e.detail.value });
  },
  onAmountUnitChange(e) {
    const idx = e.currentTarget.dataset.index;
    const unit = AMOUNT_UNITS[Number(e.detail.value)] || "g";
    this.setData({ [`foods[${idx}].amountUnit`]: unit });
  },
  onAddFood() {
    const foods = this.data.foods.concat([makeFood()]);
    this.setData({ foods: foods });
  },
  onRemoveFood(e) {
    const idx = Number(e.currentTarget.dataset.index);
    if (this.data.foods.length <= 1) {
      wx.showToast({ title: "至少保留一个食物", icon: "none" });
      return;
    }
    const foods = this.data.foods.slice();
    foods.splice(idx, 1);
    this.setData({ foods: foods });
  },
  /* ============ 备注 ============ */
  onNoteInput(e) {
    this.setData({ note: e.detail.value });
  },
  /* ============ 食谱选择弹层 ============ */
  openRecipePicker(e) {
    const idx = Number(e.currentTarget.dataset.index);
    this.setData({ recipePickerVisible: true, recipePickerIndex: idx });
    if (this.data.recipeList.length === 0) {
      this.loadRecipeList();
    }
  },
  closeRecipePicker() {
    this.setData({ recipePickerVisible: false, recipePickerIndex: -1 });
  },
  noop() {},
  /**
   * 懒加载食谱列表：按当前宝贝月龄段取官方食谱前 N 条
   */
  loadRecipeList() {
    this.setData({ recipePickerLoading: true });
    const params = { action: "list", tab: "official", page: 1, pageSize: RECIPE_PICKER_SIZE };
    const baby = this._baby;
    if (baby && baby.birthday) {
      try {
        const month = calcMonthAge(baby.birthday);
        const stage = getStageByMonth(month);
        if (stage) {
          params.monthAgeMin = stage.min !== undefined ? stage.min : 0;
          params.monthAgeMax = stage.max !== undefined ? stage.max : params.monthAgeMin;
        }
      } catch (e) {
        // 月龄计算失败则不带月龄，取通用列表
      }
    }
    callFunction("recipe", params)
      .then((res) => {
        let list = [];
        if (res && res.success && res.data && Array.isArray(res.data.list)) {
          list = res.data.list.map((r) => ({ _id: r._id, title: r.title || "" }));
        }
        this.setData({ recipeList: list, recipePickerLoading: false });
      })
      .catch(() => {
        this.setData({ recipeList: [], recipePickerLoading: false });
      });
  },
  onPickRecipe(e) {
    const id = e.currentTarget.dataset.id;
    const title = e.currentTarget.dataset.title || "";
    const idx = this.data.recipePickerIndex;
    if (idx < 0 || idx >= this.data.foods.length) {
      this.closeRecipePicker();
      return;
    }
    this.setData(
      {
        [`foods[${idx}].name`]: title,
        [`foods[${idx}].recipeId`]: id ? String(id) : "",
        recipePickerVisible: false,
        recipePickerIndex: -1
      },
      () => {
        // 从食谱回填后立即做过敏原提醒
        this.checkFoodAllergy(idx, title);
      }
    );
  },
  /* ============ 校验与组装 ============ */
  /**
   * 校验并组装 foods 与基本字段，返回 { ok, error, payload }
   */
  buildPayload() {
    const mealType = this.data.mealType;
    if (mealType === "custom" && !String(this.data.customMealName || "").trim()) {
      return { ok: false, error: "请填写自定义餐别名称" };
    }
    const rawFoods = this.data.foods || [];
    const foods = [];
    for (let i = 0; i < rawFoods.length; i++) {
      const f = rawFoods[i];
      const name = String(f.name || "").trim();
      if (!name) {
        continue; // 清理空条目
      }
      const item = { name: name, amountMode: f.amountMode === "custom" ? "custom" : "preset" };
      if (item.amountMode === "preset") {
        item.amountLevel = f.amountLevel || "all";
      } else {
        const v = Number(f.amountValue);
        if (f.amountValue === "" || isNaN(v) || v < 0) {
          return { ok: false, error: `「${name}」请填写有效的精确份量` };
        }
        item.amountValue = v;
        item.amountUnit = f.amountUnit || "g";
      }
      if (f.recipeId) {
        item.recipeId = f.recipeId;
      }
      foods.push(item);
    }
    if (foods.length === 0) {
      return { ok: false, error: "请至少填写一个食物名称" };
    }
    const payload = {
      mealType: mealType,
      customMealName: mealType === "custom" ? String(this.data.customMealName || "").trim() : "",
      mealTime: this.data.mealTime || "",
      foods: foods,
      note: String(this.data.note || "").trim()
    };
    return { ok: true, payload: payload };
  },
  /**
   * 保存前整单过敏原汇总确认：对所有 foods 名跑 matchFoodsAgainstAlerts，
   * 若有命中且用户此前未确认过该食物名，弹一次汇总 showModal。
   * @param {Array} foods buildPayload 后的 foods
   * @returns {Promise<boolean>} true=继续保存；false=用户取消
   */
  confirmAllergyBeforeSave(foods) {
    const alerts = this.readAlerts();
    const names = foods.map((f) => f.name);
    const hits = allergen.matchFoodsAgainstAlerts(names, alerts);
    // 过滤掉用户在输入时已确认的食物名
    const pending = hits.filter((h) => !this._confirmedFoods[h.foodName]);
    if (pending.length === 0) {
      return Promise.resolve(true);
    }
    const babyName = this._baby && this._baby.name ? this._baby.name : "宝宝";
    const lines = pending.map((h) => `${h.foodName} → 【${h.allergen}】`);
    const content = `⚠️ 以下食物命中 ${babyName} 的疑似过敏原：\n${lines.join("\n")}\n是否仍然保存？`;
    return new Promise((resolve) => {
      wx.showModal({
        title: "过敏原提醒",
        content: content,
        confirmText: "仍然保存",
        cancelText: "返回修改",
        confirmColor: "#FF6B6B",
        success: (r) => {
          if (r.confirm) {
            pending.forEach((h) => {
              this._confirmedFoods[h.foodName] = true;
            });
            resolve(true);
          } else {
            resolve(false);
          }
        },
        fail: () => resolve(false)
      });
    });
  },
  /**
   * 保存：区分新增/编辑；markAllergy=true 时保存后跳转过敏记录页。
   * 保存前先做整单过敏原汇总确认。
   */
  doSave(markAllergy) {
    if (this.data.saving) {
      return;
    }
    const built = this.buildPayload();
    if (!built.ok) {
      wx.showToast({ title: built.error, icon: "none" });
      return;
    }
    const baby = this._baby;
    if (!baby || !baby._id) {
      wx.showToast({ title: "请先选择宝贝", icon: "none" });
      return;
    }
    // 保存前整单过敏原汇总确认
    this.confirmAllergyBeforeSave(built.payload.foods).then((proceed) => {
      if (!proceed) {
        return;
      }
      this.submitSave(built.payload, markAllergy, baby);
    });
  },
  /**
   * 真正发起保存请求
   */
  submitSave(payload, markAllergy, baby) {
    this.setData({ saving: true });
    const isEdit = this.data.isEdit;
    const req = isEdit
      ? Object.assign({ action: "update", recordId: this._recordId, date: this.data.date }, payload)
      : Object.assign({ action: "add", babyId: baby._id, date: this.data.date }, payload);
    callFunction("meal", req)
      .then((res) => {
        if (!res || res.success !== true || !res.data) {
          throw new Error(res && res.error ? res.error : "保存失败");
        }
        const record = res.data;
        this.setData({ saving: false });
        wx.showToast({ title: isEdit ? "已更新" : "已保存", icon: "success" });
        if (markAllergy) {
          const recordId = record._id || this._recordId;
          // Task 10 消费：带 mealRecordId / babyId / date 跳转过敏记录新增页
          const url =
            `/pages/allergy/detail/detail?mode=add` +
            `&mealRecordId=${recordId}` +
            `&babyId=${baby._id}` +
            `&date=${this.data.date}`;
          setTimeout(() => wx.navigateTo({ url: url }), 600);
          return;
        }
        setTimeout(() => wx.navigateBack({ delta: 1 }), 600);
      })
      .catch((err) => {
        console.error("[record/add] save failed:", err);
        this.setData({ saving: false });
        wx.showToast({ title: (err && err.message) || "保存失败", icon: "none" });
      });
  },
  onSave() {
    this.doSave(false);
  },
  onMarkAllergy() {
    this.doSave(true);
  },
  /**
   * 编辑模式删除记录
   */
  onDelete() {
    if (!this.data.isEdit || !this._recordId) {
      return;
    }
    wx.showModal({
      title: "删除记录",
      content: "确定删除这条用餐记录吗？",
      confirmColor: "#FF6B6B",
      success: (r) => {
        if (!r.confirm) {
          return;
        }
        callFunction("meal", { action: "delete", recordId: this._recordId })
          .then((res) => {
            if (!res || res.success !== true) {
              throw new Error(res && res.error ? res.error : "删除失败");
            }
            wx.showToast({ title: "已删除", icon: "success" });
            setTimeout(() => wx.navigateBack({ delta: 1 }), 600);
          })
          .catch((err) => {
            console.error("[record/add] delete failed:", err);
            wx.showToast({ title: "删除失败", icon: "none" });
          });
      }
    });
  }
});
