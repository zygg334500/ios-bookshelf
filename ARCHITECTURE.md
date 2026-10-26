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
| AZW3 | 只接受 PalmDB + `BOOKMOBI`。加密字段不是 0 就拒绝。每条正文记录先去掉公开的尾随数据，再按记录做 PalmDOC（压缩 2）或原文（压缩 1）。KF8 按 FDST 分段，再用骨架和片段索引把正文拼回 HTML。KFX 直接拒绝。Huff/CDIC（17480）报「不支持」，不解码。 | 与 EPUB 相同。 |

AZW3 **不会**实现 DRM 解除。加密样本在解析前就抛出 `BookError('DRM')`，界面写明文件受数字版权保护。

BookPush 传书前把无 DRM 的 AZW3 / AZW / MOBI / KF8 / PRC 转成 EPUB，手机书架收到的是 EPUB。PDF 和 EPUB 仍原样发送。

转换分两段，都不会调用 DeDRM 或 Kindle 密钥：

1. **本机快路径。** `bookpush/fastconvert.py` 用本书架自己的 PalmDOC / KF8 解析器在进程池里生成 EPUB（每个 CPU 一个进程，并尽量绑定到对应的核）。内容按 SHA-256 缓存，同一份字节再传时不再转换。缓存目录在 Windows 上是 `%LOCALAPPDATA%\BookPush\epub-cache`（一般在系统盘 SSD），也可以用 `BOOKSHELF_CONVERT_CACHE` 改位置。
2. **官方 Calibre 后备。** 快路径拿不到正文（例如 Huff/CDIC）时，才调用电脑上已经安装的 Calibre。Windows 上**先**找 `C:\Program Files\Calibre2\ebook-convert.exe`，再搜 PATH；`BOOKSHELF_EBOOK_CONVERT` 或窗口里的路径优先。优先启动少量常驻的 `calibre-debug -e` 工作进程（启动一次，连续转多本），启动失败再退回并行的 `ebook-convert`。两种方式都只传输入和输出路径，并设置独立的 `CALIBRE_CONFIG_DIRECTORY`，因此用户配置目录里的第三方插件（包括 DeDRM）不会被加载。

Calibre 本体是 GPL-3.0，转换插件还依赖它自带的 Python 和二进制扩展。BookPush 不把这些源码或插件拷进仓库：那样既要按 GPL 再许可整个程序，在系统 Python 里也导入不了。合法的加速方式就是上面的本机快路径，加上对已安装官方 Calibre 的进程池、核绑定和内容缓存。

有 DRM 的文件在调用任何转换器之前就跳过，窗口用中文说明不会解除保护。Calibre 自己也因 DRM 失败时，同样跳过这一本，队列里的其他书继续。没装 Calibre、而快路径又转不了时，提示到 https://calibre-ebook.com/ 安装官方版本，并写明不要安装 DeDRM。

简转繁只发生在打开阅读器、并且打开了「简转繁」的时候，和竖排无关。用的是 OpenCC 的 `STCharacters.txt` 与 `STPhrases.txt`，最长匹配。原文件不改。多义字取表里的第一项，所以「发」一类的字可能不是期望的那个。旧设置里的 `verticalTraditional: true` 会同时打开竖排和简转繁。

## 翻页

阅读器是一份放在 WebView（网页预览里是 iframe）里的 HTML。EPUB/AZW3 先按当前字号、字体、行距、边距、对齐和竖排把章节切成页；PDF 一页一个 canvas。

翻页是跟手的 `translate3d` 横滑。手指移动时只改当前页的位移；松手后用 `requestAnimationFrame` 做大约 260 毫秒的 ease-out，再换页。不使用透视 `rotateY`。那条路径会让 WKWebView 整页重绘，中端手机上帧率不稳。React Native 里也没有 UIKit 的 `pageCurl`，所以没有再包一层 3D。菜单用 `Animated` 且 `useNativeDriver: true`，WebView 尺寸在菜单开关时不变，避免每次重排。

横排时向左滑是下一页，点右侧约 22% 也是下一页。竖排（`writing-mode: vertical-rl`，书脊在右）时向左滑、或点左侧，是下一页。点中间收起或唤出菜单。

WebView 关掉了系统自动安全区（`contentInsetAdjustmentBehavior="never"`）。页边由页面自己留：顶部是安全区再加 36pt，给灵动岛和一行菜单；底部是安全区再加页码。iPhone 16e 竖屏大约是顶 59、底 34。不再把整段安全区叠两次，避免顶栏悬得太高。

字体：

- 系统：`-apple-system`，中文落到苹方；竖排时改用宋体
- 苹方：`PingFang SC`
- 宋体：`Songti SC` / `STSong`
- 黑体：`Heiti SC` / `STHeiti`，没有黑体时落到苹方
- 楷体：`Kaiti SC`
- 圆体：`Yuanti SC`

另外还有字号、行距、边距、对齐（左对齐 / 两端 / 居中）。主题是日间、羊皮纸、夜间。纸面亮度是盖在 WebView 上的半透明黑，不改系统亮度。竖排和简转繁分开。旧的 `verticalTraditional: true` 会同时打开这两项。

排版存在 settings 的 `reader` 里：`global` 是全部书籍，`books` 按书 id 覆盖。没有单独排版的书用全局。

位置记在 SQLite（网页预览失败时退回 localStorage）：章节、页码、0 到 1 的进度，以及 `reading_mark`（`auto` / `reading` / `finished`）。多页书的最后一页进度是 1。没打开过且进度为 0 是未读；打开过是阅读中；进度到头或标记为 finished 是已完成。`reading` 会压过“已经读完”的进度，方便标回在读。书签是 settings 里的 JSON，按当前章节和页码切换，点目录里的书签会按进度跳回。

正文强制使用 `--font` 里的苹方、宋体和 Noto / 思源，避免 EPUB 自带的字体把中文画成空白。分页前用 DOMParser 取出 body；量不到页面尺寸时先整章显示，布局完成后再切页。空白页会被丢掉。

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

手机用 `react-native-tcp-socket` 听端口，用 `react-native-zeroconf` 广播。服务类型是 `bookshelf` + `tcp`，注册出来是 `_bookshelf._tcp`。实例名固定成 ASCII 的 `BookShelf-` 加短哈希，避免中文设备名（默认「书房」）让 `DNSServiceRegister` 或 Windows 解析失败。显示名放在 TXT 的 `name`。TXT 还有 `path=/v1/books` 和 `pinRequired=1`，**没有**真正的配对码。

监听和停止串成一条队列，避免改设备名时先关掉端口、新的监听又因为旧套接字还在而直接返回。改名只重新广播，不拆 TCP。

Windows 的 `ServiceBrowser` 只记录服务名。`get_service_info` 放在回调外面，否则 python-zeroconf 会在监听线程里等到超时，浏览结果变成 0。地址优先用私网 IPv4。浏览大约 5 秒。结果为 0 时，窗口说明本地网络权限、同一 Wi-Fi、VPN 和 UDP 5353，并要求改用手工 IP、端口和配对码。

BookPush 的队列可以一次加入多本、移出选中的几本或清空。发送时一本失败不会停掉后面的书。书架导入同样逐本继续，并在中文说明里写出放上几本、失败几本。拿走一本书要点「移出」再点一次确认。

这两个原生模块不在 Expo Go 里，所以必须装进 IPA。网页预览只用于看书和导入，不能听端口。

Bonjour 失败时，传书页仍用大号字显示 IP、端口和配对码。BookPush 可以搜索，也可以手填。

iOS 需要 `NSLocalNetworkUsageDescription` 和 `NSBonjourServices` = `_bookshelf._tcp`。文件共享（`UIFileSharingEnabled`）是 USB 备用通道：把文件放进文稿根目录或 Inbox，再在传书页点「扫描文件共享」。

风险：同一 Wi-Fi 里的人如果看到配对码，就能上传。流量不加密。不要在公共 Wi-Fi 上开着收书页。

## 数据

- 书籍字节：`Paths.document/books/<id>/book.bin`（网页用 IndexedDB）
- 封面：同目录 `cover.jpg` 或 `cover.png`
- 目录与进度：SQLite `bookshelf.db`

## 安装包

`scripts/package-unsigned-ipa.sh` 执行 `expo prebuild`，再用 `CODE_SIGNING_ALLOWED=NO` 归档并打成 IPA。签名留给 Windows 上的 Sideloadly。`eas.json` 里的 development / preview / production 只是 Expo 的构建档，**不是**这条免费安装路径；EAS 的真机签名通常会要付费开发者账号，本方案不走那一步，也不提交商店。
