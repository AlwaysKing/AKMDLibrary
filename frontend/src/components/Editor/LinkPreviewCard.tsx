/**
 * LinkPreviewCard — Notion-style hover preview card for mentions & bookmarks.
 * Shows favicon + title, description, and URL on hover over .mention-badge elements.
 * Rendered via createPortal to document.body to avoid CSS transform interference.
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { mentionMetaCache, LinkMeta } from './MentionMetaCache';

function isImageIcon(icon: string): boolean {
  return icon.startsWith('/') || icon.startsWith('http');
}

function DefaultInternalPageIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="link-preview-page-icon"
    >
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M10 9H8" />
      <path d="M16 13H8" />
      <path d="M16 17H8" />
    </svg>
  );
}

const LinkPreviewCard: React.FC = () => {
  const [visible, setVisible] = useState(false);
  const [meta, setMeta] = useState<LinkMeta | null>(null);
  const [url, setUrl] = useState('');
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const isInsideCardRef = useRef(false);

  // Show the card for a given badge element
  const showCard = useCallback((badgeEl: HTMLElement) => {
    const href = badgeEl.getAttribute('data-href');
    if (!href) return;

    const cached = mentionMetaCache.get(href);
    setUrl(href);
    setMeta(cached || null);
    setVisible(true);

    // Position: left-aligned below the badge
    const badgeRect = badgeEl.getBoundingClientRect();
    const cardWidth = 320;
    let x = badgeRect.left;

    // Clamp to viewport
    if (x + cardWidth > window.innerWidth - 8) {
      x = window.innerWidth - 8 - cardWidth;
    }
    if (x < 8) {
      x = 8;
    }
    setPosition({
      x,
      y: badgeRect.bottom + 6,
    });

    // If meta not cached yet, fetch it
    if (!cached) {
      mentionMetaCache.getOrFetch(href).then((fetched) => {
        if (fetched && isInsideCardRef.current) {
          setMeta(fetched);
        }
      });
    }
  }, []);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handleClick = (e: MouseEvent) => {
      const card = cardRef.current;
      if (card && !card.contains(e.target as Node)) {
        setMenuOpen(false);
        setVisible(false);
        setPosition(null);
        isInsideCardRef.current = false;
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [menuOpen]);

  // Global listener for hover on .mention-badge
  useEffect(() => {
    const pmEl = document.querySelector('.ProseMirror') as HTMLElement | null;
    if (!pmEl) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (isInsideCardRef.current) return;
      if (!(e.target instanceof HTMLElement)) return;

      const badge = e.target.closest('.mention-badge') as HTMLElement | null;
      if (badge) {
        if (hideTimerRef.current) {
          clearTimeout(hideTimerRef.current);
          hideTimerRef.current = undefined;
        }
        if (!visible || badge.getAttribute('data-href') !== url) {
          showCard(badge);
        }
      } else if (visible) {
        // Schedule hide
        if (!hideTimerRef.current) {
          hideTimerRef.current = setTimeout(() => {
            if (!isInsideCardRef.current) {
              setVisible(false);
              setPosition(null);
            }
            hideTimerRef.current = undefined;
          }, 200);
        }
      }
    };

    pmEl.addEventListener('mouseover', handleMouseMove);

    return () => {
      pmEl.removeEventListener('mouseover', handleMouseMove);
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
      }
    };
  }, [visible, url, showCard]);

  if (!visible || !position) return null;

  // Derive display URL (strip protocol, trailing slash)
  let displayUrl = url;
  try {
    const u = new URL(url);
    displayUrl = meta?.is_internal
      ? u.pathname
      : u.hostname + (u.pathname !== '/' ? u.pathname : '');
  } catch {}

  return createPortal(
    <div
      ref={cardRef}
      className="link-preview-card"
      style={{
        position: 'fixed',
        left: position.x,
        top: position.y,
        zIndex: 100,
      }}
      onMouseEnter={() => {
        isInsideCardRef.current = true;
        if (hideTimerRef.current) {
          clearTimeout(hideTimerRef.current);
          hideTimerRef.current = undefined;
        }
      }}
      onMouseLeave={() => {
        if (menuOpen) return;
        isInsideCardRef.current = false;
        hideTimerRef.current = setTimeout(() => {
          if (!menuOpen) {
            setVisible(false);
            setPosition(null);
          }
          isInsideCardRef.current = false;
          hideTimerRef.current = undefined;
        }, 150);
      }}
    >
      <div className="link-preview-header">
        <div className="link-preview-title-row">
          <span className={`link-preview-favicon-wrap${meta?.is_internal ? ' is-internal' : ''}`}>
            {meta?.favicon_url ? (
              meta.is_internal && !isImageIcon(meta.favicon_url) ? (
                <span className="link-preview-favicon-emoji">{meta.favicon_url}</span>
              ) : (
                <img
                  className="link-preview-favicon"
                  src={meta.favicon_url}
                  alt=""
                  onError={(e) => {
                    const el = e.target as HTMLImageElement;
                    const fallback = document.createElement('span');
                    fallback.className = 'link-preview-favicon-fallback';
                    fallback.textContent = '🔗';
                    el.replaceWith(fallback);
                  }}
                />
              )
            ) : (
              meta?.is_internal ? (
                <DefaultInternalPageIcon />
              ) : (
                <span className="link-preview-favicon-fallback">🔗</span>
              )
            )}
            {meta?.is_internal && (
              <span className="link-preview-favicon-arrow">↗</span>
            )}
          </span>
          <span className="link-preview-title">
            {meta?.title || url}
          </span>
        </div>
        <button
          className="link-preview-more-btn"
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen(!menuOpen);
          }}
          title="更多操作"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="5" r="2" />
            <circle cx="12" cy="12" r="2" />
            <circle cx="12" cy="19" r="2" />
          </svg>
        </button>
      </div>
      {/* Description */}
      {meta?.description && (
        <div className="link-preview-desc">
          {meta.description.length > 120
            ? meta.description.slice(0, 120) + '…'
            : meta.description}
        </div>
      )}
      {/* URL */}
      <div className="link-preview-url">{displayUrl}</div>
      {/* Dropdown menu */}
      {menuOpen && (
        <div className="link-preview-menu">
          <button className="link-preview-menu-item" onClick={() => {
            navigator.clipboard.writeText(url).catch(() => {});
            setMenuOpen(false);
            setVisible(false);
            setPosition(null);
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            复制链接
          </button>
          <button className="link-preview-menu-item" onClick={() => {
            // Dispatch custom event for PageEditor to handle conversion
            document.dispatchEvent(new CustomEvent('mention:convert-to-bookmark', { detail: { url } }));
            setMenuOpen(false);
            setVisible(false);
            setPosition(null);
            isInsideCardRef.current = false;
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
            转化为书签
          </button>
        </div>
      )}
    </div>,
    document.body
  );
};

export default LinkPreviewCard;
