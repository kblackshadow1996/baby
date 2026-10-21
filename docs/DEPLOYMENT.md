# 部署上线清单（Deployment Checklist）

本文件是「小饭团成长记」（riceball-grow）微信小程序云开发项目的**完整部署上线清单**，
面向的场景是：**你在另一台 Mac 上，用微信开发者工具下载本仓库后，从零把它调试起来并提交审核发布。**

按顺序照做即可，每一步用 `- [ ]` 清单勾选。涉及占位符替换、索引与安全规则等关键环节都标注了确切位置与引用文档，请勿跳过。

> 事实基准（截至本文件编写时，均经仓库核对）：
> - 云函数共 **11 个**：`initDatabase` / `initRecipes` / `login` / `baby` / `family` / `recipe` / `meal` / `allergy` / `growth` / `timeline` / `exportReport`。
> - 云数据库集合共 **10 个**（见 [`docs/data-model.md`](data-model.md)）。
> - 预置官方食谱共 **74 条**（见 [`data/recipes.README.md`](../data/recipes.README.md)）。
> - 单元测试共 **107 个**（`npm test` / `npx jest`）。
> - `project.config.json` 的 `appid` 当前为占位值 `"touristappid"`。
> - `app.js` 的 `wx.cloud.init` 环境 ID 当前为占位值 `"REPLACE_WITH_YOUR_ENV_ID"`。

---

## 0. 环境准备（Mac）

- [ ] **安装微信开发者工具（稳定版 Stable 即可）**
  官方下载页：<https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html>
  选择 macOS 版本安装，首次打开用微信扫码登录。
- [ ] **安装 Node.js（可选，仅本地跑 jest 用）**
  官方下载页：<https://nodejs.org/>（建议 LTS 版本）。
  小程序本身的运行**不依赖**根目录 `node_modules`，这一步只为本地执行单元测试。
- [ ] **用个人 GitHub 账号克隆仓库（这台新 Mac 需要先配置能访问个人私有仓库的凭证）**

  仓库地址：`https://github.com/kblackshadow1996/baby.git`（私有仓库）。

  方式 (a) —— **HTTPS + 个人访问令牌（PAT）**：
  在 GitHub「Settings → Developer settings → Personal access tokens」生成一个对该私有仓库有读写权限的 PAT，然后：
  ```bash
  git clone https://github.com/kblackshadow1996/baby.git
  # 首次 push/pull 会提示输入用户名与密码，密码处粘贴 PAT（不是账号密码）
  ```

  方式 (b) —— **SSH（推荐，与公司账号隔离）**：
  在新 Mac 上**单独**为个人 GitHub 生成一把 key，并添加到个人 GitHub 账号，**不要和公司账号共用同一把 key**。
  本项目的 `origin` 已使用 Host 别名隔离（`git@github-personal:kblackshadow1996/baby.git`），
  推荐在新 Mac 的 `~/.ssh/config` 里同样配置一个 `github-personal` 别名指向个人 key：
  ```sshconfig
  # ~/.ssh/config
  Host github-personal
      HostName github.com
      User git
      IdentityFile ~/.ssh/id_ed25519_personal
      IdentitiesOnly yes
  ```
  生成并添加个人 key：
  ```bash
  ssh-keygen -t ed25519 -C "personal" -f ~/.ssh/id_ed25519_personal
  # 把 ~/.ssh/id_ed25519_personal.pub 的内容添加到个人 GitHub：Settings → SSH and GPG keys
  ssh -T git@github-personal          # 验证连通
  git clone git@github-personal:kblackshadow1996/baby.git
  ```
  > 隔离提示：个人仓库与公司仓库务必用不同的 key 与 Host 别名，避免身份混用；也不要用这台机器的全局 `user.email` 污染个人提交作者。

- [ ] **克隆后安装本地测试依赖（仅本地测试用）**
  ```bash
  cd baby
  npm install
  ```

---

## 1. 注册与基础配置

- [ ] 在 [微信公众平台](https://mp.weixin.qq.com) 注册小程序，拿到 **AppID**（个人主体也可注册）。
- [ ] 把 AppID 填入 **`project.config.json`** 的 `"appid"` 字段（当前为占位值 `"touristappid"`）：
  ```json
  {
    "appid": "你的真实AppID"
  }
  ```
- [ ] 打开微信开发者工具 → 「导入项目」→ 选择**仓库根目录** → 填入你的 AppID → 完成导入。

---

## 2. 开通云开发 + 填入环境 ID

- [ ] 在开发者工具工具栏点「**云开发**」按钮，按引导**开通云开发环境**（注意免费额度，个人体验足够），记下**环境 ID（env id）**。
- [ ] 把环境 ID 填入 **`app.js`** 的 `wx.cloud.init`（当前为占位值 `"REPLACE_WITH_YOUR_ENV_ID"`，位于文件第 6–7 行）：
  ```js
  wx.cloud.init({
    env: "你的云环境ID",   // 原占位值 "REPLACE_WITH_YOUR_ENV_ID"
    traceUser: true
  });
  ```
- [ ] 云函数根目录为 `cloudfunctions/`（见 `project.config.json` 的 `cloudfunctionRoot`）。

---

## 3. 部署全部云函数（逐个列出）

`cloudfunctions/` 下共 **11 个**云函数，全部需要「**上传并部署：云端安装依赖（不上传 node_modules）**」。

| 云函数 | 作用 | 部署方式 |
| --- | --- | --- |
| `initDatabase` | 初始化创建 10 个数据库集合（幂等） | 上传并部署：云端安装依赖 |
| `initRecipes` | 导入 74 条官方预置食谱到 `recipes` 集合 | 上传并部署：云端安装依赖 |
| `login` | 登录 / 获取 openid、用户档案 | 上传并部署：云端安装依赖 |
| `baby` | 宝贝档案增删改查 | 上传并部署：云端安装依赖 |
| `family` | 家庭成员与协作管理 | 上传并部署：云端安装依赖 |
| `recipe` | 食谱浏览 / 自建食谱 | 上传并部署：云端安装依赖 |
| `meal` | 每日用餐记录 | 上传并部署：云端安装依赖 |
| `allergy` | 过敏记录与自动预警（`allergy_alerts`） | 上传并部署：云端安装依赖 |
| `growth` | 成长记录（身高 / 体重 / 头围） | 上传并部署：云端安装依赖 |
| `timeline` | 辅食首尝时间线（`food_timeline`） | 上传并部署：云端安装依赖 |
| `exportReport` | 导出数据 / 生成健康报告 PDF（依赖 `pdfkit`） | **上传并部署：云端安装依赖（必须）** |

- [ ] 对**每个**云函数：在开发者工具「资源管理器」中右键该云函数目录 → 「**上传并部署：云端安装依赖（不上传 node_modules）**」。
- [ ] **特别标注 `exportReport`**：它依赖 `pdfkit`（见 `cloudfunctions/exportReport/package.json`），**必须**选「云端安装依赖」，否则 PDF 生成会失败。
      中文 PDF 还需把一份中文 TrueType 字体命名为 `app.ttf` 放到 `cloudfunctions/exportReport/fonts/app.ttf` 后再部署（详见 [`cloudfunctions/exportReport/fonts/README.md`](../cloudfunctions/exportReport/fonts/README.md)）；未放字体时中文会显示为空白，此时可改用网页版导出。
- [ ] 其余 10 个云函数依赖 `wx-server-sdk`，同样走「云端安装依赖」即可。

---

## 4. 初始化数据库（集合 / 数据）

- [ ] 调用 **`initDatabase`** 创建 **10 个集合**（幂等，可重复调用）。调用方式二选一：
  - 云开发控制台 → 云函数 → `initDatabase` → 「云端测试」→ 不填入参 → 运行；或
  - 由小程序端调用一次。
  集合清单与字段契约见 [`docs/data-model.md`](data-model.md)：`users` / `babies` / `family_members` / `invitations` / `recipes` / `meal_records` / `allergy_records` / `allergy_alerts` / `growth_records` / `food_timeline`。
- [ ] 调用 **`initRecipes`**，入参传 `{ "mode": "reset" }`，全量导入 **74 条**官方食谱到 `recipes` 集合（覆盖范围与来源见 [`data/recipes.README.md`](../data/recipes.README.md)）。

---

## 5. 配置索引与安全规则（控制台手动）

云开发的数据库索引与安全规则**无法通过小程序端 / 云函数 API 稳定创建**，需在**云开发控制台**手动配置。本仓库已提供可直接使用的文档与 JSON。

- [ ] 按 [`docs/indexes.md`](indexes.md) 在云开发控制台「数据库 → 索引管理」逐个创建索引。
      尤其注意这些**唯一索引**：
  - `users._openid`（`idx_openid_unique`，唯一）
  - `invitations.code`（`idx_code_unique`，唯一）
  - `allergy_alerts` 的 `babyId + foodName`（`idx_baby_food_unique`，唯一）
  - `food_timeline` 的 `babyId + foodName`（`idx_baby_food_unique`，唯一）
  > 唯一索引要求对应字段组合在集合内不重复；若已有冲突数据需先清理。
- [ ] 按 [`docs/security-rules.json`](security-rules.json) 为**每个集合**粘贴安全规则（控制台 → 数据库 → 选集合 → 权限设置 → 自定义安全规则）。
      规则含义见 [`docs/security-rules.md`](security-rules.md)：采用**分层模型**——家庭共享集合（`babies` / `meal_records` / `allergy_records` / `growth_records` 等）客户端只保守直连、共享读写统一走云函数；`family_members` / `invitations` / `allergy_alerts` / `food_timeline` 客户端一律禁止直连（`false`），全部走云函数；`users` 仅本人可读写，`recipes` 官方部分公共只读。

---

## 6. 本地验证与真机调试

- [ ] 本地运行 **`npm test`**（即 `jest`），确认 **107 个单元测试全部通过**（纯函数 / 数据校验：`utils/date.js`、`utils/who-growth.js`、食谱与过敏原数据等）。
- [ ] 在开发者工具模拟器走**核心流程**一遍：
      登录 → 创建宝贝 → 浏览食谱 → 添加用餐记录 → 标记过敏（观察是否自动生成过敏提醒）→ 查看成长曲线 → 查看辅食时间线 → 导出报告 → 家庭邀请。
- [ ] **真机预览（扫码）**，重点验证：
  - 自定义导航栏在刘海屏 / 全面屏上的安全区适配；
  - canvas 绘制的成长曲线显示正常；
  - 分享卡片生成与分享；
  - `wx.openDocument` 能正常打开导出的 PDF。

---

## 7. 上线前必须替换 / 核对的占位与声明（诚实提示，重要）

> 以下项目直接影响线上正确性与合规，发布前**务必逐项确认**。

- [ ] **`project.config.json` 的 `appid`** 与 **`app.js` 的云环境 ID** 已替换为真实值（不再是 `touristappid` / `REPLACE_WITH_YOUR_ENV_ID`）。
- [ ] **食谱 `source.page` 为参考占位**：发布前按纸质 / 官方版本核对页码与出处（见 [`data/recipes.README.md`](../data/recipes.README.md)）。
- [ ] **`utils/who-growth.js` 为近似 WHO 数据**：发布前用 **WHO 官方 LMS 数据表**替换校准（见 [`data/who-growth.README.md`](../data/who-growth.README.md)）。
- [ ] **`exportReport` 的中文字体**：已放置 `cloudfunctions/exportReport/fonts/app.ttf`（见 [`cloudfunctions/exportReport/fonts/README.md`](../cloudfunctions/exportReport/fonts/README.md)），否则中文 PDF 为空白。
- [ ] **小程序类目与《用户隐私保护指引》**：本小程序涉及收集用户信息（头像、昵称）与宝宝健康数据，需在公众平台配置隐私协议 / 用户隐私保护指引；母婴 / 健康相关类目可能需要相应**资质**，请核对并选择正确的类目要求。
- [ ] **文案合规**：食谱为参考、**非医疗建议**，App 内已有「请以医生评估为准」等声明；发布描述与页面文案**不得宣称医疗功效**。

---

## 8. 提交审核与发布

- [ ] 在开发者工具点「**上传**」提交代码（填写版本号与备注）。
- [ ] 登录公众平台 → 「版本管理」→ 将上传的版本**提交审核** → 审核通过后**发布**。
- [ ] 配置**体验版**并添加家人为体验成员，用于测试家庭共享协作。

---

## 9. 常见问题速查（FAQ）

- **云函数调用失败**：检查 `app.js` 的 `env` 是否填对、对应云函数是否已部署、部署时是否选了「云端安装依赖」。
- **中文 PDF 空白**：未放置 `cloudfunctions/exportReport/fonts/app.ttf`，补放中文字体后重新部署，或改用网页版导出。
- **数据读不出 / 权限错误**：安全规则未按 [`docs/security-rules.json`](security-rules.json) 配置，或家庭成员访问共享数据时未走云函数路径（客户端直连被保守规则挡住属正常）。
- **canvas 成长曲线不显示**：检查基础库版本，并注意真机与模拟器的渲染差异（必要时在真机上复测）。

---

> 相关文档：数据模型 [`docs/data-model.md`](data-model.md)、索引 [`docs/indexes.md`](indexes.md)、安全规则 [`docs/security-rules.md`](security-rules.md) / [`docs/security-rules.json`](security-rules.json)、食谱数据 [`data/recipes.README.md`](../data/recipes.README.md)、WHO 生长数据 [`data/who-growth.README.md`](../data/who-growth.README.md)、PDF 字体 [`cloudfunctions/exportReport/fonts/README.md`](../cloudfunctions/exportReport/fonts/README.md)。
