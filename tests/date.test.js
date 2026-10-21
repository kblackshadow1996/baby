// tests/date.test.js —— utils/date.js 纯函数单元测试
const {
  calcMonthAge,
  calcAgeText,
  getStageByMonth,
  formatDate,
  isSameDay,
  getWeekDates
} = require("../utils/date");

describe("calcMonthAge", () => {
  test("整整 7 个月", () => {
    expect(calcMonthAge("2024-01-15", new Date(2024, 7, 15))).toBe(7); // 8月-1月=7
  });

  test("当月日期未到生日，减 1 个月", () => {
    // 生日 2024-01-15，到 2024-08-10，还差 5 天 => 6 个月
    expect(calcMonthAge("2024-01-15", new Date(2024, 7, 10))).toBe(6);
  });

  test("跨年 1 岁 3 个月 = 15 个月", () => {
    expect(calcMonthAge("2023-01-10", new Date(2024, 3, 10))).toBe(15);
  });

  test("生日在未来或同天，最小为 0", () => {
    expect(calcMonthAge("2024-05-01", new Date(2024, 4, 1))).toBe(0);
    expect(calcMonthAge("2024-06-01", new Date(2024, 4, 1))).toBe(0);
  });

  test("支持 Date 类型入参", () => {
    expect(calcMonthAge(new Date(2024, 0, 1), new Date(2024, 6, 1))).toBe(6);
  });
});

describe("getStageByMonth 边界", () => {
  test("5 月 -> 纯奶期", () => {
    expect(getStageByMonth(5).name).toBe("纯奶期");
    expect(getStageByMonth(5).key).toBe("milk");
  });
  test("6 月 -> 吞咽期", () => {
    expect(getStageByMonth(6).name).toBe("吞咽期");
  });
  test("7 月 -> 蠕嚼期", () => {
    expect(getStageByMonth(7).name).toBe("蠕嚼期");
  });
  test("8 月 -> 细碎期", () => {
    expect(getStageByMonth(8).name).toBe("细碎期");
  });
  test("10 月 -> 咀嚼期", () => {
    expect(getStageByMonth(10).name).toBe("咀嚼期");
  });
  test("12 月 -> 幼儿期A", () => {
    expect(getStageByMonth(12).name).toBe("幼儿期A");
  });
  test("18 月 -> 幼儿期B", () => {
    expect(getStageByMonth(18).name).toBe("幼儿期B");
  });
  test("24 月 -> 幼儿期C", () => {
    expect(getStageByMonth(24).name).toBe("幼儿期C");
  });
  test("36 月 -> 幼儿期C", () => {
    expect(getStageByMonth(36).name).toBe("幼儿期C");
  });
  test("0 月 -> 纯奶期", () => {
    expect(getStageByMonth(0).name).toBe("纯奶期");
  });
  test("返回对象包含 key/name/range/tip", () => {
    const s = getStageByMonth(7);
    expect(s).toHaveProperty("key");
    expect(s).toHaveProperty("name");
    expect(s).toHaveProperty("range");
    expect(s).toHaveProperty("tip");
  });
});

describe("calcAgeText", () => {
  test("不足 1 岁显示月", () => {
    expect(calcAgeText("2024-01-01", new Date(2024, 7, 1))).toBe("7个月");
  });
  test("1 岁 3 个月", () => {
    expect(calcAgeText("2023-01-01", new Date(2024, 3, 1))).toBe("1岁3个月");
  });
  test("整岁只显示岁", () => {
    expect(calcAgeText("2022-01-01", new Date(2024, 0, 1))).toBe("2岁");
  });
  test("0 个月", () => {
    expect(calcAgeText("2024-05-01", new Date(2024, 4, 1))).toBe("0个月");
  });
});

describe("formatDate", () => {
  test("默认 YYYY-MM-DD", () => {
    expect(formatDate(new Date(2024, 2, 5))).toBe("2024-03-05");
  });
  test("自定义格式", () => {
    expect(formatDate(new Date(2024, 2, 5), "YYYY/MM/DD")).toBe("2024/03/05");
  });
});

describe("isSameDay", () => {
  test("同一天", () => {
    expect(isSameDay("2024-03-05", new Date(2024, 2, 5))).toBe(true);
  });
  test("不同天", () => {
    expect(isSameDay("2024-03-05", "2024-03-06")).toBe(false);
  });
});

describe("getWeekDates", () => {
  test("返回 7 天且首日为周一", () => {
    // 2024-03-06 是周三
    const week = getWeekDates(new Date(2024, 2, 6));
    expect(week).toHaveLength(7);
    expect(week[0].getDay()).toBe(1); // 周一
    expect(week[6].getDay()).toBe(0); // 周日
    expect(formatDate(week[0])).toBe("2024-03-04");
    expect(formatDate(week[6])).toBe("2024-03-10");
  });
});
