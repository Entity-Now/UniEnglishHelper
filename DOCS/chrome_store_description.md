# Chrome Web Store Listing Description | Chrome 应用商店描述文档

本文档包含用于提交至 **Chrome Web Store (开发者控制台)** 与 **Microsoft Edge Add-ons** 审核及展示的中英文双语描述文本。您可以直接复制对应的段落粘贴至应用商店开发者后台中。

---

## 📍 1. 简短描述 (Short Description)
> **提示**：Chrome 应用商店限制简短描述在 132 个字符以内。

### 🇨🇳 中文简短描述 (Max 132 chars)
```text
基于 Document PiP 的 YouTube 沉浸式英语学习助手！支持 YouTube 双语字幕、画中画字幕与列表、划词查词、原声音频切片与 AI 大模型解析。
```

### 🇺🇸 English Short Description (Max 132 chars)
```text
Immersive YouTube English learning assistant! Features dual subtitles, Document PiP with interactive cue list, word lookup & AI power.
```

---

## 📝 2. 详细描述 (Detailed Description)

### 🇨🇳 中文详细描述 (Chinese Version)

```text
UniEnglishHelper (UEH) 是一款专为英语学习者与视频爱好者打造的下一代沉浸式英语学习扩展！

借助最新 Chromium 116+ Document Picture-in-Picture (文档级画中画) 技术，UEH 彻底打破了传统扩展只能在视频网页内使用的限制。无论您是在写代码、记笔记还是浏览其他网页，UEH 都能让您在置顶的悬浮窗口中边看视频边高效率学英语！

✨ 核心功能亮点：

🎬 1. YouTube 智能双语言字幕
• 原生自动解析 YouTube 官方及自动生成字幕轨道，实时上下并行呈现对齐的双语对照字幕。
• 支持接入 AI 大语言模型（OpenAI / DeepSeek 等）及免费翻译引擎，结合上下文进行长句高精度翻译。
• 自由切换「双语模式」、「仅原文」、「仅译文」或「隐藏字幕」。

🖼️ 2. 全功能 Document PiP 画中画学习窗口
• 率先引入 Chromium Document PiP API，画中画窗口具备完整的网页 DOM 交互能力！
• 悬浮窗口底部实时渲染同步双语字幕，画面清晰不遮挡。
• 支持在画中画窗口内直接点词查词、查看词性释义、收听真人/神经发音。

📜 3. 可交互字幕列表 (Cue List Sidebar)
• 随着视频播放，侧边字幕列表自动滚动并高亮当前播放的字幕句子。
• 点击字幕列表中任意一行，视频进度毫秒级精确定位跳转。
• 支持一键星标收藏重点句子与反复听读。

🔤 4. 划词/点词查询与本地生词本
• 在字幕或网页中直接点击任意英文单词，弹窗即时显示音标、多重释义与上下文例句。
• 查词自动记录视频来源、原文时间戳与例句上下文，同步持久化至本地生词本。
• 提供基于间隔重复 (Spaced Repetition) 的词汇卡片复习与 AI 互动练习。

🎙️ 5. 句级原声音频录制与 WAV 导出
• 结合 Tab Audio Loopback 采样技术与 PCM 环形缓冲区，循环暂存高清视频原音。
• 点击「保存原声」，自动截取并导出当前字幕句子的无损 WAV 原声片段，打造听力与口语闭环。

🤖 6. 兼容 OpenAI API 与自定义 Prompt Skills
• 支持配置任意 OpenAI 格式 ApiKey / BaseURL（OpenAI, DeepSeek, Claude, Local Ollama 等）。
• 内置 Prompt 技能库：支持长句语法结构分析、俚语俗语讲解、同义词辨析与生词造句。

🔊 7. Edge Neural TTS 超自然发音
• 集成微软 Edge Neural TTS 神经发音人，提供接近真人的自然流畅英文朗读体验。

🔒 隐私与数据安全承诺：
• 本地优先 (Local-First)：所有生词、例句、学习进度与音频切片 100% 离线保存在您的本地浏览器 (IndexedDB) 中。
• 密钥安全：您的 API 密钥仅加密存储在本地 chrome.storage.local 中，绝不经过或上传至任何第三方中间服务器。

立即安装 UniEnglishHelper，让每一个 YouTube 视频都成为你专属的英语学习课堂！
```

---

### 🇺🇸 英文详细描述 (English Version)

```text
UniEnglishHelper (UEH) is a next-generation browser extension designed for English learners and video enthusiasts!

Powered by the latest Chromium 116+ Document Picture-in-Picture (Document PiP) API, UEH breaks the boundaries of traditional video extensions. Whether you are coding, taking notes, or browsing other tabs, UEH allows you to learn English seamlessly inside a floating, fully interactive top-level window!

✨ Key Features & Highlights:

🎬 1. Smart YouTube Dual Subtitles
• Automatically fetches YouTube official and auto-generated subtitle tracks, rendering aligned dual-language subtitles simultaneously.
• Integrates AI Large Language Models (OpenAI / DeepSeek) and free translation engines for context-aware, high-precision translation.
• Switch effortlessly between "Bilingual", "Source Only", "Target Only", or "Hidden Subtitles".

🖼️ 2. Interactive Document PiP Window
• First to adopt Chromium Document PiP API with full DOM interactive capabilities inside the floating window!
• Renders real-time bilingual subtitles at the bottom of the PiP frame without obscuring key content.
• Click words, look up definitions, listen to pronunciations, and capture audio clips directly inside the PiP window.

📜 3. Interactive Subtitle List (Cue List Sidebar)
• The sidebar subtitle list automatically scrolls and highlights the current playing sentence.
• Click any line in the cue list to jump video playback precisely to that exact timestamp.
• Star important sentences for one-click bookmarking and repeated listening.

🔤 4. Instant Word Lookup & Local Vocabulary Book
• Click or highlight any word in subtitles to trigger instant dictionary popups with phonetics, definitions, and contextual sentences.
• Automatically logs source video URL, timestamp, and context into your local dictionary.
• Built-in Spaced Repetition Review cards and AI-powered quiz modes for vocabulary retention.

🎙️ 5. Sentence Audio Capture & WAV Export
• Utilizes Tab Audio Loopback sampling with a PCM ring buffer to continuously record high-fidelity video audio.
• Click "Save Audio" to extract and export clean, lossless WAV audio clips for the current sentence.

🤖 6. OpenAI API Compatible & Custom Prompt Skills
• Supports any OpenAI-compatible endpoint (OpenAI, DeepSeek, Claude, SiliconFlow, local Ollama, etc.).
• Built-in Prompt Skills: Parse complex sentence grammar, explain idioms & slang, compare synonyms, or generate custom sentences.

🔊 7. Edge Neural TTS Integration
• Integrates Microsoft Edge Neural Voices alongside Web Speech API for natural, human-like voice reading.

🔒 Privacy & Security Commitment:
• Local-First Privacy: All vocabulary, notes, audio clips, and usage stats are stored 100% locally in your browser's IndexedDB.
• Safe Key Storage: API keys live exclusively in chrome.storage.local and are NEVER transmitted to any intermediate server.

Install UniEnglishHelper today and transform every YouTube video into your personal language learning platform!
```

---

## 🔒 3. 单一用途与权限说明 (Single Purpose & Permissions Justification for CWS Review)

在提交至 Chrome Web Store 审核时的 **Privacy Practices (隐私规范)** 表单填报参考：

### 🎯 Single Purpose Statement (单一用途声明)
- **ZH**: 本扩展的唯一用途是为用户在播放 HTML5 / YouTube 视频时提供双语字幕展示、画中画交互学习、划词翻译与生词复习等沉浸式英语学习辅助功能。
- **EN**: The single purpose of this extension is to assist users in learning English while watching HTML5 / YouTube videos by providing bilingual subtitles, interactive Document Picture-in-Picture controls, word lookups, and local vocabulary review.

### 🔑 Key Permissions Justification (权限申请理由)

1. **`tabCapture` / `offscreen`**
   - **Justification**: Used exclusively to record local tab audio into a PCM ring buffer so the user can slice and export lossless WAV audio clips of video sentences for pronunciation review. Audio is processed locally and never transmitted externally.
2. **`storage`**
   - **Justification**: Used to store user settings, language preferences, local vocabulary entries, API configurations, and translation caches strictly within `chrome.storage.local` and IndexedDB.
3. **`documentPictureInPicture`**
   - **Justification**: Used to spawn a top-level interactive Document PiP window containing the video frame, bilingual subtitles, and cue list sidebar while browsing other web pages.
4. **`scripting` & Host Permissions (`https://*.youtube.com/*`)**
   - **Justification**: Needed to inject subtitle overlay renderers and extract YouTube `timedtext` caption tracks on video playback pages.

---

## 🏷️ 4. 分类与标签推荐 (Category & Tags)

- **Primary Category**: Productivity (实用工具) / Education (教育)
- **Secondary Category**: Search Tools (搜索工具)
- **Tags / Keywords**: `YouTube Dual Subtitles`, `Picture-in-Picture`, `English Learning`, `Subtitles`, `Document PiP`, `OpenAI Translation`, `Edge TTS`, `Vocabulary`
