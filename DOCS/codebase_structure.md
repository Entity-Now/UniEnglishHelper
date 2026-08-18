# UniEnglishHelper 代码目录与文件结构说明指南

本文档全面梳理 **UniEnglishHelper** 项目的文件目录结构与各个模块的功能职责，并对 **画中画学习小窗 [PIP]**、**页内注入与网页翻译 [Page]**、**设置与选项后台 [Settings]** 等核心业务代码进行了明确分类标记。

---

## 🏷️ 模块分类标记图例 (Tag Legend)

| 标记 | 模块分类 | 运行环境 / 表现形态 | 核心职责 |
| :--- | :--- | :--- | :--- |
| 🏷️ **[PIP]** | **画中画学习窗口** | Document PiP 独立窗口 (HTML/React) | 浮动在所有窗口最上层，展示独立视频/镜像、同步双语字幕、单词点击分词、原声剪辑与学习面板。 |
| 🏷️ **[Page]** | **网页注入与内容脚本** | Content Script (网页 DOM 空间) | 注入到 YouTube / HTML5 视频页；全屏字幕叠层、网页全文双语翻译、划选工具栏、悬浮翻译球。 |
| 🏷️ **[Settings]** | **选项与配置后台** | Options 完整页面 (React SPA) | 通用设置、翻译引擎/LLM/Prompt 设置、字幕样式定制、自定义 AI 指令、TTS 发音、生词本管理与背单词复习。 |
| 🏷️ **[Popup]** | **扩展快捷弹窗** | Browser Action Popup (React) | 点击浏览器右上角图标弹出的轻量控制面板，支持一键开 PiP、网页翻译、原声采集与生词查看。 |
| 🏷️ **[Background]** | **后台服务与离屏处理** | Service Worker & Offscreen Document | 统一消息路由调度、右键菜单 (Context Menus) 注册与点击派发、免费 MT 代理、LLM 转发、tabCapture 音频环回 + PCM 环形缓冲、音频切片编码。 |
| 🏷️ **[DB & Shared]** | **数据层与共享基础库** | IndexedDB (Dexie) & Type Definitions | 领域模型定义、强类型通信 Envelope、词条/音频/缓存存储、提示词编译器、站点规则引擎。 |

---

## 📁 根目录主要文件说明

```
UniEnglishHelper/
├── manifest.config.ts        # Chrome Extension MV3 Manifest 动态生成配置
├── vite.config.ts            # Vite 5 构建配置 (集成 @crxjs/vite-plugin)
├── tsconfig.json             # TypeScript 编译器配置与路径别名 (@/ -> src/)
├── package.json              # 项目依赖 (React 18, Dexie, Marked, TypeScript, Vite)
├── ARCHITECTURE.md           # 系统深度技术架构设计白皮书
├── README.md                 # 项目中英文介绍与主要特性说明
├── DOCS/                     # 项目详细文档目录
│   ├── codebase_structure.md # [本文档] 目录与代码模块详细结构说明
│   ├── release.md            # 发布流程与 Chrome / Edge 商店上架指南
│   └── privacy.md            # 隐私政策与数据安全合规说明
├── fixtures/                 # 本地测试样例与离线网页
│   └── html5-learning-page/  # 用于离线测试字幕与画中画的本地 HTML5 播放器页面
└── public/                   # 静态资源 (图标、YouTube 主线程注入脚本)
    ├── icons/                # 扩展各尺寸 Logo 图标 (icon16, icon48, icon128)
    └── inject/               # YouTube 主线程注入脚本 (youtube-main.js)
```

---

## 📂 `src/` 源代码全景与文件逐一解析

### 1. `src/content/` —— 网页内容脚本体系 🏷️ **[Page]** & 🏷️ **[PIP 控制]**

这是直接运行在用户浏览网页中的核心代码，负责 DOM 识别、界面叠层与用户交互：

```
src/content/
├── index.ts                     # 🏷️ [Page] Content Script 总入口：生命周期初始化、配置热更新、热键与消息分发
├── pip-session.ts               # 🏷️ [PIP] PiP 会话控制器：创建/管理 Document PiP 窗口、视频移动/镜像、时间线同频
├── pip-ui-shell.ts              # 🏷️ [PIP] PiP 窗口基础骨架与工具栏 (关闭、重置尺寸、齿轮设置、原声录制)
├── page-subtitles.ts            # 🏷️ [Page] 页内字幕控制器：在网页播放器上方渲染双语字幕叠层
├── cue-list-sidebar.ts          # 🏷️ [Page] 视频右侧全量字幕抽屉：列表跳转、单句收藏、点击发音
├── selection-toolbar.ts         # 🏷️ [Page] 网页划词工具栏：划选任意文本弹出翻译、发音、加生词、AI 技能菜单
├── word-explain-popup.ts        # 🏷️ [Page/PIP] 单词释义弹窗：展示音标、词性、中英释义、例句与词根
├── video-vocab-recap.ts         # 🏷️ [Page] 视频生词复习卡片面板：列出当前视频出现过的所有生词
├── player-chrome-button.ts      # 🏷️ [Page] 播放器控制栏按钮：向 YouTube/HTML5 控制栏注入「PiP / 字幕 / 列表」按钮
├── cue-translate.ts             # 🏷️ [Page/PIP] 字幕单句/多句翻译分发辅助函数
├── media-timeline.ts            # 🏷️ [Page/PIP] 视频播放进度与时钟对齐计算器
├── page-side-layout.ts          # 🏷️ [Page] 页面侧边栏布局调整器 (用于抽屉展开时自适应页面)
├── video-mirror.ts              # 🏷️ [PIP] 视频 Canvas/Video 镜像降级渲染器 (当跨域无法直接移入 PiP 时)
├── ui-icons.ts                  # 🏷️ [Shared] 页面 UI SVG 图标库
├── youtube-ads.ts               # 🏷️ [Page] YouTube 广告状态检测机 (广告期间自动静音/暂停字幕预取)
│
├── players/                     # 🏷️ [Page] 播放器适配层 (Adapter Pattern)
│   ├── base.ts                  # 播放器适配器抽象基类 (定义 findVideo, getCues, seek, play, pause 等接口)
│   ├── generic.ts               # 标准 HTML5 <video> 播放器通用适配器
│   ├── youtube.ts               # YouTube 深度适配器 (解析播放器内核、获取自动与官方多语言字幕轨)
│   └── index.ts                 # 播放器适配器工厂函数 (自动探测当前网页并实例化对应 Adapter)
│
└── webpage-translate/           # 🏷️ [Page] 网页全文双语翻译子系统 (New)
    ├── index.ts                 # 网页翻译模块导出总入口
    ├── dom-walker.ts            # DOM Tree 遍历提取器：智能抓取段落并基于 rules.json 过滤代码与免扰元素
    ├── controller.ts            # 网页翻译控制器：调度分批翻译请求、DOM 双语渲染、SPA 动态监听 (MutationObserver)
    ├── floating-button.ts       # 页面右下角悬浮交互胶囊小部件 (Shadow DOM 隔离)
    └── styles.ts                # 网页双语对照 CSS、仅译文隐藏样式与暗色模式主题
```

---

### 2. `src/pip/` —— 画中画独立窗口 🏷️ **[PIP]**

这是在 Document PiP 窗口中运行的独立 React 渲染层：

```
src/pip/
├── index.html                   # Document PiP 窗口加载的空白宿主 HTML
├── index.tsx                    # PiP 窗口 React 挂载入口
├── pip.css                      # PiP 窗口专用样式 (毛玻璃、深色主题、自适应布局)
└── components/
    └── PipApp.tsx               # 🏷️ [PIP] PiP 窗口顶层组件：字幕显示区、分词高亮、音频波形/剪辑按钮、底部工具栏
```

---

### 3. `src/options/` —— 选项与设置后台 🏷️ **[Settings]**

完整功能设置与学习工具箱（React SPA）：

```
src/options/
├── index.html                   # 设置页面 HTML
├── index.tsx                    # 设置页面 React 挂载入口
├── OptionsApp.tsx               # 🏷️ [Settings] 设置页面总框架 (侧边导航栏路由 + 顶部 Toast 提示)
├── nav.ts                       # 🏷️ [Settings] 侧边栏导航条目定义 (通用、翻译、视频字幕、生词本等)
├── options.css                  # 🏷️ [Settings] 全局设置后台样式库
│
├── components/                  # 🏷️ [Settings] 设置页面通用组件
│   ├── AiPromptEditor.tsx       # 🏷️ [Settings] AI Prompt 可视化编辑器 (支持视频字幕翻译与单词释义 Prompt 自定义修改与重置)
│   └── DictionaryImportModal.tsx# 🏷️ [Settings] 词典文件导入导出弹窗
│
└── pages/                       # 🏷️ [Settings] 各子功能设置与工具页面
    ├── GeneralPage.tsx          # 🏷️ [Settings] 「通用设置」：源/目标语言、全站权限、网页全文翻译开关与显示模式
    ├── TranslationPage.tsx      # 🏷️ [Settings] 「翻译」：主翻译引擎 (免费 MT / LLM)、API Key/URL 配置、Prompt 编辑
    ├── VideoSubtitlesPage.tsx   # 🏷️ [Settings] 「视频字幕」：页内字幕与 PiP 字幕独立字号/颜色/背景透明度/位置可视化预览与调节
    ├── SelectionToolbarPage.tsx # 🏷️ [Settings] 「选区工具栏」：划选气泡按钮开关、快捷键设置、固定显示的 Skill 列表
    ├── CustomActionsPage.tsx    # 🏷️ [Settings] 「自定义 AI 指令」：自定义 Skill 提示词、新建分析指令
    ├── SkillsPage.tsx           # 🏷️ [Settings] Skill 指令列表与编辑组件
    ├── TtsPage.tsx              # 🏷️ [Settings] 「朗读 / TTS」：Edge 神经发音人列表、语速/音高/音量调节与在线试听
    ├── DictionaryPage.tsx       # 🏷️ [Settings] 「生词本」：全部生词列表、阶段过滤 (新词/学习中/已掌握)、发音与删除
    ├── StudyPage.tsx            # 🏷️ [Settings] 「背单词 / AI 复习」：卡片式翻转背单词、AI 语境助记分析
    ├── StatisticsPage.tsx       # 🏷️ [Settings] 「统计」：学习词汇量、复习趋势图表
    ├── ConfigPage.tsx           # 🏷️ [Settings] 「配置 / 关于」：配置 JSON 导入导出与版本信息
    └── Settings.tsx             # 🏷️ [Settings] 快速设置合集页 (集成核心功能开关)
```

---

### 4. `src/popup/` —— 浏览器扩展弹窗 🏷️ **[Popup]**

点击浏览器扩展图标弹出的轻量快捷交互面板：

```
src/popup/
├── index.html                   # Popup 页面 HTML
├── index.tsx                    # Popup React 挂载入口
├── popup.css                    # Popup 紧凑主题样式
└── PopupApp.tsx                 # 🏷️ [Popup] 弹窗顶层组件：
                                 #   - 一键打开 PiP 学习窗口
                                 #   - 网页全文双语翻译控制与 ⚙️ 快捷设置 (开启/隐藏悬浮球、自动翻译)
                                 #   - 标签页原声采集 (开始/停止)
                                 #   - 本站禁用扩展开关
                                 #   - 生词本快速查看抽屉
```

---

### 5. `src/background/` —— Service Worker 与后台核心 🏷️ **[Background]**

常驻/按需唤醒的后台调度中心：

```
src/background/
├── index.ts                     # Service Worker 入口：生命周期管理、右键菜单、扩展安装初始化
├── router.ts                    # 🏷️ [Background] 消息路由器：接收所有 content/options/popup 的强类型消息并派发
│
└── services/                    # 🏷️ [Background] 后台核心服务
    ├── config.ts                # 配置存取服务 (chrome.storage.local 与内存同步)
    ├── capture.ts               # tabCapture 采音会话管理 (协调 Offscreen 启动与保活)
    ├── clips.ts                 # 句子原声音频切片导出调度
    ├── tts.ts                   # TTS 语音合成代理与健康检查
    ├── inject-content.ts        # 脚本注入调度器
    ├── offscreen.ts             # Offscreen Document 生命周期维护
    └── youtube-main.ts          # YouTube 播放器内部数据通信桥接
```

---

### 6. `src/offscreen/` —— 音频离屏处理文档 🏷️ **[Background]**

Manifest V3 中 Service Worker 无法直接使用 Web Audio API，本模块专门在离屏 DOM 中运行高性能音频处理：

```
src/offscreen/
├── index.html                   # 离屏文档 HTML
├── index.ts                     # 离屏文档入口与消息监听
├── audio-graph.ts               # Web Audio 音频图：tabCapture 实时原声环回 (保证用户听感不中断)
├── pcm-ring.ts                  # PCM 环形缓冲区 (固定内存保存最近 30~60 秒音频原始采样点)
└── export-encode.ts             # WAV / MP3 编码器：根据 mediaTime 锚点毫秒范围精准裁剪并导出 Blob
```

---

### 7. `src/api/` —— 翻译、TTS 与 AI 接口集成 🏷️ **[DB & Shared]**

统一封装所有第三方 API 通信（免费通道 + 官方 LLM）：

```
src/api/
├── base.ts                      # 网络请求基类与重试策略
├── ai-provider.ts               # OpenAI 兼容接口封装 (ChatCompletion、流式响应、AI 生词释义)
├── edge-tts.ts                  # 微软 Edge 神经语音合成协议客户端 (免 Key 极速高质量发音)
├── dictionary.ts                # 本地词典与外部查词接口
│
└── translate/                   # 翻译子系统路由与引擎
    ├── index.ts                 # 翻译总入口 (智能在 免费 MT 与 LLM 间路由并处理本地缓存)
    ├── providers.ts             # 免费 MT 多通道自动故障切换 (Microsoft -> Google -> MyMemory)
    ├── google.ts                # Google 免费翻译接口实现
    ├── microsoft.ts             # Microsoft 免费翻译批量接口实现
    ├── mymemory.ts              # MyMemory 翻译接口实现
    ├── lang.ts                  # BCP-47 语言代码规范化工具
    └── types.ts                 # 翻译引擎类型定义
```

---

### 8. `src/utils/` —— 工具库与算法引擎 🏷️ **[Shared]**

```
src/utils/
├── constants/
│   ├── prompt.ts                # 🏷️ [Shared] 系统核心 Prompt 模板定义 (高精度字幕翻译、通用网页翻译、语言约束)
│   ├── skills.ts                # 内置 Skill ID 常量
│   └── subtitles.ts             # 字幕排版与字号边界常量
│
├── prompts/                     # Prompt 编译器
│   ├── subtitles.ts             # 字幕翻译 Prompt 生成器 (支持变量占位符替换与自然语言映射)
│   ├── translate.ts             # 通用翻译 Prompt 生成器与全语言本地化名称解析 (formatLanguageForPrompt)
│   ├── word-explain.ts          # 单词/句子 AI 释义 Prompt 生成器
│   └── language-detection.ts    # 语种检测 Prompt
│
├── site-rules/                  # 站点自适应规则库
│   ├── built-in/
│   │   └── rules.json           # 4400+ 行内置全球常见网站排版与免扰规则
│   ├── resolve.ts               # 站点规则合并与有效性验证器
│   ├── effective.ts             # 当前 URL 匹配规则提取与弱引用缓存
│   └── match.ts                 # 通配符与 URL 正则匹配器
│
├── edge-tts/                    # Edge TTS 核心解析库 (SSML 生成、音色列表、Websocket 流控)
├── tts-playback/                # 音频播放控制器与 Chunks 流式播放
├── segmenter.ts                 # 基于 Intl.Segmenter 的高性能单词分割与标点识别
├── site-control.ts              # 扩展在特定网站的启用/黑白名单控制逻辑
├── video-vocab-recap.ts         # 视频生词匹配与复习提取算法
├── vocab-highlight.ts           # 字幕词汇高亮与状态颜色映射算法
└── hash.ts                      # 快速缓存 Key 哈希生成器
```

---

### 9. `src/shared/` 与 `src/db/` —— 领域类型与本地数据库 🏷️ **[DB & Shared]**

```
src/shared/
├── domain/
│   └── types.ts                 # 🌟 全局核心数据模型 (AppConfig, SubtitleCue, WordRecord, WebPageTranslateConfig 等)
├── messages/                    # 跨上下文通信协议 (Envelope 强类型定义)
│   ├── runtime.ts               # Service Worker 与各前端页面间的全部 Request/Response 类型
│   ├── envelope.ts              # 消息打包与校验封装
│   └── errors.ts                # 统一错误码与异常类
├── permissions.ts               # Chrome Extension 权限检测与一键请求工具
├── constants.ts                 # 存储键名常量
└── version.ts                   # 扩展版本号定义

src/db/
├── schema.ts                    # Dexie 数据库表结构 (words, clips, audioCache, translationCache, skills)
└── index.ts                     # 数据库增删改查方法封装与 LRU 缓存清理
```

---

## 🧭 核心业务场景代码速查表 (Quick Reference)

| 想要查看 / 修改的功能 | 涉及的核心文件路径 |
| :--- | :--- |
| **画中画小窗尺寸/样式/分词交互** | [src/pip/components/PipApp.tsx](file:///mnt/c/Users/k431393/OneDrive - UPM Kymmene Oyj/Language/JS/UniEnglishHelper/src/pip/components/PipApp.tsx)<br>[src/content/pip-session.ts](file:///mnt/c/Users/k431393/OneDrive - UPM Kymmene Oyj/Language/JS/UniEnglishHelper/src/content/pip-session.ts) |
| **视频播放器上方双语字幕叠层** | [src/content/page-subtitles.ts](file:///mnt/c/Users/k431393/OneDrive - UPM Kymmene Oyj/Language/JS/UniEnglishHelper/src/content/page-subtitles.ts) |
| **网页全文与段落双语翻译** | [src/content/webpage-translate/controller.ts](file:///mnt/c/Users/k431393/OneDrive - UPM Kymmene Oyj/Language/JS/UniEnglishHelper/src/content/webpage-translate/controller.ts)<br>[src/content/webpage-translate/dom-walker.ts](file:///mnt/c/Users/k431393/OneDrive - UPM Kymmene Oyj/Language/JS/UniEnglishHelper/src/content/webpage-translate/dom-walker.ts)<br>[src/content/webpage-translate/floating-button.ts](file:///mnt/c/Users/k431393/OneDrive - UPM Kymmene Oyj/Language/JS/UniEnglishHelper/src/content/webpage-translate/floating-button.ts) |
| **网页划词工具栏 (Translate/TTS/Add Word)** | [src/content/selection-toolbar.ts](file:///mnt/c/Users/k431393/OneDrive - UPM Kymmene Oyj/Language/JS/UniEnglishHelper/src/content/selection-toolbar.ts) |
| **AI 提示词优化与设置界面编辑器** | [src/utils/constants/prompt.ts](file:///mnt/c/Users/k431393/OneDrive - UPM Kymmene Oyj/Language/JS/UniEnglishHelper/src/utils/constants/prompt.ts)<br>[src/options/components/AiPromptEditor.tsx](file:///mnt/c/Users/k431393/OneDrive - UPM Kymmene Oyj/Language/JS/UniEnglishHelper/src/options/components/AiPromptEditor.tsx) |
| **翻译引擎调度与免费 MT 切换** | [src/api/translate/index.ts](file:///mnt/c/Users/k431393/OneDrive - UPM Kymmene Oyj/Language/JS/UniEnglishHelper/src/api/translate/index.ts)<br>[src/api/translate/providers.ts](file:///mnt/c/Users/k431393/OneDrive - UPM Kymmene Oyj/Language/JS/UniEnglishHelper/src/api/translate/providers.ts) |
| **生词本与背单词学习卡片** | [src/options/pages/DictionaryPage.tsx](file:///mnt/c/Users/k431393/OneDrive - UPM Kymmene Oyj/Language/JS/UniEnglishHelper/src/options/pages/DictionaryPage.tsx)<br>[src/options/pages/StudyPage.tsx](file:///mnt/c/Users/k431393/OneDrive - UPM Kymmene Oyj/Language/JS/UniEnglishHelper/src/options/pages/StudyPage.tsx) |
| **快捷 Popup 弹窗交互与设置** | [src/popup/PopupApp.tsx](file:///mnt/c/Users/k431393/OneDrive - UPM Kymmene Oyj/Language/JS/UniEnglishHelper/src/popup/PopupApp.tsx) |
| **tabCapture 原声录音与音频切片** | [src/offscreen/audio-graph.ts](file:///mnt/c/Users/k431393/OneDrive - UPM Kymmene Oyj/Language/JS/UniEnglishHelper/src/offscreen/audio-graph.ts)<br>[src/offscreen/pcm-ring.ts](file:///mnt/c/Users/k431393/OneDrive - UPM Kymmene Oyj/Language/JS/UniEnglishHelper/src/offscreen/pcm-ring.ts)<br>[src/offscreen/export-encode.ts](file:///mnt/c/Users/k431393/OneDrive - UPM Kymmene Oyj/Language/JS/UniEnglishHelper/src/offscreen/export-encode.ts) |
