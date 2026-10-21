// pages/family/members/members.js —— 家庭成员
// onShow 读取当前宝贝 → 调 family listMembers 渲染；owner 可移除/改成员角色。
const { callFunction } = require("../../../utils/cloud.js");
const app = getApp();

const ROLE_LABEL = {
  mom: "妈妈",
  dad: "爸爸",
  grandpa_pat: "爷爷",
  grandma_pat: "奶奶",
  grandpa_mat: "外公",
  grandma_mat: "外婆",
  other: "其他"
};
const PERMISSION_LABEL = { view: "仅查看", edit: "可编辑" };
// 改角色 action-sheet 顺序（与 ROLE_LABEL 对应）
const ROLE_ORDER = ["dad", "mom", "grandpa_pat", "grandma_pat", "grandpa_mat", "grandma_mat", "other"];

Page({
  data: {
    loading: true,
    baby: null,
    isOwner: false,
    members: [],
    hasBaby: false,
    onlySelf: false
  },

  onShow() {
    this.refresh();
  },

  /** 拉取当前宝贝成员并渲染 */
  async refresh() {
    this.setData({ loading: true });
    try {
      await app.ensureLogin();
    } catch (e) {
      // 忽略，按未登录处理
    }
    const baby = app.globalData.currentBaby || null;
    const userInfo = app.globalData.userInfo || {};
    if (!baby || !baby._id) {
      this.setData({ loading: false, hasBaby: false, baby: null, members: [], isOwner: false });
      return;
    }
    const isOwner = !!(userInfo.openid && baby.ownerId === userInfo.openid);
    this.setData({ hasBaby: true, baby: baby, isOwner: isOwner });
    try {
      const res = await callFunction("family", { action: "listMembers", babyId: baby._id });
      if (!res || res.success !== true) {
        wx.showToast({ title: (res && res.error) || "加载失败", icon: "none" });
        this.setData({ loading: false, members: [] });
        return;
      }
      const members = (res.data.members || []).map((m) => ({
        _id: m._id,
        userOpenid: m.userOpenid,
        role: m.role,
        roleLabel: ROLE_LABEL[m.role] || "家人",
        permissions: m.permissions,
        permissionLabel: PERMISSION_LABEL[m.permissions] || "仅查看",
        nickName: m.nickName || "",
        avatarUrl: m.avatarUrl || "",
        isOwner: m.isOwner,
        isSelf: m.isSelf,
        // owner 可对非 owner 成员操作
        canManage: isOwner && !m.isOwner
      }));
      this.setData({
        members: members,
        onlySelf: members.length <= 1,
        loading: false
      });
    } catch (e) {
      this.setData({ loading: false, members: [] });
    }
  },

  /** 跳转邀请页 */
  onInvite() {
    wx.navigateTo({ url: "/pages/family/invite/invite" });
  },

  /** 移除成员 */
  onRemoveMember(e) {
    const memberId = e.currentTarget.dataset.id;
    const name = e.currentTarget.dataset.name || "该成员";
    const babyId = this.data.baby && this.data.baby._id;
    if (!memberId || !babyId) {
      return;
    }
    wx.showModal({
      title: "移除成员",
      content: `确定将「${name}」移出家庭吗？`,
      confirmColor: "#FF6B6B",
      success: (modalRes) => {
        if (!modalRes.confirm) {
          return;
        }
        this.doRemove(babyId, memberId);
      }
    });
  },

  async doRemove(babyId, memberId) {
    try {
      const res = await callFunction("family", {
        action: "removeMember",
        babyId: babyId,
        memberId: memberId
      });
      if (!res || res.success !== true) {
        wx.showToast({ title: (res && res.error) || "移除失败", icon: "none" });
        return;
      }
      wx.showToast({ title: "已移除", icon: "success" });
      this.refresh();
    } catch (e) {
      // cloud.js 已 toast
    }
  },

  /** 点成员：改角色（action-sheet），再改权限 */
  onEditMember(e) {
    if (!this.data.isOwner) {
      return;
    }
    const memberId = e.currentTarget.dataset.id;
    const isOwnerMember = e.currentTarget.dataset.owner;
    if (isOwnerMember || !memberId) {
      return;
    }
    const babyId = this.data.baby && this.data.baby._id;
    const itemList = ROLE_ORDER.map((r) => ROLE_LABEL[r]);
    wx.showActionSheet({
      itemList: itemList,
      success: (sheetRes) => {
        const role = ROLE_ORDER[sheetRes.tapIndex];
        if (!role) {
          return;
        }
        this.choosePermissionThenUpdate(babyId, memberId, role);
      }
    });
  },

  /** 选完角色后再选权限并提交 */
  choosePermissionThenUpdate(babyId, memberId, role) {
    wx.showActionSheet({
      itemList: ["仅查看", "可编辑"],
      success: (sheetRes) => {
        const permissions = sheetRes.tapIndex === 1 ? "edit" : "view";
        this.doUpdateMember(babyId, memberId, role, permissions);
      }
    });
  },

  async doUpdateMember(babyId, memberId, role, permissions) {
    try {
      const res = await callFunction("family", {
        action: "updateMemberRole",
        babyId: babyId,
        memberId: memberId,
        role: role,
        permissions: permissions
      });
      if (!res || res.success !== true) {
        wx.showToast({ title: (res && res.error) || "更新失败", icon: "none" });
        return;
      }
      wx.showToast({ title: "已更新", icon: "success" });
      this.refresh();
    } catch (e) {
      // cloud.js 已 toast
    }
  }
});
