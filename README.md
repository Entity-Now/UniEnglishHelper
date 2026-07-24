<h1 align="center">UniEnglishHelper (UEH)</h1>

<p align="center">
  <b>基于 Chromium 116+ Document PiP 与 AI 驱动的 YouTube 视频沉浸式英语学习浏览器扩展</b><br>
  <i>Immersive English Video Learning Assistant with YouTube Dual Subtitles, Interactive Document PiP & AI Power</i>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Manifest-V3-blue.svg" alt="Manifest V3" />
  <img src="https://img.shields.io/badge/Chromium-116%2B-brightgreen.svg" alt="Chromium 116+" />
  <img src="https://img.shields.io/badge/React-18.3-61dafb.svg" alt="React 18" />
  <img src="https://img.shields.io/badge/TypeScript-5.7-blue.svg" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Vite-5.4-646cff.svg" alt="Vite" />
  <img src="https://img.shields.io/badge/License-GPL--3.0-orange.svg" alt="License GPL-3.0" />
</p>

---

## 📌 目录 (Table of Contents)

- [✨ 项目核心亮点 (Highlights)](#-项目核心亮点-highlights)
- [🎬 核心功能拆解 (Features Breakdown)](#-核心功能拆解-features-breakdown)
  - [1. 🎬 YouTube 智能双语言字幕 (YouTube Dual Subtitles)](#1-youtube-智能双语言字幕-youtube-dual-subtitles)
  - [2. 🖼️ YouTube Document PiP 独立画中画学习系统](#2-youtube-document-pip-独立画中画学习系统)
  - [3. 📜 可交互字幕列表与时间轴同步 (Interactive Cue List)](#3-可交互字幕列表与时间轴同步-interactive-cue-list)
  - [4. 🔤 划词/点词即时查询与生词本 (Word Lookup & Dictionary)](#4-划词点词即时查询与生词本-word-lookup--dictionary)
  - [5. 🎙️ 句级原声音频录制与导出 (Sentence Audio Capture & WAV Export)](#5-句级原声音频录制与导出-sentence-audio-capture--wav-export)
  - [6. 🤖 兼容 OpenAI API / Custom Skills 大模型赋能](#6-兼容-openai-api--custom-skills-大模型赋能)
  - [7. 🔊 Edge Neural TTS 神经自然语音发音](#7-edge-neural-tts-神经自然语音发音)
- [📊 功能特性对比 (Feature Comparison)](#-功能特性对比-feature-comparison)
- [🖼️ 界面预览 (Screenshots)](#-界面预览-screenshots)
- [🏗️ 技术架构 (Architecture)](#-技术架构-architecture)
- [🚀 快速开始与开发指南 (Quick Start)](#-快速开始与开发指南-quick-start)
- [💡 每日高效学习流程 (Daily Workflow Guide)](#-每日高效学习流程-daily-workflow-guide)
- [⚙️ 配置说明 (Configuration)](#️-配置说明-configuration)
- [📜 隐私与开源协议 (Privacy & License)](#-隐私与开源协议-privacy--license)

---

## ✨ 项目核心亮点 (Highlights)

**UniEnglishHelper (UEH)** 是一款专为英语学习者打造的下一代浏览器扩展。突破传统学习扩展只能在视频网页内部浏览的限制，UEH 借助最新 **Chromium 116+ Document Picture-in-Picture (文档级画中画)** API，将完整的 HTML5 交互能力引入置顶悬浮窗口。

- 🎯 **YouTube 专属优化**：原生解析 YouTube `timedtext` 轨道，自动合成双语对照字幕，支持 AI 毫秒级高精度翻译与动态预加载。
- 🖼️ **全功能 Document PiP 窗口**：视频画中画不仅能看视频，更能**在 PiP 窗口中显示双语字幕、嵌入字幕列表 (Cue List Sidebar)、悬浮查词、收听发音与采集原声音频**！
- 🧠 **大模型 (LLM) 深度融合**：无缝对接 OpenAI / DeepSeek / Claude 等 OpenAI 兼容接口，支持自定义 Prompt Skills（上下文解释、语法解析、同义辨析等）。
- 🎙️ **原声闭环 (Loopback Audio Capture)**：结合 Chromium Offscreen Document 与 Web Audio PCM 环形缓冲区，一键切片保存当前字幕句子的**无损原音 WAV**，实现「听 - 看 - 读 - 记 - 听」的全方位记忆强化。
- 🔒 **Local-First 隐私优先**：所有生词本、例句与音频切片均持久化于本地 IndexedDB (Dexie.js)，数据完全掌控在自己手中。

---

## 🎬 核心功能拆解 (Features Breakdown)

### 1. 🎬 YouTube 智能双语言字幕 (YouTube Dual Subtitles)
- **智能轨道识别**：自动读取 YouTube 官方字幕、自动生成字幕与第三方字幕文件。
- **双语并行展示**：原文（如英语）与译文（如中文）实时上下并行对齐，字号、颜色、背景透明度灵活配置。
- **AI 动态翻译与缓存**：接入大语言模型 (LLM) / 免费翻译引擎，结合句子上下文进行长句高精度翻译，并建立本地 Local Storage 缓存避免重复消耗 Tokens。
- **字幕模式切换**：支持「双语模式」、「仅原文」、「仅译文」及「隐藏字幕」快捷切换。

### 2. 🖼️ YouTube Document PiP 独立画中画学习系统
传统画中画 (Canvas-based PiP) 仅能显示静态图像帧，无法点击交互。**UniEnglishHelper 率先应用 Document Picture-in-Picture API**：
- **置顶窗口完整 DOM 交互**：悬浮窗口拥有独立完整的 React UI 页面，可以在看视频的同时操作一切学习功能。
- **PiP 悬浮双语字幕**：视频画中画窗口底部实时渲染同步双语字幕，画面清晰不挡主体。
- **边看边工作/记笔记**：切到 Word、Notion、VSCode 或其他浏览器标签页时，PiP 窗口始终置顶展示视频与字幕。

### 3. 📜 可交互字幕列表与时间轴同步 (Interactive Cue List)
- **侧边/独立字幕列表**：PiP 窗口或网页侧栏随视频进度自动高亮滚动当前播放字幕句（Auto-scroll & Highlight）。
- **点击句子即刻跳转**：点击字幕列表中任意一行，视频播放进度毫秒级精确定位到该句子起始点。
- **句级收藏与标记**：一键星标重点句子，一键重新听读当前句子。

### 4. 🔤 划词/点词即时查询与生词本 (Word Lookup & Dictionary)
- **PiP 窗口内点词查词**：在 PiP 悬浮窗口或视频字幕中直接点击/选择英文单词，触发卡片式弹窗查看音标、释义及例句。
- **一键生词入库**：查词同时保存生词、对应视频链接、上下文例句以及原文时间戳到本地生词本。
- **间隔复习系统 (Spaced Review)**：内置词汇复习卡片与 AI 智能测验功能。

### 5. 🎙️ 句级原声音频录制与导出 (Sentence Audio Capture & WAV Export)
- **Tab Audio Capture 环形采样**：利用 Chrome Offscreen 捕获标签页音频流，内置 PCM Ring Buffer 实时循环暂存。
- **精确句级切片**：点击「保存原声」，系统根据当前字幕句的时间范围（Start ~ End Time），自动导出对应的原音 WAV 格式音频段落并关联生词例句。

### 6. 🤖 兼容 OpenAI API / Custom Skills 大模型赋能
- **支持任意 OpenAI 格式 ApiKey / BaseURL**（OpenAI, DeepSeek, Claude, SiliconFlow, Local Ollama 等）。
- **自定义 AI Prompt Skills**：预置「长句语法结构剖析」、「俚语俗语解释」、「同义词辨析」、「生词造句」等 Prompt 模板，也可自由添加个性化 Prompt。

### 7. 🔊 Edge Neural TTS 神经自然语音发音
- 结合 Web Speech API 与微软 Edge Neural TTS（微软超自然神经发音），提供比原生浏览器发音更贴近真人发音的英文朗读支持。

---

## 📊 功能特性对比 (Feature Comparison)

| 功能特性 | 传统视频翻译插件 | 普通视频画中画 (Canvas PiP) | **UniEnglishHelper (UEH)** |
| :--- | :---: | :---: | :---: |
| **YouTube 双语字幕** | 仅网页内部显示 | 画面写死无交互 | **网页 + 置顶窗口全覆盖** |
| **画中画交互能力** | ✕ (无 PiP 功能) | 仅能播放/暂停 | **支持点击/选词/滚动列表/跳转** |
| **画中画内字幕列表** | ✕ | ✕ | **支持 (Cue List 侧边栏)** |
| **画中画内单词查询** | ✕ | ✕ | **支持 (点词弹窗 + 听音)** |
| **视频原声音频切片** | ✕ | ✕ | **支持 (PCM Ring 导出 WAV)** |
| **大模型 Prompt Skills** | ✕ 或 仅普通翻译 | ✕ | **支持 (语法/同义词/俚语解析)** |
| **数据隐私存储** | 云端同步 (需注册) | 仅缓存 | **100% 本地 IndexedDB 掌控** |

---

## 🖼️ 界面预览 (Screenshots)

<details open>
<summary><b>点击展开 / 折叠高清截图</b></summary>

<br>

| 界面分类 | 截图展示 | 功能说明 |
| :--- | :--- | :--- |
| **YouTube 网页学习** | ![YouTube learning overview](./DOCS/Images/youtube.png) | 沉浸式 YouTube 页面体验，包含视频控制浮窗与双语字幕对齐。 |
| **Document PiP 画中画** | ![Picture-in-Picture with subtitles](./DOCS/Images/PIP_show.png) | 独立悬浮画中画窗口，实时渲染同步双语字幕，支持点击查词。 |
| **PiP + 字幕列表** | ![PiP with subject list](./DOCS/Images/pip-and-subject-list.png) | 画中画结合 **Cue List (字幕列表)**，支持点击跳转、高亮与句子收藏。 |
| **通用偏好设置** | ![General settings](./DOCS/Images/general-setting.png) | 语言对选择、站点控制、全局界面样式配置。 |
| **翻译与 LLM 配置** | ![Translation options](./DOCS/Images/translate-options.png) | 配置 OpenAI / DeepSeek API 密钥、自定义模型与 Prompt 技能。 |
| **语音合成 (TTS)** | ![TTS options](./DOCS/Images/tts_options.png) | 配置 Web Speech 及 Edge 神经发音，调节语速、音高与试听。 |
| **生词本与复习** | ![Dictionary](./DOCS/Images/dictionary.png) | 本地词库管理，查看收集单词、关联例句、原声音频与学习状态。 |
| **学习数据统计** | ![Statistics](./DOCS/Images/statistics.png) | 学习时长统计、收集词汇趋势图表与本地缓存清理。 |

</details>

---

## 🏗️ 技术架构 (Architecture)

UEH 遵循 **Manifest V3** 标准与现代前端领域驱动架构（Domain-Driven Design），详情可参阅 [`ARCHITECTURE.md`](./ARCHITECTURE.md)。

```
src/
├── background/      # Service worker 消息路由、后台任务与 Audio Capture 调度
├── content/         # YouTube / HTML5 适配器、字幕注入器、Media Timeline 锚点
├── offscreen/       # Audio loopback 采样图、PCM 环形缓冲区、WAV 编码导出
├── pip/             # React 构建的 Document PiP 独立应用与交互窗口
├── popup/           # 插件图标快捷面板（一键开 PiP / 开启音频录制）
├── options/         # 独立设置中心、生词本、AI Study 复习、Prompt Skills 编辑器
├── db/              # Dexie.js (IndexedDB) 数据持久化与仓储管理
├── api/             # 统一 LLM / Translate API 模块封装
└── shared/          # 跨上下文消息通信 IDL、类型定义与常量
```

---

## 🚀 快速开始与开发指南 (Quick Start)

### 环境准备

- **Node.js**: ≥ 20.0
- **包管理器**: `pnpm` (推荐) 或 `npm`
- **浏览器**: Chrome 或 Edge (版本 ≥ 116，以支持 Document PiP API)

### 编译构建步骤

```bash
# 1. 克隆项目仓库
git clone https://github.com/your-username/UniEnglishHelper.git
cd UniEnglishHelper

# 2. 安装依赖
pnpm install

# 3. 编译打包 (生成 dist/ 目录)
pnpm build

# 4. (可选) 开发模式启动 (支持 HMR 热重载)
pnpm dev

# 5. (可选) 启动本地测试 HTML5 演示页面
pnpm fixture
```

### 加载插件到浏览器

1. 打开 Chrome 或 Edge 浏览器，访问 `chrome://extensions` 或 `edge://extensions`。
2. 开启右上角的 **「开发者模式 (Developer mode)」**。
3. 点击 **「加载已解压的扩展程序 (Load unpacked)」**。
4. 选择项目根目录下的 `dist/` 文件夹。
5. 将 **UniEnglishHelper** 插件固定到浏览器工具栏。

---

## 💡 每日高效学习流程 (Daily Workflow Guide)

1. **打开视频**：在 YouTube 或任意 HTML5 视频页面（如 `http://localhost:4173` 测试页）播放英文视频。
2. **启动 Document PiP**：点击视频右下角浮动的 **UEH PiP** 按钮（或插件 Popup 弹窗中的 **Open PiP**）。
3. **开启原声采集（首名页授权一次）**：在 Popup 面板中点击 **Start capture** 开启本标签页音频采集。
4. **沉浸式学习**：
   - 切换到其他应用（如 Notion / 笔记软件），PiP 窗口持续置顶播放。
   - 在 PiP 窗口中同步查看双语字幕与侧边字幕列表。
   - 碰到不认识的单词直接在 PiP 中点击查词并加入生词本。
   - 听到精彩句子，点击 **Save audio** 保存无损原声音频切片。
5. **温故知新**：在插件选项页面打开 **生词本 (Dictionary)** 进行间隔复习与 AI 对话巩固。

---

## ⌨️ 快捷键指南 (Keyboard Shortcuts)

| 快捷键 | 功能说明 |
| :--- | :--- |
| `Alt + P` (或 `Option + P`) | 快速开启 / 关闭 Document PiP 窗口 |
| `Space` | 播放 / 暂停视频 |
| `Left` / `Right` | 后退 / 前进 5 秒 |
| `Up` / `Down` | 音量增加 / 减少 |
| `[` / `]` | 上一句 / 下一句字幕跳转 |

---

## ⚙️ 配置说明 (Configuration)

在选项页面 (Options) 中提供丰富的定制项：

- **General (常规设置)**：源语言 / 目标语言、网站启用黑白名单、字幕默认显示样式。
- **Translation (翻译 & AI)**：选择免费 MT 接口，或填入 OpenAI 兼容 API Key、Base URL 与 Model 名称。
- **TTS (语音合成)**：切换 Web Speech 或 Edge 神经语音发音人，调节语速 (Rate) 与音高 (Pitch)。
- **Skills (Prompt 技能库)**：自定义扩展 AI 的解释视角与分析模板。

> 🔒 **安全承诺**：您的所有 API 密钥均保存在浏览器的 `chrome.storage.local` 本地受保护存储中，绝不上传任何第三方或中间服务器。

---

## 📜 隐私与开源协议 (Privacy & License)

- **数据隐私**：生词本、笔记及音频切片完全离线保存在本地 IndexedDB 中。详见 [`DOCS/privacy.md`](./DOCS/privacy.md)。
- **开源协议**：本项目基于 **GPL-3.0-or-later** 协议开源。YouTube 字幕解析管线与设计 Token 借鉴并演化自 [read-frog](https://github.com/mengxi-ream/read-frog) (GPL-3.0)。详见 [`LICENSE`](./LICENSE)。

---

<p align="center">
  <b>UniEnglishHelper</b> — 让每一个 YouTube 视频都成为你专属的英语学习课堂。
</p>
