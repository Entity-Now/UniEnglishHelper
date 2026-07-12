import { sendRuntime } from '../shared/messaging/client';
import type { WordExplainResult } from '../shared/domain/types';

export async function showWordExplainPopup(
  surface: string,
  context: string,
  hostDoc: Document = document,
  onAddSuccess?: () => void,
): Promise<void> {
  const note = hostDoc.createElement('div');
  note.style.cssText = `
    position:fixed;z-index:2147483647;right:16px;top:16px;width:280px;max-width:320px;
    background:rgba(16,17,22,.96);color:#fff;border:1px solid rgba(255,255,255,.12);
    border-radius:12px;padding:12px;font:13px/1.45 system-ui;
    box-shadow:0 12px 40px rgba(0,0,0,.4);
  `;

  function escapeHtml(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Initial loading state HTML (instant display)
  note.innerHTML = `
    <strong style="color:oklch(88% 0.08 82);font-size:14px;">${escapeHtml(surface)}</strong>
    <div id="ueh-popup-body" style="margin-top:12px;font-size:12px;color:#bbb;">
      ⏳ 正在查询释义与上下文翻译...
    </div>
    <div style="margin-top:12px;display:flex;justify-content:flex-end;">
      <button type="button" id="ueh-close" style="border:0;border-radius:8px;padding:6px 12px;background:rgba(255,255,255,.1);color:#fff;cursor:pointer;font-size:11px;">关闭</button>
    </div>
  `;

  hostDoc.documentElement.appendChild(note);

  const closeBtn = note.querySelector('#ueh-close');
  closeBtn?.addEventListener('click', () => note.remove());

  // Set timeout to auto-remove
  let timer = window.setTimeout(() => note.remove(), 25_000);

  // Await background retrieval
  sendRuntime<WordExplainResult & { text?: string }>(
    'word.explain',
    { word: surface, surface, context },
    'content',
  ).then((res) => {
    if (!hostDoc.documentElement.contains(note)) return;

    const bodyEl = note.querySelector('#ueh-popup-body') as HTMLElement;
    if (!bodyEl) return;

    if (!res.ok) {
      bodyEl.style.color = '#ef4444';
      bodyEl.textContent = `查询失败: ${res.error.message}`;
      return;
    }

    const explain = res.data;
    const def = explain.definition || explain.text || '';
    
    // Build definition layout
    let html = '';
    if (def) {
      html += `<div style="font-weight:600;font-size:13px;color:#fff;margin-bottom:8px;">${escapeHtml(def)}</div>`;
    }
    if (context) {
      html += `<div style="margin-top:8px;opacity:.7;font-size:12px;line-height:1.4;">原文：${escapeHtml(context)}</div>`;
    }
    if (explain.contextTranslation) {
      html += `<div style="margin-top:4px;opacity:.85;font-size:12px;color:oklch(88% 0.08 82)">译文：${escapeHtml(explain.contextTranslation)}</div>`;
    }
    if (explain.note) {
      html += `<div style="margin-top:8px;font-size:11px;opacity:.5">${escapeHtml(explain.note)}</div>`;
    }

    bodyEl.innerHTML = html;
    bodyEl.style.color = '';

    // Add final controls
    const buttonsRow = hostDoc.createElement('div');
    buttonsRow.style.cssText = 'margin-top:12px;display:flex;gap:8px;';
    buttonsRow.innerHTML = `
      <button type="button" id="ueh-add" style="flex:1;border:0;border-radius:8px;padding:8px;background:oklch(76% 0.12 82);font-weight:700;cursor:pointer;font-size:12px;">加生词本</button>
      <button type="button" id="ueh-close-active" style="border:0;border-radius:8px;padding:8px 10px;background:rgba(255,255,255,.12);color:#fff;cursor:pointer;font-size:12px;">关闭</button>
    `;

    const oldCloseRow = note.lastElementChild;
    if (oldCloseRow) oldCloseRow.remove();
    note.appendChild(buttonsRow);

    note.querySelector('#ueh-close-active')?.addEventListener('click', () => note.remove());
    note.querySelector('#ueh-add')?.addEventListener('click', async () => {
      await sendRuntime(
        'word.add',
        {
          surface,
          context,
          translation: explain.definition || undefined,
          contextTranslation: explain.contextTranslation,
          explanation: explain.explanation,
          explainEngine: explain.engine ?? 'none',
          explainProvider: explain.provider,
          kind: 'word',
          sourceUrl: hostDoc.defaultView?.location.href ?? location.href,
          sourceTitle: hostDoc.title || document.title,
        },
        'content',
      );
      if (onAddSuccess) {
        onAddSuccess();
      }
      note.remove();
    });
  }).catch((err) => {
    if (hostDoc.documentElement.contains(note)) {
      const bodyEl = note.querySelector('#ueh-popup-body') as HTMLElement;
      if (bodyEl) {
        bodyEl.style.color = '#ef4444';
        bodyEl.textContent = `查询异常: ${err instanceof Error ? err.message : String(err)}`;
      }
    }
  });
}
