package claude

import "encoding/json"

// ===== stdin 消息（后端 → claude） =====

// UserMessage 是发给 claude stdin 的用户消息。
type UserMessage struct {
	Type    string          `json:"type"` // 固定 "user"
	Message json.RawMessage `json:"message"`
}

// ContentBlock 是 message.content 数组里的元素。Type 决定剩余字段。
// 我们支持 text 与 image 两种；其他类型（tool_use/tool_result）claude 自己产出，
// 后端只需要在解析时识别。
type ContentBlock struct {
	Type string `json:"type"`

	// type=text
	Text string `json:"text,omitempty"`

	// type=image：claude 的 image source 用 base64 内联
	Source *ImageSource `json:"source,omitempty"`
}

// ImageSource 是 image block 的 source 字段。
type ImageSource struct {
	Type      string `json:"type"`       // 固定 "base64"
	MediaType string `json:"media_type"` // "image/png" | "image/jpeg" | "image/gif" | "image/webp"
	Data      string `json:"data"`       // base64 编码（不含 data:image/... 前缀）
}

// NewUserMessageFromBlocks 用预拼装的 content blocks 构造 user message。
func NewUserMessageFromBlocks(blocks []ContentBlock) *UserMessage {
	body := map[string]any{
		"role":    "user",
		"content": blocks,
	}
	raw, _ := json.Marshal(body)
	return &UserMessage{Type: "user", Message: raw}
}

// NewUserMessage 兼容旧调用：单个 text block。
func NewUserMessage(text string) *UserMessage {
	return NewUserMessageFromBlocks([]ContentBlock{{Type: "text", Text: text}})
}

// ControlResponse 是回答 claude 权限请求的应答。
type ControlResponse struct {
	Type     string         `json:"type"` // 固定 "control_response"
	Response map[string]any `json:"response"`
}

// NewControlResponse 构造权限请求的应答。
//
// Claude Code 2.1.201+ 的权限响应 schema 是 union：
//
//	allow 分支：{behavior: "allow", updatedInput: <record>}   ← updatedInput 必填
//	deny  分支：{behavior: "deny",  message: <string>}        ← message 必填
//
// updatedInput 允许权限处理方在放行的同时改写工具入参（脱敏/规范化）。
// 这里采用透传策略：原样回传原始 input，等价于"放行但不修改"。
func NewControlResponse(requestID string, allowed bool, reason string, toolInput map[string]any) *ControlResponse {
	behavior := "allow"
	if !allowed {
		behavior = "deny"
	}
	inner := map[string]any{
		"behavior": behavior,
	}
	if allowed {
		// allow 分支必须带 updatedInput；若上层未提供 input，给空对象保底
		if toolInput == nil {
			toolInput = map[string]any{}
		}
		inner["updatedInput"] = toolInput
	} else {
		// deny 分支必须带 message
		inner["message"] = reason
	}
	resp := map[string]any{
		"subtype":    "success",
		"request_id": requestID,
		"response":   inner,
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

// ToolUseBlock 是 assistant 消息里 type=tool_use 的 content 元素。
// claude 决定调用工具时会产出这种块，后续会有一条 user 消息（含 tool_result）回执。
type ToolUseBlock struct {
	Type  string         `json:"type"` // "tool_use"
	ID    string         `json:"id"`   // 关联 tool_result 的 id
	Name  string         `json:"name"` // "Write" / "Edit" / "Bash" / ...
	Input map[string]any `json:"input"`
}

// ExtractToolUses 返回 assistant 消息里所有 tool_use 块。
func (m *AssistantMessage) ExtractToolUses() []ToolUseBlock {
	var out []ToolUseBlock
	for _, raw := range m.Message.Content {
		var probe struct {
			Type string `json:"type"`
		}
		if err := json.Unmarshal(raw, &probe); err != nil {
			continue
		}
		if probe.Type != "tool_use" {
			continue
		}
		var tu ToolUseBlock
		if err := json.Unmarshal(raw, &tu); err == nil {
			out = append(out, tu)
		}
	}
	return out
}

// ToolResultMessage 是 claude 在工具执行完成后回传的 user 消息。
type ToolResultMessage struct {
	Type    string `json:"type"` // "user"
	Message struct {
		Role    string            `json:"role"`
		Content []json.RawMessage `json:"content"`
	} `json:"message"`
}

// ToolResultBlock 是 user 消息里 type=tool_result 的 content 元素。
type ToolResultBlock struct {
	Type      string `json:"type"`        // "tool_result"
	ToolUseID string `json:"tool_use_id"` // 关联前面的 tool_use.id
	IsError   bool   `json:"is_error"`    // true 表示工具执行失败
}

// ExtractToolResults 返回 user 消息里所有 tool_result 块。
func (m *ToolResultMessage) ExtractToolResults() []ToolResultBlock {
	var out []ToolResultBlock
	for _, raw := range m.Message.Content {
		var probe struct {
			Type string `json:"type"`
		}
		if err := json.Unmarshal(raw, &probe); err != nil {
			continue
		}
		if probe.Type != "tool_result" {
			continue
		}
		var tr ToolResultBlock
		if err := json.Unmarshal(raw, &tr); err == nil {
			out = append(out, tr)
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

// EventToolFileChanged 通知前端：模型通过 Write/Edit/MultiEdit 改动了某个文件。
// 前端据此判断：
//   - 若 filePath 等于当前打开页面的 file_path → 重新拉文档内容
//   - 否则 → 刷新左侧目录树
//
// filePath 已构造为与 Page.file_path 完全一致的格式：spaceSlug + "/" + space内相对路径。
type EventToolFileChanged struct {
	Type     string `json:"type"`     // "tool_file_changed"
	Tool     string `json:"tool"`     // "Write" | "Edit" | "MultiEdit"
	FilePath string `json:"filePath"` // 与 Page.file_path 同格式
}

type EventError struct {
	Type    string `json:"type"` // "error"
	Message string `json:"message"`
}

// EventSessionInit 在 WS 握手成功 + session 启动后立刻发给前端。
// 前端拿到 sessionId 后才能调上传接口（附件按 session 隔离）。
type EventSessionInit struct {
	Type      string `json:"type"` // "session_init"
	SessionID string `json:"session_id"`
}

// ===== 前端协议（前端 → 后端 WS 帧） =====

// ClientMessage 是前端 WS 发来的消息。
// Context/Attachments 是可选字段（向后兼容老前端）。
type ClientMessage struct {
	Type        string             `json:"type"` // "user_message"
	Content     string             `json:"content"`
	Context     *ClientContext     `json:"context,omitempty"`
	Attachments []string           `json:"attachments,omitempty"` // attachment uuid 列表
}

// ClientContext 描述用户当前 UI 状态。
type ClientContext struct {
	ActivePageID string `json:"activePageId,omitempty"` // pages 表 id（字符串）
	Selection    string `json:"selection,omitempty"`    // 用户在编辑器选中的文本（原样透传）
}
