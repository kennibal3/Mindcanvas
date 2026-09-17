// =============================================================
// MindCanvas - BUG-035：护眼模式（暖色低对比度阅读模式）
// 纯前端 UI 偏好，不经后端接口，持久化方式与 ChatPage 的
// victoria_theme 一致：localStorage + <html> 类名切换。
// 只影响视觉（index.css 里的 .eye-care-mode 规则），不涉及
// 画布/组件交互逻辑。
// =============================================================

const STORAGE_KEY = 'mc_eye_care_mode';

/** 读取用户是否已开启护眼模式（默认关闭） */
export function getEyeCareMode(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    // 隐私模式/localStorage 被禁用时静默降级为关闭
    return false;
  }
}

/** 只切换 <html> 上的类名，不写 localStorage（供应用启动时按已存偏好应用一次）*/
export function applyEyeCareModeClass(enabled: boolean): void {
  document.documentElement.classList.toggle('eye-care-mode', enabled);
}

/** 切换并持久化护眼模式偏好 */
export function setEyeCareMode(enabled: boolean): void {
  try {
    if (enabled) {
      localStorage.setItem(STORAGE_KEY, '1');
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // 忽略：写入失败不影响本次会话内的视觉切换
  }
  applyEyeCareModeClass(enabled);
}
