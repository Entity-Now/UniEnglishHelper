/**
 * Mirror page <video> into Document PiP with both video frames + audio.
 *
 * Video: page canvas drawImage + captureStream (YouTube-safe)
 * Audio: audio tracks from video.captureStream() (even when video track is black)
 * Combined MediaStream → unmuted <video> in PiP
 * Original page video is muted while PiP is open to avoid double audio.
 */

export type MirrorHandle = {
  mode: 'av-mirror' | 'video-only' | 'none';
  stop: () => void;
};

export function startVideoMirror(
  source: HTMLVideoElement,
  pipWindow: Window,
  slot: HTMLElement,
): MirrorHandle {
  slot.innerHTML = '';

  const wasMuted = source.muted;
  const wasVolume = source.volume;

  const isYouTube = location.hostname.includes('youtube.com') || location.hostname.includes('youtu.be');

  if (!isYouTube) {
    try {
      // --- Video via page canvas ---
      const pageCanvas = document.createElement('canvas');
      pageCanvas.width = Math.max(2, source.videoWidth || 1280);
      pageCanvas.height = Math.max(2, source.videoHeight || 720);
      pageCanvas.setAttribute('data-ueh-mirror', '1');
      pageCanvas.style.cssText =
        'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0.01;pointer-events:none;z-index:-1;';
      document.documentElement.appendChild(pageCanvas);

      const ctx = pageCanvas.getContext('2d', {
        alpha: false,
        desynchronized: true,
      });
      if (!ctx) throw new Error('no 2d context');

      let raf = 0;
      let stopped = false;

      const tick = () => {
        if (stopped) return;
        try {
          const vw = source.videoWidth;
          const vh = source.videoHeight;
          if (vw > 2 && vh > 2) {
            if (pageCanvas.width !== vw || pageCanvas.height !== vh) {
              pageCanvas.width = vw;
              pageCanvas.height = vh;
            }
            ctx.drawImage(source, 0, 0, vw, vh);
          }
        } catch {
          // ignore frame errors
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);

      const canvasStream = pageCanvas.captureStream(30);
      const videoTracks = canvasStream.getVideoTracks();

      // --- Audio from element captureStream (video track may be black — ignore it) ---
      let audioTracks: MediaStreamTrack[] = [];
      let elementStream: MediaStream | null = null;
      try {
        const src = source as HTMLVideoElement & {
          captureStream?: () => MediaStream;
          mozCaptureStream?: () => MediaStream;
        };
        const capture =
          src.captureStream?.bind(source) ?? src.mozCaptureStream?.bind(source);
        if (capture) {
          elementStream = capture();
          audioTracks = elementStream.getAudioTracks();
        }
      } catch (err) {
        console.warn('[UEH] audio captureStream failed', err);
      }

      const combined = new MediaStream([
        ...videoTracks,
        ...audioTracks,
      ]);

      const pipVideo = pipWindow.document.createElement('video');
      pipVideo.autoplay = true;
      pipVideo.playsInline = true;
      pipVideo.setAttribute('playsinline', 'true');
      // Prefer audio in PiP when we have tracks; mute page to avoid double sound
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

      return {
        mode: hasAudio ? 'av-mirror' : 'video-only',
        stop: () => {
          stopped = true;
          cancelAnimationFrame(raf);
          try {
            pipVideo.pause();
            pipVideo.srcObject = null;
          } catch {
            // ignore
          }
          pipVideo.remove();
          pageCanvas.remove();
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

  // Fallback: video-only canvas in PiP (no audio mux)
  try {
    const canvas = pipWindow.document.createElement('canvas');
    canvas.width = Math.max(2, source.videoWidth || 1280);
    canvas.height = Math.max(2, source.videoHeight || 720);
    canvas.style.cssText =
      'width:100%;height:100%;object-fit:contain;display:block;background:#000;';
    slot.appendChild(canvas);
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('no pip ctx');

    let raf = 0;
    let stopped = false;
    const tick = () => {
      if (stopped) return;
      try {
        const vw = source.videoWidth;
        const vh = source.videoHeight;
        if (vw > 2 && vh > 2) {
          if (canvas.width !== vw || canvas.height !== vh) {
            canvas.width = vw;
            canvas.height = vh;
          }
          ctx.drawImage(source, 0, 0, vw, vh);
        }
      } catch {
        // ignore
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    // Keep page audio audible in this fallback
    return {
      mode: 'video-only',
      stop: () => {
        stopped = true;
        cancelAnimationFrame(raf);
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
