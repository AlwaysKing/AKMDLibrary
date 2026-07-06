package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strings"

	"github.com/alwaysking/akmdlibrary/internal/middleware"
	"github.com/alwaysking/akmdlibrary/internal/model"
	"github.com/alwaysking/akmdlibrary/internal/service"
	"github.com/go-chi/chi/v5"
)

type SyncedBlockHandler struct {
	pageService  *service.PageService
	spaceService *service.SpaceService
}

type syncedQuote struct {
	PageID string `json:"pageId"`
	SyncID string `json:"syncId"`
}

type syncedBlockPayload struct {
	Markdown    string        `json:"markdown"`
	SourceTitle string        `json:"sourceTitle"`
	Quoted      []syncedQuote `json:"quoted"`
}

func NewSyncedBlockHandler(pageService *service.PageService, spaceService *service.SpaceService) *SyncedBlockHandler {
	return &SyncedBlockHandler{pageService: pageService, spaceService: spaceService}
}

func (h *SyncedBlockHandler) checkSpaceAccess(w http.ResponseWriter, r *http.Request, slug string) bool {
	userID := middleware.GetUserID(r)
	space, err := h.spaceService.GetBySlug(slug)
	if err != nil {
		http.Error(w, "Space not found", http.StatusNotFound)
		return false
	}
	if !h.spaceService.IsSpaceMember(space.ID, userID) {
		http.Error(w, "Access denied", http.StatusForbidden)
		return false
	}
	return true
}

func (h *SyncedBlockHandler) Get(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	if !h.checkSpaceAccess(w, r, slug) {
		return
	}
	sourcePageID := r.URL.Query().Get("sourcePageId")
	sourceBlockID := r.URL.Query().Get("sourceBlockId")
	payload, err := h.readSyncedBlock(slug, sourcePageID, sourceBlockID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	writeSyncedJSON(w, payload)
}

func (h *SyncedBlockHandler) Update(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	if !h.checkSpaceAccess(w, r, slug) {
		return
	}
	sourcePageID := r.URL.Query().Get("sourcePageId")
	sourceBlockID := chi.URLParam(r, "sourceBlockId")
	var req struct {
		Markdown     string        `json:"markdown"`
		AddQuoted    []syncedQuote `json:"addQuoted"`
		RemoveQuoted []string      `json:"removeQuoted"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	page, source, err := h.getSource(slug, sourcePageID, sourceBlockID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	source.Content = req.Markdown
	source.Quoted = updateQuotedList(source.Quoted, req.AddQuoted, req.RemoveQuoted)
	nextBody := replaceRange(page.Content, source.Start, source.End, renderSourceBlock(source.ID, source.Quoted, source.Content))
	if _, err := h.pageService.Update(slug, sourcePageID, &model.UpdatePageRequest{Content: nextBody}); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeSyncedJSON(w, syncedBlockPayload{Markdown: source.Content, SourceTitle: page.Title, Quoted: source.Quoted})
}

func (h *SyncedBlockHandler) WrapSource(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	if !h.checkSpaceAccess(w, r, slug) {
		return
	}
	var req struct {
		SourcePageID string `json:"sourcePageId"`
		SourceMd     string `json:"sourceMd"`
		NewSyncID    string `json:"newSyncId"`
		MirrorPageID string `json:"mirrorPageId"`
		MirrorSyncID string `json:"mirrorSyncId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	if req.SourcePageID == "" || req.SourceMd == "" || req.NewSyncID == "" || req.MirrorPageID == "" || req.MirrorSyncID == "" {
		http.Error(w, "Missing required fields", http.StatusBadRequest)
		return
	}
	page, err := h.pageService.GetByID(slug, req.SourcePageID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	idx := strings.Index(page.Content, req.SourceMd)
	if idx < 0 {
		idx = strings.Index(page.Content, strings.TrimSpace(req.SourceMd))
	}
	if idx < 0 {
		http.Error(w, "Source markdown not found", http.StatusConflict)
		return
	}
	sourceMd := req.SourceMd
	if strings.Index(page.Content, sourceMd) < 0 {
		sourceMd = strings.TrimSpace(req.SourceMd)
	}
	quoted := []syncedQuote{{PageID: req.MirrorPageID, SyncID: req.MirrorSyncID}}
	wrapped := renderSourceBlock(req.NewSyncID, quoted, sourceMd)
	nextBody := page.Content[:idx] + wrapped + page.Content[idx+len(sourceMd):]
	if _, err := h.pageService.Update(slug, req.SourcePageID, &model.UpdatePageRequest{Content: nextBody}); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeSyncedJSON(w, map[string]string{"sourcePageId": req.SourcePageID, "sourceBlockId": req.NewSyncID})
}

func (h *SyncedBlockHandler) Delete(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	if !h.checkSpaceAccess(w, r, slug) {
		return
	}
	sourcePageID := r.URL.Query().Get("sourcePageId")
	sourceBlockID := chi.URLParam(r, "sourceBlockId")
	var req struct {
		Strategy string `json:"strategy"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	if req.Strategy == "" {
		req.Strategy = "cascade"
	}
	page, source, err := h.getSource(slug, sourcePageID, sourceBlockID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	if req.Strategy != "cascade" && req.Strategy != "placeholder" && req.Strategy != "inline" {
		http.Error(w, "Invalid strategy", http.StatusBadRequest)
		return
	}
	if req.Strategy == "cascade" || req.Strategy == "inline" {
		for _, q := range source.Quoted {
			mirrorPage, err := h.pageService.GetByID(slug, q.PageID)
			if err != nil {
				continue
			}
			replacement := ""
			if req.Strategy == "inline" {
				replacement = source.Content
			}
			next := replaceMirrorBlock(mirrorPage.Content, q.SyncID, replacement)
			if next != mirrorPage.Content {
				_, _ = h.pageService.Update(slug, q.PageID, &model.UpdatePageRequest{Content: next})
			}
		}
	}
	nextBody := replaceRange(page.Content, source.Start, source.End, "")
	if _, err := h.pageService.Update(slug, sourcePageID, &model.UpdatePageRequest{Content: strings.TrimSpace(nextBody)}); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeSyncedJSON(w, map[string][]syncedQuote{"affectedPages": source.Quoted})
}

type sourceBlock struct {
	ID      string
	Quoted  []syncedQuote
	Content string
	Start   int
	End     int
}

func (h *SyncedBlockHandler) getSource(slug, pageID, blockID string) (*model.Page, *sourceBlock, error) {
	page, err := h.pageService.GetByID(slug, pageID)
	if err != nil {
		return nil, nil, err
	}
	source, err := parseSourceBlock(page.Content, blockID)
	if err != nil {
		return nil, nil, err
	}
	return page, source, nil
}

func (h *SyncedBlockHandler) readSyncedBlock(slug, pageID, blockID string) (*syncedBlockPayload, error) {
	page, source, err := h.getSource(slug, pageID, blockID)
	if err != nil {
		return nil, err
	}
	return &syncedBlockPayload{Markdown: source.Content, SourceTitle: page.Title, Quoted: source.Quoted}, nil
}

func parseSourceBlock(body, blockID string) (*sourceBlock, error) {
	re := regexp.MustCompile(`(?s)<sync-block\s+id="` + regexp.QuoteMeta(blockID) + `"\s*>(.*?)</sync-block>`)
	loc := re.FindStringSubmatchIndex(body)
	if loc == nil {
		return nil, fmt.Errorf("synced block not found")
	}
	inner := body[loc[2]:loc[3]]
	contentRe := regexp.MustCompile(`(?s)<content>\s*\n?(.*?)\n?\s*</content>`)
	contentMatch := contentRe.FindStringSubmatch(inner)
	if len(contentMatch) < 2 {
		return nil, fmt.Errorf("synced block content not found")
	}
	quotedRe := regexp.MustCompile(`(?s)<quoted>(.*?)</quoted>`)
	quotedMatch := quotedRe.FindStringSubmatch(inner)
	quoted := []syncedQuote{}
	if len(quotedMatch) >= 2 {
		qRe := regexp.MustCompile(`<q\s+page-id="([^"]+)"\s+sync-id="([^"]+)"\s*/>`)
		for _, m := range qRe.FindAllStringSubmatch(quotedMatch[1], -1) {
			quoted = append(quoted, syncedQuote{PageID: m[1], SyncID: m[2]})
		}
	}
	return &sourceBlock{
		ID:      blockID,
		Quoted:  quoted,
		Content: strings.TrimSpace(contentMatch[1]),
		Start:   loc[0],
		End:     loc[1],
	}, nil
}

func renderSourceBlock(id string, quoted []syncedQuote, content string) string {
	var b strings.Builder
	b.WriteString(`<sync-block id="`)
	b.WriteString(escapeAttr(id))
	b.WriteString("\">\n  <quoted>\n")
	for _, q := range quoted {
		if q.PageID == "" || q.SyncID == "" {
			continue
		}
		b.WriteString(`    <q page-id="`)
		b.WriteString(escapeAttr(q.PageID))
		b.WriteString(`" sync-id="`)
		b.WriteString(escapeAttr(q.SyncID))
		b.WriteString(`" />` + "\n")
	}
	b.WriteString("  </quoted>\n  <content>\n")
	b.WriteString(strings.TrimSpace(content))
	b.WriteString("\n  </content>\n</sync-block>")
	return b.String()
}

func updateQuotedList(current, add []syncedQuote, remove []string) []syncedQuote {
	removeSet := map[string]bool{}
	for _, id := range remove {
		removeSet[id] = true
	}
	out := []syncedQuote{}
	seen := map[string]bool{}
	for _, q := range current {
		if q.SyncID == "" || removeSet[q.SyncID] || seen[q.SyncID] {
			continue
		}
		seen[q.SyncID] = true
		out = append(out, q)
	}
	for _, q := range add {
		if q.PageID == "" || q.SyncID == "" || removeSet[q.SyncID] || seen[q.SyncID] {
			continue
		}
		seen[q.SyncID] = true
		out = append(out, q)
	}
	return out
}

func replaceMirrorBlock(body, syncID, replacement string) string {
	re := regexp.MustCompile(`(?s)<sync-block\s+id="` + regexp.QuoteMeta(syncID) + `"\s+source-page="[^"]+"\s+source-block="[^"]+"\s*/>`)
	return re.ReplaceAllString(body, strings.TrimSpace(replacement))
}

func replaceRange(s string, start, end int, replacement string) string {
	return s[:start] + replacement + s[end:]
}

func escapeAttr(v string) string {
	v = strings.ReplaceAll(v, "&", "&amp;")
	v = strings.ReplaceAll(v, `"`, "&quot;")
	v = strings.ReplaceAll(v, "<", "&lt;")
	v = strings.ReplaceAll(v, ">", "&gt;")
	return v
}

func writeSyncedJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}
