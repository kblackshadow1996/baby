# 数据模型（Data Model）

本文件描述「小饭团成长记」（riceball-grow）云数据库 10 个集合的字段结构，是**后续各 Task 的数据契约**：云函数、页面逻辑、导出功能等都应以此为准读写字段。字段名、类型、含义一旦在此确定，后续 Task 不得随意更改；确需调整时应同步更新本文件及 `docs/indexes.md`、`docs/security-rules.*`。

## 通用约定

- `_id`：云数据库自动生成的文档主键（string），除非特殊说明均由系统维护。
- `_openid`：云数据库在小程序端 `add` 时自动写入的创建者 openid（string）。仅客户端直接写入的集合（如 `users`）会天然带有该字段；由云函数以管理员身份写入的文档不会自动带 `_openid`，相关归属字段以显式字段（如 `ownerId` / `recorderOpenid` / `creatorOpenid`）记录。
- 日期类型统一用云数据库 `Date`（云函数侧 `db.serverDate()` 或 JS `Date`）。
- `createdAt` / `updatedAt`：创建/更新时间（Date）。

---

## 1. users —— 用户

| 字段 | 类型 | 说明 | 必填 |
| --- | --- | --- | --- |
| `_id` | string | 文档主键，系统生成 | 是 |
| `_openid` | string | 用户 openid，客户端写入时自动带入；建唯一索引 | 是 |
| `nickName` | string | 微信昵称 | 否 |
| `avatarUrl` | string | 头像地址 | 否 |
| `createdAt` | Date | 创建时间 | 是 |
| `updatedAt` | Date | 更新时间 | 是 |

## 2. babies —— 宝贝

| 字段 | 类型 | 说明 | 必填 |
| --- | --- | --- | --- |
| `_id` | string | 文档主键 | 是 |
| `name` | string | 宝贝名字/昵称 | 是 |
| `gender` | int | 性别：0 未知 / 1 男 / 2 女 | 是 |
| `birthday` | Date | 出生日期，用于计算月龄 | 是 |
| `avatarUrl` | string | 宝贝头像 | 否 |
| `ownerId` | string | 创建者 openid（家庭主账号）；建普通索引 | 是 |
| `createdAt` | Date | 创建时间 | 是 |
| `updatedAt` | Date | 更新时间 | 是 |

## 3. family_members —— 家庭成员

| 字段 | 类型 | 说明 | 必填 |
| --- | --- | --- | --- |
| `_id` | string | 文档主键 | 是 |
| `babyId` | string | 所属宝贝 `_id` | 是 |
| `userOpenid` | string | 成员用户 openid | 是 |
| `role` | string | 角色：`mom` / `dad` / `grandpa_pat`(爷爷) / `grandma_pat`(奶奶) / `grandpa_mat`(外公) / `grandma_mat`(外婆) / `other` | 是 |
| `permissions` | string | 权限：`view`（仅查看）/ `edit`（可编辑） | 是 |
| `joinedAt` | Date | 加入时间 | 是 |

> 建议 `babyId` + `userOpenid` 联合索引，保证一个用户在一个宝贝下仅一条成员记录。

## 4. invitations —— 邀请

| 字段 | 类型 | 说明 | 必填 |
| --- | --- | --- | --- |
| `_id` | string | 文档主键 | 是 |
| `babyId` | string | 被邀请加入的宝贝 `_id` | 是 |
| `inviterOpenid` | string | 邀请人 openid | 是 |
| `code` | string | 6 位邀请码；建唯一索引 | 是 |
| `type` | string | 邀请方式：`code`（邀请码）/ `share`（分享卡片） | 是 |
| `status` | string | 状态：`pending`（待使用）/ `used`（已使用）/ `expired`（已过期） | 是 |
| `expireAt` | Date | 过期时间 | 是 |
| `usedBy` | string | 使用者 openid（被接受后写入） | 否 |
| `createdAt` | Date | 创建时间 | 是 |

## 5. recipes —— 食谱

| 字段 | 类型 | 说明 | 必填 |
| --- | --- | --- | --- |
| `_id` | string | 文档主键 | 是 |
| `title` | string | 食谱标题 | 是 |
| `monthAgeMin` | int | 适用最小月龄 | 是 |
| `monthAgeMax` | int | 适用最大月龄 | 是 |
| `type` | string | 分类：`staple`(主食) / `meat`(荤菜) / `veggie`(素菜) / `soup`(汤) / `snack`(点心) | 是 |
| `ingredients` | array\<object\> | 食材数组，元素 `{ name:string, amount:string, isAllergen:bool }` | 是 |
| `steps` | array\<string\> | 制作步骤（有序字符串数组） | 是 |
| `nutrition` | object | 营养信息 `{ calories, protein, iron, calcium, vitamin, ... }`，各项为 number/string | 否 |
| `source` | object | 来源 `{ name:string, chapter:string, page:number }` | 否 |
| `imageUrl` | string | 成品图地址 | 否 |
| `tags` | array\<string\> | 标签 | 否 |
| `allergens` | array\<string\> | 含有的过敏原名称列表 | 否 |
| `isOfficial` | bool | 是否官方食谱（true=官方，所有登录用户可读、不可写） | 是 |
| `creatorOpenid` | string | 创建者 openid（自建食谱）；建普通索引 | 否 |
| `babyId` | string | 自建食谱归属宝贝（可空；官方食谱为空） | 否 |
| `createdAt` | Date | 创建时间 | 是 |

> 建议 `monthAgeMin` + `monthAgeMax` + `type` 联合索引用于按月龄+分类检索。

## 6. meal_records —— 用餐记录

| 字段 | 类型 | 说明 | 必填 |
| --- | --- | --- | --- |
| `_id` | string | 文档主键 | 是 |
| `babyId` | string | 所属宝贝 `_id` | 是 |
| `date` | Date | 记录日期（当天） | 是 |
| `mealType` | string | 餐别：`breakfast`(早) / `lunch`(午) / `dinner`(晚) / `snack_am`(上午加餐) / `snack_pm`(下午加餐) / `night`(夜宵) / `custom`(自定义) | 是 |
| `customMealName` | string | 自定义餐别名称（`mealType=custom` 时使用） | 否 |
| `mealTime` | string | 用餐时间，格式 `HH:mm` | 否 |
| `foods` | array\<object\> | 食物数组，元素见下表 | 是 |
| `note` | string | 备注 | 否 |
| `hasAllergyFlag` | bool | 是否标记疑似过敏（供快速筛选） | 否 |
| `recorderOpenid` | string | 记录者 openid；建普通索引 | 是 |
| `createdAt` | Date | 创建时间 | 是 |

`foods` 数组元素结构：

| 字段 | 类型 | 说明 | 必填 |
| --- | --- | --- | --- |
| `name` | string | 食物名称 | 是 |
| `amountMode` | string | 份量模式：`preset`(档位) / `custom`(精确值) | 是 |
| `amountLevel` | string | 档位（`amountMode=preset`）：`little`(一点) / `half`(一半) / `most`(大部分) / `all`(全部) | 否 |
| `amountValue` | number | 精确数值（`amountMode=custom`） | 否 |
| `amountUnit` | string | 单位（`amountMode=custom`）：`ml` / `g` / `勺` / `个` | 否 |
| `recipeId` | string | 关联食谱 `_id`（若来自食谱） | 否 |

## 7. allergy_records —— 过敏记录

| 字段 | 类型 | 说明 | 必填 |
| --- | --- | --- | --- |
| `_id` | string | 文档主键 | 是 |
| `babyId` | string | 所属宝贝 `_id` | 是 |
| `mealRecordId` | string | 关联的用餐记录 `_id`（可空） | 否 |
| `date` | Date | 发生日期 | 是 |
| `symptoms` | array\<string\> | 症状列表（如 红疹/呕吐/腹泻） | 是 |
| `suspectedFoods` | array\<string\> | 疑似过敏食物名称列表 | 是 |
| `severity` | string | 严重程度（预留）：`mild` / `moderate` / `severe` | 否 |
| `note` | string | 备注 | 否 |
| `photos` | array\<string\> | 症状照片 fileID 列表（预留） | 否 |
| `recorderOpenid` | string | 记录者 openid | 是 |
| `createdAt` | Date | 创建时间 | 是 |

## 8. allergy_alerts —— 过敏预警（聚合）

| 字段 | 类型 | 说明 | 必填 |
| --- | --- | --- | --- |
| `_id` | string | 文档主键 | 是 |
| `babyId` | string | 所属宝贝 `_id` | 是 |
| `foodName` | string | 过敏食物名称 | 是 |
| `status` | string | 状态：`suspected`(疑似) / `confirmed`(确认) / `cleared`(已排除) | 是 |
| `firstOccurrence` | Date | 首次出现时间 | 是 |
| `lastOccurrence` | Date | 最近出现时间 | 是 |
| `recordIds` | array\<string\> | 关联的 `allergy_records._id` 列表 | 是 |
| `symptomsSummary` | array\<string\> | 症状汇总 | 否 |
| `createdAt` | Date | 创建时间 | 是 |
| `updatedAt` | Date | 更新时间 | 是 |

> 建议 `babyId` + `foodName` 唯一联合索引，避免对同一宝贝同一食物生成重复预警。

## 9. growth_records —— 成长记录

| 字段 | 类型 | 说明 | 必填 |
| --- | --- | --- | --- |
| `_id` | string | 文档主键 | 是 |
| `babyId` | string | 所属宝贝 `_id` | 是 |
| `date` | Date | 测量日期 | 是 |
| `height` | number | 身高（cm） | 否 |
| `weight` | number | 体重（kg） | 否 |
| `headCircumference` | number | 头围（cm） | 否 |
| `recorderOpenid` | string | 记录者 openid | 是 |
| `createdAt` | Date | 创建时间 | 是 |

> 建议 `babyId` + `date` 联合索引（date 升序）用于绘制成长曲线。

## 10. food_timeline —— 辅食时间线

| 字段 | 类型 | 说明 | 必填 |
| --- | --- | --- | --- |
| `_id` | string | 文档主键 | 是 |
| `babyId` | string | 所属宝贝 `_id` | 是 |
| `foodName` | string | 食材名称 | 是 |
| `category` | string | 分类：`grain`(谷物) / `veggie`(蔬菜) / `fruit`(水果) / `meat`(肉类) / `egg_dairy`(蛋奶) / `seafood`(海鲜) / `other`(其他) | 是 |
| `firstTriedDate` | Date | 首次尝试日期 | 是 |
| `reaction` | string | 反应：`normal`(正常) / `allergy`(过敏) | 是 |
| `mealRecordId` | string | 关联用餐记录 `_id`（可空） | 否 |
| `createdAt` | Date | 创建时间 | 是 |

> 建议 `babyId` + `foodName` 唯一联合索引，保证同一宝贝同一食材只记录一次首尝。
