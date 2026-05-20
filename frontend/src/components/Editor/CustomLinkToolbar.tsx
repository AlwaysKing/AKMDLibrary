/**
 * Custom link toolbar — self-contained Notion-style hover tooltip and edit popup.
 * Handles its own link detection (hover + selection) and floating positioning.
 * Does NOT rely on BlockNote's LinkToolbarExtension or LinkToolbarController.
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';

// Same regex as PageEditor.tsx
const APP_ORIGIN = typeof window !== 'undefined' ? window.location.origin : '';
const INTERNAL_URL_RE = new RegExp(`^${APP_ORIGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/s/([^/]+)/p/([a-f0-9]{32})(?:$|/)`);

interface LinkInfo {
  url: string;
  text: string;
  from: number;
  to: number;
  rect: DOMRect;
}

const CustomLinkToolbar: React.FC = () => {
  const [linkInfo, setLinkInfo] = useState<LinkInfo | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editUrl, setEditUrl] = useState('');
  const [editText, setEditText] = useState('');
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [cursorType, setCursorType] = useState<'mouse' | 'text'>('mouse');
  const [copied, setCopied] = useState(false);
  const urlInputRef = useRef<HTMLInputElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const isInsideToolbarRef = useRef(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout>>();

  // Detect link at a ProseMirror position
  const getLinkAtPos = useCallback((pmView: any, pos: number): LinkInfo | null => {
    try {
      const state = pmView.state;
      const $pos = state.doc.resolve(pos);
      const linkMark = state.schema.marks.link;
      if (!linkMark) return null;

      // Check if the position is inside a link mark
      const marks = $pos.marks();
      const link = marks.find((m: any) => m.type === linkMark);
      if (!link) return null;

      // Find the full range of the link mark
      let from = pos;
      let to = pos;
      const node = $pos.parent;
      const nodeStart = $pos.start();

      node.content.forEach((child: any, offset: number) => {
        const childStart = nodeStart + offset;
        const childMarks = child.marks || [];
        if (childMarks.some((m: any) => m.type === linkMark && m.attrs.href === link.attrs.href)) {
          if (childStart < from) from = childStart;
          if (childStart + child.nodeSize > to) to = childStart + child.nodeSize;
        }
      });

      const text = state.doc.textBetween(from, to);
      const coords = pmView.coordsAtPos(Math.max(from, Math.min(to - 1, state.doc.content.size - 1)));

      return {
        url: link.attrs.href,
        text,
        from,
        to,
        rect: coords,
      };
    } catch {
      return null;
    }
  }, []);

  // Detect link from a DOM element
  const getLinkFromElement = useCallback((pmView: any, element: HTMLElement): LinkInfo | null => {
    try {
      // Walk up to find an <a> tag
      let el: HTMLElement | null = element;
      while (el && el.tagName !== 'A') {
        if (el.classList?.contains('ProseMirror')) return null;
        el = el.parentElement;
      }
      if (!el || el.tagName !== 'A') return null;

      const href = (el as HTMLAnchorElement).getAttribute('href');
      if (!href) return null;

      const pos = pmView.posAtDOM(el, 0) + 1;
      return getLinkAtPos(pmView, pos);
    } catch {
      return null;
    }
  }, [getLinkAtPos]);

  // Get the ProseMirror EditorView from the DOM
  const getPmView = useCallback(() => {
    const pmEl = document.querySelector('.ProseMirror') as HTMLElement | null;
    if (!pmEl) return null;
    const editor = (pmEl as any).editor;
    if (editor?.editorView) return editor.editorView;
    return null;
  }, []);

  // Setup listeners
  useEffect(() => {
    const pmEl = document.querySelector('.ProseMirror') as HTMLElement | null;
    if (!pmEl) return;

    const pmView = getPmView();
    if (!pmView) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (isInsideToolbarRef.current) return;
      if (!(e.target instanceof HTMLElement)) return;

      const view = getPmView();
      if (!view) return;

      const link = getLinkFromElement(view, e.target);
      if (link && !INTERNAL_URL_RE.test(link.url)) {
        if (hideTimerRef.current) {
          clearTimeout(hideTimerRef.current);
          hideTimerRef.current = undefined;
        }
        setLinkInfo(link);
        setCursorType('mouse');
        setIsEditing(false);
        setEditUrl(link.url);
        setEditText(link.text);
        // Position above the link
        const rect = (e.target as HTMLElement).closest('a')?.getBoundingClientRect() ?? link.rect;
        setPosition({
          x: rect.left,
          y: rect.bottom + 6,
        });
      } else if (linkInfo && !isEditing) {
        // Schedule hide
        if (!hideTimerRef.current) {
          hideTimerRef.current = setTimeout(() => {
            if (!isInsideToolbarRef.current) {
              setLinkInfo(null);
              setPosition(null);
            }
            hideTimerRef.current = undefined;
          }, 300);
        }
      }
    };

    pmEl.addEventListener('mousemove', handleMouseMove);

    return () => {
      pmEl.removeEventListener('mousemove', handleMouseMove);
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
      }
    };
  }, [getLinkAtPos, getLinkFromElement, getPmView, linkInfo, isEditing]);

  // Focus URL input when entering edit mode
  useEffect(() => {
    if (isEditing && urlInputRef.current) {
      urlInputRef.current.focus();
      urlInputRef.current.select();
    }
  }, [isEditing]);

  // Handle save
  const handleSave = useCallback(() => {
    if (!linkInfo) return;
    const pmView = getPmView();
    if (!pmView) return;

    const { from, to } = linkInfo;
    const newUrl = editUrl.trim();
    const newText = editText.trim() || newUrl;
    const linkMark = pmView.state.schema.marks.link;

    try {
      if (!newUrl) {
        // Remove link
        const tr = pmView.state.tr.removeMark(from, to, linkMark);
        pmView.dispatch(tr);
      } else {
        // Update link: remove old mark, set new one with updated text
        let tr = pmView.state.tr.removeMark(from, to, linkMark);
        // If text changed, we need to replace the content
        if (newText !== linkInfo.text) {
          const mark = linkMark.create({ href: newUrl });
          const textNode = pmView.state.schema.text(newText, [mark]);
          tr = tr.replaceWith(from, to, textNode);
        } else {
          // Just update the href
          const mark = linkMark.create({ href: newUrl });
          tr = tr.addMark(from, to, mark);
        }
        pmView.dispatch(tr);
      }
    } catch (e) {
      console.error('Failed to update link:', e);
    }

    setIsEditing(false);
    isInsideToolbarRef.current = false;
    setLinkInfo(null);
    setPosition(null);
  }, [linkInfo, editUrl, editText, getPmView]);

  const handleRemove = useCallback(() => {
    if (!linkInfo) return;
    const pmView = getPmView();
    if (!pmView) return;

    const { from, to } = linkInfo;
    const linkMark = pmView.state.schema.marks.link;
    const tr = pmView.state.tr.removeMark(from, to, linkMark);
    pmView.dispatch(tr);

    setIsEditing(false);
    isInsideToolbarRef.current = false;
    setLinkInfo(null);
    setPosition(null);
  }, [linkInfo, getPmView]);

  const handleCopyLink = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (linkInfo) {
      navigator.clipboard.writeText(linkInfo.url).catch(() => {});
      setCopied(true);
      setTimeout(() => setCopied(false), 1000);
    }
  }, [linkInfo]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setIsEditing(false);
      isInsideToolbarRef.current = false;
      setLinkInfo(null);
      setPosition(null);
    }
  }, [handleSave]);

  if (!position || !linkInfo) return null;

  return createPortal(
    <div
      ref={toolbarRef}
      className="bn-toolbar bn-link-toolbar"
      style={{
        position: 'fixed',
        left: position.x,
        top: position.y,
        transform: 'none',
        zIndex: 50,
      }}
      onMouseEnter={() => {
        isInsideToolbarRef.current = true;
        if (hideTimerRef.current) {
          clearTimeout(hideTimerRef.current);
          hideTimerRef.current = undefined;
        }
      }}
      onMouseLeave={() => {
        isInsideToolbarRef.current = false;
        if (cursorType === 'mouse' && !isEditing) {
          hideTimerRef.current = setTimeout(() => {
            setLinkInfo(null);
            setPosition(null);
            isInsideToolbarRef.current = false;
          }, 200);
        }
      }}
    >
      {!isEditing ? (
        // Hover mode
        <div className="custom-link-toolbar-hover">
          <a
            href={linkInfo.url}
            target="_blank"
            rel="noopener noreferrer"
            className="custom-link-toolbar-url"
            onClick={(e) => { e.preventDefault(); window.open(linkInfo.url, '_blank'); }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <circle cx="12" cy="12" r="10" />
              <line x1="2" y1="12" x2="22" y2="12" />
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            </svg>
            <span>{linkInfo.url}</span>
          </a>
          <button className="custom-link-toolbar-btn" onClick={handleCopyLink} title="复制链接">
            {copied ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            )}
          </button>
          <button className="custom-link-toolbar-btn" onClick={() => setIsEditing(true)} title="编辑">
            编辑
          </button>
        </div>
      ) : (
        // Edit mode
        <div className="custom-link-toolbar-edit">
          <div className="custom-link-toolbar-field">
            <label>链接标题</label>
            <input
              type="text"
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="显示文字"
            />
          </div>
          <div className="custom-link-toolbar-field">
            <label>页面或 URL</label>
            <input
              ref={urlInputRef}
              type="text"
              value={editUrl}
              onChange={(e) => setEditUrl(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入 URL"
            />
          </div>
          <div className="custom-link-toolbar-actions">
            <button className="custom-link-toolbar-save" onClick={handleSave}>
              保存
            </button>
            <button className="custom-link-toolbar-remove" onClick={handleRemove}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
              移除链接
            </button>
          </div>
        </div>
      )}
    </div>,
    document.body
  );
};

export default CustomLinkToolbar;
