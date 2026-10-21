// components/nav-bar/nav-bar.js —— 自定义导航栏
Component({
  properties: {
    title: {
      type: String,
      value: ""
    },
    showBack: {
      type: Boolean,
      value: false
    }
  },

  data: {
    statusBarHeight: 20,
    navBarHeight: 44
  },

  lifetimes: {
    attached() {
      this.initNavBar();
    }
  },

  methods: {
    initNavBar() {
      let statusBarHeight = 20;
      try {
        if (wx.getWindowInfo) {
          statusBarHeight = wx.getWindowInfo().statusBarHeight || 20;
        } else if (wx.getSystemInfoSync) {
          statusBarHeight = wx.getSystemInfoSync().statusBarHeight || 20;
        }
      } catch (e) {
        statusBarHeight = 20;
      }

      // 用胶囊按钮推算导航栏高度，保证与微信原生布局对齐
      let navBarHeight = 44;
      try {
        const menu = wx.getMenuButtonBoundingClientRect
          ? wx.getMenuButtonBoundingClientRect()
          : null;
        if (menu && menu.top >= statusBarHeight) {
          navBarHeight = (menu.top - statusBarHeight) * 2 + menu.height;
        }
      } catch (e) {
        navBarHeight = 44;
      }

      this.setData({ statusBarHeight, navBarHeight });
    },

    onBack() {
      wx.navigateBack({ delta: 1 });
    }
  }
});
