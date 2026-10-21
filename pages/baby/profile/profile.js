// pages/baby/profile/profile.js —— 宝贝档案（新增/编辑）
const { callFunction } = require("../../../utils/cloud.js");
const { calcMonthAge, calcAgeText, getStageByMonth, formatDate } = require("../../../utils/date.js");

const app = getApp();

const GENDER_OPTIONS = [
  { value: 1, label: "男" },
  { value: 2, label: "女" },
  { value: 0, label: "不设置" }
];

Page({
  data: {
    mode: "add", // 'add' | 'edit'
    babyId: "",
    genderOptions: GENDER_OPTIONS,
    today: "",

    // 表单
    name: "",
    gender: 0,
    birthday: "", // "YYYY-MM-DD"
    avatarUrl: "",

    // 实时展示
    ageText: "",
    stageName: "",
    stageTip: "",

    saving: false,
    loading: false
  },

  onLoad(options) {
    const today = formatDate(new Date(), "YYYY-MM-DD");
    this.setData({ today });

    const babyId = options && options.babyId ? options.babyId : "";
    if (babyId) {
      this.setData({ mode: "edit", babyId });
      this.loadBaby(babyId);
    }
  },

  /**
   * 编辑模式：拉取宝贝回填
   */
  async loadBaby(babyId) {
    this.setData({ loading: true });
    try {
      await app.ensureLogin();
      const res = await callFunction("baby", { action: "get", babyId });
      if (res && res.success && res.data) {
        const b = res.data;
        const birthday = b.birthday ? formatDate(b.birthday, "YYYY-MM-DD") : "";
        this.setData(
          {
            name: b.name || "",
            gender: typeof b.gender === "number" ? b.gender : 0,
            birthday,
            avatarUrl: b.avatarUrl || ""
          },
          () => this.updateAgePreview()
        );
      } else {
        wx.showToast({ title: (res && res.error) || "加载失败", icon: "none" });
      }
    } catch (e) {
      // callFunction 已 toast
    }
    this.setData({ loading: false });
  },

  onNameInput(e) {
    this.setData({ name: e.detail.value });
  },

  onGenderChange(e) {
    this.setData({ gender: Number(e.detail.value) });
  },

  onBirthdayChange(e) {
    this.setData({ birthday: e.detail.value }, () => this.updateAgePreview());
  },

  /**
   * 根据生日刷新月龄与辅食阶段展示
   */
  updateAgePreview() {
    const { birthday } = this.data;
    if (!birthday) {
      this.setData({ ageText: "", stageName: "", stageTip: "" });
      return;
    }
    const month = calcMonthAge(birthday);
    const ageText = calcAgeText(birthday);
    const stage = getStageByMonth(month);
    this.setData({
      ageText: `${ageText}（${month}个月）`,
      stageName: stage.name,
      stageTip: stage.tip
    });
  },

  /**
   * 选择并上传头像到云存储 babies/ 目录
   */
  async onChooseAvatar() {
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
      const cloudPath = `babies/${Date.now()}-${Math.floor(Math.random() * 1e6)}.${ext}`;
      const uploadRes = await wx.cloud.uploadFile({ cloudPath, filePath });
      if (uploadRes && uploadRes.fileID) {
        this.setData({ avatarUrl: uploadRes.fileID });
      }
    } catch (e) {
      wx.showToast({ title: "头像上传失败", icon: "none" });
    } finally {
      wx.hideLoading();
    }
  },

  /**
   * 保存（新增 / 编辑）
   */
  async onSave() {
    const { mode, babyId, name, gender, birthday, avatarUrl, saving } = this.data;
    if (saving) {
      return;
    }
    if (!name || !name.trim()) {
      wx.showToast({ title: "请填写宝贝名字", icon: "none" });
      return;
    }
    if (!birthday) {
      wx.showToast({ title: "请选择宝贝生日", icon: "none" });
      return;
    }

    this.setData({ saving: true });
    try {
      await app.ensureLogin();
      let res;
      if (mode === "edit") {
        res = await callFunction("baby", {
          action: "update",
          babyId,
          name: name.trim(),
          gender,
          birthday,
          avatarUrl
        });
      } else {
        res = await callFunction("baby", {
          action: "add",
          name: name.trim(),
          gender,
          birthday,
          avatarUrl
        });
      }

      if (res && res.success) {
        // 刷新列表；新增时把新宝贝设为当前
        await app.loadBabies();
        if (res.data) {
          const baby = (app.globalData.babyList || []).find((b) => b._id === res.data._id) || res.data;
          if (mode === "add") {
            app.setCurrentBaby(baby);
          } else if (app.globalData.currentBaby && app.globalData.currentBaby._id === baby._id) {
            // 当前宝贝被编辑，同步最新数据
            app.setCurrentBaby(baby);
          }
        }
        wx.showToast({ title: mode === "edit" ? "已保存" : "添加成功", icon: "success" });
        setTimeout(() => wx.navigateBack({ delta: 1 }), 600);
      } else {
        wx.showToast({ title: (res && res.error) || "保存失败", icon: "none" });
        this.setData({ saving: false });
      }
    } catch (e) {
      this.setData({ saving: false });
    }
  },

  /**
   * 删除宝贝（编辑模式，二次确认）
   */
  async onDelete() {
    const { babyId, name } = this.data;
    if (!babyId) {
      return;
    }
    const modalRes = await wx.showModal({
      title: "删除宝贝",
      content: `确定删除「${name}」吗？该操作不可撤销。`,
      confirmText: "删除",
      confirmColor: "#FF6B6B"
    });
    if (!modalRes.confirm) {
      return;
    }
    wx.showLoading({ title: "删除中", mask: true });
    try {
      const res = await callFunction("baby", { action: "delete", babyId });
      wx.hideLoading();
      if (res && res.success) {
        // 若删的是当前宝贝，清空当前选择后重新加载
        if (app.globalData.currentBaby && app.globalData.currentBaby._id === babyId) {
          app.setCurrentBaby(null);
        }
        await app.loadBabies();
        wx.showToast({ title: "已删除", icon: "success" });
        setTimeout(() => wx.navigateBack({ delta: 1 }), 600);
      } else {
        wx.showToast({ title: (res && res.error) || "删除失败", icon: "none" });
      }
    } catch (e) {
      wx.hideLoading();
    }
  }
});
