import { AppError } from '../../shared/messages/errors';

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Content script paths from the *built* manifest (hashed assets under dist/).
 * Never hardcode `src/content/index.ts` — that only exists in source.
 */
export function getContentScriptFiles(): string[] {
  const manifest = chrome.runtime.getManifest();
  const files =
    manifest.content_scripts?.flatMap((cs) => cs.js ?? []) ?? [];
  // unique, preserve order
  return [...new Set(files)];
}

export async function injectContentScripts(tabId: number): Promise<void> {
  const files = getContentScriptFiles();
  if (files.length === 0) {
    throw new AppError(
      'PIP_OPEN_FAILED',
      'Manifest has no content_scripts.js entries',
    );
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const lower = msg.toLowerCase();
    if (
      lower.includes('permission') ||
      lower.includes('cannot access') ||
      lower.includes('cannot be scripted') ||
      lower.includes('extension manifest')
    ) {
      throw new AppError(
        'HOST_NOT_GRANTED',
        `Cannot inject content script: ${msg}. Reload the extension after update, then refresh this tab.`,
        err,
      );
    }
    throw new AppError('PIP_OPEN_FAILED', `Script inject failed: ${msg}`, err);
  }
}

/**
 * Ask content to open PiP; if no receiver, inject content scripts and retry.
 */
export async function openPipWithInjection(
  tabId: number,
  openMsg: unknown,
): Promise<{ mode: string }> {
  const tryOpen = async (): Promise<{ mode: string }> => {
    let res: unknown;
    try {
      res = await chrome.tabs.sendMessage(tabId, openMsg);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new AppError(
        'PIP_OPEN_FAILED',
        msg.includes('Receiving end does not exist')
          ? 'NO_RECEIVER'
          : msg,
        err,
      );
    }
    if (res && typeof res === 'object' && 'ok' in (res as object)) {
      const r = res as {
        ok: boolean;
        data?: { mode: string };
        error?: { code: string; message: string };
      };
      if (!r.ok) {
        throw new AppError(
          (r.error?.code as never) ?? 'PIP_OPEN_FAILED',
          r.error?.message ?? 'Content refused to open PiP',
        );
      }
      return r.data ?? { mode: 'mirror' };
    }
    throw new AppError('PIP_OPEN_FAILED', 'Invalid response from content');
  };

  try {
    return await tryOpen();
  } catch (firstErr) {
    const firstMsg =
      firstErr instanceof AppError
        ? firstErr.message
        : firstErr instanceof Error
          ? firstErr.message
          : String(firstErr);

    // Only inject when there is no content listener (or empty response)
    const shouldInject =
      firstMsg === 'NO_RECEIVER' ||
      firstMsg.includes('Receiving end does not exist') ||
      firstMsg.includes('Could not establish connection');

    if (!shouldInject) {
      // Content is present but PiP itself failed (no video, unsupported, etc.)
      throw firstErr;
    }

    await injectContentScripts(tabId);

    // Content boot() is async — retry a few times
    let lastErr: unknown = firstErr;
    for (let i = 0; i < 8; i++) {
      await sleep(80 + i * 60);
      try {
        return await tryOpen();
      } catch (err) {
        lastErr = err;
        const m = err instanceof Error ? err.message : String(err);
        if (m !== 'NO_RECEIVER' && !m.includes('Receiving end does not exist')) {
          // Content answered with a real error
          throw err;
        }
      }
    }

    throw new AppError(
      'PIP_OPEN_FAILED',
      'Content script was injected but did not respond. Please refresh the video tab and try Open PiP again.',
      lastErr,
    );
  }
}
