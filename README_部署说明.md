# BrewIon v2.9 GitHub部署说明

## 需要替换的文件

将部署包中的：

```text
coffee-qr-tool/index.html
```

上传并覆盖仓库中的同路径文件：

```text
zjcrop/BrewIon/coffee-qr-tool/index.html
```

建议提交说明：

```text
Update QR tool to v2.9 with future roast dates
```

## 部署后检查

打开网页后确认：

1. 右上角版本显示 `v2.9`；
2. 烘焙日期可以选择未来日期；
3. 日期最大值为 `2127-09-27`；
4. 更改烘焙年份后，生豆产季自动变为该年份及前三年；
5. 填完必填信息后出现HEX编码和二维码；
6. 上传图片后可以裁切并嵌入二维码；
7. 刷新页面后烘焙商和中心图片仍保留。

如网页仍显示旧版本，请使用强制刷新：

```text
Windows：Ctrl + F5
macOS：Command + Shift + R
```

## 远程编码表

页面继续使用：

```text
https://raw.githubusercontent.com/zjcrop/BrewIon/main/coffee-qr-codebook/coffee_qr_codebook_v6.json
```

无需修改编码表文件。
