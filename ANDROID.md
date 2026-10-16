# 网页版 + 安卓版：打包与迭代方案

面向决策。结论先行，再给依据、改动点与落地步骤。

## TL;DR

- 现有代码是**纯静态、完全离线、已带 PWA**（manifest + SW + 图标）——安卓版**不需要重写**。
- 三条路：**PWA 直接安装**（0 改动）、**TWA 套壳**（低改动）、**Capacitor**（中等改动，能力最全）。
- **推荐 Capacitor**：把 `dist` 打进 APK，不依赖服务器，天生离线，可用系统分享面板——最贴合本项目「运行时零网络」的定位。
- 网页版与安卓版**共用同一份 `dist`**：同一仓库、同一套引擎/UI，只在最底层用平台层分流少数几个网页专属调用。

## 1. 现状盘点（决定了"为什么能快"）

| 事实 | 出处 | 对安卓的意义 |
|---|---|---|
| 静态站点，运行时零网络请求 | `README.md` / `size-check.mjs` | 可直接内嵌 APK，无需后端 |
| 数据随包发布（`data` chunk ≈ 225 KB gz） | `src/engine/data.ts` | 离线数据的天然形态就是"内置资源" |
| `base: './'` 相对路径产物 | `vite.config.ts` | `file://` / WebView / 子路径都能跑 |
| 已能出单文件 HTML（1.39 MB） | `npm run build:single` | 备选的极简分发形态 |
| PWA 三件套齐全 | `public/manifest.webmanifest`、`public/sw.js`、`public/icon-*.png` | Chrome 可直接"添加到主屏幕"当 App 用 |
| 分享/下载走 Web API | `src/lib/share.ts`、`src/App.tsx` | 这是唯一需要按平台分流的区域 |

## 2. 三条路对比

| 方案 | 工作量 | 更新方式 | 离线 | 原生能力 | 前置条件 |
|---|---|---|---|---|---|
| **PWA 直接安装** | 0 | 部署即更新 | ✅（首次联网后） | 弱（Web Share） | 一个 HTTPS 托管 |
| **TWA / Bubblewrap** | 低 | 网页一部署，App 自动更新，**不重发版** | 首次需联网 | 弱 | HTTPS 托管 + Digital Asset Links + 打包签名 |
| **Capacitor** | 中 | 改 JS 后 `cap sync` 重打包发版 | ✅ 装完即离线 | 强（系统分享/存文件） | Android 工具链（JDK/Gradle/Studio）+ 签名 |

**排除项**：React Native / Compose 全重写——canvas 分享、二维码、词典装配都要重做，且破坏"一套代码"，不划算。

### 选择建议
- 只要"能在安卓上用、像个 App" → **先发 PWA**，零成本，Chrome 装桌面即可。
- 最看重"改网页即时生效、不重发版" → **TWA**（代价：首次联网 + 托管依赖，与离线调性略冲突）。
- 最看重"真离线 + 商店上架 + 原生分享" → **Capacitor**（推荐）。

> 最优组合：**同一份 `dist` 既当 PWA（免安装、即时更新）又打进 Capacitor（商店 + 真离线 + 原生分享）**，两条渠道互补。

## 3. Capacitor 方案：需要改的代码（很少）

架构：加一层 `src/platform/`，网页与安卓共用 UI，只在底层分流。

| 位置 | 网页行为 | 安卓行为 | 需要的适配 |
|---|---|---|---|
| `src/lib/pwa.ts`（`usePwa`） | 注册 SW | 跳过（WebView 不需要/不支持 SW） | `isNative()` 分支 |
| `src/App.tsx` `doShare` | 二维码指向 `location.origin` | 用系统分享面板发图；二维码指向**正式托管网址** | `shareImage()` + `canonicalUrl()` |
| `src/App.tsx` `doCopyLink` | 复制地址栏 URL | 复制 `canonicalUrl()`（本地地址无意义） | `canonicalUrl()` |
| `src/lib/share.ts` `downloadBlob` | `<a download>` | `@capacitor/filesystem` 存到文档目录 + `@capacitor/share` 分享 | `saveFile()` |
| `src/App.tsx` `doPrint` | `window.print()` | WebView 打印受限 → 改为分享名单长图 | 复用 `shareImage()` |

新增平台层建议接口（`src/platform/index.ts`）：
- `isNative(): boolean`
- `canonicalUrl(): string` — 正式网页地址（native 下二维码/复制链接用它）
- `saveFile(blob, filename): Promise<void>`
- `shareImage(blob, title): Promise<void>` — native 走系统面板，web 退回下载
- `registerSW(): void` — web 才注册

**不动**：`engine/`（纯函数引擎）、`store/`（持久化/导入导出/URL 编解码）、`Design/tailwind`、大部分 `ui/`。

## 4. 落地步骤（Capacitor）

```bash
# 依赖
npm i -D @capacitor/cli
npm i @capacitor/core @capacitor/android @capacitor/share @capacitor/filesystem

# 初始化（appId 定了难改，一次到位；webDir 指向 vite 产物）
npx cap init "取名" com.<你的域名反写>.naming --web-dir=dist
npx cap add android

# 图标/启动页：用现有 public/icon-512.png 生成整套 mipmap
npx @capacitor/assets generate
```

`capacitor.config.ts` 关键项：
- `appId`（如 `com.example.naming`）
- `appName`：取名
- `webDir: 'dist'`
- `backgroundColor` / `android.allowMixedContent: false`

`package.json` 脚本建议：
```json
"android:sync": "npm run build && npx cap sync android",
"android:apk": "cd android && ./gradlew assembleDebug",
"android:aab": "cd android && ./gradlew bundleRelease"
```

签名：生成 keystore（**务必备份，丢了无法更新**），写 `android/keystore.properties`，配置 `android/app/build.gradle`。产物 `.aab` 用于上架。

## 5. 发布与迭代

- **上架**：签名 keystore → 出 `.aab` → Play 控制台**内部测试轨** → 封闭测试 → 正式。
- **合规**：应用不收集任何数据 → "Data safety" 勾不收集 + 提供一条隐私政策链接（无采集也要有）。
- **版本**：每次发版 `versionCode` +1、`versionName` 更新。
- **日常迭代**：
  - Capacitor **无内置热更**；纯 JS 改动也需重新出包上传。
  - 想要"改了即时生效"：或加 `@capawesome/capacitor-live-update`，或**继续用 PWA 这条即时通道**，native 只作商店分发。
- **渠道策略**：`dist` 同一份，PWA 负责即时更新与免安装，Capacitor 负责商店 + 真离线 + 原生分享。

## 6. 决策清单（拍板用）

1. 是否上 Google Play？（是 → 需要签名 keystore + 隐私政策 + 开发者账号）
2. 迭代优先级：**即时更新（倾向 TWA / PWA）** 还是 **真离线 + 原生体验（倾向 Capacitor）**？
3. 是否已有 HTTPS 托管域名？（TWA 必需；PWA 必需；Capacitor 不需要）
4. 需要原生分享/存图到相册吗？（需要 → Capacitor）
5. `appId` 用什么？（一旦上架不可改）
