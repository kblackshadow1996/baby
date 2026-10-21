// pages/baby/manage/manage.js —— 宝贝管理 / 多宝贝切换
const { calcAgeText } = require("../../../utils/date.js");

const app = getApp();

Page({
  data: {
    loading: true,
    babies: [], // 渲染用：在 baby 基础上附加 ageText / selected
    currentBabyId: ""
  },

  onShow() {
    this.refresh();
  },

  /**
   * 拉取宝贝列表并构建渲染数据
   */
  async refresh() {
    this.setData({ loading: true });
    try {
      await app.ensureLogin();
      await app.loadBabies();
    } catch (e) {
      // 云函数封装已 toast，这里仅兜底
    }
    this.render();
  },

  /**
   * 根据 globalData 构建视图数据
   */
  render() {
    const list = app.globalData.babyList || [];
    const current = app.globalData.currentBaby;
    const currentBabyId = current ? current._id : "";
    const babies = list.map((b) => ({
      _id: b._id,
      name: b.name,
      avatarUrl: b.avatarUrl || "",
      gender: b.gender,
      ageText: b.birthday ? calcAgeText(b.birthday) : "",
      selected: b._id === currentBabyId
    }));
    this.setData({ babies, currentBabyId, loading: false });
  },

  /**
   * 点击某个宝贝 → 设为当前
   */
  onSelectBaby(e) {
    const id = e.currentTarget.dataset.id;
    const baby = (app.globalData.babyList || []).find((b) => b._id === id);
    if (!baby) {
      return;
    }
    if (app.globalData.currentBaby && app.globalData.currentBaby._id === id) {
      return;
    }
    app.setCurrentBaby(baby);
    this.render();
    wx.showToast({ title: `已切换到${baby.name}`, icon: "none" });
  },

  /**
   * 编辑某个宝贝
   */
  onEditBaby(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/baby/profile/profile?babyId=${id}` });
  },

  /**
   * 新增宝贝
   */
  onAddBaby() {
    wx.navigateTo({ url: "/pages/baby/profile/profile" });
  }
});
