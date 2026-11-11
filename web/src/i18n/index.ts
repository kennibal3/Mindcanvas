// =============================================================
// MindCanvas v3.0 - i18n 国际化初始化
// REQ-069：默认中文；只有用户在界面上点过「中/EN」切换才会变成英文。
// 不再按浏览器语言自动判断（此前英文系统的浏览器会看到中英混杂界面）。
// =============================================================
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import zh from './zh.json';
import en from './en.json';

export type Lang = 'zh' | 'en';
// 专用键名：不沿用旧版语言检测器自动缓存的 i18nextLng，避免历史自动判断结果被当成"用户选择"
export const LANG_STORAGE_KEY = 'mc_lang';

function readSavedLang(): Lang {
  try {
    const v = localStorage.getItem(LANG_STORAGE_KEY);
    return v === 'en' ? 'en' : 'zh';
  } catch {
    return 'zh';
  }
}

const initial = readSavedLang();

i18n
  .use(initReactI18next)
  .init({
    resources: {
      zh: { translation: zh },
      en: { translation: en },
    },
    lng: initial,
    fallbackLng: 'zh',
    interpolation: { escapeValue: false },
  });

if (typeof document !== 'undefined') {
  document.documentElement.lang = initial === 'en' ? 'en' : 'zh-CN';
}

export function setLang(lang: Lang) {
  try { localStorage.setItem(LANG_STORAGE_KEY, lang); } catch { /* 隐私模式忽略 */ }
  document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN';
  void i18n.changeLanguage(lang);
}

export default i18n;
