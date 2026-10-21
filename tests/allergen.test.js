// tests/allergen.test.js —— utils/allergen.js 纯函数单元测试
const {
  ALLERGEN_SYNONYMS,
  normalizeAllergenName,
  isFoodAllergicTo,
  matchFoodsAgainstAlerts,
  recipeHitAllergens,
  matchName,
  matchedAllergensForFood
} = require("../utils/allergen");

describe("normalizeAllergenName", () => {
  test("规范键原样返回", () => {
    expect(normalizeAllergenName("鸡蛋")).toBe("鸡蛋");
    expect(normalizeAllergenName("牛奶")).toBe("牛奶");
  });
  test("同义词归一化到规范键", () => {
    expect(normalizeAllergenName("蛋黄")).toBe("鸡蛋");
    expect(normalizeAllergenName("酸奶")).toBe("牛奶");
    expect(normalizeAllergenName("鳕鱼")).toBe("鱼");
  });
  test("未知名称返回原值（trim）", () => {
    expect(normalizeAllergenName(" 芒果 ")).toBe("芒果");
  });
  test("空值安全", () => {
    expect(normalizeAllergenName("")).toBe("");
    expect(normalizeAllergenName(null)).toBe("");
    expect(normalizeAllergenName(undefined)).toBe("");
  });
});

describe("isFoodAllergicTo", () => {
  test("鸡蛋 命中 蛋黄 / 鸡蛋羹 / 蒸蛋", () => {
    expect(isFoodAllergicTo("蛋黄", "鸡蛋")).toBe(true);
    expect(isFoodAllergicTo("鸡蛋羹", "鸡蛋")).toBe(true);
    expect(isFoodAllergicTo("蒸蛋", "鸡蛋")).toBe(true);
  });
  test("牛奶 命中 酸奶 / 配方奶", () => {
    expect(isFoodAllergicTo("酸奶", "牛奶")).toBe(true);
    expect(isFoodAllergicTo("配方奶", "牛奶")).toBe(true);
  });
  test("鱼 命中 鳕鱼 / 三文鱼", () => {
    expect(isFoodAllergicTo("鳕鱼泥", "鱼")).toBe(true);
    expect(isFoodAllergicTo("三文鱼", "鱼")).toBe(true);
  });
  test("直接 includes（朴素匹配）", () => {
    expect(isFoodAllergicTo("高铁米粉", "米粉")).toBe(true);
    // 过敏原名"虾蟹贝类（海鲜）"字面包含"虾"，食物名"虾"被其 includes → 命中
    expect(isFoodAllergicTo("虾", "虾蟹贝类（海鲜）")).toBe(true);
  });
  test("海鲜类过敏原走同义词命中 虾仁 / 蟹黄", () => {
    expect(isFoodAllergicTo("虾仁", "虾蟹贝类（海鲜）")).toBe(true);
    expect(isFoodAllergicTo("蟹黄", "虾蟹贝类（海鲜）")).toBe(true);
  });
  test("不相关不命中", () => {
    expect(isFoodAllergicTo("胡萝卜", "鸡蛋")).toBe(false);
    expect(isFoodAllergicTo("南瓜泥", "鱼")).toBe(false);
  });
  test("空值安全", () => {
    expect(isFoodAllergicTo("", "鸡蛋")).toBe(false);
    expect(isFoodAllergicTo("蛋黄", "")).toBe(false);
    expect(isFoodAllergicTo(null, null)).toBe(false);
  });
});

describe("matchName", () => {
  test("命中返回 true", () => {
    expect(matchName("鸡蛋羹", ["鸡蛋"])).toBe(true);
    expect(matchName("酸奶", ["牛奶", "鸡蛋"])).toBe(true);
  });
  test("不命中返回 false", () => {
    expect(matchName("米粉", ["鸡蛋", "牛奶"])).toBe(false);
  });
  test("alerts 空数组安全返回 false", () => {
    expect(matchName("鸡蛋羹", [])).toBe(false);
    expect(matchName("鸡蛋羹", null)).toBe(false);
    expect(matchName("鸡蛋羹", undefined)).toBe(false);
  });
});

describe("matchFoodsAgainstAlerts", () => {
  test("返回命中详情数组", () => {
    const hits = matchFoodsAgainstAlerts(["蛋黄泥", "胡萝卜"], ["鸡蛋"]);
    expect(hits).toEqual([{ foodName: "蛋黄泥", allergen: "鸡蛋" }]);
  });
  test("一个食物命中多个过敏原产生多条", () => {
    const hits = matchFoodsAgainstAlerts(["牛奶鸡蛋羹"], ["牛奶", "鸡蛋"]);
    expect(hits).toHaveLength(2);
  });
  test("接受 alert 对象数组（取 foodName）", () => {
    const hits = matchFoodsAgainstAlerts(["酸奶"], [{ foodName: "牛奶", status: "suspected" }]);
    expect(hits).toEqual([{ foodName: "酸奶", allergen: "牛奶" }]);
  });
  test("空输入安全返回 []", () => {
    expect(matchFoodsAgainstAlerts([], ["鸡蛋"])).toEqual([]);
    expect(matchFoodsAgainstAlerts(["蛋黄"], [])).toEqual([]);
    expect(matchFoodsAgainstAlerts(null, null)).toEqual([]);
  });
});

describe("recipeHitAllergens", () => {
  test("通过 allergens 字段命中", () => {
    const recipe = { allergens: ["鸡蛋"], ingredients: [{ name: "米粉" }] };
    expect(recipeHitAllergens(recipe, ["鸡蛋"])).toEqual(["鸡蛋"]);
  });
  test("通过 ingredients.name 命中（同义词）", () => {
    const recipe = { allergens: [], ingredients: [{ name: "蛋黄" }, { name: "南瓜" }] };
    expect(recipeHitAllergens(recipe, ["鸡蛋"])).toEqual(["鸡蛋"]);
  });
  test("命中多个过敏原去重", () => {
    const recipe = { allergens: ["牛奶"], ingredients: [{ name: "鸡蛋羹" }] };
    const hits = recipeHitAllergens(recipe, ["牛奶", "鸡蛋"]);
    expect(hits.sort()).toEqual(["牛奶", "鸡蛋"].sort());
  });
  test("不相关不命中", () => {
    const recipe = { allergens: [], ingredients: [{ name: "胡萝卜" }, { name: "南瓜" }] };
    expect(recipeHitAllergens(recipe, ["鸡蛋"])).toEqual([]);
  });
  test("alerts 空数组安全返回 []", () => {
    const recipe = { allergens: ["鸡蛋"], ingredients: [{ name: "蛋黄" }] };
    expect(recipeHitAllergens(recipe, [])).toEqual([]);
  });
  test("recipe 空值安全返回 []", () => {
    expect(recipeHitAllergens(null, ["鸡蛋"])).toEqual([]);
    expect(recipeHitAllergens({}, ["鸡蛋"])).toEqual([]);
  });
});

describe("matchedAllergensForFood", () => {
  test("返回命中过敏原名（去重）", () => {
    expect(matchedAllergensForFood("牛奶鸡蛋羹", ["牛奶", "鸡蛋"]).sort()).toEqual(
      ["牛奶", "鸡蛋"].sort()
    );
  });
  test("空安全", () => {
    expect(matchedAllergensForFood("", ["鸡蛋"])).toEqual([]);
    expect(matchedAllergensForFood("蛋黄", [])).toEqual([]);
  });
});

describe("ALLERGEN_SYNONYMS 表结构", () => {
  test("每个键对应字符串数组", () => {
    Object.keys(ALLERGEN_SYNONYMS).forEach((k) => {
      expect(Array.isArray(ALLERGEN_SYNONYMS[k])).toBe(true);
      ALLERGEN_SYNONYMS[k].forEach((s) => expect(typeof s).toBe("string"));
    });
  });
});
