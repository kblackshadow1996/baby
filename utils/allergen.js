// utils/allergen.js —— 统一的过敏原模糊匹配工具（纯函数，CommonJS，无小程序 API 依赖）
// 供食谱列表卡片 ⚠️、食谱详情顶部提示/食材高亮、添加餐次输入提醒三处统一调用（Task 11）。
// 设计目标：
//   1) 直接互相 includes 的朴素模糊匹配（过敏原"鸡蛋"命中食材"鸡蛋羹"，反之亦然）。
//   2) 通过同义/包含词表增强，使"鸡蛋"也能命中"蛋黄""蒸蛋"等不含"鸡蛋"二字的食物。
//   3) 空 alerts 全链路安全返回 false / []。

/**
 * 常见过敏原同义/包含词表：键为规范过敏原名，值为可能出现在食材名/食物名中的关键词。
 * 用于增强模糊匹配：当某个规范过敏原被宝贝登记后，食物名命中其任一同义词即判定命中。
 * @type {Object<string, string[]>}
 */
const ALLERGEN_SYNONYMS = {
  鸡蛋: ["蛋", "蛋黄", "蛋白", "鸡蛋羹", "蒸蛋", "蛋花"],
  牛奶: ["奶", "配方奶", "酸奶", "奶酪", "黄油", "乳"],
  小麦: ["面", "面条", "馒头", "面包", "饼", "麸"],
  大豆: ["豆", "豆腐", "豆浆", "豆干"],
  花生: ["花生", "花生酱"],
  坚果: ["核桃", "杏仁", "腰果", "开心果", "榛子"],
  鱼: ["鱼", "鳕鱼", "三文鱼", "鲈鱼", "龙利鱼"],
  "虾蟹贝类（海鲜）": ["虾", "蟹", "贝", "蛤", "蛎", "海鲜"],
  芝麻: ["芝麻", "芝麻酱"]
};

/**
 * 安全转字符串并 trim；非字符串/空值返回空字符串。
 * @param {*} v
 * @returns {string}
 */
function toStr(v) {
  if (v === undefined || v === null) {
    return "";
  }
  return String(v).trim();
}

/**
 * 把输入过敏原名归一化到规范键：
 *  - 若等于某键 → 返回该键；
 *  - 否则若命中某键的任一同义词（互相 includes）→ 返回该键；
 *  - 都不命中 → 返回原始（trim 后）名称。
 * @param {string} name
 * @returns {string}
 */
function normalizeAllergenName(name) {
  const n = toStr(name);
  if (!n) {
    return n;
  }
  if (Object.prototype.hasOwnProperty.call(ALLERGEN_SYNONYMS, n)) {
    return n;
  }
  const keys = Object.keys(ALLERGEN_SYNONYMS);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const syns = ALLERGEN_SYNONYMS[key];
    for (let j = 0; j < syns.length; j++) {
      const s = syns[j];
      if (!s) {
        continue;
      }
      if (n === s || n.includes(s) || s.includes(n)) {
        return key;
      }
    }
  }
  return n;
}

/**
 * 判断单个食物名是否命中某个过敏原。
 * 规则：
 *   1) 直接互相 includes（foodName 含 allergenName 或反之）→ true；
 *   2) allergenName 归一化后若有同义词表，foodName 命中任一同义词 → true。
 * @param {string} foodName
 * @param {string} allergenName
 * @returns {boolean}
 */
function isFoodAllergicTo(foodName, allergenName) {
  const food = toStr(foodName);
  const allergen = toStr(allergenName);
  if (!food || !allergen) {
    return false;
  }
  // 规则 1：朴素互相 includes
  if (food.includes(allergen) || allergen.includes(food)) {
    return true;
  }
  // 规则 2：同义词增强
  const key = normalizeAllergenName(allergen);
  const syns = ALLERGEN_SYNONYMS[key];
  if (Array.isArray(syns)) {
    for (let i = 0; i < syns.length; i++) {
      const s = syns[i];
      if (s && food.includes(s)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * 把 alerts 规范为非空字符串数组（容错：传入对象数组时取 foodName）。
 * @param {Array} alerts
 * @returns {string[]}
 */
function normalizeAlerts(alerts) {
  if (!Array.isArray(alerts)) {
    return [];
  }
  const out = [];
  for (let i = 0; i < alerts.length; i++) {
    const a = alerts[i];
    let name = "";
    if (typeof a === "string") {
      name = a.trim();
    } else if (a && typeof a === "object" && typeof a.foodName === "string") {
      name = a.foodName.trim();
    }
    if (name) {
      out.push(name);
    }
  }
  return out;
}

/**
 * 给一组食物名与宝贝过敏原名数组，返回命中详情数组 [{ foodName, allergen }]（每个命中项）。
 * 同一 foodName 对多个过敏原命中会产生多条，便于提示展示。
 * @param {string[]} foodNames
 * @param {string[]} alerts 过敏原名称数组（或 alert 对象数组）
 * @returns {Array<{foodName:string, allergen:string}>}
 */
function matchFoodsAgainstAlerts(foodNames, alerts) {
  const names = Array.isArray(foodNames) ? foodNames : [];
  const allergens = normalizeAlerts(alerts);
  if (names.length === 0 || allergens.length === 0) {
    return [];
  }
  const out = [];
  for (let i = 0; i < names.length; i++) {
    const food = toStr(names[i]);
    if (!food) {
      continue;
    }
    for (let j = 0; j < allergens.length; j++) {
      const allergen = allergens[j];
      if (isFoodAllergicTo(food, allergen)) {
        out.push({ foodName: food, allergen: allergen });
      }
    }
  }
  return out;
}

/**
 * 对一条食谱（含 allergens[] 与 ingredients[].name），返回命中的宝贝过敏原名数组（去重）。
 * 供列表卡片 ⚠️ 与详情顶部提示统一调用。
 * @param {Object} recipe
 * @param {string[]} alerts 过敏原名称数组
 * @returns {string[]} 命中的过敏原名称（取自 alerts，去重保序）
 */
function recipeHitAllergens(recipe, alerts) {
  const allergens = normalizeAlerts(alerts);
  if (!recipe || allergens.length === 0) {
    return [];
  }
  // 收集食谱侧所有可比对的名称：allergens[] + ingredients[].name
  const names = [];
  if (Array.isArray(recipe.allergens)) {
    recipe.allergens.forEach((a) => {
      const s = toStr(a);
      if (s) {
        names.push(s);
      }
    });
  }
  if (Array.isArray(recipe.ingredients)) {
    recipe.ingredients.forEach((ing) => {
      const s = ing && ing.name ? toStr(ing.name) : "";
      if (s) {
        names.push(s);
      }
    });
  }
  if (names.length === 0) {
    return [];
  }
  const hits = [];
  for (let i = 0; i < allergens.length; i++) {
    const allergen = allergens[i];
    let hit = false;
    for (let j = 0; j < names.length; j++) {
      if (isFoodAllergicTo(names[j], allergen)) {
        hit = true;
        break;
      }
    }
    if (hit && hits.indexOf(allergen) === -1) {
      hits.push(allergen);
    }
  }
  return hits;
}

/**
 * 单个字符串命中测试：某食物名是否命中 alerts 中任一过敏原。
 * @param {string} foodName
 * @param {string[]} alerts 过敏原名称数组（空 → false）
 * @returns {boolean}
 */
function matchName(foodName, alerts) {
  const allergens = normalizeAlerts(alerts);
  const food = toStr(foodName);
  if (!food || allergens.length === 0) {
    return false;
  }
  for (let i = 0; i < allergens.length; i++) {
    if (isFoodAllergicTo(food, allergens[i])) {
      return true;
    }
  }
  return false;
}

/**
 * 返回某食物名命中的所有过敏原名（去重），供提示展示。
 * @param {string} foodName
 * @param {string[]} alerts
 * @returns {string[]}
 */
function matchedAllergensForFood(foodName, alerts) {
  const allergens = normalizeAlerts(alerts);
  const food = toStr(foodName);
  const out = [];
  if (!food || allergens.length === 0) {
    return out;
  }
  for (let i = 0; i < allergens.length; i++) {
    const allergen = allergens[i];
    if (isFoodAllergicTo(food, allergen) && out.indexOf(allergen) === -1) {
      out.push(allergen);
    }
  }
  return out;
}

module.exports = {
  ALLERGEN_SYNONYMS,
  normalizeAllergenName,
  isFoodAllergicTo,
  matchFoodsAgainstAlerts,
  recipeHitAllergens,
  matchName,
  matchedAllergensForFood
};
