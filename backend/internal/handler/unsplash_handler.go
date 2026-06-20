package handler

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"

	"github.com/alwaysking/akmdlibrary/internal/middleware"
	"github.com/alwaysking/akmdlibrary/internal/service"
)

// UnsplashHandler 代理用户的 Unsplash API 请求，避免在前端暴露 API key
type UnsplashHandler struct {
	prefService *service.PreferenceService
}

func NewUnsplashHandler(prefService *service.PreferenceService) *UnsplashHandler {
	return &UnsplashHandler{prefService: prefService}
}

// Status 返回当前用户是否配置了 Unsplash API key
// GET /api/unsplash/status
func (h *UnsplashHandler) Status(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)
	if userID == 0 {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	key, err := h.prefService.GetUnsplashKey(userID)
	if err != nil {
		http.Error(w, "Failed to read preferences", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"configured": key != ""})
}

// Search 代理 Unsplash 图片搜索
// GET /api/unsplash/search?q=forest&per_page=12
//
// 流程：从 DB 读用户 key → 调 Unsplash API → 透传 JSON 响应
// key 永远不离开后端
func (h *UnsplashHandler) Search(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)
	if userID == 0 {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	query := r.URL.Query().Get("q")
	if query == "" {
		http.Error(w, `{"error": "missing query parameter 'q'"}`, http.StatusBadRequest)
		return
	}

	perPage := r.URL.Query().Get("per_page")
	if perPage == "" {
		perPage = "12"
	}
	page := r.URL.Query().Get("page")
	if page == "" {
		page = "1"
	}

	key, err := h.prefService.GetUnsplashKey(userID)
	if err != nil {
		http.Error(w, "Failed to read preferences", http.StatusInternalServerError)
		return
	}
	if key == "" {
		http.Error(w, `{"error": "Unsplash API key not configured"}`, http.StatusBadRequest)
		return
	}

	// 调 Unsplash API（key 在 query string，符合 Unsplash 规范）
	apiURL := fmt.Sprintf(
		"https://api.unsplash.com/search/photos?query=%s&per_page=%s&page=%s&orientation=landscape&client_id=%s",
		url.QueryEscape(query),
		perPage,
		page,
		url.QueryEscape(key),
	)

	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, apiURL, nil)
	if err != nil {
		http.Error(w, "Failed to create request", http.StatusInternalServerError)
		return
	}
	// Unsplash 推荐：标识来源应用
	req.Header.Set("Accept-Version", "v1")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error": "failed to call Unsplash: %s"}`, err.Error()), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	// 重要：不透传上游的状态码。
	// 上游 Unsplash 在 key 失效时会返回 401，如果我们也回 401，
	// 前端 axios 拦截器会以为是"我们的鉴权失败"而清掉用户 token，导致用户被踢下线。
	// 所以上游出错时统一回 502 Bad Gateway，把原始错误放在 body 里。
	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadGateway)
		fmt.Fprintf(w, `{"error": "Unsplash API returned %d", "upstream": %s}`, resp.StatusCode, string(body))
		return
	}

	// 成功才透传 body
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
}
