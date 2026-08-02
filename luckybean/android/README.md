# 富贵盒子 Android v0.6.0

这是 Lucky Bean Web 应用的 Android WebView 封装工程。应用通过受控 HTTPS 虚拟源加载内置静态资源，保留 ES Modules、IndexedDB、本地存储、二维码相机权限与文件选择能力。

## 构建

在仓库根目录执行：

```bash
gradle -p android :app:assembleDebug
```

生成：`android/app/build/outputs/apk/debug/app-debug.apk`。

## 安全说明

- 不在 APK 中嵌入 GitHub Token 或私有仓库凭据；
- 仅允许 HTTPS 网络请求；
- 本地应用资源通过 `https://app.luckybean.local/` 拦截提供；
- 相机和麦克风按需请求运行时权限；
- v0.6.0 Debug APK 使用 Android 默认调试签名，仅用于测试和侧载；
- 正式商店发布前必须使用长期保存的发布密钥重新签名，并递增 `versionCode`。
