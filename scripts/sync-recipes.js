// scripts/sync-recipes.js
// 将数据源 data/recipes.json 同步（复制）到云函数打包副本
// cloudfunctions/initRecipes/recipes.json，确保两份内容完全一致。
// 运行：npm run sync:recipes
const fs = require("fs");
const path = require("path");

const src = path.join(__dirname, "..", "data", "recipes.json");
const dest = path.join(__dirname, "..", "cloudfunctions", "initRecipes", "recipes.json");

// 读取并校验 JSON 合法，再规范化后写出（两端使用相同序列化，保证深比较一致）
const raw = fs.readFileSync(src, "utf8");
const data = JSON.parse(raw);
const out = JSON.stringify(data, null, 2) + "\n";

fs.writeFileSync(dest, out, "utf8");
// 同时把数据源也规范化为相同格式，避免因格式差异导致测试深比较失败
fs.writeFileSync(src, out, "utf8");

console.log(`已同步 ${data.length} 条食谱: ${src} -> ${dest}`);
