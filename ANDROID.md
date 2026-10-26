# Android 分发方案

本文档记录把同一份构建产物分发到 Android 的可选方案与实施步骤。仓库当前不包含 Android 工程代码，以下内容为方案说明。

## 现状

| 事实 | 位置 | 对 Android 分发的影响 |
|---|---|---|
| 静态站点，运行时不发起网络请求 | `README.md`、`scripts/size-check.mjs` | 产物可直接内嵌安装包，不需要后端 |
| 数据随包发布，`data` chunk 约 248 KB gzip | `src/engine/data.ts`、`vite.config.ts` | 数据以静态资源形式打进安装包 |
| 产物使用相对路径（`base: './'`） | `vite.config.ts` | 可在 `file://`、WebView 与子路径下运行 |
| 支持产出单个 HTML 文件（约 1.57 MB，gzip 约 368 KB） | `npm run build:single` | 可作为极简分发形态 |
| 已有 manifest、Service Worker 与图标 | `public/manifest.webmanifest`、`public/sw.js`、`public/icon-*.png` | Chrome 支持「添加到主屏幕」直接安装 |
| 分享与文件下载基于 Web API | `src/lib/share.ts`、`src/App.tsx` | 这是唯一需要按平台分流的区域 |

## 方案对比

| 方案 | 改动量 | 更新方式 | 离线 | 原生能力 | 前置条件 |
|---|---|---|---|---|---|
| PWA 直接安装 | 无 | 部署即更新 | 首次联网后可离线 | 弱（Web Share API） | HTTPS 托管 |
| TWA（Bubblewrap） | 低 | 网页部署后应用自动更新，无需重新发版 | 首次需要联网 | 弱 | HTTPS 托管、Digital Asset Links、打包与签名 |
| Capacitor | 中 | 修改代码后 `cap sync` 重新打包发版 | 安装后即可离线 | 强（系统分享、文件系统） | Android 工具链（JDK、Gradle、Android Studio）与签名 |

跨平台原生重写（React Native、Jetpack Compose）不在本方案范围内：canvas 分享卡片、二维码生成与词典装配都需要重新实现，并且需要长期维护两套代码。

选择依据：

- 只需要在 Android 上以应用形式使用：先发布 PWA，无额外改动。
- 需要网页改动即时生效、不重新发版：TWA，代价是首次联网与对托管站点的依赖。
- 需要完全离线、商店分发与原生分享：Capacitor，本文推荐的实施路径。

两条渠道可以并行：同一份 `dist` 既作为 PWA 提供免安装与即时更新，也打进 Capacitor 用于商店分发与原生能力。

## 推荐方案：Capacitor

架构上增加一层 `src/platform/`，网页与 Android 共用界面与引擎，只在底层分流平台相关调用。

### 需要适配的调用点

| 位置 | 网页行为 | Android 行为 | 需要的适配 |
|---|---|---|---|
| `src/lib/pwa.ts` 的 `usePwa` | 注册 Service Worker | 跳过注册 | `isNative()` 分支 |
| `src/App.tsx` 的 `doShare` | 二维码指向 `location.origin` | 用系统分享面板发送图片，二维码指向线上正式地址 | `shareImage()`、`canonicalUrl()` |
| `src/App.tsx` 的 `doCopyLink` | 复制当前地址 | 复制线上正式地址 | `canonicalUrl()` |
| `src/lib/share.ts` 的 `downloadBlob` | `<a download>` | `@capacitor/filesystem` 写入文档目录，再用 `@capacitor/share` 分享 | `saveFile()` |
| `src/App.tsx` 的 `doPrint` | `window.print()` | WebView 打印能力受限，改为导出名单长图并分享 | 复用 `shareImage()` |

### 平台层接口（`src/platform/index.ts`）

- `isNative(): boolean`
- `canonicalUrl(): string`：线上正式地址，Android 下的二维码与复制链接使用它
- `saveFile(blob: Blob, filename: string): Promise<void>`
- `shareImage(blob: Blob, title: string): Promise<void>`：Android 走系统分享面板，网页回退为下载
- `registerSW(): void`：仅在网页环境注册 Service Worker

`src/engine/`、`src/store/`、`src/styles.css` 与大部分 `src/ui/` 不需要改动。

## 构建步骤

```bash
$ npm i -D @capacitor/cli
$ npm i @capacitor/core @capacitor/android @capacitor/share @capacitor/filesystem

$ npx cap init "取名" com.example.naming --web-dir=dist
$ npx cap add android

$ npx @capacitor/assets generate   # 由 public/icon-512.png 生成整套图标与启动页
```

`appId` 上架后不可更改，需要在初始化时确定。`capacitor.config.ts` 关键项：

| 配置 | 值 |
|---|---|
| `appId` | 例如 `com.example.naming` |
| `appName` | 取名 |
| `webDir` | `dist` |
| `backgroundColor`、`android.allowMixedContent` | 按需设置，混合内容保持关闭 |

`package.json` 脚本：

```json
{
  "android:sync": "npm run build && npx cap sync android",
  "android:apk": "cd android && ./gradlew assembleDebug",
  "android:aab": "cd android && ./gradlew bundleRelease"
}
```

签名：生成 keystore 并妥善备份（丢失后无法更新已上架应用），参数写入 `android/keystore.properties`，在 `android/app/build.gradle` 中引用。上架产物为 `.aab`。

## 发布与迭代

- 上架流程：签名 → 生成 `.aab` → Play 控制台内部测试轨道 → 封闭测试 → 正式发布。
- 合规：应用不收集数据，"Data safety" 填报为不收集，同时仍需提供一个隐私政策链接。
- 版本：每次发版递增 `versionCode`，更新 `versionName`。
- 更新方式：Capacitor 没有内置热更新，纯 JavaScript 改动也需要重新打包上传。需要即时生效时，使用 PWA 渠道，或引入 `@capawesome/capacitor-live-update`。
- 渠道分工：PWA 负责免安装与即时更新，Capacitor 负责商店分发、完全离线与原生分享。

## 待确认事项

1. 是否上架 Google Play。上架需要开发者账号、签名 keystore 与隐私政策。
2. 迭代优先级是即时更新（倾向 PWA / TWA）还是完全离线与原生体验（倾向 Capacitor）。
3. 是否已有稳定的 HTTPS 托管域名。PWA 与 TWA 需要，Capacitor 不需要。
4. 是否需要原生分享与保存图片到相册。需要则选择 Capacitor。
5. `appId` 的最终取值。
