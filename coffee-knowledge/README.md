# BrewIon Coffee Knowledge

本目录是 BrewIon 的咖啡知识扩展层。它与 `coffee-qr-codebook` 的二维码核心编码表分离：扩展知识可以持续增加字段、来源、多语言名称和时间关系，但不得改变既有二维码索引。

## 设计边界

- `coffee-qr-codebook/coffee_qr_codebook_v6.json` 仍是当前正式二维码核心编码表；
- 六张二维码索引表既有行不得删除、插入、重排或改 code；
- 本目录不参与二维码数组行号编码；
- 扩展知识通过稳定 `code` 或知识层 `id` 与核心表关联；
- AI 只生成候选，不直接修改正式核心数据；
- 默认运行现金成本为 0，不启用付费搜索。

## 文件

- `coffee_origin_knowledge_v1.json`：知识结构、物种、处理体系、多语言及扩展关系；
- `source_registry_v1.json`：权威数据源清单和每周增量检查策略；
- `maintenance/source_state_v1.json`：每个来源最后一次抓取状态和内容哈希；
- `maintenance/weekly_candidates.json`：AI/规则产生的候选更新，不属于正式数据；
- `maintenance/weekly_report.md`：最近一次维护报告。

## 多语言规则

核心数据原则上必须具备中文（`zh-Hans`）和英文（`en`）。确实无法获得可靠双语信息时可以暂存单语，但必须标记待补全，不得伪造翻译。

扩展层从第一版起支持：

- `zh-Hans` / `zh-Hant`
- `en`
- `ja`
- `ko`
- `es`
- `pt`
- `fr`

日语、韩语名称区分官方名称、市场常用名、AI 翻译、AI 音译和 OCR 变体。AI 生成的日/韩名称默认不能自动升级为 `official` 或 `market_verified`。

## 数据模型

知识层重点保存：

- 地理层级及 GI/DO/Appellation；
- 农场、庄园、生产者、合作社、水洗站、湿磨厂、干磨厂、出口商等实体角色；
- `Coffea` 物种、品种、遗传群、亲本和选育关系；
- 基础处理法、发酵协议、干燥方式和特殊工艺；
- 批次（Lot）及其年度属性；
- 多语言标准名、别名、音译和 OCR 变体；
- 来源、证据、置信度和有效时间。

## 来源等级

优先顺序：

1. A：政府、国家咖啡机构、科研机构、WCR、CQI、地理认证组织；
2. B：官方赛事、行业组织、可验证供应链机构；
3. C：庄园、出口商、进口商、专业生豆商；
4. D：媒体、博客、聚合页面，仅作为线索。

AI 本身不是事实来源。AI 只能帮助抽取、翻译、匹配、去重和提出关系候选。

## 每周维护

GitHub Actions 每周执行一次：

1. 直接访问 `source_registry_v1.json` 中登记的官方来源；
2. 比较内容哈希；
3. 未变化则不调用 AI；
4. 有变化才把变化来源的文本交给 `glm-4.7-flash`；
5. 仅输出候选 JSON 和维护报告；
6. 运行核心编码表与知识层校验；
7. 不自动合并正式数据。

智谱密钥通过 GitHub Actions Secret `ZHIPU_API_KEY` 提供。未配置密钥时，维护任务仍可完成来源变化检测和报告，但跳过 AI 结构化步骤。

## 兼容性

任何准备进入核心编码表的变更必须先通过：

```bash
node scripts/coffee-db/validate-codebook.mjs
node scripts/coffee-db/validate-knowledge.mjs
```

历史二维码兼容优先级高于数据库整理、美化、排序和去重。
