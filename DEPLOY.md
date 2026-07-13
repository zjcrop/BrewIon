# 部署说明

目标仓库：`zjcrop/BrewIon`

将本压缩包中的两个目录上传到仓库 `main` 分支根目录：

- `coffee-qr-tool/`
- `coffee-qr-codebook/`

不要覆盖现有 `index.html`、`www/` 或 BrewIon 文件。

## GitHub 网页上传

1. 打开 `zjcrop/BrewIon`。
2. 选择 **Add file → Upload files**。
3. 将两个目录整体拖入上传区域。
4. Commit message 填写：`Add coffee QR tool and public codebook`。
5. 提交到 `main`。

## 启用 GitHub Pages

进入 **Settings → Pages**：

- Source：`Deploy from a branch`
- Branch：`main`
- Folder：`/(root)`

保存后网页预期地址：

https://zjcrop.github.io/BrewIon/coffee-qr-tool/

编码表公开地址：

https://github.com/zjcrop/BrewIon/tree/main/coffee-qr-codebook

Raw 地址：

https://raw.githubusercontent.com/zjcrop/BrewIon/main/coffee-qr-codebook/coffee_qr_codebook_v6.json

## 验收

1. 打开网页地址，确认页面正常加载。
2. 点击版本号，检查数据库来源是否显示远程或缓存。
3. 点击“立即同步编码表”，应显示同步成功。
4. 生成并解码一条二维码，确认 CRC 和明文映射正常。
