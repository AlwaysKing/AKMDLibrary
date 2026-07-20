import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Database, Plus } from 'lucide-react';
import { databasesApi, type DatabaseSummary } from '../api/databases';

export default function DatabasesPage() {
  const { spaceSlug } = useParams<{ spaceSlug: string }>();
  const navigate = useNavigate();
  const [items, setItems] = useState<DatabaseSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');

  const refresh = async () => {
    if (!spaceSlug) return;
    setLoading(true);
    try {
      setItems(await databasesApi.list(spaceSlug));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [spaceSlug]);

  const create = async () => {
    if (!spaceSlug || !name.trim()) return;
    const db = await databasesApi.create(spaceSlug, { name: name.trim(), icon: '🗃️' });
    navigate(`/s/${spaceSlug}/databases/${db.id}`);
  };

  return (
    <div className="flex-1 overflow-auto bg-notion-bg">
      <div className="max-w-5xl mx-auto px-8 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-semibold text-notion-text flex items-center gap-2"><Database size={22} />源数据管理</h1>
          <div className="flex gap-2">
            <input className="border border-notion-border rounded px-3 py-1.5 text-sm" value={name} onChange={(e) => setName(e.target.value)} placeholder="新数据源名称" />
            <button className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-notion-text text-white text-sm disabled:opacity-50" disabled={!name.trim()} onClick={create}><Plus size={15} />新建数据源</button>
          </div>
        </div>
        {loading ? <div className="text-notion-textSecondary">加载中...</div> : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {items.map((db) => (
              <button key={db.id} onClick={() => navigate(`/s/${spaceSlug}/databases/${db.id}`)} className="text-left border border-notion-border rounded-md bg-white p-4 hover:bg-notion-hover transition-colors">
                <div className="text-lg mb-2">{db.icon || '🗃️'} <span className="font-medium text-notion-text">{db.name}</span></div>
                <p className="text-sm text-notion-textSecondary min-h-[20px]">{db.description || '无描述'}</p>
                <div className="mt-3 text-xs text-notion-textSecondary">{db.column_count} 列 · {db.row_count} 行</div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
