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

浏览器打开 `http://127.0.0.1:43123`。点「放入示例」，打开《窗下》，试翻页、字号、苹方/宋体/楷体，以及「竖排繁体」。

这一步只是界面。浏览器**不能**代替手机收书：网页里没有局域网监听。示例书是仓库里的原创短篇，不是出版图书。

`npm test` 会检查 EPUB 的 OPF、AZW3 的 DRM 拒绝、简转繁和上传解析。

## 2. 在 Windows 上运行传书工具

安装 Python 3.11 或更新版本，安装时勾选 **tcl/tk**（python.org 的安装包默认带）。

```bat
cd windows\BookPush
py -3 -m pip install -r requirements.txt
py -3 -m bookpush
```

也可以双击 `run.bat`。

窗口里可以搜索手机、手填 IP 和端口、填写手机上的 4 位配对码、选择 pdf/epub/azw3，然后发送。进度条按文件字节前进。连不上时，状态栏会提示检查前台、配对码和防火墙。

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

## 6. 把书传到手机

1. 手机打开 BookShelf，停在「Wi-Fi 传书」，看到 IP、端口和 4 位配对码。
2. 电脑打开 BookPush，搜索设备；搜不到就把手填 IP 和端口（默认 27780）。
3. 输入配对码，选择书籍，点「开始传书」。
4. 回到书架就能看到新书。之后可以关 Wi-Fi，阅读不需要网络。

配对码只是避免同网里别人随手上传。传输没有加密。不要在咖啡馆的公共 Wi-Fi 上开着收书页。

## AZW3 和 DRM

只打开**没有 DRM** 的 AZW3 / KF8。

- 文件头里的加密类型不是 0：界面显示「此文件受数字版权保护（DRM）」，并停住。
- 程序没有解密步骤，也不包含任何解除 Kindle 保护的代码。
- PalmDOC 压缩是公开的打包方式，可以解压成 HTML 再阅读。
- Huff/CDIC 压缩会提示暂不支持，同样不会去绕过保护。
- 请改用你有权阅读的 EPUB 或 PDF。不要为了打开受保护的书去找破解工具。

PDF 是固定版式，竖排和简转繁对它不起作用。中文排版在 EPUB 和可解析的 AZW3 里。

竖排繁体使用 CSS `writing-mode: vertical-rl`。简体正文会按 OpenCC 字词表显示成繁体，原文件不改。个别多义字可能选错，这是显示转换的限制。

翻页是 WebView 里的透视折页（大约 62 度再揭开下一页），用来接近翻书，不是 UIKit 的 `pageCurl`。React Native 里没有那套转场。

## 常用命令

```bat
cd app
npm install
npm test
npx tsc --noEmit
npx expo start --web --port 43123

cd ..\windows\BookPush
py -3 -m pip install -r requirements.txt
py -3 -m bookpush
py -3 -m unittest discover -s tests -v
```

重新生成示例文件：

```bat
py -3 -m pip install pillow
py -3 samples\make_samples.py
```

## English

BookShelf is an offline Expo reader plus a Windows LAN pusher. Build an unsigned IPA with the GitHub Action `Unsigned iOS IPA`, then install it on Windows with Sideloadly and a free Apple ID. Refresh the signature about every 7 days. Do not buy the Apple Developer Program and do not ship to the App Store. AZW3 support is DRM-free only; encrypted files are refused and never decrypted. Details of the page fold, OpenCC vertical text, and the `POST /v1/books` protocol are in `ARCHITECTURE.md`.
