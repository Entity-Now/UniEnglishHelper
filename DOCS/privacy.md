# UniEnglishHelper 隐私权规范与权限说明

> 本文档供 **Chrome Web Store / Microsoft Edge Add-ons** 的「隐私权规范 / Privacy practices」表单填写，以及对外隐私政策页面使用。  
> 产品名称：`UniEnglishHelper`  
> 版本参考：`package.json` / 当前发布 tag  
> 许可证：GPL-3.0-or-later  

---

## 一、单一用途说明（Single purpose）

**单一用途（中文，可粘贴）：**

> UniEnglishHelper 仅用于帮助用户通过网页视频学习英语：提供画中画（Document PiP）双语字幕、点词释义、句子录音收藏、生词本与间隔复习、文本/字幕翻译，以及可选的文本朗读（TTS）。扩展不会将能力用于广告投放、无关数据买卖或与英语视频学习无关的功能。

**Single purpose (English, for CWS form):**

> UniEnglishHelper has a single purpose: immersive English learning from web videos. It provides Document Picture-in-Picture bilingual subtitles, click-to-explain words, sentence audio capture for vocabulary, a personal dictionary with spaced review, translation of subtitles/text, and optional text-to-speech. It does not provide unrelated features such as advertising, browsing analytics for sale, or general-purpose page rewriting.

---

## 二、远程代码（Remote code）

### 结论

**本扩展不使用远程代码（Does not use remote code）。**

- 所有可执行逻辑打包在扩展包内（`dist/` / CWS zip）。  
- **不**通过 `eval`、`new Function`、远程 `<script>` 注入、或从 CDN 动态加载并执行未打包的 JavaScript。  
- Content script / service worker / offscreen 仅运行扩展自带脚本。  
- 网络请求仅用于**数据交换**（翻译结果、TTS 音频、用户配置的 LLM API），**不**用于下载并执行远程脚本。

### 需使用远程代码的理由（若表单强制填写且选项为 “No”）

在 CWS 隐私权规范中应选择：

> **No, I am not using remote code.**

若表单要求文字说明，可填：

**中文：**

> 本扩展不使用远程代码。全部功能代码随扩展包分发。网络请求仅向翻译服务、TTS 服务或用户自行配置的 OpenAI 兼容 API 传输文本/音频数据，不会下载或执行远程 JavaScript。

**English：**

> This extension does not use remote code. All executable code is bundled with the extension package. Network requests only exchange data with translation services, optional TTS endpoints, or a user-configured OpenAI-compatible API. No remote JavaScript is downloaded or executed.

---

## 三、主机权限（Host permissions）

### Manifest 声明

- `host_permissions`: `http://*/*`, `https://*/*`  
- Content scripts 匹配：`http://*/*`, `https://*/*`  
- 另有可选/显式服务域名（翻译、Edge TTS 等）

### 需使用主机权限的理由

**中文（可粘贴）：**

> 本扩展在用户浏览的视频网页上提供英语学习能力，因此需要访问用户主动打开的 http/https 页面，以便：  
> 1）注入内容脚本以识别 HTML5 / YouTube 等视频、显示字幕与划词工具栏；  
> 2）打开 Document PiP 并同步媒体时间轴；  
> 3）在用户启用时请求第三方翻译、TTS 及用户配置的 AI 接口（跨域请求由扩展后台发起）。  
> 扩展默认支持「按站点」控制启用，用户可在设置中限制作用站点。我们不会将主机权限用于与英语视频学习无关的抓取或监控。

**English：**

> Host permissions for http/https pages are required so the extension can run on video sites the user visits: inject content scripts to detect video players, render bilingual subtitles and selection tools, open Document PiP with a synchronized media timeline, and (when enabled) call translation/TTS/AI endpoints from the extension background. Site-level enable/disable is available in settings. Host access is not used for unrelated crawling or surveillance.

---

## 四、各权限逐项说明

以下内容对应 CWS「隐私权规范」中 **permission justification** 字段（建议用英文粘贴；中文版供参考）。

### 1. `activeTab`

**中文：**  
仅在用户通过扩展图标/弹窗与当前标签交互时，临时获取当前标签能力，用于打开画中画、启动句子录音（tabCapture 流程）等用户手势触发的操作，避免在无交互时过度访问标签。

**English：**  
Used to access the active tab only when the user invokes the extension (popup / action), e.g. to open Document PiP or start sentence audio capture on the current video tab after an explicit user gesture.

---

### 2. `tabs`

**中文：**  
用于查询与管理学习相关标签页：获取当前视频页 URL/标题作为生词来源信息、向指定 tab 发送消息（打开 PiP、同步采集状态）、在用户操作下创建/聚焦选项页或引导页。不用于后台批量扫描用户全部浏览历史。

**English：**  
Used to query the current learning tab (URL/title for dictionary source metadata), send runtime messages to that tab (open PiP, capture state), and open the options/onboarding pages when the user requests them. Not used to bulk-scan browsing history.

---

### 3. `scripting`

**中文：**  
在用户启用的页面上注入或执行扩展自带的内容脚本逻辑（视频适配、字幕层、YouTube 辅助脚本），以实现 PiP、字幕与点词功能。仅注入扩展包内脚本，不注入远程代码。

**English：**  
Required to inject the extension’s own content scripts / helpers on pages where learning features run (video adapters, subtitle overlay, YouTube helper). Only packaged scripts are injected; no remote code is injected.

---

### 4. `storage`

**中文：**  
使用 `chrome.storage` 保存用户设置（语言、翻译引擎、TTS、站点规则、AI 提供商配置等）与扩展运行元数据。用户可选填写的 API Key 仅保存在本地扩展存储中，不上传至我们的服务器（本扩展无自有账号后端）。

**English：**  
Stores user preferences (languages, translation engine, TTS, site rules, AI provider settings) and runtime metadata via `chrome.storage`. Optional API keys are stored locally in the extension and are not uploaded to a UniEnglishHelper backend (there is none).

---

### 5. `unlimitedStorage`

**中文：**  
生词本、句子音频片段（WAV/MP3）、翻译/TTS 缓存使用 IndexedDB 等本地存储；音频与词库可能超过默认配额，需要 `unlimitedStorage` 以避免用户大量收藏后写入失败。数据默认保留在用户设备本地。

**English：**  
The personal dictionary, sentence audio clips, and translation/TTS caches can exceed the default storage quota. `unlimitedStorage` allows reliable local persistence of learning data on the user’s device.

---

### 6. `offscreen`

**中文：**  
Chrome MV3 下在 Offscreen Document 中建立音频处理图：接收 tab 音频流、环缓冲 PCM、导出句子级 WAV，并保证标签页声音正常回放（loopback）。该权限仅用于句子录音与音频处理，不用于隐藏后台页面跟踪。

**English：**  
Creates an Offscreen Document to process tab audio (Web Audio graph, PCM ring buffer, export sentence-level WAV) while loopback keeps tab playback audible. Used only for optional sentence capture / audio processing, not for hidden tracking.

---

### 7. `tabCapture`

**中文：**  
在用户明确点击「开始采集/录音」后，捕获当前标签页音频流，以便将当前字幕句对应的原声音频保存到本地生词/句子库，供跟读与复习。不会在未授权或无用户操作时静默录音，也不会将录音上传至我们的服务器。

**English：**  
After the user explicitly starts capture, records the current tab’s audio so the learner can save the original audio for the current subtitle sentence into the local dictionary. Capture is user-initiated and audio stays on-device unless the user exports it.

---

### 8. Host permissions（再次强调，表单单独项）

见上文「三、主机权限」。

---

## 五、数据使用与开发者计划政策确认

### 5.1 收集哪些用户数据？

| 数据类型 | 是否收集 | 存储位置 | 是否离开设备 |
|----------|----------|----------|--------------|
| 扩展设置、站点规则 | 是（本地） | `chrome.storage.local` | 否（除非用户自行备份/导出） |
| 生词本、复习进度 | 是（本地） | IndexedDB | 否（导出 JSON 时由用户主动操作） |
| 句子音频片段 | 是（可选，本地） | IndexedDB | 否 |
| 翻译/TTS 缓存 | 是（本地） | IndexedDB | 否 |
| 用户配置的 AI API Key | 可选，本地 | `chrome.storage.local` | 调用用户指定的 LLM 提供商时按该提供商政策传输 |
| 当前页面 URL/标题 | 用于生词来源标注 | 随词条本地保存 | 若用户启用云端翻译/AI，可能将**选中文本/字幕文本**发往第三方 |
| 浏览历史、密码、支付信息 | **否** | — | — |
| 个人身份信息（姓名、邮箱等） | **不主动收集** | — | — |

### 5.2 数据用途（与单一用途一致）

- 提供双语字幕、点词讲解、翻译与 TTS；  
- 保存生词与句子音频以便复习；  
- 记住用户设置。  

**不用于：** 出售数据、跨站点广告画像、与学习无关的分析产品。

### 5.3 第三方服务（用户可选）

启用相应功能时，相关**文本或音频请求**可能发往：

| 服务 | 典型用途 | 触发条件 |
|------|----------|----------|
| 用户配置的 OpenAI 兼容 API | 翻译、单词讲解、AI 复习、自定义 Skill | 用户填写 API Key / Base URL |
| Google / Microsoft / MyMemory 等免费 MT | 文本或字幕机器翻译 | 用户选择免费翻译通道 |
| Microsoft Edge 朗读相关端点 | Edge TTS 语音合成 | 用户启用 Edge TTS |

第三方的数据处理遵循**其各自隐私政策**；本扩展开发者不运营中间服务器代收这些数据。

### 5.4 远程代码与安全

- 不执行远程代码；  
- 不出售用户数据；  
- 遵循 Chrome Web Store [Developer Program Policies](https://developer.chrome.com/docs/webstore/program-policies/) 与 [User Data Privacy](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq/) 要求。

### 5.5 表单确认语（Data usage certification）

在 CWS「隐私权规范」中勾选确认时，可依据：

**English certification summary：**

> I certify that UniEnglishHelper’s data usage complies with the Chrome Web Store Developer Program Policies. The extension’s single purpose is English video learning. User dictionary, settings, and optional audio clips are stored locally. Optional translation, TTS, and AI features send only the content needed for that feature to third-party or user-configured endpoints when the user enables them. We do not sell personal data or use remote code.

**中文确认摘要：**

> 本人确认 UniEnglishHelper 的数据使用符合 Chrome 网上应用店开发者计划政策。扩展单一用途为英语视频学习；生词本、设置与可选音频片段保存在用户本地。翻译、TTS、AI 等可选功能仅在用户启用时，将完成该功能所必需的内容发送至第三方或用户自行配置的接口。我们不出售个人数据，不使用远程代码。

---

## 六、CWS「隐私权规范」标签页填写速查

| 表单项 | 建议填写 |
|--------|----------|
| 单一用途 | 见 **§一** 英文段落 |
| 远程代码 | **No** + §二 英文说明 |
| 主机权限理由 | §三 English |
| `activeTab` | §四.1 English |
| `offscreen` | §四.6 English |
| `scripting` | §四.3 English |
| `storage` | §四.4 English |
| `tabCapture` | §四.7 English |
| `tabs` | §四.2 English |
| `unlimitedStorage` | §四.5 English |
| 数据使用合规确认 | 勾选确认 + §五.5 |
| 隐私权政策 URL | 将本仓库 `DOCS/privacy.md` 发布为公开页面后填入该 URL（GitHub raw / Pages / 官网） |

---

## 七、对外隐私政策全文（可发布为网页）

### Privacy Policy — UniEnglishHelper

**Last updated:** 2026-07-12  

UniEnglishHelper (“the Extension”) is an open-source browser extension (GPL-3.0-or-later) that helps users learn English from web videos.

#### What we store locally

- Preferences and feature settings  
- Vocabulary / sentence entries and review state  
- Optional sentence audio clips and caches  
- Optional AI provider keys entered by the user  

These items are stored on the user’s device via Chrome extension storage and IndexedDB.

#### What may leave the device

Only when the user enables a network feature:

- **Translation:** selected or subtitle text may be sent to the chosen translation provider  
- **TTS:** text may be sent to the chosen speech synthesis service  
- **AI explain / study skills:** text and context may be sent to the user-configured OpenAI-compatible endpoint  

We do not operate a UniEnglishHelper account server that receives your dictionary by default.

#### Permissions overview

Permissions (`storage`, `unlimitedStorage`, `activeTab`, `tabs`, `scripting`, `offscreen`, `tabCapture`, and host access) exist solely to implement video learning features described above. See the permission justifications in this document.

#### Contact

For privacy questions, open an issue on the project repository or contact the maintainer listed on the store listing.

#### Changes

Material changes to this policy will be reflected in this file and, when required, in the store listing privacy fields.

---

## 八、中文对外摘要（可选）

**UniEnglishHelper 隐私摘要**

UniEnglishHelper 用于在网页视频中学习英语。生词、设置与可选句子录音保存在您的浏览器本地。仅当您开启翻译、朗读或 AI 功能时，相关文本才会发送到您选择的服务商或您自己配置的 API。我们不出售您的数据，不执行远程代码，不将权限用于与学习无关的目的。

---

## 九、维护说明

- 若增删 Manifest 权限，请同步更新 **§四** 与商店表单。  
- 若增加自有后端或分析 SDK，必须更新 **§五** 并重新提交商店审核。  
- 权限理由应与实际代码路径一致（PiP、采集、字幕、词典、TTS/AI）。
