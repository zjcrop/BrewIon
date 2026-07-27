# 部署说明

目标仓库：

```text
zjcrop/BrewIon
```

本恢复包按仓库根目录组织。解压后，把包内文件上传到仓库根目录，并保持目录结构。

## 包含文件

```text
README.md
CONTRIBUTING.md
MAINTENANCE_NOTICE.md
CHANGELOG.md
DEPLOY.md
LICENSE
coffee-qr-tool/index.html
coffee-qr-tool/README.md
coffee-qr-codebook/README.md
docs/TECHNICAL_SPEC.md
docs/MAINTAINER_GUIDE.md
docs/DEVELOPMENT_DIALOGUE_TEMPLATE.md
SHA256校验.json
```

本包不包含、也不会替换：

```text
coffee-qr-codebook/coffee_qr_codebook_v6.json
```

这样可以避免误覆盖正式编码表。

## GitHub网页部署

1. 解压本压缩包；
2. 打开仓库 `zjcrop/BrewIon`；
3. 选择 **Add file → Upload files**；
4. 将解压后的全部文件和目录拖入上传区域；
5. 确认路径不是多套了一层压缩包目录；
6. 提交到 `main`。

建议提交说明：

```text
Restore v3.0 README and maintenance documentation
```

## GitHub Pages

进入：

```text
Settings → Pages
```

设置：

```text
Source: Deploy from a branch
Branch: main
Folder: /(root)
```

在线地址：

```text
https://zjcrop.github.io/BrewIon/coffee-qr-tool/
```

如果仍显示旧版：

1. 把Branch临时设为None并保存；
2. 再恢复为`main / (root)`并保存；
3. 重新访问页面；
4. 检查右上角是否显示v3.0。

## 部署验收

### 文件

- 根目录出现 `README.md`；
- `coffee-qr-tool/README.md`存在；
- `coffee-qr-codebook/README.md`存在；
- `MAINTENANCE_NOTICE.md`存在；
- `LICENSE`存在；
- `coffee-qr-tool/index.html`仍是v3.0。

### 页面

- 在线工具正常加载；
- 版本显示v3.0；
- 生成和解码正常；
- 自定义字段正常；
- 日历按钮正常；
- 图片上传和本地保持正常；
- 编码表同步地址不变。

### 安全检查

上传前可对照 `SHA256校验.json`。本包中的 `coffee-qr-tool/index.html`与此前正式v3.0文件内容完全相同。
