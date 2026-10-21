// components/baby-card/baby-card.js —— 圆角卡片容器（对 .card 的组件化封装）
Component({
  properties: {
    padding: {
      type: Boolean,
      value: true
    }
  },
  options: {
    multipleSlots: false,
    addGlobalClass: true
  }
});
