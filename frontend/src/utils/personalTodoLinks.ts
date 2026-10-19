import type { PersonalTodoLink } from '../api/personal';

export function personalTodoLinkPath(link: PersonalTodoLink): string | null {
  if (link.type === 'page' && link.page_id) {
    return link.space_slug.startsWith('.personal-')
      ? `/personal/notes/${link.page_id}`
      : `/s/${link.space_slug}/p/${link.page_id}`;
  }
  if (link.type === 'database-row' && link.database_id && link.row_id) {
    return `/s/${link.space_slug}/db/${link.database_id}/row/${link.row_id}`;
  }
  return null;
}
