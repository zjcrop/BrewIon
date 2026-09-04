# Coffee Foundation / 基座

`foundation/` 是 BrewIon 对 LuckyBean、AromaSense（香迹）、BrewProfiles 以及后续咖啡项目发布的跨项目稳定基础层。

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

## 当前合同

- `coffee-foundation/1.0`
- `recognition-document/1.1`
- `coffee-canonical-record/1.0`
- `ai-enrichment-result/1.0`
- `coffee-codebook/1.0`
- `coffee-knowledge/1.0`

`foundation-manifest.json` 是消费者发现这些合同与权威数据源的唯一入口。
