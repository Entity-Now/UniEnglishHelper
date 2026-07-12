import React from 'react';
import type { AppConfig } from '../../shared/domain/types';
import { DEFAULT_APP_CONFIG } from '../../shared/domain/types';
import { EXT_VERSION } from '../../shared/version';
import { sendRuntime } from '../../shared/messaging/client';

export function ConfigPage(props: {
  config: AppConfig;
  onSave: (p: Partial<AppConfig>) => Promise<void>;
  onToast: (msg: string) => void;
}) {
  return (
    <div>
      <h1 className="page-title">配置 / 关于</h1>
      <p className="page-desc">备份、重置与项目信息（对应 read-frog Config）。</p>

      <div className="card">
        <h2>关于</h2>
        <p className="hint">
          UniEnglishHelper v{EXT_VERSION} · GPL-3.0-or-later
          <br />
          YouTube 字幕管线与部分设计 token 改编自{' '}
          <a
            href="https://github.com/mengxi-ream/read-frog"
            target="_blank"
            rel="noreferrer"
          >
            read-frog
          </a>
          。
        </p>
      </div>

      <div className="card">
        <h2>诊断导出</h2>
        <p className="hint">导出配置摘要（API Key 已脱敏）便于排查问题。</p>
        <button
          type="button"
          className="primary"
          onClick={async () => {
            const res = await sendRuntime<Record<string, unknown>>(
              'diag.export',
              {},
              'options',
            );
            if (!res.ok) {
              props.onToast(res.error.message);
              return;
            }
            const blob = new Blob([JSON.stringify(res.data, null, 2)], {
              type: 'application/json',
            });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `ueh-diag-${Date.now()}.json`;
            a.click();
            URL.revokeObjectURL(url);
            props.onToast('已导出诊断包');
          }}
        >
          导出诊断 JSON
        </button>
      </div>

      <div className="card">
        <h2>重置</h2>
        <p className="hint">恢复默认配置（不会清空生词本与音频库）。</p>
        <button
          type="button"
          className="ghost"
          onClick={async () => {
            if (!confirm('确定恢复默认配置？')) return;
            await props.onSave(DEFAULT_APP_CONFIG);
            props.onToast('已恢复默认配置');
          }}
        >
          恢复默认配置
        </button>
      </div>

      <div className="card">
        <h2>当前配置快照</h2>
        <pre
          className="muted"
          style={{
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            fontSize: 11,
            maxHeight: 240,
            overflow: 'auto',
          }}
        >
          {JSON.stringify(
            {
              ...props.config,
              ai: {
                ...props.config.ai,
                apiKeys: Object.fromEntries(
                  Object.keys(props.config.ai.apiKeys).map((k) => [k, '***']),
                ),
              },
            },
            null,
            2,
          )}
        </pre>
      </div>
    </div>
  );
}
