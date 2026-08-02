# 私有冲煮 API 适配模板

该 Worker 在服务端读取 `zjcrop/brew-profiles` 中的 JSON 配置并计算方案。GitHub Token 只存放在 Worker Secret，不进入 Lucky Bean 前端。

## 环境变量

- `GITHUB_TOKEN`：仅授予私有仓库只读权限；
- `GITHUB_REPOSITORY`：例如 `zjcrop/brew-profiles`；
- `GITHUB_REF`：默认 `main`；
- `PROFILE_PATH`：例如 `profiles/default.json`；
- `ALLOWED_ORIGINS`：逗号分隔的 Lucky Bean 站点来源；未列入的浏览器来源返回 403；
- `RATE_LIMIT_KV`：可选 Cloudflare KV 绑定，用于按 IP/分钟限流；
- `REQUESTS_PER_MINUTE`：可选，默认 30。

部署后，将 `/api/brew` 地址填写到富贵盒子“器设 → 私有冲煮 API”。

当前 `brew-profiles` 尚无正式配置文件时，前端会自动使用本地回退引擎。

## 生产环境建议

示例使用只读 GitHub Token 便于首次部署。正式环境优先改用 GitHub App installation token，并配置密钥轮换、访问日志脱敏和告警。KV 限流为基础保护；高并发环境应改用原子计数器或平台原生 Rate Limiting。
