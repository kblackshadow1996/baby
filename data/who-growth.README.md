# WHO 生长标准参考数据（近似）—— 来源声明与替换指引

## 这是什么

`utils/who-growth.js` 提供 0–36 月龄的儿童生长参考线数据，供成长曲线页
（`pages/growth`）在 canvas 上绘制 WHO 百分位参考线。数据结构：

```js
module.exports = {
  boy:  { height: { months:[0..36], P3:[...], P15:[...], P50:[...], P85:[...], P97:[...] },
          weight: { ... },
          head:   { ... } },
  girl: { ... }
};
```

- 指标：`height`（身高/身长，cm）、`weight`（体重，kg）、`head`（头围，cm）。
- 每个指标 5 条百分位：P3 / P15 / P50 / P85 / P97。
- `months` 与各百分位数组长度均为 **37**（0,1,2,…,36）。

页面通过相对路径直接 require，无需云端：

```js
const WHO = require("../../utils/who-growth.js");
```

## ⚠️ 诚实声明：这是近似值，不是 WHO 官方精确数据

这些数值是按 **WHO Child Growth Standards** 的公开量级给出的**合理近似参考值**，
满足婴幼儿生长的常识趋势（随月龄单调、男孩整体略高/略重于女孩、同月龄
P3 ≤ P15 ≤ P50 ≤ P85 ≤ P97）。

**它们不是从 WHO 官方 LMS 数据表精确导出的数值。** 生成逻辑见
`scripts/gen-who-growth.js`：以若干锚点（0/12/24/36 月）插值出 P50 中位数曲线，
再用近似变异系数（CV）配合正态分位推导其余百分位。因此曲线形状合理、可用于
原型与演示，但**个别数值与 WHO 官方表会有偏差**。

> 本仓库在无法联网核对 WHO 官方精确数值的前提下生成该数据；宁可在此标注清楚，
> 也不谎称精确。

## 正式发布前必须替换校准

上线面向用户前，**必须**用 WHO 官方 LMS 数据表重算并替换本数据：

1. 获取 WHO 官方「expanded tables（LMS）」，针对 0–2 岁（birth to 2 years）与
   2–5 岁（2 to 5 years）：
   - Length/height-for-age（boys / girls）
   - Weight-for-age（boys / girls）
   - Head circumference-for-age（boys / girls）
   来源：WHO Child Growth Standards 官方发布页。
2. 对每个指标、每个月龄 `t`，用该表的 L(t)、M(t)、S(t) 按 LMS 公式反解目标百分位
   对应的测量值：
   - 先取百分位对应的标准正态分位 `Z`（P3→-1.881, P15→-1.036, P50→0,
     P85→1.036, P97→1.881）；
   - 当 `L ≠ 0`：`X = M · (1 + L·S·Z)^(1/L)`；
   - 当 `L = 0`：`X = M · exp(S·Z)`。
3. 把算得的 5 条百分位（保留 1 位小数）写回
   `boy/girl.{height,weight,head}.{P3,P15,P50,P85,P97}`，`months` 保持 0..36。
4. 单位务必统一：height=cm、weight=kg、head=cm。
5. 替换后运行 `npx jest tests/who-growth.test.js` 确认结构不变量仍通过，再做一次
   与官方表的人工抽样核对（如 12/24/36 月 P50）。

## 替换后请同步

- 更新本 README 顶部，把"近似值"声明改为"数据来源：WHO 官方 LMS（版本/日期）"。
- 更新 `utils/who-growth.js` 文件头注释的声明。
- 成长曲线页图下方的免责小字可保留"仅供参考，请以医生评估为准"。
