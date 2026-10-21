// utils/date.js —— 日期与月龄计算工具（纯函数，无小程序 API 依赖，便于单元测试）

/**
 * 将输入标准化为 Date 对象
 * @param {Date|string} value Date 或 "YYYY-MM-DD" 字符串
 * @returns {Date}
 */
function toDate(value) {
  if (value instanceof Date) {
    return new Date(value.getTime());
  }
  if (typeof value === "string") {
    // 兼容 "YYYY-MM-DD" 与 "YYYY/MM/DD"
    const parts = value.split(/[-/]/).map((n) => parseInt(n, 10));
    if (parts.length >= 3 && !parts.some(isNaN)) {
      return new Date(parts[0], parts[1] - 1, parts[2]);
    }
    const d = new Date(value);
    if (!isNaN(d.getTime())) {
      return d;
    }
  }
  throw new Error("Invalid date input: " + value);
}

/**
 * 计算宝宝月龄（整数月，向下取整）
 * @param {Date|string} birthday 生日
 * @param {Date} [now=new Date()] 当前日期
 * @returns {number} 月龄（整数月，最小 0）
 */
function calcMonthAge(birthday, now = new Date()) {
  const b = toDate(birthday);
  const n = toDate(now);

  let months = (n.getFullYear() - b.getFullYear()) * 12 + (n.getMonth() - b.getMonth());
  // 若当月日期还没到生日那天，减去 1 个月
  if (n.getDate() < b.getDate()) {
    months -= 1;
  }
  return Math.max(0, months);
}

/**
 * 友好的年龄文本，如 "7个月" 或 "1岁3个月"
 * @param {Date|string} birthday 生日
 * @param {Date} [now=new Date()] 当前日期
 * @returns {string}
 */
function calcAgeText(birthday, now = new Date()) {
  const totalMonths = calcMonthAge(birthday, now);
  const years = Math.floor(totalMonths / 12);
  const months = totalMonths % 12;

  if (years <= 0) {
    return `${months}个月`;
  }
  if (months === 0) {
    return `${years}岁`;
  }
  return `${years}岁${months}个月`;
}

/**
 * 辅食阶段定义（按月龄区间，左闭右开）
 */
const STAGES = [
  { key: "milk", name: "纯奶期", range: "0-6月", min: 0, max: 6, tip: "母乳/配方奶为主，暂不添加辅食" },
  { key: "swallow", name: "吞咽期", range: "6-7月", min: 6, max: 7, tip: "泥糊状，高铁米粉、单一蔬果泥" },
  { key: "chew", name: "蠕嚼期", range: "7-8月", min: 7, max: 8, tip: "稠糊/末状，蛋黄、肉泥" },
  { key: "mince", name: "细碎期", range: "8-10月", min: 8, max: 10, tip: "碎末/小块，手指食物引入" },
  { key: "bite", name: "咀嚼期", range: "10-12月", min: 10, max: 12, tip: "小块软食，接近家庭饮食" },
  { key: "toddlerA", name: "幼儿期A", range: "12-18月", min: 12, max: 18, tip: "三餐规律化，饮食多样化" },
  { key: "toddlerB", name: "幼儿期B", range: "18-24月", min: 18, max: 24, tip: "基本同成人，注意清淡调味" },
  { key: "toddlerC", name: "幼儿期C", range: "24-36月", min: 24, max: 36, tip: "均衡饮食，培养自主进食" }
];

/**
 * 根据月龄返回辅食阶段对象
 * @param {number} month 月龄（整数月）
 * @returns {{ key: string, name: string, range: string, tip: string }}
 */
function getStageByMonth(month) {
  const m = Number(month) || 0;

  for (const stage of STAGES) {
    // 左闭右开；最后一个区间右端闭合，容纳 36 月
    if (stage.max === 36) {
      if (m >= stage.min && m <= stage.max) {
        return pickStage(stage);
      }
    } else if (m >= stage.min && m < stage.max) {
      return pickStage(stage);
    }
  }

  // 超过 36 月，返回最后一个阶段
  if (m > 36) {
    return pickStage(STAGES[STAGES.length - 1]);
  }
  // 兜底返回纯奶期
  return pickStage(STAGES[0]);
}

function pickStage(stage) {
  return { key: stage.key, name: stage.name, range: stage.range, tip: stage.tip };
}

/**
 * 补零
 */
function pad2(n) {
  return n < 10 ? "0" + n : "" + n;
}

/**
 * 格式化日期
 * @param {Date|string} date
 * @param {string} [fmt="YYYY-MM-DD"] 支持 YYYY MM DD HH mm ss
 * @returns {string}
 */
function formatDate(date, fmt = "YYYY-MM-DD") {
  const d = toDate(date);
  const map = {
    YYYY: d.getFullYear(),
    MM: pad2(d.getMonth() + 1),
    DD: pad2(d.getDate()),
    HH: pad2(d.getHours()),
    mm: pad2(d.getMinutes()),
    ss: pad2(d.getSeconds())
  };
  return fmt.replace(/YYYY|MM|DD|HH|mm|ss/g, (key) => map[key]);
}

/**
 * 判断是否为同一天
 * @param {Date|string} a
 * @param {Date|string} b
 * @returns {boolean}
 */
function isSameDay(a, b) {
  const da = toDate(a);
  const db = toDate(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

/**
 * 以 centerDate 所在周（周一为起点）返回一周 7 天的日期数组
 * @param {Date|string} [centerDate=new Date()]
 * @returns {Date[]} 长度为 7，从周一到周日
 */
function getWeekDates(centerDate = new Date()) {
  const c = toDate(centerDate);
  const base = new Date(c.getFullYear(), c.getMonth(), c.getDate());
  // getDay(): 0=周日, 1=周一 ... 转成以周一为第 0 天
  const dayOfWeek = (base.getDay() + 6) % 7;
  const monday = new Date(base);
  monday.setDate(base.getDate() - dayOfWeek);

  const week = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    week.push(d);
  }
  return week;
}

module.exports = {
  toDate,
  calcMonthAge,
  calcAgeText,
  getStageByMonth,
  formatDate,
  isSameDay,
  getWeekDates,
  STAGES
};
