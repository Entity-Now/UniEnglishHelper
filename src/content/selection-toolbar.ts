/**
 * Floating selection toolbar (translate / TTS / dictionary / add word).
 * Simplified port of read-frog selection toolbar — vanilla DOM, no React.
 */

import type { AppConfig } from '../shared/domain/types';
import { sendRuntime } from '../shared/messaging/client';
import { ClipPlayer } from './clip-player';
import {
  playTtsAudioChunks,
  stopTtsPlayback,
} from '../utils/tts-playback/play-chunks';

const HOST_ID = 'ueh-selection-host';

export class SelectionToolbar {
  private host: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;
  private config: AppConfig;
  private selectedText = '';
  private hideTimer = 0;
  private boundMouseUp: (e: MouseEvent) => void;
  private boundKeyDown: (e: KeyboardEvent) => void;
  private boundScroll: () => void;

  constructor(config: AppConfig) {
    this.config = config;
    this.boundMouseUp = (e) => this.onMouseUp(e);
    this.boundKeyDown = (e) => {
      if (e.key === 'Escape') this.hide();
    };
    this.boundScroll = () => this.hide();
  }

  updateConfig(config: AppConfig): void {
    this.config = config;
    if (!config.selectionToolbar?.enabled) this.hide();
  }

  start(): void {
    document.addEventListener('mouseup', this.boundMouseUp, true);
    document.addEventListener('keydown', this.boundKeyDown, true);
    window.addEventListener('scroll', this.boundScroll, true);
  }

  stop(): void {
    document.removeEventListener('mouseup', this.boundMouseUp, true);
    document.removeEventListener('keydown', this.boundKeyDown, true);
    window.removeEventListener('scroll', this.boundScroll, true);
    this.host?.remove();
    this.host = null;
    this.shadow = null;
  }

  private ensureUi(): ShadowRoot {
    if (this.shadow) return this.shadow;
    let host = document.getElementById(HOST_ID);
    if (!host) {
      host = document.createElement('div');
      host.id = HOST_ID;
      host.setAttribute('data-ueh-overlay', 'selection');
      host.style.cssText =
        'all:initial;position:fixed;z-index:2147483646;pointer-events:none;';
      document.documentElement.appendChild(host);
    }
    this.host = host;
    this.shadow = host.attachShadow({ mode: 'open' });
    this.shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .bar {
          pointer-events: auto;
          display: flex; gap: 4px; align-items: center;
          padding: 6px 8px;
          border-radius: 12px;
          background: rgba(16,17,22,.96);
          border: 1px solid rgba(255,255,255,.12);
          box-shadow: 0 10px 30px rgba(0,0,0,.35);
          font-family: system-ui, -apple-system, sans-serif;
          color: #f5f5f5;
        }
        button {
          border: 0; border-radius: 8px;
          background: rgba(255,255,255,.1);
          color: #fff; cursor: pointer;
          padding: 6px 10px; font-size: 12px; font-weight: 600;
        }
        button:hover { background: rgba(255,255,255,.18); }
        button.brand { background: oklch(76% 0.12 82); color: #1a1a1a; }
        .panel {
          pointer-events: auto;
          margin-top: 6px;
          max-width: min(360px, 90vw);
          max-height: 240px;
          overflow: auto;
          padding: 10px 12px;
          border-radius: 12px;
          background: rgba(16,17,22,.97);
          border: 1px solid rgba(255,255,255,.12);
          font-size: 13px; line-height: 1.45;
          white-space: pre-wrap; word-break: break-word;
          color: #f0f0f0;
          font-family: system-ui, -apple-system, sans-serif;
          display: none;
        }
        .panel.open { display: block; }
        .wrap { position: fixed; pointer-events: none; }
      </style>
      <div class="wrap" id="wrap">
        <div class="bar" id="bar"></div>
        <div class="panel" id="panel"></div>
      </div>
    `;
    return this.shadow;
  }

  private onMouseUp(e: MouseEvent): void {
    if (!this.config.selectionToolbar?.enabled) return;
    // Ignore clicks inside our UI
    if ((e.target as Element)?.closest?.(`#${HOST_ID}`)) return;
    if (this.host?.contains(e.target as Node)) return;

    window.clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => {
      const sel = window.getSelection();
      const text = sel?.toString().trim() ?? '';
      if (!text || text.length > 2000) {
        this.hide();
        return;
      }
      // Don't show on empty or pure whitespace
      if (!/\S/.test(text)) {
        this.hide();
        return;
      }
      // Avoid toolbar inside editable fields unless user selected text intentionally
      const active = document.activeElement;
      if (
        active &&
        (active instanceof HTMLInputElement ||
          active instanceof HTMLTextAreaElement ||
          (active as HTMLElement).isContentEditable)
      ) {
        // still allow if selection is non-empty
      }
      this.selectedText = text;
      const range = sel?.rangeCount ? sel.getRangeAt(0) : null;
      const rect = range?.getBoundingClientRect();
      if (!rect || (rect.width === 0 && rect.height === 0)) {
        this.hide();
        return;
      }
      this.showAt(rect.left + rect.width / 2, rect.top);
    }, 10);
  }

  private showAt(x: number, y: number): void {
    const shadow = this.ensureUi();
    const wrap = shadow.getElementById('wrap') as HTMLElement;
    const bar = shadow.getElementById('bar') as HTMLElement;
    const panel = shadow.getElementById('panel') as HTMLElement;
    const tb = this.config.selectionToolbar;

    bar.innerHTML = '';
    if (tb.showTranslate) {
      bar.appendChild(
        this.mkBtn('翻译', 'brand', () => void this.runTranslate(panel)),
      );
    }
    if (tb.showDictionary) {
      bar.appendChild(
        this.mkBtn('词典', '', () => void this.runExplain(panel)),
      );
    }
    if (tb.showTts) {
      bar.appendChild(this.mkBtn('朗读', '', () => void this.runTts()));
    }
    if (tb.showAddWord) {
      bar.appendChild(
        this.mkBtn('生词', '', () => void this.runAddWord(panel)),
      );
    }
    bar.appendChild(this.mkBtn('×', '', () => this.hide()));

    panel.classList.remove('open');
    panel.textContent = '';

    const left = Math.max(8, Math.min(window.innerWidth - 200, x - 80));
    const top = Math.max(8, y - 48);
    wrap.style.left = `${left}px`;
    wrap.style.top = `${top}px`;
    wrap.style.display = 'block';
  }

  private mkBtn(
    label: string,
    cls: string,
    onClick: () => void,
  ): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    if (cls) b.className = cls;
    b.addEventListener('mousedown', (e) => {
      // keep selection
      e.preventDefault();
      e.stopPropagation();
    });
    b.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    });
    return b;
  }

  private hide(): void {
    if (!this.shadow) return;
    const wrap = this.shadow.getElementById('wrap');
    if (wrap) wrap.style.display = 'none';
  }

  private async runTranslate(panel: HTMLElement): Promise<void> {
    panel.classList.add('open');
    panel.textContent = '翻译中…';
    const res = await sendRuntime<{ items: { id: string; text: string }[] }>(
      'translate.cues',
      {
        cues: [{ id: 'sel', text: this.selectedText }],
        src: this.config.sourceLang,
        dst: this.config.targetLang,
        mode: 'mt',
      },
      'content',
    );
    panel.textContent = res.ok
      ? res.data.items[0]?.text || '（空结果）'
      : res.error.message;
  }

  private async runExplain(panel: HTMLElement): Promise<void> {
    panel.classList.add('open');
    panel.textContent = '查询中…';
    const res = await sendRuntime<{
      text?: string;
      definition?: string;
      contextTranslation?: string;
      note?: string;
      explanation?: string;
      engine?: string;
    }>(
      'word.explain',
      {
        word: this.selectedText,
        surface: this.selectedText,
        context: this.selectedText,
      },
      'content',
    );
    if (!res.ok) {
      panel.textContent = res.error.message;
      return;
    }
    const d = res.data;
    const lines = [
      d.definition,
      d.contextTranslation ? `句子译文：${d.contextTranslation}` : '',
      d.engine === 'llm' && d.explanation ? d.explanation : '',
      d.note ? `（${d.note}）` : '',
    ].filter(Boolean);
    panel.textContent = lines.join('\n\n') || d.text || this.selectedText;
  }

  private async runTts(): Promise<void> {
    // Prefer base64 chunks for smooth sequential playback (no MP3 concat glitch).
    if (this.config.tts?.engine === 'edge' && this.config.features.enableEdgeTts) {
      const chunksRes = await sendRuntime<{
        mode: string;
        voice: string;
        chunks: Array<{ audioBase64: string; contentType: string }>;
      }>('tts.synthChunks', { text: this.selectedText }, 'content');

      if (chunksRes.ok && chunksRes.data.chunks?.length) {
        stopTtsPlayback();
        await playTtsAudioChunks(chunksRes.data.chunks);
        return;
      }
    }

    const res = await sendRuntime<{
      mode: string;
      text?: string;
      voice?: string;
      clipId?: number;
      clipIds?: number[];
    }>('tts.synth', { text: this.selectedText }, 'content');

    if (!res.ok) return;

    if (res.data.mode === 'web-speech' && res.data.text) {
      if (typeof speechSynthesis !== 'undefined') {
        const u = new SpeechSynthesisUtterance(res.data.text);
        u.lang = res.data.voice || 'en-US';
        speechSynthesis.cancel();
        speechSynthesis.speak(u);
      }
      return;
    }

    const ids =
      res.data.clipIds?.length
        ? res.data.clipIds
        : res.data.clipId != null
          ? [res.data.clipId]
          : [];
    if (!ids.length) return;

    const player = new ClipPlayer();
    await player.playSequence(ids, () => undefined);
  }

  private async runAddWord(panel: HTMLElement): Promise<void> {
    const surface = this.selectedText.split(/\s+/).slice(0, 6).join(' ');
    // Prefer structured explain first when possible
    const exp = await sendRuntime<{
      definition?: string;
      contextTranslation?: string;
      explanation?: string;
      engine?: 'llm' | 'free_mt' | 'none';
      provider?: string;
    }>(
      'word.explain',
      {
        word: surface,
        surface,
        context: this.selectedText.slice(0, 500),
      },
      'content',
    );
    const res = await sendRuntime(
      'word.add',
      {
        surface,
        context: this.selectedText.slice(0, 500),
        translation: exp.ok ? exp.data.definition : undefined,
        contextTranslation: exp.ok ? exp.data.contextTranslation : undefined,
        explanation: exp.ok ? exp.data.explanation : undefined,
        explainEngine: exp.ok ? exp.data.engine : 'none',
        explainProvider: exp.ok ? exp.data.provider : undefined,
        kind: surface.includes(' ') && surface.split(/\s+/).length > 3
          ? 'sentence'
          : 'word',
        sourceUrl: location.href,
        sourceTitle: document.title,
      },
      'content',
    );
    panel.classList.add('open');
    panel.textContent = res.ok
      ? `已加入生词本：${surface}`
      : res.error.message;
  }
}
