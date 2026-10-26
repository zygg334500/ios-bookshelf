# BookShelf 架构

Windows 上开发和预览界面。iPhone 上的安装包由云端 Mac 编译成**未签名 IPA**，再用 Sideloadly 和免费 Apple ID 签名。不上传 App Store，也不使用付费开发者账号。

## 目录

- `app/`：Expo SDK 58 + React Native + TypeScript。路由在 `app/src/app`。
- `windows/BookPush/`：Python 传书窗口。发现手机、填写 IP/配对码、POST 书籍。
- `samples/`：原创、无 DRM 的 EPUB / PDF / AZW3。
- `scripts/package-unsigned-ipa.sh` 与 `.github/workflows/unsigned-ipa.yml`：在 macOS runner 上打未签名 IPA。

## 格式管道

导入时看扩展名和文件头（`sniffFormat`）。

| 格式 | 处理 | 阅读 |
| --- | --- | --- |
| PDF | 原样保存。封面在第一次打开时由 PDF.js 画出来。 | WebView 里的 PDF.js 逐页画到 canvas。不重排，竖排开关不改变页面。 |
| EPUB | 解开 ZIP，读 `META-INF/container.xml` 和 OPF 的 metadata / manifest / spine。目录来自 `nav` 或 NCX。图片和 CSS 收成 data URI。 | 同一套 HTML 分页器。 |
| AZW3 | 只接受 PalmDB + `BOOKMOBI`。记录 0 的加密字段必须是 0。压缩 1 为原文，压缩 2 为公开的 PalmDOC。加密字段非 0 直接拒绝。Huff/CDIC（17480）报「不支持」，不尝试解码。能抽出的 HTML 走 EPUB 同一条阅读管道。 | 与 EPUB 相同。 |

AZW3 **不会**实现 DRM 解除。加密样本在解析前就抛出 `BookError('DRM')`。

简转繁只发生在打开阅读器、并且打开了「竖排繁体」的时候。用的是 OpenCC 的 `STCharacters.txt` 与 `STPhrases.txt`，最长匹配。原文件不改。多义字取表里的第一项，所以「发」一类的字可能不是期望的那个。

## 翻页

阅读器是一份放在 WebView（网页预览里是 iframe）里的 HTML。EPUB/AZW3 先按当前字号、字体和竖排模式把章节切成页；PDF 一页一个 canvas。

翻页是透视 `rotateY` 折页，加上阴影，不是 iOS `UIPageViewController` 的 `.pageCurl`。React Native 里没有那个 UIKit 转场。折页大约转到 62 度后换页，避免 180 度翻转把背面盖住下一页。横排时书脊在左；竖排（`writing-mode: vertical-rl`）时书脊在右，向左翻是下一页。

点页面左右约 22% 也会翻页，点中间收起或唤出菜单。

字体：

- 系统：`-apple-system`，中文落到苹方
- 苹方：`PingFang SC`
- 宋体：`Songti SC` / `STSong`
- 楷体：`Kaiti SC`

主题是白、羊皮纸、夜。纸面亮度是盖在 WebView 上的半透明黑，不改系统亮度。

位置记在 SQLite（网页预览失败时退回 localStorage）：章节、页码、0 到 1 的进度。

## 传书协议

服务类型：`_bookshelf._tcp.local`  
默认端口：`27780`（被占用则顺延）  
明文 HTTP，只绑定 `0.0.0.0`，给局域网用。没有账号系统。配对码是 4 位数字，显示在手机上，放在请求头 `X-Bookshelf-Pin`，也可以放在表单字段 `pin`。

```
GET /health
{"ok":true,"name":"书房","version":1,"pinRequired":true,"protocol":"bookshelf-1"}

POST /v1/books
Content-Type: multipart/form-data
X-Bookshelf-Pin: 2468
表单字段 file：书籍字节
表单字段 pin：可选，与请求头二选一

201 {"ok":true,"id":"...","title":"...","bytes":123,"format":"epub"}
401 {"ok":false,"error":"配对码不正确。"}
400 {"ok":false,"error":"此文件受数字版权保护（DRM）…"}
```

手机用 `react-native-tcp-socket` 听端口，用 `react-native-zeroconf` 广播。这两个原生模块不在 Expo Go 里，所以必须装进 IPA。网页预览只用于看书和导入，不能听端口。

Bonjour 失败时，传书页仍显示 IP、端口、配对码和二维码。BookPush 可以搜索，也可以手填。

iOS 需要 `NSLocalNetworkUsageDescription` 和 `NSBonjourServices` = `_bookshelf._tcp`。文件共享（`UIFileSharingEnabled`）是 USB 备用通道：把文件放进文稿根目录或 Inbox，再在传书页点「扫描文件共享」。

风险：同一 Wi-Fi 里的人如果看到配对码，就能上传。流量不加密。不要在公共 Wi-Fi 上开着收书页。

## 数据

- 书籍字节：`Paths.document/books/<id>/book.bin`（网页用 IndexedDB）
- 封面：同目录 `cover.jpg` 或 `cover.png`
- 目录与进度：SQLite `bookshelf.db`

## 安装包

`scripts/package-unsigned-ipa.sh` 执行 `expo prebuild`，再用 `CODE_SIGNING_ALLOWED=NO` 归档并打成 IPA。签名留给 Windows 上的 Sideloadly。`eas.json` 里的 development / preview / production 只是 Expo 的构建档，**不是**这条免费安装路径；EAS 的真机签名通常会要付费开发者账号，本方案不走那一步，也不提交商店。
