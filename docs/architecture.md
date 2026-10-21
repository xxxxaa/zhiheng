# 架构与隐私

React / TypeScript 界面经 Capacitor 打包为 Android / iOS 应用；本地账本使用 Dexie / IndexedDB，金额使用 decimal.js，CSV 使用 PapaParse，S3 请求使用 aws4fetch 签名。手机安装包内置页面，没有远程 server.url。

账本包含账户分类和资产快照，不保存银行登录密码。设备锁保护访问入口，系统 PIN / 生物识别不会交给 JavaScript；设备锁并非数据库加密密钥。API 和 S3 凭据可用用户口令加密存放，账本导出不包含它们。

备份采用 PBKDF2-SHA256 与 AES-GCM，随机盐与 IV。S3 自动备份只在 App 打开、备份连接已解锁时检查；关闭期间不运行，下次打开并解锁后补做。各设备独立，恢复会替换账本，保留一份本地回退快照。

AI、搜索和 S3 请求直接发送给用户配置的 HTTPS 服务；Android 不通过本项目业务后端。GitHub 版本检查优先读取公开静态清单，仅发送 GET 请求，不附加资产、服务密钥或个人账户标识。可在设置中关闭每日自动检查。

更新从固定仓库 xxxxaa/zhiheng 的公开 Release 获取，检查应用 ID、tag、Android versionCode、签名证书指纹、APK 地址和发布摘要。下载由系统浏览器处理，安装由 Android 系统确认；App 不执行静默安装，也不声称自行校验了浏览器下载的文件。下载前请先备份账本。
