import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { gitApi, GitRepoState, GitSyncConfig, GitFileStatus, CredentialMeta, CredentialType } from '../api/git';
import {
  ArrowLeft,
  GitCommitHorizontal,
  ArrowUp,
  ArrowDown,
  RefreshCw,
  CheckSquare,
  Square,
  Settings2,
  FileText,
  FilePlus,
  FileX,
  FilePen,
  KeyRound,
} from 'lucide-react';

const CATEGORY_ICON: Record<GitFileStatus['category'], typeof FileText> = {
  modified: FilePen,
  untracked: FilePlus,
  deleted: FileX,
  added: FilePlus,
  renamed: FileText,
};

export default function GitPage() {
  const { spaceSlug } = useParams<{ spaceSlug: string }>();
  const navigate = useNavigate();

  const [state, setState] = useState<GitRepoState | null>(null);
  const [config, setConfig] = useState<GitSyncConfig | null>(null);
  const [credMeta, setCredMeta] = useState<CredentialMeta | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [showSettings, setShowSettings] = useState(false);
  const [showCreds, setShowCreds] = useState(false);

  const refresh = useCallback(async () => {
    if (!spaceSlug) return;
    try {
      const [s, c, cr] = await Promise.all([
        gitApi.state(spaceSlug),
        gitApi.getConfig(spaceSlug).catch(() => null),
        gitApi.getCredentials(spaceSlug).catch(() => null),
      ]);
      setState(s);
      if (c) setConfig(c);
      if (cr) setCredMeta(cr);
      // Auto-prune selections that no longer exist as dirty files.
      const validPaths = new Set((s.files ?? []).map((f) => f.path));
      setSelected((prev) => {
        const next = new Set<string>();
        for (const p of prev) if (validPaths.has(p)) next.add(p);
        return next;
      });
    } catch (e: any) {
      setError(e?.response?.data || e?.message || 'Failed to load git state');
    }
  }, [spaceSlug]);

  useEffect(() => {
    refresh();
    // Poll every 5s while page is open, so changes from other tabs/sessions show up.
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [refresh]);

  const togglePath = (path: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const toggleAll = () => {
    if (!state) return;
    const allSelected = (state.files ?? []).length > 0 && selected.size === (state.files ?? []).length;
    setSelected(allSelected ? new Set() : new Set((state.files ?? []).map((f) => f.path)));
  };

  const handleCommit = async () => {
    if (!spaceSlug || !message.trim() || selected.size === 0) return;
    setBusy(true);
    setError('');
    setOutput('');
    try {
      await gitApi.commit(spaceSlug, message.trim(), Array.from(selected));
      setMessage('');
      setSelected(new Set());
      setOutput('Committed.');
      await refresh();
    } catch (e: any) {
      setError(e?.response?.data || e?.message || 'Commit failed');
    } finally {
      setBusy(false);
    }
  };

  const handlePush = async () => {
    if (!spaceSlug) return;
    setBusy(true);
    setError('');
    setOutput('');
    try {
      const r = await gitApi.push(spaceSlug);
      setOutput(r.output || 'Pushed.');
      await refresh();
    } catch (e: any) {
      setError(e?.response?.data || e?.message || 'Push failed');
    } finally {
      setBusy(false);
    }
  };

  const handlePull = async () => {
    if (!spaceSlug) return;
    setBusy(true);
    setError('');
    setOutput('');
    try {
      const r = await gitApi.pull(spaceSlug);
      setOutput(r.output || 'Pulled.');
      await refresh();
    } catch (e: any) {
      setError(e?.response?.data || e?.message || 'Pull failed');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveConfig = async (cfg: GitSyncConfig) => {
    if (!spaceSlug) return;
    try {
      const saved = await gitApi.setConfig(spaceSlug, cfg);
      setConfig(saved);
    } catch (e: any) {
      setError(e?.response?.data || e?.message || 'Save config failed');
    }
  };

  const handleSaveCredentials = async (input: {
    type: CredentialType;
    privateKey?: string;
    passphrase?: string;
    password?: string;
  }) => {
    if (!spaceSlug) return;
    setBusy(true);
    setError('');
    try {
      const meta = await gitApi.setCredentials(spaceSlug, input);
      setCredMeta(meta);
      if (input.type === 'none') {
        setOutput('Credentials cleared.');
      } else {
        setOutput('Credentials saved.');
      }
      // Collapse the panel on success so the user sees the result in the
      // toolbar (green dot) instead of a stale open form.
      setShowCreds(false);
    } catch (e: any) {
      setError(e?.response?.data || e?.message || 'Save credentials failed');
    } finally {
      setBusy(false);
    }
  };

  if (!state) {
    return (
      <div className="flex items-center justify-center h-64 text-notion-textSecondary">
        Loading...
      </div>
    );
  }

  if (!state.is_repo) {
    return (
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto py-8 px-6">
          <BackButton onClick={() => navigate(`/s/${spaceSlug}`)} />
          <h1 className="text-2xl font-semibold mt-4">Git 管理</h1>
          <p className="mt-2 text-notion-textSecondary">
            当前空间不是 git 仓库。请在服务器上执行 <code className="px-1 bg-notion-hover rounded">cd docs/{spaceSlug} && git init</code> 后刷新本页。
          </p>
        </div>
      </div>
    );
  }

  // Backend always returns an array now, but coalesce defensively in case of
  // older server builds or transient corruption — accessing .length on null
  // would crash the whole page render.
  const files = state.files ?? [];
  const allSelected = files.length > 0 && selected.size === files.length;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-4xl mx-auto py-8 px-6">
      <BackButton onClick={() => navigate(`/s/${spaceSlug}`)} />

      {/* Header: branch + remote + counters */}
      <div className="mt-4 flex items-center gap-3 flex-wrap">
        <h1 className="text-2xl font-semibold">Git 管理</h1>
        <span className="text-sm text-notion-textSecondary">分支</span>
        <code className="px-2 py-0.5 bg-notion-hover rounded text-sm">{state.branch || '(detached)'}</code>
        {state.has_upstream ? (
          <>
            <span className="text-sm text-notion-textSecondary">跟踪</span>
            <code className="px-2 py-0.5 bg-notion-hover rounded text-sm">{state.upstream}</code>
          </>
        ) : state.has_remote ? (
          <>
            <span className="text-sm text-notion-textSecondary">remote</span>
            <code className="px-2 py-0.5 bg-notion-hover rounded text-sm">{state.remote}</code>
            <span className="text-xs text-notion-textSecondary italic">（未设置上游分支）</span>
          </>
        ) : (
          <span className="text-xs text-notion-textSecondary italic">未配置 remote（push/pull 不可用）</span>
        )}
        <button
          onClick={refresh}
          disabled={busy}
          className="ml-auto p-1.5 rounded hover:bg-notion-hover disabled:opacity-50"
          title="刷新"
        >
          <RefreshCw size={16} className={busy ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Toolbar: push/pull/settings */}
      <div className="mt-4 flex items-center gap-2 flex-wrap">
        <button
          onClick={handlePull}
          disabled={busy || !state.has_remote}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded border border-notion-border hover:bg-notion-hover disabled:opacity-40 disabled:cursor-not-allowed"
          title={state.has_upstream ? `从 ${state.upstream} 拉取` : 'Pull'}
        >
          <ArrowDown size={14} /> Pull
          {state.behind > 0 && (
            <span className="ml-0.5 min-w-[18px] h-[18px] px-1 inline-flex items-center justify-center text-[11px] font-medium bg-blue-500 text-white rounded-full">
              {state.behind}
            </span>
          )}
        </button>
        <button
          onClick={handlePush}
          disabled={busy || !state.has_remote}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded border border-notion-border hover:bg-notion-hover disabled:opacity-40 disabled:cursor-not-allowed"
          title={state.has_upstream ? `推送到 ${state.upstream}` : 'Push'}
        >
          <ArrowUp size={14} /> Push
          {state.ahead > 0 && (
            <span className="ml-0.5 min-w-[18px] h-[18px] px-1 inline-flex items-center justify-center text-[11px] font-medium bg-blue-500 text-white rounded-full">
              {state.ahead}
            </span>
          )}
        </button>
        <button
          onClick={() => setShowSettings((v) => !v)}
          className={`flex items-center gap-1 px-3 py-1.5 text-sm rounded border border-notion-border hover:bg-notion-hover ${
            showSettings ? 'bg-notion-hover' : ''
          }`}
        >
          <Settings2 size={14} /> 自动提交
        </button>
        <button
          onClick={() => setShowCreds((v) => !v)}
          className={`flex items-center gap-1 px-3 py-1.5 text-sm rounded border border-notion-border hover:bg-notion-hover ${
            showCreds ? 'bg-notion-hover' : ''
          }`}
        >
          <KeyRound size={14} /> 凭证
          {credMeta && credMeta.type !== 'none' && (
            <span className="ml-0.5 min-w-[8px] h-[8px] inline-flex items-center justify-center bg-green-500 rounded-full" title={`已配置: ${credMeta.type}`} />
          )}
        </button>
      </div>

      {showSettings && config && (
        <AutoCommitSettings config={config} onSave={handleSaveConfig} />
      )}

      {showCreds && credMeta && (
        <CredentialsPanel
          meta={credMeta}
          onSave={handleSaveCredentials}
          onClear={() => handleSaveCredentials({ type: 'none' })}
        />
      )}

      {/* Error / Output banners */}
      {error && (
        <div className="mt-4 p-3 rounded bg-red-50 border border-red-200 text-sm text-red-800 whitespace-pre-wrap">
          {error}
        </div>
      )}
      {output && !error && (
        <div className="mt-4 p-3 rounded bg-notion-hover text-sm whitespace-pre-wrap">
          {output}
        </div>
      )}

      {/* File list */}
      <div className="mt-6">
        <div className="flex items-center gap-2 mb-2">
          <button onClick={toggleAll} className="flex items-center gap-1 text-sm text-notion-textSecondary hover:text-notion-text">
            {allSelected ? <CheckSquare size={14} /> : <Square size={14} />}
            全选
          </button>
          <span className="text-sm text-notion-textSecondary">
            {files.length === 0 ? '工作区干净，没有需要提交的改动' : `${files.length} 个文件有改动`}
          </span>
        </div>

        <div className="border border-notion-border rounded divide-y divide-notion-border/60">
          {files.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-notion-textSecondary">
              ✓ 工作区干净
            </div>
          ) : (
            files.map((f) => {
              const Icon = CATEGORY_ICON[f.category] || FileText;
              const isSel = selected.has(f.path);
              return (
                <label
                  key={f.path}
                  className="flex items-center gap-3 px-3 py-2 hover:bg-notion-hover cursor-pointer"
                >
                  <button
                    type="button"
                    onClick={() => togglePath(f.path)}
                    className="flex-shrink-0"
                  >
                    {isSel ? <CheckSquare size={16} /> : <Square size={16} />}
                  </button>
                  <Icon size={14} className="flex-shrink-0 text-notion-textSecondary" />
                  <span className="text-sm font-mono truncate flex-1">{f.path}</span>
                  <span className="text-xs px-1.5 py-0.5 rounded bg-notion-hover text-notion-textSecondary uppercase">
                    {f.category}
                  </span>
                  <code className="text-xs text-notion-textSecondary">{f.status.trim() || f.status}</code>
                </label>
              );
            })
          )}
        </div>
      </div>

      {/* Commit box */}
      <div className="mt-6 sticky bottom-0 bg-notion-bg py-3 border-t border-notion-border">
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Commit message（必填）"
          rows={2}
          className="w-full px-3 py-2 text-sm rounded border border-notion-border bg-white resize-none focus:outline-none focus:border-notion-textSecondary"
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-xs text-notion-textSecondary">
            已选 {selected.size} / {files.length} 个文件
          </span>
          <button
            onClick={handleCommit}
            disabled={busy || !message.trim() || selected.size === 0}
            className="flex items-center gap-2 px-4 py-1.5 text-sm rounded bg-notion-text text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <GitCommitHorizontal size={14} />
            Commit
          </button>
        </div>
      </div>
      </div>
    </div>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1 text-sm text-notion-textSecondary hover:text-notion-text"
    >
      <ArrowLeft size={14} /> 返回空间
    </button>
  );
}

function AutoCommitSettings({
  config,
  onSave,
}: {
  config: GitSyncConfig;
  onSave: (cfg: GitSyncConfig) => void;
}) {
  const [mode, setMode] = useState<GitSyncConfig['mode']>(config.mode);
  const [action, setAction] = useState<GitSyncConfig['action']>(config.action || 'commit');
  const [scheduled, setScheduled] = useState(config.scheduled_seconds);
  const [debounce, setDebounce] = useState(config.debounce_ms);

  useEffect(() => {
    setMode(config.mode);
    setAction(config.action || 'commit');
    setScheduled(config.scheduled_seconds);
    setDebounce(config.debounce_ms);
  }, [config]);

  return (
    <div className="mt-4 p-4 border border-notion-border rounded bg-notion-sidebarBg/40">
      <h3 className="text-sm font-medium mb-3">自动提交配置</h3>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-notion-textSecondary">模式</span>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as GitSyncConfig['mode'])}
            className="px-2 py-1 text-sm rounded border border-notion-border bg-white"
          >
            <option value="off">关闭</option>
            <option value="on-save">保存时提交（防抖）</option>
            <option value="scheduled">定时提交</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-notion-textSecondary">动作</span>
          <select
            value={action}
            onChange={(e) => setAction(e.target.value as GitSyncConfig['action'])}
            className="px-2 py-1 text-sm rounded border border-notion-border bg-white"
          >
            <option value="commit">仅 commit</option>
            <option value="commit-push">commit 并 push</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-notion-textSecondary">防抖（毫秒，on-save 模式）</span>
          <input
            type="number"
            min={500}
            step={500}
            value={debounce}
            onChange={(e) => setDebounce(parseInt(e.target.value) || 0)}
            className="px-2 py-1 text-sm rounded border border-notion-border bg-white"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-notion-textSecondary">间隔（秒，scheduled 模式）</span>
          <input
            type="number"
            min={30}
            step={30}
            value={scheduled}
            onChange={(e) => setScheduled(parseInt(e.target.value) || 0)}
            className="px-2 py-1 text-sm rounded border border-notion-border bg-white"
          />
        </label>
      </div>
      {action === 'commit-push' && (
        <p className="mt-2 text-xs text-notion-textSecondary">
          ⓘ "commit 并 push" 需要在「凭证」面板配置好 remote 的认证,否则 commit 会成功但 push 会失败(只记日志)。
        </p>
      )}
      <div className="mt-3 flex justify-end">
        <button
          onClick={() => onSave({ mode, action, scheduled_seconds: scheduled, debounce_ms: debounce })}
          className="px-3 py-1 text-sm rounded bg-notion-text text-white hover:opacity-90"
        >
          保存
        </button>
      </div>
    </div>
  );
}

function CredentialsPanel({
  meta,
  onSave,
  onClear,
}: {
  meta: CredentialMeta;
  onSave: (input: {
    type: CredentialType;
    privateKey?: string;
    passphrase?: string;
    password?: string;
  }) => void;
  onClear: () => void;
}) {
  const [type, setType] = useState<CredentialType>(meta.type);
  const [privateKey, setPrivateKey] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [password, setPassword] = useState('');

  useEffect(() => {
    setType(meta.type);
    setPrivateKey('');
    setPassphrase('');
    setPassword('');
  }, [meta.type]);

  const canSave = () => {
    if (type === 'none') return false;
    if (type === 'ssh-key') return privateKey.trim().length > 0;
    if (type === 'ssh-password') return password.length > 0;
    return false;
  };

  const handleSave = () => {
    if (type === 'ssh-key') {
      onSave({ type, privateKey, passphrase });
    } else if (type === 'ssh-password') {
      onSave({ type, password });
    }
  };

  return (
    <div className="mt-4 p-4 border border-notion-border rounded bg-notion-sidebarBg/40">
      <h3 className="text-sm font-medium mb-1">Git 凭证</h3>
      <p className="text-xs text-notion-textSecondary mb-3">
        用于 push / pull 时的 remote 认证。明文存储在服务器 <code className="px-1 bg-notion-hover rounded">data/git_credentials/&lt;space&gt;/</code>,不进入 git 仓库,文件权限 0600。
      </p>

      <div className="flex items-center gap-2 mb-3 text-xs">
        <span className="text-notion-textSecondary">当前:</span>
        <span className="px-2 py-0.5 rounded bg-notion-hover">{meta.type}</span>
        {meta.type === 'ssh-key' && meta.has_passphrase && (
          <span className="text-notion-textSecondary">(含密码)</span>
        )}
      </div>

      <label className="flex flex-col gap-1 mb-3">
        <span className="text-xs text-notion-textSecondary">类型</span>
        <select
          value={type}
          onChange={(e) => setType(e.target.value as CredentialType)}
          className="px-2 py-1 text-sm rounded border border-notion-border bg-white w-fit"
        >
          <option value="none">无（使用服务器默认 git/ssh 配置）</option>
          <option value="ssh-key">SSH 私钥</option>
          <option value="ssh-password">SSH 密码</option>
        </select>
      </label>

      {type === 'ssh-key' && (
        <>
          <label className="flex flex-col gap-1 mb-3">
            <span className="text-xs text-notion-textSecondary">私钥（PEM 格式,含 -----BEGIN/END ...-----）</span>
            <textarea
              value={privateKey}
              onChange={(e) => setPrivateKey(e.target.value)}
              rows={6}
              placeholder={"-----BEGIN OPENSSH PRIVATE KEY-----\n...\n-----END OPENSSH PRIVATE KEY-----"}
              className="px-2 py-1 text-xs font-mono rounded border border-notion-border bg-white resize-y"
            />
          </label>
          <label className="flex flex-col gap-1 mb-3">
            <span className="text-xs text-notion-textSecondary">
              私钥密码（可选,留空表示无密码）
            </span>
            <input
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder="留空表示私钥无密码"
              className="px-2 py-1 text-sm rounded border border-notion-border bg-white"
            />
          </label>
        </>
      )}

      {type === 'ssh-password' && (
        <label className="flex flex-col gap-1 mb-3">
          <span className="text-xs text-notion-textSecondary">
            SSH 密码
          </span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="px-2 py-1 text-sm rounded border border-notion-border bg-white"
          />
        </label>
      )}

      {type === 'none' && (
        <p className="text-xs text-notion-textSecondary mb-3">
          保存后将清除已存储的凭证,git 将使用服务器的全局 ssh / credential helper 配置。
        </p>
      )}

      <div className="flex justify-between">
        {meta.type !== 'none' ? (
          <button
            onClick={onClear}
            className="px-3 py-1 text-sm rounded border border-red-300 text-red-600 hover:bg-red-50"
          >
            清除已存凭证
          </button>
        ) : (
          <span />
        )}
        {type !== 'none' && (
          <button
            onClick={handleSave}
            disabled={!canSave()}
            className="px-3 py-1 text-sm rounded bg-notion-text text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            保存
          </button>
        )}
      </div>
    </div>
  );
}
