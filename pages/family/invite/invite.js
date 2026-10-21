// pages/family/invite/invite.js —— 邀请家人 / 接受邀请
// 三种模式：
//   invite（默认）：owner 为宝贝生成邀请码并分享；底部提供"我有邀请码"手动加入入口。
//   accept：onLoad 带 code 参数（来自分享卡片）时进入，预览邀请详情并确认加入。
const { callFunction } = require("../../../utils/cloud.js");
const app = getApp();

// 受邀者角色（与 baby / family 云函数一致），中文映射前端维护
const ROLE_OPTIONS = [
  { value: "dad", label: "爸爸" },
  { value: "mom", label: "妈妈" },
  { value: "grandpa_pat", label: "爷爷" },
  { value: "grandma_pat", label: "奶奶" },
  { value: "grandpa_mat", label: "外公" },
  { value: "grandma_mat", label: "外婆" },
  { value: "other", label: "其他" }
];
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

Page({
  data: {
    mode: "invite", // invite | accept
    // --- invite 模式 ---
    baby: null,
    isOwner: false,
    roleOptions: ROLE_OPTIONS,
    roleIndex: 0, // 默认爸爸
    permission: "view",
    generating: false,
    invite: null, // { code, expireAt, babyId }
    expireText: "",
    // 手动加入
    manualCode: "",
    joining: false,
    // --- accept 模式 ---
    acceptCode: "",
    acceptLoading: false,
    inviteInfo: null, // getInviteInfo 返回
    roleLabel: "",
    permissionLabel: ""
  },

  onLoad(options) {
    const code = options && options.code ? String(options.code).trim() : "";
    if (code) {
      this.setData({ mode: "accept", acceptCode: code });
      this.loadInviteInfo(code);
      return;
    }
    this.setupInviteMode();
  },

  onShow() {
    if (this.data.mode === "invite") {
      // 刷新当前宝贝（可能在别处切换）
      this.setupInviteMode();
    }
  },

  /** invite 模式初始化：读取当前宝贝、判定 owner */
  async setupInviteMode() {
    try {
      await app.ensureLogin();
    } catch (e) {
      // ensureLogin 失败不阻断，后续按未登录处理
    }
    const baby = app.globalData.currentBaby || null;
    const userInfo = app.globalData.userInfo || {};
    const isOwner = !!(baby && userInfo.openid && baby.ownerId === userInfo.openid);
    this.setData({ baby: baby, isOwner: isOwner });
    if (baby && !isOwner) {
      wx.showToast({ title: "仅创建者可邀请", icon: "none" });
    }
  },

  /** 角色选择 */
  onRoleChange(e) {
    this.setData({ roleIndex: Number(e.detail.value) || 0 });
  },

  /** 权限选择 */
  onSelectPermission(e) {
    const permission = e.currentTarget.dataset.value;
    if (permission === "view" || permission === "edit") {
      this.setData({ permission: permission });
    }
  },

  /** 生成邀请码 */
  async onGenerateInvite() {
    if (this.data.generating) {
      return;
    }
    const baby = this.data.baby;
    if (!baby || !baby._id) {
      wx.showToast({ title: "请先选择宝贝", icon: "none" });
      return;
    }
    if (!this.data.isOwner) {
      wx.showToast({ title: "仅创建者可邀请", icon: "none" });
      return;
    }
    const role = (this.data.roleOptions[this.data.roleIndex] || {}).value || "other";
    this.setData({ generating: true });
    try {
      const res = await callFunction("family", {
        action: "createInvite",
        babyId: baby._id,
        role: role,
        permissions: this.data.permission
      });
      if (!res || res.success !== true) {
        wx.showToast({ title: (res && res.error) || "生成失败", icon: "none" });
        return;
      }
      this.setData({
        invite: res.data,
        expireText: this.formatExpire(res.data.expireAt)
      });
    } catch (e) {
      // cloud.js 已 toast
    } finally {
      this.setData({ generating: false });
    }
  },

  /** 复制邀请码 */
  onCopyCode() {
    const code = this.data.invite && this.data.invite.code;
    if (!code) {
      return;
    }
    wx.setClipboardData({
      data: code,
      success() {
        wx.showToast({ title: "已复制邀请码", icon: "none" });
      }
    });
  },

  /** 手动输入的邀请码 */
  onManualInput(e) {
    this.setData({ manualCode: (e.detail.value || "").toUpperCase() });
  },

  /** 手动输入邀请码加入 */
  onManualJoin() {
    const code = (this.data.manualCode || "").trim();
    if (!code) {
      wx.showToast({ title: "请输入邀请码", icon: "none" });
      return;
    }
    this.doJoin(code);
  },

  /** 格式化有效期为可读文本 */
  formatExpire(ms) {
    if (!ms) {
      return "24小时内有效";
    }
    const d = new Date(ms);
    const pad = (n) => (n < 10 ? "0" + n : "" + n);
    return `有效期至 ${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  },

  // ===== accept 模式 =====

  /** 读取邀请详情 */
  async loadInviteInfo(code) {
    this.setData({ acceptLoading: true });
    try {
      await app.ensureLogin();
      const res = await callFunction("family", { action: "getInviteInfo", code: code });
      if (!res || res.success !== true) {
        wx.showToast({ title: (res && res.error) || "邀请码无效", icon: "none" });
        this.setData({ inviteInfo: null });
        return;
      }
      const info = res.data;
      this.setData({
        inviteInfo: info,
        roleLabel: ROLE_LABEL[info.role] || "家人",
        permissionLabel: PERMISSION_LABEL[info.permissions] || "仅查看"
      });
    } catch (e) {
      this.setData({ inviteInfo: null });
    } finally {
      this.setData({ acceptLoading: false });
    }
  },

  /** 确认加入（accept 模式） */
  onConfirmJoin() {
    const info = this.data.inviteInfo;
    if (!info || !info.valid) {
      wx.showToast({ title: "邀请已失效", icon: "none" });
      return;
    }
    this.doJoin(this.data.acceptCode);
  },

  /** 统一加入逻辑：joinByCode + 刷新宝贝 + 跳转 */
  async doJoin(code) {
    if (this.data.joining) {
      return;
    }
    this.setData({ joining: true });
    try {
      await app.ensureLogin();
      const res = await callFunction("family", { action: "joinByCode", code: code });
      if (!res || res.success !== true) {
        wx.showToast({ title: (res && res.error) || "加入失败", icon: "none" });
        return;
      }
      wx.showToast({ title: "已加入家庭", icon: "success" });
      const babyId = res.data && res.data.babyId;
      try {
        await app.loadBabies();
        // 切换到新加入的宝贝
        if (babyId) {
          const target = (app.globalData.babyList || []).find((b) => b._id === babyId);
          if (target) {
            app.setCurrentBaby(target);
          }
        }
      } catch (e) {
        // 刷新失败不阻断加入成功提示
      }
      setTimeout(() => {
        wx.switchTab({
          url: "/pages/index/index",
          fail() {
            wx.navigateTo({ url: "/pages/baby/manage/manage" });
          }
        });
      }, 800);
    } catch (e) {
      // cloud.js 已 toast
    } finally {
      this.setData({ joining: false });
    }
  },

  /** 微信转发：分享卡片带 code，接收方打开进入 accept 模式 */
  onShareAppMessage() {
    const baby = this.data.baby;
    const invite = this.data.invite;
    const babyName = baby && baby.name ? baby.name : "宝宝";
    const title = `${babyName}的家人邀请你一起记录宝宝辅食`;
    let path = "/pages/family/invite/invite";
    if (invite && invite.code) {
      path += "?code=" + invite.code;
    }
    return { title: title, path: path };
  }
});
