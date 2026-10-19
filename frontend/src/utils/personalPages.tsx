import { CheckSquare, Files, Home } from 'lucide-react';
import type { BreadcrumbTrailItem } from '../components/Editor/Breadcrumb';

type PersonalPageKey = 'home' | 'docs' | 'todos';

const PERSONAL_PAGES: Array<{ key: PersonalPageKey; label: string; path: string; icon: React.ReactNode }> = [
  { key: 'home', label: '个人主页', path: '/personal', icon: <Home className="h-[18px] w-[18px]" strokeWidth={1.7} /> },
  { key: 'docs', label: '个人文档', path: '/personal/docs', icon: <Files className="h-[18px] w-[18px]" strokeWidth={1.7} /> },
  { key: 'todos', label: '个人待办', path: '/personal/todos', icon: <CheckSquare className="h-[18px] w-[18px]" strokeWidth={1.7} /> },
];

// 个人空间下的同级页面在面包屑里共用一套下拉，切换时互相跳转。
export function personalTrail(
  navigate: (path: string) => void,
  current: PersonalPageKey,
  ancestors: BreadcrumbTrailItem[] = [],
): BreadcrumbTrailItem[] {
  const currentPage = PERSONAL_PAGES.find((page) => page.key === current)!;
  return [
    {
      label: currentPage.label,
      onClick: () => navigate(currentPage.path),
      siblings: PERSONAL_PAGES.map((page) => ({
        label: page.label,
        icon: page.icon,
        active: page.key === current,
        onClick: () => navigate(page.path),
      })),
    },
    ...ancestors,
  ];
}
