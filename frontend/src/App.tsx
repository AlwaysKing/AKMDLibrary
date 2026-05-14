import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useEffect } from 'react';
import ProtectedRoute from './components/Auth/ProtectedRoute';
import AppLayout from './components/Layout/AppLayout';
import LoginPage from './pages/LoginPage';
import SpacePage from './pages/SpacePage';
import PageViewPage from './pages/PageViewPage';
import AdminPage from './pages/AdminPage';
import TrashPage from './pages/TrashPage';
import WelcomePage from './pages/WelcomePage';
import { useAuthStore } from './stores/authStore';
import { useSpaceStore } from './stores/spaceStore';
import { usePreferenceStore } from './stores/preferenceStore';

function HomeRedirect() {
  const { isAuthenticated } = useAuthStore();

  useEffect(() => {
    if (isAuthenticated) {
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
          window.location.href = `/s/${targetSpace.slug}`;
        } else if (spaces.length > 0) {
          window.location.href = `/s/${spaces[0].slug}`;
        } else {
          window.location.href = '/welcome';
        }
      });
    }
  }, [isAuthenticated]);

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
