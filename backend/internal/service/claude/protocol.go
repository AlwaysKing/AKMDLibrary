package claude

import "encoding/json"

// ===== stdin 消息（后端 → claude） =====

// UserMessage 是发给 claude stdin 的用户消息。
type UserMessage struct {
	Type    string          `json:"type"` // 固定 "user"
	Message json.RawMessage `json:"message"`
}

func NewUserMessage(text string) *UserMessage {
	body := map[string]any{
		"role": "user",
		"content": []map[string]any{
			{"type": "text", "text": text},
		},
	}
	raw, _ := json.Marshal(body)
	return &UserMessage{Type: "user", Message: raw}
}

// ControlResponse 是回答 claude 权限请求的应答。
type ControlResponse struct {
	Type     string         `json:"type"` // 固定 "control_response"
	Response map[string]any `json:"response"`
}

func NewControlResponse(requestID string, allowed bool, reason string) *ControlResponse {
	behavior := "allow"
	if !allowed {
		behavior = "deny"
	}
	resp := map[string]any{
		"subtype":    "success",
		"request_id": requestID,
		"response": map[string]any{
			"behavior": behavior,
		},
	}
	if !allowed {
		resp["response"].(map[string]any)["message"] = reason
	}
	return &ControlResponse{Type: "control_response", Response: resp}
}

// ===== stdout 消息（claude → 后端） =====

// AssistantMessage 是 claude 完整生成的一条 assistant 消息。
type AssistantMessage struct {
	Type    string `json:"type"` // "assistant"
	Message struct {
		Role    string            `json:"role"`
		Content []json.RawMessage `json:"content"` // 每个元素是 {type: text|tool_use|...}
	} `json:"message"`
}

// AssistantTextBlock 是 assistant 消息里 type=text 的 content 元素。
type AssistantTextBlock struct {
	Type string `json:"type"` // "text"
	Text string `json:"text"`
}

// ExtractText 把 assistant message 的所有 text block 拼接出来。
func (m *AssistantMessage) ExtractText() string {
	var out string
	for _, raw := range m.Message.Content {
		var probe struct {
			Type string `json:"type"`
		}
		if err := json.Unmarshal(raw, &probe); err != nil {
			continue
		}
		if probe.Type != "text" {
			continue
		}
		var tb AssistantTextBlock
		if err := json.Unmarshal(raw, &tb); err == nil {
			out += tb.Text
		}
	}
	return out
}

// ControlRequest 是 claude 请求权限的工具调用。
type ControlRequest struct {
	Type      string `json:"type"` // "control_request"
	RequestID string `json:"request_id"`
	Request   struct {
		ToolName string         `json:"tool_name"`
		Input    map[string]any `json:"input"`
	} `json:"request"`
}

// ===== 前端协议（后端 → 前端 WS 帧） =====

type EventStatus struct {
	Type   string `json:"type"`   // "status"
	Status string `json:"status"` // "answering" | "idle"
}

type EventAssistantMessage struct {
	Type    string `json:"type"`    // "assistant_message"
	Content string `json:"content"`
}

type EventPermissionDenied struct {
	Type   string `json:"type"` // "permission_denied"
	Tool   string `json:"tool"`
	Path   string `json:"path,omitempty"`
	Reason string `json:"reason"`
}

type EventError struct {
	Type    string `json:"type"` // "error"
	Message string `json:"message"`
}

// ===== 前端协议（前端 → 后端 WS 帧） =====

type ClientMessage struct {
	Type    string `json:"type"` // "user_message"
	Content string `json:"content"`
}
