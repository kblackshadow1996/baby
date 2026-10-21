# 中文字体（PDF 导出用）

`exportReport` 云函数用 [pdfkit](https://pdfkit.org/) 生成 PDF。pdfkit **默认不含中文字体**，
若不放置中文字体，生成的 PDF 中文会显示为空白/乱码。

## 怎么放

把一份中文 TrueType 字体命名为 **`app.ttf`** 放在本目录：

```
cloudfunctions/exportReport/fonts/app.ttf
```

推荐字体（任选其一，注意授权）：

- 思源黑体 Source Han Sans CN - Regular（开源 SIL OFL，可商用）
- 思源黑体的**子集**（只保留常用汉字，体积更小，推荐用子集工具裁剪后命名为 `app.ttf`）

> 提示：完整思源黑体 ttf 约 10~16MB，体积较大。为控制云函数包体积，建议用
> `fonttools`/`pyftsubset` 等工具生成常用汉字子集后再放入。
>
> 本仓库**不内置**字体文件（体积与版权原因），需由你自行放置。

## 不放会怎样

- 云函数**仍可正常运行、不会崩溃**。
- `format='pdf'` 时检测到 `fonts/app.ttf` 不存在，会：
  - 用 pdfkit 默认字体生成 PDF（中文可能不可读）；
  - 在 PDF 首页标注英文提示；
  - 返回结果中 `data.fontMissing = true`，前端会 toast 提示改用网页版。
- 建议此时改用 **网页版导出**（`format='html'`）：HTML 自带内联样式、用系统中文字体渲染，
  中文无忧，可在电脑端浏览器打开。

## 检测逻辑

`index.js` 用 `fs.existsSync(path.join(__dirname, 'fonts', 'app.ttf'))` 判断字体是否存在。
