# 小饭团成长记
一款面向 0-3 岁宝宝的辅食记录微信小程序。帮助家长记录宝宝每天吃了什么辅食、追踪过敏反应、查看月龄对应的喂养阶段建议，并和家人一起协作管理宝贝的成长档案。
## 功能概览
- 首页：当前宝贝信息与月龄喂养阶段提示
- 食谱库：浏览、查看、创建适龄辅食食谱
- 每日记录：按天记录辅食摄入
- 过敏观察：记录并追踪过敏食材与反应
- 成长曲线：身高体重等成长数据
- 辅食时间线：新食材引入时间轴
- 宝贝管理 / 档案：多宝贝切换与资料维护
- 家庭成员 / 邀请：家人协作共管
- 数据导出：导出记录
- 我的：个人中心
## 技术栈
- 微信小程序原生框架（WXML / WXSS / JS）
- 微信云开发（云数据库 + 云函数）
- 单元测试：Jest（针对 `utils/date.js` 等纯函数）
## 目录结构
```
.
├── app.js / app.json / app.wxss      # 小程序入口与全局样式（清新可爱风设计系统）
├── project.config.json               # 项目配置（projectname: riceball-grow）
├── components/                        # 公共组件 nav-bar / baby-card / empty-state
├── pages/                            # 16 个页面
├── utils/                            # cloud.js（云开发封装）、date.js（日期/月龄纯函数）
├── data/                             # 预置数据源（recipes.json 官方食谱）
├── scripts/                          # 维护脚本（sync-recipes.js 同步食谱到云函数）
├── cloudfunctions/                   # 云函数（initDatabase / initRecipes / login / baby ...）
├── tests/                            # Jest 单元测试
├── package.json
└── .gitignore
```
## 环境准备
### 1. 填入小程序 AppID
打开 [微信公众平台](https://mp.weixin.qq.com/) 注册/登录小程序账号，在「开发 → 开发管理 → 开发设置」中找到 **AppID**。
将 `project.config.json` 中的占位 AppID 替换为你的真实 AppID：
```json
{
  "appid": "你的真实AppID"   // 当前为占位值 "touristappid"
}
```
> 若仅做本地预览，可暂时保留 `touristappid`（游客模式，无法使用云开发）。
### 2. 开通云开发并填入环境 ID
1. 用微信开发者工具打开本项目后，点击工具栏「云开发」按钮，按引导开通云开发环境。
2. 开通后在云开发控制台左上角可看到 **环境 ID（env id）**。
3. 将 `app.js` 中的占位环境 ID 替换为你的真实环境 ID：
```js
wx.cloud.init({
  env: "你的云环境ID",   // 当前为占位值 "REPLACE_WITH_YOUR_ENV_ID"
  traceUser: true
});
```
4. 云函数根目录为 `cloudfunctions/`（见 `project.config.json` 的 `cloudfunctionRoot`），后续任务会在此添加云函数。
## 云开发初始化
小程序云开发的集合**无法用脚本凭空建表**，也**没有稳定的建索引 API**。因此初始化分步进行：集合由云函数自动创建，官方食谱由云函数导入，索引与安全规则在控制台手动配置（本仓库已提供可直接使用的文档与 JSON）。
### 第 1 步：部署 `initDatabase` 云函数创建集合
1. 确认 `app.js` 的 `wx.cloud.init` 环境 ID 已替换为你的真实 env（见上文「环境准备」）。
2. 在微信开发者工具的「资源管理器」中找到 `cloudfunctions/initDatabase/` → 右键 → 「上传并部署：云端安装依赖（不上传 node_modules）」。
3. 部署成功后调用它，触发 10 个集合的自动创建，二选一：
   - **云开发控制台调用**：控制台 → 云函数 → `initDatabase` → 「云端测试」 → 不填入参 → 运行。
   - **小程序端调用**：在任意页面执行 `wx.cloud.callFunction({ name: 'initDatabase' })`，或用本项目封装 `const { callFunction } = require('../../utils/cloud'); await callFunction('initDatabase')`。
4. 返回 `{ success: true, results: [{ collection, status }] }`，`status` 为 `created`（新建）或 `exists`（已存在）。重复调用是安全的（幂等）。
> 原理：云函数对不存在的集合执行 `add()` 会自动创建集合，`initDatabase` 据此写入并立即删除一条占位文档，使集合存在且为空。
### 第 2 步：部署 `initRecipes` 云函数导入官方食谱
本仓库在 `data/recipes.json` 预置了 **74 条官方辅食食谱**（覆盖 6-36 月龄 7 个辅食段 + 0-6 月纯奶期喂养知识卡），字段结构见 [`docs/data-model.md`](docs/data-model.md) 的 `recipes` 集合，数据来源与声明见 [`data/recipes.README.md`](data/recipes.README.md)。
1. 在「资源管理器」中找到 `cloudfunctions/initRecipes/` → 右键 → 「上传并部署：云端安装依赖（不上传 node_modules）」。
   - 云函数读取随包打包的 `cloudfunctions/initRecipes/recipes.json`（它是 `data/recipes.json` 的副本，云函数运行时访问不到项目根 `data/` 目录）。
2. 调用它导入食谱，二选一：
   - **云开发控制台调用**：控制台 → 云函数 → `initRecipes` → 「云端测试」 → 入参填 `{ "mode": "reset" }` → 运行。
   - **小程序端调用**：`wx.cloud.callFunction({ name: 'initRecipes', data: { mode: 'reset' } })`。
3. 入参 `mode`：
   - `"reset"`：**首次全量导入**用。先删除所有 `isOfficial==true` 的旧官方食谱，再全量写入（避免重复）。
   - `"upsert"`（默认，不填 `mode` 时）：增量补充用。按 `title + monthAgeMin` 判重，不存在才插入；已存在则跳过。
4. 返回 `{ success, mode, inserted, skipped, deleted, total, failures }`。`failures` 为空表示全部成功；非空时按 `title` 定位失败条目重试。
> **首次导入请用 `mode: "reset"` 做一次全量导入**；之后若只是追加新增食谱，用默认 `upsert` 即可。

#### 新增/修改食谱后如何同步并重新部署
1. `data/recipes.json` 是**唯一数据源**。编辑 `data/_gen_recipes.js` 后运行 `npm run gen:recipes` 重新生成，或直接编辑 `data/recipes.json`（须保持 JSON 合法、字段完整）。
2. 同步到云函数打包副本（两份内容必须完全一致，测试会校验）：
   ```bash
   npm run sync:recipes
   ```
3. 在微信开发者工具中**重新上传部署** `cloudfunctions/initRecipes`。
4. 调用 `initRecipes`：全量刷新用 `mode: "reset"`，仅追加新食谱用默认 `upsert`。
### 第 3 步：配置索引
按 [`docs/indexes.md`](docs/indexes.md) 在云开发控制台「数据库 → 集合 → 索引管理」逐个创建推荐索引（含唯一索引，如 `users._openid`、`invitations.code`、`allergy_alerts`/`food_timeline` 的 `babyId+foodName`）。
### 第 4 步：配置安全规则
按 [`docs/security-rules.json`](docs/security-rules.json) 在云开发控制台「数据库 → 集合 → 权限设置 → 自定义安全规则」为每个集合粘贴对应规则，规则含义与安全模型见 [`docs/security-rules.md`](docs/security-rules.md)。涉及家庭共享的集合统一走云函数把关，客户端不直接读写。
> 字段结构与数据契约见 [`docs/data-model.md`](docs/data-model.md)。
### 第 5 步：部署 `exportReport` 云函数（数据导出 / 健康报告）
「数据导出」页可把宝贝的成长 / 辅食 / 过敏数据汇总成**健康报告**，方便就医时给医生看。报告支持两种格式：
- **PDF**：可在手机内直接打开，并通过右上角菜单转发给医生/家人。
- **网页版（HTML）**：中文无忧，适合在电脑端浏览器打开查看。

部署步骤：
1. 在「资源管理器」中找到 `cloudfunctions/exportReport/` → 右键 → **「上传并部署：云端安装依赖（不上传 node_modules）」**。该函数依赖 `pdfkit`，**必须选云端安装依赖**，否则 PDF 生成会失败。
2. **中文 PDF 需放置字体**：`pdfkit` 默认不含中文字体。请把一份中文 ttf（推荐思源黑体 Regular 或其子集）命名为 `app.ttf` 放在 `cloudfunctions/exportReport/fonts/` 目录后再部署，详见 [`cloudfunctions/exportReport/fonts/README.md`](cloudfunctions/exportReport/fonts/README.md)。
   - 未放置字体时云函数仍可正常运行：PDF 用默认字体生成（中文可能不可读），返回 `fontMissing: true`，前端会提示改用网页版。
   - 不想处理字体时，直接在导出页选择**网页版**即可，中文正常显示。
3. 生成的报告文件写入云存储 `exports/` 目录；小程序端通过 `wx.cloud.downloadFile` 下载后用 `wx.openDocument` 打开/转发。
> 导出页始终会先在小程序内渲染一份结构化「报告预览」（即便不下载文件也能看到汇总），PDF/网页版是「带走」的形式。

## 用微信开发者工具导入
1. 下载并安装 [微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)。
2. 打开开发者工具 → 「导入项目」。
3. 项目目录选择本仓库根目录（即本 README 所在目录）。
4. AppID 填入你的真实 AppID（或选择「测试号」）。
5. 导入后即可在模拟器中预览。
## 运行单元测试
本项目使用 Jest 对 `utils/date.js` 等纯函数与 `data/recipes.json` 数据结构做单元测试（不依赖小程序运行时 API）。
```bash
npm install
npm test
```
## 需要替换的占位符
| 文件 | 字段 | 当前占位值 | 替换为 |
| --- | --- | --- | --- |
| `app.js` | `wx.cloud.init` 的 `env` | `REPLACE_WITH_YOUR_ENV_ID` | 你的云开发环境 ID |
| `project.config.json` | `appid` | `touristappid` | 你的小程序 AppID |
