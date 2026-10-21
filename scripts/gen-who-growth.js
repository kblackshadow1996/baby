// scripts/gen-who-growth.js
// 生成 utils/who-growth.js 的近似 WHO 生长标准参考数据。
//
// ⚠️ 重要诚实声明：
//   这些数值是按 WHO Child Growth Standards 公开量级给出的"合理近似参考值"，
//   并非 WHO 官方精确 LMS 数据表导出的数值。它们满足：
//     - 月龄 0..36 共 37 个点；
//     - 各百分位随月龄单调非降（身高/头围严格递增，体重递增）；
//     - 同一月龄满足 P3 <= P15 <= P50 <= P85 <= P97；
//     - 男孩整体略高/略重于女孩（符合常识）。
//   正式发布前必须用 WHO 官方 LMS 数据表替换校准。详见 data/who-growth.README.md。
//
// 用法：node scripts/gen-who-growth.js  （会写出 utils/who-growth.js）
const fs = require("fs");
const path = require("path");

const MONTHS = [];
for (let m = 0; m <= 36; m++) {
  MONTHS.push(m);
}

const round1 = (n) => Math.round(n * 10) / 10;

/**
 * 由 P50 中位数曲线 + 相对离散比例，推导五条百分位。
 * spread 为 P50 两侧的相对比例（近似正态，P15/P85 约 ±0.67σ，P3/P97 约 ±1.88σ）。
 * 用乘性离散（随月龄绝对差自然放大），保证单调与排序。
 * @param {number[]} p50 中位数数组（与 MONTHS 对齐）
 * @param {number} cv 近似变异系数（标准差 / 均值）
 */
function derive(p50, cv) {
  const z = { P3: -1.881, P15: -1.036, P50: 0, P85: 1.036, P97: 1.881 };
  const out = { P3: [], P15: [], P50: [], P85: [], P97: [] };
  for (let i = 0; i < p50.length; i++) {
    const mean = p50[i];
    const sd = mean * cv;
    out.P3.push(round1(mean + z.P3 * sd));
    out.P15.push(round1(mean + z.P15 * sd));
    out.P50.push(round1(mean));
    out.P85.push(round1(mean + z.P85 * sd));
    out.P97.push(round1(mean + z.P97 * sd));
  }
  return out;
}

// --- P50 中位数曲线（近似量级） ---
// 身高(cm)：出生约 50，1岁约 76，2岁约 88，3岁约 96（男）；女略低。
function heightP50(boy) {
  const birth = boy ? 50.0 : 49.2;
  const y1 = boy ? 76.1 : 74.3; // 12月
  const y2 = boy ? 87.8 : 86.4; // 24月
  const y3 = boy ? 96.5 : 95.1; // 36月
  return MONTHS.map((m) => interp(m, birth, y1, y2, y3));
}
// 体重(kg)：出生约 3.3，1岁约 9.6，2岁约 12.2，3岁约 14.3（男）；女略低。
function weightP50(boy) {
  const birth = boy ? 3.3 : 3.2;
  const y1 = boy ? 9.6 : 8.9;
  const y2 = boy ? 12.2 : 11.5;
  const y3 = boy ? 14.3 : 13.9;
  return MONTHS.map((m) => interp(m, birth, y1, y2, y3));
}
// 头围(cm)：出生约 34.5，1岁约 46，2岁约 48.3，3岁约 49.5（男）；女略低。
function headP50(boy) {
  const birth = boy ? 34.5 : 33.9;
  const y1 = boy ? 46.1 : 45.0;
  const y2 = boy ? 48.3 : 47.2;
  const y3 = boy ? 49.5 : 48.5;
  return MONTHS.map((m) => interp(m, birth, y1, y2, y3));
}

/**
 * 分段平滑插值：用 0/12/24/36 月四个锚点，段内按幂次曲线插值，
 * 使增长在婴儿期快、随后放缓（更贴近真实生长），并保证严格单调递增。
 */
function interp(m, v0, v12, v24, v36) {
  if (m <= 12) {
    // 0-12 月：增长快，用幂次 0.72 让早期更陡
    const t = Math.pow(m / 12, 0.72);
    return v0 + (v12 - v0) * t;
  }
  if (m <= 24) {
    const t = (m - 12) / 12;
    return v12 + (v24 - v12) * t;
  }
  const t = (m - 24) / 12;
  return v24 + (v36 - v24) * t;
}

function buildSex(boy) {
  return {
    height: Object.assign({ months: MONTHS.slice() }, derive(heightP50(boy), 0.038)),
    weight: Object.assign({ months: MONTHS.slice() }, derive(weightP50(boy), 0.11)),
    head: Object.assign({ months: MONTHS.slice() }, derive(headP50(boy), 0.028))
  };
}

const data = {
  boy: buildSex(true),
  girl: buildSex(false)
};

const header = `// utils/who-growth.js
// ⚠️ 近似参考数据——非 WHO 官方精确值。
//
// 这是按 WHO Child Growth Standards（0-36 月）公开量级给出的"合理近似参考值"，
// 用于前端 canvas 绘制生长参考线。它满足以下不变量（见 tests/who-growth.test.js）：
//   - boy / girl 下每个指标（height/weight/head）数组长度 = 37，months = [0..36]；
//   - P3 <= P15 <= P50 <= P85 <= P97（同一月龄）；
//   - 各百分位随月龄单调非降；
//   - 男孩整体略高/略重于女孩。
// 单位：height=cm，weight=kg，head=cm。
//
// ❗ 它不是 WHO 官方 LMS 数据表导出的精确数值。正式发布前必须用 WHO 官方
//    LMS（L/M/S）数据表（length/height-for-age、weight-for-age、
//    head-circumference-for-age，boys/girls）重新计算并替换本文件。
//    替换指引见 data/who-growth.README.md。
//
// 本文件由 scripts/gen-who-growth.js 生成，请勿手改；改参数后重跑生成脚本。
`;

const body = "module.exports = " + JSON.stringify(data, null, 2) + ";\n";
const outPath = path.join(__dirname, "..", "utils", "who-growth.js");
fs.writeFileSync(outPath, header + "\n" + body, "utf8");
console.log("written:", outPath);
