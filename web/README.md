# 知衡 · 个人资产

当前主交付方式为 Android APK，iOS 工程保留，见[手机安装和构建说明](docs/mobile.md)。以下浏览器启动说明用于开发预览。

无业务服务端的手机 App。账本保存在当前安装实例的 IndexedDB，AI 和 S3 直接连接用户配置的服务。页面资源内置在 APK，无需网站托管。

## 运行

需要 Node.js 22+。依赖由 package-lock.json 锁定。

```sh
npm ci
npm run dev
```

```sh
npm test
npm run build
npm run preview -- --port 4173
```

将 dist/ 中的文件放到固定 HTTPS 域名的根目录即可，无需数据库、容器或业务 API 服务，也不依赖 Sites。开发预览服务不是生产运行依赖。生产首次访问后缓存 App 代码与图标，不缓存外部 API 响应；新版本在旧页面关闭后接管。设置页显示实际缓存完整性、版本等待提示和安装说明。

## 使用

1. 添加账户，再录入余额、存款、基金、股票和负债。CSV 使用 App 内标准模板，并先创建同名账户。
2. “偏好与连接”填写必要支出、风险偏好、期限与配置目标，初始参数不是投资建议。
3. 配置模型 Base URL、协议、模型名、API Key；可独立配置 DeepSeek Search / Fetch。
4. “AI 研究室”查看发送字段并确认，点击发送才调用接口。
5. “数据备份”设置口令、S3 和间隔，打开并解锁后补做。也可导出加密 .zhb。
6. Android 直接安装 APK，原生设置页显示安装版信息；在“偏好与连接”开启系统设备解锁。浏览器开发预览才使用 PWA 缓存和添加到主屏幕。

?demo=1 打开独立示例视图，不注入真实账本。连接设置仍是实际本机设置。

## 边界

仅 CNY，当前为手工估值快照；尚无自动账户直连、实时行情、完整证券交易记账引擎。每日打开时记录账本快照，入金和出金也改变曲线，不能视为投资收益率。

设备锁控制访问入口；IndexedDB 未进行应用层静态加密。S3 与本地导出始终加密。密钥库、S3 配置、设备锁不随备份迁移。卸载 App、清除应用数据或浏览器预览数据前先备份。

## 模块

- src/model.ts：校验、十进制金额与健康指标。
- src/db.ts：事务、每日快照、恢复与回退。
- src/crypto.ts、backup.ts：加密、S3 签名与读回。
- src/backup-session.ts：配置与凭据的事务保存、解锁版本校验和备份状态隔离。
- src/ai.ts、search.ts：模型会话、搜索与网页抓取。
- src/device-lock.ts、DeviceGate.tsx：系统验证与访问锁。
- src/updates.ts、update-store.ts、UpdatePanel.tsx：GitHub 版本检查、每日节流、更新说明和下载入口。
- build/release-android.mjs：保留原签名的 APK 构建、摘要校验和 GitHub 发布。
- src/import.ts：CSV 预览、去重与校验。
- src/core.test.ts：关键行为与接口契约测试。
- build/service-worker.ts、src/pwa.ts：离线文件缓存、完整性检查与安装提示；src/service-worker.test.ts 覆盖离线和升级边界。

许可证见 THIRD_PARTY_NOTICES.md 和 licenses/。未复制 Wealthfolio 或 ezBookkeeping 的实现代码。详见[安装与离线使用](docs/install.md)、[备份手册](docs/backup.md)与[连接和设备验证](docs/connections.md)。
