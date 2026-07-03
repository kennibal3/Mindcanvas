// =============================================================
// MindCanvas v3.0 - i18n 国际化初始化
// 支持中文/英文，离线可用（JSON 资源内联打包）
// =============================================================
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import zh from './zh.json';
import en from './en.json';

i18n
  .use(LanguageDetector)      // 自动检测浏览器语言
  .use(initReactI18next)      // React 绑定
  .init({
    resources: {
      zh: { translation: zh },
      en: { translation: en },
    },
    fallbackLng: 'zh',        // 默认中文
    interpolation: {
      escapeValue: false,      // React 已自动转义
    },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
    },
  });

export default i18n;
