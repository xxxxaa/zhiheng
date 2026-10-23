# Android 手机 App（附 iOS 工程）

当前主要交付 Android 安装包，iOS 工程保留供自行签名构建。

交付形式：复用现有 React 界面，使用 Capacitor 8 打包。App ID 为 `app.zhiheng.assets`，Android 版本 0.1.6（versionCode 7）；已有 iOS 构建仍为 0.1.0。页面资源包含在安装包内，无 `server.url`，不依赖 Sites、域名或业务服务端。

## 安卓首次安装

APK 最低 Android 7（API 24）、目标 API 36，无按 CPU 架构区分的 `.so` 库。Android 15 模拟器已验证系统 PIN、文件保存与加密恢复；厂商定制系统和真实指纹需在目标手机上验证。

1. 下载 [Android 0.1.6 ZIP 安装包](https://github.com/xxxxaa/zhiheng/releases/download/v0.1.6/zhiheng-0.1.6-android.zip)，在系统文件管理器中解压并打开其中的 APK。ZIP 可用于浏览器卡在 APK 下载收尾时的首次覆盖升级。
2. 按系统安装器提示，为打开 APK 的来源授予本次安装所需权限，再安装“知衡”。不需要 Sites、浏览器添加到主屏幕或 Apple 签名。
3. 首次打开添加一个测试账户和一条合成现金记录，关闭再打开，确认记录保留。
4. 在“偏好与连接”测试系统解锁；在“数据备份”测试加密文件导出和重新选择文件恢复。真实云备份需在 App 内配置自己的 S3。

构建和签名校验之外，更新前请保留独立加密备份。测试时不要先卸载旧版；卸载会删除本机账本。

## 应用更新

在“偏好与连接 → 应用更新”检查新版；自动检查每天最多一次，可关闭。0.1.5 起可在 App 内下载，显示进度、取消和重试，校验完成后由用户确认安装。0.1.6 显示当前安装版本、直接提供 ZIP 备用按钮并重新获取版本清单。GitHub 无法连接时不会阻塞本机账本。0.1.4 及更早版本需先用 ZIP 手动完成这一次覆盖升级。

## 安装和迁移

- Android：使用本项目生成的 `zhiheng-0.1.6-android.apk`。这是测试签名版本，不是应用商店正式发行包。覆盖安装可保留数据；不要先卸载旧版。首次安装时按 Android 提示允许该文件来源安装。
- iOS：用 Xcode 打开 `ios/App/App.xcodeproj`，在 App → Signing & Capabilities 选择自己的开发团队，连接已信任的 iPhone，选择该设备并运行。真机安装需要 Apple 签名与对应设备的 provisioning profile；未签名的 `.app` 不能直接装到 iPhone。
- 原浏览器账本与安装版是两个独立存储空间。先在原版本导出 `.zhb` 加密备份，在安装版“数据备份”中填写原备份口令，选择文件、预览并确认恢复。API/S3 凭据和设备锁不会随账本备份迁移，需重新设置。

首版支持 Android 7+（需更新系统 WebView）、iOS 15.4+。低版本设备尚未真机验收。

## 手机行为

系统解锁调用手机原生验证，支持系统提供的 Face ID、指纹、PIN、图案或口令。首次开启必须成功验证。取消或失败不会解锁；浏览器不会走原生插件的模拟验证路径。Android 9/10 的系统接口在允许设备口令时可能接受弱生物识别，见插件官方说明。系统解锁是访问锁，不是数据库加密密钥。

重启或离开超过一分钟后重新验证；短时文件选择、分享面板可正常返回。Android 隐藏截图与最近任务画面，iOS 切后台时覆盖资产画面。系统自动云备份关闭或排除账本目录，通过 App 内的加密备份主动迁移。

Android 导出模板与加密备份时使用系统“保存文件”对话框（Storage Access Framework），不需要额外安装文件分享接收应用或授予广泛存储权限。写入并关闭输出流后才提示成功，取消保存不会显示成功。iOS 保留 Filesystem + Share 流程；关闭分享面板不代表保存成功，需在目标位置确认。导出内容不包含 API 密钥。

定时云备份仍按用户选择在打开 App、解锁备份连接时检查。关闭 App 期间不保证执行，下次打开并解锁后补做。S3 是备份存储，不自动合并多设备数据。

模型、搜索与 S3 使用 HTTPS 原生网络请求，无浏览器 CORS 要求，不跟随重定向。模型/搜索密钥仅发往用户配置的地址。取消请求会丢弃晚到结果，但 Capacitor 的 HTTP 桥接不能撤销已发送的请求；服务方仍可能处理或计费。备份仍执行 30 MB 校验，原生 HTTP 会先缓冲响应，尚未对低内存手机做 30 MB 压力验收。

## 从源码构建

需要 Node.js 22+、JDK 21、Android SDK 36 / Build Tools 36.0.0；iOS 使用 Xcode 26+。

```sh
npm ci
npm test
node build/generate-notices.mjs
npm run mobile:sync
```

Android：配置 `ANDROID_HOME` 或 `android/local.properties` 中的 `sdk.dir`，执行：

```sh
cd android
./gradlew assembleDebug
```

开发 APK 位于 `android/app/build/outputs/apk/debug/app-debug.apk`。该开发构建使用本机 debug key，其他机器生成的包不能直接覆盖已发布版本。要发布兼容旧版的包，使用[发布脚本](../../docs/publishing.md)，沿用原签名。

iOS 模拟器与未签名真机构建（仅用于编译验证）：

```sh
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath .mobile-build/ios-simulator CODE_SIGNING_ALLOWED=NO build
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Release \
  -sdk iphoneos -destination 'generic/platform=iOS' \
  -derivedDataPath .mobile-build/ios-device CODE_SIGNING_ALLOWED=NO build
```

Swift 依赖由 Xcode 解析，平台插件由 `cap sync` 根据 package-lock.json 更新。源码包不含本机 SDK、Gradle 缓存、签名私钥、配置凭据或个人账本。
