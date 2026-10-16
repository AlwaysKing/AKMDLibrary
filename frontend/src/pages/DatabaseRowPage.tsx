import { useNavigate, useParams } from 'react-router-dom';
import DatabaseRowView from '../components/Editor/database/DatabaseRowView';

export default function DatabaseRowPage() {
  const { spaceSlug, dbId, rowId } = useParams<{ spaceSlug: string; dbId: string; rowId: string }>();
  const navigate = useNavigate();

  if (!spaceSlug || !dbId || !rowId) return <div className="flex-1 p-8 text-notion-textSecondary">加载中...</div>;

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-notion-bg">
      <DatabaseRowView spaceSlug={spaceSlug} dbId={dbId} rowId={rowId} onBack={() => navigate(-1)} />
    </div>
  );
}
