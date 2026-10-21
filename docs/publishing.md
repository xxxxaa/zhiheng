# GitHub 发布与覆盖升级

仓库：https://github.com/xxxxaa/zhiheng 。公开版本：https://github.com/xxxxaa/zhiheng/releases 。

## 用户升级

0.1.2 起，“偏好与连接 → 应用更新”提供手动检查，也可开启每日自动检查。只有解锁后的 App 才运行检查；GitHub 请求失败不会阻塞账本。发现新版后可以查看说明并下载 APK，由系统浏览器下载、Android 安装器确认。安装前保存编辑并导出加密备份，直接覆盖安装，不要先卸载。

0.1.0 / 0.1.1 不含更新入口，需先从 Releases 手动安装 0.1.2。当前包继续使用原测试证书；保留 applicationId `app.zhiheng.assets` 和签名，并递增 versionCode，才能覆盖旧版。不能用其他机器自动生成的 debug.keystore 替代。

## 发布者流程

Node.js 22+、JDK 21、Android SDK platform 36 / Build Tools 36.0.0，以及已登录的 `gh`。设置 JAVA_HOME、ANDROID_HOME；可选 GRADLE_BIN 指向已有 Gradle 8.14.3，否则使用已固定 SHA-256 的 Wrapper。

1. `cd web && npm run version:android -- 0.1.3 4` 更新版本，补充 `release/notes/v0.1.3.md`。
2. 提交源码。CI 运行测试和 Android Release 编译，不持有签名私钥，也不发布随机 debug 签名的安装包。
3. 在原发布机器保留 `.mobile-tools/signing/zhiheng-compat.keystore`，或通过 ANDROID_SIGNING_KEYSTORE 指定私钥文件。密码和 alias 可用 ANDROID_SIGNING_STORE_PASSWORD、ANDROID_SIGNING_KEY_PASSWORD、ANDROID_SIGNING_ALIAS 提供；兼容现有测试密钥的默认值为 android / androiddebugkey。此默认口令不意味着私钥文件可以公开。
4. `npm run release:android` 测试、构建 release、zipalign、签名并验证包名、版本、证书指纹，输出 APK、SHA256SUMS 与发布说明到 artifacts。
5. 本地验证后执行 `npm run release:android -- --publish-only`。也可一步执行 `npm run release:android -- --publish`。

脚本要求工作区干净，APK 来自当前源码提交且摘要一致；不会覆盖已存在的 Release。它推送版本 tag、创建草稿并上传 APK，确认 GitHub 记录的 SHA-256 后才公开为 latest。失败时保留草稿供检查，不自动替换线上文件。

私钥仅留在本地并应另行安全备份，不写入 Git、不上传为 Release 附件，也没有存入 GitHub Actions。丢失私钥后不能继续对既有安装覆盖更新。

## 机器可读发布信息

`release/android.json` 定义包名、版本、versionCode、最低系统和公开证书指纹。发布脚本把 APK 名称及 SHA-256 写入 Release body 的 `zhiheng-update:v1` 标记。App 请求固定仓库的 `/releases/latest`，拒绝草稿、预发布、来源不符、元数据不一致及更低 versionCode，不使用任何 GitHub token。

新版本若提高最低 Android 版本，需要同时更新客户端兼容策略；当前更新通道面向 API 24+。不能只改 Release 描述绕过构建和签名检查。

参考：[GitHub Releases API](https://docs.github.com/en/rest/releases/releases)、[Android 应用签名](https://developer.android.com/studio/publish/app-signing)。
