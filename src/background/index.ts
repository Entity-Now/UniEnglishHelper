import { PORT_CLIP, PERMISSIONS_BOOTSTRAP_KEY } from '../shared/constants';
import type { ClipPortClientMessage } from '../shared/messages/ports';
import { routeMessage } from './router';
import { handleClipPort } from './services/clips';
import { ensureDefaultSkills } from '../db';
import { getOnboardingUrl } from '../shared/permissions';

chrome.runtime.onInstalled.addListener((details) => {
  void ensureDefaultSkills();

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
  void chrome.storage.local.get(PERMISSIONS_BOOTSTRAP_KEY).then((data) => {
    if (data[PERMISSIONS_BOOTSTRAP_KEY]) return;
    // Don't force-open every startup — only mark that popup should prompt
  });
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
