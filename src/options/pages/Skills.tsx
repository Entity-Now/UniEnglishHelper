import React, { useMemo, useState } from 'react';
import type { SkillRecord } from '../../db/schema';
import {
  BUILTIN_SKILLS,
  isBuiltinSkillId,
} from '../../utils/constants/skills';

export function SkillsPage(props: {
  skills: SkillRecord[];
  onSave: (skill: {
    id?: string;
    name: string;
    systemPrompt: string;
    enabled?: boolean;
  }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onResetBuiltin?: (id: string) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editPrompt, setEditPrompt] = useState('');
  const [editEnabled, setEditEnabled] = useState(true);
  const [saving, setSaving] = useState(false);

  const factoryById = useMemo(() => {
    const m = new Map<string, (typeof BUILTIN_SKILLS)[number]>();
    for (const s of BUILTIN_SKILLS) m.set(s.id, s);
    return m;
  }, []);

  const sorted = useMemo(() => {
    return [...props.skills].sort((a, b) => {
      const ab = isBuiltinSkillId(a.id) ? 0 : 1;
      const bb = isBuiltinSkillId(b.id) ? 0 : 1;
      if (ab !== bb) return ab - bb;
      return a.name.localeCompare(b.name, 'zh');
    });
  }, [props.skills]);

  const isModifiedBuiltin = (s: SkillRecord): boolean => {
    if (!isBuiltinSkillId(s.id)) return false;
    const factory = factoryById.get(s.id);
    if (!factory) return false;
    return (
      s.systemPrompt !== factory.systemPrompt || s.name !== factory.name
    );
  };

  const startEdit = (s: SkillRecord) => {
    setEditingId(s.id);
    setEditName(s.name);
    setEditPrompt(s.systemPrompt);
    setEditEnabled(s.enabled);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName('');
    setEditPrompt('');
    setEditEnabled(true);
  };

  return (
    <div>
      <div className="card">
        <h2>内置指令</h2>
        <p className="hint">
          首次启动会自动写入下列内置 Skill。名称与提示词均可自由修改，你的改动会永久保留，扩展升级不会覆盖。
          若改乱了，可点「恢复默认」。自定义指令请用下方「新建」创建。
        </p>
        <ul
          className="muted"
          style={{
            margin: '8px 0 0',
            paddingLeft: 18,
            fontSize: 12,
            lineHeight: 1.55,
          }}
        >
          {BUILTIN_SKILLS.map((s) => (
            <li key={s.id}>
              <strong>{s.name}</strong> — {s.description}
            </li>
          ))}
        </ul>
      </div>

      <div className="card">
        <h2>新建自定义指令</h2>
        <label>名称</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例如：口语纠错"
        />
        <label>System prompt</label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="定义 AI 角色与输出格式…"
          style={{ minHeight: 120 }}
        />
        <button
          type="button"
          className="primary"
          disabled={saving || !name.trim() || !prompt.trim()}
          onClick={async () => {
            setSaving(true);
            try {
              await props.onSave({
                name: name.trim(),
                systemPrompt: prompt.trim(),
                enabled: true,
              });
              setName('');
              setPrompt('');
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? '保存中…' : '保存指令'}
        </button>
      </div>

      <div className="card">
        <h2>已有指令 ({sorted.length})</h2>
        {sorted.length === 0 && (
          <p className="muted">
            暂无指令。打开本页或重启扩展会自动注入内置 Skill。
          </p>
        )}
        {sorted.map((s) => {
          const builtin = isBuiltinSkillId(s.id);
          const modified = isModifiedBuiltin(s);
          const editing = editingId === s.id;
          const factory = factoryById.get(s.id);
          return (
            <div className="word-item" key={s.id}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  flexWrap: 'wrap',
                }}
              >
                <strong>{s.name}</strong>
                {builtin && (
                  <span
                    style={{
                      fontSize: 11,
                      padding: '1px 7px',
                      borderRadius: 999,
                      background:
                        'color-mix(in srgb, var(--rf-brand) 22%, transparent)',
                      border: '1px solid var(--rf-border)',
                    }}
                  >
                    内置
                  </span>
                )}
                {modified && (
                  <span
                    style={{
                      fontSize: 11,
                      padding: '1px 7px',
                      borderRadius: 999,
                      background: 'rgba(245, 158, 11, 0.15)',
                      color: '#fbbf24',
                      border: '1px solid rgba(245, 158, 11, 0.35)',
                    }}
                  >
                    已自定义
                  </span>
                )}
                {!s.enabled && (
                  <span className="muted" style={{ fontSize: 11 }}>
                    已禁用
                  </span>
                )}
              </div>
              {factory?.description && (
                <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                  {factory.description}
                </div>
              )}

              {editing ? (
                <div style={{ marginTop: 10 }}>
                  <label>名称</label>
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    placeholder="指令名称"
                  />
                  <label>System prompt</label>
                  <textarea
                    value={editPrompt}
                    onChange={(e) => setEditPrompt(e.target.value)}
                    style={{ minHeight: 200 }}
                  />
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={editEnabled}
                      onChange={(e) => setEditEnabled(e.target.checked)}
                    />
                    启用此指令
                  </label>
                  <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="primary"
                      disabled={
                        saving || !editName.trim() || !editPrompt.trim()
                      }
                      onClick={async () => {
                        setSaving(true);
                        try {
                          await props.onSave({
                            id: s.id,
                            name: editName.trim(),
                            systemPrompt: editPrompt,
                            enabled: editEnabled,
                          });
                          cancelEdit();
                        } finally {
                          setSaving(false);
                        }
                      }}
                    >
                      保存修改
                    </button>
                    {builtin && props.onResetBuiltin && (
                      <button
                        type="button"
                        className="ghost"
                        disabled={saving}
                        onClick={async () => {
                          if (
                            !confirm(
                              '将名称与提示词恢复为出厂默认，覆盖你当前的编辑。确定？',
                            )
                          ) {
                            return;
                          }
                          setSaving(true);
                          try {
                            await props.onResetBuiltin!(s.id);
                            cancelEdit();
                          } finally {
                            setSaving(false);
                          }
                        }}
                      >
                        恢复默认
                      </button>
                    )}
                    <button
                      type="button"
                      className="ghost"
                      onClick={cancelEdit}
                    >
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div
                    className="muted"
                    style={{
                      whiteSpace: 'pre-wrap',
                      marginTop: 8,
                      maxHeight: 120,
                      overflow: 'auto',
                      fontSize: 12,
                      fontFamily: 'ui-monospace, Menlo, monospace',
                    }}
                  >
                    {s.systemPrompt.slice(0, 600)}
                    {s.systemPrompt.length > 600 ? '…' : ''}
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      gap: 8,
                      marginTop: 8,
                      flexWrap: 'wrap',
                      alignItems: 'center',
                    }}
                  >
                    <button
                      type="button"
                      className="primary"
                      onClick={() => startEdit(s)}
                    >
                      编辑
                    </button>
                    {builtin && props.onResetBuiltin && (
                      <button
                        type="button"
                        className="ghost"
                        disabled={saving || !modified}
                        title={
                          modified
                            ? '恢复出厂名称与提示词'
                            : '当前已是默认内容'
                        }
                        onClick={async () => {
                          if (
                            !confirm(
                              '将名称与提示词恢复为出厂默认。确定？',
                            )
                          ) {
                            return;
                          }
                          setSaving(true);
                          try {
                            await props.onResetBuiltin!(s.id);
                          } finally {
                            setSaving(false);
                          }
                        }}
                      >
                        恢复默认
                      </button>
                    )}
                    {!builtin && (
                      <button
                        type="button"
                        className="primary"
                        style={{ background: '#ef4444' }}
                        onClick={() => void props.onDelete(s.id)}
                      >
                        删除
                      </button>
                    )}
                    {builtin && (
                      <span
                        className="muted"
                        style={{ fontSize: 11, alignSelf: 'center' }}
                      >
                        内置指令可改内容；不可删除
                      </span>
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
