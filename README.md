# BookShelf

在 Windows 上读完这页就能做完：预览阅读器、打出一个未签名的 iPhone 安装包、用免费 Apple ID 装进手机，再从电脑经家里的 Wi-Fi 把书传过去。

不需要 Mac。不需要付费的 Apple Developer Program。不上架 App Store。证书大约 7 天后要重签一次，这是免费 Apple ID 的限制，可以接受。

## 仓库里有什么

```
app/                    Expo 阅读器（TypeScript）
windows/BookPush/       Windows 传书程序
samples/                原创、无 DRM 的 EPUB / PDF / AZW3
scripts/package-unsigned-ipa.sh
.github/workflows/unsigned-ipa.yml
ARCHITECTURE.md         格式管道和传书协议
```

阅读器支持 PDF、EPUB，以及**没有 DRM** 的 AZW3。有版权保护的 AZW3 会停在一屏中文说明上，程序不会尝试解开它。

## 1. 在 Windows 上先看阅读器

安装 Node.js 22。在仓库里：

```bat
cd app
npm install
npm test
npx expo start --web --port 43123
```

浏览器打开 `http://127.0.0.1:43123`。点「放入示例」，打开《窗下》，试翻页、字号、行距、苹方/宋体/黑体/楷体/圆体，以及竖排和简转繁。

这一步只是界面。浏览器**不能**代替手机收书：网页里没有局域网监听。示例书是仓库里的原创短篇，不是出版图书。

`npm test` 会检查 EPUB 的 OPF、AZW3 的 DRM 拒绝、简转繁和上传解析。

## 2. 在 Windows 上运行传书工具

安装 Python 3.11 或更新版本，安装时勾选 **tcl/tk**（python.org 的安装包默认带）。

双击 `windows\BookPush\run.bat`（或 `run.ps1`）。脚本先找 `%LOCALAPPDATA%\Programs\Python\Python312\python.exe`，也认 313 / 311 / 310，找不到才试 `py -3` 和 `python`。这台电脑没有 py 启动器时也能打开。也可以把 python.exe 的完整路径放进环境变量 `BOOKSHELF_PYTHON`。

安装包需要自带 Tcl/Tk。python.org 的安装程序默认勾选。

窗口打开后会搜索 `_bookshelf._tcp`。搜到 0 台时，把手机屏幕上的 IP、端口（默认 27780）和 4 位配对码填进「手工填写」。配对码不在 Bonjour 广播里。可以选 pdf、epub、azw3、azw、mobi、kf8。无 DRM 的 Kindle 文件会先转成 EPUB 再发送：能解析的在本机并行转换，解析不了的再用官方 Calibre。Windows 会优先使用 `C:\Program Files\Calibre2\ebook-convert.exe`（不必在 PATH 里）。有 DRM 的文件会停住并说明原因，不会去解除保护。转换进度和发送进度分开显示。

没有手机时，可以先开一个模拟收书服务，确认窗口能传文件：

```bat
py -3 -m bookpush.mock_server --port 27780 --pin 2468 --dir received
```

另开一个终端跑 BookPush，IP 填 `127.0.0.1`，端口 `27780`，配对码 `2468`。

测试客户端：

```bat
py -3 -m unittest discover -s tests -v
```

防火墙：第一次发送如果 Windows 询问，选择允许 Python 访问**专用网络**。不要勾公共网络。手机和电脑要在同一个家里的 Wi-Fi，不要用访客网络，先关掉 VPN。

## 3. 得到 IPA（不要买开发者账号）

免费 Apple ID 不能在 Windows 上自己编译 iOS 应用，但可以给已经编译好的 IPA 签名。编译放在 GitHub 的 macOS 虚拟机上，全程不登录 Apple，也不付 99 美元。

1. 把这个仓库推到 GitHub（公开或私有都可以，私有仓库要有 macOS Actions 分钟数）。
2. 打开仓库的 Actions 页，选择 **Unsigned iOS IPA**，点 Run workflow。
3. 完成后下载产物 `BookShelf-unsigned-ipa`，里面是 `BookShelf-unsigned.ipa`。

这个 IPA 没有签名，不能直接装。下一步用 Sideloadly 签。

仓库里的 `eas.json` 是 Expo 的可选构建档，**不是**这条安装路径。EAS 给真机签名时通常会要求付费的 Apple Developer 账号。不要为了本书架去注册那个计划，也不要提交 App Store 或 TestFlight。

## 4. 用 Sideloadly 和免费 Apple ID 安装

1. 在 Windows 安装 [Sideloadly](https://sideloadly.io/)。
2. 按 Sideloadly 的说明安装 Apple 设备支持。目前一般是 Microsoft Store 里的 **Apple Devices**（以及它要求的 Apple Mobile Device Support）。手机用数据线连上电脑，在手机上点「信任」。
3. 把 `BookShelf-unsigned.ipa` 拖进 Sideloadly。
4. 填你的免费 Apple ID。Sideloadly 会向 Apple 申请一个大约 7 天的个人证书并装进手机。这仍然不是付费开发者计划。
5. 手机上打开 **设置 → 通用 → VPN 与设备管理**，信任刚才那个开发者描述文件。
6. 打开 BookShelf。第一次进入「Wi-Fi 传书」时，系统会问是否允许**本地网络**，选允许。

Bundle ID 默认是 `com.fengyang.bookshelf`。要改的话，改 `app/app.json` 里的 `ios.bundleIdentifier`，然后重新打 IPA。

应用声明了这些文档类型，所以系统的「打开方式」里可以出现 BookShelf：PDF、EPUB、AZW3。也可以用手机自己的「文件」App 导入。Wi-Fi 不通时，用数据线在 Apple Devices 的文件共享里把书放进 BookShelf 文稿，再在传书页点「扫描文件共享」。

## 5. 每 7 天重签

免费证书过期后图标还在，但点开会提示需要重新信任或无法验证。

1. 不要先删掉 App，这样书架里的文件更容易留住。
2. 数据线连上电脑，用**同一个 IPA、同一个 Apple ID** 再装一次。
3. 若手机已经把过期应用清掉，只能重装后再传一次书。

也可以改用 AltStore：Windows 上运行 AltServer，手机装 AltStore，之后同一 Wi-Fi 下有机会自动续签。签名来源仍然是免费 Apple ID，期限同样大约 7 天。Sideloadly 是本说明的主路径。

合并到 `main` 之后，这次推送会自动跑 **Unsigned iOS IPA**。想立刻重打：打开 Actions，选 **Unsigned iOS IPA**，点 **Run workflow**。跑完下载产物 `BookShelf-unsigned-ipa`，里面是未签名的 `BookShelf-unsigned.ipa`。工作流只做 `npm ci` 和 `scripts/package-unsigned-ipa.sh`，不登录 Apple，也不签名。

## 6. 把书传到手机

1. 手机打开 BookShelf，停在「Wi-Fi 传书」，看到 IP、端口和 4 位配对码。
2. 电脑打开 BookPush，搜索设备；搜不到就把手填 IP 和端口（默认 27780）。
3. 点「加入书籍」，可以一次加入多本 PDF、EPUB、无 DRM 的 AZW3。点「移出」拿掉选中的几本，点「清空」倒掉队列。手机上已经收下的书不会被删掉。
4. 输入配对码，点一次「开始传书」。队列里的书会一起处理：无 DRM 的 AZW3 多本并行转换，转好的马上接着发送，直到这一批结束，不用一本一本点。送到手机的书会从队列里消失。失败的（例如有 DRM）留下，标题标成「失败，可重试」，再点一次「开始传书」就重试。其中一本失败不会挡住后面的书。窗口用中文写出送出几本、失败几本。
5. 回到书架就能看到新书。架上会显示本数。点封面打开。长按封面可以移出或标为读完，移出要点第二次确认。之后可以关 Wi-Fi，阅读不需要网络。

配对码只是避免同网里别人随手上传。传输没有加密。不要在咖啡馆的公共 Wi-Fi 上开着收书页。

## AZW3 和 DRM

只打开**没有 DRM** 的 AZW3 / KF8。

- 文件头里的加密类型不是 0：界面显示「此文件受数字版权保护（DRM）」，并停住。
- 程序没有解密步骤，也不包含任何解除 Kindle 保护的代码。
- PalmDOC 压缩是公开的打包方式。KF8 的骨架和片段会拼回 HTML 再阅读。
- BookPush 默认把无 DRM 的 AZW3 转成 EPUB 再传。本机快路径能解析的书不启动 Calibre；解析不了时才调用官方 Calibre。没装 Calibre 且快路径失败时，这一本跳过，并说明去 https://calibre-ebook.com/ 安装，不要安装 DeDRM。
- 同一内容再传一次会用缓存，不再转换。缓存按文件内容哈希，多本同时转，CPU 有几核就开几个进程。
- 亚马逊的 AZW3 常常把 PalmDB 名字写成 `CR!` 开头，文件偏移 60 处仍是 `BOOKMOBI`。这不是 KFX，BookPush 会继续交给本机转换或官方 Calibre。真正的 KFX（没有 `BOOKMOBI`）仍会跳过。
- 文件若只是 OneDrive 的「联机可用」占位符，读不到正文。窗口会请你在资源管理器里选择「始终保留在此设备上」，等下载完成后再传。云端上的原文件不会被改动。
- Huff/CDIC 压缩和 KFX 会提示暂不支持，同样不会去绕过保护。
- 请改用你有权阅读的 EPUB 或 PDF，或使用 Amazon 自己的阅读器。不要为了打开受保护的书去找破解工具。

PDF 是固定版式，竖排和简转繁对它不起作用。中文排版在 EPUB 和可解析的 AZW3 里，观感对齐 Apple Books：中文首行缩进两个字、段距较紧、略松的字距，英文则用段距不缩进。阅读器可以使用系统字体、苹方、宋体、黑体、楷体、圆体，并回退到 Noto / 思源，避免正文被写成空白。字号、行距、边距、对齐（左对齐 / 两端 / 居中）、日间 / 羊皮纸 / 夜间可以分开调。竖排和简转繁也是两个开关。排版可以只留给这一本，也可以用到全部书籍，关掉 App 之后还在。目录和书签在阅读页里。进度记章节、页码和 0 到 1 的位置。读到最后一页，书架上是「已完成」；刚放上、还没打开是「未读」；打开之后是「阅读中」。也可以手动「标为读完」或「标为在读」。书架、传书页和阅读时的顶栏底栏是半透明毛玻璃，深色纸面上用深色材质。

## 能打开什么

| 内容 | 结果 |
| --- | --- |
| PDF | 能读。固定版式，不重排，竖排和简转繁对它不起作用。 |
| EPUB | 能读。滑动翻页、字号、行距、边距、对齐、日间 / 羊皮纸 / 夜间、亮度、竖排、简转繁、目录、书签、进度。 |
| 无 DRM 的 AZW3、KF8、MOBI、AZW、PRC | 能读。PalmDOC 按记录解压，KF8 拼回骨架和片段。 |
| Huff/CDIC、KFX | 中文提示暂不支持，不解码，也不解除保护。 |
| 有 DRM 的 AZW3 | 停在「受数字版权保护」。没有解密步骤。 |
| iOS | 15.1 及以上（React Native 0.88）。本地网络权限被拒绝后，要到「设置 → 隐私与安全性 → 本地网络」打开 BookShelf，搜索才会离开 0 台。 |
| 界面 | 手机和 BookPush 都是简体中文。 |

Expo Go 没有 TCP 和 Bonjour，不能用来验证传书。必须是上面的 IPA。

## 从安装到核对字形

1. 用上一节的 Actions 产物，经 Sideloadly 和免费 Apple ID 装进 iPhone。
2. 打开「设置 → 通用 → VPN 与设备管理」，信任刚才的描述文件。
3. 打开 BookShelf，进入「Wi-Fi 传书」，点允许「本地网络」。屏幕上会有 IP、端口和 4 位配对码。
4. 双击 `windows\BookPush\run.bat` 打开 BookPush（没有 py 启动器也会找 Python312）。同一 Wi-Fi，关掉 VPN，不要用访客网络。搜到手机就选中；列表是 0 台就把那三项填进「手工填写」。防火墙询问时允许 Python 访问专用网络（UDP 5353 和到手机端口的 TCP）。
5. 在 BookPush 里一次加入 `samples/` 的四本：`window.epub`、`vertical-traditional.epub`、`notes.pdf`、`window-free.azw3`。确认列表是 4 本，移出再加回一本，然后点一次「开始传书」。四本都成功后，待传队列应是空的，不用再手动移出。
6. 手机书架应显示这四本，标题在封面下面。点「搜索」再按书名、作者或文件名过滤。点排序芯片可以换成书名、作者、进度或最近读过。在读的那一本出现在「继续阅读」。长按封面，再点一次「移出」，可以拿走其中一本，其余还在。
7. 逐本打开。中文应是字形而不是方框：《窗下》能看到「雨下到后半夜」；打开「竖排」后直行仍有字。再打开「简转繁」，繁体样本能看到「窗下有雨」。英文 PDF 能看到 “Notes from a paper shelf”，不是空白页。无 DRM 的 AZW3 能看到「没有数字版权保护」。左右翻页后字形还在。书架上能按未读、阅读中、已完成筛选。
8. 若另有一本受保护的 AZW3，和别的书一起传：受保护的那本失败并写明「受数字版权保护」，仍留在队列里，标为「失败，可重试」。其余书送到后从队列消失。页面上没有破解提示。再点一次「开始传书」只会重试留下的那本。

### Windows 手测：AZW3 转 EPUB

在装了官方 Calibre 的 Windows 上再核对这些（Calibre 在 `C:\Program Files\Calibre2\ebook-convert.exe`，不必加入 PATH）：

1. 打开 BookPush。ebook-convert 一栏应自动出现 `C:\Program Files\Calibre2\ebook-convert.exe`。日志里写的是官方 Calibre，没有 DeDRM。
2. 准备三四本内容不同的无 DRM AZW3（只改文件名、字节完全一样会合成一次转换），再加一本 PDF 和一本 EPUB，一次加入队列。`samples\window-free.azw3` 可以当作其中一本。
3. 点一次「开始传书」。转换一行应显示「正在转换 N/M」，并且多本同时转，而不是等一本结束再转下一本。PDF / EPUB 不占转换进度，发送一行单独显示「正在发送」。转好的书不用等整批转换结束才开始上传。
4. 手机书架里那几本 AZW3 应以 EPUB 打开，能看到「没有数字版权保护」。PDF、EPUB 内容和以前一样。BookPush 队列里这些已送到的书应该消失。
5. 不改文件再传一次。日志应写「直接使用缓存的 EPUB」，转换几乎马上结束。
6. 把 ebook-convert 路径改成一个不存在的文件，再传一本本机无法解析的 AZW（或暂时改掉 Calibre 路径后传一本 Huff/CDIC 书）。这一本失败，中文说明里有 https://calibre-ebook.com/ ，并写明不要安装 DeDRM。队列里的其他书继续送到。
7. 把路径改回 `C:\Program Files\Calibre2\ebook-convert.exe`。准备一本有 DRM 的 AZW3 和一本正常 EPUB 一起传：受保护的那本失败并写明不会解除保护，标题变成「失败，可重试」，仍留在队列里。EPUB 送到后从队列消失。窗口里没有破解步骤。

电脑上可以先跑自动检查，再做上面的手测：

```bat
cd app
npm test
cd ..\windows\BookPush
python -m unittest discover -s tests -v
cd ..\..
node scripts\verify-reader-glyphs.mjs
```

最后一条需要本机的 Chrome，用来确认示例书的中文、英文和竖排真的画出来了，而不是空白页。没有 Chrome 时，前两条测试仍然检查解析出的正文。

竖排使用 CSS `writing-mode: vertical-rl`，和简转繁分开。简体正文只有在打开「简转繁」时才按 OpenCC 字词表显示成繁体，原文件不改。个别多义字可能选错，这是显示转换的限制。

翻页默认是卷页：背面用同一纸色，不是白纸。点一次大约 180 毫秒；连点右侧时这一下会在大约 110 毫秒内结束，多出来的页马上跳过去。也可以在排版里改成滑动或无。系统开了「减少动态效果」时改为大约 200 毫秒的淡入。菜单的出现和隐藏用 React Native 的 `Animated`（`useNativeDriver: true`），打开菜单不再改 WebView 的高度，所以正文不会跟着重排。书架用 `FlatList`，只挂屏幕里的几本，封面是大约 2:3 的三列。

## iPhone 16e 手测

16e 的逻辑分辨率是 390×844。竖屏安全区大约是顶部 59（灵动岛）和底部 34（Home Indicator），横屏时岛在一侧、底部大约 21。装上未签名 IPA 之后，用同一台手机看这几项：

1. **翻页**：点右侧要马上进入下一页，快速连点十几下，页码跟着走，不要卡住，也不要闪出一块白纸。卷页时能看到纸背和折痕阴影，颜色跟日间 / 羊皮纸 / 夜间一致。手指拖动时折痕跟着走。排版里把翻页改成「滑动」或「无」也生效。竖排时点左侧进入下一页。PDF、EPUB、无 DRM 的 AZW3 都能翻。有 DRM 的 AZW3 仍停在说明上，没有解密。
2. **字体**：系统、苹方、宋体、黑体、楷体、圆体都是字形，不是方框。字号、行距、边距、左对齐 / 两端 / 居中、日间 / 羊皮纸 / 夜间都生效。竖排和简转繁可以单独开关。点「仅本书」改字号后，另一本仍用「全部书籍」的字号；完全退出再打开，两套都还在。
3. **安全区**：顶部按钮贴在灵动岛下面，不要钻进岛里，也不要空出一大截。正文第一行在岛和状态栏下面。页码和底部菜单在 Home Indicator 上面。打开或关闭菜单时，正文不跳动、不重排。横屏时左右不被圆角和岛挡住。
4. **状态**：没打开过是「未读」，读过是「阅读中」，读到最后一页或点「标为读完」是「已完成」。书架可以按这三项筛选，并和原来的排序一起用。「标为在读」能把已完成改回去。
5. **书架**：一屏能看到的封面比以前多。标题在封面下面，进度是封面底边的一条细线。顶部只有书名、本数和「在读 / 全部 / 未读 / 读完」。搜索默认收起。上下滑仍然顺。

## 常用命令

```bat
cd app
npm install
npm test
npx tsc --noEmit
npx expo start --web --port 43123

cd ..\windows\BookPush
run.bat
python -m unittest discover -s tests -v
```

重新生成示例文件：

```bat
py -3 -m pip install pillow
py -3 samples\make_samples.py
```

## English

BookShelf is an offline Expo reader plus a Windows LAN pusher. Build an unsigned IPA with the GitHub Action `Unsigned iOS IPA`, then install it on Windows with Sideloadly and a free Apple ID. Refresh the signature about every 7 days. Do not buy the Apple Developer Program and do not ship to the App Store. AZW3 support is DRM-free only; encrypted files are refused and never decrypted. Page turns default to a paper-toned curl (slide or none are optional). Typography, iPhone 16e safe areas, reading status, and the `POST /v1/books` protocol are in `ARCHITECTURE.md`.
