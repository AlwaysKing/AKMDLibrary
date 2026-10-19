import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, FileText, Loader2, NotebookPen, Search } from 'lucide-react';
import Breadcrumb from '../components/Editor/Breadcrumb';
import PersonalNoteTree from '../components/Sidebar/PersonalNoteTree';
import { usePersonalStore } from '../stores/personalStore';
import { useSpaceStore } from '../stores/spaceStore';
import { flattenPersonalNotes } from '../utils/personalNotes';
import { personalTrail } from '../utils/personalPages';

// 个人空间里最近编辑过的笔记没有单独接口，先用概览返回的树拍平后按最近列出的顺序展示。
const RECENT_LIMIT = 8;

export default function PersonalDocsPage() {
  const navigate = useNavigate();
  const { currentSpace } = useSpaceStore();
  const {
    notes,
    isLoading,
    fetchOverview,
    createNote,
    deleteNote,
    moveNote,
  } = usePersonalStore();
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [expandedNoteIds, setExpandedNoteIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    void fetchOverview();
  }, [fetchOverview]);

  const flatNotes = flattenPersonalNotes(notes);
  const normalizedQuery = query.trim().toLowerCase();
  const visibleNotes = normalizedQuery
    ? flatNotes.filter(({ note }) => (note.title || '未命名笔记').toLowerCase().includes(normalizedQuery))
    : flatNotes;
  const recentNotes = flatNotes.slice(0, RECENT_LIMIT);

  const toggleNote = (id: string) => {
    setExpandedNoteIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCreateNote = async (parentId?: string) => {
    if (creating) return;
    setCreating(true);
    try {
      const note = await createNote(parentId ? '未命名子页面' : '未命名笔记', parentId);
      if (parentId) {
        setExpandedNoteIds((current) => new Set(current).add(parentId));
      }
      navigate(`/personal/notes/${note.id}`);
    } catch {
      // Store surfaces the request error.
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex h-full flex-col select-none overflow-hidden bg-notion-bg">
      <Breadcrumb
        spaceSlug={currentSpace?.slug || ''}
        rootLabel="个人空间"
        trail={personalTrail(navigate, 'docs')}
      />

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[900px] px-10 pb-24 pt-12">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h1 className="text-[34px] font-bold leading-tight tracking-[-0.035em] text-notion-text">
                个人文档
              </h1>
              <p className="mt-1.5 text-sm text-notion-textSecondary">
                {flatNotes.length} 篇私人笔记，按最近使用排序
              </p>
            </div>
            <button
              type="button"
              disabled={creating}
              onClick={() => void handleCreateNote()}
              className="flex h-[38px] flex-shrink-0 items-center gap-2 rounded-md border border-[#d6e7f8] bg-[#eaf3fc] px-3 text-xs font-semibold text-notion-text transition-colors hover:bg-[#dfeefa] disabled:opacity-50"
            >
              {creating ? (
                <Loader2 className="h-4 w-4 animate-spin text-[#2383e2]" />
              ) : (
                <NotebookPen className="h-4 w-4 text-[#2383e2]" />
              )}
              新建笔记
            </button>
          </div>

          <div className="mt-5 flex h-[43px] items-center gap-2 rounded-lg border border-notion-border px-3 shadow-sm">
            <Search className="h-4 w-4 flex-shrink-0 text-notion-textSecondary" strokeWidth={1.8} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索个人文档…"
              className="min-w-0 flex-1 select-text border-0 bg-transparent text-sm text-notion-text outline-none placeholder:text-notion-textSecondary"
            />
          </div>

          {isLoading && flatNotes.length === 0 ? (
            <div className="flex items-center gap-2 py-6 text-xs text-notion-textSecondary">
              <Loader2 className="h-4 w-4 animate-spin" />
              正在加载…
            </div>
          ) : flatNotes.length === 0 ? (
            <div className="py-10 text-sm text-notion-textSecondary">还没有私人笔记</div>
          ) : normalizedQuery ? (
            <section className="mt-7">
              <div className="flex h-7 items-center gap-1.5 text-xs font-semibold text-notion-text">
                <Search className="h-4 w-4 text-notion-textSecondary" strokeWidth={1.8} />
                搜索结果
                <span className="text-[11px] font-medium text-notion-textSecondary">{visibleNotes.length}</span>
              </div>
              {visibleNotes.length > 0 ? (
                visibleNotes.map(({ note, depth }) => (
                  <button
                    type="button"
                    key={note.id}
                    onClick={() => navigate(`/personal/notes/${note.id}`)}
                    className="flex h-[34px] w-full items-center gap-2 rounded-md px-1 text-left transition-colors hover:bg-notion-hover"
                    style={{ paddingLeft: `${depth * 16 + 4}px` }}
                  >
                    {note.icon ? (
                      note.icon.startsWith('/') || note.icon.startsWith('http') ? (
                        <img src={note.icon} alt="" className="h-4 w-4 flex-shrink-0 object-contain" />
                      ) : (
                        <span className="w-4 flex-shrink-0 text-center text-sm leading-none">{note.icon}</span>
                      )
                    ) : (
                      <FileText className="h-4 w-4 flex-shrink-0 text-notion-textSecondary" strokeWidth={1.7} />
                    )}
                    <span className="min-w-0 flex-1 truncate text-sm text-notion-text">{note.title || '未命名笔记'}</span>
                  </button>
                ))
              ) : (
                <div className="py-5 text-xs text-notion-textSecondary">没有匹配的笔记</div>
              )}
            </section>
          ) : (
            <>
              {/* 笔记不多时「最近」和「全部文档」是同一份内容，不重复展示。 */}
              {flatNotes.length > RECENT_LIMIT && (
                <section className="mt-7">
                  <div className="flex h-7 items-center gap-1.5 text-xs font-semibold text-notion-text">
                    <Clock className="h-4 w-4 text-notion-textSecondary" strokeWidth={1.8} />
                    最近
                    <span className="text-[11px] font-medium text-notion-textSecondary">{recentNotes.length}</span>
                  </div>
                  {recentNotes.map(({ note }) => (
                    <button
                      type="button"
                      key={note.id}
                      onClick={() => navigate(`/personal/notes/${note.id}`)}
                      className="flex h-[34px] w-full items-center gap-2 rounded-md px-1 text-left transition-colors hover:bg-notion-hover"
                    >
                      {note.icon ? (
                        note.icon.startsWith('/') || note.icon.startsWith('http') ? (
                          <img src={note.icon} alt="" className="h-4 w-4 flex-shrink-0 object-contain" />
                        ) : (
                          <span className="w-4 flex-shrink-0 text-center text-sm leading-none">{note.icon}</span>
                        )
                      ) : (
                        <FileText className="h-4 w-4 flex-shrink-0 text-notion-textSecondary" strokeWidth={1.7} />
                      )}
                      <span className="min-w-0 flex-1 truncate text-sm text-notion-text">{note.title || '未命名笔记'}</span>
                    </button>
                  ))}
                </section>
              )}

              <section className="mt-7">
                <PersonalNoteTree
                  notes={notes}
                  expandedIds={expandedNoteIds}
                  onToggle={toggleNote}
                  onOpen={(id) => navigate(`/personal/notes/${id}`)}
                  onAddChild={(id) => void handleCreateNote(id)}
                  onDelete={(id) => void deleteNote(id)}
                  onMove={(id, parentId, afterId) => void moveNote(id, parentId, afterId)}
                  variant="page"
                />
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
