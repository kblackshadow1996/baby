# 数据库安全规则（Security Rules）

本文件说明「小饭团成长记」云数据库各集合的安全模型，并给出在控制台配置的方法。
可直接粘贴的规则见 `docs/security-rules.json`。

## 为什么家庭共享集合要走云函数

微信云开发的自定义安全规则运行在**单文档/单集合上下文**中，规则表达式只能引用
当前文档字段（`doc.xxx`）和调用者身份（`auth.openid`），**无法做跨集合联表查询**。

而本项目的核心权限是「家庭共享」：一条 `meal_records` / `growth_records` 等记录，
是否允许某个用户读写，取决于该用户是否在 `family_members` 中属于这条记录的
`babyId`。这是一个**跨集合判定**，安全规则表达式做不到。

因此采用分层策略：

- **涉及家庭共享的集合**（`babies`、`meal_records`、`allergy_records`、
  `allergy_alerts`、`growth_records`、`food_timeline`、`family_members`、
  `invitations`）：客户端**不直接**读写，统一通过**云函数**操作。云函数以
  管理员身份（`wx-server-sdk`，不受安全规则限制）运行，在函数内部先查
  `family_members` 校验调用者 openid 是否属于该 `baby` 的家庭成员及其权限
  （`view` / `edit`），校验通过才执行读写。
- **纯个人集合**（`users`）与**公共只读集合**（`recipes` 官方部分）：可由客户端
  直接读写，安全规则即可表达其权限。

安全规则在这里是**纵深防御的最后一道闸**：即便客户端绕过业务逻辑直接访问集合，
保守的规则也能挡住越权读写；真正的细粒度家庭权限由云函数保证。

## 如何在控制台粘贴规则

1. 微信开发者工具 → 「云开发」 → 云开发控制台 → 「数据库」。
2. 选中集合 → 「**权限设置**」。
3. 选择「**自定义安全规则**」。
4. 把 `docs/security-rules.json` 中**该集合对应的值对象**（即 `{ ".read": ..., ".write": ... }`）粘贴进去，保存。
   - 注意：控制台每个集合单独粘贴它自己的规则对象，`security-rules.json` 的最外层键名只是用来标明「这段规则属于哪个集合」，粘贴时不要带最外层的集合名键。
5. 对 10 个集合逐一重复。

> 安全规则仅约束**客户端（小程序端）**的直接数据库访问；云函数以管理员权限运行，**不受安全规则限制**。

## 各集合规则含义

### users —— 仅本人可读写
```json
{ ".read": "doc._openid == auth.openid", ".write": "doc._openid == auth.openid" }
```
用户只能读写自己那条档案（`_openid` 由系统在客户端写入时自动带入）。

### recipes —— 官方可读、自建归创建者
```json
{
  ".read": "doc.isOfficial == true || auth.openid == doc.creatorOpenid",
  ".write": "auth.openid != null && auth.openid == doc.creatorOpenid && doc.isOfficial != true"
}
```
- 读：官方食谱（`isOfficial == true`）所有登录用户可读；自建食谱仅创建者可读。
- 写：仅登录用户可写自己创建的、且非官方的食谱（`isOfficial != true`，防止客户端伪造官方食谱）。官方食谱由管理员/云函数维护，客户端不可写。

### babies —— 仅创建者直连，家庭成员走云函数
```json
{ ".read": "doc.ownerId == auth.openid", ".write": "doc.ownerId == auth.openid" }
```
客户端直连时仅宝贝创建者（`ownerId`）可读写。其他家庭成员对宝贝信息的读写一律通过云函数（云函数校验 `family_members`）。

### meal_records / allergy_records / growth_records —— 仅记录者直连，其余走云函数
```json
{ ".read": "doc.recorderOpenid == auth.openid", ".write": "doc.recorderOpenid == auth.openid" }
```
客户端直连时仅记录者本人可读写自己创建的记录。家庭成员之间共享这些记录的读写，统一通过云函数（云函数校验家庭成员身份与 `view`/`edit` 权限）。这是保守闸门，正常业务路径应走云函数。

### family_members / invitations / allergy_alerts / food_timeline —— 仅云函数可访问
```json
{ ".read": false, ".write": false }
```
这些集合没有可用于「本人」判定的 `_openid` 字段（由云函数以管理员身份写入，归属用显式字段如 `babyId` 表达，需跨集合校验），因此客户端一律**禁止直接读写**（`false`）。所有访问都走云函数：
- `family_members`：成员关系的增删查，由云函数在校验权限后操作。
- `invitations`：邀请码的生成、校验、接受，均由云函数处理（避免客户端伪造/枚举邀请码）。
- `allergy_alerts`：过敏预警为系统聚合结果，由云函数依据 `allergy_records` 生成与更新。
- `food_timeline`：辅食首尝时间线由云函数在记录用餐/过敏时维护。

## 小结

| 集合 | 客户端直连权限 | 说明 |
| --- | --- | --- |
| users | 本人读写 | 个人档案 |
| recipes | 官方可读/自建归创建者 | 公共+自建混合 |
| babies | 创建者读写 | 家庭共享走云函数 |
| meal_records | 记录者读写 | 家庭共享走云函数 |
| allergy_records | 记录者读写 | 家庭共享走云函数 |
| growth_records | 记录者读写 | 家庭共享走云函数 |
| family_members | 禁止（false） | 仅云函数 |
| invitations | 禁止（false） | 仅云函数 |
| allergy_alerts | 禁止（false） | 仅云函数 |
| food_timeline | 禁止（false） | 仅云函数 |
