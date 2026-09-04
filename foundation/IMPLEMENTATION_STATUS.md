# Coffee Foundation 基座实施状态

更新时间：2026-09-04  
当前稳定发布：`coffee-foundation-1.0.2`  
合同主版本：`coffee-foundation/1.0`

## 已完成

- 统一合同：RecognitionDocument、Canonical Coffee Record、AI 候选、RecognitionBook、字段决策、同步修订、归档与迁移结果。
- 统一运行时：中英日韩文本/OCR 规范化、RecognitionBook 构建、跨应用字段名归一、Legacy/OCR 文档适配。
- 数据安全：知识层候选不自动获得 core/QR code；同名歧义和受阻实体保持 review/conflict。
- 激活安全：合同主版本、bytes、SHA-256、JSON 结构校验；暂存完成后原子切换；失败保留 last-known-good。
- 同步安全：不可变 revision、幂等重放、同 ID 不同哈希冲突、canonical JSON SHA-256。
- 归档安全：逐记录哈希、未知主版本拒绝、校验失败不允许部分写入。
- 发布安全：生产 registry 锁定 40 位 commit 上的版本化清单；制品 URL 全部锁定不可变 commit；`main/latest` 仅作更新发现。
- 成本与 AI：基座零第三方运行时依赖、默认现金成本为 0；AI 完全可选，只能给出候选。
- CI：Foundation 合同、真实 v6 行号、知识包、运行时行为和不可变制品均纳入自动门禁。

## 当前验证结果

- Foundation 运行时：12/12 通过。
- Provider 增量/修正重建：2/2 通过。
- v6 冻结索引：56 countries、247 regions、460 entities、52 varieties、25 processes、127 flavors，未重排。
- Coffee Knowledge：52/52 核心品种语义覆盖；5 个研究冲突实体均阻止自动解析；QR 索引改动为 0。
- 本地化：标签词典支持 zh-CN/en/ja/ko；日文 32、韩文 32 条增强别名验证通过。
- LuckyBean 当前识别/日期/知识兼容回归：77/77 通过。完整静态套件在未执行 npm postinstall 的本地克隆中停于 jsQR vendor 前置检查，非 Foundation 合同失败。

## 明确不属于本次基座完成范围

- LuckyBean 与 AromaSense 的消费者接入仍保持暂停，尚未把运行时依赖切换到 `coffee-foundation-1.0.2`。
- AromaSense 仍有直接引用 LuckyBean 完整识别包的旧依赖；后续消费者迁移必须改为只依赖 Foundation，不复制或共享 UI。
- Android/iOS 真机相机、图片权限、离线升级和 BrewIon↔消费者二维码往返仍需在消费者接入阶段验收。
- BrewProfiles 继续作为专业冲煮计算权威，Foundation 不接管或复制计算模型。
