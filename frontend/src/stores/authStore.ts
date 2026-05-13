import { create } from 'zustand';
import { authApi, User, LoginRequest } from '../api/auth';

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (credentials: LoginRequest) => Promise<void>;
  logout: () => void;
  fetchMe: () => Promise<void>;
  initialize: () => void;
  updateProfile: (data: { display_name?: string; avatar_url?: string }) => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: null,
  isAuthenticated: false,
  isLoading: true,

  login: async (credentials: LoginRequest) => {
    const response = await authApi.login(credentials);
    localStorage.setItem('token', response.token);
    set({
      token: response.token,
      user: response.user,
      isAuthenticated: true,
      isLoading: false,
    });
  },

  logout: () => {
    localStorage.removeItem('token');
    set({
      token: null,
      user: null,
      isAuthenticated: false,
    });
  },

  fetchMe: async () => {
    try {
      const user = await authApi.me();
      set({ user, isAuthenticated: true, isLoading: false });
    } catch (error) {
      set({ user: null, isAuthenticated: false, isLoading: false });
    }
  },

  initialize: () => {
    const token = localStorage.getItem('token');
    if (token) {
      set({ token, isLoading: true });
      useAuthStore.getState().fetchMe();
    } else {
      set({ isLoading: false });
    }
  },

  updateProfile: async (data) => {
    const user = await authApi.updateProfile(data);
    set({ user });
  },
}));
