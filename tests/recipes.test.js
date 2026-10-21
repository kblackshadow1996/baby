// tests/recipes.test.js —— 预置食谱数据校验
const fs = require("fs");
const path = require("path");

const DATA_PATH = path.join(__dirname, "..", "data", "recipes.json");
const CF_PATH = path.join(
  __dirname,
  "..",
  "cloudfunctions",
  "initRecipes",
  "recipes.json"
);

const recipes = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));

const TYPES = ["staple", "meat", "veggie", "soup", "snack"];
// 7 个辅食段（不含 0-6 纯奶期），每段至少若干食谱
const FEEDING_STAGES = [
  [6, 7],
  [7, 8],
  [8, 10],
  [10, 12],
  [12, 18],
  [18, 24],
  [24, 36]
];

describe("data/recipes.json 基础结构", () => {
  test("是数组且长度 >= 50", () => {
    expect(Array.isArray(recipes)).toBe(true);
    expect(recipes.length).toBeGreaterThanOrEqual(50);
  });

  test("每条含必填字段", () => {
    const required = [
      "title",
      "monthAgeMin",
      "monthAgeMax",
      "type",
      "ingredients",
      "steps",
      "source",
      "isOfficial"
    ];
    recipes.forEach((r, i) => {
      required.forEach((key) => {
        expect(r).toHaveProperty(key);
        expect(r[key] !== undefined && r[key] !== null).toBe(true);
      });
      // 类型细节
      expect(typeof r.title).toBe("string");
      expect(r.title.length).toBeGreaterThan(0);
      expect(Array.isArray(r.ingredients)).toBe(true);
      expect(r.ingredients.length).toBeGreaterThan(0);
      expect(Array.isArray(r.steps)).toBe(true);
      expect(r.steps.length).toBeGreaterThan(0);
      expect(r.isOfficial).toBe(true);
      // 官方食谱无创建者/归属
      expect(r.creatorOpenid).toBe("");
      expect(r.babyId).toBe("");
      // 占位图
      expect(typeof r.imageUrl).toBe("string");
      // 不应内嵌 createdAt（由云函数写 serverDate）
      expect(r.createdAt).toBeUndefined();
      // 索引仅用于定位报错
      void i;
    });
  });

  test("type 在枚举集合内；monthAgeMin<=monthAgeMax 且为整数", () => {
    recipes.forEach((r) => {
      expect(TYPES).toContain(r.type);
      expect(Number.isInteger(r.monthAgeMin)).toBe(true);
      expect(Number.isInteger(r.monthAgeMax)).toBe(true);
      expect(r.monthAgeMin).toBeLessThanOrEqual(r.monthAgeMax);
    });
  });

  test("每条 source.name 非空（来源必须标注）", () => {
    recipes.forEach((r) => {
      expect(r.source).toBeDefined();
      expect(typeof r.source.name).toBe("string");
      expect(r.source.name.trim().length).toBeGreaterThan(0);
    });
  });

  test("ingredients 每项有 name/amount，isAllergen 为 boolean", () => {
    recipes.forEach((r) => {
      r.ingredients.forEach((item) => {
        expect(typeof item.name).toBe("string");
        expect(item.name.length).toBeGreaterThan(0);
        expect(typeof item.amount).toBe("string");
        expect(item.amount.length).toBeGreaterThan(0);
        expect(typeof item.isAllergen).toBe("boolean");
      });
    });
  });

  test("allergens 为数组，tags 为数组", () => {
    recipes.forEach((r) => {
      expect(Array.isArray(r.allergens)).toBe(true);
      expect(Array.isArray(r.tags)).toBe(true);
    });
  });
});

describe("月龄段覆盖", () => {
  test.each(FEEDING_STAGES)("辅食段 %i-%i 至少 5 条", (min, max) => {
    const count = recipes.filter(
      (r) => r.monthAgeMin === min && r.monthAgeMax === max
    ).length;
    expect(count).toBeGreaterThanOrEqual(5);
  });

  test("覆盖全部 5 个 type", () => {
    const used = new Set(recipes.map((r) => r.type));
    TYPES.forEach((t) => expect(used.has(t)).toBe(true));
  });
});

describe("数据源与云函数副本一致", () => {
  test("cloudfunctions/initRecipes/recipes.json 与 data/recipes.json 深比较一致", () => {
    const cf = JSON.parse(fs.readFileSync(CF_PATH, "utf8"));
    expect(JSON.stringify(cf)).toBe(JSON.stringify(recipes));
  });
});
