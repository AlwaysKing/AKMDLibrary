import { useEffect, useState, useRef, Fragment } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { usersApi } from '../api/users';
import { spacesApi, Space, SpaceMember, FeatureFlags } from '../api/spaces';
import { authApi } from '../api/auth';
import { fetchIconLibrary, uploadToIconLibrary, deleteIcon, renameIcon, IconLibraryItem } from '../api/icons';
import { fetchCoverLibrary, uploadToCoverLibrary, deleteCover, renameCover, CoverLibraryItem } from '../api/covers';
import { siteSettingsApi, SiteSettings } from '../api/siteSettings';
import { Trash2, Edit2, Plus, X, UserPlus, Smile, ChevronDown, ChevronUp, Check, PlusCircle, Key, RefreshCw, Upload, Download, Image, ImageIcon, BookOpen } from 'lucide-react';
import PageIcon from '../components/Editor/PageIcon';
import { usePreferenceStore } from '../stores/preferenceStore';
import apiClient from '../api/client';
import { CODE_THEME_OPTIONS, CODE_THEME_PREVIEW_SNIPPET, getCodeThemeRegistration, normalizeCodeTheme } from '../utils/codeTheme';

interface EditingUser {
  id: number;
  username: string;
  display_name: string;
  avatar_url?: string;
  role: 'admin' | 'user';
  created_at: string;
  updated_at: string;
}

const ICON_OPTIONS = ['📚', '📝', '💼', '🏠', '🎨', '🔬', '📊', '🗂️', '💡', '🚀', '🎯', '✅', '📋', '📁', '🔧', '💬', '🌟', '🎓', '🎵', '🌍', '🔒', '📱', '☕', '🔮'];

const roleLabels: Record<string, string> = {
  admin: '管理员',
  editor: '编辑',
  viewer: '只读',
};

export default function AdminPage() {
  const location = useLocation();
  const codeTheme = usePreferenceStore((state) => normalizeCodeTheme(state.preferences.code_theme));
  const setCodeTheme = usePreferenceStore((state) => state.setCodeTheme);

  const { user: currentUser } = useAuthStore();
  const isAdminUser = currentUser?.role === 'admin';
  const activeTab = new URLSearchParams(location.search).get('tab') || (isAdminUser ? 'users' : 'profile');

  // ---- 用户管理状态 ----
  const [users, setUsers] = useState<EditingUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // 用户面板: null=关闭, 'new'=创建, number=编辑用户ID
  const [userPanelId, setUserPanelId] = useState<number | 'new' | null>(null);
  const [userFormData, setUserFormData] = useState({ username: '', password: '', display_name: '', role: 'user', avatar_url: '' });
  const [showUserRoleDropdown, setShowUserRoleDropdown] = useState(false);
  const [showUserAvatarPicker, setShowUserAvatarPicker] = useState(false);
  const userAvatarPickerRef = useRef<HTMLDivElement>(null);
  const [showUserPasswordPanel, setShowUserPasswordPanel] = useState(false);
  const [passwordTargetUserId, setPasswordTargetUserId] = useState<number | null>(null);
  const [userNewPassword, setUserNewPassword] = useState('');
  const [error, setError] = useState('');
  const [userSpaceCounts, setUserSpaceCounts] = useState<Record<number, number>>({});

  // ---- 用户列表内联编辑显示名 ----
  const [editingDisplayNameUserId, setEditingDisplayNameUserId] = useState<number | null>(null);
  const [editingDisplayNameValue, setEditingDisplayNameValue] = useState('');
  const [roleDropdownUserId, setRoleDropdownUserId] = useState<number | null>(null);
  const roleDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (roleDropdownUserId === null) return;
    const handler = (e: MouseEvent) => {
      if (roleDropdownRef.current && !roleDropdownRef.current.contains(e.target as Node)) {
        setRoleDropdownUserId(null);
      }
    };
    const timer = setTimeout(() => document.addEventListener('mousedown', handler), 0);
    return () => { clearTimeout(timer); document.removeEventListener('mousedown', handler); };
  }, [roleDropdownUserId]);

  const handleInlineRoleChange = async (userId: number, role: string) => {
    try {
      const updated = await usersApi.update(userId, { role: role as 'admin' | 'user' });
      setUsers(prev => prev.map(u => u.id === userId ? updated : u));
    } catch (err: any) { setError(err.message); }
    setRoleDropdownUserId(null);
  };

  // ---- 用户空间成员管理状态 ----
  interface UserSpaceMembership {
    space: Space;
    memberId: number;
    role: string;
  }
  const [userSpaces, setUserSpaces] = useState<UserSpaceMembership[]>([]);
  const [allSpacesForUser, setAllSpacesForUser] = useState<Space[]>([]);
  const [isAddingUserSpace, setIsAddingUserSpace] = useState(false);
  const [newUserSpace, setNewUserSpace] = useState({ slug: '', role: 'viewer' });
  const [showSpaceDropdown, setShowSpaceDropdown] = useState(false);
  const [showNewSpaceRoleDropdown, setShowNewSpaceRoleDropdown] = useState(false);
  const [openUserSpaceRoleId, setOpenUserSpaceRoleId] = useState<number | null>(null);
  const userDropdownsRef = useRef<HTMLDivElement>(null);

  // ---- 个人设置状态 ----
  const [, setProfileForm] = useState({ display_name: '', avatar_url: '' });
  const [passwordForm, setPasswordForm] = useState({ old_password: '', new_password: '', confirm_password: '' });
  const [profileMsg, setProfileMsg] = useState('');
  const [passwordMsg, setPasswordMsg] = useState('');
  const [showAvatarPicker, setShowAvatarPicker] = useState(false);
  const [isEditingDisplayName, setIsEditingDisplayName] = useState(false);
  const [editingDisplayName, setEditingDisplayName] = useState('');
  const avatarPickerRef = useRef<HTMLDivElement>(null);

  // ---- Unsplash API Key 配置 ----
  const [unsplashKeyInput, setUnsplashKeyInput] = useState('');
  const [unsplashKeyConfigured, setUnsplashKeyConfigured] = useState(false);
  const [unsplashMsg, setUnsplashMsg] = useState('');
  const [unsplashTesting, setUnsplashTesting] = useState(false);
  const [codeThemePreviewHtml, setCodeThemePreviewHtml] = useState('');
  const [codeThemePreviewLoading, setCodeThemePreviewLoading] = useState(false);

  // ---- 空间管理状态 ----
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [spacesLoading, setSpacesLoading] = useState(false);
  // 统一面板: null=关闭, 'new'=创建, slug=编辑
  const [spacePanelSlug, setSpacePanelSlug] = useState<string | null>(null);
  const [spaceFormData, setSpaceFormData] = useState<{ name: string; icon: string; description: string; feature_flags: FeatureFlags }>({ name: '', icon: '', description: '', feature_flags: { git: false } });
  const [showIconPicker, setShowIconPicker] = useState(false);
  const iconPickerRef = useRef<HTMLDivElement>(null);

  // ---- 空间列表内联编辑名称 ----
  const [editingSpaceNameSlug, setEditingSpaceNameSlug] = useState<string | null>(null);
  const [editingSpaceNameValue, setEditingSpaceNameValue] = useState('');
  const [editingSpaceDescSlug, setEditingSpaceDescSlug] = useState<string | null>(null);
  const [editingSpaceDescValue, setEditingSpaceDescValue] = useState('');

  // ---- 成员管理状态 ----
  const [members, setMembers] = useState<SpaceMember[]>([]);
  const [memberCounts, setMemberCounts] = useState<Record<string, number>>({});
  const [allUsers, setAllUsers] = useState<{ id: number; username: string; display_name: string }[]>([]);
  const [isAddingMember, setIsAddingMember] = useState(false);
  const [newMember, setNewMember] = useState({ user_id: 0, role: 'viewer' });
  const [showUserDropdown, setShowUserDropdown] = useState(false);
  const [showNewRoleDropdown, setShowNewRoleDropdown] = useState(false);
  const [openMemberRoleId, setOpenMemberRoleId] = useState<number | null>(null);
  const [refreshingSlug, setRefreshingSlug] = useState<string | null>(null);
  const dropdownsRef = useRef<HTMLDivElement>(null);

  // ---- 资源管理状态 ----
  const [resourceType, setResourceType] = useState<'icons' | 'covers'>('icons');
  const [iconItems, setIconItems] = useState<IconLibraryItem[]>([]);
  const [coverItems, setCoverItems] = useState<CoverLibraryItem[]>([]);
  const [renamingItem, setRenamingItem] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [uploadingResource, setUploadingResource] = useState(false);
  const iconFileRef = useRef<HTMLInputElement>(null);
  const coverFileRef = useRef<HTMLInputElement>(null);

  // ---- 站点设置状态 ----
  const [siteSettings, setSiteSettings] = useState<SiteSettings>({});
  const [siteSettingsLoading, setSiteSettingsLoading] = useState(false);
  const [siteSettingsMsg, setSiteSettingsMsg] = useState('');
  const [editingSiteName, setEditingSiteName] = useState(false);
  const [editingSiteNameValue, setEditingSiteNameValue] = useState('');
  const [confirmReset, setConfirmReset] = useState<'favicon' | 'logo' | 'site_name' | null>(null);
  const faviconFileRef = useRef<HTMLInputElement>(null);
  const logoFileRef = useRef<HTMLInputElement>(null);

  // ---- 图标选择器点击外部关闭 ----
  useEffect(() => {
    if (!showIconPicker && !showAvatarPicker && !showUserAvatarPicker) return;
    const handler = (e: MouseEvent) => {
      if (iconPickerRef.current && !iconPickerRef.current.contains(e.target as Node)) {
        setShowIconPicker(false);
      }
      if (avatarPickerRef.current && !avatarPickerRef.current.contains(e.target as Node)) {
        setShowAvatarPicker(false);
      }
      if (userAvatarPickerRef.current && !userAvatarPickerRef.current.contains(e.target as Node)) {
        setShowUserAvatarPicker(false);
      }
    };
    const timer = setTimeout(() => document.addEventListener('mousedown', handler), 0);
    return () => { clearTimeout(timer); document.removeEventListener('mousedown', handler); };
  }, [showIconPicker, showAvatarPicker]);

  // ---- 自定义下拉菜单点击外部关闭 ----
  useEffect(() => {
    if (!showUserDropdown && !showNewRoleDropdown && openMemberRoleId === null && !showUserRoleDropdown) return;
    const handler = (e: MouseEvent) => {
      if (dropdownsRef.current && !dropdownsRef.current.contains(e.target as Node)) {
        setShowUserDropdown(false);
        setShowNewRoleDropdown(false);
        setOpenMemberRoleId(null);
        setShowUserRoleDropdown(false);
      }
    };
    const timer = setTimeout(() => document.addEventListener('mousedown', handler), 0);
    return () => { clearTimeout(timer); document.removeEventListener('mousedown', handler); };
  }, [showUserDropdown, showNewRoleDropdown, openMemberRoleId, showUserRoleDropdown]);

  // ---- 用户面板下拉菜单点击外部关闭 ----
  useEffect(() => {
    if (!showSpaceDropdown && !showNewSpaceRoleDropdown && openUserSpaceRoleId === null) return;
    const handler = (e: MouseEvent) => {
      if (userDropdownsRef.current && !userDropdownsRef.current.contains(e.target as Node)) {
        setShowSpaceDropdown(false);
        setShowNewSpaceRoleDropdown(false);
        setOpenUserSpaceRoleId(null);
      }
    };
    const timer = setTimeout(() => document.addEventListener('mousedown', handler), 0);
    return () => { clearTimeout(timer); document.removeEventListener('mousedown', handler); };
  }, [showSpaceDropdown, showNewSpaceRoleDropdown, openUserSpaceRoleId]);

  // ---- 数据获取 ----
  useEffect(() => {
    if (activeTab === 'users') fetchUsers();
  }, [activeTab]);

  // 个人设置：加载 Unsplash API key 配置状态
  useEffect(() => {
    if (activeTab !== 'profile') return;
    (async () => {
      try {
        const res = await apiClient.get<{ configured: boolean }>('/unsplash/status');
        setUnsplashKeyConfigured(res.data.configured);
      } catch (err) {
        console.error('Failed to fetch unsplash status:', err);
      }
    })();
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== 'profile') return;

    let cancelled = false;
    setCodeThemePreviewLoading(true);

    (async () => {
      try {
        const { createHighlighter } = await import('shiki');
        const themeRegistration = getCodeThemeRegistration(codeTheme);
        const highlighter = await createHighlighter({
          themes: [themeRegistration],
          langs: ['xml'],
        });
        const html = highlighter.codeToHtml(CODE_THEME_PREVIEW_SNIPPET, {
          lang: 'xml',
          theme: typeof themeRegistration === 'string' ? themeRegistration : themeRegistration.name,
        });
        if (!cancelled) {
          setCodeThemePreviewHtml(html);
          setCodeThemePreviewLoading(false);
        }
      } catch (err) {
        console.error('Failed to render code theme preview:', err);
        if (!cancelled) {
          setCodeThemePreviewHtml('');
          setCodeThemePreviewLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeTab, codeTheme]);

  useEffect(() => {
    if (activeTab === 'spaces') {
      fetchSpaces();
      fetchAllUsers();
    }
  }, [activeTab]);

  // 初始化 profile 表单
  useEffect(() => {
    if (activeTab === 'profile' && currentUser) {
      setProfileForm({ display_name: currentUser.display_name, avatar_url: currentUser.avatar_url || '' });
      setProfileMsg('');
      setPasswordMsg('');
      setPasswordForm({ old_password: '', new_password: '', confirm_password: '' });
    }
  }, [activeTab, currentUser]);

  // 加载资源管理数据
  useEffect(() => {
    if (activeTab === 'resources') {
      fetchIconLibrary().then(setIconItems).catch(() => {});
      fetchCoverLibrary().then(setCoverItems).catch(() => {});
    }
  }, [activeTab]);

  // 加载站点设置
  useEffect(() => {
    if (activeTab === 'site') {
      setSiteSettingsLoading(true);
      siteSettingsApi.get().then(data => {
        setSiteSettings(data);
        setSiteSettingsLoading(false);
      }).catch(() => {
        setSiteSettingsLoading(false);
      });
      setSiteSettingsMsg('');
    }
  }, [activeTab]);

  const updateFaviconLink = (url: string | null) => {
    let link = document.querySelector("link[rel~='icon']") as HTMLLinkElement;
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = url || '/vite.svg';
  };

  const handleFaviconUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const { url } = await siteSettingsApi.uploadFavicon(file);
      setSiteSettings(prev => ({ ...prev, favicon: url }));
      updateFaviconLink(url);
    } catch (err: any) {
      setSiteSettingsMsg(err.message || '上传失败');
    }
    e.target.value = '';
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const { url } = await siteSettingsApi.uploadLogo(file);
      setSiteSettings(prev => ({ ...prev, logo: url }));
    } catch (err: any) {
      setSiteSettingsMsg(err.message || '上传失败');
    }
    e.target.value = '';
  };

  const handleSiteNameSave = async (value: string) => {
    try {
      const updated = await siteSettingsApi.updateSiteName(value);
      setSiteSettings(updated);
      document.title = updated.site_name || 'MD Library';
    } catch (err: any) {
      setSiteSettingsMsg(err.message || '保存失败');
    }
  };

  const handleReset = async (type: 'favicon' | 'logo' | 'site_name') => {
    try {
      if (type === 'favicon') {
        await siteSettingsApi.resetFavicon();
        setSiteSettings(prev => ({ ...prev, favicon: undefined }));
        updateFaviconLink(null);
      } else if (type === 'logo') {
        await siteSettingsApi.resetLogo();
        setSiteSettings(prev => ({ ...prev, logo: undefined }));
      } else if (type === 'site_name') {
        await siteSettingsApi.updateSiteName('');
        setSiteSettings(prev => ({ ...prev, site_name: undefined }));
        document.title = 'MD Library';
      }
    } catch (err: any) {
      setSiteSettingsMsg(err.message || '重置失败');
    }
    setConfirmReset(null);
  };

  const fetchUsers = async () => {
    try {
      const data = await usersApi.list();
      const sorted = data.sort((a, b) => a.id - b.id);
      setUsers(sorted);
      setIsLoading(false);
      // 获取每个用户的空间数量
      const allSpaces = await spacesApi.listAll();
      const counts: Record<number, number> = {};
      await Promise.all(sorted.map(async (u: EditingUser) => {
        let count = 0;
        await Promise.all(allSpaces.map(async (s: Space) => {
          try {
            const members = await spacesApi.getMembers(s.slug);
            if (members.some((m: SpaceMember) => m.user_id === u.id)) count++;
          } catch { /* ignore */ }
        }));
        counts[u.id] = count;
      }));
      setUserSpaceCounts(counts);
    } catch (err: any) {
      setError(err.message);
      setIsLoading(false);
    }
  };

  const fetchSpaces = async () => {
    setSpacesLoading(true);
    try {
      const data = await spacesApi.listAll();
      const sorted = data.sort((a: Space, b: Space) => a.id - b.id);
      setSpaces(sorted);
      // 获取每个空间的成员数
      const counts: Record<string, number> = {};
      await Promise.all(data.map(async (s: Space) => {
        try {
          const members = await spacesApi.getMembers(s.slug);
          counts[s.slug] = members.length;
        } catch {
          counts[s.slug] = 0;
        }
      }));
      setMemberCounts(counts);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSpacesLoading(false);
    }
  };

  const fetchAllUsers = async () => {
    try {
      const data = await usersApi.list();
      setAllUsers(data.map((u: any) => ({ id: u.id, username: u.username, display_name: u.display_name })));
    } catch (err: any) {
      setError(err.message);
    }
  };

  const fetchMembers = async (slug: string) => {
    try {
      const data = await spacesApi.getMembers(slug);
      setMembers((data ?? []).sort((a: SpaceMember, b: SpaceMember) => a.id - b.id));
    } catch (err: any) {
      setError(err.message);
    }
  };

  // ---- 用户面板操作 ----
  const openCreateUserPanel = () => {
    setUserFormData({ username: '', password: '', display_name: '', role: 'user', avatar_url: '' });
    setUserPanelId('new');
    setShowUserRoleDropdown(false);
  };

  const openEditUserPanel = async (user: EditingUser) => {
    if (userPanelId === user.id) {
      closeUserPanel();
      return;
    }
    setUserFormData({ username: user.username, password: '', display_name: user.display_name, role: user.role, avatar_url: user.avatar_url || '' });
    setUserPanelId(user.id);
    setShowUserRoleDropdown(false);
    setIsAddingUserSpace(false);
    setShowUserPasswordPanel(false);
    await fetchUserSpaces(user.id);
  };

  const closeUserPanel = () => {
    setUserPanelId(null);
    setShowUserRoleDropdown(false);
    setUserSpaces([]);
    setIsAddingUserSpace(false);
    setShowSpaceDropdown(false);
    setShowNewSpaceRoleDropdown(false);
    setOpenUserSpaceRoleId(null);
    setShowUserPasswordPanel(false);
    setShowUserAvatarPicker(false);
    setPasswordTargetUserId(null);
    setUserNewPassword('');
  };

  const handleSaveUserPanel = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (userPanelId === 'new') {
        if (!userFormData.username.trim() || !userFormData.password.trim()) return;
        const created = await usersApi.create(userFormData);
        setUsers(prev => [...prev, created]);
        closeUserPanel();
      } else {
        // 编辑模式：仅保存显示名（角色即时保存）
        if (!userFormData.display_name.trim()) return;
        const updated = await usersApi.update(userPanelId as number, { display_name: userFormData.display_name });
        setUsers(prev => prev.map(u => u.id === userPanelId ? updated : u));
      }
    } catch (err: any) {
      setError(err.message);
    }
  };

  // 管理员重置用户密码
  const handleResetUserPassword = async () => {
    if (passwordTargetUserId === null || !userNewPassword.trim()) return;
    try {
      await usersApi.resetPassword(passwordTargetUserId, userNewPassword);
      setShowUserPasswordPanel(false);
      setPasswordTargetUserId(null);
      setUserNewPassword('');
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleDeleteUser = async (id: number) => {
    if (id === currentUser?.id) { setError('不能删除自己的账号'); return; }
    try {
      await usersApi.delete(id);
      setUsers(users.filter((u) => u.id !== id));
      if (userPanelId === id) closeUserPanel();
    } catch (err: any) {
      setError(err.message);
    }
  };

  // ---- 用户空间成员操作 ----
  const fetchUserSpaces = async (userId: number) => {
    try {
      const allSpaces = await spacesApi.listAll();
      setAllSpacesForUser(allSpaces.sort((a: Space, b: Space) => a.id - b.id));
      const memberships: UserSpaceMembership[] = [];
      await Promise.all(allSpaces.map(async (space) => {
        try {
          const spaceMembers = await spacesApi.getMembers(space.slug);
          const membership = spaceMembers.find(m => m.user_id === userId);
          if (membership) {
            memberships.push({ space, memberId: membership.id, role: membership.role });
          }
        } catch { /* ignore */ }
      }));
      setUserSpaces(memberships.sort((a, b) => a.space.id - b.space.id));
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleAddUserToSpace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (typeof userPanelId !== 'number' || !newUserSpace.slug) return;
    try {
      await spacesApi.addMember(newUserSpace.slug, { user_id: userPanelId, role: newUserSpace.role });
      setNewUserSpace({ slug: '', role: 'viewer' });
      setIsAddingUserSpace(false);
      await fetchUserSpaces(userPanelId);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleUpdateUserSpaceRole = async (memberId: number, role: string, spaceSlug: string) => {
    try {
      await spacesApi.updateMember(spaceSlug, memberId, role);
      if (typeof userPanelId === 'number') await fetchUserSpaces(userPanelId);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleRemoveUserFromSpace = async (memberId: number, spaceSlug: string) => {
    try {
      await spacesApi.removeMember(spaceSlug, memberId);
      if (typeof userPanelId === 'number') await fetchUserSpaces(userPanelId);
    } catch (err: any) {
      setError(err.message);
    }
  };

  // ---- 空间面板操作 ----
  const openCreatePanel = () => {
    setSpaceFormData({ name: '', icon: '', description: '', feature_flags: { git: false } });
    setMembers([]);
    setSpacePanelSlug('new');
    setIsAddingMember(false);
  };

  const openEditPanel = async (space: Space) => {
    if (spacePanelSlug === space.slug) {
      closePanel();
      return;
    }
    setSpaceFormData({ name: space.name, icon: space.icon || '', description: space.description || '', feature_flags: { ...(space.feature_flags ?? { git: false }) } });
    setSpacePanelSlug(space.slug);
    setIsAddingMember(false);
    await fetchMembers(space.slug);
  };

  const closePanel = () => {
    setSpacePanelSlug(null);
    setMembers([]);
    setIsAddingMember(false);
    setShowIconPicker(false);
    setShowUserDropdown(false);
    setShowNewRoleDropdown(false);
    setOpenMemberRoleId(null);
  };

  const handleSavePanel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!spaceFormData.name.trim()) return;
    try {
      if (spacePanelSlug === 'new') {
        await spacesApi.create(spaceFormData);
      } else {
        await spacesApi.update(spacePanelSlug!, spaceFormData);
      }
      closePanel();
      fetchSpaces();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleToggleGitFeature = async (checked: boolean) => {
    if (!spacePanelSlug || spacePanelSlug === 'new') return;
    const previous = spaceFormData.feature_flags;
    // Optimistic update
    setSpaceFormData(prev => ({ ...prev, feature_flags: { ...prev.feature_flags, git: checked } }));
    try {
      const updated = await spacesApi.updateFeatureFlags(spacePanelSlug, { git: checked });
      setSpaceFormData(prev => ({ ...prev, feature_flags: updated }));
      // Keep the spaces list in sync so other components see the new flag.
      setSpaces(prev => prev.map(s => s.slug === spacePanelSlug ? { ...s, feature_flags: updated } : s));
    } catch (err: any) {
      // Roll back on failure
      setSpaceFormData(prev => ({ ...prev, feature_flags: previous }));
      setError(err.message);
    }
  };

  const handleDeleteSpace = async (slug: string) => {
    if (!window.confirm('确定要删除此空间吗？所有页面数据将被永久删除。')) return;
    try {
      await spacesApi.delete(slug);
      setSpaces(spaces.filter((s) => s.slug !== slug));
      if (spacePanelSlug === slug) closePanel();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleRefreshSpace = async (slug: string) => {
    setRefreshingSlug(slug);
    try {
      const start = Date.now();
      await spacesApi.refresh(slug);
      // 静默刷新列表（不触发 loading 状态避免闪烁）
      const data = await spacesApi.listAll();
      const sorted = data.sort((a: Space, b: Space) => a.id - b.id);
      setSpaces(sorted);
      const counts: Record<string, number> = {};
      await Promise.all(data.map(async (s: Space) => {
        try {
          const members = await spacesApi.getMembers(s.slug);
          counts[s.slug] = members.length;
        } catch {
          counts[s.slug] = 0;
        }
      }));
      setMemberCounts(counts);
      // 至少显示 500ms 转圈动画
      const elapsed = Date.now() - start;
      if (elapsed < 500) await new Promise(r => setTimeout(r, 500 - elapsed));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setRefreshingSlug(null);
    }
  };

  // ---- 成员操作 ----
  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!spacePanelSlug || spacePanelSlug === 'new' || !newMember.user_id) return;
    try {
      await spacesApi.addMember(spacePanelSlug, newMember);
      setNewMember({ user_id: 0, role: 'viewer' });
      setIsAddingMember(false);
      fetchMembers(spacePanelSlug);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleUpdateMemberRole = async (memberId: number, role: string) => {
    if (!spacePanelSlug || spacePanelSlug === 'new') return;
    try {
      await spacesApi.updateMember(spacePanelSlug, memberId, role);
      fetchMembers(spacePanelSlug);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleRemoveMember = async (memberId: number) => {
    if (!spacePanelSlug || spacePanelSlug === 'new') return;
    try {
      await spacesApi.removeMember(spacePanelSlug, memberId);
      fetchMembers(spacePanelSlug);
    } catch (err: any) {
      setError(err.message);
    }
  };

  // ---- 加载中 ----
  if (activeTab === 'users' && isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-notion-text"></div>
      </div>
    );
  }

  // ---- 用户内联面板 ----
  const renderUserPanel = (isEditing: boolean) => {
    const availableSpaces = allSpacesForUser.filter(s => !userSpaces.some(us => us.space.slug === s.slug));

    return (
    <form onSubmit={handleSaveUserPanel} className="p-6">
      {isEditing ? null : (
        // 创建模式：[头像] [用户名] [显示名] [密码] [身份下拉] ✔ ✗
        <div className="flex items-center gap-2">
          {/* 头像选择 */}
          <div className="relative" ref={userAvatarPickerRef}>
            <button
              type="button"
              onClick={() => setShowUserAvatarPicker(!showUserAvatarPicker)}
              className="w-8 h-8 rounded border border-notion-border hover:bg-notion-hover flex items-center justify-center text-lg transition-colors"
              title="选择头像"
            >
              {userFormData.avatar_url || <Smile className="w-4 h-4 text-notion-textSecondary" />}
            </button>
            {showUserAvatarPicker && (
              <div className="absolute top-full left-0 mt-1 bg-white border border-notion-border rounded-lg shadow-lg p-2 z-50 w-[260px]">
                <div className="grid grid-cols-8 gap-1">
                  {ICON_OPTIONS.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => { setUserFormData({ ...userFormData, avatar_url: emoji }); setShowUserAvatarPicker(false); }}
                      className={`w-8 h-8 rounded hover:bg-notion-hover flex items-center justify-center text-base transition-colors ${userFormData.avatar_url === emoji ? 'bg-notion-hover ring-1 ring-blue-400' : ''}`}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <input
            type="text"
            value={userFormData.username}
            onChange={(e) => setUserFormData({ ...userFormData, username: e.target.value })}
            placeholder="用户名"
            className="flex-1 px-2 py-1.5 border border-notion-border rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
          />
          <input
            type="text"
            value={userFormData.display_name}
            onChange={(e) => setUserFormData({ ...userFormData, display_name: e.target.value })}
            placeholder="显示名称"
            className="flex-1 px-2 py-1.5 border border-notion-border rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
          />
          <input
            type="password"
            value={userFormData.password}
            onChange={(e) => setUserFormData({ ...userFormData, password: e.target.value })}
            placeholder="密码"
            className="flex-1 px-2 py-1.5 border border-notion-border rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
          />
          {/* 角色下拉 */}
          <div className="relative" ref={dropdownsRef}>
            <button
              type="button"
              onClick={() => setShowUserRoleDropdown(!showUserRoleDropdown)}
              className="flex items-center justify-between gap-1 px-2 py-1.5 border border-notion-border rounded text-sm hover:bg-notion-hover transition-colors min-w-[90px]"
            >
              <span className="text-notion-text">{userFormData.role === 'admin' ? '管理员' : '普通用户'}</span>
              <ChevronDown className="w-3.5 h-3.5 text-notion-textSecondary flex-shrink-0" />
            </button>
              {showUserRoleDropdown && (
                <div className="absolute top-full right-0 mt-1 bg-white border border-notion-border rounded-lg shadow-lg z-50 w-full py-1">
                  <button type="button" onClick={() => { setUserFormData({ ...userFormData, role: 'user' }); setShowUserRoleDropdown(false); }} className={`w-full text-left px-3 py-1.5 text-sm hover:bg-notion-hover transition-colors ${userFormData.role === 'user' ? 'bg-notion-hover' : ''}`}>普通用户</button>
                  <button type="button" onClick={() => { setUserFormData({ ...userFormData, role: 'admin' }); setShowUserRoleDropdown(false); }} className={`w-full text-left px-3 py-1.5 text-sm hover:bg-notion-hover transition-colors ${userFormData.role === 'admin' ? 'bg-notion-hover' : ''}`}>管理员</button>
                </div>
              )}
            </div>
            <button type="submit" className="p-1 text-notion-textSecondary hover:text-notion-text transition-colors" title="创建"><Check className="w-4 h-4" /></button>
            <button type="button" onClick={closeUserPanel} className="p-1 text-notion-textSecondary hover:text-notion-text transition-colors" title="取消"><X className="w-4 h-4" /></button>
          </div>
      )}
      {/* 空间成员管理（仅编辑模式） */}
      {isEditing && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-notion-text">空间</span>
            <button
              type="button"
              onClick={() => setIsAddingUserSpace(!isAddingUserSpace)}
              className="flex items-center gap-1 px-2.5 py-1 text-xs bg-notion-text text-white rounded hover:bg-gray-700 transition-colors"
            >
              <PlusCircle className="w-3 h-3" />加入空间
            </button>
          </div>

          {/* 添加空间行 */}
          {isAddingUserSpace && (
            <div className="flex items-center gap-2 mb-3 bg-white rounded-lg p-3" ref={userDropdownsRef}>
              {/* 空间选择下拉 */}
              <div className="relative flex-1">
                <button
                  type="button"
                  onClick={() => { setShowSpaceDropdown(!showSpaceDropdown); setShowNewSpaceRoleDropdown(false); }}
                  className="w-full flex items-center justify-between px-3 py-1.5 border border-notion-border rounded text-sm hover:bg-notion-hover transition-colors"
                >
                  <span className={newUserSpace.slug ? 'text-notion-text' : 'text-notion-textSecondary'}>
                    {newUserSpace.slug ? availableSpaces.find(s => s.slug === newUserSpace.slug)?.name || '选择空间' : '选择空间'}
                  </span>
                  <ChevronDown className="w-3.5 h-3.5 text-notion-textSecondary flex-shrink-0" />
                </button>
                {showSpaceDropdown && (
                  <div className="absolute top-full left-0 mt-1 bg-white border border-notion-border rounded-lg shadow-lg z-50 w-full max-h-[240px] overflow-y-auto py-1">
                    {availableSpaces.length === 0 ? (
                      <div className="px-3 py-2 text-sm text-notion-textSecondary">没有可加入的空间</div>
                    ) : (
                      availableSpaces.map(s => (
                        <button
                          key={s.slug}
                          type="button"
                          onClick={() => { setNewUserSpace({ ...newUserSpace, slug: s.slug }); setShowSpaceDropdown(false); }}
                          className={`w-full text-left px-3 py-1.5 text-sm hover:bg-notion-hover transition-colors ${newUserSpace.slug === s.slug ? 'bg-notion-hover text-notion-text' : 'text-notion-text'}`}
                        >
                          {s.icon && <span className="mr-1">{s.icon}</span>}
                          {s.name}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>

              {/* 权限选择下拉 */}
              <div className="relative w-24">
                <button
                  type="button"
                  onClick={() => { setShowNewSpaceRoleDropdown(!showNewSpaceRoleDropdown); setShowSpaceDropdown(false); }}
                  className="w-full flex items-center justify-between px-3 py-1.5 border border-notion-border rounded text-sm hover:bg-notion-hover transition-colors"
                >
                  <span className="text-notion-text">{newUserSpace.role === 'editor' ? '编辑' : '只读'}</span>
                  <ChevronDown className="w-3.5 h-3.5 text-notion-textSecondary flex-shrink-0" />
                </button>
                {showNewSpaceRoleDropdown && (
                  <div className="absolute top-full right-0 mt-1 bg-white border border-notion-border rounded-lg shadow-lg z-50 min-w-[100px] py-1">
                    <button type="button" onClick={() => { setNewUserSpace({ ...newUserSpace, role: 'editor' }); setShowNewSpaceRoleDropdown(false); }} className={`w-full text-left px-3 py-1.5 text-sm hover:bg-notion-hover transition-colors ${newUserSpace.role === 'editor' ? 'bg-notion-hover' : ''}`}>编辑</button>
                    <button type="button" onClick={() => { setNewUserSpace({ ...newUserSpace, role: 'viewer' }); setShowNewSpaceRoleDropdown(false); }} className={`w-full text-left px-3 py-1.5 text-sm hover:bg-notion-hover transition-colors ${newUserSpace.role === 'viewer' ? 'bg-notion-hover' : ''}`}>只读</button>
                  </div>
                )}
              </div>

              <button type="button" onClick={handleAddUserToSpace} className="p-1.5 text-notion-textSecondary hover:text-notion-text transition-colors" title="添加"><Check className="w-4 h-4" /></button>
              <button type="button" onClick={() => setIsAddingUserSpace(false)} className="px-2 py-1.5 text-notion-textSecondary hover:text-notion-text"><X className="w-4 h-4" /></button>
            </div>
          )}

          {/* 空间列表 */}
          {userSpaces.length === 0 ? (
            <p className="text-sm text-notion-textSecondary py-2">未加入任何空间</p>
          ) : (
            <div className="space-y-0.5">
              {userSpaces.map((us) => (
                <div key={us.space.slug} className="flex items-center justify-between py-2 px-3 rounded hover:bg-notion-hover transition-colors group">
                  <div className="flex items-center gap-2">
                    {us.space.icon && <span>{us.space.icon}</span>}
                    <span className="text-sm text-notion-text">{us.space.name}</span>
                  </div>
                  <div className="flex items-center gap-2" ref={openUserSpaceRoleId === us.memberId ? userDropdownsRef : undefined}>
                    {/* 权限下拉 */}
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => { setOpenUserSpaceRoleId(openUserSpaceRoleId === us.memberId ? null : us.memberId); }}
                        className="flex items-center gap-1 px-2 py-1 rounded text-xs hover:bg-notion-hover transition-colors text-notion-textSecondary"
                      >
                        <span>{roleLabels[us.role] || us.role}</span>
                        <ChevronDown className="w-3 h-3" />
                      </button>
                      {openUserSpaceRoleId === us.memberId && (
                        <div className="absolute top-full right-0 mt-1 bg-white border border-notion-border rounded-lg shadow-lg z-50 min-w-[100px] py-1">
                          <button type="button" onClick={() => { handleUpdateUserSpaceRole(us.memberId, 'editor', us.space.slug); setOpenUserSpaceRoleId(null); }} className={`w-full text-left px-3 py-1.5 text-sm hover:bg-notion-hover transition-colors ${us.role === 'editor' ? 'bg-notion-hover' : ''}`}>编辑</button>
                          <button type="button" onClick={() => { handleUpdateUserSpaceRole(us.memberId, 'viewer', us.space.slug); setOpenUserSpaceRoleId(null); }} className={`w-full text-left px-3 py-1.5 text-sm hover:bg-notion-hover transition-colors ${us.role === 'viewer' ? 'bg-notion-hover' : ''}`}>只读</button>
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveUserFromSpace(us.memberId, us.space.slug)}
                      className="text-red-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                      title="退出空间"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {/* 创建模式底部无额外按钮（✔✗已在第二行） */}
    </form>
    );
  };

  // ---- 用户管理视图 ----
  const renderUsers = () => (
    <>
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-xl font-semibold text-notion-text">用户管理</h1>
        <button onClick={openCreateUserPanel} className="flex items-center gap-1.5 px-3 py-1.5 bg-notion-text text-white text-sm rounded-md hover:bg-gray-700 transition-colors">
          <Plus className="w-3.5 h-3.5" />添加用户
        </button>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-2 rounded-lg mb-4">{error}</div>}

      <div className="bg-white rounded-lg border border-notion-border overflow-visible">
        <table className="w-full table-fixed">
          <colgroup>
            <col className="w-[26%]" />
            <col className="w-[16%]" />
            <col className="w-[14%]" />
            <col className="w-[10%]" />
            <col className="w-[18%]" />
            <col className="w-[16%]" />
          </colgroup>
          <thead className="bg-notion-sidebarBg">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-notion-textSecondary uppercase tracking-wider">显示名</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-notion-textSecondary uppercase tracking-wider">用户名</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-notion-textSecondary uppercase tracking-wider">角色</th>
              <th className="px-6 py-3 text-center text-xs font-medium text-notion-textSecondary uppercase tracking-wider">空间</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-notion-textSecondary uppercase tracking-wider">创建时间</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-notion-textSecondary uppercase tracking-wider">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-notion-border">
            {/* 创建面板 — 插入到列表顶部 */}
            {userPanelId === 'new' && (
              <tr className="bg-notion-sidebarBg/30">
                <td colSpan={6}>{renderUserPanel(false)}</td>
              </tr>
            )}
            {users.map((user) => (
              <Fragment key={user.id}>
                {/* 正常行 — 始终显示 */}
                <tr className="transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="relative">
                        <PageIcon
                          compact
                          icon={user.avatar_url || null}
                          onSelect={async (value) => {
                            try {
                              const updated = await usersApi.update(user.id, { avatar_url: value } as any);
                              setUsers(prev => prev.map(u => u.id === user.id ? updated : u));
                            } catch (err) {
                              console.error('Failed to update avatar:', err);
                            }
                          }}
                        />
                      </div>
                      {editingDisplayNameUserId === user.id ? (
                        <input
                          type="text"
                          value={editingDisplayNameValue}
                          onChange={(e) => setEditingDisplayNameValue(e.target.value)}
                          onBlur={async () => {
                            if (editingDisplayNameValue.trim() && editingDisplayNameValue !== user.display_name) {
                              try {
                                const updated = await usersApi.update(user.id, { display_name: editingDisplayNameValue });
                                setUsers(prev => prev.map(u => u.id === user.id ? updated : u));
                              } catch (err: any) { setError(err.message); }
                            }
                            setEditingDisplayNameUserId(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') { (e.target as HTMLInputElement).blur(); }
                            if (e.key === 'Escape') { setEditingDisplayNameUserId(null); }
                          }}
                          className="flex-1 font-medium text-notion-text bg-transparent outline-none border border-blue-300 rounded px-2 py-1 -mx-2 -my-1"
                          autoFocus
                        />
                      ) : (
                        <span
                          onClick={() => { setEditingDisplayNameUserId(user.id); setEditingDisplayNameValue(user.display_name); }}
                          className="flex-1 font-medium text-notion-text cursor-pointer border border-transparent hover:border-notion-border rounded px-2 py-1 -mx-2 -my-1 transition-colors"
                        >
                          {user.display_name}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-notion-textSecondary">{user.username}</td>
                  <td className="px-6 py-4">
                    <div className="relative inline-block" ref={roleDropdownUserId === user.id ? roleDropdownRef : undefined}>
                      <button
                        onClick={() => setRoleDropdownUserId(roleDropdownUserId === user.id ? null : user.id)}
                        className={`px-2 py-1 rounded text-xs font-medium cursor-pointer border border-transparent transition-colors ${
                          user.role === 'admin'
                            ? 'bg-purple-100 text-purple-700 hover:border-purple-300'
                            : 'bg-gray-100 text-gray-700 hover:border-gray-300'
                        }`}
                      >
                        {user.role === 'admin' ? '管理员' : '普通用户'}
                      </button>
                      {roleDropdownUserId === user.id && (
                        <div className="absolute top-full left-0 mt-1 bg-white border border-notion-border rounded-lg shadow-lg z-50 p-1 min-w-[100px]">
                          <button
                            onClick={() => handleInlineRoleChange(user.id, 'user')}
                            className={`w-full text-left px-3 py-1.5 rounded text-sm transition-colors ${
                              user.role === 'user' ? 'bg-gray-100 text-gray-700' : 'hover:bg-gray-50 text-gray-700'
                            }`}
                          >普通用户</button>
                          <button
                            onClick={() => handleInlineRoleChange(user.id, 'admin')}
                            className={`w-full text-left px-3 py-1.5 rounded text-sm transition-colors ${
                              user.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'hover:bg-purple-50 text-purple-700'
                            }`}
                          >管理员</button>
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-center text-notion-textSecondary text-sm">{userSpaceCounts[user.id] ?? '-'}</td>
                  <td className="px-6 py-4 text-notion-textSecondary">{new Date(user.created_at).toLocaleDateString()}</td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => openEditUserPanel(user)} className="text-notion-textSecondary hover:text-notion-text" title="展开">{userPanelId === user.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}</button>
                      <div className="relative">
                        <button onClick={() => { if (passwordTargetUserId === user.id && showUserPasswordPanel) { setShowUserPasswordPanel(false); setPasswordTargetUserId(null); } else { setShowUserPasswordPanel(true); setPasswordTargetUserId(user.id); setUserNewPassword(''); } }} className="text-notion-textSecondary hover:text-notion-text" title="重置密码"><Key className="w-4 h-4" /></button>
                        {passwordTargetUserId === user.id && showUserPasswordPanel && (
                          <div className="absolute top-full right-0 mt-1 bg-white border border-notion-border rounded-lg shadow-lg z-50 p-3 w-64">
                            <span className="text-sm text-notion-textSecondary block mb-2 text-left">修改密码</span>
                            <div className="flex items-center gap-2">
                              <input
                                type="password"
                                value={userNewPassword}
                                onChange={(e) => setUserNewPassword(e.target.value)}
                                placeholder="新密码"
                                className="flex-1 px-2 py-1 border border-notion-border rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                autoFocus
                                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleResetUserPassword(); } }}
                              />
                              <button onClick={handleResetUserPassword} disabled={!userNewPassword.trim()} className="p-0.5 text-notion-textSecondary hover:text-notion-text transition-colors disabled:opacity-30 disabled:cursor-not-allowed" title="确认">
                                <Check className="w-4 h-4" />
                              </button>
                              <button onClick={() => { setShowUserPasswordPanel(false); setPasswordTargetUserId(null); }} className="p-0.5 text-notion-textSecondary hover:text-notion-text transition-colors" title="取消">
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                      <button onClick={() => handleDeleteUser(user.id)} className="text-red-500 hover:text-red-600" title="删除"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </td>
                </tr>
                {/* 编辑面板 — 在下方插入 */}
                {userPanelId === user.id && (
                  <tr className="bg-notion-sidebarBg/30">
                    <td colSpan={6}>{renderUserPanel(true)}</td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );

  // ---- 渲染内联展开面板 ----
  const renderInlinePanel = (isEditing: boolean) => {
    const availableUsers = allUsers.filter(u => !(members ?? []).some(m => m.user_id === u.id));

    return (
      <form onSubmit={handleSavePanel} className="p-6">
        {isEditing ? null : (
        <div className="flex items-center gap-2">
          {/* 图标按钮 */}
          <div className="relative" ref={iconPickerRef}>
            <button
              type="button"
              onClick={() => setShowIconPicker(!showIconPicker)}
              className="w-8 h-8 rounded border border-notion-border hover:bg-notion-hover flex items-center justify-center text-lg transition-colors"
              title="选择图标"
            >
              {spaceFormData.icon || <Smile className="w-4 h-4 text-notion-textSecondary" />}
            </button>
            {showIconPicker && (
              <div className="absolute top-full left-0 mt-1 bg-white border border-notion-border rounded-lg shadow-lg p-2 z-50 w-[260px]">
                <div className="grid grid-cols-8 gap-1">
                  {ICON_OPTIONS.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => { setSpaceFormData({ ...spaceFormData, icon: emoji }); setShowIconPicker(false); }}
                      className={`w-8 h-8 rounded hover:bg-notion-hover flex items-center justify-center text-base transition-colors ${spaceFormData.icon === emoji ? 'bg-notion-hover ring-1 ring-blue-400' : ''}`}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 名称 */}
          <input
            type="text"
            value={spaceFormData.name}
            onChange={(e) => setSpaceFormData({ ...spaceFormData, name: e.target.value })}
            placeholder="空间名称"
            className="flex-1 px-2 py-1.5 border border-notion-border rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
          />

          {/* 描述 */}
          <input
            type="text"
            value={spaceFormData.description}
            onChange={(e) => setSpaceFormData({ ...spaceFormData, description: e.target.value })}
            placeholder="描述（可选）"
            className="flex-1 px-2 py-1.5 border border-notion-border rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button type="submit" className="p-1 text-notion-textSecondary hover:text-notion-text transition-colors" title="创建"><Check className="w-4 h-4" /></button>
          <button type="button" onClick={closePanel} className="p-1 text-notion-textSecondary hover:text-notion-text transition-colors" title="取消"><X className="w-4 h-4" /></button>
        </div>
        )}

        {/* 功能开关（仅编辑模式） */}
        {isEditing && (
          <div className="mb-3 pb-3 border-b border-notion-border">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={spaceFormData.feature_flags?.git ?? false}
                onChange={(e) => handleToggleGitFeature(e.target.checked)}
                className="w-4 h-4 rounded border-notion-border text-notion-text focus:ring-blue-500"
              />
              <span className="text-sm text-notion-text">Git 管理</span>
            </label>
          </div>
        )}

        {/* 成员区域（仅编辑模式） */}
        {isEditing && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-notion-text">成员</span>
              <button
                type="button"
                onClick={() => setIsAddingMember(!isAddingMember)}
                className="flex items-center gap-1 px-2.5 py-1 text-xs bg-notion-text text-white rounded hover:bg-gray-700 transition-colors"
              >
                <UserPlus className="w-3 h-3" />添加成员
              </button>
            </div>

            {/* 添加成员行 */}
            {isAddingMember && (
              <div className="flex items-center gap-2 mb-3 bg-white rounded-lg p-3" ref={dropdownsRef}>
                {/* 用户选择下拉 */}
                <div className="relative flex-1">
                  <button
                    type="button"
                    onClick={() => { setShowUserDropdown(!showUserDropdown); setShowNewRoleDropdown(false); }}
                    className="w-full flex items-center justify-between px-3 py-1.5 border border-notion-border rounded text-sm hover:bg-notion-hover transition-colors"
                  >
                    <span className={newMember.user_id ? 'text-notion-text' : 'text-notion-textSecondary'}>
                      {newMember.user_id ? availableUsers.find(u => u.id === newMember.user_id)?.display_name || '选择用户' : '选择用户'}
                    </span>
                    <ChevronDown className="w-3.5 h-3.5 text-notion-textSecondary flex-shrink-0" />
                  </button>
                  {showUserDropdown && (
                    <div className="absolute top-full left-0 mt-1 bg-white border border-notion-border rounded-lg shadow-lg z-50 w-full max-h-[240px] overflow-y-auto py-1">
                      {availableUsers.length === 0 ? (
                        <div className="px-3 py-2 text-sm text-notion-textSecondary">没有可添加的用户</div>
                      ) : (
                        availableUsers.map(u => (
                          <button
                            key={u.id}
                            type="button"
                            onClick={() => { setNewMember({ ...newMember, user_id: u.id }); setShowUserDropdown(false); }}
                            className={`w-full text-left px-3 py-1.5 text-sm hover:bg-notion-hover transition-colors ${newMember.user_id === u.id ? 'bg-notion-hover text-notion-text' : 'text-notion-text'}`}
                          >
                            {u.display_name}
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>

                {/* 权限选择下拉 */}
                <div className="relative w-24">
                  <button
                    type="button"
                    onClick={() => { setShowNewRoleDropdown(!showNewRoleDropdown); setShowUserDropdown(false); }}
                    className="w-full flex items-center justify-between px-3 py-1.5 border border-notion-border rounded text-sm hover:bg-notion-hover transition-colors"
                  >
                    <span className="text-notion-text">{newMember.role === 'editor' ? '编辑' : '只读'}</span>
                    <ChevronDown className="w-3.5 h-3.5 text-notion-textSecondary flex-shrink-0" />
                  </button>
                  {showNewRoleDropdown && (
                    <div className="absolute top-full right-0 mt-1 bg-white border border-notion-border rounded-lg shadow-lg z-50 min-w-[100px] py-1">
                      <button type="button" onClick={() => { setNewMember({ ...newMember, role: 'editor' }); setShowNewRoleDropdown(false); }} className={`w-full text-left px-3 py-1.5 text-sm hover:bg-notion-hover transition-colors ${newMember.role === 'editor' ? 'bg-notion-hover' : ''}`}>编辑</button>
                      <button type="button" onClick={() => { setNewMember({ ...newMember, role: 'viewer' }); setShowNewRoleDropdown(false); }} className={`w-full text-left px-3 py-1.5 text-sm hover:bg-notion-hover transition-colors ${newMember.role === 'viewer' ? 'bg-notion-hover' : ''}`}>只读</button>
                    </div>
                  )}
                </div>

                <button type="button" onClick={handleAddMember} className="p-1.5 text-notion-textSecondary hover:text-notion-text transition-colors" title="添加"><Check className="w-4 h-4" /></button>
                <button type="button" onClick={() => setIsAddingMember(false)} className="px-2 py-1.5 text-notion-textSecondary hover:text-notion-text"><X className="w-4 h-4" /></button>
              </div>
            )}

            {/* 成员列表 */}
            {members.length === 0 ? (
              <p className="text-sm text-notion-textSecondary py-2">暂无成员</p>
            ) : (
              <div className="space-y-0.5">
                {members.map((member) => (
                  <div key={member.id} className="flex items-center justify-between py-2 px-3 rounded hover:bg-notion-hover transition-colors group">
                    <span className="text-sm text-notion-text">{member.user.display_name}</span>
                    <div className="flex items-center gap-2" ref={openMemberRoleId === member.id ? dropdownsRef : undefined}>
                      {/* 成员权限下拉 */}
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => { setOpenMemberRoleId(openMemberRoleId === member.id ? null : member.id); }}
                          className="flex items-center gap-1 px-2 py-1 rounded text-xs hover:bg-notion-hover transition-colors text-notion-textSecondary"
                        >
                          <span>{roleLabels[member.role] || member.role}</span>
                          <ChevronDown className="w-3 h-3" />
                        </button>
                        {openMemberRoleId === member.id && (
                          <div className="absolute top-full right-0 mt-1 bg-white border border-notion-border rounded-lg shadow-lg z-50 min-w-[100px] py-1">
                            <button type="button" onClick={() => { handleUpdateMemberRole(member.id, 'editor'); setOpenMemberRoleId(null); }} className={`w-full text-left px-3 py-1.5 text-sm hover:bg-notion-hover transition-colors ${member.role === 'editor' ? 'bg-notion-hover' : ''}`}>编辑</button>
                            <button type="button" onClick={() => { handleUpdateMemberRole(member.id, 'viewer'); setOpenMemberRoleId(null); }} className={`w-full text-left px-3 py-1.5 text-sm hover:bg-notion-hover transition-colors ${member.role === 'viewer' ? 'bg-notion-hover' : ''}`}>只读</button>
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveMember(member.id)}
                        className="text-red-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                        title="移除"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

      </form>
    );
  };

  // ---- 空间管理视图 ----
  const renderSpaces = () => {
    if (spacesLoading) {
      return (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-notion-text"></div>
        </div>
      );
    }

    return (
      <>
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-xl font-semibold text-notion-text">空间管理</h1>
          <button onClick={openCreatePanel} className="flex items-center gap-1.5 px-3 py-1.5 bg-notion-text text-white text-sm rounded-md hover:bg-gray-700 transition-colors">
            <Plus className="w-3.5 h-3.5" />创建空间
          </button>
        </div>

        {error && <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-2 rounded-lg mb-4">{error}</div>}

        <div className="bg-white rounded-lg border border-notion-border overflow-visible">
          <table className="w-full table-fixed">
            <colgroup>
              <col className="w-[25%]" />
              <col className="w-[30%]" />
              <col className="w-[20%]" />
              <col className="w-[10%]" />
              <col className="w-[15%]" />
            </colgroup>
            <thead className="bg-notion-sidebarBg">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-notion-textSecondary uppercase tracking-wider">空间</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-notion-textSecondary uppercase tracking-wider">描述</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-notion-textSecondary uppercase tracking-wider">创建时间</th>
                <th className="px-6 py-3 text-center text-xs font-medium text-notion-textSecondary uppercase tracking-wider">成员</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-notion-textSecondary uppercase tracking-wider">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-notion-border">
              {/* 创建面板 — 插入到列表顶部 */}
              {spacePanelSlug === 'new' && (
                <tr className="bg-notion-sidebarBg/30">
                  <td colSpan={5}>{renderInlinePanel(false)}</td>
                </tr>
              )}
              {spaces.map((space) => (
                <Fragment key={space.slug}>
                  {/* 正常行 — 始终显示 */}
                  <tr className="transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <PageIcon
                          compact
                          icon={space.icon || null}
                          onSelect={async (value) => {
                            try {
                              await spacesApi.update(space.slug, { icon: value, name: space.name, description: space.description || '' });
                              fetchSpaces();
                            } catch (err) {
                              console.error('Failed to update icon:', err);
                            }
                          }}
                        />
                        {editingSpaceNameSlug === space.slug ? (
                          <input
                            type="text"
                            value={editingSpaceNameValue}
                            onChange={(e) => setEditingSpaceNameValue(e.target.value)}
                            onBlur={async () => {
                              if (editingSpaceNameValue.trim() && editingSpaceNameValue !== space.name) {
                                try {
                                  await spacesApi.update(space.slug, { name: editingSpaceNameValue, description: space.description || '', icon: space.icon || '' });
                                  fetchSpaces();
                                } catch (err: any) { setError(err.message); }
                              }
                              setEditingSpaceNameSlug(null);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') { (e.target as HTMLInputElement).blur(); }
                              if (e.key === 'Escape') { setEditingSpaceNameSlug(null); }
                            }}
                            className="flex-1 min-w-0 font-medium text-notion-text bg-transparent outline-none border border-blue-300 rounded px-2 py-1 -mx-2 -my-1"
                            autoFocus
                          />
                        ) : (
                          <span
                            onClick={() => { setEditingSpaceNameSlug(space.slug); setEditingSpaceNameValue(space.name); }}
                            className="flex-1 min-w-0 font-medium text-notion-text cursor-pointer border border-transparent hover:border-notion-border rounded px-2 py-1 -mx-2 -my-1 transition-colors truncate"
                          >
                            {space.name}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {editingSpaceDescSlug === space.slug ? (
                        <input
                          type="text"
                          value={editingSpaceDescValue}
                          onChange={(e) => setEditingSpaceDescValue(e.target.value)}
                          onBlur={async () => {
                            if (editingSpaceDescValue !== (space.description || '')) {
                              try {
                                await spacesApi.update(space.slug, { name: space.name, description: editingSpaceDescValue, icon: space.icon || '' });
                                fetchSpaces();
                              } catch (err: any) { setError(err.message); }
                            }
                            setEditingSpaceDescSlug(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') { (e.target as HTMLInputElement).blur(); }
                            if (e.key === 'Escape') { setEditingSpaceDescSlug(null); }
                          }}
                          className="w-full text-notion-textSecondary bg-transparent outline-none border border-blue-300 rounded px-2 py-1 min-w-0"
                          autoFocus
                        />
                      ) : (
                        <span
                          onClick={() => { setEditingSpaceDescSlug(space.slug); setEditingSpaceDescValue(space.description || ''); }}
                          className="text-notion-textSecondary cursor-pointer border border-transparent hover:border-notion-border rounded px-2 py-1 transition-colors block truncate"
                        >
                          {space.description || '-'}
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-notion-textSecondary">{new Date(space.created_at).toLocaleDateString()}</td>
                    <td className="px-6 py-4 text-center text-notion-textSecondary text-sm">{memberCounts[space.slug] ?? '-'}</td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => openEditPanel(space)} className="text-notion-textSecondary hover:text-notion-text" title="展开">{spacePanelSlug === space.slug ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}</button>
                        <button onClick={() => handleRefreshSpace(space.slug)} disabled={refreshingSlug === space.slug} className="text-notion-textSecondary hover:text-notion-text disabled:pointer-events-none" title="刷新">
                          <RefreshCw className={`w-4 h-4 ${refreshingSlug === space.slug ? 'animate-spin' : ''}`} />
                        </button>
                        <button onClick={() => handleDeleteSpace(space.slug)} className="text-red-500 hover:text-red-600" title="删除"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </td>
                  </tr>
                  {/* 编辑面板 — 在下方插入 */}
                  {spacePanelSlug === space.slug && (
                    <tr className="bg-notion-sidebarBg/30">
                      <td colSpan={5}>{renderInlinePanel(true)}</td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );
  };

  // ---- 个人设置视图 ----

  // ---- 资源管理操作 ----
  const handleUploadResource = async (file: File) => {
    setUploadingResource(true);
    try {
      const name = file.name.replace(/\.[^.]+$/, '');
      if (resourceType === 'icons') {
        const item = await uploadToIconLibrary(file, name);
        setIconItems(prev => [...prev, item]);
      } else {
        const item = await uploadToCoverLibrary(file, name);
        setCoverItems(prev => [...prev, item]);
      }
    } catch (err: any) {
      setError(err.response?.data || err.message || '上传失败');
    } finally {
      setUploadingResource(false);
      if (resourceType === 'icons' && iconFileRef.current) iconFileRef.current.value = '';
      if (resourceType === 'covers' && coverFileRef.current) coverFileRef.current.value = '';
    }
  };

  const handleDeleteResource = async (name: string) => {
    if (!window.confirm(`确定要删除「${name}」吗？`)) return;
    try {
      if (resourceType === 'icons') {
        await deleteIcon(name);
        setIconItems(prev => prev.filter(i => i.name !== name));
      } else {
        await deleteCover(name);
        setCoverItems(prev => prev.filter(i => i.name !== name));
      }
    } catch (err: any) {
      setError(err.message || '删除失败');
    }
  };

  const handleStartRename = (name: string) => {
    setRenamingItem(name);
    setRenameValue(name.replace(/\.[^.]+$/, ''));
  };

  const handleConfirmRename = async () => {
    if (!renamingItem || !renameValue.trim()) return;
    try {
      if (resourceType === 'icons') {
        const updated = await renameIcon(renamingItem, renameValue.trim());
        setIconItems(prev => prev.map(i => i.name === renamingItem ? updated : i));
      } else {
        const updated = await renameCover(renamingItem, renameValue.trim());
        setCoverItems(prev => prev.map(i => i.name === renamingItem ? updated : i));
      }
      setRenamingItem(null);
      setRenameValue('');
    } catch (err: any) {
      setError(err.response?.data || err.message || '改名失败');
    }
  };

  const handleResourceFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith('image/')) {
      handleUploadResource(file);
    }
  };

  // ---- 资源管理视图 ----
  const renderResources = () => {
    const items = resourceType === 'icons' ? iconItems : coverItems;
    const isIcons = resourceType === 'icons';

    return (
      <>
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-semibold text-notion-text">资源管理</h1>
        </div>

        {error && <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-2 rounded-lg mb-4">{error}</div>}

        {/* Sub tabs + upload button */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex gap-1">
            <button
              onClick={() => { setResourceType('icons'); setRenamingItem(null); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors ${
                resourceType === 'icons' ? 'bg-notion-hover text-notion-text font-medium' : 'text-notion-textSecondary hover:bg-notion-hover'
              }`}
            >
              <Image className="w-4 h-4" />
              图标库 ({iconItems.length})
            </button>
            <button
              onClick={() => { setResourceType('covers'); setRenamingItem(null); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors ${
                resourceType === 'covers' ? 'bg-notion-hover text-notion-text font-medium' : 'text-notion-textSecondary hover:bg-notion-hover'
              }`}
            >
              <ImageIcon className="w-4 h-4" />
              封面库 ({coverItems.length})
            </button>
          </div>
          <button
            onClick={() => isIcons ? iconFileRef.current?.click() : coverFileRef.current?.click()}
            disabled={uploadingResource}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-notion-text text-white text-sm rounded-md hover:bg-gray-700 transition-colors disabled:opacity-50"
          >
            <Upload className="w-3.5 h-3.5" />
            {uploadingResource ? '上传中...' : '上传'}
          </button>
          <input ref={iconFileRef} type="file" accept="image/*" className="hidden" onChange={handleResourceFileChange} />
          <input ref={coverFileRef} type="file" accept="image/*" className="hidden" onChange={handleResourceFileChange} />
        </div>

        {/* Resource grid */}
        {items.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-notion-textSecondary text-sm">
              {isIcons ? '暂无自定义图标，上传图标或编辑页面时添加到图标库' : '暂无自定义封面，上传封面或编辑封面时添加到封面库'}
            </p>
          </div>
        ) : isIcons ? (
          /* Icons: square grid */
          <div className="grid grid-cols-5 gap-3">
            {items.map(item => (
              <div key={item.name} className="group relative bg-white rounded-lg border border-notion-border overflow-hidden hover:shadow-md transition-shadow">
                <div className="aspect-square flex items-center justify-center p-4">
                  <img src={item.url} alt="" className="max-w-full max-h-full object-contain" loading="lazy" />
                </div>
                {/* Name */}
                <div className="px-2 pb-2">
                  {renamingItem === item.name ? (
                    <div className="flex items-center gap-1">
                      <input
                        type="text"
                        value={renameValue}
                        onChange={e => setRenameValue(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleConfirmRename(); if (e.key === 'Escape') setRenamingItem(null); }}
                        className="flex-1 px-1 py-0.5 text-xs border border-notion-border rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
                        autoFocus
                      />
                      <button onClick={handleConfirmRename} className="p-0.5 text-notion-textSecondary hover:text-notion-text"><Check className="w-3 h-3" /></button>
                      <button onClick={() => setRenamingItem(null)} className="p-0.5 text-notion-textSecondary hover:text-notion-text"><X className="w-3 h-3" /></button>
                    </div>
                  ) : (
                    <p className="text-[11px] text-notion-textSecondary truncate" title={item.name}>
                      {item.name.replace(/\.[^.]+$/, '')}
                    </p>
                  )}
                </div>
                {/* Hover actions */}
                {renamingItem !== item.name && (
                  <div className="absolute top-1 right-1 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => handleStartRename(item.name)} className="p-1 bg-white/90 rounded shadow-sm hover:bg-notion-hover" title="改名">
                      <Edit2 className="w-3 h-3 text-notion-textSecondary" />
                    </button>
                    <a href={item.url} download className="p-1 bg-white/90 rounded shadow-sm hover:bg-notion-hover" title="下载">
                      <Download className="w-3 h-3 text-notion-textSecondary" />
                    </a>
                    <button onClick={() => handleDeleteResource(item.name)} className="p-1 bg-white/90 rounded shadow-sm hover:bg-red-50" title="删除">
                      <Trash2 className="w-3 h-3 text-red-400" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          /* Covers: landscape grid */
          <div className="grid grid-cols-3 gap-3">
            {items.map(item => (
              <div key={item.name} className="group relative bg-white rounded-lg border border-notion-border overflow-hidden hover:shadow-md transition-shadow">
                <div className="h-28 overflow-hidden">
                  <img src={item.url} alt="" className="w-full h-full object-cover" loading="lazy" />
                </div>
                {/* Name */}
                <div className="px-2 py-1.5">
                  {renamingItem === item.name ? (
                    <div className="flex items-center gap-1">
                      <input
                        type="text"
                        value={renameValue}
                        onChange={e => setRenameValue(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleConfirmRename(); if (e.key === 'Escape') setRenamingItem(null); }}
                        className="flex-1 px-1 py-0.5 text-xs border border-notion-border rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
                        autoFocus
                      />
                      <button onClick={handleConfirmRename} className="p-0.5 text-notion-textSecondary hover:text-notion-text"><Check className="w-3 h-3" /></button>
                      <button onClick={() => setRenamingItem(null)} className="p-0.5 text-notion-textSecondary hover:text-notion-text"><X className="w-3 h-3" /></button>
                    </div>
                  ) : (
                    <p className="text-xs text-notion-textSecondary truncate" title={item.name}>
                      {item.name.replace(/\.[^.]+$/, '')}
                    </p>
                  )}
                </div>
                {/* Hover actions */}
                {renamingItem !== item.name && (
                  <div className="absolute top-1 right-1 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => handleStartRename(item.name)} className="p-1 bg-white/90 rounded shadow-sm hover:bg-notion-hover" title="改名">
                      <Edit2 className="w-3 h-3 text-notion-textSecondary" />
                    </button>
                    <a href={item.url} download className="p-1 bg-white/90 rounded shadow-sm hover:bg-notion-hover" title="下载">
                      <Download className="w-3 h-3 text-notion-textSecondary" />
                    </a>
                    <button onClick={() => handleDeleteResource(item.name)} className="p-1 bg-white/90 rounded shadow-sm hover:bg-red-50" title="删除">
                      <Trash2 className="w-3 h-3 text-red-400" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </>
    );
  };

  const handleChangePassword = async () => {
    if (passwordForm.new_password !== passwordForm.confirm_password) {
      setPasswordMsg('两次密码不一致');
      return;
    }
    try {
      await authApi.changePassword({ old_password: passwordForm.old_password, new_password: passwordForm.new_password });
      setPasswordForm({ old_password: '', new_password: '', confirm_password: '' });
      setPasswordMsg('密码修改成功');
      setTimeout(() => setPasswordMsg(''), 2000);
    } catch (err: any) {
      setPasswordMsg(err.message || '密码修改失败');
    }
  };

  // 保存 Unsplash API key（走后端代理，key 不离开服务器）
  const handleSaveUnsplashKey = async () => {
    const key = unsplashKeyInput.trim();
    if (!key) {
      setUnsplashMsg('请先输入 API Key');
      return;
    }
    const ok = await usePreferenceStore.getState().setUnsplashKey(key);
    if (ok) {
      setUnsplashKeyConfigured(true);
      setUnsplashKeyInput('');
      setUnsplashMsg('保存成功');
      setTimeout(() => setUnsplashMsg(''), 2000);
    } else {
      setUnsplashMsg('保存失败，请重试');
    }
  };

  // 清除已保存的 Unsplash API key
  const handleClearUnsplashKey = async () => {
    const ok = await usePreferenceStore.getState().setUnsplashKey('');
    if (ok) {
      setUnsplashKeyConfigured(false);
      setUnsplashKeyInput('');
      setUnsplashMsg('已清除');
      setTimeout(() => setUnsplashMsg(''), 2000);
    } else {
      setUnsplashMsg('清除失败，请重试');
    }
  };

  // 测试当前输入的 key（直接走后端代理，先临时保存再调搜索）
  const handleTestUnsplashKey = async () => {
    const key = unsplashKeyInput.trim();
    if (!key) {
      setUnsplashMsg('请先输入 API Key');
      return;
    }
    setUnsplashTesting(true);
    setUnsplashMsg('测试中...');
    try {
      // 先临时保存再测，因为后端从 DB 取 key
      await usePreferenceStore.getState().setUnsplashKey(key);
      const res = await apiClient.get<{ total?: number }>('/unsplash/search', { params: { q: 'test', per_page: 1 } });
      if (typeof res.data.total === 'number') {
        setUnsplashKeyConfigured(true);
        setUnsplashMsg(`测试成功，Unsplash 共找到 ${res.data.total} 张图`);
        setTimeout(() => setUnsplashMsg(''), 3000);
      } else {
        setUnsplashMsg('测试成功，响应格式异常但 key 可用');
      }
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || '测试失败';
      setUnsplashMsg(`测试失败：${msg}`);
    } finally {
      setUnsplashTesting(false);
    }
  };

  // ---- 站点设置视图 ----
  const renderSiteSettings = () => {
    const DEFAULT_FAVICON = '/vite.svg';
    const DEFAULT_SITE_NAME = 'MD Library';

    // 重置确认弹窗
    const ConfirmDialog = () => {
      if (!confirmReset) return null;
      const labels = { favicon: '小图标', logo: '大图标', site_name: '站点名称' };
      return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setConfirmReset(null)}>
          <div className="bg-white rounded-lg shadow-lg p-6 min-w-[300px]" onClick={e => e.stopPropagation()}>
            <p className="text-sm text-notion-text mb-4">确定要重置{labels[confirmReset]}为默认值吗？</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmReset(null)} className="px-3 py-1.5 text-sm text-notion-textSecondary hover:bg-notion-hover rounded transition-colors">取消</button>
              <button onClick={() => handleReset(confirmReset)} className="px-3 py-1.5 text-sm text-white bg-red-500 hover:bg-red-600 rounded transition-colors">重置</button>
            </div>
          </div>
        </div>
      );
    };

    return (
      <>
        {confirmReset && <ConfirmDialog />}
        <h1 className="text-xl font-semibold text-notion-text mb-8">站点设置</h1>

        {siteSettingsMsg && (
          <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-2 rounded-lg mb-4">{siteSettingsMsg}</div>
        )}

        {siteSettingsLoading ? (
          <div className="text-sm text-notion-textSecondary">加载中...</div>
        ) : (
          <div className="bg-white rounded-lg border border-notion-border p-6 space-y-6">
            {/* 站点图标 */}
            <div>
              {/* 第一行: label + 图标框, 底部对齐 */}
              <div className="flex items-end gap-4">
                <span className="text-sm leading-none text-notion-textSecondary w-24 shrink-0">站点图标</span>
                <div className="flex items-end gap-6">
                  <div
                    className="w-10 h-10 rounded-lg border border-notion-border bg-notion-hover/30 flex items-center justify-center cursor-pointer hover:border-blue-400 transition-colors overflow-hidden"
                    onClick={() => faviconFileRef.current?.click()}
                    title="点击上传小图标"
                  >
                    {siteSettings.favicon ? (
                      <img src={siteSettings.favicon} alt="favicon" className="w-full h-full object-contain p-0.5" />
                    ) : (
                      <img src={DEFAULT_FAVICON} alt="default favicon" className="w-full h-full object-contain p-1" />
                    )}
                  </div>
                  <input ref={faviconFileRef} type="file" accept="image/*" className="hidden" onChange={handleFaviconUpload} />
                  <div
                    className="w-16 h-16 rounded-lg border border-notion-border bg-notion-hover/30 flex items-center justify-center cursor-pointer hover:border-blue-400 transition-colors overflow-hidden"
                    onClick={() => logoFileRef.current?.click()}
                    title="点击上传大图标"
                  >
                    {siteSettings.logo ? (
                      <img src={siteSettings.logo} alt="logo" className="w-full h-full object-contain p-1" />
                    ) : (
                      <BookOpen className="w-8 h-8 text-notion-textSecondary" />
                    )}
                  </div>
                  <input ref={logoFileRef} type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
                </div>
              </div>
              {/* 第二行: 重置按钮, 宽度对齐图标 */}
              <div className="flex gap-4 mt-1.5">
                <span className="w-24 shrink-0" />
                <div className="flex gap-6">
                  <div className="w-10 text-center">
                    {siteSettings.favicon && (
                      <button onClick={() => setConfirmReset('favicon')} className="text-xs text-notion-textSecondary hover:text-red-500 transition-colors">重置</button>
                    )}
                  </div>
                  <div className="w-16 text-center">
                    {siteSettings.logo && (
                      <button onClick={() => setConfirmReset('logo')} className="text-xs text-notion-textSecondary hover:text-red-500 transition-colors">重置</button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* 站点名称 */}
            <div className="flex items-center gap-4">
              <span className="text-sm text-notion-textSecondary w-24 shrink-0">站点名称</span>
              <div className="flex items-center gap-3">
                {editingSiteName ? (
                  <input
                    className="w-64 min-w-0 text-sm text-notion-text bg-transparent outline-none border border-blue-300 rounded px-2 py-1"
                    value={editingSiteNameValue}
                    onChange={e => setEditingSiteNameValue(e.target.value)}
                    onBlur={() => {
                      setEditingSiteName(false);
                      const newVal = editingSiteNameValue.trim();
                      if (newVal !== (siteSettings.site_name || '')) {
                        handleSiteNameSave(newVal);
                      }
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                      if (e.key === 'Escape') { setEditingSiteName(false); setEditingSiteNameValue(siteSettings.site_name || ''); }
                    }}
                    autoFocus
                  />
                ) : (
                  <span
                    className="w-64 min-w-0 text-sm text-notion-text cursor-pointer border border-transparent hover:border-notion-border rounded px-2 py-1 transition-colors truncate"
                    onClick={() => { setEditingSiteName(true); setEditingSiteNameValue(siteSettings.site_name || ''); }}
                  >{siteSettings.site_name || DEFAULT_SITE_NAME}</span>
                )}
                {siteSettings.site_name && (
                  <button onClick={() => setConfirmReset('site_name')} className="text-xs text-notion-textSecondary hover:text-red-500 transition-colors">重置</button>
                )}
              </div>
            </div>
          </div>
        )}
      </>
    );
  };

  const renderProfile = () => {
    // 属性行样式
    const row = (label: string, content: React.ReactNode) => (
      <div className="flex items-center gap-4 h-10">
        <span className="text-sm text-notion-textSecondary w-20 shrink-0">{label}:</span>
        <div className="flex-1 flex items-center gap-2">{content}</div>
      </div>
    );

    return (
      <>
        <h1 className="text-xl font-semibold text-notion-text mb-8">个人设置</h1>

        {profileMsg && <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-2 rounded-lg mb-4">{profileMsg}</div>}
        {error && <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-2 rounded-lg mb-4">{error}</div>}

        {/* 基本信息 */}
        <div className="bg-white rounded-lg border border-notion-border p-6 mb-6">
          <h3 className="text-sm font-medium text-notion-text mb-3">基本信息</h3>
          <div className="space-y-0">
            {row('用户名', <span className="text-sm text-notion-textSecondary">{currentUser?.username}</span>)}
            {row('显示名', (
              <div className="flex items-center gap-2">
                <PageIcon
                  compact
                  icon={currentUser?.avatar_url || null}
                  onSelect={async (value) => {
                    try {
                      await useAuthStore.getState().updateProfile({ avatar_url: value });
                    } catch (err: any) {
                      setProfileMsg(err.message || '保存失败');
                    }
                  }}
                />
                {isEditingDisplayName ? (
                  <input
                    type="text"
                    value={editingDisplayName}
                    onChange={(e) => setEditingDisplayName(e.target.value)}
                    onBlur={async () => {
                      if (editingDisplayName.trim() && editingDisplayName !== currentUser?.display_name) {
                        try {
                          await useAuthStore.getState().updateProfile({ display_name: editingDisplayName });
                        } catch (err: any) { setProfileMsg(err.message || '保存失败'); }
                      }
                      setIsEditingDisplayName(false);
                    }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { (e.target as HTMLInputElement).blur(); } if (e.key === 'Escape') setIsEditingDisplayName(false); }}
                    className="w-64 min-w-0 text-sm text-notion-text bg-transparent outline-none border border-blue-300 rounded px-2 py-1"
                    autoFocus
                  />
                ) : (
                  <span
                    onClick={() => { setEditingDisplayName(currentUser?.display_name || ''); setIsEditingDisplayName(true); }}
                    className="w-64 min-w-0 text-sm text-notion-text cursor-pointer border border-transparent hover:border-notion-border rounded px-2 py-1 transition-colors truncate"
                  >
                    {currentUser?.display_name}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* 修改密码 */}
        <div className="bg-white rounded-lg border border-notion-border p-6 mb-6">
          <h3 className="text-sm font-medium text-notion-text mb-3">修改密码</h3>
          <div className="space-y-0">
            {row('当前密码', <input type="password" value={passwordForm.old_password} onChange={(e) => setPasswordForm({ ...passwordForm, old_password: e.target.value })} className="w-64 px-2 py-1 border border-notion-border rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-300" />)}
            {row('新密码', <input type="password" value={passwordForm.new_password} onChange={(e) => setPasswordForm({ ...passwordForm, new_password: e.target.value })} className="w-64 px-2 py-1 border border-notion-border rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-300" />)}
            {row('确认密码', (
              <div className="flex items-center gap-2">
                <input type="password" value={passwordForm.confirm_password} onChange={(e) => setPasswordForm({ ...passwordForm, confirm_password: e.target.value })} className={`w-64 px-2 py-1 border rounded text-sm focus:outline-none focus:ring-1 ${
                  passwordForm.confirm_password && !passwordForm.new_password.startsWith(passwordForm.confirm_password)
                    ? 'border-red-400 focus:ring-red-400'
                    : 'border-notion-border focus:ring-blue-300'
                }`} />
                {(passwordForm.old_password || passwordForm.new_password || passwordForm.confirm_password) && (
                  <>
                    <button
                      type="button"
                      onClick={handleChangePassword}
                      disabled={!(passwordForm.old_password && passwordForm.new_password && passwordForm.confirm_password && passwordForm.new_password === passwordForm.confirm_password)}
                      className="p-0.5 text-notion-textSecondary hover:text-notion-text transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                      title="确认修改"
                    >
                      <Check className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setPasswordForm({ old_password: '', new_password: '', confirm_password: '' })}
                      className="p-0.5 text-notion-textSecondary hover:text-notion-text transition-colors"
                      title="取消"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
          {passwordMsg && <div className={`text-sm mt-3 ${passwordMsg.includes('成功') ? 'text-green-600' : 'text-red-600'}`}>{passwordMsg}</div>}
        </div>

        <div className="bg-white rounded-lg border border-notion-border p-6 mb-6">
          <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_420px] xl:items-start">
            <div>
              <h3 className="text-sm font-medium text-notion-text mb-1">编辑器显示</h3>
              <p className="text-xs text-notion-textSecondary mb-4">
                仅影响代码块的语法高亮颜色，不会改变你当前保留的代码块背景样式。
              </p>
              <div className="space-y-0">
                {row('代码主题', (
                  <div className="flex min-w-0 items-center gap-3">
                    <select
                      value={codeTheme}
                      onChange={(e) => setCodeTheme(normalizeCodeTheme(e.target.value))}
                      className="min-w-0 w-full max-w-[18rem] px-2 py-1 border border-notion-border rounded text-sm bg-white focus:outline-none focus:ring-1 focus:ring-blue-300"
                    >
                      {CODE_THEME_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
                {row('主题说明', (
                  <span className="text-sm text-notion-textSecondary">
                    {CODE_THEME_OPTIONS.find((option) => option.value === codeTheme)?.description}
                  </span>
                ))}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-xs font-medium text-notion-textSecondary tracking-[0.02em]">实时预览</h4>
                <span className="text-[11px] text-notion-textSecondary">XML 示例</span>
              </div>
              <div className="code-theme-preview rounded-[10px] overflow-hidden border border-[#eceae6] bg-[rgba(66,35,3,0.03)] min-h-[228px]">
                {codeThemePreviewHtml ? (
                  <div
                    className="code-theme-preview-html"
                    dangerouslySetInnerHTML={{ __html: codeThemePreviewHtml }}
                  />
                ) : (
                  <div className="flex min-h-[228px] items-center justify-center text-sm text-notion-textSecondary">
                    {codeThemePreviewLoading ? '预览加载中...' : '预览生成失败'}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* 第三方集成：Unsplash */}
        <div className="bg-white rounded-lg border border-notion-border p-6 mt-6">
          <h3 className="text-sm font-medium text-notion-text mb-1">第三方集成</h3>
          <p className="text-xs text-notion-textSecondary mb-4">
            配置 Unsplash API Key 后，封面选择器会显示 Unsplash tab，可直接搜索在线图片。
            Key 只保存在后端，不会出现在前端或请求 URL 中。
          </p>
          <div className="space-y-0">
            {row('状态', (
              <span className={`text-sm ${unsplashKeyConfigured ? 'text-green-600' : 'text-notion-textSecondary'}`}>
                {unsplashKeyConfigured ? '已配置' : '未配置'}
              </span>
            ))}
            {row('API Key', (
              <div className="flex items-center gap-2">
                <input
                  type="password"
                  value={unsplashKeyInput}
                  onChange={(e) => setUnsplashKeyInput(e.target.value)}
                  placeholder={unsplashKeyConfigured ? '••••••••（输入新值覆盖）' : '粘贴 Unsplash Access Key'}
                  className="w-80 px-2 py-1 border border-notion-border rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-300"
                />
                <button
                  type="button"
                  onClick={handleTestUnsplashKey}
                  disabled={!unsplashKeyInput.trim() || unsplashTesting}
                  className="text-xs text-notion-textSecondary hover:text-notion-text border border-notion-border rounded px-2 py-1 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  title="用当前输入的 key 发一次测试请求"
                >
                  {unsplashTesting ? '测试中...' : '测试'}
                </button>
                <button
                  type="button"
                  onClick={handleSaveUnsplashKey}
                  disabled={!unsplashKeyInput.trim()}
                  className="text-xs text-white bg-notion-text hover:bg-notion-text/90 rounded px-2 py-1 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  title="保存"
                >
                  保存
                </button>
                {unsplashKeyConfigured && (
                  <button
                    type="button"
                    onClick={handleClearUnsplashKey}
                    className="text-xs text-notion-textSecondary hover:text-red-500 transition-colors"
                    title="清除已保存的 key"
                  >
                    清除
                  </button>
                )}
              </div>
            ))}
            {row('申请地址', (
              <a
                href="https://unsplash.com/oauth/applications/new"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-500 hover:underline"
              >
                https://unsplash.com/oauth/applications/new
              </a>
            ))}
          </div>
          {unsplashMsg && (
            <div className={`text-sm mt-3 ${unsplashMsg.includes('失败') || unsplashMsg.includes('请先') ? 'text-red-600' : 'text-green-600'}`}>
              {unsplashMsg}
            </div>
          )}
        </div>
      </>
    );
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-4xl mx-auto py-8 px-6">
        {(activeTab === 'users' || activeTab === 'spaces') && !isAdminUser ? renderProfile() :
          activeTab === 'users' ? renderUsers() : activeTab === 'spaces' ? renderSpaces() : activeTab === 'resources' ? renderResources() : activeTab === 'site' ? renderSiteSettings() : renderProfile()}
      </div>
    </div>
  );
}
