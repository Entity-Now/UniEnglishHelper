import React, { useEffect, useMemo, useState } from 'react';
import type {
  AppConfig,
  PageSubtitlesConfig,
  PipSubtitlesConfig,
} from '../../shared/domain/types';
import type {
  SubtitleSurfaceConfig,
  SubtitlesDisplayMode,
  SubtitlesFontFamily,
  SubtitlesLayout,
  SubtitlesTranslationPosition,
} from '../../types/config/subtitles';
import {
  MAX_FONT_SCALE,
  MAX_POSITION_PERCENT,
  MIN_POSITION_PERCENT,
  SUBTITLE_FONT_FAMILIES,
} from '../../utils/constants/subtitles';
import {
  describeSubtitlePlacement,
  resolveSubtitlePlacement,
} from '../../utils/subtitles/layout';
import { isClickableWord, segmentWords } from '../../utils/segmenter';

/** Sample cue mirrors real PiP content (long enough to show wrap). */
const PREVIEW_EN =
  'Hello, how are you today? Learning English is fun when subtitles stay clear.';
const PREVIEW_TR =
  '你好，你今天怎么样？字幕清晰时，学英语会更有趣。';

/** Same base px as PiP / page overlay (`18 * fontScale / 100`). */
const SUBTITLE_BASE_PX = 18;

export function VideoSubtitlesPage(props: {
  config: AppConfig;
  onSave: (p: Partial<AppConfig>) => Promise<void>;
}) {
  const [form, setForm] = useState(props.config);

  // Keep form in sync when parent reloads config (e.g. after save from elsewhere)
  useEffect(() => {
    setForm(props.config);
  }, [props.config]);

  return (
    <div>
      <h1 className="page-title">视频字幕</h1>
      <p className="page-desc">
        页内全屏字幕与 PiP 小窗字幕<strong>分开配置</strong>
        （尺寸/显示模式/自动翻译互不影响）。播放器「字幕」按钮改页内，PiP
        内齿轮改 PiP。
      </p>

      <SurfaceCard
        title="页内字幕（全屏 / 默认页面）"
        hint="作用于 YouTube / HTML5 播放器叠层，默认字号更大。"
        stageLabel="页内叠层"
        surface={form.pageSubtitles}
        extra={
          <>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={form.pageSubtitles.autoStartOnYoutube}
                onChange={(e) =>
                  setForm({
                    ...form,
                    pageSubtitles: {
                      ...form.pageSubtitles,
                      autoStartOnYoutube: e.target.checked,
                    },
                  })
                }
              />
              YouTube 打开页面时自动启动
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={form.features.enableYoutubeAdapter}
                onChange={(e) =>
                  setForm({
                    ...form,
                    features: {
                      ...form.features,
                      enableYoutubeAdapter: e.target.checked,
                    },
                  })
                }
              />
              YouTube 深度字幕适配
            </label>
          </>
        }
        onChange={(surface) =>
          setForm({
            ...form,
            pageSubtitles: {
              ...form.pageSubtitles,
              ...surface,
            } as PageSubtitlesConfig,
          })
        }
      />

      <SurfaceCard
        title="PiP 字幕（画中画小窗）"
        hint="仅作用于 Document PiP，默认字号更小；可在 PiP 工具栏齿轮中即时调整。"
        stageLabel="PiP 小窗"
        surface={form.pipSubtitles}
        extra={
          <div className="row">
            <div>
              <label>默认窗口宽度</label>
              <input
                type="number"
                value={form.pip.width}
                onChange={(e) =>
                  setForm({
                    ...form,
                    pip: {
                      ...form.pip,
                      width: Number(e.target.value) || 720,
                    },
                  })
                }
              />
            </div>
            <div>
              <label>默认窗口高度</label>
              <input
                type="number"
                value={form.pip.height}
                onChange={(e) =>
                  setForm({
                    ...form,
                    pip: {
                      ...form.pip,
                      height: Number(e.target.value) || 480,
                    },
                  })
                }
              />
            </div>
          </div>
        }
        onChange={(surface) =>
          setForm({
            ...form,
            pipSubtitles: {
              ...form.pipSubtitles,
              ...surface,
            } as PipSubtitlesConfig,
            pip: {
              ...form.pip,
              subtitleFontSize: Math.round(
                (18 * (surface.style?.main.fontScale ?? form.pipSubtitles.style.main.fontScale)) /
                  100,
              ),
              subtitleBgOpacity:
                (surface.style?.container.backgroundOpacity ??
                  form.pipSubtitles.style.container.backgroundOpacity) / 100,
            },
          })
        }
      />

      <div className="card">
        <h2>画中画行为</h2>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={form.pip.preferMove}
            onChange={(e) =>
              setForm({
                ...form,
                pip: { ...form.pip, preferMove: e.target.checked },
              })
            }
          />
          优先把 video 迁入 PiP（通用 HTML5，显著省性能；YouTube 仍用低分辨率镜像）
        </label>
      </div>

      <div className="card">
        <h2>共享引擎（页内 + PiP）</h2>
        <p className="hint">
          批处理、AI 分句与翻译通道对两种表面共用。保存后会立即同步到已打开的
          YouTube / PiP 标签页。
        </p>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={form.features.enableLlmTranslate}
            onChange={(e) =>
              setForm({
                ...form,
                features: {
                  ...form.features,
                  enableLlmTranslate: e.target.checked,
                },
              })
            }
          />
          允许使用 LLM 翻译字幕（需配置 API Key）
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={form.features.autoTranslate}
            onChange={(e) => {
              const on = e.target.checked;
              // Keep legacy global flag in sync with both surfaces when toggled here
              setForm({
                ...form,
                features: { ...form.features, autoTranslate: on },
                pageSubtitles: {
                  ...form.pageSubtitles,
                  autoTranslate: on,
                },
                pipSubtitles: {
                  ...form.pipSubtitles,
                  autoTranslate: on,
                },
              });
            }}
          />
          全局默认自动翻译（同步页内 + PiP）
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={form.videoSubtitles.aiSegmentation}
            onChange={(e) =>
              setForm({
                ...form,
                videoSubtitles: {
                  ...form.videoSubtitles,
                  aiSegmentation: e.target.checked,
                },
              })
            }
          />
          AI 字幕重新分句（需要 LLM Key）
        </label>
        <div className="row">
          <div>
            <label>
              速率 rate ({form.videoSubtitles.requestQueueConfig.rate} tok/s)
            </label>
            <input
              type="range"
              min={1}
              max={20}
              value={form.videoSubtitles.requestQueueConfig.rate}
              onChange={(e) =>
                setForm({
                  ...form,
                  videoSubtitles: {
                    ...form.videoSubtitles,
                    requestQueueConfig: {
                      ...form.videoSubtitles.requestQueueConfig,
                      rate: Number(e.target.value),
                    },
                  },
                })
              }
            />
          </div>
          <div>
            <label>
              批大小 (
              {form.videoSubtitles.batchQueueConfig.maxItemsPerBatch})
            </label>
            <input
              type="range"
              min={1}
              max={20}
              value={form.videoSubtitles.batchQueueConfig.maxItemsPerBatch}
              onChange={(e) =>
                setForm({
                  ...form,
                  videoSubtitles: {
                    ...form.videoSubtitles,
                    batchQueueConfig: {
                      ...form.videoSubtitles.batchQueueConfig,
                      maxItemsPerBatch: Number(e.target.value),
                    },
                  },
                })
              }
            />
          </div>
        </div>
      </div>

      <div className="card">
        <h2>生词字幕高亮</h2>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={form.vocabHighlight?.enabled ?? true}
            onChange={(e) =>
              setForm({
                ...form,
                vocabHighlight: {
                  ...form.vocabHighlight,
                  enabled: e.target.checked,
                },
              })
            }
          />
          启用高亮
        </label>
        <div className="row">
          <div>
            <label>新词</label>
            <input
              type="color"
              value={form.vocabHighlight?.newColor ?? '#F5C542'}
              onChange={(e) =>
                setForm({
                  ...form,
                  vocabHighlight: {
                    ...form.vocabHighlight,
                    newColor: e.target.value,
                  },
                })
              }
            />
          </div>
          <div>
            <label>学习中</label>
            <input
              type="color"
              value={form.vocabHighlight?.learningColor ?? '#5B9FFF'}
              onChange={(e) =>
                setForm({
                  ...form,
                  vocabHighlight: {
                    ...form.vocabHighlight,
                    learningColor: e.target.value,
                  },
                })
              }
            />
          </div>
          <div>
            <label>已掌握</label>
            <input
              type="color"
              value={form.vocabHighlight?.learnedColor ?? '#3DDC97'}
              onChange={(e) =>
                setForm({
                  ...form,
                  vocabHighlight: {
                    ...form.vocabHighlight,
                    learnedColor: e.target.value,
                  },
                })
              }
            />
          </div>
        </div>
      </div>

      <div className="card">
        <h2>单词展示（Word Show）</h2>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={form.wordShow.pauseOnOpen}
            onChange={(e) =>
              setForm({
                ...form,
                wordShow: {
                  ...form.wordShow,
                  pauseOnOpen: e.target.checked,
                },
              })
            }
          />
          打开单词面板时暂停视频
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={form.wordShow.autoExplain}
            onChange={(e) =>
              setForm({
                ...form,
                wordShow: {
                  ...form.wordShow,
                  autoExplain: e.target.checked,
                },
              })
            }
          />
          自动 AI 释义
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={form.wordShow.underlineWords}
            onChange={(e) =>
              setForm({
                ...form,
                wordShow: {
                  ...form.wordShow,
                  underlineWords: e.target.checked,
                },
              })
            }
          />
          可点击词下划线提示
        </label>
      </div>

      <SaveButton
        label="保存字幕与相关设置"
        onSave={() =>
          props.onSave({
            pip: form.pip,
            videoSubtitles: form.videoSubtitles,
            pageSubtitles: form.pageSubtitles,
            pipSubtitles: form.pipSubtitles,
            wordShow: form.wordShow,
            vocabHighlight: form.vocabHighlight,
            features: form.features,
          })
        }
      />
    </div>
  );
}

function SurfaceCard(props: {
  title: string;
  hint: string;
  surface: SubtitleSurfaceConfig;
  onChange: (s: Partial<SubtitleSurfaceConfig>) => void;
  extra?: React.ReactNode;
  /** Visual chrome label for the mock player stage */
  stageLabel?: string;
}) {
  const { surface, onChange } = props;
  const style = surface.style;

  type StylePatch = {
    displayMode?: typeof style.displayMode;
    layout?: SubtitlesLayout;
    translationPosition?: typeof style.translationPosition;
    main?: Partial<typeof style.main>;
    translation?: Partial<typeof style.translation>;
    container?: Partial<typeof style.container>;
  };

  const patchStyle = (partial: StylePatch) => {
    onChange({
      ...surface,
      style: {
        ...style,
        displayMode: partial.displayMode ?? style.displayMode,
        layout: partial.layout ?? style.layout ?? 'stacked',
        translationPosition:
          partial.translationPosition ?? style.translationPosition,
        // Deep-merge nested style objects so partial main/translation/container
        // never wipe sibling fields.
        main: partial.main ? { ...style.main, ...partial.main } : style.main,
        translation: partial.translation
          ? { ...style.translation, ...partial.translation }
          : style.translation,
        container: partial.container
          ? { ...style.container, ...partial.container }
          : style.container,
      },
    });
  };

  return (
    <div className="card">
      <h2>{props.title}</h2>
      <p className="hint">{props.hint}</p>

      <label className="checkbox">
        <input
          type="checkbox"
          checked={surface.enabled && style.displayMode !== 'off'}
          onChange={(e) => {
            const on = e.target.checked;
            onChange({
              enabled: on,
              style: {
                ...style,
                displayMode: on
                  ? style.displayMode === 'off'
                    ? 'bilingual'
                    : style.displayMode
                  : 'off',
              },
            });
          }}
        />
        启用此表面字幕
      </label>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={surface.autoTranslate}
          onChange={(e) => onChange({ autoTranslate: e.target.checked })}
        />
        新字幕句自动翻译
      </label>

      {props.extra}

      <div className="row" style={{ marginTop: 12 }}>
        <div>
          <label>显示模式</label>
          <select
            value={style.displayMode}
            onChange={(e) =>
              patchStyle({
                displayMode: e.target.value as SubtitlesDisplayMode,
              })
            }
          >
            <option value="bilingual">双语</option>
            <option value="originalOnly">仅原文</option>
            <option value="translationOnly">仅译文</option>
            <option value="off">关闭</option>
          </select>
        </div>
        <div>
          <label>双语布局</label>
          <select
            value={style.layout ?? 'stacked'}
            onChange={(e) =>
              patchStyle({
                layout: e.target.value as SubtitlesLayout,
              })
            }
          >
            <option value="stacked">堆叠（同一区域）</option>
            <option value="split">分离（上下两端）</option>
          </select>
        </div>
        <div>
          <label>
            {(style.layout ?? 'stacked') === 'split'
              ? '分离方向'
              : '译文相对位置'}
          </label>
          <select
            value={style.translationPosition}
            onChange={(e) =>
              patchStyle({
                translationPosition: e.target
                  .value as SubtitlesTranslationPosition,
              })
            }
          >
            {(style.layout ?? 'stacked') === 'split' ? (
              <>
                <option value="above">译文在上 / 原文在下</option>
                <option value="below">原文在上 / 译文在下</option>
              </>
            ) : (
              <>
                <option value="below">原文下方（默认）</option>
                <option value="above">原文上方</option>
              </>
            )}
          </select>
        </div>
        <div>
          <label>字体</label>
          <select
            value={style.main.fontFamily}
            onChange={(e) => {
              const fontFamily = e.target.value as SubtitlesFontFamily;
              patchStyle({
                main: { fontFamily },
                translation: { fontFamily },
              });
            }}
          >
            <option value="system">System</option>
            <option value="roboto">Roboto</option>
            <option value="noto-sans">Noto Sans</option>
            <option value="noto-serif">Noto Serif</option>
          </select>
        </div>
      </div>

      <div className="row" style={{ marginTop: 12 }}>
        <div>
          <label>原文字号 ({style.main.fontScale}%)</label>
          <input
            type="range"
            min={50}
            max={MAX_FONT_SCALE}
            value={Math.min(style.main.fontScale, MAX_FONT_SCALE)}
            onChange={(e) => {
              const fontScale = Number(e.target.value);
              patchStyle({
                main: { fontScale },
                translation: {
                  fontScale: Math.round(fontScale * 0.88),
                },
              });
            }}
          />
        </div>
        <div>
          <label>
            背景不透明度 ({style.container.backgroundOpacity}%)
          </label>
          <input
            type="range"
            min={0}
            max={100}
            value={style.container.backgroundOpacity}
            onChange={(e) =>
              patchStyle({
                container: {
                  backgroundOpacity: Number(e.target.value),
                },
              })
            }
          />
        </div>
        <div>
          <label>垂直锚点（堆叠）</label>
          <select
            value={surface.position.anchor}
            onChange={(e) =>
              onChange({
                ...surface,
                position: {
                  ...surface.position,
                  anchor: e.target.value as 'top' | 'bottom',
                },
              })
            }
          >
            <option value="bottom">靠下</option>
            <option value="top">靠上</option>
          </select>
        </div>
        <div>
          <label>
            边距 ({surface.position.percent}%)
            {(style.layout ?? 'stacked') === 'split' ? ' · 两端' : ''}
          </label>
          <input
            type="range"
            min={MIN_POSITION_PERCENT}
            max={MAX_POSITION_PERCENT}
            value={surface.position.percent}
            onChange={(e) =>
              onChange({
                ...surface,
                position: {
                  ...surface.position,
                  percent: Number(e.target.value),
                },
              })
            }
          />
        </div>
      </div>

      <div className="row" style={{ marginTop: 12 }}>
        <div>
          <label>原文颜色</label>
          <input
            type="color"
            value={
              style.main.color.startsWith('#') ? style.main.color : '#FFFFFF'
            }
            onChange={(e) =>
              patchStyle({
                main: { color: e.target.value },
              })
            }
          />
        </div>
        <div>
          <label>译文颜色</label>
          <input
            type="color"
            value={
              style.translation.color.startsWith('#')
                ? style.translation.color
                : '#E8D5A3'
            }
            onChange={(e) =>
              patchStyle({
                translation: { color: e.target.value },
              })
            }
          />
        </div>
      </div>

      <PipStyleSubtitlePreview
        surface={surface}
        stageLabel={props.stageLabel ?? props.title}
      />
    </div>
  );
}

/**
 * Live mock of PiP / page-overlay cue chrome.
 * Mirrors `buildPipStyles` + `pip-session.renderCue` layout rules so settings
 * preview matches what users see in Document PiP.
 */
function PipStyleSubtitlePreview(props: {
  surface: SubtitleSurfaceConfig;
  stageLabel: string;
}) {
  const { surface } = props;
  const style = surface.style;
  const enabled = surface.enabled && style.displayMode !== 'off';

  const appearance = useMemo(() => {
    const mainScale = style.main.fontScale ?? 100;
    const trScale =
      style.translation.fontScale ?? Math.round(mainScale * 0.88);
    const bg = Math.max(
      0,
      Math.min(1, (style.container.backgroundOpacity ?? 55) / 100),
    );
    const fontCss =
      SUBTITLE_FONT_FAMILIES[style.main.fontFamily] ??
      SUBTITLE_FONT_FAMILIES.system;
    const mode = style.displayMode;
    const showEn =
      enabled && (mode === 'bilingual' || mode === 'originalOnly');
    const showTr =
      enabled && (mode === 'bilingual' || mode === 'translationOnly');
    const placement = resolveSubtitlePlacement({
      layout: style.layout,
      translationPosition: style.translationPosition,
      position: surface.position,
    });
    return {
      enFontPx: Math.round(SUBTITLE_BASE_PX * (mainScale / 100)),
      trFontPx: Math.round(SUBTITLE_BASE_PX * (trScale / 100)),
      bg,
      fontCss,
      showEn,
      showTr,
      mode,
      placement,
      label: describeSubtitlePlacement(placement),
      enColor: style.main.color || '#FFFFFF',
      trColor: style.translation.color || '#E8D5A3',
      enWeight: style.main.fontWeight ?? 600,
      trWeight: style.translation.fontWeight ?? 500,
    };
  }, [surface, style, enabled]);

  const wordNodes = useMemo(() => {
    return segmentWords(PREVIEW_EN).map((seg, i) => {
      if (isClickableWord(seg)) {
        return (
          <span key={i} className="ueh-sub-preview-word">
            {seg.text}
          </span>
        );
      }
      return <React.Fragment key={i}>{seg.text}</React.Fragment>;
    });
  }, []);

  const lineStyle = (kind: 'en' | 'tr'): React.CSSProperties => {
    const isEn = kind === 'en';
    const base: React.CSSProperties = {
      fontSize: isEn ? appearance.enFontPx : appearance.trFontPx,
      fontFamily: appearance.fontCss,
      fontWeight: isEn ? appearance.enWeight : appearance.trWeight,
      color: isEn ? appearance.enColor : appearance.trColor,
      background: `rgba(0,0,0,${appearance.bg})`,
    };
    if (appearance.placement.layout !== 'split') return base;
    const edge = isEn
      ? appearance.placement.originalEdge
      : appearance.placement.translationEdge;
    return {
      ...base,
      position: 'absolute',
      left: '50%',
      transform: 'translateX(-50%)',
      width: 'max-content',
      maxWidth: '94%',
      ...(edge === 'top'
        ? { top: `${appearance.placement.percent}%`, bottom: 'auto' }
        : { bottom: `${appearance.placement.percent}%`, top: 'auto' }),
    };
  };

  const layerStyle: React.CSSProperties =
    appearance.placement.layout === 'split'
      ? {
          inset: 0,
          display: 'block',
          flexDirection: undefined,
          bottom: undefined,
          top: undefined,
        }
      : {
          flexDirection: appearance.placement.flexDirection,
          ...(appearance.placement.stackAnchor === 'top'
            ? {
                top: `${Math.max(6, appearance.placement.percent)}%`,
                bottom: 'auto',
              }
            : {
                bottom: `${Math.max(10, Math.min(46, 8 + appearance.placement.percent))}%`,
                top: 'auto',
              }),
        };

  return (
    <div className="ueh-sub-preview" style={{ marginTop: 16 }}>
      <div className="ueh-sub-preview-meta">
        <span>实时预览（与 PiP / 页内叠层同一套规则）</span>
        <span className="muted">
          {appearance.mode}
          {' · '}
          {appearance.label}
        </span>
      </div>

      <div
        className="ueh-sub-preview-stage"
        role="img"
        aria-label={`字幕预览：${props.stageLabel}`}
      >
        <div className="ueh-sub-preview-stage-label">{props.stageLabel}</div>
        {/* Fake video gradient + chrome bar like PiP */}
        <div className="ueh-sub-preview-fake-video" />
        <div className="ueh-sub-preview-fake-chrome" />

        {!enabled || appearance.mode === 'off' ? (
          <div className="ueh-sub-preview-off">字幕已关闭</div>
        ) : (
          <div className="ueh-sub-preview-layer" style={layerStyle}>
            {appearance.showEn ? (
              <div
                className="ueh-sub-preview-line ueh-sub-preview-en"
                style={lineStyle('en')}
              >
                {wordNodes}
              </div>
            ) : null}
            {appearance.showTr ? (
              <div
                className="ueh-sub-preview-line ueh-sub-preview-tr"
                style={lineStyle('tr')}
              >
                {PREVIEW_TR}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

function SaveButton(props: {
  label: string;
  onSave: () => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  return (
    <>
      <button
        type="button"
        className="primary"
        disabled={saving}
        onClick={() => {
          setSaving(true);
          setMsg('');
          void props
            .onSave()
            .then(() => setMsg('已保存（会立即同步到已打开的页面 / PiP）'))
            .catch((e: unknown) =>
              setMsg(e instanceof Error ? e.message : '保存失败'),
            )
            .finally(() => setSaving(false));
        }}
      >
        {saving ? '保存中…' : props.label}
      </button>
      {msg && (
        <div className="save-feedback ok" role="status">
          {msg}
        </div>
      )}
    </>
  );
}
