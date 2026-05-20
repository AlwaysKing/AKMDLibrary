import { useState, useEffect } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { BookOpen } from 'lucide-react';
import { siteSettingsApi, SiteSettings } from '../../api/siteSettings';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [siteSettings, setSiteSettings] = useState<SiteSettings>({});
  const login = useAuthStore((state) => state.login);

  useEffect(() => {
    siteSettingsApi.get().then(setSiteSettings).catch(() => {});
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      await login({ username, password });
      // login() 设置 isAuthenticated = true 后，/login 路由自动切换为 HomeRedirect
      // HomeRedirect 会统一处理：优先恢复 location.state.from（ProtectedRoute 保存），其次使用 last_active_space 偏好
      // 不需要手动 navigate，避免与 HomeRedirect 产生竞态条件
    } catch (err: any) {
      setError(err.response?.data?.message || '用户名或密码错误');
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#ffffff]">
      <div className="w-full max-w-[340px]">
        {/* Logo */}
        <div className="text-center mb-10">
          {siteSettings.logo ? (
            <img src={siteSettings.logo} alt="Logo" className="w-12 h-12 object-contain mx-auto mb-4" />
          ) : (
            <div className="inline-flex items-center justify-center w-12 h-12 bg-notion-text rounded-xl mb-4">
              <BookOpen className="w-6 h-6 text-white" />
            </div>
          )}
          <h1 className="text-xl font-bold text-notion-text">
            {siteSettings.site_name || 'MD Library'}
          </h1>
        </div>

        {/* Form Card */}
        <div className="bg-white border border-notion-border rounded-xl p-8 shadow-sm">
          <h2 className="text-lg font-semibold text-notion-text mb-6 text-center">
            登录
          </h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="username" className="block text-sm font-medium text-notion-text mb-1.5">
                用户名
              </label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-3 py-2 border border-notion-border rounded-lg text-sm text-notion-text placeholder-notion-textSecondary/50 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
                placeholder="请输入用户名"
                required
                autoFocus
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-notion-text mb-1.5">
                密码
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 border border-notion-border rounded-lg text-sm text-notion-text placeholder-notion-textSecondary/50 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
                placeholder="请输入密码"
                required
              />
            </div>

            {error && (
              <div className="bg-red-50 text-red-600 px-3 py-2 rounded-lg text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-blue-500 text-white py-2 px-4 rounded-lg text-sm font-medium hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? '登录中...' : '登录'}
            </button>
          </form>
        </div>

        {/* Footer hint */}
        <p className="text-center text-xs text-notion-textSecondary/60 mt-6">
        </p>
      </div>
    </div>
  );
}
