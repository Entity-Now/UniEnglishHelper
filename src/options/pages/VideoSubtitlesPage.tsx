import React, { useState } from 'react';
import type {
  AppConfig,
  PageSubtitlesConfig,
  PipSubtitlesConfig,
} from '../../shared/domain/types';
import type {
  SubtitleSurfaceConfig,
  SubtitlesDisplayMode,
  SubtitlesFontFamily,
  SubtitlesTranslationPosition,
} from '../../types/config/subtitles';
import { SUBTITLE_FONT_FAMILIES } from '../../utils/constants/subtitles';

export function VideoSubtitlesPage(props: {
  config: AppConfig;
  onSave: (p: Partial<AppConfig>) => Promise<void>;
}) {
  const [form, setForm] = useState(props.config);

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
          允许尝试移动 video 节点（通用 HTML5；YouTube 仍用镜像）
        </label>
      </div>

      <div className="card">
        <h2>共享引擎（页内 + PiP）</h2>
        <p className="hint">批处理与 AI 分句对两种表面共用。</p>
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
        <h2>选区悬浮工具栏</h2>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={form.selectionToolbar?.enabled ?? true}
            onChange={(e) =>
              setForm({
                ...form,
                selectionToolbar: {
                  ...form.selectionToolbar,
                  enabled: e.target.checked,
                },
              })
            }
          />
          启用选区工具栏
        </label>
        {(
          [
            ['showTranslate', '显示「翻译」'],
            ['showDictionary', '显示「词典」'],
            ['showTts', '显示「朗读」'],
            ['showAddWord', '显示「生词」'],
          ] as const
        ).map(([key, label]) => (
          <label className="checkbox" key={key}>
            <input
              type="checkbox"
              checked={Boolean(form.selectionToolbar?.[key])}
              onChange={(e) =>
                setForm({
                  ...form,
                  selectionToolbar: {
                    ...form.selectionToolbar,
                    [key]: e.target.checked,
                  },
                })
              }
            />
            {label}
          </label>
        ))}
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
            selectionToolbar: form.selectionToolbar,
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
}) {
  const { surface, onChange } = props;
  const style = surface.style;
  const previewFont = Math.round(18 * (style.main.fontScale / 100));
  const previewTrFont = Math.round(
    18 * ((style.translation.fontScale ?? style.main.fontScale * 0.88) / 100),
  );
  const previewBg = style.container.backgroundOpacity / 100;
  const fontCss =
    SUBTITLE_FONT_FAMILIES[style.main.fontFamily] ??
    SUBTITLE_FONT_FAMILIES.system;

  const patchStyle = (partial: Partial<typeof style>) => {
    onChange({
      ...surface,
      style: { ...style, ...partial },
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
          <label>译文位置</label>
          <select
            value={style.translationPosition}
            onChange={(e) =>
              patchStyle({
                translationPosition: e.target
                  .value as SubtitlesTranslationPosition,
              })
            }
          >
            <option value="below">原文下方</option>
            <option value="above">原文上方</option>
          </select>
        </div>
        <div>
          <label>字体</label>
          <select
            value={style.main.fontFamily}
            onChange={(e) => {
              const fontFamily = e.target.value as SubtitlesFontFamily;
              patchStyle({
                main: { ...style.main, fontFamily },
                translation: { ...style.translation, fontFamily },
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
            max={150}
            value={style.main.fontScale}
            onChange={(e) => {
              const fontScale = Number(e.target.value);
              patchStyle({
                main: { ...style.main, fontScale },
                translation: {
                  ...style.translation,
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
          <label>垂直位置 ({surface.position.percent}%)</label>
          <input
            type="range"
            min={0}
            max={40}
            value={surface.position.percent}
            onChange={(e) =>
              onChange({
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
            value={style.main.color}
            onChange={(e) =>
              patchStyle({
                main: { ...style.main, color: e.target.value },
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
                translation: {
                  ...style.translation,
                  color: e.target.value,
                },
              })
            }
          />
        </div>
      </div>

      <div className="preview-sub" style={{ marginTop: 16 }}>
        <div
          className="en"
          style={{
            fontSize: previewFont,
            fontFamily: fontCss,
            color: style.main.color,
            background: `rgba(0,0,0,${previewBg})`,
            display:
              style.displayMode === 'translationOnly' ||
              style.displayMode === 'off'
                ? 'none'
                : 'inline-block',
            padding: '4px 10px',
            borderRadius: 6,
            fontWeight: style.main.fontWeight,
          }}
        >
          Hello, how are you today?
        </div>
        <div
          className="tr"
          style={{
            fontSize: previewTrFont,
            fontFamily: fontCss,
            color: style.translation.color,
            background: `rgba(0,0,0,${previewBg})`,
            display:
              style.displayMode === 'originalOnly' ||
              style.displayMode === 'off'
                ? 'none'
                : 'inline-block',
            padding: '4px 10px',
            borderRadius: 6,
            marginTop: 4,
            fontWeight: style.translation.fontWeight,
          }}
        >
          你好，你今天怎么样？
        </div>
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
