import {
  fail,
  isEnvelope,
  ok,
  type Envelope,
  type Result,
} from '../shared/messages';
import { AppError, toErrorPayload } from '../shared/messages/errors';
import {
  addWord,
  clearCaches,
  deleteSkill,
  deleteWord,
  ensureDefaultSkills,
  listSkills,
  listWords,
  resetBuiltinSkill,
  saveSkill,
  updateReview,
  setLearningStatus,
  getHighlightMap,
  getVideoVocabRecap,
  getClipMeta,
  getDashboardStats,
  trimTranslationCache,
} from '../db';
import { translateTexts } from '../api/translate';
import {
  explainWord,
  chatCompletion,
  formatWordExplainForDisplay,
} from '../api/ai-provider';
import { ensureHostAccess, getConfig, setConfig } from './services/config';
import {
  armCapture,
  exportClip,
  forwardAnchors,
  getCaptureStatus,
  stopCapture,
} from './services/capture';
import {
  edgeTtsHealth,
  synthTts,
  synthesizeTtsChunks,
} from './services/tts';
import { openPipWithInjection } from './services/inject-content';
import { EXT_VERSION } from '../shared/version';
import { EDGE_TTS_VOICES } from '../api/edge-tts';
import { listEdgeTTSVoices } from '../utils/edge-tts/voices';
import {
  allFreeMtOrigins,
  FREE_MT_PROVIDERS,
} from '../api/translate/providers';
import {
  extractYoutubeCaptionTracks,
  fetchCaptionText,
  getYoutubePlayerData,
  injectYoutubeMain,
} from './services/youtube-main';

function sourceFromSender(
  sender: chrome.runtime.MessageSender,
): 'content' | 'popup' | 'options' | 'offscreen' | 'background' {
  if (sender.url?.includes('offscreen')) return 'offscreen';
  if (sender.url?.includes('popup')) return 'popup';
  if (sender.url?.includes('options')) return 'options';
  if (sender.tab?.id != null) return 'content';
  return 'background';
}

function assertAuthorized(
  envelope: Envelope,
  sender: chrome.runtime.MessageSender,
): void {
  // Extension pages and content scripts only
  if (sender.id && sender.id !== chrome.runtime.id) {
    throw new AppError('UNAUTHORIZED_SENDER', 'Foreign extension');
  }
  // Content must not call offscreen.* directly
  if (
    envelope.type.startsWith('offscreen.') &&
    sourceFromSender(sender) === 'content'
  ) {
    throw new AppError('UNAUTHORIZED_SENDER', 'Content cannot call offscreen');
  }
}

export async function routeMessage(
  message: unknown,
  sender: chrome.runtime.MessageSender,
): Promise<Result<unknown>> {
  if (!isEnvelope(message)) {
    return fail('INVALID_MESSAGE', 'Message is not a v1 envelope');
  }

  try {
    assertAuthorized(message, sender);
    const data = await dispatch(message, sender);
    return ok(data);
  } catch (err) {
    const e = toErrorPayload(err);
    return fail(e.code, e.message, e.details);
  }
}

async function dispatch(
  envelope: Envelope,
  sender: chrome.runtime.MessageSender,
): Promise<unknown> {
  const p = envelope.payload as Record<string, unknown>;

  switch (envelope.type) {
    case 'sys.ping':
      return { version: EXT_VERSION, swAlive: true };

    case 'youtube.captionTracks': {
      const tabId = sender.tab?.id;
      if (tabId == null) {
        throw new AppError(
          'VIDEO_NOT_FOUND',
          'youtube.captionTracks requires a tab sender',
        );
      }
      const tracks = await extractYoutubeCaptionTracks(tabId);
      return { tracks };
    }

    case 'youtube.playerData': {
      const tabId = sender.tab?.id;
      if (tabId == null) {
        throw new AppError('VIDEO_NOT_FOUND', 'Requires tab');
      }
      const videoId = String(p.videoId || '');
      await injectYoutubeMain(tabId);
      const data = await getYoutubePlayerData(tabId, videoId);
      return { data };
    }

    case 'youtube.fetchCaption': {
      const url = String(p.url || '');
      if (!url.includes('youtube.com') && !url.includes('googlevideo.com')) {
        // still allow timedtext hosts
        if (!url.includes('timedtext') && !url.includes('youtube')) {
          throw new AppError('TRANSLATE_FAILED', 'Invalid caption URL');
        }
      }
      try {
        const text = await fetchCaptionText(url);
        return { text };
      } catch (err) {
        throw new AppError(
          'TRANSLATE_FAILED',
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    case 'youtube.injectMain': {
      const tabId = sender.tab?.id;
      if (tabId == null) return { ok: true };
      await injectYoutubeMain(tabId);
      return { ok: true };
    }

    case 'config.get':
      return getConfig();

    case 'config.set':
      return setConfig(p as never);

    case 'host.ensure': {
      // Check only — request must be done in Popup/Options (user gesture).
      const origin = String(p.origin ?? '');
      const granted = await ensureHostAccess(origin);
      if (!granted) {
        throw new AppError(
          'HOST_NOT_GRANTED',
          'Host permission not granted. Allow site access from the popup first.',
        );
      }
      return { granted: true };
    }

    case 'pip.open': {
      const tabId = Number(p.tabId);
      // Validate tab is scriptable
      try {
        const tab = await chrome.tabs.get(tabId);
        const url = tab.url ?? '';
        if (
          !url ||
          url.startsWith('chrome://') ||
          url.startsWith('edge://') ||
          url.startsWith('about:') ||
          url.startsWith('chrome-extension://') ||
          url.startsWith('https://chrome.google.com/') ||
          url.startsWith('https://chromewebstore.google.com/')
        ) {
          throw new AppError(
            'HOST_NOT_GRANTED',
            'Cannot run on this page. Open a normal http(s) video website first.',
          );
        }
      } catch (err) {
        if (err instanceof AppError) throw err;
        // tabs.get failed — continue and let inject report the real error
      }

      const openMsg = {
        v: 1 as const,
        channel: 'runtime' as const,
        type: 'content.openPip',
        requestId: envelope.requestId,
        source: 'background' as const,
        payload: {},
      };

      // Static import only — dynamic import() pulls Vite preload-helper which
      // touches `document` and crashes the service worker.
      return openPipWithInjection(tabId, openMsg);
    }

    case 'pip.close':
      return {};

    case 'capture.arm':
      return armCapture(
        Number(p.tabId),
        p.streamId ? String(p.streamId) : undefined,
      );

    case 'capture.stop':
      await stopCapture(String(p.sessionId));
      return {};

    case 'capture.status':
      return getCaptureStatus(
        p.tabId !== undefined ? Number(p.tabId) : undefined,
      );

    case 'capture.anchors':
      return forwardAnchors(
        String(p.sessionId),
        (p.samples as never) ?? [],
      );

    case 'clips.export':
      return exportClip({
        sessionId: String(p.sessionId),
        startMs: Number(p.startMs),
        endMs: Number(p.endMs),
        epoch: Number(p.epoch),
      });

    case 'clips.getMeta': {
      const meta = await getClipMeta(Number(p.clipId));
      if (!meta) throw new AppError('DB_ERROR', 'Clip not found');
      return meta;
    }

    case 'translate.cues': {
      const config = await getConfig();
      // Do NOT call permissions.request here (no user gesture in SW).
      // User grants free-MT hosts from Settings button.
      const items = await translateTexts(
        p.cues as { id: string; text: string }[],
        String(p.src ?? config.sourceLang),
        String(p.dst ?? config.targetLang),
        config,
      );
      void trimTranslationCache(500);
      return { items };
    }

    case 'translate.ensureFreeMt': {
      // Check-only from SW; actual request is Options-page only.
      const config = await getConfig();
      const provider =
        (p.provider as string | undefined) ?? config.freeMtProvider ?? 'auto';
      const origins =
        provider === 'auto'
          ? allFreeMtOrigins()
          : FREE_MT_PROVIDERS[
              provider as keyof typeof FREE_MT_PROVIDERS
            ]?.origins ?? allFreeMtOrigins();
      const granted = await chrome.permissions.contains({ origins });
      if (!granted) {
        throw new AppError(
          'HOST_NOT_GRANTED',
          'Free MT hosts not granted. Use Settings → Grant free MT network permission.',
        );
      }
      return { granted: true };
    }

    case 'stats.dashboard':
      return getDashboardStats();

    case 'ui.openOptions': {
      const route = String(p.route ?? '');
      const hash =
        route && route !== 'general' ? `#${route}` : '';
      await chrome.tabs.create({
        url: chrome.runtime.getURL(`src/options/index.html${hash}`),
      });
      return { opened: true };
    }

    case 'tts.voices': {
      try {
        const dynamic = await listEdgeTTSVoices();
        return { edge: EDGE_TTS_VOICES, dynamic };
      } catch {
        return { edge: EDGE_TTS_VOICES, dynamic: [] };
      }
    }

    case 'tts.health':
      return edgeTtsHealth();

    case 'word.explain': {
      const config = await getConfig();
      const result = await explainWord(
        config,
        String(p.surface ?? p.word),
        String(p.context ?? ''),
      );
      return {
        ...result,
        text: formatWordExplainForDisplay(result),
      };
    }

    case 'word.add':
      return addWord(p as never);

    case 'word.list':
      return listWords(p as never);

    case 'word.updateReview':
      return updateReview(Number(p.id), p.result as never);

    case 'word.setStatus':
      return setLearningStatus(
        Number(p.id),
        p.learningStatus as 'new' | 'learning' | 'learned',
      );

    case 'word.highlightMap':
      return getHighlightMap();

    case 'word.videoRecap':
      return getVideoVocabRecap(
        String(p.videoKey ?? ''),
        Array.isArray(p.cueWordKeys) ? (p.cueWordKeys as string[]) : [],
      );

    case 'word.delete':
      await deleteWord(Number(p.id));
      return {};

    case 'skill.list':
      await ensureDefaultSkills();
      return listSkills();

    case 'skill.save':
      return saveSkill(p as never);

    case 'skill.delete': {
      const { isBuiltinSkillId } = await import('../utils/constants/skills');
      if (isBuiltinSkillId(String(p.id))) {
        throw new AppError(
          'CONFIG_INVALID',
          'Built-in skills cannot be deleted. You can edit them or use「恢复默认」.',
        );
      }
      await deleteSkill(String(p.id));
      return {};
    }

    case 'skill.resetBuiltin': {
      const restored = await resetBuiltinSkill(String(p.id));
      if (!restored) {
        throw new AppError('CONFIG_INVALID', 'Not a built-in skill');
      }
      return restored;
    }

    case 'skill.run': {
      const config = await getConfig();
      const skills = await listSkills();
      const skill = skills.find((s) => s.id === p.skillId);
      if (!skill) throw new AppError('AI_FAILED', 'Skill not found');
      if (!skill.enabled) {
        throw new AppError('AI_FAILED', `Skill「${skill.name}」已禁用`);
      }
      const userText = String(p.text ?? '').trim();
      if (!userText) throw new AppError('AI_FAILED', 'No text to run skill on');
      const ctx = String(p.context ?? '').trim();
      const text = await chatCompletion(config, [
        { role: 'system', content: skill.systemPrompt },
        {
          role: 'user',
          content: ctx
            ? `【选中文本】\n${userText}\n\n【上下文】\n${ctx}`
            : userText,
        },
      ]);
      return { text, skillId: skill.id, skillName: skill.name };
    }

    case 'tts.synth': {
      const config = await getConfig();
      return synthTts(
        config,
        String(p.text),
        p.voice ? String(p.voice) : undefined,
        p.rate as string | number | undefined,
        p.pitch as string | number | undefined,
        p.volume as string | number | undefined,
      );
    }

    case 'tts.synthChunks': {
      const config = await getConfig();
      return synthesizeTtsChunks(config, String(p.text), {
        voice: p.voice ? String(p.voice) : undefined,
        rate: p.rate as string | number | undefined,
        pitch: p.pitch as string | number | undefined,
        volume: p.volume as string | number | undefined,
      });
    }

    case 'cache.clear':
      return clearCaches((p.scopes as never) ?? ['translation', 'tts']);

    case 'diag.export': {
      const config = await getConfig();
      const capture = await getCaptureStatus();
      return {
        schemaVersion: 1,
        exportedAt: Date.now(),
        version: EXT_VERSION,
        config: {
          ...config,
          ai: { ...config.ai, apiKeys: Object.fromEntries(
            Object.keys(config.ai.apiKeys).map((k) => [k, '***']),
          ) },
        },
        capture,
      };
    }

    // Offscreen-bound types are handled by offscreen page itself when it is the target.
    // Background should not re-route offscreen.* unless targeting offscreen document.
    default:
      if (envelope.type.startsWith('offscreen.')) {
        // If background received offscreen message intended for offscreen page,
        // ignore — the offscreen listener will handle messages sent to runtime
        // and both can receive. Background only handles if it's a control path.
        throw new AppError(
          'UNSUPPORTED_TYPE',
          `Background does not handle ${envelope.type}`,
        );
      }
      throw new AppError(
        'UNSUPPORTED_TYPE',
        `Unsupported type: ${envelope.type}`,
      );
  }
}
