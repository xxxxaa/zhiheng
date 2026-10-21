# AI、搜索与设备解锁

## 模型

支持 Chat Completions 与 Responses。Base URL 按供应商需要包含 /v1，App 追加 /chat/completions 或 /responses。填写实际支持的模型名。

安装版通过原生 HTTPS 请求直连该地址，无浏览器 CORS 要求；浏览器预览服务需允许带 Authorization、Content-Type 的 CORS。使用 HTTPS，本机 localhost / 127.0.0.1 可用 HTTP。不跟随重定向，不接受 URL 账号密码。

API Key 默认仅保留当前会话，可用独立口令加密存本机并在下次解锁；与手机系统验证是两套机制。每次发送展示资产摘要、偏好、问题和最近 6 轮对话，不含账户平台名称、S3 凭据或备份口令。资产名称和数量仍是敏感数据，发送前请核对目的地。Responses 使用 store:false，兼容服务政策以供应商为准。

## 搜索

- 关闭：只分析提供的资料，每条输出标明未联网。
- Responses web_search：需要接口与模型支持工具；没有完成搜索或没有引用时显示失败。
- DeepSeek Search / Fetch：聊天和搜索可以使用不同供应商。默认 Base URL 为 https://api.deepseek.com，也接受以 /v1 结尾。

Search 使用 Bearer 鉴权，POST /v1/tools/search，请求 query、count:5、need_content:false。关键词 1–128 个 Unicode 字符，可独立填写；不填时使用问题前 128 字。无结果则停止市场分析。

可选通过 POST /v1/tools/fetch 抓取前 2 条结果，传入 url。失败保留摘要并标注。网页作为不可信资料，模型忽略其中的指令，输出保留来源链接和检索时间。报告和抓取预览不执行 HTML、不加载远程图片。

“网页资料工具”支持独立 Search / Fetch；预览不自动加入对话，发送时会重新检索。模型与搜索均可能收费，按供应商账户计费。

官方文档：[Search](https://api-docs.deepseek.com/zh-cn/api/search/)、[Fetch](https://api-docs.deepseek.com/zh-cn/api/fetch/)、[指南](https://api-docs.deepseek.com/zh-cn/guides/search/)。2026-10-21 对部署来源进行无凭据 OPTIONS 预检，两接口均允许来源、POST 和所需请求头；尚未真实鉴权调用。

## 手机系统解锁

Android / iOS 安装版通过原生系统验证开启，参见[手机说明](mobile.md)。以下 WebAuthn 描述仅适用于浏览器版。

支持 WebAuthn 平台验证器的 HTTPS 浏览器可以开启。系统选择 Face ID、指纹或设备口令；网页不能读取、指定或更改锁屏密码。

本机仅记录凭据 ID 与公钥，每次解锁产生新挑战，验证 origin、RP ID、用户在场/验证标志和 ECDSA P-256 签名。关闭页面或离开超过 1 分钟后重新锁定；应用组件卸载时清空会话密钥。

这是 App 访问锁，不是用设备口令加密 IndexedDB。若设备验证失效，需原设备重试，或从加密备份恢复到新浏览器；没有免验证关闭入口。设备锁不随备份迁移，新域名需重新设置。

当前内置预览不支持平台验证器，App 如实显示不支持。真实手机的系统验证与口令回退需用户在设备上完成。
