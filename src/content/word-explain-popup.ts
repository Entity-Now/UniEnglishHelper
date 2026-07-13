import { sendRuntime } from '../shared/messaging/client';
import type { WordExplainResult } from '../shared/domain/types';

const POPUP_HOST_ID = 'ueh-word-explain-host';

/**
 * Page-side word explain tooltip.
 * Uses a top-layer host (fixed + max z-index + shadow DOM) so YouTube chrome,
 * player overlays, and the cue-list sidebar cannot cover it.
 */
export async function showWordExplainPopup(
  surface: string,
  context: string,
  hostDoc: Document = document,
  onAddSuccess?: () => void,
  contextTranslation?: string,
): Promise<void> {
  // One host at a time
  hostDoc.getElementById(POPUP_HOST_ID)?.remove();

  const host = hostDoc.createElement('div');
  host.id = POPUP_HOST_ID;
  host.setAttribute('data-ueh-overlay', 'word-explain');
  // Stay above almost all page UI including YouTube masthead / theater
  host.style.cssText = `
    all: initial;
    position: fixed !important;
    inset: 0 !important;
    z-index: 2147483646 !important;
    pointer-events: none !important;
    display: block !important;
  `;
  hostDoc.documentElement.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });

  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      .backdrop {
        position: fixed;
        inset: 0;
        pointer-events: none;
      }
      .card {
        position: fixed;
        top: max(16px, env(safe-area-inset-top, 0px));
        right: max(16px, env(safe-area-inset-right, 0px));
        width: min(300px, calc(100vw - 32px));
        max-height: min(70vh, 440px);
        display: flex;
        flex-direction: column;
        box-sizing: border-box;
        padding: 12px;
        border-radius: 14px;
        background: rgba(16, 17, 22, 0.97);
        color: #fff;
        border: 1px solid rgba(255, 255, 255, 0.14);
        box-shadow: 0 16px 48px rgba(0, 0, 0, 0.55);
        font: 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif;
        pointer-events: auto;
        isolation: isolate;
        overflow: hidden;
        overscroll-behavior: contain;
      }
      .title-row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px 8px;
        padding-right: 28px;
      }
      .title {
        font-size: 15px;
        font-weight: 700;
        color: oklch(88% 0.08 82);
        word-break: break-word;
      }
      .badge {
        font-size: 10px;
        font-weight: 700;
        padding: 2px 7px;
        border-radius: 999px;
        line-height: 1.3;
      }
      .badge.llm {
        background: color-mix(in srgb, oklch(76% 0.12 82) 35%, transparent);
        color: oklch(92% 0.06 82);
        border: 1px solid color-mix(in srgb, oklch(76% 0.12 82) 55%, transparent);
      }
      .badge.free {
        background: color-mix(in srgb, oklch(72% 0.14 145) 28%, transparent);
        color: oklch(88% 0.08 145);
        border: 1px solid color-mix(in srgb, oklch(72% 0.14 145) 50%, transparent);
      }
      .badge.none {
        background: rgba(255, 80, 80, 0.18);
        color: #ffb4a9;
        border: 1px solid rgba(255, 100, 100, 0.35);
      }
      .note {
        margin-top: 8px;
        font-size: 11px;
        line-height: 1.35;
        color: oklch(88% 0.08 82 / 0.95);
        background: rgba(255,255,255,.06);
        border-radius: 8px;
        padding: 6px 8px;
      }
      .close-x {
        position: absolute;
        top: 8px;
        right: 8px;
        width: 28px;
        height: 28px;
        border: 0;
        border-radius: 8px;
        background: rgba(255,255,255,.1);
        color: #fff;
        cursor: pointer;
        font-size: 16px;
        line-height: 1;
      }
      .close-x:hover { background: rgba(255,255,255,.18); }
      .body {
        margin-top: 10px;
        flex: 1 1 auto;
        min-height: 0;
        overflow-x: hidden;
        overflow-y: auto;
        overscroll-behavior: contain;
        font-size: 12px;
        color: #bbb;
        scrollbar-width: thin;
        scrollbar-color: rgba(255,255,255,.25) transparent;
      }
      .body::-webkit-scrollbar { width: 5px; }
      .body::-webkit-scrollbar-thumb {
        background: rgba(255,255,255,.22);
        border-radius: 999px;
      }
      .ctx-block {
        margin-top: 8px;
        font-size: 11px;
        line-height: 1.45;
        padding: 6px 8px;
        border-radius: 8px;
        background: rgba(255,255,255,.06);
        white-space: pre-wrap;
      }
      .ctx-block .orig { opacity: .85; }
      .ctx-block .tr-line {
        margin-top: 4px;
        color: oklch(88% 0.08 82);
        opacity: .95;
      }
      .def { font-weight: 600; font-size: 13px; color: #fff; margin-bottom: 8px; }
      .ctx { margin-top: 8px; opacity: .7; font-size: 12px; line-height: 1.4; }
      .tr { margin-top: 4px; opacity: .9; font-size: 12px; color: oklch(88% 0.08 82); }
      .err { color: #ef4444; }
      .actions {
        margin-top: 12px;
        display: flex;
        gap: 8px;
        flex: 0 0 auto;
      }
      .actions button {
        border: 0;
        border-radius: 8px;
        padding: 8px 10px;
        cursor: pointer;
        font-size: 12px;
        font-weight: 600;
      }
      .actions .add {
        flex: 1;
        background: oklch(76% 0.12 82);
        color: #1a1a1a;
        font-weight: 700;
      }
      .actions .close {
        background: rgba(255,255,255,.12);
        color: #fff;
      }
    </style>
    <div class="backdrop"></div>
    <div class="card" role="dialog" aria-label="单词释义">
      <button type="button" class="close-x" id="ueh-close" title="关闭" aria-label="关闭">×</button>
      <div class="title-row">
        <div class="title" id="ueh-title"></div>
        <span class="badge" id="ueh-badge" hidden></span>
      </div>
      <div class="ctx-block" id="ueh-ctx-block" hidden></div>
      <div class="body" id="ueh-popup-body">⏳ 正在查询释义…（AI 超时将自动免费翻译）</div>
      <div class="note" id="ueh-note" hidden></div>
      <div class="actions" id="ueh-actions">
        <button type="button" class="close" id="ueh-close-footer">关闭</button>
      </div>
    </div>
  `;

  const titleEl = shadow.getElementById('ueh-title');
  if (titleEl) titleEl.textContent = surface;

  const renderCtxBlock = (tr?: string) => {
    const ctxBlock = shadow.getElementById('ueh-ctx-block');
    if (!ctxBlock || !context.trim()) return;
    ctxBlock.hidden = false;
    ctxBlock.replaceChildren();
    const orig = hostDoc.createElement('div');
    orig.className = 'orig';
    orig.textContent = `原文：${context}`;
    ctxBlock.appendChild(orig);
    const line = (tr ?? contextTranslation)?.trim();
    if (line) {
      const trEl = hostDoc.createElement('div');
      trEl.className = 'tr-line';
      trEl.textContent = `译文：${line}`;
      ctxBlock.appendChild(trEl);
    }
  };
  renderCtxBlock();

  const remove = () => {
    window.clearTimeout(timer);
    host.remove();
  };

  shadow.getElementById('ueh-close')?.addEventListener('click', remove);
  shadow
    .getElementById('ueh-close-footer')
    ?.addEventListener('click', remove);

  let timer = window.setTimeout(remove, 25_000);

  // Reposition if top-right would sit under a dense right column on wide pages
  const card = shadow.querySelector('.card') as HTMLElement | null;
  if (card && hostDoc.defaultView) {
    const vw = hostDoc.defaultView.innerWidth;
    // On narrow viewports center the card
    if (vw < 480) {
      card.style.left = '50%';
      card.style.right = 'auto';
      card.style.transform = 'translateX(-50%)';
      card.style.width = 'min(300px, calc(100vw - 24px))';
    }
  }

  sendRuntime<WordExplainResult & { text?: string }>(
    'word.explain',
    { word: surface, surface, context },
    'content',
  )
    .then((res) => {
      if (!hostDoc.documentElement.contains(host)) return;

      const bodyEl = shadow.getElementById('ueh-popup-body');
      if (!bodyEl) return;

      const badgeEl = shadow.getElementById('ueh-badge');
      const noteEl = shadow.getElementById('ueh-note');

      if (!res.ok) {
        bodyEl.className = 'body err';
        bodyEl.textContent = `查询失败: ${res.error.message}`;
        if (badgeEl) {
          badgeEl.hidden = false;
          badgeEl.className = 'badge none';
          badgeEl.textContent = '不可用';
        }
        return;
      }

      const explain = res.data;
      const def = explain.definition || explain.text || '';

      if (badgeEl) {
        badgeEl.hidden = false;
        if (explain.engine === 'llm') {
          badgeEl.className = 'badge llm';
          badgeEl.textContent = 'AI 释义';
        } else if (explain.engine === 'free_mt') {
          badgeEl.className = 'badge free';
          badgeEl.textContent = '免费翻译';
        } else {
          badgeEl.className = 'badge none';
          badgeEl.textContent = '不可用';
        }
      }
      if (noteEl) {
        if (explain.note) {
          noteEl.hidden = false;
          noteEl.textContent = explain.note;
        } else {
          noteEl.hidden = true;
          noteEl.textContent = '';
        }
      }

      bodyEl.className = 'body';
      bodyEl.replaceChildren();

      if (def) {
        const d = hostDoc.createElement('div');
        d.className = 'def';
        d.textContent = def;
        bodyEl.appendChild(d);
      }
      const sentenceTr =
        explain.contextTranslation?.trim() || contextTranslation?.trim();
      renderCtxBlock(sentenceTr);
      if (context && !shadow.getElementById('ueh-ctx-block')?.childElementCount) {
        const c = hostDoc.createElement('div');
        c.className = 'ctx';
        c.textContent = `原文：${context}`;
        bodyEl.appendChild(c);
      }
      if (sentenceTr && !shadow.getElementById('ueh-ctx-block')?.querySelector('.tr-line')) {
        const t = hostDoc.createElement('div');
        t.className = 'tr';
        t.textContent = `译文：${sentenceTr}`;
        bodyEl.appendChild(t);
      }
      if (explain.explanation && explain.engine === 'llm') {
        const pre = hostDoc.createElement('pre');
        pre.style.cssText =
          'margin:8px 0 0;white-space:pre-wrap;font:12px/1.45 inherit;opacity:.9';
        pre.textContent = explain.explanation;
        bodyEl.appendChild(pre);
      }
      if (!bodyEl.textContent?.trim()) {
        bodyEl.textContent = surface;
      }

      const actions = shadow.getElementById('ueh-actions');
      if (actions) {
        actions.innerHTML = `
          <button type="button" class="add" id="ueh-add">加生词本</button>
          <button type="button" class="close" id="ueh-close-active">关闭</button>
        `;
        shadow
          .getElementById('ueh-close-active')
          ?.addEventListener('click', remove);
        shadow.getElementById('ueh-add')?.addEventListener('click', () => {
          void (async () => {
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
                sourceUrl:
                  hostDoc.defaultView?.location.href ?? location.href,
                sourceTitle: hostDoc.title || document.title,
              },
              'content',
            );
            onAddSuccess?.();
            remove();
          })();
        });
      }

      // Reset auto-dismiss after content loads
      window.clearTimeout(timer);
      timer = window.setTimeout(remove, 25_000);
    })
    .catch((err) => {
      if (!hostDoc.documentElement.contains(host)) return;
      const bodyEl = shadow.getElementById('ueh-popup-body');
      if (bodyEl) {
        bodyEl.className = 'body err';
        bodyEl.textContent = `查询异常: ${
          err instanceof Error ? err.message : String(err)
        }`;
      }
    });
}
