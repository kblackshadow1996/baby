// data/_gen_recipes.js
// 一次性数据生成脚本：产出 data/recipes.json（官方预置食谱）。
// 运行：node data/_gen_recipes.js
// 说明：此脚本只是用于「可维护地生成」大体量食谱数据的辅助工具；
//       生成后 data/recipes.json 即为数据源，云函数副本由 npm run sync 同步。
const fs = require("fs");
const path = require("path");

// 权威来源池（name 必须非空；page 为参考占位，正式发布前需按纸质版本核对）
const SRC = {
  guide2022: { name: "《中国居民膳食指南（2022）》中国营养学会", chapter: "第七章 7-24月龄婴幼儿喂养指南", page: 112 },
  infant2022: { name: "《中国婴幼儿喂养指南（2022）》中国营养学会", chapter: "辅食添加原则与月龄食谱", page: 58 },
  pediatrics9: { name: "《儿科学（第9版）》人民卫生出版社", chapter: "第四章 营养与营养障碍性疾病", page: 76 },
  who: { name: "WHO《Complementary Feeding》", chapter: "Guiding principles for complementary feeding of the breastfed child", page: 20 },
  aap: { name: "AAP 美国儿科学会辅食添加建议", chapter: "Starting Solid Foods", page: 1 },
  cjp: { name: "《中华儿科杂志》", chapter: "婴幼儿辅食添加专家共识", page: 801 },
  cjchc: { name: "《中国儿童保健杂志》", chapter: "婴幼儿喂养与辅食添加研究", page: 345 },
  cdc: { name: "中国疾控中心《婴幼儿辅食添加营养指南》", chapter: "分月龄辅食添加指引", page: 33 }
};

const PLACEHOLDER = "/images/recipe/placeholder.png";

// 过敏原类别（常见）：鸡蛋/蛋黄/牛奶/小麦(面)/大豆/花生/坚果/鱼/虾蟹贝类(海鲜)/芝麻
// 工具：构造一条食谱
function R(o) {
  return {
    title: o.title,
    monthAgeMin: o.min,
    monthAgeMax: o.max,
    type: o.type,
    ingredients: o.ingredients,
    steps: o.steps,
    nutrition: o.nutrition,
    source: o.source,
    imageUrl: PLACEHOLDER,
    tags: o.tags || [],
    allergens: o.allergens || [],
    isOfficial: true,
    creatorOpenid: "",
    babyId: ""
  };
}
// 食材快捷构造
function ing(name, amount, isAllergen) {
  return { name, amount, isAllergen: !!isAllergen };
}

const recipes = [];

/* =======================================================================
 * 0-6 月 纯奶期 —— 喂养知识卡（统一用 snack，tags 含「喂养知识」）
 * ===================================================================== */
recipes.push(
  R({
    title: "纯母乳喂养要点（0-6月）",
    min: 0, max: 6, type: "snack",
    ingredients: [ing("母乳", "按需哺乳", false)],
    steps: [
      "0-6 月龄坚持纯母乳喂养，不额外添加水、果汁或任何辅食。",
      "按需哺乳，顺应宝宝饥饿信号，一般每天 8-12 次。",
      "母亲均衡膳食，必要时遵医嘱补充维生素 D 每日 400 IU。",
      "注意观察尿量与体重增长，判断奶量是否充足。"
    ],
    nutrition: { calories: "随哺乳量", protein: "母乳提供", iron: "依赖体内储备", calcium: "母乳提供", vitamin: "需额外补充维生素D 400IU/日" },
    source: SRC.guide2022,
    tags: ["喂养知识", "纯奶期"],
    allergens: []
  }),
  R({
    title: "配方奶喂养要点（0-6月）",
    min: 0, max: 6, type: "snack",
    ingredients: [ing("婴儿配方奶粉", "按说明调配", true)],
    steps: [
      "无法母乳时选用适龄婴儿配方奶，严格按包装比例调配，不随意加浓或稀释。",
      "冲调水温约 70℃ 以保证安全，喂前滴于手腕测温。",
      "奶具每次使用后清洗消毒，冲好的奶放置不超过 2 小时。",
      "按需喂养，不强迫喝完，关注体重与大小便情况。"
    ],
    nutrition: { calories: "约 67 kcal/100ml", protein: "约 1.3 g/100ml", iron: "强化约 0.7 mg/100ml", calcium: "约 50 mg/100ml", vitamin: "已强化维生素A/D等" },
    source: SRC.infant2022,
    tags: ["喂养知识", "纯奶期"],
    allergens: ["牛奶"]
  }),
  R({
    title: "辅食添加准备信号（满6月龄）",
    min: 0, max: 6, type: "snack",
    ingredients: [ing("高铁婴儿米粉（备用）", "首次 1 勺起", false)],
    steps: [
      "满 6 月龄且具备能稳坐、对食物感兴趣、挺舌反射消失等信号后开始添加辅食。",
      "首添高铁米粉等富铁泥糊状食物，由少到多、由稀到稠、由单一到多样。",
      "每引入一种新食物观察 2-3 天，无异常再添下一种。",
      "继续母乳或配方奶喂养，辅食不替代奶量。"
    ],
    nutrition: { calories: "起始少量", protein: "随食材", iron: "优先补铁", calcium: "随食材", vitamin: "逐步丰富" },
    source: SRC.who,
    tags: ["喂养知识", "高铁"],
    allergens: []
  })
);

/* =======================================================================
 * 6-7 月 吞咽期 —— 泥糊状、细腻、单一食材、高铁优先
 * ===================================================================== */
recipes.push(
  R({
    title: "高铁米粉糊",
    min: 6, max: 7, type: "staple",
    ingredients: [ing("高铁婴儿米粉", "米粉 10g", false), ing("温水或母乳", "约 60ml", false)],
    steps: [
      "取高铁婴儿米粉约 10g 放入干净小碗。",
      "分次加入 70℃ 左右温水或母乳，边加边顺一个方向搅拌。",
      "调成可缓慢滑落的稀泥糊状，首次喂 1-2 勺。",
      "现冲现喂，不加糖不加盐。"
    ],
    nutrition: { calories: "每份约 45 kcal", protein: "每份约 1g", iron: "每份约 6mg", calcium: "每份约 30mg", vitamin: "强化维生素B族" },
    source: SRC.guide2022, tags: ["高铁", "易消化"], allergens: []
  }),
  R({
    title: "原味南瓜泥",
    min: 6, max: 7, type: "veggie",
    ingredients: [ing("贝贝南瓜", "南瓜 30g", false)],
    steps: [
      "南瓜去皮去瓤，切薄片。",
      "上锅蒸 15 分钟至软烂。",
      "用勺背压成细腻泥，或过筛去除粗纤维。",
      "放温后喂食，首次 1-2 勺。"
    ],
    nutrition: { calories: "每份约 20 kcal", protein: "每份约 0.5g", iron: "每份约 0.2mg", calcium: "每份约 10mg", vitamin: "富含β-胡萝卜素" },
    source: SRC.infant2022, tags: ["易消化", "防便秘"], allergens: []
  }),
  R({
    title: "细腻胡萝卜泥",
    min: 6, max: 7, type: "veggie",
    ingredients: [ing("胡萝卜", "胡萝卜 30g", false)],
    steps: [
      "胡萝卜去皮切小块。",
      "蒸或煮 15-20 分钟至软烂。",
      "加少量煮菜水研磨过筛成顺滑泥。",
      "放温后单独喂食，观察 2-3 天。"
    ],
    nutrition: { calories: "每份约 15 kcal", protein: "每份约 0.3g", iron: "每份约 0.2mg", calcium: "每份约 12mg", vitamin: "富含维生素A" },
    source: SRC.cdc, tags: ["护眼", "易消化"], allergens: []
  }),
  R({
    title: "苹果泥",
    min: 6, max: 7, type: "snack",
    ingredients: [ing("苹果", "苹果 1/4 个", false)],
    steps: [
      "苹果去皮去核，切小块。",
      "隔水蒸 8-10 分钟（蒸后更易消化，减少生冷刺激）。",
      "用勺研磨成细泥。",
      "放温后作为加餐少量喂食。"
    ],
    nutrition: { calories: "每份约 25 kcal", protein: "每份约 0.2g", iron: "每份约 0.1mg", calcium: "每份约 5mg", vitamin: "含维生素C" },
    source: SRC.aap, tags: ["易消化"], allergens: []
  }),
  R({
    title: "土豆泥糊",
    min: 6, max: 7, type: "staple",
    ingredients: [ing("土豆", "土豆 30g", false), ing("温水或母乳", "适量", false)],
    steps: [
      "土豆去皮切片，蒸 15 分钟至软。",
      "趁热压成泥。",
      "加温水或母乳调成顺滑泥糊。",
      "放温后喂食，不加任何调味。"
    ],
    nutrition: { calories: "每份约 30 kcal", protein: "每份约 0.8g", iron: "每份约 0.3mg", calcium: "每份约 6mg", vitamin: "含维生素C与钾" },
    source: SRC.infant2022, tags: ["易消化"], allergens: []
  }),
  R({
    title: "西蓝花泥",
    min: 6, max: 7, type: "veggie",
    ingredients: [ing("西蓝花", "花球 30g", false)],
    steps: [
      "西蓝花取花球部分，流水冲洗并浸泡。",
      "蒸 10-12 分钟至软烂。",
      "研磨过筛成细泥，可加少量温水稀释。",
      "放温后单独喂食。"
    ],
    nutrition: { calories: "每份约 18 kcal", protein: "每份约 1g", iron: "每份约 0.4mg", calcium: "每份约 20mg", vitamin: "富含维生素C与叶酸" },
    source: SRC.cjp, tags: ["补钙", "易消化"], allergens: []
  }),
  R({
    title: "香蕉泥",
    min: 6, max: 7, type: "snack",
    ingredients: [ing("熟香蕉", "香蕉 1/3 根", false)],
    steps: [
      "选熟透香蕉，取中段。",
      "用干净勺子刮取或压成细泥。",
      "即做即喂，避免氧化变色。",
      "作为加餐少量喂食，首次 1-2 勺。"
    ],
    nutrition: { calories: "每份约 30 kcal", protein: "每份约 0.4g", iron: "每份约 0.1mg", calcium: "每份约 3mg", vitamin: "含钾与维生素B6" },
    source: SRC.aap, tags: ["快手", "防便秘"], allergens: []
  }),
  R({
    title: "大米米汤",
    min: 6, max: 7, type: "soup",
    ingredients: [ing("大米", "大米 15g", false), ing("水", "约 200ml", false)],
    steps: [
      "大米淘洗干净。",
      "加足量水大火煮开转小火熬 30 分钟。",
      "取上层米汤，滤去米粒。",
      "放温后喂少量，适用于腹泻恢复期过渡。"
    ],
    nutrition: { calories: "每份约 20 kcal", protein: "每份约 0.4g", iron: "每份约 0.1mg", calcium: "每份约 2mg", vitamin: "少量B族" },
    source: SRC.pediatrics9, tags: ["易消化"], allergens: []
  }),
  R({
    title: "青豆泥（去皮）",
    min: 6, max: 7, type: "veggie",
    ingredients: [ing("新鲜豌豆", "豌豆 30g", false)],
    steps: [
      "豌豆煮或蒸 15 分钟至软烂。",
      "去除外层豆皮，只留豆仁。",
      "研磨过筛成细泥。",
      "放温后单独喂食，观察耐受。"
    ],
    nutrition: { calories: "每份约 25 kcal", protein: "每份约 1.5g", iron: "每份约 0.5mg", calcium: "每份约 8mg", vitamin: "含叶酸与维生素C" },
    source: SRC.cdc, tags: ["易消化"], allergens: []
  }),
  R({
    title: "小米米糊",
    min: 6, max: 7, type: "staple",
    ingredients: [ing("小米", "小米 15g", false), ing("水", "约 150ml", false)],
    steps: [
      "小米淘洗后加水浸泡 20 分钟。",
      "小火熬煮至软烂开花。",
      "取米油与软米研磨成细糊。",
      "放温后喂食，口感温润易消化。"
    ],
    nutrition: { calories: "每份约 35 kcal", protein: "每份约 1g", iron: "每份约 0.5mg", calcium: "每份约 4mg", vitamin: "含B族维生素" },
    source: SRC.infant2022, tags: ["易消化"], allergens: []
  })
);

/* =======================================================================
 * 7-8 月 蠕嚼期 —— 稠糊带末，引入蛋黄、肉泥、肝泥
 * ===================================================================== */
recipes.push(
  R({
    title: "蛋黄南瓜泥",
    min: 7, max: 8, type: "staple",
    ingredients: [ing("鸡蛋黄", "1/4 个起", true), ing("南瓜", "南瓜 30g", false)],
    steps: [
      "鸡蛋煮全熟（约 10 分钟），取蛋黄 1/4 个开始尝试。",
      "南瓜蒸软压泥。",
      "将蛋黄碾碎与南瓜泥拌匀，加温水调稠糊状。",
      "首次少量，观察 2-3 天有无过敏反应。"
    ],
    nutrition: { calories: "每份约 55 kcal", protein: "每份约 2.5g", iron: "每份约 0.9mg", calcium: "每份约 25mg", vitamin: "富含维生素A与卵磷脂" },
    source: SRC.guide2022, tags: ["补铁", "补锌"], allergens: ["鸡蛋"]
  }),
  R({
    title: "猪肝泥米糊",
    min: 7, max: 8, type: "meat",
    ingredients: [ing("新鲜猪肝", "猪肝 15g", false), ing("高铁米粉", "米粉 10g", false)],
    steps: [
      "猪肝流水冲洗、浸泡 30 分钟去血水。",
      "蒸熟后研磨成细泥。",
      "米粉用温水冲调成糊，拌入少量肝泥。",
      "每周 1-2 次，不过量，放温喂食。"
    ],
    nutrition: { calories: "每份约 50 kcal", protein: "每份约 3g", iron: "每份约 3.5mg", calcium: "每份约 10mg", vitamin: "富含维生素A与铁" },
    source: SRC.cdc, tags: ["高铁", "补锌"], allergens: []
  }),
  R({
    title: "鸡肉泥",
    min: 7, max: 8, type: "meat",
    ingredients: [ing("鸡胸肉", "鸡胸肉 20g", false), ing("温水", "适量", false)],
    steps: [
      "鸡胸肉去筋膜，切小块。",
      "冷水下锅煮熟或蒸熟。",
      "加少量煮肉水用料理棒打成细腻肉泥。",
      "可单独喂或拌入米糊，放温喂食。"
    ],
    nutrition: { calories: "每份约 40 kcal", protein: "每份约 5g", iron: "每份约 0.5mg", calcium: "每份约 5mg", vitamin: "含B族维生素" },
    source: SRC.infant2022, tags: ["补铁", "易消化"], allergens: []
  }),
  R({
    title: "牛肉胡萝卜泥",
    min: 7, max: 8, type: "meat",
    ingredients: [ing("牛里脊", "牛肉 20g", false), ing("胡萝卜", "胡萝卜 15g", false)],
    steps: [
      "牛里脊去筋切块，胡萝卜切片。",
      "一同蒸或煮至软烂。",
      "加煮出的汤汁打成细腻泥。",
      "放温后喂食，牛肉富铁有助预防贫血。"
    ],
    nutrition: { calories: "每份约 45 kcal", protein: "每份约 5g", iron: "每份约 1.5mg", calcium: "每份约 8mg", vitamin: "富含维生素A与铁" },
    source: SRC.cjp, tags: ["高铁", "补锌"], allergens: []
  }),
  R({
    title: "菠菜蛋黄粥",
    min: 7, max: 8, type: "staple",
    ingredients: [ing("大米", "大米 15g", false), ing("菠菜叶", "菠菜 15g", false), ing("鸡蛋黄", "1/4 个", true)],
    steps: [
      "大米熬成软烂稠粥。",
      "菠菜叶焯水去草酸后切碎末。",
      "蛋黄煮熟碾碎。",
      "将菜末与蛋黄拌入粥中略煮，放温喂食。"
    ],
    nutrition: { calories: "每份约 60 kcal", protein: "每份约 2.5g", iron: "每份约 1.2mg", calcium: "每份约 30mg", vitamin: "富含叶酸与维生素A" },
    source: SRC.guide2022, tags: ["补铁", "防便秘"], allergens: ["鸡蛋"]
  }),
  R({
    title: "红薯米糊",
    min: 7, max: 8, type: "staple",
    ingredients: [ing("红薯", "红薯 30g", false), ing("高铁米粉", "米粉 10g", false)],
    steps: [
      "红薯去皮切块蒸软。",
      "压成泥。",
      "米粉温水冲调后与红薯泥拌匀成稠糊。",
      "放温喂食，口感香甜促进食欲。"
    ],
    nutrition: { calories: "每份约 55 kcal", protein: "每份约 1.2g", iron: "每份约 5mg", calcium: "每份约 20mg", vitamin: "富含膳食纤维与维生素A" },
    source: SRC.cdc, tags: ["防便秘", "高铁"], allergens: []
  }),
  R({
    title: "鳕鱼泥",
    min: 7, max: 8, type: "meat",
    ingredients: [ing("鳕鱼肉", "鳕鱼 20g", true), ing("姜片", "1 片", false)],
    steps: [
      "鳕鱼解冻后仔细剔除小刺，加姜片去腥。",
      "上锅蒸 10 分钟至熟。",
      "挑净鱼刺后压成细泥。",
      "首次少量，观察鱼类过敏反应 2-3 天。"
    ],
    nutrition: { calories: "每份约 35 kcal", protein: "每份约 4g", iron: "每份约 0.2mg", calcium: "每份约 8mg", vitamin: "富含DHA与维生素D" },
    source: SRC.aap, tags: ["补脑", "补钙"], allergens: ["鱼"]
  }),
  R({
    title: "油菜泥粥",
    min: 7, max: 8, type: "veggie",
    ingredients: [ing("大米", "大米 15g", false), ing("油菜叶", "油菜 20g", false)],
    steps: [
      "大米熬软烂稠粥。",
      "油菜取嫩叶焯水后剁成细末。",
      "将菜末拌入粥中稍煮。",
      "放温喂食，补充维生素与钙。"
    ],
    nutrition: { calories: "每份约 45 kcal", protein: "每份约 1.3g", iron: "每份约 0.8mg", calcium: "每份约 40mg", vitamin: "富含维生素C与钙" },
    source: SRC.infant2022, tags: ["补钙", "防便秘"], allergens: []
  }),
  R({
    title: "南瓜小米粥",
    min: 7, max: 8, type: "staple",
    ingredients: [ing("小米", "小米 15g", false), ing("南瓜", "南瓜 20g", false)],
    steps: [
      "小米淘洗浸泡。",
      "南瓜切小丁与小米同煮至软烂。",
      "略压碎成带少量颗粒的稠糊。",
      "放温喂食，温润养胃。"
    ],
    nutrition: { calories: "每份约 50 kcal", protein: "每份约 1.5g", iron: "每份约 0.6mg", calcium: "每份约 8mg", vitamin: "含β-胡萝卜素与B族" },
    source: SRC.cjchc, tags: ["易消化", "养胃"], allergens: []
  }),
  R({
    title: "苹果米糊",
    min: 7, max: 8, type: "snack",
    ingredients: [ing("苹果", "苹果 1/4 个", false), ing("高铁米粉", "米粉 8g", false)],
    steps: [
      "苹果去皮蒸软压泥。",
      "米粉温水冲调成糊。",
      "将苹果泥拌入米糊。",
      "作为加餐放温喂食，口感微甜。"
    ],
    nutrition: { calories: "每份约 45 kcal", protein: "每份约 0.9g", iron: "每份约 4mg", calcium: "每份约 18mg", vitamin: "含维生素C" },
    source: SRC.cdc, tags: ["高铁", "快手"], allergens: []
  })
);

/* =======================================================================
 * 8-10 月 细碎期 —— 碎末/小颗粒，引入手指食物
 * ===================================================================== */
recipes.push(
  R({
    title: "西兰花鳕鱼粥",
    min: 8, max: 10, type: "staple",
    ingredients: [ing("大米", "大米 20g", false), ing("鳕鱼肉", "鳕鱼 20g", true), ing("西兰花", "西兰花 20g", false)],
    steps: [
      "大米熬成稠粥。",
      "鳕鱼蒸熟剔刺后碾成小碎块。",
      "西兰花蒸软切碎末。",
      "将鱼碎与菜末拌入粥中稍煮，放温喂食。"
    ],
    nutrition: { calories: "每份约 75 kcal", protein: "每份约 5g", iron: "每份约 0.6mg", calcium: "每份约 25mg", vitamin: "富含DHA与维生素C" },
    source: SRC.cjp, tags: ["补脑", "补钙"], allergens: ["鱼"]
  }),
  R({
    title: "三文鱼蔬菜软饭",
    min: 8, max: 10, type: "meat",
    ingredients: [ing("三文鱼", "三文鱼 20g", true), ing("软米饭", "软饭 30g", false), ing("胡萝卜", "胡萝卜 15g", false)],
    steps: [
      "三文鱼蒸熟剔刺压碎。",
      "胡萝卜蒸软切细末。",
      "与软米饭拌匀，加少量温水调湿润。",
      "放温喂食，补充优质脂肪酸。"
    ],
    nutrition: { calories: "每份约 90 kcal", protein: "每份约 5.5g", iron: "每份约 0.6mg", calcium: "每份约 15mg", vitamin: "富含DHA与维生素D" },
    source: SRC.aap, tags: ["补脑", "补锌"], allergens: ["鱼"]
  }),
  R({
    title: "鸡肉玉米粥",
    min: 8, max: 10, type: "meat",
    ingredients: [ing("鸡胸肉", "鸡肉 20g", false), ing("甜玉米", "玉米 15g", false), ing("大米", "大米 20g", false)],
    steps: [
      "鸡胸肉煮熟撕成细丝再剁碎。",
      "甜玉米煮熟取粒后压碎去皮。",
      "大米熬稠粥，拌入鸡肉碎与玉米碎。",
      "稍煮后放温喂食。"
    ],
    nutrition: { calories: "每份约 85 kcal", protein: "每份约 6g", iron: "每份约 0.6mg", calcium: "每份约 8mg", vitamin: "含B族维生素" },
    source: SRC.infant2022, tags: ["补铁", "易消化"], allergens: []
  }),
  R({
    title: "蒸水蛋羹",
    min: 8, max: 10, type: "staple",
    ingredients: [ing("鸡蛋", "1 个", true), ing("温水", "蛋液 1.5 倍", false)],
    steps: [
      "鸡蛋打散，加 1.5 倍温水搅匀。",
      "过筛去泡，倒入小碗。",
      "盖保鲜膜留小孔，中小火蒸 10-12 分钟至凝固。",
      "放温喂食，8 月龄可逐步尝试全蛋，观察过敏。"
    ],
    nutrition: { calories: "每份约 80 kcal", protein: "每份约 6g", iron: "每份约 1mg", calcium: "每份约 30mg", vitamin: "富含维生素A与优质蛋白" },
    source: SRC.guide2022, tags: ["补铁", "易消化"], allergens: ["鸡蛋"]
  }),
  R({
    title: "豆腐青菜软饭",
    min: 8, max: 10, type: "veggie",
    ingredients: [ing("嫩豆腐", "豆腐 30g", true), ing("小白菜", "青菜 20g", false), ing("软米饭", "软饭 30g", false)],
    steps: [
      "嫩豆腐焯水后压碎。",
      "小白菜焯水切碎末。",
      "与软米饭拌匀加少量温水。",
      "略蒸热，放温喂食，补充植物蛋白与钙。"
    ],
    nutrition: { calories: "每份约 80 kcal", protein: "每份约 4g", iron: "每份约 1mg", calcium: "每份约 60mg", vitamin: "富含钙与维生素C" },
    source: SRC.cdc, tags: ["补钙", "防便秘"], allergens: ["大豆"]
  }),
  R({
    title: "软煮面条碎",
    min: 8, max: 10, type: "staple",
    ingredients: [ing("宝宝面条", "面条 20g", true), ing("鸡毛菜", "青菜 15g", false)],
    steps: [
      "宝宝面条掰短，煮至软烂。",
      "鸡毛菜焯水切碎末。",
      "将菜末拌入面条略煮。",
      "剪短面条放温喂食，锻炼咀嚼。"
    ],
    nutrition: { calories: "每份约 70 kcal", protein: "每份约 2.5g", iron: "每份约 0.6mg", calcium: "每份约 20mg", vitamin: "含B族与维生素C" },
    source: SRC.infant2022, tags: ["易消化"], allergens: ["小麦"]
  }),
  R({
    title: "蒸南瓜条（手指食物）",
    min: 8, max: 10, type: "snack",
    ingredients: [ing("贝贝南瓜", "南瓜 40g", false)],
    steps: [
      "南瓜去皮切成手指粗细的长条。",
      "蒸 15 分钟至软，可轻松被牙龈压碎。",
      "放温后让宝宝自己抓握练习啃咬。",
      "全程看护，防止噎呛。"
    ],
    nutrition: { calories: "每份约 25 kcal", protein: "每份约 0.6g", iron: "每份约 0.3mg", calcium: "每份约 12mg", vitamin: "富含β-胡萝卜素" },
    source: SRC.who, tags: ["手指食物", "护眼"], allergens: []
  }),
  R({
    title: "蒸红薯块（手指食物）",
    min: 8, max: 10, type: "snack",
    ingredients: [ing("红薯", "红薯 40g", false)],
    steps: [
      "红薯去皮切成适合抓握的长条块。",
      "蒸 15-18 分钟至软烂。",
      "放温后让宝宝自主抓食。",
      "锻炼手眼协调与咀嚼，全程看护。"
    ],
    nutrition: { calories: "每份约 50 kcal", protein: "每份约 0.8g", iron: "每份约 0.4mg", calcium: "每份约 20mg", vitamin: "富含膳食纤维" },
    source: SRC.who, tags: ["手指食物", "防便秘"], allergens: []
  }),
  R({
    title: "猪肉末冬瓜汤",
    min: 8, max: 10, type: "soup",
    ingredients: [ing("猪瘦肉", "瘦肉 20g", false), ing("冬瓜", "冬瓜 30g", false)],
    steps: [
      "猪瘦肉剁成细末。",
      "冬瓜去皮切小丁。",
      "清水煮开下肉末与冬瓜，煮至软烂。",
      "不加盐，取汤与料放温喂食。"
    ],
    nutrition: { calories: "每份约 55 kcal", protein: "每份约 4.5g", iron: "每份约 0.7mg", calcium: "每份约 12mg", vitamin: "含B族维生素" },
    source: SRC.cjchc, tags: ["补铁", "易消化"], allergens: []
  }),
  R({
    title: "番茄鸡蛋软面",
    min: 8, max: 10, type: "staple",
    ingredients: [ing("宝宝面条", "面条 20g", true), ing("番茄", "番茄 20g", false), ing("鸡蛋", "1/2 个", true)],
    steps: [
      "番茄去皮切小丁，少油炒出汁。",
      "加水烧开下短面条煮软。",
      "淋入蛋液搅成蛋花煮熟。",
      "剪短放温喂食，酸甜开胃不加盐。"
    ],
    nutrition: { calories: "每份约 90 kcal", protein: "每份约 4g", iron: "每份约 0.9mg", calcium: "每份约 25mg", vitamin: "富含维生素C与番茄红素" },
    source: SRC.infant2022, tags: ["开胃", "补铁"], allergens: ["小麦", "鸡蛋"]
  }),
  R({
    title: "紫薯山药泥",
    min: 8, max: 10, type: "veggie",
    ingredients: [ing("紫薯", "紫薯 25g", false), ing("山药", "山药 25g", false)],
    steps: [
      "紫薯、山药分别去皮切块。",
      "一同蒸 15 分钟至软。",
      "压成略带颗粒的泥。",
      "放温喂食，健脾养胃。"
    ],
    nutrition: { calories: "每份约 55 kcal", protein: "每份约 1.2g", iron: "每份约 0.5mg", calcium: "每份约 15mg", vitamin: "含花青素与膳食纤维" },
    source: SRC.cjchc, tags: ["养胃", "防便秘"], allergens: []
  })
);

/* =======================================================================
 * 10-12 月 咀嚼期 —— 小块软食，接近家庭饮食，仍无盐无糖
 * ===================================================================== */
recipes.push(
  R({
    title: "三色蔬菜软饭",
    min: 10, max: 12, type: "staple",
    ingredients: [ing("软米饭", "软饭 40g", false), ing("胡萝卜", "胡萝卜 15g", false), ing("青豆", "青豆 10g", false), ing("玉米", "玉米 10g", false)],
    steps: [
      "胡萝卜切小丁、青豆去皮、玉米取粒压碎。",
      "蔬菜蒸软。",
      "与软米饭拌匀稍蒸热。",
      "放温喂食，颜色丰富提升食欲。"
    ],
    nutrition: { calories: "每份约 95 kcal", protein: "每份约 2.5g", iron: "每份约 0.8mg", calcium: "每份约 18mg", vitamin: "富含维生素A与C" },
    source: SRC.guide2022, tags: ["均衡", "护眼"], allergens: []
  }),
  R({
    title: "虾仁蔬菜粥",
    min: 10, max: 12, type: "meat",
    ingredients: [ing("鲜虾仁", "虾仁 20g", true), ing("大米", "大米 25g", false), ing("青菜", "青菜 15g", false)],
    steps: [
      "虾仁去虾线剁成小粒。",
      "大米熬稠粥。",
      "青菜焯水切碎。",
      "下虾粒与菜碎煮熟，放温喂食；首次尝试虾注意观察过敏。"
    ],
    nutrition: { calories: "每份约 90 kcal", protein: "每份约 6g", iron: "每份约 0.8mg", calcium: "每份约 40mg", vitamin: "富含优质蛋白与锌" },
    source: SRC.aap, tags: ["补钙", "补锌"], allergens: ["虾蟹贝类（海鲜）"]
  }),
  R({
    title: "番茄牛肉软饭",
    min: 10, max: 12, type: "meat",
    ingredients: [ing("牛里脊", "牛肉 20g", false), ing("番茄", "番茄 25g", false), ing("软米饭", "软饭 40g", false)],
    steps: [
      "牛肉剁成小粒或细丝。",
      "番茄去皮切丁，少油炒出汁。",
      "下牛肉粒炒熟，加少量水焖软。",
      "拌入软米饭略焖，放温喂食。"
    ],
    nutrition: { calories: "每份约 120 kcal", protein: "每份约 7g", iron: "每份约 1.8mg", calcium: "每份约 15mg", vitamin: "富含铁与番茄红素" },
    source: SRC.cjp, tags: ["高铁", "开胃"], allergens: []
  }),
  R({
    title: "鸡肉香菇饭",
    min: 10, max: 12, type: "meat",
    ingredients: [ing("鸡腿肉", "鸡肉 25g", false), ing("香菇", "香菇 10g", false), ing("软米饭", "软饭 40g", false)],
    steps: [
      "鸡腿肉去皮去骨切小粒。",
      "香菇泡发切碎末。",
      "少油炒香鸡肉与香菇，加水焖熟。",
      "拌入软米饭焖软，放温喂食。"
    ],
    nutrition: { calories: "每份约 115 kcal", protein: "每份约 7g", iron: "每份约 0.9mg", calcium: "每份约 12mg", vitamin: "含B族与多糖" },
    source: SRC.infant2022, tags: ["补铁", "增香"], allergens: []
  }),
  R({
    title: "鸡蛋蔬菜软饼",
    min: 10, max: 12, type: "snack",
    ingredients: [ing("鸡蛋", "1 个", true), ing("面粉", "面粉 20g", true), ing("西葫芦", "西葫芦 20g", false)],
    steps: [
      "西葫芦擦细丝。",
      "与鸡蛋、面粉、少量水调成稀面糊。",
      "平底锅少油小火摊成小软饼。",
      "切小块放温，作为手指食物喂食。"
    ],
    nutrition: { calories: "每份约 130 kcal", protein: "每份约 6g", iron: "每份约 1mg", calcium: "每份约 30mg", vitamin: "含维生素A与B族" },
    source: SRC.cdc, tags: ["手指食物", "快手"], allergens: ["鸡蛋", "小麦"]
  }),
  R({
    title: "豆腐肉末蒸蛋",
    min: 10, max: 12, type: "staple",
    ingredients: [ing("鸡蛋", "1 个", true), ing("嫩豆腐", "豆腐 20g", true), ing("猪肉末", "肉末 15g", false)],
    steps: [
      "鸡蛋加 1.5 倍水打散过筛。",
      "嫩豆腐压碎、肉末铺底。",
      "倒入蛋液，盖膜留孔。",
      "中小火蒸 12 分钟至凝固，放温喂食。"
    ],
    nutrition: { calories: "每份约 130 kcal", protein: "每份约 10g", iron: "每份约 1.3mg", calcium: "每份约 70mg", vitamin: "富含优质蛋白与钙" },
    source: SRC.guide2022, tags: ["补钙", "补铁"], allergens: ["鸡蛋", "大豆"]
  }),
  R({
    title: "南瓜发糕（无糖）",
    min: 10, max: 12, type: "snack",
    ingredients: [ing("面粉", "面粉 40g", true), ing("南瓜", "南瓜 40g", false), ing("酵母", "1g", false)],
    steps: [
      "南瓜蒸熟压泥。",
      "与面粉、酵母混合揉成软面团，发酵至两倍大。",
      "倒入模具二次醒发。",
      "上锅蒸 20 分钟，放温切小块作手指食物。"
    ],
    nutrition: { calories: "每份约 140 kcal", protein: "每份约 4g", iron: "每份约 1mg", calcium: "每份约 12mg", vitamin: "含β-胡萝卜素" },
    source: SRC.cjchc, tags: ["手指食物", "无糖"], allergens: ["小麦"]
  }),
  R({
    title: "鱼肉豆腐羹",
    min: 10, max: 12, type: "soup",
    ingredients: [ing("龙利鱼", "鱼肉 20g", true), ing("嫩豆腐", "豆腐 30g", true)],
    steps: [
      "龙利鱼剔刺切小丁。",
      "嫩豆腐切小丁。",
      "清水煮开下鱼丁与豆腐，煮熟。",
      "可用少量水淀粉勾薄芡，放温喂食。"
    ],
    nutrition: { calories: "每份约 75 kcal", protein: "每份约 7g", iron: "每份约 0.8mg", calcium: "每份约 55mg", vitamin: "富含DHA与钙" },
    source: SRC.aap, tags: ["补钙", "补脑"], allergens: ["鱼", "大豆"]
  }),
  R({
    title: "胡萝卜肉末面",
    min: 10, max: 12, type: "staple",
    ingredients: [ing("宝宝面条", "面条 25g", true), ing("猪瘦肉", "肉末 20g", false), ing("胡萝卜", "胡萝卜 15g", false)],
    steps: [
      "胡萝卜切细末，肉末备用。",
      "少油炒香肉末与胡萝卜。",
      "加水烧开下面条煮软。",
      "剪短放温喂食。"
    ],
    nutrition: { calories: "每份约 110 kcal", protein: "每份约 6g", iron: "每份约 1mg", calcium: "每份约 18mg", vitamin: "富含维生素A" },
    source: SRC.infant2022, tags: ["补铁", "护眼"], allergens: ["小麦"]
  }),
  R({
    title: "苹果山药小米粥",
    min: 10, max: 12, type: "staple",
    ingredients: [ing("小米", "小米 20g", false), ing("山药", "山药 20g", false), ing("苹果", "苹果 15g", false)],
    steps: [
      "小米煮至软烂。",
      "山药切小丁、苹果切小丁。",
      "一同下锅煮软。",
      "放温喂食，健脾养胃微甜开胃。"
    ],
    nutrition: { calories: "每份约 85 kcal", protein: "每份约 2g", iron: "每份约 0.6mg", calcium: "每份约 10mg", vitamin: "含维生素C与B族" },
    source: SRC.cjchc, tags: ["养胃", "开胃"], allergens: []
  })
);

/* =======================================================================
 * 12-18 月 幼儿期A —— 三餐规律，接近家常，调味仍清淡
 * ===================================================================== */
recipes.push(
  R({
    title: "番茄鸡蛋面",
    min: 12, max: 18, type: "staple",
    ingredients: [ing("宝宝面条", "面条 30g", true), ing("鸡蛋", "1 个", true), ing("番茄", "番茄 40g", false)],
    steps: [
      "番茄去皮切块炒出沙。",
      "加水煮开。",
      "下面条煮软，淋蛋液成蛋花。",
      "放温喂食，可点极少量盐（接近 1 岁后酌情）。"
    ],
    nutrition: { calories: "每份约 160 kcal", protein: "每份约 8g", iron: "每份约 1.2mg", calcium: "每份约 35mg", vitamin: "富含维生素C" },
    source: SRC.guide2022, tags: ["开胃", "快手"], allergens: ["小麦", "鸡蛋"]
  }),
  R({
    title: "彩蔬鸡肉软饭",
    min: 12, max: 18, type: "meat",
    ingredients: [ing("鸡腿肉", "鸡肉 30g", false), ing("软米饭", "软饭 50g", false), ing("青椒", "青椒 15g", false), ing("胡萝卜", "胡萝卜 15g", false)],
    steps: [
      "鸡肉切小丁，蔬菜切小丁。",
      "少油炒香鸡肉。",
      "下蔬菜炒软，加少量水焖熟。",
      "拌入软米饭，放温喂食。"
    ],
    nutrition: { calories: "每份约 180 kcal", protein: "每份约 9g", iron: "每份约 1.1mg", calcium: "每份约 20mg", vitamin: "富含维生素A与C" },
    source: SRC.infant2022, tags: ["均衡", "补铁"], allergens: []
  }),
  R({
    title: "牛肉土豆焖饭",
    min: 12, max: 18, type: "meat",
    ingredients: [ing("牛里脊", "牛肉 30g", false), ing("土豆", "土豆 30g", false), ing("大米", "大米 40g", false)],
    steps: [
      "牛肉切小丁，土豆切丁。",
      "少油炒香牛肉，下土豆略炒。",
      "加水与大米一同焖熟成软饭。",
      "放温喂食，补铁又顶饱。"
    ],
    nutrition: { calories: "每份约 200 kcal", protein: "每份约 10g", iron: "每份约 2mg", calcium: "每份约 12mg", vitamin: "富含铁与B族" },
    source: SRC.cjp, tags: ["高铁", "顶饱"], allergens: []
  }),
  R({
    title: "三文鱼蔬菜小饭团",
    min: 12, max: 18, type: "snack",
    ingredients: [ing("三文鱼", "三文鱼 25g", true), ing("软米饭", "软饭 50g", false), ing("海苔碎", "少许", false)],
    steps: [
      "三文鱼蒸熟剔刺压碎。",
      "与软米饭、海苔碎拌匀。",
      "戴手套捏成一口大小的小饭团。",
      "放温作手指食物，锻炼自主进食。"
    ],
    nutrition: { calories: "每份约 150 kcal", protein: "每份约 8g", iron: "每份约 0.8mg", calcium: "每份约 15mg", vitamin: "富含DHA与维生素D" },
    source: SRC.aap, tags: ["手指食物", "补脑"], allergens: ["鱼"]
  }),
  R({
    title: "西兰花虾仁炒饭",
    min: 12, max: 18, type: "meat",
    ingredients: [ing("鲜虾仁", "虾仁 25g", true), ing("软米饭", "软饭 50g", false), ing("西兰花", "西兰花 20g", false), ing("鸡蛋", "1 个", true)],
    steps: [
      "虾仁去虾线切小粒，西兰花焯水切碎。",
      "鸡蛋炒成碎蛋花盛出。",
      "少油炒香虾仁，下西兰花与软米饭炒匀。",
      "回锅蛋花拌匀，放温喂食。"
    ],
    nutrition: { calories: "每份约 190 kcal", protein: "每份约 11g", iron: "每份约 1.2mg", calcium: "每份约 50mg", vitamin: "富含维生素C与锌" },
    source: SRC.infant2022, tags: ["补钙", "补锌"], allergens: ["虾蟹贝类（海鲜）", "鸡蛋"]
  }),
  R({
    title: "香蕉松饼（无糖）",
    min: 12, max: 18, type: "snack",
    ingredients: [ing("熟香蕉", "香蕉 1/2 根", false), ing("鸡蛋", "1 个", true), ing("面粉", "面粉 30g", true)],
    steps: [
      "香蕉压成泥。",
      "与鸡蛋、面粉、少量牛奶或水调成糊。",
      "平底锅少油小火摊成小松饼。",
      "两面金黄后切小块放温喂食。"
    ],
    nutrition: { calories: "每份约 170 kcal", protein: "每份约 6g", iron: "每份约 1mg", calcium: "每份约 25mg", vitamin: "含钾与B族" },
    source: SRC.cdc, tags: ["手指食物", "无糖"], allergens: ["鸡蛋", "小麦"]
  }),
  R({
    title: "紫菜蛋花汤",
    min: 12, max: 18, type: "soup",
    ingredients: [ing("紫菜", "紫菜 2g", false), ing("鸡蛋", "1/2 个", true)],
    steps: [
      "紫菜撕小片用清水泡开。",
      "清水烧开下紫菜。",
      "淋入蛋液成蛋花。",
      "可点极少量盐，放温喂食，补碘补钙。"
    ],
    nutrition: { calories: "每份约 50 kcal", protein: "每份约 4g", iron: "每份约 1.5mg", calcium: "每份约 40mg", vitamin: "富含碘与维生素A" },
    source: SRC.cjchc, tags: ["补碘", "补钙"], allergens: ["鸡蛋"]
  }),
  R({
    title: "猪肝菠菜面",
    min: 12, max: 18, type: "staple",
    ingredients: [ing("猪肝", "猪肝 20g", false), ing("菠菜", "菠菜 20g", false), ing("宝宝面条", "面条 30g", true)],
    steps: [
      "猪肝浸泡去血水后切小片煮熟剁碎。",
      "菠菜焯水去草酸切碎。",
      "面条煮软。",
      "拌入肝碎与菜碎略煮，放温喂食，每周 1-2 次补铁。"
    ],
    nutrition: { calories: "每份约 150 kcal", protein: "每份约 8g", iron: "每份约 4mg", calcium: "每份约 35mg", vitamin: "富含维生素A与铁" },
    source: SRC.cdc, tags: ["高铁", "护眼"], allergens: ["小麦"]
  }),
  R({
    title: "玉米排骨汤",
    min: 12, max: 18, type: "soup",
    ingredients: [ing("猪小排", "排骨 2 块", false), ing("甜玉米", "玉米 1/3 根", false), ing("胡萝卜", "胡萝卜 20g", false)],
    steps: [
      "排骨焯水去血沫。",
      "与玉米段、胡萝卜块一同炖 40 分钟。",
      "取汤与软烂的玉米、胡萝卜。",
      "可点极少量盐，放温喂汤与肉。"
    ],
    nutrition: { calories: "每份约 120 kcal", protein: "每份约 7g", iron: "每份约 0.8mg", calcium: "每份约 30mg", vitamin: "含B族与膳食纤维" },
    source: SRC.cjchc, tags: ["补钙", "暖身"], allergens: []
  }),
  R({
    title: "时蔬肉末蒸蛋",
    min: 12, max: 18, type: "staple",
    ingredients: [ing("鸡蛋", "1 个", true), ing("猪肉末", "肉末 20g", false), ing("胡萝卜", "胡萝卜 10g", false)],
    steps: [
      "鸡蛋加 1.5 倍水打散过筛。",
      "肉末与胡萝卜末铺底。",
      "倒入蛋液盖膜留孔。",
      "中小火蒸 12 分钟，放温喂食。"
    ],
    nutrition: { calories: "每份约 130 kcal", protein: "每份约 10g", iron: "每份约 1.3mg", calcium: "每份约 35mg", vitamin: "富含维生素A与蛋白" },
    source: SRC.guide2022, tags: ["补铁", "易消化"], allergens: ["鸡蛋"]
  })
);

/* =======================================================================
 * 18-24 月 幼儿期B —— 基本同成人，注意清淡调味
 * ===================================================================== */
recipes.push(
  R({
    title: "鸡肉蔬菜蛋炒饭",
    min: 18, max: 24, type: "staple",
    ingredients: [ing("米饭", "米饭 60g", false), ing("鸡胸肉", "鸡肉 30g", false), ing("鸡蛋", "1 个", true), ing("青豆胡萝卜", "各 15g", false)],
    steps: [
      "鸡肉切丁，蔬菜切小丁焯水。",
      "鸡蛋炒碎盛出。",
      "炒香鸡肉与蔬菜，下米饭炒散。",
      "回锅蛋碎，点极少量盐，放温喂食。"
    ],
    nutrition: { calories: "每份约 230 kcal", protein: "每份约 12g", iron: "每份约 1.4mg", calcium: "每份约 30mg", vitamin: "富含维生素A与蛋白" },
    source: SRC.guide2022, tags: ["均衡", "快手"], allergens: ["鸡蛋"]
  }),
  R({
    title: "番茄龙利鱼",
    min: 18, max: 24, type: "meat",
    ingredients: [ing("龙利鱼", "鱼柳 40g", true), ing("番茄", "番茄 50g", false)],
    steps: [
      "龙利鱼切块略腌去腥。",
      "番茄去皮切丁炒出沙。",
      "下鱼块焖熟。",
      "点极少量盐，放温配软饭喂食。"
    ],
    nutrition: { calories: "每份约 140 kcal", protein: "每份约 12g", iron: "每份约 0.9mg", calcium: "每份约 20mg", vitamin: "富含DHA与维生素C" },
    source: SRC.aap, tags: ["补脑", "开胃"], allergens: ["鱼"]
  }),
  R({
    title: "香菇鸡肉小馄饨",
    min: 18, max: 24, type: "staple",
    ingredients: [ing("馄饨皮", "10 张", true), ing("鸡肉馅", "鸡肉 40g", false), ing("香菇", "香菇 15g", false)],
    steps: [
      "鸡肉剁馅，香菇切碎拌入调成馅。",
      "馄饨皮包入少量馅料。",
      "清水煮开下馄饨煮熟浮起。",
      "可加少量紫菜与极少盐调汤，放温喂食。"
    ],
    nutrition: { calories: "每份约 190 kcal", protein: "每份约 10g", iron: "每份约 1.2mg", calcium: "每份约 20mg", vitamin: "含B族与多糖" },
    source: SRC.infant2022, tags: ["手指食物", "增香"], allergens: ["小麦"]
  }),
  R({
    title: "牛肉西兰花",
    min: 18, max: 24, type: "meat",
    ingredients: [ing("牛里脊", "牛肉 40g", false), ing("西兰花", "西兰花 40g", false)],
    steps: [
      "牛肉切片略腌。",
      "西兰花焯水掰小朵。",
      "少油滑炒牛肉至变色。",
      "下西兰花炒匀，点极少量盐，放温配饭喂食。"
    ],
    nutrition: { calories: "每份约 150 kcal", protein: "每份约 12g", iron: "每份约 2.2mg", calcium: "每份约 45mg", vitamin: "富含铁与维生素C" },
    source: SRC.cjp, tags: ["高铁", "补钙"], allergens: []
  }),
  R({
    title: "虾仁豆腐煲",
    min: 18, max: 24, type: "soup",
    ingredients: [ing("鲜虾仁", "虾仁 30g", true), ing("嫩豆腐", "豆腐 60g", true), ing("青菜", "青菜 20g", false)],
    steps: [
      "虾仁去虾线，豆腐切块。",
      "清水或淡高汤煮开下豆腐与虾仁。",
      "煮熟后下青菜略煮。",
      "点极少量盐勾薄芡，放温喂食。"
    ],
    nutrition: { calories: "每份约 130 kcal", protein: "每份约 12g", iron: "每份约 1.5mg", calcium: "每份约 90mg", vitamin: "富含钙与锌" },
    source: SRC.aap, tags: ["补钙", "补锌"], allergens: ["虾蟹贝类（海鲜）", "大豆"]
  }),
  R({
    title: "南瓜蔬菜蒸蛋饼",
    min: 18, max: 24, type: "snack",
    ingredients: [ing("南瓜", "南瓜 40g", false), ing("鸡蛋", "1 个", true), ing("面粉", "面粉 30g", true)],
    steps: [
      "南瓜擦丝。",
      "与鸡蛋、面粉、少量水调成糊。",
      "少油小火摊成饼，两面金黄。",
      "切块放温作手指食物或加餐。"
    ],
    nutrition: { calories: "每份约 170 kcal", protein: "每份约 7g", iron: "每份约 1.1mg", calcium: "每份约 30mg", vitamin: "富含β-胡萝卜素" },
    source: SRC.cdc, tags: ["手指食物", "护眼"], allergens: ["鸡蛋", "小麦"]
  }),
  R({
    title: "胡萝卜玉米猪骨汤",
    min: 18, max: 24, type: "soup",
    ingredients: [ing("猪筒骨", "1 段", false), ing("胡萝卜", "胡萝卜 40g", false), ing("玉米", "玉米 1/3 根", false)],
    steps: [
      "猪骨焯水去血沫。",
      "与胡萝卜块、玉米段炖 1 小时。",
      "撇去表面浮油。",
      "点极少量盐，放温喂汤与软料。"
    ],
    nutrition: { calories: "每份约 110 kcal", protein: "每份约 6g", iron: "每份约 0.7mg", calcium: "每份约 25mg", vitamin: "含维生素A与膳食纤维" },
    source: SRC.cjchc, tags: ["暖身", "护眼"], allergens: []
  }),
  R({
    title: "三色蒸糕（无糖）",
    min: 18, max: 24, type: "snack",
    ingredients: [ing("面粉", "面粉 50g", true), ing("南瓜", "南瓜 30g", false), ing("紫薯", "紫薯 30g", false), ing("牛奶", "牛奶 40ml", true)],
    steps: [
      "南瓜、紫薯分别蒸熟压泥，与面粉、牛奶、酵母和成三色面团。",
      "分层铺入模具发酵至两倍大。",
      "上锅蒸 25 分钟。",
      "放温切小块，色彩分明吸引食欲。"
    ],
    nutrition: { calories: "每份约 190 kcal", protein: "每份约 6g", iron: "每份约 1mg", calcium: "每份约 50mg", vitamin: "含花青素与钙" },
    source: SRC.cjchc, tags: ["手指食物", "无糖"], allergens: ["小麦", "牛奶"]
  }),
  R({
    title: "青菜猪肉水饺",
    min: 18, max: 24, type: "staple",
    ingredients: [ing("饺子皮", "10 张", true), ing("猪肉馅", "猪肉 50g", false), ing("小白菜", "青菜 50g", false)],
    steps: [
      "青菜焯水挤干切碎，与肉馅拌匀少许调味。",
      "饺子皮包入馅料。",
      "水开下饺子煮至浮起。",
      "放温，一口一个作手指食物。"
    ],
    nutrition: { calories: "每份约 210 kcal", protein: "每份约 11g", iron: "每份约 1.3mg", calcium: "每份约 55mg", vitamin: "含维生素C与钙" },
    source: SRC.infant2022, tags: ["手指食物", "顶饱"], allergens: ["小麦"]
  }),
  R({
    title: "鸡蛋牛奶布丁（无糖）",
    min: 18, max: 24, type: "snack",
    ingredients: [ing("鸡蛋", "1 个", true), ing("牛奶", "牛奶 100ml", true)],
    steps: [
      "鸡蛋打散与温牛奶混合搅匀。",
      "过筛去泡倒入小碗。",
      "盖膜留孔中小火蒸 12 分钟至凝固。",
      "放温作加餐，补充蛋白与钙。"
    ],
    nutrition: { calories: "每份约 130 kcal", protein: "每份约 9g", iron: "每份约 1mg", calcium: "每份约 130mg", vitamin: "富含维生素D与钙" },
    source: SRC.guide2022, tags: ["补钙", "易消化"], allergens: ["鸡蛋", "牛奶"]
  })
);

/* =======================================================================
 * 24-36 月 幼儿期C —— 均衡饮食，培养自主进食
 * ===================================================================== */
recipes.push(
  R({
    title: "三鲜蔬菜焖饭",
    min: 24, max: 36, type: "staple",
    ingredients: [ing("大米", "大米 50g", false), ing("鸡肉", "鸡肉 30g", false), ing("香菇", "香菇 15g", false), ing("青菜", "青菜 20g", false)],
    steps: [
      "鸡肉、香菇切丁炒香。",
      "与大米加适量水焖熟。",
      "出锅前拌入焯好的青菜碎。",
      "点少量盐，让孩子自己用勺进食。"
    ],
    nutrition: { calories: "每份约 240 kcal", protein: "每份约 11g", iron: "每份约 1.2mg", calcium: "每份约 25mg", vitamin: "含B族与维生素C" },
    source: SRC.guide2022, tags: ["均衡", "自主进食"], allergens: []
  }),
  R({
    title: "番茄牛肉意面",
    min: 24, max: 36, type: "staple",
    ingredients: [ing("儿童意面", "意面 40g", true), ing("牛肉末", "牛肉 40g", false), ing("番茄", "番茄 60g", false)],
    steps: [
      "意面煮至软熟捞出。",
      "番茄去皮切丁炒出沙，下牛肉末炒熟。",
      "加少量水熬成酱汁。",
      "拌入意面，点少量盐，放温喂食。"
    ],
    nutrition: { calories: "每份约 260 kcal", protein: "每份约 14g", iron: "每份约 2.2mg", calcium: "每份约 30mg", vitamin: "富含铁与番茄红素" },
    source: SRC.infant2022, tags: ["高铁", "开胃"], allergens: ["小麦"]
  }),
  R({
    title: "清蒸鲈鱼",
    min: 24, max: 36, type: "meat",
    ingredients: [ing("鲈鱼", "鱼肉 50g", true), ing("姜丝", "少许", false), ing("葱花", "少许", false)],
    steps: [
      "鲈鱼处理干净，铺姜丝。",
      "大火蒸 8-10 分钟。",
      "倒掉腥水，撒葱花淋少许热油与生抽。",
      "仔细剔刺后放温，配软饭喂食。"
    ],
    nutrition: { calories: "每份约 110 kcal", protein: "每份约 15g", iron: "每份约 1mg", calcium: "每份约 80mg", vitamin: "富含DHA与优质蛋白" },
    source: SRC.aap, tags: ["补脑", "补钙"], allergens: ["鱼"]
  }),
  R({
    title: "彩椒鸡丁",
    min: 24, max: 36, type: "meat",
    ingredients: [ing("鸡胸肉", "鸡肉 50g", false), ing("彩椒", "彩椒 40g", false)],
    steps: [
      "鸡肉切丁略腌。",
      "彩椒切小丁。",
      "少油滑炒鸡丁至变色。",
      "下彩椒炒熟，点少量盐，放温配饭喂食。"
    ],
    nutrition: { calories: "每份约 140 kcal", protein: "每份约 13g", iron: "每份约 1mg", calcium: "每份约 15mg", vitamin: "富含维生素C" },
    source: SRC.infant2022, tags: ["补蛋白", "开胃"], allergens: []
  }),
  R({
    title: "豆腐蔬菜味噌汤（清淡）",
    min: 24, max: 36, type: "soup",
    ingredients: [ing("嫩豆腐", "豆腐 60g", true), ing("海带", "海带 10g", true), ing("味噌", "少许", true)],
    steps: [
      "海带泡发切小片，豆腐切丁。",
      "清水煮开下海带与豆腐。",
      "关火前化入极少量味噌调味（清淡）。",
      "放温喂食，补碘补钙。"
    ],
    nutrition: { calories: "每份约 90 kcal", protein: "每份约 8g", iron: "每份约 1.5mg", calcium: "每份约 95mg", vitamin: "富含碘与钙" },
    source: SRC.cjchc, tags: ["补碘", "补钙"], allergens: ["大豆", "虾蟹贝类（海鲜）"]
  }),
  R({
    title: "五彩蔬菜鸡蛋卷",
    min: 24, max: 36, type: "snack",
    ingredients: [ing("鸡蛋", "2 个", true), ing("胡萝卜", "胡萝卜 15g", false), ing("青椒", "青椒 15g", false), ing("玉米", "玉米 15g", false)],
    steps: [
      "蔬菜切碎焯水。",
      "鸡蛋打散加入蔬菜碎。",
      "平底锅少油摊成薄蛋皮，卷起。",
      "切段放温作手指食物，鼓励自主抓握。"
    ],
    nutrition: { calories: "每份约 170 kcal", protein: "每份约 13g", iron: "每份约 1.6mg", calcium: "每份约 55mg", vitamin: "富含维生素A与C" },
    source: SRC.cdc, tags: ["手指食物", "自主进食"], allergens: ["鸡蛋"]
  }),
  R({
    title: "山药排骨汤",
    min: 24, max: 36, type: "soup",
    ingredients: [ing("猪小排", "排骨 3 块", false), ing("山药", "山药 50g", false), ing("胡萝卜", "胡萝卜 30g", false)],
    steps: [
      "排骨焯水去血沫。",
      "与山药块、胡萝卜块炖 40-50 分钟。",
      "撇去浮油。",
      "点少量盐，放温喂汤与软料，健脾补钙。"
    ],
    nutrition: { calories: "每份约 150 kcal", protein: "每份约 9g", iron: "每份约 0.9mg", calcium: "每份约 35mg", vitamin: "含B族与膳食纤维" },
    source: SRC.cjchc, tags: ["补钙", "养胃"], allergens: []
  }),
  R({
    title: "牛奶燕麦杂粮粥",
    min: 24, max: 36, type: "staple",
    ingredients: [ing("燕麦", "燕麦 20g", true), ing("大米", "大米 20g", false), ing("牛奶", "牛奶 100ml", true)],
    steps: [
      "大米与燕麦加水煮至软烂。",
      "关火前倒入牛奶拌匀略煮。",
      "可加少量蒸软的水果丁。",
      "放温作早餐，补充膳食纤维与钙。"
    ],
    nutrition: { calories: "每份约 180 kcal", protein: "每份约 7g", iron: "每份约 1.3mg", calcium: "每份约 130mg", vitamin: "富含B族与钙" },
    source: SRC.guide2022, tags: ["防便秘", "补钙"], allergens: ["小麦", "牛奶"]
  }),
  R({
    title: "香煎豆腐蔬菜",
    min: 24, max: 36, type: "veggie",
    ingredients: [ing("老豆腐", "豆腐 60g", true), ing("西兰花", "西兰花 40g", false), ing("胡萝卜", "胡萝卜 20g", false)],
    steps: [
      "老豆腐切厚片少油煎至两面金黄。",
      "西兰花、胡萝卜焯水。",
      "一同翻炒，点少量生抽调味。",
      "放温配饭喂食，补充植物蛋白与钙。"
    ],
    nutrition: { calories: "每份约 150 kcal", protein: "每份约 10g", iron: "每份约 2mg", calcium: "每份约 120mg", vitamin: "富含钙与维生素C" },
    source: SRC.infant2022, tags: ["补钙", "补铁"], allergens: ["大豆"]
  }),
  R({
    title: "水果酸奶杯",
    min: 24, max: 36, type: "snack",
    ingredients: [ing("无糖酸奶", "酸奶 80g", true), ing("蓝莓", "蓝莓 20g", false), ing("香蕉", "香蕉 1/3 根", false)],
    steps: [
      "香蕉切小丁，蓝莓对半切。",
      "无糖酸奶倒入小杯。",
      "铺上水果丁。",
      "即做即食作加餐，补充益生菌与维生素。"
    ],
    nutrition: { calories: "每份约 110 kcal", protein: "每份约 5g", iron: "每份约 0.3mg", calcium: "每份约 130mg", vitamin: "富含维生素C与益生菌" },
    source: SRC.cjchc, tags: ["补钙", "助消化"], allergens: ["牛奶"]
  })
);

// 写出 JSON（数据源）
const outPath = path.join(__dirname, "recipes.json");
fs.writeFileSync(outPath, JSON.stringify(recipes, null, 2) + "\n", "utf8");
console.log("已生成食谱：", recipes.length, "条 ->", outPath);
