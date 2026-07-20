import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { databasesApi } from '../api/databases';

export default function DatabaseRowPage() {
  const { spaceSlug, dbId, rowId } = useParams<{ spaceSlug: string; dbId: string; rowId: string }>();
  const navigate = useNavigate();
  const [markdown, setMarkdown] = useState('');
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!spaceSlug || !dbId || !rowId) return;
    databasesApi.getRowPage(spaceSlug, dbId, rowId).then((p) => {
      setMarkdown(p.markdown);
      setTitle(p.title);
    });
  }, [spaceSlug, dbId, rowId]);

  if (!spaceSlug || !dbId || !rowId || !markdown) return <div className="flex-1 p-8 text-notion-textSecondary">加载中...</div>;

  return (
    <div className="flex-1 overflow-auto bg-notion-bg">
      <div className="max-w-4xl mx-auto px-8 py-6">
        <button className="flex items-center gap-1 text-sm text-notion-textSecondary hover:text-notion-text mb-4" onClick={() => navigate(-1)}><ArrowLeft size={15} />返回数据库</button>
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-3xl font-semibold text-notion-text">{title}</h1>
          <button
            className="px-3 py-1.5 rounded bg-notion-text text-white text-sm disabled:opacity-60"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              try {
                await databasesApi.putRowPage(spaceSlug, dbId, rowId, markdown);
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
        <textarea
          className="w-full min-h-[560px] bg-white border border-notion-border rounded-md p-4 font-mono text-sm outline-none"
          value={markdown}
          onChange={(e) => setMarkdown(e.target.value)}
        />
      </div>
    </div>
  );
}
