# 知衡 · 个人资产

本地优先的个人资产管理 App。用一个账本整理银行卡、支付宝、微信钱包、东方财富中的现金、存款、基金、股票与负债，查看资产健康指标，并连接自己的模型与加密存储。

**[下载最新 Android APK](https://github.com/xxxxaa/zhiheng/releases/latest)** · [源码](https://github.com/xxxxaa/zhiheng) · [发布与升级](docs/publishing.md) · [手机构建](web/docs/mobile.md)

## 使用

1. 从 Releases 下载 APK，在 Android 文件管理器中打开并按系统提示安装。Android 7+，需要较新的系统 WebView。
2. 创建账户，手工录入资产，或导入知衡标准 CSV。账户仅是分类，不需要银行密码。
3. 在“偏好与连接”设置设备解锁、AI 模型和搜索服务；在“数据备份”设置自己的 S3 兼容存储或导出加密备份。
4. “应用更新”可自动或手动检查新版；0.1.5 起支持 App 内下载、进度、取消重试和安装包校验，完成后点击“安装更新”。旧版若卡在浏览器下载，可从 Releases 下载备用 ZIP，解压其中 APK 后覆盖安装。无需卸载；卸载会清除本地账本。

0.1.1 及更早版本需先手动安装 0.1.3。当前发布使用与早期测试 APK 相同的测试签名，尚未上架应用商店；未来安装包必须继续使用同一身份和签名才能覆盖升级。

## 功能与边界

- 多账户与持仓管理、十进制金额核算、CSV 预览与去重、按日资产快照。
- 资产配置、应急资金与集中度等确定性指标；DeepSeek 模型下拉选择、刷新可用列表与思考强度设置；保留自定义 AI 模型接口，独立 DeepSeek Search / Fetch。
- 系统设备验证，重启或离开超过一分钟后重新锁定。
- AES-GCM 加密备份、本地文件恢复；S3 定时备份在 App 打开且连接已解锁时运行，错过的任务下次补做。
- Android 页面随安装包提供，不需要网站托管、Sites 或业务服务端。GitHub 只提供源码和版本分发。

真实银行、支付宝、微信和券商账户尚未直连。AI、搜索和 S3 需要使用者配置并验证自己的服务。行情和模型建议不构成交易执行功能。各设备账本独立，备份恢复会替换当前账本，不自动合并修改。

## 开发

需要 Node.js 22+、JDK 21、Android SDK 36 / Build Tools 36.0.0。

```sh
cd web
npm ci
npm test
npm run mobile:sync
cd android
./gradlew assembleDebug
```

GitHub Actions 执行测试和 Android 编译。发布包在本机使用原签名生成，签名私钥、API 密钥、账本、备份和开发环境不会提交到仓库。详细命令见[发布说明](docs/publishing.md)。

iOS 工程保留，签名和设备安装需自行配置；当前主要验收平台为 Android。

## 文档

- [架构与隐私](docs/architecture.md)
- [AI、搜索与设备解锁](web/docs/connections.md)
- [加密备份与恢复](web/docs/backup.md)
- [第三方组件与许可证](web/THIRD_PARTY_NOTICES.md)

第三方组件按各自许可证分发。仓库公开不代表已为本项目原创代码授予另行的开源许可。
