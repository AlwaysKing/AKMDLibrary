import type { Page } from '../../api/pages';

export interface EditorPageNode {
  id: string;
  title: string;
  icon?: string;
  children?: EditorPageNode[];
}

export interface EditorPageContextValue {
  spaceSlug: string;
  currentPageId: string;
  pageTree: EditorPageNode[];
  pagePath: (pageId: string) => string;
  createSubpage: (title: string, parentId: string) => Promise<Page>;
  refreshPageTree: () => Promise<void>;
}

const editorPageContexts = new WeakMap<object, EditorPageContextValue>();

export function setEditorPageContext(editor: object, context: EditorPageContextValue) {
  editorPageContexts.set(editor, context);
}

export function getEditorPageContext(editor: object): EditorPageContextValue | undefined {
  return editorPageContexts.get(editor);
}
