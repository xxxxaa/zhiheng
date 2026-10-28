# GitHub 发布与覆盖升级

仓库：https://github.com/xxxxaa/zhiheng 。公开版本：https://github.com/xxxxaa/zhiheng/releases 。

## 用户升级

0.1.3 起，“偏好与连接 → 应用更新”提供手动检查，也可开启每日自动检查。只有解锁后的 App 才运行检查；GitHub 请求失败不会阻塞账本。

0.1.5 起由 App 内的原生下载器接收 APK，显示字节数与进度，支持取消和重试。连接/读取 15 秒无响应或总耗时超过 3 分钟会结束并显示错误。收到完整字节后先校验大小、SHA-256、包名、版本、最低系统和签名；校验通过才显示“安装更新”。安装包保存在 App 私有目录，重启后重新校验并恢复安装入口，用户无需在系统下载目录寻找。进程被终止时未完成的临时文件会删除，需重新下载。

安装由 Android 系统确认。Android 8+ 首次可能需要用户在系统设置中允许知衡发起安装；App 不会绕过此授权，也不会静默安装。安装前保存编辑并导出加密备份，直接覆盖安装，不要先卸载。

0.1.4 及更早版本仍依赖浏览器下载，无法自动获得新版下载器。若浏览器卡在 APK 下载收尾，可先下载 Release 中的备用 ZIP，解压后打开其中的同一签名 APK，完成这一次覆盖升级。0.1.6 起在更新页直接展示 ZIP 备用按钮，并显示当前安装版本；检查时为静态清单添加时间戳且禁用本地缓存，避免复用旧版本响应。0.1.5 起发布脚本同时上传 APK、ZIP 与两者的 SHA-256；不使用第三方代理下载源。

0.1.0 / 0.1.1 不含更新入口，0.1.2 的检查可能受 GitHub API 匿名限额影响；这些旧版都可直接用 0.1.6 ZIP 覆盖升级，无需经过中间版本。当前包继续使用原测试证书；保留 applicationId `app.zhiheng.assets` 和签名，并递增 versionCode，才能覆盖旧版。不能用其他机器自动生成的 debug.keystore 替代。

## 发布者流程

Node.js 22+、JDK 21、Android SDK platform 36 / Build Tools 36.0.0，以及已登录的 `gh`。设置 JAVA_HOME、ANDROID_HOME；可选 GRADLE_BIN 指向已有 Gradle 8.14.3，否则使用已固定 SHA-256 的 Wrapper。

1. `cd web && npm run version:android -- 0.1.8 9` 更新版本，补充对应版本发布说明，并更新 README 中的 ZIP 下载入口。
2. 提交源码。CI 运行测试和 Android Release 编译，不持有签名私钥，也不发布随机 debug 签名的安装包。
3. 在原发布机器保留 `.mobile-tools/signing/zhiheng-compat.keystore`，或通过 ANDROID_SIGNING_KEYSTORE 指定私钥文件。密码和 alias 可用 ANDROID_SIGNING_STORE_PASSWORD、ANDROID_SIGNING_KEY_PASSWORD、ANDROID_SIGNING_ALIAS 提供；兼容现有测试密钥的默认值为 android / androiddebugkey。此默认口令不意味着私钥文件可以公开。
4. `npm run release:android` 运行前端与 Android 下载引擎测试、构建 release、zipalign、签名并验证包名、版本、证书指纹，输出 APK、备用 ZIP、SHA256SUMS 与发布说明到 artifacts。
5. 本地验证后执行 `npm run release:android -- --publish-only`。也可一步执行 `npm run release:android -- --publish`。

脚本要求工作区干净，APK 来自当前源码提交且摘要一致；不会覆盖已存在的 Release。它推送版本 tag、创建草稿并上传 APK，确认 GitHub 记录的 SHA-256 后才公开为 latest。失败时保留草稿供检查，不自动替换线上文件。

私钥仅留在本地并应另行安全备份，不写入 Git、不上传为 Release 附件，也没有存入 GitHub Actions。丢失私钥后不能继续对既有安装覆盖更新。

## 机器可读发布信息

`release/android.json` 定义包名、版本、versionCode、最低系统和公开证书指纹。发布脚本把 APK 名称及 SHA-256 写入 Release body 的 `zhiheng-update:v1` 标记。发布完成后脚本提交 `release/latest.json`，App 优先读取固定仓库的公开静态清单，首次清单缺失才回退 `/releases/latest`，避免共享 IP 的 REST 匿名请求限额；拒绝草稿、预发布、来源不符、元数据不一致及更低 versionCode，不使用任何 GitHub token。

新版本若提高最低 Android 版本，需要同时更新客户端兼容策略；当前更新通道面向 API 24+。不能只改 Release 描述绕过构建和签名检查。

参考：[GitHub Releases API](https://docs.github.com/en/rest/releases/releases)、[Android 应用签名](https://developer.android.com/studio/publish/app-signing)。
