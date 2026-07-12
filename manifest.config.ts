import { defineManifest } from '@crxjs/vite-plugin';
import packageJson from './package.json';

const { version } = packageJson;

/**
 * Required host_permissions are granted at install time (browser install dialog).
 * This avoids piecemeal optional grants that break PiP / capture / free MT later.
 */
export default defineManifest({
  manifest_version: 3,
  name: 'UniEnglishHelper',
  description:
    'Learn English from videos: Document PiP bilingual subtitles, sentence audio clips, dictionary, AI explain, and TTS.',
  version,
  action: {
    default_popup: 'src/popup/index.html',
    default_title: 'UniEnglishHelper',
  },
  options_ui: {
    page: 'src/options/index.html',
    open_in_tab: true,
  },
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },
  permissions: [
    'storage',
    'unlimitedStorage',
    'activeTab',
    'tabs',
    'scripting',
    'offscreen',
    'tabCapture',
  ],
  // Granted when the user installs / loads the extension
  host_permissions: ['http://*/*', 'https://*/*'],
  // Extra explicit hosts (subset of above; kept for clarity / future narrowing)
  optional_host_permissions: [
    'https://speech.platform.bing.com/*',
    'https://translate.googleapis.com/*',
    'https://translate.google.com/*',
    'https://edge.microsoft.com/*',
    'https://api-edge.cognitive.microsofttranslator.com/*',
    'https://api.cognitive.microsofttranslator.com/*',
    'https://api.mymemory.translated.net/*',
  ],
  content_scripts: [
    {
      matches: ['http://*/*', 'https://*/*'],
      js: ['src/content/index.ts'],
      run_at: 'document_idle',
    },
  ],
  web_accessible_resources: [
    {
      resources: [
        'src/pip/index.html',
        'assets/*',
        // MAIN-world YouTube interceptor (read-frog style, CSP-safe external file)
        'inject/youtube-main.js',
      ],
      matches: ['http://*/*', 'https://*/*'],
      use_dynamic_url: true,
    },
  ],
  icons: {
    '16': 'public/icons/icon16.png',
    '48': 'public/icons/icon48.png',
    '128': 'public/icons/icon128.png',
  },
});
