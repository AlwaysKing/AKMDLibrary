import { create } from 'zustand';
import apiClient from '../api/client';

interface SpacePreference {
  last_viewed_page_id?: string | null;
  expanded_page_ids: string[];
}

interface UserPreferences {
  last_active_space_slug?: string | null;
  space_preferences: Record<string, SpacePreference>;
  // 后端只返回布尔，key 本身不暴露给前端
  has_unsplash_key?: boolean;
}

interface PreferenceState {
  preferences: UserPreferences;
  isLoaded: boolean;
  fetchPreferences: () => Promise<void>;
  setLastActiveSpace: (slug: string) => void;
  setLastViewedPage: (spaceSlug: string, pageId: string) => void;
  setExpandedPageIds: (spaceSlug: string, ids: string[]) => void;
  getExpandedPageIds: (spaceSlug: string) => string[];
  getLastViewedPageId: (spaceSlug: string) => string | null | undefined;
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
    prefs.space_preferences[slug] = { expanded_page_ids: [] };
  }
  return prefs.space_preferences[slug];
}

export const usePreferenceStore = create<PreferenceState>((set, get) => ({
  preferences: { space_preferences: {} },
  isLoaded: false,

  fetchPreferences: async () => {
    try {
      const res = await apiClient.get<UserPreferences>('/user/preferences');
      set({ preferences: res.data, isLoaded: true });
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

  getExpandedPageIds: (spaceSlug: string) => {
    return get().preferences.space_preferences[spaceSlug]?.expanded_page_ids || [];
  },

  getLastViewedPageId: (spaceSlug: string) => {
    return get().preferences.space_preferences[spaceSlug]?.last_viewed_page_id;
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
