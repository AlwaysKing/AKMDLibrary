package service

import (
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/alwaysking/mdlibrary/internal/model"
	"github.com/alwaysking/mdlibrary/internal/repository"
)

type BookmarkService struct {
	repo *repository.BookmarkRepository
}

func NewBookmarkService(repo *repository.BookmarkRepository) *BookmarkService {
	return &BookmarkService{repo: repo}
}

var client = &http.Client{Timeout: 5 * time.Second}

func (s *BookmarkService) GetMeta(url string) (*model.BookmarkMeta, error) {
	// Validate URL scheme
	if !strings.HasPrefix(url, "http://") && !strings.HasPrefix(url, "https://") {
		return nil, fmt.Errorf("unsupported URL scheme, only http and https are allowed")
	}

	// 1. Check cache
	cached, err := s.repo.Get(url)
	if err != nil {
		return nil, fmt.Errorf("failed to check cache: %w", err)
	}
	if cached != nil {
		return cached, nil
	}

	// 2. Fetch URL
	meta, err := s.fetchAndParse(url)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch bookmark meta: %w", err)
	}

	// 3. Save to cache (3 day expiration)
	meta.FetchedAt = time.Now()
	meta.ExpiresAt = time.Now().Add(3 * 24 * time.Hour)
	if err := s.repo.Save(meta); err != nil {
		return nil, fmt.Errorf("failed to cache bookmark meta: %w", err)
	}

	return meta, nil
}

func (s *BookmarkService) fetchAndParse(url string) (*model.BookmarkMeta, error) {
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36")
	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
	req.Header.Set("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}

	// Only read first 64KB
	body, err := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
	if err != nil {
		return nil, err
	}

	html := string(body)
	meta := &model.BookmarkMeta{URL: url}

	// Title
	meta.Title = extractMeta(html, "title")

	// Meta description
	meta.Description = extractMetaAttr(html, "name", "description")
	if meta.Description == "" {
		meta.Description = extractMetaAttr(html, "property", "og:description")
	}

	// Favicon
	favicon := resolveURL(url, extractLinkHref(html, "icon"))
	if favicon == "" {
		favicon = resolveURL(url, extractLinkHref(html, "shortcut icon"))
	}
	// If favicon is from a different domain (CDN), browsers may block it via CORS.
	// Prefer same-origin /favicon.ico which is always loadable.
	origin := mustParseOrigin(url)
	if favicon == "" || !strings.HasPrefix(favicon, origin) {
		favicon = fmt.Sprintf("%s/favicon.ico", origin)
	}
	meta.FaviconURL = favicon

	// OG image
	meta.ImageURL = resolveURL(url, extractMetaAttr(html, "property", "og:image"))

	return meta, nil
}

// extractMeta extracts <title>...</title>
func extractMeta(html, tag string) string {
	re := regexp.MustCompile(`<title[^>]*>(.*?)</title>`)
	matches := re.FindStringSubmatch(html)
	if len(matches) > 1 {
		return strings.TrimSpace(decodeHTMLEntities(matches[1]))
	}
	return ""
}

// extractMetaAttr extracts <meta name/property="..." content="...">
func extractMetaAttr(html, attrName, attrValue string) string {
	re := regexp.MustCompile(fmt.Sprintf(
		`<meta\s+[^>]*%s\s*=\s*["']%s["'][^>]*\bcontent\s*=\s*["']([^"']*)["']`,
		regexp.QuoteMeta(attrName), regexp.QuoteMeta(attrValue),
	))
	matches := re.FindStringSubmatch(html)
	if len(matches) > 1 {
		return strings.TrimSpace(decodeHTMLEntities(matches[1]))
	}
	// Try reversed attribute order
	re2 := regexp.MustCompile(fmt.Sprintf(
		`<meta\s+[^>]*\bcontent\s*=\s*["']([^"']*)["'][^>]*%s\s*=\s*["']%s["']`,
		regexp.QuoteMeta(attrName), regexp.QuoteMeta(attrValue),
	))
	matches = re2.FindStringSubmatch(html)
	if len(matches) > 1 {
		return strings.TrimSpace(decodeHTMLEntities(matches[1]))
	}
	return ""
}

// extractLinkHref extracts <link rel="..." href="...">
func extractLinkHref(html, rel string) string {
	re := regexp.MustCompile(fmt.Sprintf(
		`<link\s+[^>]*rel\s*=\s*["']%s["'][^>]*\bhref\s*=\s*["']([^"']*)["']`,
		regexp.QuoteMeta(rel),
	))
	matches := re.FindStringSubmatch(html)
	if len(matches) > 1 {
		return matches[1]
	}
	return ""
}

func resolveURL(baseURL, href string) string {
	if href == "" {
		return ""
	}
	if strings.HasPrefix(href, "http://") || strings.HasPrefix(href, "https://") {
		return href
	}
	if strings.HasPrefix(href, "//") {
		return "https:" + href
	}
	origin := mustParseOrigin(baseURL)
	if strings.HasPrefix(href, "/") {
		return origin + href
	}
	return origin + "/" + href
}

func mustParseOrigin(url string) string {
	parts := strings.SplitN(url, "/", 4)
	if len(parts) >= 3 {
		return parts[0] + "//" + parts[2]
	}
	return url
}

func decodeHTMLEntities(s string) string {
	s = strings.ReplaceAll(s, "&amp;", "&")
	s = strings.ReplaceAll(s, "&lt;", "<")
	s = strings.ReplaceAll(s, "&gt;", ">")
	s = strings.ReplaceAll(s, "&quot;", "\"")
	s = strings.ReplaceAll(s, "&#39;", "'")
	s = strings.ReplaceAll(s, "&nbsp;", " ")
	return s
}
