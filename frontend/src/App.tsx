import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation, Location } from 'react-router-dom';
import { useEffect } from 'react';
import ProtectedRoute from './components/Auth/ProtectedRoute';
import AppLayout from './components/Layout/AppLayout';
import LoginPage from './pages/LoginPage';
import SpacePage from './pages/SpacePage';
import PageViewPage from './pages/PageViewPage';
import AdminPage from './pages/AdminPage';
import TrashPage from './pages/TrashPage';
import WelcomePage from './pages/WelcomePage';
import GitPage from './pages/GitPage';
import FilesPage from './pages/FilesPage';
import { useAuthStore } from './stores/authStore';
import { useSpaceStore } from './stores/spaceStore';
import { usePreferenceStore } from './stores/preferenceStore';
import { siteSettingsApi } from './api/siteSettings';

function HomeRedirect() {
  const { isAuthenticated } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const fromLocation = (location.state as { from?: Location } | null)?.from;

  useEffect(() => {
    if (isAuthenticated) {
      // 优先恢复用户被中断前的页面（ProtectedRoute 保存在 location.state.from）
      if (fromLocation && fromLocation.pathname && fromLocation.pathname !== '/login' && fromLocation.pathname !== '/') {
        // 先确保 spaces 已加载（用于 SpaceSelector setCurrentSpace）
        useSpaceStore.getState().fetchSpaces().then(() => {
          navigate(fromLocation.pathname + fromLocation.search, { replace: true });
        });
        return;
      }

      // 没有保存的来源页面，走正常的偏好恢复逻辑
      Promise.all([
        useSpaceStore.getState().fetchSpaces(),
        usePreferenceStore.getState().fetchPreferences(),
      ]).then(() => {
        const spaces = useSpaceStore.getState().spaces;
        const prefs = usePreferenceStore.getState().preferences;
        const lastSlug = prefs.last_active_space_slug;
        const targetSpace = lastSlug
          ? spaces.find((s: { slug: string }) => s.slug === lastSlug)
          : null;
        if (targetSpace) {
          navigate(`/s/${targetSpace.slug}`, { replace: true });
        } else if (spaces.length > 0) {
          navigate(`/s/${spaces[0].slug}`, { replace: true });
        } else {
          navigate('/welcome', { replace: true });
        }
      });
    }
  }, [isAuthenticated, navigate, fromLocation]);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-notion-bg">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-notion-text"></div>
    </div>
  );
}

function App() {
  const { isAuthenticated } = useAuthStore();

  useEffect(() => {
    useAuthStore.getState().initialize();
  }, []);

  // 加载站点设置并更新 favicon 和 title
  useEffect(() => {
    siteSettingsApi.get().then(settings => {
      if (settings.favicon) {
        let link = document.querySelector("link[rel~='icon']") as HTMLLinkElement;
        if (!link) {
          link = document.createElement('link');
          link.rel = 'icon';
          document.head.appendChild(link);
        }
        link.href = settings.favicon;

        // Sync apple-touch-icon to the generated 512 PNG so iOS "Add to Home
        // Screen" reflects custom favicon uploads. The endpoint serves the
        // generated variant when a custom favicon exists; index.html's static
        // default still applies otherwise.
        let apple = document.querySelector("link[rel='apple-touch-icon']") as HTMLLinkElement | null;
        if (!apple) {
          apple = document.createElement('link');
          apple.rel = 'apple-touch-icon';
          document.head.appendChild(apple);
        }
        apple.href = '/api/site-assets/pwa-icon-512.png';
      }
      if (settings.site_name) {
        document.title = settings.site_name;
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      usePreferenceStore.getState().fetchPreferences();
    }
  }, [isAuthenticated]);

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/login"
          element={!isAuthenticated ? <LoginPage /> : <HomeRedirect />}
        />
        <Route
          path="/s/:spaceSlug"
          element={
            <ProtectedRoute>
              <AppLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<SpacePage />} />
          <Route path="trash" element={<TrashPage />} />
          <Route path="git" element={<GitPage />} />
          <Route path="files" element={<FilesPage />} />
        </Route>
        <Route
          path="/s/:spaceSlug/p/:pageId"
          element={
            <ProtectedRoute>
              <AppLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<PageViewPage />} />
        </Route>
        <Route
          path="/admin"
          element={
            <ProtectedRoute>
              <AppLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<AdminPage />} />
        </Route>
        <Route
          path="/welcome"
          element={
            <ProtectedRoute>
              <AppLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<WelcomePage />} />
        </Route>
        <Route path="/" element={<HomeRedirect />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
