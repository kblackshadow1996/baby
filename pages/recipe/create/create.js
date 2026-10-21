// pages/recipe/create/create.js —— 创建 / 编辑自建食谱
const { callFunction } = require("../../../utils/cloud.js");
const allergen = require("../../../utils/allergen.js");
const app = getApp();

/** 分类选项（value 对应 docs/data-model.md recipes.type） */
const TYPE_OPTIONS = [
  { label: "主食", value: "staple" },
  { label: "荤菜", value: "meat" },
  { label: "素菜", value: "veggie" },
  { label: "汤", value: "soup" },
  { label: "点心", value: "snack" }
];
/** 预设标签选项（选填） */
const TAG_OPTIONS = ["高铁", "补钙", "防便秘", "手指食物", "补锌", "易消化", "补脑", "快手"];
const MONTH_MIN = 0;
const MONTH_MAX = 36;

/**
 * 由 ingredients 中 isAllergen=true 的食材名推断规范过敏原名数组（去重，前端侧，云端兜底）。
 * @param {Array} ingredients
 * @returns {string[]}
 */
function inferAllergens(ingredients) {
  const out = [];
  if (!Array.isArray(ingredients)) {
    return out;
  }
  ingredients.forEach((ing) => {
    if (!ing || ing.isAllergen !== true) {
      return;
    }
    const name = ing.name ? String(ing.name).trim() : "";
    if (!name) {
      return;
    }
    const norm = allergen.normalizeAllergenName(name);
    if (norm && out.indexOf(norm) === -1) {
      out.push(norm);
    }
  });
  return out;
}

Page({
  data: {
    // 模式
    mode: "create", // create | edit
    recipeId: "",
    navTitle: "创建食谱",
    loading: false, // 编辑态回填中
    saving: false,
    // 常量
    typeOptions: TYPE_OPTIONS,
    tagOptions: TAG_OPTIONS,
    monthMin: MONTH_MIN,
    monthMax: MONTH_MAX,
    // 表单字段
    imageUrl: "",
    title: "",
    monthAgeMin: "",
    monthAgeMax: "",
    type: "",
    babyId: "", // "" 表示不归属
    babyOptions: [], // [{ _id, name }]
    babyPickerIndex: 0, // 0 = 不归属
    ingredients: [{ name: "", amount: "", isAllergen: false }],
    steps: [""],
    nutrition: { calories: "", protein: "", iron: "", calcium: "", vitamin: "" },
    tags: [], // 选中的标签名
    sourceName: ""
  },
  onLoad(options) {
    const id = options && options.id ? String(options.id) : "";
    // 归属宝贝下拉：不归属 + babyList
    this.buildBabyOptions();
    if (id) {
      this.setData({ mode: "edit", recipeId: id, navTitle: "编辑食谱", loading: true });
      this.fetchForEdit(id);
    } else {
      // 创建态：默认归属当前宝贝
      const cur = app.globalData && app.globalData.currentBaby;
      if (cur && cur._id) {
        const idx = this.data.babyOptions.findIndex((b) => b._id === cur._id);
        if (idx > 0) {
          this.setData({ babyId: cur._id, babyPickerIndex: idx });
        }
      }
    }
  },
  /** 构建归属宝贝下拉选项：首项"不归属"，其余来自 globalData.babyList */
  buildBabyOptions() {
    const list = (app.globalData && app.globalData.babyList) || [];
    const options = [{ _id: "", name: "不归属" }];
    list.forEach((b) => {
      if (b && b._id) {
        options.push({ _id: b._id, name: b.name || "宝贝" });
      }
    });
    this.setData({ babyOptions: options });
  },
  /** 编辑态：拉取食谱并校验（自建 + 本人），回填表单 */
  fetchForEdit(id) {
    callFunction("recipe", { action: "get", recipeId: id })
      .then((res) => {
        if (!res || res.success !== true || !res.data) {
          throw new Error(res && res.error ? res.error : "食谱不存在");
        }
        const recipe = res.data;
        const userInfo = app.globalData && app.globalData.userInfo;
        const openid = userInfo && userInfo.openid ? userInfo.openid : "";
        const isOwnRecipe =
          recipe.isOfficial === false && !!recipe.creatorOpenid && recipe.creatorOpenid === openid;
        if (!isOwnRecipe) {
          wx.showToast({ title: "无权编辑该食谱", icon: "none" });
          setTimeout(() => wx.navigateBack({ delta: 1 }), 800);
          return;
        }
        this.fillForm(recipe);
      })
      .catch((err) => {
        console.error("[recipe/create] fetch for edit failed:", err);
        wx.showToast({ title: "加载失败", icon: "none" });
        setTimeout(() => wx.navigateBack({ delta: 1 }), 800);
      });
  },
  /** 用食谱数据回填表单 */
  fillForm(recipe) {
    const ingredients =
      Array.isArray(recipe.ingredients) && recipe.ingredients.length > 0
        ? recipe.ingredients.map((i) => ({
            name: i && i.name ? String(i.name) : "",
            amount: i && i.amount ? String(i.amount) : "",
            isAllergen: i && i.isAllergen === true
          }))
        : [{ name: "", amount: "", isAllergen: false }];
    const steps = Array.isArray(recipe.steps) && recipe.steps.length > 0 ? recipe.steps.map((s) => String(s)) : [""];
    const nutrition = recipe.nutrition && typeof recipe.nutrition === "object" ? recipe.nutrition : {};
    const tags = Array.isArray(recipe.tags) ? recipe.tags.map((t) => String(t)) : [];
    const source = recipe.source && typeof recipe.source === "object" ? recipe.source : {};
    const babyId = recipe.babyId ? String(recipe.babyId) : "";
    const idx = this.data.babyOptions.findIndex((b) => b._id === babyId);
    this.setData({
      loading: false,
      imageUrl: recipe.imageUrl ? String(recipe.imageUrl) : "",
      title: recipe.title ? String(recipe.title) : "",
      monthAgeMin: recipe.monthAgeMin === undefined || recipe.monthAgeMin === null ? "" : String(recipe.monthAgeMin),
      monthAgeMax: recipe.monthAgeMax === undefined || recipe.monthAgeMax === null ? "" : String(recipe.monthAgeMax),
      type: recipe.type || "",
      babyId: babyId,
      babyPickerIndex: idx >= 0 ? idx : 0,
      ingredients: ingredients,
      steps: steps,
      nutrition: {
        calories: nutrition.calories === undefined || nutrition.calories === null ? "" : String(nutrition.calories),
        protein: nutrition.protein === undefined || nutrition.protein === null ? "" : String(nutrition.protein),
        iron: nutrition.iron === undefined || nutrition.iron === null ? "" : String(nutrition.iron),
        calcium: nutrition.calcium === undefined || nutrition.calcium === null ? "" : String(nutrition.calcium),
        vitamin: nutrition.vitamin === undefined || nutrition.vitamin === null ? "" : String(nutrition.vitamin)
      },
      tags: tags,
      sourceName: source.name ? String(source.name) : ""
    });
  },
  // ---- 图片上传 ----
  async onChooseImage() {
    let filePath = "";
    try {
      const chooseRes = await wx.chooseMedia({
        count: 1,
        mediaType: ["image"],
        sizeType: ["compressed"],
        sourceType: ["album", "camera"]
      });
      filePath = chooseRes.tempFiles && chooseRes.tempFiles[0] && chooseRes.tempFiles[0].tempFilePath;
    } catch (e) {
      // 用户取消
      return;
    }
    if (!filePath) {
      return;
    }
    if (!wx.cloud) {
      wx.showToast({ title: "云开发未初始化", icon: "none" });
      return;
    }
    wx.showLoading({ title: "上传中", mask: true });
    try {
      const ext = (filePath.match(/\.(\w+)$/) || [, "jpg"])[1];
      const cloudPath = `recipes/${Date.now()}-${Math.floor(Math.random() * 1e6)}.${ext}`;
      const uploadRes = await wx.cloud.uploadFile({ cloudPath, filePath });
      if (uploadRes && uploadRes.fileID) {
        this.setData({ imageUrl: uploadRes.fileID });
      }
    } catch (e) {
      // 上传失败 toast，不阻断填写
      wx.showToast({ title: "图片上传失败", icon: "none" });
    } finally {
      wx.hideLoading();
    }
  },
  // ---- 基础字段 ----
  onTitleInput(e) {
    this.setData({ title: e.detail.value });
  },
  onMonthMinInput(e) {
    this.setData({ monthAgeMin: e.detail.value });
  },
  onMonthMaxInput(e) {
    this.setData({ monthAgeMax: e.detail.value });
  },
  onTypeTap(e) {
    const value = e.currentTarget.dataset.value;
    this.setData({ type: value });
  },
  onBabyChange(e) {
    const idx = parseInt(e.detail.value, 10) || 0;
    const opt = this.data.babyOptions[idx] || { _id: "" };
    this.setData({ babyPickerIndex: idx, babyId: opt._id });
  },
  onSourceInput(e) {
    this.setData({ sourceName: e.detail.value });
  },
  // ---- 营养（选填）----
  onNutritionInput(e) {
    const key = e.currentTarget.dataset.key;
    if (!key) {
      return;
    }
    this.setData({ [`nutrition.${key}`]: e.detail.value });
  },
  // ---- 标签多选 ----
  onTagTap(e) {
    const tag = e.currentTarget.dataset.tag;
    const tags = this.data.tags.slice();
    const idx = tags.indexOf(tag);
    if (idx === -1) {
      tags.push(tag);
    } else {
      tags.splice(idx, 1);
    }
    this.setData({ tags: tags });
  },
  // ---- 食材动态行 ----
  onIngredientNameInput(e) {
    const idx = e.currentTarget.dataset.index;
    this.setData({ [`ingredients[${idx}].name`]: e.detail.value });
  },
  onIngredientAmountInput(e) {
    const idx = e.currentTarget.dataset.index;
    this.setData({ [`ingredients[${idx}].amount`]: e.detail.value });
  },
  onIngredientAllergenChange(e) {
    const idx = e.currentTarget.dataset.index;
    this.setData({ [`ingredients[${idx}].isAllergen`]: e.detail.value });
  },
  onAddIngredient() {
    const ingredients = this.data.ingredients.concat([{ name: "", amount: "", isAllergen: false }]);
    this.setData({ ingredients: ingredients });
  },
  onRemoveIngredient(e) {
    const idx = e.currentTarget.dataset.index;
    if (this.data.ingredients.length <= 1) {
      wx.showToast({ title: "至少保留 1 种食材", icon: "none" });
      return;
    }
    const ingredients = this.data.ingredients.slice();
    ingredients.splice(idx, 1);
    this.setData({ ingredients: ingredients });
  },
  // ---- 步骤动态行 ----
  onStepInput(e) {
    const idx = e.currentTarget.dataset.index;
    this.setData({ [`steps[${idx}]`]: e.detail.value });
  },
  onAddStep() {
    const steps = this.data.steps.concat([""]);
    this.setData({ steps: steps });
  },
  onRemoveStep(e) {
    const idx = e.currentTarget.dataset.index;
    if (this.data.steps.length <= 1) {
      wx.showToast({ title: "至少保留 1 个步骤", icon: "none" });
      return;
    }
    const steps = this.data.steps.slice();
    steps.splice(idx, 1);
    this.setData({ steps: steps });
  },
  /**
   * 校验并组装 payload；校验失败 toast 并返回 null。
   * @returns {Object|null}
   */
  buildPayload() {
    const title = (this.data.title || "").trim();
    if (!title) {
      wx.showToast({ title: "请填写食谱名称", icon: "none" });
      return null;
    }
    const min = parseInt(this.data.monthAgeMin, 10);
    const max = parseInt(this.data.monthAgeMax, 10);
    if (isNaN(min) || isNaN(max)) {
      wx.showToast({ title: "请填写适用月龄", icon: "none" });
      return null;
    }
    if (min < MONTH_MIN || max > MONTH_MAX || min > max) {
      wx.showToast({ title: "月龄区间有误（0-36，最小≤最大）", icon: "none" });
      return null;
    }
    if (!this.data.type) {
      wx.showToast({ title: "请选择食谱分类", icon: "none" });
      return null;
    }
    // 食材：至少 1 行含名称
    const ingredients = this.data.ingredients
      .map((i) => ({
        name: (i.name || "").trim(),
        amount: (i.amount || "").trim(),
        isAllergen: i.isAllergen === true
      }))
      .filter((i) => i.name);
    if (ingredients.length === 0) {
      wx.showToast({ title: "请至少填写 1 种食材", icon: "none" });
      return null;
    }
    // 步骤：至少 1 步非空
    const steps = this.data.steps.map((s) => (s || "").trim()).filter((s) => s);
    if (steps.length === 0) {
      wx.showToast({ title: "请至少填写 1 个步骤", icon: "none" });
      return null;
    }
    // 营养（仅保留非空项）
    const nutrition = {};
    const n = this.data.nutrition || {};
    ["calories", "protein", "iron", "calcium", "vitamin"].forEach((k) => {
      const v = (n[k] === undefined || n[k] === null ? "" : String(n[k])).trim();
      if (v) {
        nutrition[k] = v;
      }
    });
    const source = {};
    const sourceName = (this.data.sourceName || "").trim();
    if (sourceName) {
      source.name = sourceName;
    }
    const payload = {
      title: title,
      monthAgeMin: min,
      monthAgeMax: max,
      type: this.data.type,
      ingredients: ingredients,
      steps: steps,
      nutrition: nutrition,
      source: source,
      imageUrl: this.data.imageUrl || "",
      tags: this.data.tags.slice(),
      // 前端推断 allergens（云端兜底）
      allergens: inferAllergens(ingredients),
      babyId: this.data.babyId || ""
    };
    return payload;
  },
  /** 保存（创建 / 更新） */
  onSave() {
    if (this.data.saving) {
      return;
    }
    const payload = this.buildPayload();
    if (!payload) {
      return;
    }
    this.setData({ saving: true });
    wx.showLoading({ title: "保存中", mask: true });
    const isEdit = this.data.mode === "edit";
    const params = isEdit
      ? Object.assign({ action: "update", recipeId: this.data.recipeId }, payload)
      : Object.assign({ action: "create" }, payload);
    callFunction("recipe", params)
      .then((res) => {
        if (!res || res.success !== true) {
          throw new Error(res && res.error ? res.error : "保存失败");
        }
        wx.hideLoading();
        wx.showToast({ title: isEdit ? "已更新" : "已创建", icon: "success" });
        setTimeout(() => wx.navigateBack({ delta: 1 }), 700);
      })
      .catch((err) => {
        console.error("[recipe/create] save failed:", err);
        wx.hideLoading();
        this.setData({ saving: false });
        wx.showToast({ title: (err && err.message) || "保存失败", icon: "none" });
      });
  },
  /** 删除（编辑态） */
  onDelete() {
    const id = this.data.recipeId;
    if (!id || this.data.mode !== "edit") {
      return;
    }
    wx.showModal({
      title: "删除食谱",
      content: "删除后不可恢复，确定删除这道食谱吗？",
      confirmText: "删除",
      confirmColor: "#FF6B6B",
      success: (modalRes) => {
        if (!modalRes.confirm) {
          return;
        }
        wx.showLoading({ title: "删除中", mask: true });
        callFunction("recipe", { action: "delete", recipeId: id })
          .then((res) => {
            if (!res || res.success !== true) {
              throw new Error(res && res.error ? res.error : "删除失败");
            }
            wx.hideLoading();
            wx.showToast({ title: "已删除", icon: "success" });
            setTimeout(() => wx.navigateBack({ delta: 1 }), 700);
          })
          .catch((err) => {
            console.error("[recipe/create] delete failed:", err);
            wx.hideLoading();
            wx.showToast({ title: (err && err.message) || "删除失败", icon: "none" });
          });
      }
    });
  }
});

// 导出模块函数，供复用/测试（小程序运行环境 module.exports 可被 require）
module.exports.inferAllergens = inferAllergens;
module.exports.TYPE_OPTIONS = TYPE_OPTIONS;
module.exports.TAG_OPTIONS = TAG_OPTIONS;
