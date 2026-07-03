// =============================================================
// MindCanvas v3.0 - 登录页面 · 暖木教育主题
// =============================================================
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/useAuth';
import { LogIn, Eye, EyeOff } from 'lucide-react';

const LoginPage = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const loginUser = await login({ username, password });
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.message || t('auth.loginFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center"
         style={{ background: 'linear-gradient(135deg, var(--color-primary-50) 0%, #FDF6EC 60%, var(--color-bg) 100%)' }}>
      <div className="w-full max-w-md px-4">

        {/* Logo 区域 */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4"
               style={{ background: 'var(--color-primary-500)', boxShadow: 'var(--shadow-pop)' }}>
            <span className="text-white text-2xl font-medium">MC</span>
          </div>
          <h1 className="text-2xl font-medium" style={{ color: 'var(--color-text)' }}>
            {t('app.name')}
          </h1>
          <p className="mt-1" style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-body)' }}>
            {t('app.subtitle')}
          </p>
        </div>

        {/* 登录卡片 */}
        <div className="bg-white p-8"
             style={{ borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-pop)' }}>
          <h2 className="font-medium mb-6" style={{ fontSize: 'var(--text-title)', color: 'var(--color-text)' }}>
            {t('auth.login')}
          </h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block mb-1" style={{ fontSize: 'var(--text-caption)', fontWeight: 500, color: 'var(--color-text-muted)' }}>
                {t('auth.username')}
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="input"
                placeholder={t('auth.username')}
                required
                autoFocus
              />
            </div>

            <div>
              <label className="block mb-1" style={{ fontSize: 'var(--text-caption)', fontWeight: 500, color: 'var(--color-text-muted)' }}>
                {t('auth.password')}
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input pr-10"
                  placeholder={t('auth.password')}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 transition-colors"
                  style={{ color: 'var(--color-text-hint)' }}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {error && (
              <div className="text-sm px-4 py-2" style={{
                background: 'var(--color-danger-bg)',
                color: 'var(--color-danger)',
                borderRadius: 'var(--radius-md)',
                fontSize: 'var(--text-caption)',
              }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !username || !password}
              className="btn-primary w-full flex items-center justify-center gap-2 py-2.5 disabled:opacity-50"
            >
              {loading ? <div className="spinner w-5 h-5" /> : <LogIn size={18} />}
              {loading ? t('common.loading') : t('auth.loginBtn')}
            </button>
          </form>

          {/* 学生入口 */}
          <div className="mt-6 pt-6 text-center" style={{ borderTop: '1px solid var(--color-border)' }}>
            <p className="mb-2" style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-muted)' }}>
              学生？无需账号
            </p>
            <button onClick={() => navigate('/join')} className="btn-secondary w-full">
              扫码 / 输入房间码加入
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};

export default LoginPage;
