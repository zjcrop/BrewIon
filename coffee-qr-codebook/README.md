# Coffee QR Codebook

咖啡豆信息二维码编解码工具使用的公开编码表。

## 主数据文件

`coffee_qr_codebook_v6.json`

网页端 Raw 同步地址：

https://raw.githubusercontent.com/zjcrop/BrewIon/main/coffee-qr-codebook/coffee_qr_codebook_v6.json

## 核心兼容性规则

1. `countries`、`regions`、`entities`、`varieties`、`processes`、`flavors` 是二维码行号索引表。
2. 既有索引行禁止删除、插入、移动或重新排序；只能在表尾新增。
3. 可修订既有行的中文名、英文名、别名和状态，但不得改变其索引含义。
4. 新增索引行必须提升 `version`，并更新 `updatedAt`。
5. `relations` 可增删修改，但引用代码必须存在。
6. JSON 必须保持有效，禁止加入注释。
7. 所有外部贡献通过 Pull Request 提交，由仓库维护者保留最终审核与合并权。

## 建议协作流程

1. Fork 仓库。
2. 修改本目录的数据文件。
3. 校验 JSON 语法。
4. 检查索引表既有行顺序未变化。
5. 提交 Pull Request，列明新增、修订、证据来源和兼容性影响。
