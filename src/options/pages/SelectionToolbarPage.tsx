/**
 * Selection toolbar settings — aligned with read-frog
 * `src/entrypoints/options/pages/selection-toolbar/*`
 * + Skill pins (inherit Skill 体系 / 自定义 AI 指令)
 */
import React, { useEffect, useMemo, useState } from 'react';
import type {
  AppConfig,
  SelectionToolbarConfig,
} from '../../shared/domain/types';
import {
  DEFAULT_SELECTION_TOOLBAR,
  MAX_SELECTION_OVERLAY_OPACITY,
  MIN_SELECTION_OVERLAY_OPACITY,
} from '../../shared/domain/types';
import type { SkillRecord } from '../../db/schema';
import {
  BUILTIN_SKILL_IDS,
  isBuiltinSkillId,
} from '../../utils/constants/skills';

export function SelectionToolbarPage(props: {
  config: AppConfig;
  skills: SkillRecord[];
  onSave: (p: Partial<AppConfig>) => Promise<void>;
}) {
  const [form, setForm] = useState<SelectionToolbarConfig>(
    normalizeTb(props.config.selectionToolbar),
  );
  const [patternDraft, setPatternDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [localMsg, setLocalMsg] = useState('');

  useEffect(() => {
    setForm(normalizeTb(props.config.selectionToolbar));
  }, [props.config.selectionToolbar]);

  const enabledSkills = useMemo(
    () => props.skills.filter((s) => s.enabled),
    [props.skills],
  );

  const patch = (partial: Partial<SelectionToolbarConfig>) => {
    setForm((prev) => ({ ...prev, ...partial }));
  };

  const togglePinned = (skillId: string) => {
    const pins = form.pinnedSkillIds;
    // When pins empty → "auto all". First pin action should seed from current auto set.
    if (pins.length === 0) {
      const autoIds = enabledSkills
        .filter((s) => s.id !== BUILTIN_SKILL_IDS.studyReview)
        .map((s) => s.id);
      if (autoIds.includes(skillId)) {
        // Uncheck: pin everyone else
        patch({
          pinnedSkillIds: autoIds.filter((id) => id !== skillId),
        });
      } else {
        patch({ pinnedSkillIds: [...autoIds, skillId] });
      }
      return;
    }
    if (pins.includes(skillId)) {
      patch({ pinnedSkillIds: pins.filter((id) => id !== skillId) });
    } else {
      patch({ pinnedSkillIds: [...pins, skillId] });
    }
  };

  const isPinned = (skillId: string): boolean => {
    if (form.pinnedSkillIds.length === 0) {
      // Auto mode
      return (
        skillId !== BUILTIN_SKILL_IDS.studyReview &&
        enabledSkills.some((s) => s.id === skillId)
      );
    }
    return form.pinnedSkillIds.includes(skillId);
  };

  const addPattern = () => {
    const cleaned = patternDraft.trim();
    if (!cleaned) return;
    if (form.disabledSelectionToolbarPatterns.includes(cleaned)) {
      setPatternDraft('');
      return;
    }
    patch({
      disabledSelectionToolbarPatterns: [
        ...form.disabledSelectionToolbarPatterns,
        cleaned,
      ],
    });
    setPatternDraft('');
  };

  const removePattern = (pattern: string) => {
    patch({
      disabledSelectionToolbarPatterns:
        form.disabledSelectionToolbarPatterns.filter((p) => p !== pattern),
    });
  };

  const save = async () => {
    setSaving(true);
    setLocalMsg('');
    try {
      const opacity = Math.max(
        MIN_SELECTION_OVERLAY_OPACITY,
        Math.min(
          MAX_SELECTION_OVERLAY_OPACITY,
          Math.round(Number(form.opacity) || 100),
        ),
      );
      await props.onSave({
        selectionToolbar: {
          ...form,
          opacity,
          translateShortcut: form.translateShortcut.trim(),
          pinnedSkillIds: form.pinnedSkillIds,
        },
      });
      setLocalMsg('已保存选区工具栏设置');
    } catch (e) {
      setLocalMsg(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <h1 className="page-title">选区工具栏</h1>
      <p className="page-desc">
        划选网页文字时的悬浮操作条：翻译 / 词典 / 朗读 / 生词，以及自定义 AI 指令（Skill
        体系）。
      </p>

      <div className="card">
        <h2>全局开关</h2>
        <p className="hint">关闭后，所有网站都不会显示划选工具栏。</p>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(e) => patch({ enabled: e.target.checked })}
          />
          启用选区工具栏
        </label>
      </div>

      <div className="card">
        <h2>不透明度</h2>
        <p className="hint">
          工具栏与结果面板的透明度（{MIN_SELECTION_OVERLAY_OPACITY}–
          {MAX_SELECTION_OVERLAY_OPACITY}%）。
        </p>
        <div className="row" style={{ alignItems: 'center', gap: 12 }}>
          <input
            type="range"
            min={MIN_SELECTION_OVERLAY_OPACITY}
            max={MAX_SELECTION_OVERLAY_OPACITY}
            step={1}
            value={form.opacity}
            disabled={!form.enabled}
            onChange={(e) => patch({ opacity: Number(e.target.value) })}
            style={{ flex: 1 }}
          />
          <span
            style={{
              minWidth: 44,
              textAlign: 'right',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {form.opacity}%
          </span>
        </div>
      </div>

      <div className="card">
        <h2>基础功能按钮</h2>
        <p className="hint">控制悬浮条上的内置操作。</p>
        {(
          [
            ['showTranslate', '翻译（免费 MT）'],
            ['showDictionary', '词典 / 释义'],
            ['showTts', '朗读'],
            ['showAddWord', '加入生词本'],
          ] as const
        ).map(([key, label]) => (
          <label className="checkbox" key={key}>
            <input
              type="checkbox"
              disabled={!form.enabled}
              checked={Boolean(form[key])}
              onChange={(e) => patch({ [key]: e.target.checked })}
            />
            {label}
          </label>
        ))}
      </div>

      <div className="card">
        <h2>自定义 AI 指令（Skill）</h2>
        <p className="hint">
          与「自定义 AI 指令」共用同一套 Skill。划选文字后可直接运行已启用的指令。
          未勾选任何「固定到工具栏」时，默认显示<strong>全部已启用</strong>指令（不含「AI
          单词深度复习」）。
        </p>
        <label className="checkbox">
          <input
            type="checkbox"
            disabled={!form.enabled}
            checked={form.showSkills}
            onChange={(e) => patch({ showSkills: e.target.checked })}
          />
          在选区工具栏显示 AI 指令
        </label>

        <div style={{ marginTop: 12 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              marginBottom: 8,
            }}
          >
            <strong style={{ fontSize: 13 }}>固定到工具栏</strong>
            <button
              type="button"
              className="ghost"
              style={{ padding: '4px 8px', fontSize: 12 }}
              disabled={!form.enabled || !form.showSkills}
              onClick={() => patch({ pinnedSkillIds: [] })}
              title="清空固定列表，恢复自动（全部已启用）"
            >
              恢复自动
            </button>
          </div>
          {form.pinnedSkillIds.length === 0 && (
            <p className="hint" style={{ marginTop: 0 }}>
              当前：自动模式（全部已启用 Skill）
            </p>
          )}
          {enabledSkills.length === 0 ? (
            <p className="hint">
              暂无已启用的 Skill。请先到侧边栏「自定义 AI 指令」启用或新建。
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {enabledSkills.map((s) => (
                <label className="checkbox" key={s.id}>
                  <input
                    type="checkbox"
                    disabled={!form.enabled || !form.showSkills}
                    checked={isPinned(s.id)}
                    onChange={() => togglePinned(s.id)}
                  />
                  <span>
                    {s.name}
                    {isBuiltinSkillId(s.id) && (
                      <span className="muted" style={{ marginLeft: 6, fontSize: 11 }}>
                        内置
                      </span>
                    )}
                  </span>
                </label>
              ))}
            </div>
          )}
          {props.skills.some((s) => !s.enabled) && (
            <p className="hint" style={{ marginTop: 10 }}>
              已禁用的指令不会出现在此列表；请在「自定义 AI 指令」中启用。
            </p>
          )}
        </div>
      </div>

      <div className="card">
        <h2>翻译快捷键</h2>
        <p className="hint">
          划选文字后按此组合键直接翻译（无需点工具栏）。留空则关闭快捷键。默认{' '}
          <code>Alt+T</code>。
        </p>
        <div className="field">
          <label htmlFor="ueh-sel-shortcut">快捷键</label>
          <input
            id="ueh-sel-shortcut"
            type="text"
            disabled={!form.enabled || !form.showTranslate}
            value={form.translateShortcut}
            placeholder="例如 Alt+T / Ctrl+Shift+Y"
            onChange={(e) => patch({ translateShortcut: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Tab' || e.key === 'Escape') return;
              if (
                e.key === 'Control' ||
                e.key === 'Shift' ||
                e.key === 'Alt' ||
                e.key === 'Meta'
              ) {
                return;
              }
              e.preventDefault();
              const parts: string[] = [];
              if (e.ctrlKey) parts.push('Ctrl');
              if (e.altKey) parts.push('Alt');
              if (e.shiftKey) parts.push('Shift');
              if (e.metaKey) parts.push('Meta');
              const k = e.key.length === 1 ? e.key.toUpperCase() : e.key;
              parts.push(k);
              patch({ translateShortcut: parts.join('+') });
            }}
          />
        </div>
        <p className="hint">在输入框中按下目标组合键即可录制；也可手动编辑。</p>
      </div>

      <div className="card">
        <h2>禁用站点</h2>
        <p className="hint">
          在这些站点隐藏选区工具栏（不影响扩展其他功能）。支持{' '}
          <code>example.com</code>、<code>*.example.com</code>。
        </p>
        <div className="row" style={{ gap: 8, marginBottom: 10 }}>
          <input
            type="text"
            value={patternDraft}
            disabled={!form.enabled}
            placeholder="输入域名或 URL 模式"
            onChange={(e) => setPatternDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addPattern();
              }
            }}
            style={{ flex: 1 }}
          />
          <button
            type="button"
            className="ghost"
            disabled={!form.enabled || !patternDraft.trim()}
            onClick={addPattern}
          >
            添加
          </button>
        </div>
        {form.disabledSelectionToolbarPatterns.length === 0 ? (
          <p className="hint" style={{ margin: 0 }}>
            暂无禁用站点
          </p>
        ) : (
          <table className="data-table" style={{ width: '100%', fontSize: 13 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>URL 模式</th>
                <th style={{ width: 72 }} />
              </tr>
            </thead>
            <tbody>
              {form.disabledSelectionToolbarPatterns.map((p) => (
                <tr key={p}>
                  <td>
                    <code>{p}</code>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="ghost"
                      style={{ padding: '4px 8px', fontSize: 12 }}
                      onClick={() => removePattern(p)}
                    >
                      移除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <button
        type="button"
        className="primary"
        disabled={saving}
        onClick={() => void save()}
      >
        {saving ? '保存中…' : '保存选区工具栏设置'}
      </button>
      {localMsg && (
        <div className="save-feedback ok" role="status">
          {localMsg}
        </div>
      )}
    </div>
  );
}

function normalizeTb(
  raw: SelectionToolbarConfig | undefined,
): SelectionToolbarConfig {
  return {
    ...DEFAULT_SELECTION_TOOLBAR,
    ...(raw ?? {}),
    disabledSelectionToolbarPatterns: Array.isArray(
      raw?.disabledSelectionToolbarPatterns,
    )
      ? [...raw!.disabledSelectionToolbarPatterns]
      : [],
    pinnedSkillIds: Array.isArray(raw?.pinnedSkillIds)
      ? [...raw!.pinnedSkillIds]
      : [],
    showSkills:
      typeof raw?.showSkills === 'boolean'
        ? raw.showSkills
        : DEFAULT_SELECTION_TOOLBAR.showSkills,
    opacity:
      typeof raw?.opacity === 'number' && Number.isFinite(raw.opacity)
        ? Math.max(
            MIN_SELECTION_OVERLAY_OPACITY,
            Math.min(MAX_SELECTION_OVERLAY_OPACITY, Math.round(raw.opacity)),
          )
        : DEFAULT_SELECTION_TOOLBAR.opacity,
    translateShortcut:
      typeof raw?.translateShortcut === 'string'
        ? raw.translateShortcut
        : DEFAULT_SELECTION_TOOLBAR.translateShortcut,
  };
}
