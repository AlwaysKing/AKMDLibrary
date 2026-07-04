package middleware

import (
	"bufio"
	"bytes"
	"errors"
	"log"
	"net"
	"net/http"
	"strings"
)

// statusRecorder wraps http.ResponseWriter to capture the status code set
// by the handler, and to tee the response body into a buffer when the
// status is a server error (5xx). The buffered body is what http.Error
// writes — typically the handler's err.Error() string — so logging it
// surfaces the root cause that would otherwise be invisible server-side.
type statusRecorder struct {
	http.ResponseWriter
	statusCode int
	body       bytes.Buffer
}

func (r *statusRecorder) WriteHeader(code int) {
	r.statusCode = code
	r.ResponseWriter.WriteHeader(code)
}

func (r *statusRecorder) Write(b []byte) (int, error) {
	// Only capture body once the handler has declared a 5xx response.
	// Successful responses skip the buffer entirely (no memory cost).
	if r.statusCode >= 500 {
		r.body.Write(b)
	}
	return r.ResponseWriter.Write(b)
}

// Hijack 转发到底层 ResponseWriter，使 WebSocket 升级能正常工作。
// 没有这个方法，coder/websocket 的 Accept 会因类型断言失败拿到 501。
func (r *statusRecorder) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	hj, ok := r.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, errors.New("ResponseWriter does not implement Hijacker")
	}
	return hj.Hijack()
}

// Flush 同样转发，确保流式响应（如 SSE）能立即发送。
func (r *statusRecorder) Flush() {
	if fl, ok := r.ResponseWriter.(http.Flusher); ok {
		fl.Flush()
	}
}

// ErrorLogging logs any 5xx response to stdout along with the response
// body (which carries the handler's err.Error() message). It is
// intentionally minimal: no structured logging, no request ID, no
// panic recovery (chi's Recoverer already handles that upstream).
//
// Wrap this around the router so every route's 500s are surfaced in
// `docker logs` instead of being silently swallowed.
func ErrorLogging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rec := &statusRecorder{
			ResponseWriter: w,
			// Default per net/http semantics: a handler that never calls
			// WriteHeader implicitly succeeds with 200.
			statusCode: http.StatusOK,
		}
		next.ServeHTTP(rec, r)
		if rec.statusCode >= 500 {
			log.Printf("[server-error] %s %s -> %d: %s",
				r.Method,
				r.URL.RequestURI(),
				rec.statusCode,
				strings.TrimSpace(rec.body.String()))
		}
	})
}
