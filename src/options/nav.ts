export type OptionsRoute =
  | 'general'
  | 'translation'
  | 'video-subtitles'
  | 'custom-actions'
  | 'tts'
  | 'dictionary'
  | 'statistics'
  | 'config'
  | 'study';

export interface NavItem {
  id: OptionsRoute;
  label: string;
  group: 'settings' | 'tools';
  icon: string;
}

/** Sidebar items aligned with read-frog options structure (trimmed to this product). */
export const NAV_ITEMS: NavItem[] = [
  { id: 'general', label: '通用设置', group: 'settings', icon: '⚙️' },
  { id: 'translation', label: '翻译', group: 'settings', icon: '🌐' },
  { id: 'video-subtitles', label: '视频字幕', group: 'settings', icon: '🎬' },
  { id: 'custom-actions', label: '自定义 AI 指令', group: 'settings', icon: '✨' },
  { id: 'tts', label: '朗读 / TTS', group: 'settings', icon: '🔊' },
  { id: 'dictionary', label: '生词本', group: 'tools', icon: '📘' },
  { id: 'study', label: '背单词 / AI复习', group: 'tools', icon: '🧠' },
  { id: 'statistics', label: '统计', group: 'tools', icon: '📊' },
  { id: 'config', label: '配置 / 关于', group: 'tools', icon: '🧩' },
];
