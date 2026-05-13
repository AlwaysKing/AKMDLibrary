import { useEffect, useState, useRef, Fragment } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { usersApi } from '../api/users';
import { spacesApi, Space, SpaceMember } from '../api/spaces';
import { authApi } from '../api/auth';
import { Trash2, Edit2, Plus, X, UserPlus, Smile, ChevronDown, ChevronUp, Check, PlusCircle, Key, RefreshCw } from 'lucide-react';

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
  const [profileForm, setProfileForm] = useState({ display_name: '', avatar_url: '' });
  const [passwordForm, setPasswordForm] = useState({ old_password: '', new_password: '', confirm_password: '' });
  const [profileMsg, setProfileMsg] = useState('');
  const [passwordMsg, setPasswordMsg] = useState('');
  const [showAvatarPicker, setShowAvatarPicker] = useState(false);
  const [isEditingDisplayName, setIsEditingDisplayName] = useState(false);
  const [editingDisplayName, setEditingDisplayName] = useState('');
  const avatarPickerRef = useRef<HTMLDivElement>(null);

  // ---- 空间管理状态 ----
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [spacesLoading, setSpacesLoading] = useState(false);
  // 统一面板: null=关闭, 'new'=创建, slug=编辑
  const [spacePanelSlug, setSpacePanelSlug] = useState<string | null>(null);
  const [spaceFormData, setSpaceFormData] = useState({ name: '', icon: '', description: '' });
  const [showIconPicker, setShowIconPicker] = useState(false);
  const iconPickerRef = useRef<HTMLDivElement>(null);

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

  const fetchUsers = async () => {
    try {
      const data = await usersApi.list();
      setUsers(data.sort((a, b) => a.id - b.id));
      setIsLoading(false);
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
    setUserFormData({ username: user.username, password: '', display_name: user.display_name, role: user.role });
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

  // 角色即时保存
  const handleImmediateRoleChange = async (role: string) => {
    if (typeof userPanelId !== 'number') return;
    setUserFormData({ ...userFormData, role });
    setShowUserRoleDropdown(false);
    try {
      const updated = await usersApi.update(userPanelId, { role: role as 'admin' | 'user' });
      setUsers(prev => prev.map(u => u.id === userPanelId ? updated : u));
    } catch (err: any) {
      setError(err.message);
    }
  };

  // 仅保存显示名
  const handleSaveDisplayNameOnly = async () => {
    if (typeof userPanelId !== 'number' || !userFormData.display_name.trim()) return;
    try {
      const updated = await usersApi.update(userPanelId, { display_name: userFormData.display_name });
      setUsers(prev => prev.map(u => u.id === userPanelId ? updated : u));
    } catch (err: any) {
      setError(err.message);
    }
  };

  // 还原显示名
  const handleRevertDisplayName = () => {
    const originalUser = users.find(u => u.id === userPanelId);
    if (originalUser) {
      setUserFormData({ ...userFormData, display_name: originalUser.display_name });
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
    setSpaceFormData({ name: '', icon: '', description: '' });
    setMembers([]);
    setSpacePanelSlug('new');
    setIsAddingMember(false);
  };

  const openEditPanel = async (space: Space) => {
    if (spacePanelSlug === space.slug) {
      closePanel();
      return;
    }
    setSpaceFormData({ name: space.name, icon: space.icon || '', description: space.description || '' });
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
    const originalUser = isEditing && typeof userPanelId === 'number' ? users.find(u => u.id === userPanelId) : null;
    const displayNameChanged = originalUser ? userFormData.display_name !== originalUser.display_name : false;

    return (
    <form onSubmit={handleSaveUserPanel} className="p-6">
      {isEditing ? (
        // 编辑模式：显示名称（带即时✔✗） + 角色下拉（即时保存）
        <div className="flex items-center gap-3">
          <span className="text-sm text-notion-textSecondary min-w-fit">@{userFormData.username}</span>
          <input
            type="text"
            value={userFormData.display_name}
            onChange={(e) => setUserFormData({ ...userFormData, display_name: e.target.value })}
            placeholder="显示名称"
            className="flex-1 px-3 py-2 border border-notion-border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleSaveDisplayNameOnly(); } if (e.key === 'Escape') handleRevertDisplayName(); }}
          />
          {/* ✔ 保存显示名 */}
          <button type="button" onClick={handleSaveDisplayNameOnly} disabled={!displayNameChanged} className="p-1 text-notion-textSecondary hover:text-notion-text transition-colors disabled:opacity-30 disabled:cursor-not-allowed" title="保存显示名">
            <Check className="w-4 h-4" />
          </button>
          {/* ✗ 还原显示名 */}
          <button type="button" onClick={handleRevertDisplayName} disabled={!displayNameChanged} className="p-1 text-notion-textSecondary hover:text-notion-text transition-colors disabled:opacity-30 disabled:cursor-not-allowed" title="还原显示名">
            <X className="w-4 h-4" />
          </button>
          {/* 角色下拉 — 即时保存 */}
          <div className="relative" ref={dropdownsRef}>
            <button
              type="button"
              onClick={() => setShowUserRoleDropdown(!showUserRoleDropdown)}
              className="flex items-center justify-between gap-2 px-3 py-2 border border-notion-border rounded text-sm hover:bg-notion-hover transition-colors min-w-[120px]"
            >
              <span className="text-notion-text">{userFormData.role === 'admin' ? '管理员' : '普通用户'}</span>
              <ChevronDown className="w-3.5 h-3.5 text-notion-textSecondary flex-shrink-0" />
            </button>
            {showUserRoleDropdown && (
              <div className="absolute top-full right-0 mt-1 bg-white border border-notion-border rounded-lg shadow-lg z-50 w-full py-1">
                <button type="button" onClick={() => handleImmediateRoleChange('user')} className={`w-full text-left px-3 py-1.5 text-sm hover:bg-notion-hover transition-colors ${userFormData.role === 'user' ? 'bg-notion-hover' : ''}`}>普通用户</button>
                <button type="button" onClick={() => handleImmediateRoleChange('admin')} className={`w-full text-left px-3 py-1.5 text-sm hover:bg-notion-hover transition-colors ${userFormData.role === 'admin' ? 'bg-notion-hover' : ''}`}>管理员</button>
              </div>
            )}
          </div>
          {/* 收起面板 */}
          <button type="button" onClick={closeUserPanel} className="p-1 text-notion-textSecondary hover:text-notion-text transition-colors" title="收起">
            <ChevronUp className="w-4 h-4" />
          </button>
        </div>
      ) : (
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
        <div className="border-t border-notion-border mt-5 pt-5">
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
            <col className="w-[30%]" />
            <col className="w-[18%]" />
            <col className="w-[18%]" />
            <col className="w-[20%]" />
            <col className="w-[14%]" />
          </colgroup>
          <thead className="bg-notion-sidebarBg">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-notion-textSecondary uppercase tracking-wider">用户</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-notion-textSecondary uppercase tracking-wider">用户名</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-notion-textSecondary uppercase tracking-wider">角色</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-notion-textSecondary uppercase tracking-wider">创建时间</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-notion-textSecondary uppercase tracking-wider">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-notion-border">
            {/* 创建面板 — 插入到列表顶部 */}
            {userPanelId === 'new' && (
              <tr className="bg-notion-sidebarBg/30">
                <td colSpan={5}>{renderUserPanel(false)}</td>
              </tr>
            )}
            {users.map((user) => (
              <Fragment key={user.id}>
                {/* 正常行 — 始终显示 */}
                <tr className="hover:bg-notion-hover transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 flex items-center justify-center overflow-hidden">
                        {user.avatar_url
                          ? (user.avatar_url.startsWith('http') ? <img src={user.avatar_url} alt={user.display_name} className="w-8 h-8" /> : <span className="text-lg">{user.avatar_url}</span>)
                          : <span className="text-lg">👤</span>}
                      </div>
                      <span className="font-medium text-notion-text">{user.display_name}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-notion-textSecondary">{user.username}</td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-1 rounded text-xs font-medium ${user.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-700'}`}>
                      {user.role === 'admin' ? '管理员' : '普通用户'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-notion-textSecondary">{new Date(user.created_at).toLocaleDateString()}</td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => openEditUserPanel(user)} className="text-notion-textSecondary hover:text-notion-text" title="编辑"><Edit2 className="w-4 h-4" /></button>
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
                    <td colSpan={5}>{renderUserPanel(true)}</td>
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
        {/* 第一行：图标 + 名称 + 描述 + (编辑)保存/取消 / (创建)✔✗ */}
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
          <button type="submit" className="p-1 text-notion-textSecondary hover:text-notion-text transition-colors" title={isEditing ? '保存' : '创建'}><Check className="w-4 h-4" /></button>
          <button type="button" onClick={closePanel} className="p-1 text-notion-textSecondary hover:text-notion-text transition-colors" title="取消"><X className="w-4 h-4" /></button>
        </div>

        {/* 成员区域（仅编辑模式） */}
        {isEditing && (
          <div className="border-t border-notion-border mt-5 pt-5">
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
                  <tr className="hover:bg-notion-hover transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        {space.icon && <span>{space.icon}</span>}
                        <span className="font-medium text-notion-text">{space.name}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-notion-textSecondary">{space.description || '-'}</td>
                    <td className="px-6 py-4 text-notion-textSecondary">{new Date(space.created_at).toLocaleDateString()}</td>
                    <td className="px-6 py-4 text-center text-notion-textSecondary text-sm">{memberCounts[space.slug] ?? '-'}</td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => openEditPanel(space)} className="text-notion-textSecondary hover:text-notion-text" title="编辑"><Edit2 className="w-4 h-4" /></button>
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

  const handleSaveDisplayName = async () => {
    if (!editingDisplayName.trim()) return;
    try {
      await useAuthStore.getState().updateProfile({ display_name: editingDisplayName });
      setIsEditingDisplayName(false);
    } catch (err: any) {
      setProfileMsg(err.message || '保存失败');
    }
  };

  const handleSelectAvatar = async (emoji: string) => {
    setShowAvatarPicker(false);
    try {
      await useAuthStore.getState().updateProfile({ avatar_url: emoji });
    } catch (err: any) {
      setProfileMsg(err.message || '保存失败');
    }
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
            {row('用户头像', (
              <div className="relative" ref={avatarPickerRef}>
                <button
                  type="button"
                  onClick={() => setShowAvatarPicker(!showAvatarPicker)}
                  className="w-8 h-8 rounded border border-notion-border hover:bg-notion-hover flex items-center justify-center text-lg transition-colors"
                  title="选择头像"
                >
                  {currentUser?.avatar_url || <Smile className="w-5 h-5 text-notion-textSecondary" />}
                </button>
                {showAvatarPicker && (
                  <div className="absolute top-full left-0 mt-1 bg-white border border-notion-border rounded-lg shadow-lg p-2 z-50 w-[260px]">
                    <div className="grid grid-cols-8 gap-1">
                      {ICON_OPTIONS.map((emoji) => (
                        <button
                          key={emoji}
                          type="button"
                          onClick={() => handleSelectAvatar(emoji)}
                          className={`w-8 h-8 rounded hover:bg-notion-hover flex items-center justify-center text-base transition-colors ${currentUser?.avatar_url === emoji ? 'bg-notion-hover ring-1 ring-blue-400' : ''}`}
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
            {row('显示名', isEditingDisplayName ? (
              <div className="flex items-center gap-2" style={{ marginLeft: '-1px' }}>
                <input
                  type="text"
                  value={editingDisplayName}
                  onChange={(e) => setEditingDisplayName(e.target.value)}
                  className="px-1 py-1 border border-notion-border rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-48"
                  autoFocus
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSaveDisplayName(); if (e.key === 'Escape') setIsEditingDisplayName(false); }}
                />
                <button type="button" onClick={handleSaveDisplayName} className="p-0.5 text-notion-textSecondary hover:text-notion-text transition-colors"><Check className="w-4 h-4" /></button>
                <button type="button" onClick={() => setIsEditingDisplayName(false)} className="p-0.5 text-notion-textSecondary hover:text-notion-text transition-colors"><X className="w-4 h-4" /></button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => { setEditingDisplayName(currentUser?.display_name || ''); setIsEditingDisplayName(true); }}
                className="text-sm text-notion-text hover:bg-notion-hover px-1 py-0.5 rounded transition-colors"
                title="点击修改"
              >
                {currentUser?.display_name}
              </button>
            ))}
          </div>
        </div>

        {/* 修改密码 */}
        <div className="bg-white rounded-lg border border-notion-border p-6">
          <h3 className="text-sm font-medium text-notion-text mb-3">修改密码</h3>
          <div className="space-y-0">
            {row('当前密码', <input type="password" value={passwordForm.old_password} onChange={(e) => setPasswordForm({ ...passwordForm, old_password: e.target.value })} className="w-64 px-2 py-1 border border-notion-border rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />)}
            {row('新密码', <input type="password" value={passwordForm.new_password} onChange={(e) => setPasswordForm({ ...passwordForm, new_password: e.target.value })} className="w-64 px-2 py-1 border border-notion-border rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />)}
            {row('确认密码', (
              <div className="flex items-center gap-2">
                <input type="password" value={passwordForm.confirm_password} onChange={(e) => setPasswordForm({ ...passwordForm, confirm_password: e.target.value })} className={`w-64 px-2 py-1 border rounded text-sm focus:outline-none focus:ring-2 ${
                  passwordForm.confirm_password && !passwordForm.new_password.startsWith(passwordForm.confirm_password)
                    ? 'border-red-400 focus:ring-red-400'
                    : 'border-notion-border focus:ring-blue-500'
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
      </>
    );
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-4xl mx-auto py-8 px-6">
        {(activeTab === 'users' || activeTab === 'spaces') && !isAdminUser ? renderProfile() :
          activeTab === 'users' ? renderUsers() : activeTab === 'spaces' ? renderSpaces() : renderProfile()}
      </div>
    </div>
  );
}
