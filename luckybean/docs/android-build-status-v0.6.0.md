# Lucky Bean Android v0.6.0 构建记录

## 构建结论

GitHub Actions 工作流 `Build Lucky Bean Android APK` 第 3 次运行通过全部步骤。

- 源码提交：`dfa85e4c5f0b68b9e05c0c31294ed70a7b2fbc98`
- 合并提交：`b172489a00ecc30a8629f432bf7c361d6d7dbb5d`
- 工作流运行：`30281838154`
- 构件：`LuckyBean-v0.6.0-Android-debug`
- 构件 ID：`8659162129`

## APK 元数据

| 项目 | 值 |
|---|---|
| 文件 | `LuckyBean-v0.6.0-debug.apk` |
| 包名 | `com.luckybean.app.debug` |
| versionCode | `600` |
| versionName | `0.6.0-debug` |
| minSdk | `26` |
| targetSdk | `35` |
| SHA-256 | `2b48071831263ef11efa921ce32b1755c7f3ecd5a74bcdd7d076764cf9c4d0eb` |

## 通过的检查

- Web 单元测试 9/9；
- Web 静态工程检查；
- Android SDK 35 编译；
- APK Signature Scheme 签名验证；
- `aapt dump badging` 元数据读取；
- APK ZIP 结构完整性检查；
- GitHub Actions 构件上传。

## 发布边界

当前 APK 使用 Android 默认调试签名，适合开发测试和侧载验收，不作为应用商店正式发布包。生产发布必须使用项目所有者长期保管的发布密钥，并保持后续版本使用同一签名密钥。
