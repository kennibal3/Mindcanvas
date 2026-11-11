// REQ-069：一键中/英切换。默认中文，点一下切到英文，再点切回。
import { useTranslation } from 'react-i18next';
import { setLang } from '@/i18n';

export default function LanguageSwitch({ className = '' }: { className?: string }) {
  const { i18n } = useTranslation();
  const isEn = i18n.language === 'en';
  return (
    <button
      type="button"
      onClick={() => setLang(isEn ? 'zh' : 'en')}
      title={isEn ? '切换为中文' : 'Switch to English'}
      aria-label={isEn ? '切换为中文' : 'Switch to English'}
      className={`px-2 h-8 rounded-lg text-xs font-medium border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 transition ${className}`}
    >
      {isEn ? '中文' : 'EN'}
    </button>
  );
}
