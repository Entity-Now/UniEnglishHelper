import { sendRuntime } from '../shared/messaging/client';
import type { WordExplainResult } from '../shared/domain/types';
import { ICON_BTN_CSS, iconActionButton } from './ui-icons';

const POPUP_HOST_ID = 'ueh-word-explain-host';

/**
 * Page-side word explain tooltip.
 * Uses a top-layer host (fixed + max z-index + shadow DOM) so YouTube chrome,
 * player overlays, and the cue-list sidebar cannot cover it.
 *
 * Layout: [word + badge] …… [加生词本] [朗读] [×]
 *          context (原文 + 译文 once)
 *          definition / explanation body
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
        top: max(12px, env(safe-area-inset-top, 0px));
        right: max(12px, env(safe-area-inset-right, 0px));
        width: min(280px, calc(100vw - 24px));
        max-height: min(68vh, 400px);
        display: flex;
        flex-direction: column;
        box-sizing: border-box;
        padding: 0;
        border-radius: 12px;
        background: rgba(16, 17, 22, 0.97);
        color: #fff;
        border: 1px solid rgba(255, 255, 255, 0.14);
        box-shadow: 0 16px 48px rgba(0, 0, 0, 0.55);
        font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
        pointer-events: auto;
        isolation: isolate;
        overflow: hidden;
        overscroll-behavior: contain;
      }
      @media (max-height: 400px), (max-width: 420px) {
        .card {
          top: 0 !important;
          right: 0 !important;
          bottom: 0 !important;
          left: 0 !important;
          width: 100% !important;
          max-height: none !important;
          height: 100% !important;
          border-radius: 0;
        }
      }
      .head {
        display: flex;
        align-items: flex-start;
        gap: 6px;
        padding: 8px 8px 6px 10px;
        border-bottom: 1px solid rgba(255,255,255,.08);
        flex: 0 0 auto;
      }
      .title-row {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 4px 6px;
      }
      .title {
        font-size: 14px;
        font-weight: 700;
        color: oklch(88% 0.08 82);
        word-break: break-word;
        line-height: 1.3;
      }
      .badge {
        font-size: 9px;
        font-weight: 700;
        padding: 1px 6px;
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
      .head-actions {
        display: flex;
        align-items: center;
        gap: 3px;
        flex-shrink: 0;
      }
      .note {
        margin: 6px 10px 0;
        font-size: 11px;
        line-height: 1.35;
        color: oklch(88% 0.08 82 / 0.95);
        background: rgba(255,255,255,.06);
        border-radius: 6px;
        padding: 5px 7px;
        flex: 0 0 auto;
      }
      ${ICON_BTN_CSS}
      .head-actions .ueh-ibtn {
        width: 26px;
        height: 26px;
        border-radius: 7px;
      }
      .head-actions .ueh-ibtn svg {
        width: 13px;
        height: 13px;
      }
      .head-actions .ueh-ibtn.close {
        background: rgba(255,255,255,.08);
        font-size: 15px;
        line-height: 1;
      }
      .head-actions .ueh-ibtn.close:hover {
        background: rgba(255,255,255,.16);
      }
      .ctx-block {
        flex: 0 0 auto;
        margin: 6px 10px 0;
        font-size: 11px;
        line-height: 1.4;
        padding: 5px 7px;
        border-radius: 6px;
        background: rgba(255,255,255,.06);
        white-space: pre-wrap;
        word-break: break-word;
      }
      .ctx-block .orig { opacity: .85; }
      .ctx-block .tr-line {
        margin-top: 3px;
        color: oklch(88% 0.08 82);
        opacity: .95;
      }
      .body {
        margin: 6px 0 0;
        padding: 0 10px 10px;
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
      .def { font-weight: 600; font-size: 13px; color: #fff; margin-bottom: 6px; }
      .err { color: #ef4444; }
      .explain-pre {
        margin: 6px 0 0;
        white-space: pre-wrap;
        font: 12px/1.4 inherit;
        opacity: .9;
      }
    </style>
    <div class="backdrop"></div>
    <div class="card" role="dialog" aria-label="单词释义">
      <div class="head">
        <div class="title-row">
          <div class="title" id="ueh-title"></div>
          <span class="badge" id="ueh-badge" hidden></span>
        </div>
        <div class="head-actions" id="ueh-head-actions">
          ${iconActionButton('add', '加生词本', 'primary', { id: 'ueh-add', disabled: 'true' })}
          ${iconActionButton('tts', '朗读', '', { id: 'ueh-tts' })}
          <button type="button" class="ueh-ibtn close" id="ueh-close" title="关闭" aria-label="关闭">×</button>
        </div>
      </div>
      <div class="ctx-block" id="ueh-ctx-block" hidden></div>
      <div class="note" id="ueh-note" hidden></div>
      <div class="body" id="ueh-popup-body">⏳ 正在查询释义…（AI 超时将自动免费翻译）</div>
    </div>
  `;

  const titleEl = shadow.getElementById('ueh-title');
  if (titleEl) titleEl.textContent = surface;

  /** Top context only — never also inject into body. */
  const renderCtxBlock = (tr?: string) => {
    const ctxBlock = shadow.getElementById('ueh-ctx-block');
    if (!ctxBlock || !context.trim()) {
      if (ctxBlock) ctxBlock.hidden = true;
      return;
    }
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

  // TTS available immediately (doesn't need explain result)
  shadow.getElementById('ueh-tts')?.addEventListener('click', () => {
    void (async () => {
      const res = await sendRuntime<{
        mode: string;
        text?: string;
        voice?: string;
      }>('tts.synth', { text: surface }, 'content');
      if (res.ok && res.data.mode === 'web-speech' && res.data.text) {
        const u = new SpeechSynthesisUtterance(res.data.text);
        u.lang = res.data.voice || 'en-US';
        speechSynthesis.cancel();
        speechSynthesis.speak(u);
      }
    })();
  });

  let timer = window.setTimeout(remove, 25_000);
  let latestExplain: WordExplainResult | null = null;

  const bindAdd = () => {
    const addBtn = shadow.getElementById('ueh-add') as HTMLButtonElement | null;
    if (!addBtn) return;
    addBtn.disabled = false;
    addBtn.onclick = () => {
      void (async () => {
        await sendRuntime(
          'word.add',
          {
            surface,
            context,
            translation: latestExplain?.definition || undefined,
            contextTranslation:
              latestExplain?.contextTranslation || contextTranslation,
            explanation: latestExplain?.explanation,
            explainEngine: latestExplain?.engine ?? 'none',
            explainProvider: latestExplain?.provider,
            kind: 'word',
            sourceUrl: hostDoc.defaultView?.location.href ?? location.href,
            sourceTitle: hostDoc.title || document.title,
          },
          'content',
        );
        onAddSuccess?.();
        remove();
      })();
    };
  };
  // Allow add before explain finishes (context-only entry)
  bindAdd();

  const card = shadow.querySelector('.card') as HTMLElement | null;
  if (card && hostDoc.defaultView) {
    const vw = hostDoc.defaultView.innerWidth;
    if (vw < 480) {
      card.style.left = '50%';
      card.style.right = 'auto';
      card.style.transform = 'translateX(-50%)';
      card.style.width = 'min(280px, calc(100vw - 20px))';
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
      latestExplain = explain;
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

      // Sentence translation only at the top
      const sentenceTr =
        explain.contextTranslation?.trim() || contextTranslation?.trim();
      renderCtxBlock(sentenceTr);

      bodyEl.className = 'body';
      bodyEl.replaceChildren();

      if (def) {
        const d = hostDoc.createElement('div');
        d.className = 'def';
        d.textContent = def;
        bodyEl.appendChild(d);
      }
      if (explain.explanation && explain.engine === 'llm') {
        const pre = hostDoc.createElement('pre');
        pre.className = 'explain-pre';
        pre.textContent = explain.explanation;
        bodyEl.appendChild(pre);
      }
      if (!bodyEl.textContent?.trim()) {
        bodyEl.textContent = surface;
      }

      bindAdd();

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
