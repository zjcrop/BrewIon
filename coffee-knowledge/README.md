# BrewIon Coffee Knowledge

本目录是 BrewIon 的咖啡知识扩展层。它与 `coffee-qr-codebook` 的二维码核心编码表分离：扩展知识可以持续增加字段、来源、多语言名称和时间关系，但不得改变既有二维码索引。

## 设计边界

- `coffee-qr-codebook/coffee_qr_codebook_v6.json` 仍是二维码索引唯一所有者；
- 六张二维码索引表既有行不得删除、插入、重排或改 code；
- Coffee Knowledge 不参与二维码数组行号编码；
- 扩展知识通过稳定 `coreCode` / `id` 与核心表关联；
- AI 只生成候选，不直接修改正式数据；
- 默认运行现金成本为 0，不启用付费搜索。

## 数据分层

Coffee Knowledge 对外是一个数据集，对内允许模块化维护：

- `knowledge-manifest_v1.json`：知识源清单、发布契约和模块列表；
- `coffee_origin_knowledge_v1.json`：本体、高频知识、关系和处理法标准化；
- `catalog/*.json`：规模化目录模块，例如完整品种补充目录；
- `source_registry_v1.json`：可追溯来源及每周增量检查清单；
- `process_model_v1.json`：多维处理法模型；
- `audits/*.json`：审核证据和纠错过程，不直接等同于正式知识；
- `maintenance/*`：每周自动维护状态、候选和报告；
- `releases/*`：CI 生成并验证的对外稳定知识包。

这种结构避免把几百产区和数千庄园/处理站重复塞进一个巨大 JSON，同时仍可发布一个完整 bundle。

## 对外发布

消费者不应自行拼接内部源文件。正式入口：

```text
coffee-knowledge/registry-entry.json
```

其稳定 manifest：

```text
https://raw.githubusercontent.com/zjcrop/BrewIon/main/coffee-knowledge/releases/latest.json
```

发布流程：

1. 读取 v6 核心编码表；
2. 将每个 QR 索引行自动物化为基础知识节点，并保留 `qrIndex`；
3. 用经过验证的 `geoDetails/entityDetails/varietyDetails/processDetails` 按 `coreCode` 覆盖增强；
4. 未完成深度核验的旧条目保持 `evidenceStatus=legacy_core`，不会伪装成权威事实；
5. 计算 SHA-256 和字节数；
6. PR 阶段只构建候选并验证；
7. main 阶段自动发布 `releases/latest.json` 和完整 bundle；
8. 消费者采用 stage → verify → atomic activate，失败保留最后一个已验证版本。

当前硬要求：

- v6 52 个品种必须 52/52 有唯一语义节点；
- v6 25 个处理法必须 25/25 有标准化知识节点；
- 国家、产区、实体、风味即使尚未深度核验，也必须通过核心基线节点完整可查询；
- 任何知识发布不得改变 QR index。

## 多语言规则

核心数据原则上必须具备中文（`zh-Hans`）和英文（`en`）。确实无法获得可靠双语信息时可以暂存单语，但必须标记待补全，不得伪造翻译。

扩展层支持：

- `zh-Hans` / `zh-Hant`
- `en`
- `ja`
- `ko`
- `es`
- `pt`
- `fr`

日语、韩语名称区分：`official`、`market_verified`、`ai_translated`、`ai_transliterated`、`ocr_variant`。AI 生成名称不能自动升级为官方或市场已验证名称。

## 数据模型

知识层重点保存：

- 地理层级及 GI/DO/Appellation；
- 农场、庄园、生产者、合作社、Kenya factory、水洗站、湿磨厂、干磨厂、出口商等实体角色；
- `Coffea` 物种、品种、遗传群、亲本和选育关系；
- 基础处理法、发酵协议、干燥方式和特殊工艺；
- 批次（Lot）及其年度属性；
- 多语言标准名、别名、音译和 OCR 变体；
- 来源、证据、置信度和有效时间。

## 来源等级

1. **A**：政府、国家咖啡机构、科研机构、WCR、CQI、权威分类/地理认证组织；
2. **B**：官方赛事、同行评议论文、行业组织、可验证供应链机构；
3. **C**：庄园、出口商、进口商、专业生豆商；
4. **D**：媒体、博客、聚合页面，仅作为线索。

AI 本身不是事实来源。AI 只负责抽取、翻译、匹配、去重和提出候选。

## 每周维护

GitHub Actions 每周执行一次：

1. 直接访问 `source_registry_v1.json` 登记来源；
2. 比较内容哈希；
3. 未变化则不调用 AI；
4. 有变化才交给 `glm-4.7-flash`；
5. 仅输出候选 JSON 和维护报告；
6. 运行核心编码表与知识层校验；
7. 不自动合并正式数据。

智谱密钥通过 GitHub Actions Secret `ZHIPU_API_KEY` 提供。未配置时仍完成来源变化检测，但跳过 AI 结构化。

## 本地/CI校验

```bash
node scripts/coffee-db/validate-codebook.mjs
node scripts/coffee-db/validate-knowledge.mjs
node scripts/coffee-db/build-knowledge-bundle.mjs --output=/tmp/coffee-knowledge
node scripts/coffee-db/verify-knowledge-release.mjs --output=/tmp/coffee-knowledge
```

历史二维码兼容优先级高于数据库整理、美化、排序和去重。
