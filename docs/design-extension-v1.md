# 浏览器扩展 v1 技术方案设计（B 站音频一键下载）

> 状态：**设计已定稿**（2026-09-06，经 grilling 设计树收敛）；实施待启动。实施偏差见文末「实施记录」。
> 前置：产品决策根见 `docs/roadmap.md` §1.9；本文件为实现级设计（接口、流程、边界、权限、验收）。
> 定位：与仓库桌面应用**并行**的独立产品线（同仓库 `extension/` 目录），v1 与桌面应用零耦合（不读取本机端口/数据）。

---

## 0. 决策汇总（设计树最终结论）

| 维度 | 决策 |
|------|------|
| 形态 | Chrome/Edge **MV3 扩展**（TypeScript），非油猴脚本（HttpOnly cookie 读不到，否决） |
| 场景 | 仅 `bilibili.com/video/BVxxx` 普通视频页；页面识别器独立模块，番剧/列表页 v2 |
| 交互 | 单 P：单击图标 → **后台立即下载**当前 P（不弹窗）；多 P：单击图标 → **popup 分 P 列表**（默认勾选当前播放 P，可勾选多个）；快捷键「下载当前 P」始终可用（可配置） |
| 产物 | **m4a 直存**（DASH 音频直链，不转码）；默认最高可用音质，无音质下拉；无任务历史 |
| 认证 | `chrome.cookies` 实时读 B 站 cookie（HttpOnly 可读，不落盘）；未登录 → 提示「未登录，将下载低音质」确认后继续 |
| 技术 | 后台 TS 实现 **WBI 签名**调 playurl API；下载直链带 B 站 Referer（防防盗链）→ blob → `chrome.downloads` 落盘；412 重试 2 次后退避报错 |
| 命名 | 单 P `视频标题.m4a`；多 P `视频标题-P1.m4a`…；非法字符清理；重名由下载器 `conflictAction: uniquify` 去重 |
| 工程 | 同仓库 `extension/`；v1 仅 vitest 覆盖纯函数（wbi/url/naming）；文档流程照走；其余手动验收 |
| 分发 | v1 本地加载/CRX；稳定后再上 Chrome Web Store |

**已明确不做（v1）**：番剧/影视页、列表页批量、任务历史/进度面板、MP3 转码（ffmpeg.wasm 太重）、音质下拉、桌面应用桥接、Firefox。

---

## 1. 目标与范围

### 1.1 目标
用户在 B 站视频页（已登录 Chrome）无需复制任何东西：单击扩展图标或按快捷键 → 音频（m4a，最高可用音质）直接落入浏览器下载目录。

### 1.2 范围（in-scope）
- 页面识别：BV 提取、标题、当前分 P（`?p=`）、分 P 列表（view API）
- 触发：单击图标（单 P 直下 / 多 P 弹列表）、命令快捷键
- 下载：WBI 签名的 playurl 请求 → 直链（带 Referer）→ blob → `chrome.downloads`
- 登录态：`chrome.cookies` 读 SESSDATA；未登录确认提示
- 命名与去重、412/网络错误通知

### 1.3 范围（out-scope，见 §12 v2 候选）
番剧/影视、合集/列表页、任务历史、音质选择、转码、桥接桌面应用、商店上架。

---

## 2. 总体架构

```
extension/
├─ manifest.json            MV3：权限最小化；无静态 default_popup（动态设置）
├─ package.json             独立工程（tsc 构建 + vitest 测试）
├─ tsconfig.json
├─ icons/                   16/32/48/128
├─ src/
│  ├─ background.ts         总控（service worker）：消息路由、缓存、分发、下载流水线
│  ├─ content.ts            页面识别器：上报 PAGE_INFO（bvid/title/p）
│  ├─ popup/
│  │  ├─ popup.html         分P 列表 UI / 未登录确认（?mode=confirm 复用）
│  │  └─ popup.ts
│  ├─ trigger.ts            DownloadTrigger 接口 + InstantTrigger/PopupTrigger 实现
│  └─ lib/
│     ├─ wbi.ts             纯函数：WBI 签名
│     ├─ url.ts             纯函数：BV/分P/页面识别
│     ├─ naming.ts          纯函数：文件名生成与非法字符清理
│     ├─ bilibili.ts        view / playurl 接口封装（依赖 wbi）
│     ├─ cookies.ts         chrome.cookies 读取与登录态判定
│     └─ download.ts        fetch(Referer)→blob→chrome.downloads 流水线
└─ tests/                   vitest：wbi / url / naming（仅纯函数）
```

**消息流**（内容脚本 → 后台 → 下载）：

```
[页面加载/切分P] content.ts --PAGE_INFO{bvid,title,p}--> background.ts
background → view API 取分P列表 → VideoPage{title, parts[], currentP}（按 tabId 缓存）
            → trigger.arm(page)：parts>1 ? setPopup(popup.html) : setPopup('')
[单击图标] 单P：action.onClicked → InstantTrigger.fire() → 下载流水线
           多P：弹出 popup → popup 打开时向 background 取 VideoPage → 勾选 → DOWNLOAD_PARTS
[快捷键]   commands.onCommand → 立即下载当前 P（不区分单/多P）
[未登录]   下载前判定 → popup.html?mode=confirm 小窗确认 → 确认后继续
```

**触发与执行分离**（对应需求「通过接口和具体代码实现这两个功能调用」）：

```ts
// trigger.ts —— 每个触发器负责一类页面的「装配」与「执行」，后台只做分发
interface DownloadTrigger {
  readonly name: string;
  matches(page: VideoPage): boolean;   // 单P → Instant / 多P → Popup
  arm(page: VideoPage): void;          // 页面进入时调用：决定单击图标的形态（setPopup）
  fire(page: VideoPage): void;         // 触发时调用：执行下载
}
```
- `InstantTrigger`：`arm` = `action.setPopup('')`（单击触发 onClicked）；`fire` = 直接下载当前 P。
- `PopupTrigger`：`arm` = `action.setPopup('popup.html')`；`fire` 由 popup 勾选后经 `DOWNLOAD_PARTS` 消息驱动。

> 一致性规则：同一时间只有一个触发器是「活动」的（按最后上报的页面）；非视频页（网页无法识别）→ `setPopup('')` 且 `onClicked` 显示通知「仅支持 bilibili.com/video/ 视频页」。

---

## 3. manifest.json（权限最小化）

```jsonc
{
  "manifest_version": 3,
  "name": "BiliAudio 一键下载",
  "version": "0.1.0",
  "permissions": ["cookies", "downloads", "notifications", "commands"],
  "host_permissions": [
    "https://*.bilibili.com/*",      // 页面 + view/playurl/nav 接口
    "https://*.bilivideo.com/*",     // CDN 直链（DASH）
    "https://*.hdslb.com/*"          // CDN 直链（备用域）
  ],
  "background": { "service_worker": "dist/background.js" },
  "action": {},                      // 不声明 default_popup，由 background 动态 setPopup
  "content_scripts": [{
    "matches": ["https://www.bilibili.com/video/*"],
    "js": ["dist/content.js"],
    "run_at": "document_idle"
  }],
  "commands": {
    "download-current": {
      "suggested_key": { "default": "Ctrl+Shift+D", "mac": "Command+Shift+D" },
      "description": "立即下载当前分P音频"
    }
  },
  "icons": { "16": "icons/16.png", "48": "icons/48.png", "128": "icons/128.png" }
}
```

权限说明：`cookies`（读 SESSDATA，只读不写）、`downloads`（落盘）、`notifications`（完成/失败通知）、`commands`（快捷键）。**不申请** `storage`/`tabs`/`scripting`/`activeTab`（v1 未登录每次提示，不做「不再提示」记忆；声明式 content_scripts 足够）。

---

## 4. 页面识别器（content.ts + lib/url.ts）

### 4.1 识别规则（纯函数 `url.ts`）
- 页面匹配：`location.host` ∈ {www.bilibili.com, bilibili.com} 且 `pathname` 匹配 `/video/BV([0-9A-Za-z]{10})`（与后端一致：BV 后必须 10 位）；
- 当前分 P：`URLSearchParams(location.search).get('p')`，缺失默认 `1`（B 站 SPA 切分 P 会写 `?p=n`，v1 以其为准；若后续发现页内切换不更新 URL，再精读页面状态）；
- 标题：`document.title`（去「_哔哩哔哩_bilibili」后缀）；完整标题以 view API 返回为准。

### 4.2 上报协议
```ts
// content.ts → background
interface PageInfoMsg { type: 'PAGE_INFO'; bvid: string; title: string; p: number; tabId: number }
// 触发时机：document_idle 上报一次；随后监听 popstate/History 变化（SPA 切分P）重新上报
```

---

## 5. 后台总控（background.ts）

### 5.1 消息与事件路由
| 事件 | 处理 |
|------|------|
| `PAGE_INFO` | view API 补全分P列表 → `VideoPage` 缓存（`tabId → page`，限 20 个最近 tab）→ `trigger.arm(page)` |
| `action.onClicked` | 取当前 tab 缓存：视频页 → `InstantTrigger.fire()`；非视频/无缓存 → 通知「仅支持视频页」 |
| `commands.onCommand('download-current')` | 取当前 tab 缓存 → 立即下载当前 P（走同一下载流水线） |
| `popup` 打开消息 `POPUP_READY` | 返回当前 tab 的 `VideoPage`（无则提示关闭） |
| `DOWNLOAD_PARTS{partIndexes[]}` | `PopupTrigger.fire()`：按选中索引串行下载 |
| `CONFIRM_LOGGED_OUT` | 未登录确认窗（`mode=confirm`）确认后继续当前下载 |

### 5.2 下载流水线（lib/download.ts + lib/bilibili.ts）
```
1. cookies.ts 判定登录态：chrome.cookies.get({url:'https://www.bilibili.com', name:'SESSDATA'})
   → 非空即视为已登录（v1 简化，不做 nav 校验；失效由错误码兜底）
2. 未登录且未确认 → 通知/弹出确认（见 §5.4）
3. playurl 请求（lib/bilibili.ts）：
   GET https://api.bilibili.com/x/player/playurl
   params: bvid, cid（分P 的 cid，来自 view API）, fnval=16（DASH）, fnver=0,
           fourk=1, platform=html5, wts + w_rid（WBI 签名，见 §6）
   fetch 带 credentials: 'include'（host_permissions 下自动携带 cookie）
4. 从 data.dash.audio[] 取 bandwidth 最高项（登录与否由服务端决定可给档位）
5. 直链 fetch：referrer 'https://www.bilibili.com' + referrerPolicy 'unsafe-url'
   （CDN 防盗链校验 Referer）；HTTP 412 → 重试（见 §8）
6. arrayBuffer → new Blob([buf], {type: mimeType}) → URL.createObjectURL
   → chrome.downloads.download({ url: objUrl, filename, conflictAction:'uniquify' })
   → revokeObjectURL
7. 成功/失败 → chrome.notifications
```

> 内存取舍：v1 整体缓冲为 Blob（音频 20~80MB，内存 ~2 倍文件大小，可接受）；不引入流式写盘/分片复杂度，换取实现简洁（§9 设计原则）。

---

## 6. WBI 签名（纯函数 lib/wbi.ts）

B 站 web 接口 2023-07 起强制 WBI 签名（playurl 等），算法：

```
1. img_key/sub_key：GET https://api.bilibili.com/x/web-interface/nav
   → data.wbi_img.img_url/sub_url 各取 basename（去扩展名）
   （nav 接口本身不要求签名；未登录也返回 wbi_img）
2. mixin_key：固定 32 位混淆表 mixinKeyEncTab（常量数组），
   以 (img_key + sub_key) 为索引重排取前 32 字符
3. 参数：业务参数 + wts=当前秒级时间戳；按 key 字典序排序；
   每个值 encodeURIComponent 后替换 !'()*（与官方一致）
4. 整体拼接 query + 末尾拼 mixin_key → md5 → w_rid（追加进 query）
```

- 纯函数签名：`wbiSign(params: Record<string,string>, imgKey: string, subKey: string): Record<string,string>`；
- img_key/sub_key 每次实时取（不做缓存，v1 简化——多P 串行下载沿用同一密钥，请求时取一次即可）；
- **测试**：实现时抓取真实接口固定对拍向量（`tests/wbi.test.ts`），验证排序/编码/md5 正确性。

---

## 7. popup（popup.html + popup.ts）

- **多P 模式**：打开即向 background 索取 `VideoPage`；渲染分 P 列表（`P1 name · mm:ss`），**默认勾选当前播放 P**；「下载勾选的 N 个分P」按钮 → `DOWNLOAD_PARTS`；下载过程 popup 可关闭（不阻塞）。
- **未登录确认模式**（`?mode=confirm`，供单 P 流以小窗打开）：
  文案「未登录，将下载低音质」+「继续 / 取消」；`CONFIRM_LOGGED_OUT` 确认后 background 继续原下载。
- 说明文案：「音频直存 m4a；视频页单击图标立即下载当前分P」。

---

## 8. 错误与边界

| 场景 | 处理 |
|------|------|
| HTTP 412（风控） | 退避重试至多 2 次（1s/3s）→ 仍失败：通知「触发风控，请稍后再试」；不做 412 冷却队列（roadmap §3 共识） |
| playurl code ≠ 0（-101 未登录 / -400 参数错 / -404 不存在） | 明确分类通知（auth/参数/不存在），不静默 |
| CDN 直链 fetch 失败（网络） | 有 `backupUrl` 则换备用链重试 1 次；失败按 network 通知 |
| 非视频页单击 | 通知「仅支持 bilibili.com/video/ 视频页」 |
| 同一视频重复触发 | 允许（无历史状态机）；重名由 `uniquify` 生成 `标题 (1).m4a` |
| content script 未注入（如扩展刚启用、页面已开） | `onClicked` 无缓存 → 提示刷新页面重试 |
| 大文件（Hi-Res/FLAC） | blob 内存峰值 ~2 倍文件大小；异常 OOM 时由 SW 崩溃自动重启，失败通知兜底 |
| 未登录 | 确认后继续（§5.4）；登录态以 SESSDATA 存在与否判定（简化，见 §5.2-1） |

---

## 9. 设计原则（简结）

1. **触发/执行分离**：`DownloadTrigger` 接口 + 两个实现，后台只做分发——新交互形态（如右键菜单）只需新增触发器；
2. **纯函数隔离**：wbi/url/naming 无副作用、可单测；网络与 Chrome API 全部收在 lib 的 IO 层；
3. **权限最小化**：只声明真实用到的权限；cookies 只读不写；
4. **不引入状态机**：无任务历史/队列/进度持久化，下载即发即忘（浏览器下载器自带历史），保证 v1 简洁可读。

---

## 10. 测试与门禁

- **v1 单测（vitest，`extension/tests/`，仅纯函数）**：
  - `wbi.test.ts`：mixin_key 重排、签名对拍向量、参数排序/编码；
  - `url.test.ts`：BV 正则命/反例、`?p=` 解析、页面匹配；
  - `naming.test.ts`：单/多P 命名、非法字符清理、超长截断；
- **门禁**：`cd extension && npm test`（vitest run）；不新增仓库级流水线（roadmap 候选「CI test job」若实施，同时挂接 `extension npm test`）；
- **构建**：`cd extension && npm run build`（tsc → dist/ + 拷贝 manifest/icons）；本地加载 `chrome://extensions` 开发者模式选择 `extension/`（v1 分发方案：本地加载/CRX）；
- 手动验收：`docs/manual-test-plan.md` §13（X01–X12）。

---

## 11. 验收清单（对照设计树）

- [ ] 单 P 视频页单击图标 → 立即自动下载 m4a，文件名 `标题.m4a`，完成有通知
- [ ] 多 P 视频页单击图标 → popup 列出全部分 P，默认勾选当前播放 P；勾选多个 → `标题-P1.m4a`、`标题-P2.m4a`…
- [ ] 快捷键（默认 Ctrl/Command+Shift+D）→ 立即下载当前 P（多 P 页面同样），且可在 `chrome://extensions/shortcuts` 改绑
- [ ] 未登录：单 P 流弹确认小窗、多 P 流 popup 内提示；确认后照常下载
- [ ] 重名文件 → `标题 (1).m4a`（uniquify）；标题含 `\/:*?"<>|` 等 → 已清理
- [ ] 收到 HTTP 412 → 重试 2 次后明确失败通知，扩展不崩溃
- [ ] 非视频页单击 → 「仅支持视频页」通知
- [ ] 已登录音质高于未登录（下载文件码率可比对）
- [ ] `npm test` 全绿（wbi/url/naming 纯函数）

---

## 12. v2 候选（按优先级）

1. 番剧/影视页（ep）与 B 站音频区（au）——页面识别器新增匹配；
2. 列表页批量（收藏夹/合集）：批量 playurl + 串行下载；
3. 桥接桌面应用（「发送到桌面应用下载」按钮）：复用 yt-dlp/MP3 转码/任务历史——需后端 CORS 加 `chrome-extension://`、打包版端口/token 发现机制；
4. 音质选择下拉（含 Hi-Res FLAC 显式列出）与「不再提示未登录」；
5. 上架 Chrome Web Store（开发者账号 $5、隐私说明、商店审核流程）。

---

## 实施记录（2026-09-06，代码合入后回填）

- **工程**：`npm install` 遇 `~/.npm` root 权限遗留（EPERM）→ 按 PROJECT_SUMMARY §7 约定改用项目内缓存 `--cache ./extension/npm-cache`（安装完成后已删除，不提交）；
- **md5**：无外部依赖手写（RFC 1321），单测与 node:crypto 对拍（含 1000 字符多块输入）。实施中修复两处：填充长度 `ceil64(len+9)`（原 `ceil64(len+8)` 在 len=56 边界缺 1 字节）；摘要按 32 位寄存器小端字节序逐字节输出；
- **wbiSign 契约**：返回**编码后**的值（含 wts/w_rid），调用方直接拼 query 即可（设计文档未明确返回值编码形态，此为实施细化）；
- **BV 正则**：`^\/video\/(BV[0-9A-Za-z]{10})(?:\/|$)` 锚定结尾防 11 位误匹配（后端为正则整串匹配，语义一致）；
- **content 精简**：仅上报 `url`，BV/`?p=` 由背景侧解析（标题以 view API 为准，不再传 document.title）；
- **未登录单P 确认**：`chrome.windows.create` 小窗加载 `popup.html?mode=confirm`，确认/取消经消息驱动挂起的下载（与 §5.4 一致）；
- **快捷键**：默认 Ctrl/Command+Shift+D，「下载当前 P」始终立即执行（多P 页面也直下，不进 popup）；
- **手动验收**：X01–X12 未执行（需真机加载扩展，见 `manual-test-plan.md` §11）。