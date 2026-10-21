// cloudfunctions/exportReport/index.js
// 数据导出 - 健康报告生成云函数（Task 16）。
// 方便就医时给医生看：汇总宝贝基本信息 + 成长 / 辅食 / 过敏数据，生成结构化
// report 对象，并产出可带走的文件（PDF 或网页版 HTML），写入云存储后返回 fileID。
//
// 入参：
//   {
//     babyId,
//     range: 'week'|'month'|'3month'|'custom'（默认 'month'）,
//     startDate?, endDate?               // range==='custom' 时使用，'YYYY-MM-DD'
//     contents: ['meal','allergy','growth']（可多选，默认全选）,
//     format: 'pdf'|'html'（默认 'pdf'）
//   }
// 返回：
//   format==='pdf' : { success:true, data:{ report, fileID, format:'pdf', fontMissing } }
//   format==='html': { success:true, data:{ report, fileID, format:'html' } }
//   失败：{ success:false, error }
//
// 权限校验在云函数内完成（家庭共享集合不走客户端直连），思路同 meal/growth 的
// resolveAccess / assertBabyAccess。云函数之间不共享代码，helper 在本文件内实现。
//
// 日期处理：'YYYY-MM-DD' 按东八区解析（dayStartOf），区间上界取 endDate 次日 0 点。
//
// 依赖与中文字体（重要）：
//   - 本函数依赖 pdfkit 生成 PDF。上传部署时请选择"云端安装依赖"以安装 pdfkit。
//   - pdfkit 默认不含中文字体。请把中文 ttf（如思源黑体 Regular/子集）命名为
//     app.ttf 放在 cloudfunctions/exportReport/fonts/ 目录（详见该目录 README.md）。
//   - 若 fonts/app.ttf 不存在：PDF 仍会生成且不崩溃，但中文可能无法显示，返回
//     fontMissing=true，并在 PDF 首页标注提示。此时建议改用 format='html'（中文无忧）。
const cloud = require("wx-server-sdk");
const fs = require("fs");
const path = require("path");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const babiesCol = db.collection("babies");
const membersCol = db.collection("family_members");
const mealsCol = db.collection("meal_records");
const allergyRecordsCol = db.collection("allergy_records");
const allergyAlertsCol = db.collection("allergy_alerts");
const growthCol = db.collection("growth_records");
const timelineCol = db.collection("food_timeline");

/** 合法内容项 */
const CONTENT_KEYS = ["meal", "allergy", "growth"];
/** 合法时间范围 */
const RANGE_KEYS = ["week", "month", "3month", "custom"];
/** 中文字体文件路径（自行放置） */
const FONT_PATH = path.join(__dirname, "fonts", "app.ttf");

/** 成功响应 */
function ok(data) {
  return { success: true, data };
}
/** 失败响应 */
function fail(error) {
  return { success: false, error: String(error) };
}

/**
 * 校验 "YYYY-MM-DD" 字符串格式
 * @param {*} value
 * @returns {boolean}
 */
function isDateString(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}
/**
 * 把 "YYYY-MM-DD" 解析为东八区当天 0 点的 Date 对象。
 * @param {string} dateStr
 * @returns {Date|null}
 */
function dayStartOf(dateStr) {
  if (!isDateString(dateStr)) {
    return null;
  }
  const d = new Date(`${dateStr}T00:00:00.000+08:00`);
  return isNaN(d.getTime()) ? null : d;
}
/**
 * 次日 0 点（区间上界，exclusive）。
 * @param {Date} date
 * @returns {Date}
 */
function nextDay(date) {
  return new Date(date.getTime() + 24 * 60 * 60 * 1000);
}
/**
 * 东八区展示日期：云端 Date（UTC）转 'YYYY-MM-DD'。
 * @param {*} value
 * @returns {string}
 */
function formatCloudDate(value) {
  if (!value) {
    return "";
  }
  try {
    const d = value instanceof Date ? value : new Date(value);
    if (isNaN(d.getTime())) {
      return typeof value === "string" ? value : "";
    }
    const shifted = new Date(d.getTime() + 8 * 60 * 60 * 1000);
    return shifted.toISOString().slice(0, 10);
  } catch (e) {
    return "";
  }
}
/**
 * 友好月龄文本（与 utils/date.js calcAgeText 等价，云端内联实现）。
 * @param {*} birthday Date 或字符串
 * @param {Date} [now]
 * @returns {string}
 */
function calcAgeText(birthday, now) {
  const b = birthday instanceof Date ? birthday : new Date(birthday);
  const n = now instanceof Date ? now : new Date();
  if (isNaN(b.getTime())) {
    return "";
  }
  // 以东八区分量计算月龄
  const bs = new Date(b.getTime() + 8 * 60 * 60 * 1000);
  const ns = new Date(n.getTime() + 8 * 60 * 60 * 1000);
  let months =
    (ns.getUTCFullYear() - bs.getUTCFullYear()) * 12 + (ns.getUTCMonth() - bs.getUTCMonth());
  if (ns.getUTCDate() < bs.getUTCDate()) {
    months -= 1;
  }
  months = Math.max(0, months);
  const years = Math.floor(months / 12);
  const rem = months % 12;
  if (years <= 0) {
    return `${rem}个月`;
  }
  if (rem === 0) {
    return `${years}岁`;
  }
  return `${years}岁${rem}个月`;
}

/**
 * 查询某用户对某宝贝的访问权限。owner 或在 family_members 中即有权访问。
 * @returns {Promise<{baby:Object|null, isOwner:boolean, member:Object|null}>}
 */
async function resolveAccess(babyId, openid) {
  const babyRes = await babiesCol.doc(babyId).get().catch(() => ({ data: null }));
  const baby = babyRes && babyRes.data ? babyRes.data : null;
  if (!baby) {
    return { baby: null, isOwner: false, member: null };
  }
  const isOwner = baby.ownerId === openid;
  let member = null;
  if (!isOwner) {
    const memRes = await membersCol
      .where({ babyId: babyId, userOpenid: openid })
      .limit(1)
      .get();
    member = memRes.data && memRes.data.length > 0 ? memRes.data[0] : null;
  }
  return { baby, isOwner, member };
}
/**
 * 断言用户对宝贝有访问权，否则抛出错误（供统一 catch 转 fail）。
 * @returns {Promise<{baby:Object, isOwner:boolean, member:Object|null}>}
 */
async function assertBabyAccess(babyId, openid) {
  if (!babyId) {
    throw new Error("babyId 必填");
  }
  const access = await resolveAccess(babyId, openid);
  if (!access.baby) {
    throw new Error("宝贝不存在");
  }
  if (!access.isOwner && !access.member) {
    throw new Error("无权访问该宝贝");
  }
  return access;
}

/**
 * 规范 contents 入参为去重的合法内容项数组，默认全选。
 * @param {*} raw
 * @returns {string[]}
 */
function normalizeContents(raw) {
  if (!Array.isArray(raw) || raw.length === 0) {
    return CONTENT_KEYS.slice();
  }
  const out = [];
  CONTENT_KEYS.forEach((k) => {
    if (raw.indexOf(k) >= 0) {
      out.push(k);
    }
  });
  return out.length > 0 ? out : CONTENT_KEYS.slice();
}

/**
 * 性别文本
 * @param {number} gender 0未知/1男/2女
 * @returns {string}
 */
function genderText(gender) {
  const g = Number(gender);
  if (g === 1) {
    return "男";
  }
  if (g === 2) {
    return "女";
  }
  return "未知";
}

/** 餐别中文 */
const MEAL_TYPE_LABELS = {
  breakfast: "早餐",
  lunch: "午餐",
  dinner: "晚餐",
  snack_am: "上午加餐",
  snack_pm: "下午加餐",
  night: "夜宵",
  custom: "自定义"
};
/** 时间线分类中文 */
const CATEGORY_LABELS = {
  grain: "谷物",
  veggie: "蔬菜",
  fruit: "水果",
  meat: "肉类",
  egg_dairy: "蛋奶",
  seafood: "海鲜",
  other: "其他"
};
/** 过敏预警状态中文 */
const ALERT_STATUS_LABELS = {
  suspected: "疑似",
  confirmed: "确认",
  cleared: "已排除"
};

/**
 * 根据 range 计算起止日期（东八区的 'YYYY-MM-DD'）与区间 Date 边界。
 * week=近7天 / month=近1月 / 3month=近3月 / custom=传入 startDate/endDate。
 * @param {Object} event
 * @returns {{ startStr:string, endStr:string, start:Date, endExclusive:Date }}
 */
function resolveRange(event) {
  const range = RANGE_KEYS.indexOf(event.range) >= 0 ? event.range : "month";
  // 以东八区"今天"为基准
  const nowShifted = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const todayStr = nowShifted.toISOString().slice(0, 10);
  if (range === "custom") {
    const s = dayStartOf(event.startDate);
    const e = dayStartOf(event.endDate);
    if (!s || !e) {
      throw new Error("自定义范围需提供合法 startDate/endDate（YYYY-MM-DD）");
    }
    if (s.getTime() > e.getTime()) {
      throw new Error("开始日期不能晚于结束日期");
    }
    return {
      startStr: event.startDate,
      endStr: event.endDate,
      start: s,
      endExclusive: nextDay(e)
    };
  }
  const end = dayStartOf(todayStr);
  let days = 30;
  if (range === "week") {
    days = 7;
  } else if (range === "3month") {
    days = 90;
  }
  // 近 N 天：含今天，向前推 (N-1) 天
  const start = new Date(end.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
  const startStr = new Date(start.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return {
    startStr: startStr,
    endStr: todayStr,
    start: start,
    endExclusive: nextDay(end)
  };
}

/**
 * 分页取某集合区间内按 date 的全部文档（单宝贝量级可控，设安全上限）。
 * @param {Object} col 集合
 * @param {Object} where 查询条件
 * @param {string} orderField 排序字段
 * @param {string} orderDir 'asc'|'desc'
 * @returns {Promise<Object[]>}
 */
async function fetchAll(col, where, orderField, orderDir) {
  const out = [];
  const MAX = 2000;
  for (let skip = 0; skip < MAX; skip += 100) {
    let q = col.where(where);
    if (orderField) {
      q = q.orderBy(orderField, orderDir || "asc");
    }
    const res = await q.skip(skip).limit(100).get();
    const batch = res.data || [];
    for (let i = 0; i < batch.length; i++) {
      out.push(batch[i]);
    }
    if (batch.length < 100) {
      break;
    }
  }
  return out;
}

/**
 * 汇总成长数据：最新身高/体重/头围 + 区间内记录条数 + 区间记录摘要（最多若干条）。
 * @param {string} babyId
 * @param {{start:Date, endExclusive:Date}} rangeInfo
 */
async function summarizeGrowth(babyId, rangeInfo) {
  // 最新测量：取全部按 date 升序后取最后一条有值的
  const all = await fetchAll(growthCol, { babyId: babyId }, "date", "asc");
  let latest = null;
  if (all.length > 0) {
    const last = all[all.length - 1];
    latest = {
      date: formatCloudDate(last.date),
      height: numOrNull(last.height),
      weight: numOrNull(last.weight),
      headCircumference: numOrNull(last.headCircumference)
    };
  }
  // 区间内记录
  const inRange = all.filter((r) => {
    const t = toTime(r.date);
    return t >= rangeInfo.start.getTime() && t < rangeInfo.endExclusive.getTime();
  });
  const records = inRange.map((r) => ({
    date: formatCloudDate(r.date),
    height: numOrNull(r.height),
    weight: numOrNull(r.weight),
    headCircumference: numOrNull(r.headCircumference)
  }));
  return {
    latest: latest,
    totalRecords: all.length,
    rangeCount: records.length,
    records: records
  };
}

/**
 * 汇总辅食数据：区间内 meal_records 按日期聚合（每天餐次数、食物种类计数），
 * 以及辅食时间线已尝试食物数。
 * @param {string} babyId
 * @param {{start:Date, endExclusive:Date}} rangeInfo
 */
async function summarizeMeal(babyId, rangeInfo) {
  const meals = await fetchAll(
    mealsCol,
    { babyId: babyId, date: _.gte(rangeInfo.start).and(_.lt(rangeInfo.endExclusive)) },
    "date",
    "asc"
  );
  // 按日期聚合
  const byDateMap = {};
  const allFoodSet = {};
  let totalMealCount = 0;
  meals.forEach((m) => {
    const d = formatCloudDate(m.date);
    if (!byDateMap[d]) {
      byDateMap[d] = { date: d, mealCount: 0, foodSet: {} };
    }
    byDateMap[d].mealCount += 1;
    totalMealCount += 1;
    const foods = Array.isArray(m.foods) ? m.foods : [];
    foods.forEach((f) => {
      const name = f && typeof f.name === "string" ? f.name.trim() : "";
      if (name) {
        byDateMap[d].foodSet[name] = true;
        allFoodSet[name] = true;
      }
    });
  });
  const byDate = Object.keys(byDateMap)
    .sort()
    .map((d) => ({
      date: d,
      mealCount: byDateMap[d].mealCount,
      foodKinds: Object.keys(byDateMap[d].foodSet).length
    }));
  // 辅食时间线：已尝试食材总数（全量，非区间）
  const timeline = await fetchAll(timelineCol, { babyId: babyId }, "firstTriedDate", "asc");
  const timelineByCategory = {};
  timeline.forEach((t) => {
    const c = CATEGORY_LABELS[t.category] || CATEGORY_LABELS.other;
    timelineByCategory[c] = (timelineByCategory[c] || 0) + 1;
  });
  return {
    rangeMealCount: totalMealCount,
    activeDays: byDate.length,
    distinctFoods: Object.keys(allFoodSet).length,
    byDate: byDate,
    triedFoodsTotal: timeline.length,
    triedByCategory: timelineByCategory
  };
}

/**
 * 汇总过敏数据：过敏原清单（allergy_alerts）+ 区间内 allergy_records 列表。
 * @param {string} babyId
 * @param {{start:Date, endExclusive:Date}} rangeInfo
 */
async function summarizeAllergy(babyId, rangeInfo) {
  const alerts = await fetchAll(allergyAlertsCol, { babyId: babyId }, "updatedAt", "desc");
  const allergens = alerts.map((a) => ({
    foodName: a.foodName || "",
    status: ALERT_STATUS_LABELS[a.status] || a.status || "",
    firstOccurrence: formatCloudDate(a.firstOccurrence),
    lastOccurrence: formatCloudDate(a.lastOccurrence),
    symptomsSummary: Array.isArray(a.symptomsSummary) ? a.symptomsSummary : []
  }));
  const records = await fetchAll(
    allergyRecordsCol,
    { babyId: babyId, date: _.gte(rangeInfo.start).and(_.lt(rangeInfo.endExclusive)) },
    "date",
    "desc"
  );
  const recordList = records.map((r) => ({
    date: formatCloudDate(r.date),
    symptoms: Array.isArray(r.symptoms) ? r.symptoms : [],
    suspectedFoods: Array.isArray(r.suspectedFoods) ? r.suspectedFoods : [],
    severity: r.severity || "",
    note: r.note || ""
  }));
  return {
    allergenCount: allergens.length,
    allergens: allergens,
    rangeRecordCount: recordList.length,
    records: recordList
  };
}

/** 数值或 null */
function numOrNull(v) {
  return typeof v === "number" && isFinite(v) && v > 0 ? v : null;
}
/** Date → ms */
function toTime(value) {
  if (!value) {
    return 0;
  }
  const d = value instanceof Date ? value : new Date(value);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

/**
 * 组装结构化报告对象 report（供前端预览与生成文件共用）。
 * @param {Object} baby
 * @param {string[]} contents
 * @param {Object} rangeInfo
 * @param {Object} parts { growth?, meal?, allergy? }
 * @returns {Object}
 */
function buildReport(baby, contents, rangeInfo, parts) {
  return {
    generatedAt: formatCloudDate(new Date()),
    range: {
      key: rangeInfo.key,
      startDate: rangeInfo.startStr,
      endDate: rangeInfo.endStr,
      label: rangeInfo.label
    },
    contents: contents,
    baby: {
      name: baby.name || "宝贝",
      gender: genderText(baby.gender),
      birthday: formatCloudDate(baby.birthday),
      ageText: calcAgeText(baby.birthday, new Date())
    },
    growth: parts.growth || null,
    meal: parts.meal || null,
    allergy: parts.allergy || null
  };
}

/** range key → 中文标签 */
function rangeLabel(key) {
  if (key === "week") {
    return "近一周";
  }
  if (key === "month") {
    return "近一月";
  }
  if (key === "3month") {
    return "近三月";
  }
  return "自定义区间";
}

/* =============== HTML 报告（路线 A，中文无忧） =============== */

/** HTML 转义 */
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * 生成自包含 HTML 字符串（内联 CSS、标题、各板块表格），中文正常。
 * @param {Object} report
 * @returns {string}
 */
function buildHtml(report) {
  const b = report.baby;
  const rows = [];
  rows.push(`<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">`);
  rows.push(`<meta name="viewport" content="width=device-width, initial-scale=1">`);
  rows.push(`<title>${esc(b.name)} 健康成长报告</title>`);
  rows.push(
    `<style>` +
      `body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:#4A4A4A;background:#FFF8F6;margin:0;padding:24px;}` +
      `.wrap{max-width:760px;margin:0 auto;background:#fff;border-radius:16px;padding:28px;box-shadow:0 8px 24px rgba(255,143,163,.12);}` +
      `h1{color:#FF8FA3;font-size:24px;margin:0 0 4px;}` +
      `.sub{color:#9B9B9B;font-size:13px;margin-bottom:20px;}` +
      `h2{font-size:18px;color:#4A4A4A;border-left:4px solid #FF8FA3;padding-left:10px;margin:28px 0 12px;}` +
      `table{width:100%;border-collapse:collapse;font-size:13px;margin:8px 0;}` +
      `th,td{border:1px solid #F0E0E0;padding:8px 10px;text-align:left;}` +
      `th{background:#FFE4E1;color:#C77B8B;font-weight:600;}` +
      `.info td{border:none;padding:4px 12px 4px 0;}` +
      `.tag{display:inline-block;background:#FFE4E1;color:#FF8FA3;border-radius:999px;padding:2px 10px;font-size:12px;margin:2px;}` +
      `.muted{color:#9B9B9B;}` +
      `.footer{margin-top:28px;color:#9B9B9B;font-size:12px;text-align:center;}` +
      `</style></head><body><div class="wrap">`
  );
  rows.push(`<h1>${esc(b.name)} 健康成长报告</h1>`);
  rows.push(
    `<div class="sub">生成日期：${esc(report.generatedAt)} ｜ 统计区间：${esc(
      report.range.label
    )}（${esc(report.range.startDate)} 至 ${esc(report.range.endDate)}）</div>`
  );
  // 宝贝基本信息
  rows.push(`<h2>宝贝信息</h2>`);
  rows.push(
    `<table class="info"><tr><td>姓名</td><td>${esc(b.name)}</td><td>性别</td><td>${esc(
      b.gender
    )}</td></tr>` +
      `<tr><td>出生日期</td><td>${esc(b.birthday)}</td><td>当前月龄</td><td>${esc(
        b.ageText
      )}</td></tr></table>`
  );
  // 成长
  if (report.growth) {
    const g = report.growth;
    rows.push(`<h2>成长数据</h2>`);
    if (g.latest) {
      rows.push(
        `<p>最新测量（${esc(g.latest.date)}）：身高 ${fmtNum(g.latest.height, "cm")}，` +
          `体重 ${fmtNum(g.latest.weight, "kg")}，头围 ${fmtNum(
            g.latest.headCircumference,
            "cm"
          )}</p>`
      );
    } else {
      rows.push(`<p class="muted">暂无成长测量记录</p>`);
    }
    if (g.records.length > 0) {
      rows.push(
        `<table><tr><th>日期</th><th>身高(cm)</th><th>体重(kg)</th><th>头围(cm)</th></tr>` +
          g.records
            .map(
              (r) =>
                `<tr><td>${esc(r.date)}</td><td>${fmtCell(r.height)}</td><td>${fmtCell(
                  r.weight
                )}</td><td>${fmtCell(r.headCircumference)}</td></tr>`
            )
            .join("") +
          `</table>`
      );
    } else {
      rows.push(`<p class="muted">该区间内无成长记录（共 ${g.totalRecords} 条历史记录）</p>`);
    }
  }
  // 辅食
  if (report.meal) {
    const m = report.meal;
    rows.push(`<h2>辅食记录</h2>`);
    rows.push(
      `<p>区间内共 ${m.rangeMealCount} 条用餐记录，覆盖 ${m.activeDays} 天，` +
        `涉及 ${m.distinctFoods} 种食物；辅食时间线已尝试 ${m.triedFoodsTotal} 种食材。</p>`
    );
    const cats = Object.keys(m.triedByCategory);
    if (cats.length > 0) {
      rows.push(
        `<p>${cats.map((c) => `<span class="tag">${esc(c)} ${m.triedByCategory[c]}</span>`).join("")}</p>`
      );
    }
    if (m.byDate.length > 0) {
      rows.push(
        `<table><tr><th>日期</th><th>餐次数</th><th>食物种类</th></tr>` +
          m.byDate
            .map(
              (d) =>
                `<tr><td>${esc(d.date)}</td><td>${d.mealCount}</td><td>${d.foodKinds}</td></tr>`
            )
            .join("") +
          `</table>`
      );
    } else {
      rows.push(`<p class="muted">该区间内无用餐记录</p>`);
    }
  }
  // 过敏
  if (report.allergy) {
    const a = report.allergy;
    rows.push(`<h2>过敏信息</h2>`);
    if (a.allergens.length > 0) {
      rows.push(
        `<table><tr><th>过敏原</th><th>状态</th><th>首次</th><th>最近</th><th>症状</th></tr>` +
          a.allergens
            .map(
              (al) =>
                `<tr><td>${esc(al.foodName)}</td><td>${esc(al.status)}</td><td>${esc(
                  al.firstOccurrence
                )}</td><td>${esc(al.lastOccurrence)}</td><td>${esc(
                  (al.symptomsSummary || []).join("、")
                )}</td></tr>`
            )
            .join("") +
          `</table>`
      );
    } else {
      rows.push(`<p class="muted">暂无过敏原记录</p>`);
    }
    if (a.records.length > 0) {
      rows.push(`<h3 style="font-size:15px;color:#C77B8B;">区间内过敏事件</h3>`);
      rows.push(
        `<table><tr><th>日期</th><th>症状</th><th>疑似食物</th><th>备注</th></tr>` +
          a.records
            .map(
              (r) =>
                `<tr><td>${esc(r.date)}</td><td>${esc(
                  (r.symptoms || []).join("、")
                )}</td><td>${esc((r.suspectedFoods || []).join("、"))}</td><td>${esc(
                  r.note
                )}</td></tr>`
            )
            .join("") +
          `</table>`
      );
    }
  }
  rows.push(
    `<div class="footer">本报告由「小饭团成长记」生成，供就医参考。数据仅反映家长记录内容。</div>`
  );
  rows.push(`</div></body></html>`);
  return rows.join("");
}

/** HTML 数值单元格 */
function fmtCell(v) {
  return v == null ? '<span class="muted">—</span>' : esc(String(v));
}
/** 数值+单位，空值 "—" */
function fmtNum(v, unit) {
  return v == null ? "—" : `${v}${unit}`;
}

/* =============== PDF 报告（路线 B，pdfkit） =============== */

/**
 * 用 pdfkit 生成 PDF Buffer。收集 data chunks，doc.end 后 Buffer.concat。
 * 中文字体：若 fonts/app.ttf 存在则内嵌，否则用默认字体并标注字体缺失提示。
 * @param {Object} report
 * @param {boolean} fontMissing
 * @returns {Promise<Buffer>}
 */
function buildPdfBuffer(report, fontMissing) {
  // require 延迟到运行时，避免本地无依赖时 require 报错影响其它逻辑。
  const PDFDocument = require("pdfkit");
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margin: 48 });
      const chunks = [];
      doc.on("data", (c) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", (e) => reject(e));

      // 字体：有中文字体则注册并设为默认
      let useFont = null;
      if (!fontMissing) {
        try {
          doc.registerFont("cn", FONT_PATH);
          doc.font("cn");
          useFont = "cn";
        } catch (e) {
          useFont = null;
        }
      }
      const setFont = () => {
        if (useFont) {
          doc.font(useFont);
        }
      };

      const b = report.baby;
      // 标题
      doc.fontSize(20).fillColor("#FF8FA3");
      setFont();
      doc.text(`${b.name} 健康成长报告`, { align: "center" });
      doc.moveDown(0.3);
      doc.fontSize(10).fillColor("#9B9B9B");
      setFont();
      doc.text(
        `生成日期：${report.generatedAt}  |  统计区间：${report.range.label}（${report.range.startDate} 至 ${report.range.endDate}）`,
        { align: "center" }
      );
      if (fontMissing) {
        doc.moveDown(0.6);
        doc.fontSize(9).fillColor("#FF6B6B");
        doc.text(
          "[Notice] Chinese font not configured (fonts/app.ttf missing). Chinese text may be unreadable in this PDF. Please place the font file or use the HTML (webpage) export instead.",
          { align: "center" }
        );
      }
      doc.moveDown(0.8);

      const section = (title) => {
        doc.moveDown(0.6);
        doc.fontSize(14).fillColor("#C77B8B");
        setFont();
        doc.text(title);
        doc.moveDown(0.2);
        doc.fontSize(11).fillColor("#4A4A4A");
        setFont();
      };
      const line = (txt) => {
        doc.fontSize(11).fillColor("#4A4A4A");
        setFont();
        doc.text(txt);
      };

      // 宝贝信息
      section("宝贝信息");
      line(`姓名：${b.name}    性别：${b.gender}`);
      line(`出生日期：${b.birthday}    当前月龄：${b.ageText}`);

      // 成长
      if (report.growth) {
        const g = report.growth;
        section("成长数据");
        if (g.latest) {
          line(
            `最新测量（${g.latest.date}）：身高 ${fmtNum(g.latest.height, "cm")}，体重 ${fmtNum(
              g.latest.weight,
              "kg"
            )}，头围 ${fmtNum(g.latest.headCircumference, "cm")}`
          );
        } else {
          line("暂无成长测量记录");
        }
        if (g.records.length > 0) {
          g.records.forEach((r) => {
            line(
              `· ${r.date}  身高 ${fmtNum(r.height, "cm")}  体重 ${fmtNum(
                r.weight,
                "kg"
              )}  头围 ${fmtNum(r.headCircumference, "cm")}`
            );
          });
        } else {
          line(`该区间内无成长记录（共 ${g.totalRecords} 条历史记录）`);
        }
      }

      // 辅食
      if (report.meal) {
        const m = report.meal;
        section("辅食记录");
        line(
          `区间内共 ${m.rangeMealCount} 条用餐记录，覆盖 ${m.activeDays} 天，涉及 ${m.distinctFoods} 种食物。`
        );
        line(`辅食时间线已尝试 ${m.triedFoodsTotal} 种食材。`);
        const cats = Object.keys(m.triedByCategory);
        if (cats.length > 0) {
          line("已尝试分类：" + cats.map((c) => `${c} ${m.triedByCategory[c]}`).join("，"));
        }
        if (m.byDate.length > 0) {
          m.byDate.forEach((d) => {
            line(`· ${d.date}  餐次 ${d.mealCount}  食物种类 ${d.foodKinds}`);
          });
        } else {
          line("该区间内无用餐记录");
        }
      }

      // 过敏
      if (report.allergy) {
        const a = report.allergy;
        section("过敏信息");
        if (a.allergens.length > 0) {
          a.allergens.forEach((al) => {
            const sym = (al.symptomsSummary || []).join("、");
            line(
              `· ${al.foodName}（${al.status}）首次 ${al.firstOccurrence || "—"}，最近 ${
                al.lastOccurrence || "—"
              }${sym ? "，症状：" + sym : ""}`
            );
          });
        } else {
          line("暂无过敏原记录");
        }
        if (a.records.length > 0) {
          doc.moveDown(0.3);
          line("区间内过敏事件：");
          a.records.forEach((r) => {
            line(
              `· ${r.date}  症状：${(r.symptoms || []).join("、") || "—"}  疑似：${
                (r.suspectedFoods || []).join("、") || "—"
              }${r.note ? "  备注：" + r.note : ""}`
            );
          });
        }
      }

      doc.moveDown(1);
      doc.fontSize(9).fillColor("#9B9B9B");
      setFont();
      doc.text("本报告由「小饭团成长记」生成，供就医参考。数据仅反映家长记录内容。", {
        align: "center"
      });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * 云函数入口
 */
exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) {
    return fail("无法获取用户身份（OPENID 为空）");
  }
  try {
    const babyId = event.babyId;
    const access = await assertBabyAccess(babyId, OPENID);
    const baby = access.baby;

    const contents = normalizeContents(event.contents);
    const format = event.format === "html" ? "html" : "pdf";
    const rangeInfo = resolveRange(event);
    rangeInfo.key = RANGE_KEYS.indexOf(event.range) >= 0 ? event.range : "month";
    rangeInfo.label = rangeLabel(rangeInfo.key);

    // 汇总各板块
    const parts = {};
    if (contents.indexOf("growth") >= 0) {
      parts.growth = await summarizeGrowth(babyId, rangeInfo);
    }
    if (contents.indexOf("meal") >= 0) {
      parts.meal = await summarizeMeal(babyId, rangeInfo);
    }
    if (contents.indexOf("allergy") >= 0) {
      parts.allergy = await summarizeAllergy(babyId, rangeInfo);
    }

    const report = buildReport(baby, contents, rangeInfo, parts);
    const ts = Date.now();

    if (format === "html") {
      const html = buildHtml(report);
      const cloudPath = `exports/${babyId}-${ts}.html`;
      const uploadRes = await cloud.uploadFile({
        cloudPath: cloudPath,
        fileContent: Buffer.from(html, "utf-8")
      });
      return ok({ report: report, fileID: uploadRes.fileID, format: "html" });
    }

    // format === 'pdf'
    const fontMissing = !fileExistsSafe(FONT_PATH);
    let buffer;
    try {
      buffer = await buildPdfBuffer(report, fontMissing);
    } catch (pdfErr) {
      return fail("PDF 生成失败：" + ((pdfErr && pdfErr.message) || String(pdfErr)));
    }
    const cloudPath = `exports/${babyId}-${ts}.pdf`;
    const uploadRes = await cloud.uploadFile({
      cloudPath: cloudPath,
      fileContent: buffer
    });
    return ok({
      report: report,
      fileID: uploadRes.fileID,
      format: "pdf",
      fontMissing: fontMissing
    });
  } catch (err) {
    return fail((err && err.errMsg) || (err && err.message) || String(err));
  }
};

/** 安全判断文件是否存在（异常视为不存在） */
function fileExistsSafe(p) {
  try {
    return fs.existsSync(p);
  } catch (e) {
    return false;
  }
}
