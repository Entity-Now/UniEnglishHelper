/**
 * Mirror page <video> into Document PiP with both video frames + audio.
 *
 * Performance notes:
 * - Canvas is capped to PiP display size (not full source resolution).
 * - Draw rate is capped (~24–30 fps); skips while paused / no new frames.
 * - Draw loop prefers the PiP window's rAF so it stays smooth when the tab is backgrounded.
 * - Non-YouTube: page canvas + captureStream mux with element audio.
 * - YouTube: drawImage into a PiP canvas (captureStream is often black).
 * Original page video is muted while PiP has audio to avoid double sound.
 */

export type MirrorHandle = {
  mode: 'av-mirror' | 'video-only' | 'none';
  stop: () => void;
};

/** Max long-edge for mirror canvas (saves GPU on 1080p/4K sources). */
const MAX_CANVAS_EDGE = 960;
/** Target draw rate while playing. */
const TARGET_FPS = 24;
const FRAME_MS = 1000 / TARGET_FPS;

function isYouTubeHost(): boolean {
  const h = location.hostname;
  return h.includes('youtube.com') || h.includes('youtu.be');
}

/**
 * Compute a canvas size that fits the PiP slot (or fallback dims) while
 * preserving source aspect ratio and never exceeding MAX_CANVAS_EDGE.
 */
function computeCanvasSize(
  source: HTMLVideoElement,
  slot: HTMLElement,
  dprCap = 1.25,
): { w: number; h: number } {
  const sw = Math.max(2, source.videoWidth || 1280);
  const sh = Math.max(2, source.videoHeight || 720);
  const srcAr = sw / sh;

  const rect = slot.getBoundingClientRect();
  const slotW = Math.max(2, rect.width || slot.clientWidth || 480);
  const slotH = Math.max(2, rect.height || slot.clientHeight || 270);
  const dpr = Math.min(
    typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
    dprCap,
  );

  // Fit source aspect into the slot box
  let tw: number;
  let th: number;
  const slotAr = slotW / slotH;
  if (srcAr > slotAr) {
    tw = slotW * dpr;
    th = tw / srcAr;
  } else {
    th = slotH * dpr;
    tw = th * srcAr;
  }

  // Cap long edge
  const long = Math.max(tw, th);
  if (long > MAX_CANVAS_EDGE) {
    const s = MAX_CANVAS_EDGE / long;
    tw *= s;
    th *= s;
  }

  // Never upscale beyond source
  if (tw > sw || th > sh) {
    const s = Math.min(sw / tw, sh / th);
    tw *= s;
    th *= s;
  }

  return {
    w: Math.max(2, Math.round(tw)),
    h: Math.max(2, Math.round(th)),
  };
}

function captureElementAudio(source: HTMLVideoElement): {
  tracks: MediaStreamTrack[];
  stream: MediaStream | null;
} {
  try {
    const src = source as HTMLVideoElement & {
      captureStream?: () => MediaStream;
      mozCaptureStream?: () => MediaStream;
    };
    const capture =
      src.captureStream?.bind(source) ?? src.mozCaptureStream?.bind(source);
    if (!capture) return { tracks: [], stream: null };
    const stream = capture();
    return { tracks: stream.getAudioTracks(), stream };
  } catch (err) {
    console.warn('[UEH] audio captureStream failed', err);
    return { tracks: [], stream: null };
  }
}

type DrawLoopOpts = {
  /** Prefer PiP window rAF so mirror stays smooth while tab is backgrounded. */
  animWindow: Window;
  source: HTMLVideoElement;
  draw: (vw: number, vh: number) => void;
  /** Optional: only redraw when size recipe changes. */
  onResizeNeed?: () => void;
};

function startCappedDrawLoop(opts: DrawLoopOpts): () => void {
  const { animWindow, source, draw, onResizeNeed } = opts;
  let raf = 0;
  let stopped = false;
  let lastDraw = 0;
  let lastPaused = true; // force one paint on start

  const schedule = (cb: FrameRequestCallback) => {
    try {
      return animWindow.requestAnimationFrame(cb);
    } catch {
      return requestAnimationFrame(cb);
    }
  };
  const cancel = (id: number) => {
    try {
      animWindow.cancelAnimationFrame(id);
    } catch {
      cancelAnimationFrame(id);
    }
  };

  const paint = (now: number) => {
    if (stopped) return;
    lastDraw = now;
    try {
      const vw = source.videoWidth;
      const vh = source.videoHeight;
      if (vw > 2 && vh > 2) {
        onResizeNeed?.();
        draw(vw, vh);
      }
    } catch {
      // ignore frame errors
    }
  };

  const tick = (now: number) => {
    if (stopped) return;
    const paused = source.paused;
    if (paused) {
      // One cover frame when entering pause / first frame; then idle lightly
      if (!lastPaused || lastDraw === 0) paint(now);
      lastPaused = true;
    } else {
      lastPaused = false;
      if (now - lastDraw >= FRAME_MS - 1) paint(now);
    }
    raf = schedule(tick);
  };

  raf = schedule(tick);

  return () => {
    stopped = true;
    cancel(raf);
  };
}

export function startVideoMirror(
  source: HTMLVideoElement,
  pipWindow: Window,
  slot: HTMLElement,
): MirrorHandle {
  slot.innerHTML = '';

  const wasMuted = source.muted;
  const wasVolume = source.volume;
  const youtube = isYouTubeHost();

  // ── Non-YouTube: page canvas → captureStream + element audio ───────────
  if (!youtube) {
    try {
      const pageCanvas = document.createElement('canvas');
      const size = computeCanvasSize(source, slot);
      pageCanvas.width = size.w;
      pageCanvas.height = size.h;
      pageCanvas.setAttribute('data-ueh-mirror', '1');
      pageCanvas.style.cssText =
        'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0.01;pointer-events:none;z-index:-1;';
      document.documentElement.appendChild(pageCanvas);

      const ctx = pageCanvas.getContext('2d', {
        alpha: false,
        desynchronized: true,
      });
      if (!ctx) throw new Error('no 2d context');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'low';

      let lastW = size.w;
      let lastH = size.h;
      let resizeAccum = 0;

      const stopLoop = startCappedDrawLoop({
        // Page canvas must be drawn from page context for captureStream
        animWindow: window,
        source,
        onResizeNeed: () => {
          // Throttle size recompute (slot resize / layout)
          resizeAccum++;
          if (resizeAccum % 8 !== 0) return;
          const next = computeCanvasSize(source, slot);
          if (next.w !== lastW || next.h !== lastH) {
            lastW = next.w;
            lastH = next.h;
            pageCanvas.width = next.w;
            pageCanvas.height = next.h;
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'low';
          }
        },
        draw: (_vw, _vh) => {
          ctx.drawImage(source, 0, 0, pageCanvas.width, pageCanvas.height);
        },
      });

      // 30 fps capture is enough; browser will pull from canvas updates
      const canvasStream = pageCanvas.captureStream(TARGET_FPS);
      const videoTracks = canvasStream.getVideoTracks();

      const { tracks: audioTracks } = captureElementAudio(source);
      const combined = new MediaStream([...videoTracks, ...audioTracks]);

      const pipVideo = pipWindow.document.createElement('video');
      pipVideo.autoplay = true;
      pipVideo.playsInline = true;
      pipVideo.setAttribute('playsinline', 'true');
      const hasAudio = audioTracks.length > 0;
      pipVideo.muted = !hasAudio;
      pipVideo.srcObject = combined;
      pipVideo.style.cssText =
        'width:100%;height:100%;object-fit:contain;background:#000;display:block;';
      slot.appendChild(pipVideo);

      if (hasAudio) {
        try {
          source.muted = true;
        } catch {
          // ignore
        }
      }

      void pipVideo.play().catch(() => undefined);

      // Observe slot size so canvas tracks PiP resize without full-res cost
      let ro: ResizeObserver | null = null;
      try {
        ro = new ResizeObserver(() => {
          const next = computeCanvasSize(source, slot);
          if (next.w !== lastW || next.h !== lastH) {
            lastW = next.w;
            lastH = next.h;
            pageCanvas.width = next.w;
            pageCanvas.height = next.h;
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'low';
          }
        });
        ro.observe(slot);
      } catch {
        // ResizeObserver optional
      }

      return {
        mode: hasAudio ? 'av-mirror' : 'video-only',
        stop: () => {
          stopLoop();
          ro?.disconnect();
          try {
            pipVideo.pause();
            pipVideo.srcObject = null;
          } catch {
            // ignore
          }
          pipVideo.remove();
          pageCanvas.remove();
          try {
            for (const t of combined.getTracks()) t.stop();
          } catch {
            // ignore
          }
          try {
            source.muted = wasMuted;
            source.volume = wasVolume;
          } catch {
            // ignore
          }
        },
      };
    } catch (err) {
      console.warn('[UEH] av-mirror failed', err);
    }
  }

  // ── Fallback / YouTube: low-res canvas inside PiP ──────────────────────
  try {
    const canvas = pipWindow.document.createElement('canvas');
    const size = computeCanvasSize(source, slot);
    canvas.width = size.w;
    canvas.height = size.h;
    canvas.style.cssText =
      'width:100%;height:100%;object-fit:contain;display:block;background:#000;';
    slot.appendChild(canvas);
    const ctx = canvas.getContext('2d', {
      alpha: false,
      desynchronized: true,
    });
    if (!ctx) throw new Error('no pip ctx');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'low';

    let lastW = size.w;
    let lastH = size.h;

    const applySize = () => {
      const next = computeCanvasSize(source, slot);
      if (next.w === lastW && next.h === lastH) return;
      lastW = next.w;
      lastH = next.h;
      canvas.width = next.w;
      canvas.height = next.h;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'low';
    };

    let ro: ResizeObserver | null = null;
    try {
      // Debounce resize: only commit size when resize settles a bit
      let resizeTimer = 0;
      ro = new ResizeObserver(() => {
        const win = pipWindow;
        win.clearTimeout(resizeTimer);
        resizeTimer = win.setTimeout(() => applySize(), 80);
      });
      ro.observe(slot);
    } catch {
      // optional
    }

    // Drive from PiP window so FPS stays high while the opener tab is backgrounded
    const stopLoop = startCappedDrawLoop({
      animWindow: pipWindow,
      source,
      draw: () => {
        ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
      },
    });

    return {
      mode: 'video-only',
      stop: () => {
        stopLoop();
        ro?.disconnect();
        canvas.remove();
      },
    };
  } catch (err) {
    console.warn('[UEH] pip-canvas failed', err);
  }

  slot.innerHTML = `
    <div style="padding:20px;text-align:center;color:#c9d1d9;font-size:13px;line-height:1.5;">
      <div style="font-weight:600;margin-bottom:6px;">无法镜像画面</div>
      <div style="opacity:.85;">请在原标签页观看视频。</div>
    </div>
  `;
  return { mode: 'none', stop: () => undefined };
}
