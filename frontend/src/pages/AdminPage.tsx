import { useEffect, useState } from 'react';
import { useAuthStore } from '../stores/authStore';
import { usersApi } from '../api/users';
import { Trash2, Edit2, Plus, X } from 'lucide-react';

interface EditingUser {
  id: number;
  username: string;
  display_name: string;
  avatar_url?: string;
  role: 'admin' | 'user';
  created_at: string;
  updated_at: string;
  isEditing?: boolean;
}

export default function AdminPage() {
  const { user: currentUser } = useAuthStore();
  const [users, setUsers] = useState<EditingUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [newUser, setNewUser] = useState({ username: '', password: '', display_name: '', role: 'user' });
  const [error, setError] = useState('');

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      const data = await usersApi.list();
      setUsers(data);
      setIsLoading(false);
    } catch (err: any) {
      setError(err.message);
      setIsLoading(false);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const created = await usersApi.create(newUser);
      setUsers([...users, { ...created, isEditing: false }]);
      setNewUser({ username: '', password: '', display_name: '', role: 'user' });
      setIsCreating(false);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleDeleteUser = async (id: number) => {
    if (id === currentUser?.id) {
      setError('不能删除自己的账号');
      return;
    }
    try {
      await usersApi.delete(id);
      setUsers(users.filter((u) => u.id !== id));
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleUpdateUser = async (id: number, updates: Partial<EditingUser>) => {
    try {
      const updated = await usersApi.update(id, updates);
      setUsers(users.map((u) => (u.id === id ? { ...updated, isEditing: false } : u)));
    } catch (err: any) {
      setError(err.message);
    }
  };

  const toggleEdit = (id: number) => {
    setUsers(users.map((u) => (u.id === id ? { ...u, isEditing: !u.isEditing } : u)));
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-notion-text"></div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto py-8 px-4">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-semibold text-notion-text">管理面板</h1>
          <p className="text-notion-textSecondary mt-1">管理用户和权限</p>
        </div>
        <button
          onClick={() => setIsCreating(!isCreating)}
          className="flex items-center gap-2 px-4 py-2 bg-notion-text text-white rounded-lg hover:bg-gray-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          添加用户
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-2 rounded-lg mb-4">
          {error}
        </div>
      )}

      {isCreating && (
        <form onSubmit={handleCreateUser} className="bg-notion-sidebarBg rounded-lg p-6 mb-6">
          <h3 className="text-lg font-medium text-notion-text mb-4">创建新用户</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-notion-text mb-1">用户名</label>
              <input
                type="text"
                value={newUser.username}
                onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                className="w-full px-3 py-2 border border-notion-border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-notion-text mb-1">密码</label>
              <input
                type="password"
                value={newUser.password}
                onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                className="w-full px-3 py-2 border border-notion-border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-notion-text mb-1">显示名称</label>
              <input
                type="text"
                value={newUser.display_name}
                onChange={(e) => setNewUser({ ...newUser, display_name: e.target.value })}
                className="w-full px-3 py-2 border border-notion-border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-notion-text mb-1">角色</label>
              <select
                value={newUser.role}
                onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
                className="w-full px-3 py-2 border border-notion-border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="user">普通用户</option>
                <option value="admin">管理员</option>
              </select>
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button
              type="submit"
              className="px-4 py-2 bg-notion-text text-white rounded hover:bg-gray-700 transition-colors"
            >
              创建用户
            </button>
            <button
              type="button"
              onClick={() => setIsCreating(false)}
              className="px-4 py-2 border border-notion-border rounded hover:bg-notion-hover transition-colors"
            >
              取消
            </button>
          </div>
        </form>
      )}

      <div className="bg-white rounded-lg border border-notion-border overflow-hidden">
        <table className="w-full">
          <thead className="bg-notion-sidebarBg">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-notion-textSecondary uppercase tracking-wider">
                用户
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-notion-textSecondary uppercase tracking-wider">
                用户名              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-notion-textSecondary uppercase tracking-wider">
                角色
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-notion-textSecondary uppercase tracking-wider">
                创建时间
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-notion-textSecondary uppercase tracking-wider">
                操作
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-notion-border">
            {users.map((user) => (
              <tr key={user.id} className="hover:bg-notion-hover transition-colors">
                {user.isEditing ? (
                  <>
                    <td className="px-6 py-4">
                      <input
                        type="text"
                        defaultValue={user.display_name}
                        onBlur={(e) => handleUpdateUser(user.id, { display_name: e.target.value })}
                        className="w-full px-2 py-1 border border-notion-border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </td>
                    <td className="px-6 py-4 text-notion-textSecondary">{user.username}</td>
                    <td className="px-6 py-4">
                      <select
                        defaultValue={user.role}
                        onChange={(e) => handleUpdateUser(user.id, { role: e.target.value as 'admin' | 'user' })}
                        className="px-2 py-1 border border-notion-border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="user">普通用户</option>
                        <option value="admin">管理员</option>
                      </select>
                    </td>
                    <td className="px-6 py-4 text-notion-textSecondary">
                      {new Date(user.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={() => toggleEdit(user.id)}
                        className="text-notion-textSecondary hover:text-notion-text"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        {user.avatar_url && (
                          <img
                            src={user.avatar_url}
                            alt={user.display_name}
                            className="w-8 h-8 rounded-full"
                          />
                        )}
                        <span className="font-medium text-notion-text">{user.display_name}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-notion-textSecondary">{user.username}</td>
                    <td className="px-6 py-4">
                      <span
                        className={`px-2 py-1 rounded text-xs font-medium ${
                          user.role === 'admin'
                            ? 'bg-purple-100 text-purple-700'
                            : 'bg-gray-100 text-gray-700'
                        }`}
                      >
                        {user.role}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-notion-textSecondary">
                      {new Date(user.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => toggleEdit(user.id)}
                          className="text-notion-textSecondary hover:text-notion-text"
                          title="Edit"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteUser(user.id)}
                          className="text-red-500 hover:text-red-600"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
