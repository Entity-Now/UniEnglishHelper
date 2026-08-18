import { PORT_CLIP, PERMISSIONS_BOOTSTRAP_KEY } from '../shared/constants';
import type { ClipPortClientMessage } from '../shared/messages/ports';
import { createEnvelope } from '../shared/messages/envelope';
import { routeMessage } from './router';
import { handleClipPort } from './services/clips';
import { sendTabMessageWithInjection } from './services/inject-content';
import { ensureDefaultSkills } from '../db';
import { getOnboardingUrl } from '../shared/permissions';

function setupContextMenus(): void {
  chrome.contextMenus.removeAll(() => {
    // 1. Selection context menus
    chrome.contextMenus.create({
      id: 'ueh-translate-selection',
      title: '🌐 翻译选中文本「%s」',
      contexts: ['selection'],
    });

    chrome.contextMenus.create({
      id: 'ueh-explain-selection',
      title: '🤖 AI 解释「%s」',
      contexts: ['selection'],
    });

    chrome.contextMenus.create({
      id: 'ueh-speak-selection',
      title: '🔊 朗读选中文本',
      contexts: ['selection'],
    });

    // 2. Page context menus
    chrome.contextMenus.create({
      id: 'ueh-translate-page',
      title: '🌐 翻译当前网页 (双语对照)',
      contexts: ['page'],
    });

    chrome.contextMenus.create({
      id: 'ueh-open-pip',
      title: '🎬 打开学习画中画 (PiP)',
      contexts: ['page'],
    });
  });
}

chrome.runtime.onInstalled.addListener((details) => {
  void ensureDefaultSkills();
  setupContextMenus();

  // First install or update from very old build: open permission bootstrap page
  if (details.reason === 'install') {
    void chrome.storage.local.set({ [PERMISSIONS_BOOTSTRAP_KEY]: false });
    void chrome.tabs.create({ url: getOnboardingUrl() });
    return;
  }

  if (details.reason === 'update') {
    void chrome.storage.local.get(PERMISSIONS_BOOTSTRAP_KEY).then((data) => {
      if (!data[PERMISSIONS_BOOTSTRAP_KEY]) {
        void chrome.tabs.create({ url: getOnboardingUrl() });
      }
    });
  }
});

// First browser start after install if user closed onboarding without granting
chrome.runtime.onStartup.addListener(() => {
  setupContextMenus();
  void chrome.storage.local.get(PERMISSIONS_BOOTSTRAP_KEY).then((data) => {
    if (data[PERMISSIONS_BOOTSTRAP_KEY]) return;
    // Don't force-open every startup — only mark that popup should prompt
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) return;
  const tabId = tab.id;

  if (info.menuItemId === 'ueh-translate-page') {
    void sendTabMessageWithInjection(
      tabId,
      createEnvelope({
        channel: 'runtime',
        type: 'page.translate',
        source: 'background',
        payload: {},
      }),
    );
  } else if (info.menuItemId === 'ueh-open-pip') {
    void sendTabMessageWithInjection(
      tabId,
      createEnvelope({
        channel: 'runtime',
        type: 'content.openPip',
        source: 'background',
        payload: {},
      }),
    );
  } else if (info.menuItemId === 'ueh-translate-selection') {
    void sendTabMessageWithInjection(
      tabId,
      createEnvelope({
        channel: 'runtime',
        type: 'selection.translate',
        source: 'background',
        payload: { text: info.selectionText },
      }),
    );
  } else if (info.menuItemId === 'ueh-explain-selection') {
    void sendTabMessageWithInjection(
      tabId,
      createEnvelope({
        channel: 'runtime',
        type: 'selection.explain',
        source: 'background',
        payload: { text: info.selectionText },
      }),
    );
  } else if (info.menuItemId === 'ueh-speak-selection') {
    void sendTabMessageWithInjection(
      tabId,
      createEnvelope({
        channel: 'runtime',
        type: 'selection.tts',
        source: 'background',
        payload: { text: info.selectionText },
      }),
    );
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (
    message &&
    typeof message === 'object' &&
    'type' in message &&
    typeof (message as { type: string }).type === 'string' &&
    (message as { type: string }).type.startsWith('offscreen.')
  ) {
    if (sender.url?.includes('offscreen')) {
      return false;
    }
    return false;
  }

  void routeMessage(message, sender).then(sendResponse);
  return true;
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === PORT_CLIP) {
    port.onMessage.addListener((msg: ClipPortClientMessage) => {
      if (msg?.type === 'clips.getBlobChunks') {
        void handleClipPort(port, msg);
      }
    });
  }
});
