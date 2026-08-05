# BrewIon Provider Layer

该目录是 BrewIon 面向 LuckyBean 与 BrewProfiles 的唯一稳定数据发布边界。消费者不得读取 BrewIon 页面内部变量，也不得直接连接项目内部数据库。

## 输出

- `provider/releases/latest.json`：当前稳定发布清单；
- `full/`：完整编码表，用于首次安装、链路断裂和灾难恢复；
- `delta/`：六张索引表的末尾追加内容；
- `corrections/`：旧行显示元数据修正，以及 `relations`、`aliases` 的受控替换；
- `provider/registry-entry.json`：供平台注册表引用的稳定入口。

## 不变量

1. `countries`、`regions`、`entities`、`varieties`、`processes`、`flavors` 的既有代码和行位置不可改变；
2. 新索引行只能追加；
3. 旧行名称、翻译、状态等修正必须进入 corrections；
4. 每个发布物必须记录字节数和 SHA-256；
5. 更新失败时消费者继续使用最后一个已验证快照；
6. 数据包更新不要求 LuckyBean 升级，只在合同主版本不兼容时要求应用升级。

## 本地验证

```bash
node --test provider/tests/*.test.mjs
node provider/scripts/build-provider-release.mjs --output=/tmp/brewion-provider
node provider/scripts/verify-provider-release.mjs --output=/tmp/brewion-provider
```

主分支工作流会生成正式发布物并提交；Pull Request 仅在临时目录构建和验证，不会污染稳定发布目录。
