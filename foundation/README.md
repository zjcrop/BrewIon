# Coffee Foundation / 基座

`foundation/` 是 BrewIon 对 LuckyBean、AromaSense（香迹）、BrewProfiles 以及后续咖啡项目发布的跨项目稳定基础层。它只共享数据语义、识别合同、迁移/同步安全规则与校验运行时，不共享应用 UI。

## 权威边界

- BrewIon `provider/`：咖啡编码表与稳定 ID 的唯一权威发布边界。
- BrewIon `coffee-knowledge/`：名称、别名、本地化、关系与证据增强层。
- BrewIon `foundation/`：跨项目合同、规范化语义、兼容性与安全策略。
- OCR/相机/文件读取属于各平台输入适配器；输入实现可以不同，但输出必须收敛到 Foundation 合同。
- BrewProfiles 仍是专业冲煮计算权威；Foundation 不接管冲煮计算模型。

## 不变量

1. `coffee-foundation/1.x` 内只允许向后兼容扩展；破坏性语义修改必须提升主版本。
2. `coffee-codebook/1.0` 的稳定代码与既有行位置不可重排或复用。
3. RecognitionDocument 只描述识别事实与空间/来源证据，不直接决定业务字段写入。
4. AI 输出仅可作为候选、翻译、别名或复核建议；不得绕过置信度与人工确认策略直接覆盖事实。
5. 低置信度、冲突或缺少证据的字段必须保持 `review` / `unknown`，不得为了自动填表而伪造确定值。
6. 消费方必须校验合同主版本；数据包必须校验 SHA-256，失败时继续使用最后一个已验证快照。
7. LuckyBean、AromaSense 不得互相把“完整应用”作为共享协议来源；共享依赖只能经过本 Foundation 边界。
8. 中文/英文优先保留双语，基础层预留日文、韩文名称、别名与 OCR 归一化。
9. 消费者运行时只能锁定不可变 commit 上的版本化发布清单；`main` 和 `latest` 只能用于维护者发现更新，不能作为生产依赖。
10. 同一同步修订 ID + 同一内容哈希为幂等重放；同一修订 ID + 不同哈希必须冲突，禁止静默覆盖。

## 当前合同

- `coffee-foundation/1.0`
- `recognition-document/1.1`
- `coffee-canonical-record/1.0`
- `ai-enrichment-result/1.0`
- `recognition-book/1.0`
- `coffee-field-decision/1.0`
- `coffee-foundation-candidate/1.0`
- `coffee-sync-revision/1.0`
- `coffee-archive/1.0`
- `coffee-migration-result/1.0`
- `coffee-codebook/1.0`
- `coffee-knowledge/1.0`

## 运行时

`runtime/index.mjs` 是零第三方依赖的参考实现，提供：

- NFKC、空白、标点、OCR 常见误字的确定性规范化；
- 从冻结的 v6 编码表、标签词典和知识增强包构建 `RecognitionBook`；
- 唯一正式代码自动确认、知识层候选人工确认、同名冲突阻断；
- Legacy/OCR 输入到 `RecognitionDocument 1.1` 的无损适配；
- 版本主号、字节数和 SHA-256 校验，以及失败保留最后已验证版本的原子激活流程。

## 发布与消费

`foundation-manifest.json` 定义合同边界；`releases/coffee-foundation-1.0.2.json` 是当前生产消费者使用的不可变候选清单。消费者必须依次执行：

1. 下载已锁定 commit 上的版本化清单；
2. 检查 `coffee-foundation` 主版本；
3. 暂存所有制品并逐项核对 bytes 与 SHA-256；
4. 全部通过后原子切换；任一步失败时保留 last-known-good；
5. 识别结果仍经字段决策和用户确认进入业务表。

`main/latest` 不得直接成为 LuckyBean 或 AromaSense 的生产运行时依赖。
