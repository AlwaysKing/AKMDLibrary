import { create } from 'zustand';
import apiClient from '../api/client';
import { normalizeCodeTheme, resetShikiThemeCache, type CodeThemeValue } from '../utils/codeTheme';

interface SpacePreference {
  last_viewed_page_id?: string | null;
  expanded_page_ids: string[];
  // 侧边栏区块（最近/最爱/文档）折叠状态
  collapsed_sections?: Record<string, boolean>;
  // "最近/最爱"区页面展开状态（与文档树 expanded_page_ids 相互独立）
  quick_access_expanded_ids?: string[];
}

interface UserPreferences {
  last_active_space_slug?: string | null;
  sidebar_width?: number | null;
  sidebar_collapsed?: boolean | null;
  code_theme?: string | null;
  space_preferences: Record<string, SpacePreference>;
  // 后端只返回布尔，key 本身不暴露给前端
  has_unsplash_key?: boolean;
}

interface PreferenceState {
  preferences: UserPreferences;
  isLoaded: boolean;
  fetchPreferences: () => Promise<void>;
  setLastActiveSpace: (slug: string) => void;
  setSidebarWidth: (width: number) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setLastViewedPage: (spaceSlug: string, pageId: string) => void;
  setExpandedPageIds: (spaceSlug: string, ids: string[]) => void;
  setCollapsedSections: (spaceSlug: string, sections: Record<string, boolean>) => void;
  setQuickAccessExpandedIds: (spaceSlug: string, ids: string[]) => void;
  setCodeTheme: (theme: CodeThemeValue) => void;
  getSidebarWidth: () => number | null | undefined;
  getSidebarCollapsed: () => boolean | null | undefined;
  getExpandedPageIds: (spaceSlug: string) => string[];
  getCollapsedSections: (spaceSlug: string) => Record<string, boolean>;
  getQuickAccessExpandedIds: (spaceSlug: string) => string[];
  getLastViewedPageId: (spaceSlug: string) => string | null | undefined;
  getCodeTheme: () => CodeThemeValue;
  setUnsplashKey: (key: string) => Promise<boolean>;
}

// Debounced save: accumulate changes and send one request
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingUpdate: Record<string, unknown> = {};

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const payload = { ...pendingUpdate };
    pendingUpdate = {};
    try {
      await apiClient.put('/user/preferences', payload);
    } catch (err) {
      console.error('Failed to save preferences:', err);
    }
  }, 300);
}

function ensureSpacePrefs(
  prefs: UserPreferences,
  slug: string
): SpacePreference {
  if (!prefs.space_preferences[slug]) {
    prefs.space_preferences[slug] = { expanded_page_ids: [], collapsed_sections: {}, quick_access_expanded_ids: [] };
  }
  return prefs.space_preferences[slug];
}

export const usePreferenceStore = create<PreferenceState>((set, get) => ({
  preferences: { space_preferences: {} },
  isLoaded: false,

  fetchPreferences: async () => {
    try {
      const res = await apiClient.get<UserPreferences>('/user/preferences');
      const nextPreferences = {
        ...res.data,
        code_theme: normalizeCodeTheme(res.data.code_theme),
      };
      const previousTheme = normalizeCodeTheme(get().preferences.code_theme);
      if (nextPreferences.code_theme !== previousTheme) {
        resetShikiThemeCache();
      }
      set({ preferences: nextPreferences, isLoaded: true });
    } catch (err) {
      console.error('Failed to fetch preferences:', err);
      set({ isLoaded: true });
    }
  },

  setLastActiveSpace: (slug: string) => {
    set((state) => ({
      preferences: { ...state.preferences, last_active_space_slug: slug },
    }));
    pendingUpdate.last_active_space_slug = slug;
    scheduleSave();
  },

  setSidebarWidth: (width: number) => {
    set((state) => ({
      preferences: { ...state.preferences, sidebar_width: width },
    }));
    pendingUpdate.sidebar_width = width;
    scheduleSave();
  },

  setSidebarCollapsed: (collapsed: boolean) => {
    set((state) => ({
      preferences: { ...state.preferences, sidebar_collapsed: collapsed },
    }));
    pendingUpdate.sidebar_collapsed = collapsed;
    scheduleSave();
  },

  setLastViewedPage: (spaceSlug: string, pageId: string) => {
    set((state) => {
      const prefs = { ...state.preferences, space_preferences: { ...state.preferences.space_preferences } };
      ensureSpacePrefs(prefs, spaceSlug).last_viewed_page_id = pageId;
      return { preferences: prefs };
    });
    pendingUpdate.space_slug = spaceSlug;
    pendingUpdate.last_viewed_page_id = pageId;
    scheduleSave();
  },

  setExpandedPageIds: (spaceSlug: string, ids: string[]) => {
    set((state) => {
      const prefs = { ...state.preferences, space_preferences: { ...state.preferences.space_preferences } };
      const sp = { ...ensureSpacePrefs(prefs, spaceSlug) };
      sp.expanded_page_ids = ids;
      prefs.space_preferences[spaceSlug] = sp;
      return { preferences: prefs };
    });
    pendingUpdate.space_slug = spaceSlug;
    pendingUpdate.expanded_page_ids = ids;
    scheduleSave();
  },

  setCollapsedSections: (spaceSlug: string, sections: Record<string, boolean>) => {
    set((state) => {
      const prefs = { ...state.preferences, space_preferences: { ...state.preferences.space_preferences } };
      const sp = { ...ensureSpacePrefs(prefs, spaceSlug) };
      sp.collapsed_sections = sections;
      prefs.space_preferences[spaceSlug] = sp;
      return { preferences: prefs };
    });
    pendingUpdate.space_slug = spaceSlug;
    pendingUpdate.collapsed_sections = sections;
    scheduleSave();
  },

  setQuickAccessExpandedIds: (spaceSlug: string, ids: string[]) => {
    set((state) => {
      const prefs = { ...state.preferences, space_preferences: { ...state.preferences.space_preferences } };
      const sp = { ...ensureSpacePrefs(prefs, spaceSlug) };
      sp.quick_access_expanded_ids = ids;
      prefs.space_preferences[spaceSlug] = sp;
      return { preferences: prefs };
    });
    pendingUpdate.space_slug = spaceSlug;
    pendingUpdate.quick_access_expanded_ids = ids;
    scheduleSave();
  },

  setCodeTheme: (theme: CodeThemeValue) => {
    const normalizedTheme = normalizeCodeTheme(theme);
    const currentTheme = normalizeCodeTheme(get().preferences.code_theme);
    if (normalizedTheme === currentTheme) return;

    resetShikiThemeCache();
    set((state) => ({
      preferences: { ...state.preferences, code_theme: normalizedTheme },
    }));
    pendingUpdate.code_theme = normalizedTheme;
    scheduleSave();
  },

  getExpandedPageIds: (spaceSlug: string) => {
    return get().preferences.space_preferences[spaceSlug]?.expanded_page_ids || [];
  },

  getSidebarWidth: () => {
    return get().preferences.sidebar_width;
  },

  getSidebarCollapsed: () => {
    return get().preferences.sidebar_collapsed;
  },

  getCollapsedSections: (spaceSlug: string) => {
    return get().preferences.space_preferences[spaceSlug]?.collapsed_sections || {};
  },

  getQuickAccessExpandedIds: (spaceSlug: string) => {
    return get().preferences.space_preferences[spaceSlug]?.quick_access_expanded_ids || [];
  },

  getLastViewedPageId: (spaceSlug: string) => {
    return get().preferences.space_preferences[spaceSlug]?.last_viewed_page_id;
  },

  getCodeTheme: () => {
    return normalizeCodeTheme(get().preferences.code_theme);
  },

  setUnsplashKey: async (key: string) => {
    try {
      await apiClient.put('/user/preferences', { unsplash_api_key: key });
      set((state) => ({
        preferences: { ...state.preferences, has_unsplash_key: key !== '' },
      }));
      return true;
    } catch (err) {
      console.error('Failed to save unsplash api key:', err);
      return false;
    }
  },
}));
