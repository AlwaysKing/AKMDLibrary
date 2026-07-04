package claude

import (
	"path/filepath"
	"strings"
)

// PermissionInput 是权限判断的输入。
type PermissionInput struct {
	ToolName     string         // Read / Write / Bash / ...
	ToolInput    map[string]any // 工具参数原始 map
	UserCanWrite bool           // 用户对该 space 是否有写权限
	SpaceDir     string         // space 绝对路径（resolve 后）
	AttachDir    string         // 当前 session 附件目录（/tmp/.../session/<id>）—— Read 工具额外允许
	ToolConfig   ToolConfig     // 全局工具开关
}

// PermissionResult 是权限判断的输出。
type PermissionResult struct {
	Allowed bool
	Reason  string
	Path    string // 用于前端展示，可能为空
}

// Check 实施权限判断。
func Check(in PermissionInput) PermissionResult {
	switch in.ToolName {
	case "Bash":
		if !in.ToolConfig.AllowBash {
			return PermissionResult{Allowed: false, Reason: "Bash 工具已被全局禁用"}
		}
		return PermissionResult{Allowed: true}

	case "WebSearch", "WebFetch":
		if !in.ToolConfig.AllowWeb {
			return PermissionResult{Allowed: false, Reason: "网络工具已被全局禁用"}
		}
		return PermissionResult{Allowed: true}

	case "Read", "Glob", "Grep":
		rawPath := extractReadPath(in.ToolName, in.ToolInput)
		if rawPath == "" {
			return PermissionResult{Allowed: true} // 没有路径字段（罕见），不阻断
		}
		// Read 工具额外允许访问当前 session 的附件目录（图片/文件附件存放在这里）
		if in.AttachDir != "" && isPathInside(rawPath, in.AttachDir) {
			return PermissionResult{Allowed: true, Path: rawPath}
		}
		if !isPathInside(rawPath, in.SpaceDir) {
			return PermissionResult{Allowed: false, Reason: "路径不在当前空间范围内: " + rawPath, Path: rawPath}
		}
		return PermissionResult{Allowed: true, Path: rawPath}

	case "Write", "Edit", "MultiEdit":
		if !in.UserCanWrite {
			return PermissionResult{Allowed: false, Reason: "当前用户在该空间没有写权限"}
		}
		rawPath, _ := in.ToolInput["file_path"].(string)
		if rawPath == "" {
			return PermissionResult{Allowed: false, Reason: "缺少 file_path 参数"}
		}
		if !isPathInsideSpace(rawPath, in.SpaceDir) {
			return PermissionResult{Allowed: false, Reason: "路径不在当前空间范围内: " + rawPath, Path: rawPath}
		}
		return PermissionResult{Allowed: true, Path: rawPath}

	default:
		// TodoWrite、Task 等无副作用工具一律 allow
		return PermissionResult{Allowed: true}
	}
}

// extractReadPath 从 Read/Glob/Grep 的 input 里抽出要校验的路径字段。
func extractReadPath(toolName string, input map[string]any) string {
	if input == nil {
		return ""
	}
	// Read: file_path
	if v, ok := input["file_path"].(string); ok && v != "" {
		return v
	}
	// Glob: pattern（用 pattern 的目录部分校验）；Grep: path 或 cwd
	if v, ok := input["path"].(string); ok && v != "" {
		return v
	}
	if v, ok := input["cwd"].(string); ok && v != "" {
		return v
	}
	return ""
}

// isPathInsideSpace 判断 rawPath（可能是相对/绝对路径）解析后是否落在 spaceDir 内。
// 不跟随 symlink（symlink 可能逃逸到 space 外）。
func isPathInsideSpace(rawPath, spaceDir string) bool {
	return isPathInside(rawPath, spaceDir)
}

// isPathInside 是 isPathInsideSpace 的通用版本，把 rawPath 解析到 base 后判断是否落在 base 内。
// 如果 rawPath 是相对路径，按 base 解析（与 cwd 无关，base 一般是 SpaceDir 或 AttachDir）。
func isPathInside(rawPath, base string) bool {
	if rawPath == "" || base == "" {
		return false
	}
	abs := rawPath
	if !filepath.IsAbs(abs) {
		abs = filepath.Join(base, abs)
	}
	abs = filepath.Clean(abs)
	baseClean := filepath.Clean(base)
	if abs == baseClean {
		return true
	}
	return strings.HasPrefix(abs, baseClean+string(filepath.Separator))
}
