package claude

import (
	"path/filepath"
	"testing"
)

func TestIsPathInsideSpace_AbsoluteInside(t *testing.T) {
	if !isPathInsideSpace("/app/docs/demo/note.md", "/app/docs/demo") {
		t.Error("absolute path inside space should be allowed")
	}
}

func TestIsPathInsideSpace_RelativeInside(t *testing.T) {
	if !isPathInsideSpace("note.md", "/app/docs/demo") {
		t.Error("relative path inside space should be allowed")
	}
	if !isPathInsideSpace("sub/note.md", "/app/docs/demo") {
		t.Error("relative subpath inside space should be allowed")
	}
}

func TestIsPathInsideSpace_ParentEscape(t *testing.T) {
	if isPathInsideSpace("../secret/demo.md", "/app/docs/demo") {
		t.Error("parent escape should be denied")
	}
	if isPathInsideSpace("/app/docs/other/note.md", "/app/docs/demo") {
		t.Error("sibling space should be denied")
	}
}

func TestIsPathInsideSpace_EdgeCases(t *testing.T) {
	// 路径等于 spaceDir 本身（例如 Glob 根）
	if !isPathInsideSpace("/app/docs/demo", "/app/docs/demo") {
		t.Error("space dir itself should be allowed")
	}
	// 前缀匹配陷阱：/app/docs/demoX 不应被误判为 /app/docs/demo 子路径
	if isPathInsideSpace("/app/docs/demoX/note.md", "/app/docs/demo") {
		t.Error("prefix-similar path should be denied (no separator)")
	}
}

func TestCheck_ReadAllowsInsidePath(t *testing.T) {
	r := Check(PermissionInput{
		ToolName:  "Read",
		ToolInput: map[string]any{"file_path": "/app/docs/demo/note.md"},
		SpaceDir:  "/app/docs/demo",
	})
	if !r.Allowed {
		t.Errorf("expected allow, got deny: %s", r.Reason)
	}
}

func TestCheck_ReadDeniesOutsidePath(t *testing.T) {
	r := Check(PermissionInput{
		ToolName:  "Read",
		ToolInput: map[string]any{"file_path": "/etc/passwd"},
		SpaceDir:  "/app/docs/demo",
	})
	if r.Allowed {
		t.Error("expected deny for path outside space")
	}
}

func TestCheck_WriteRequiresPermission(t *testing.T) {
	// viewer 写 → 拒
	r := Check(PermissionInput{
		ToolName:     "Write",
		ToolInput:    map[string]any{"file_path": "/app/docs/demo/note.md"},
		UserCanWrite: false,
		SpaceDir:     "/app/docs/demo",
	})
	if r.Allowed {
		t.Error("viewer write should be denied")
	}
	// editor 写空间内 → 许可
	r = Check(PermissionInput{
		ToolName:     "Write",
		ToolInput:    map[string]any{"file_path": "/app/docs/demo/note.md"},
		UserCanWrite: true,
		SpaceDir:     "/app/docs/demo",
	})
	if !r.Allowed {
		t.Errorf("editor write inside space should be allowed: %s", r.Reason)
	}
}

func TestCheck_BashDefault(t *testing.T) {
	r := Check(PermissionInput{ToolName: "Bash", ToolConfig: ToolConfig{}})
	if r.Allowed {
		t.Error("Bash should be denied by default")
	}
	r = Check(PermissionInput{ToolName: "Bash", ToolConfig: ToolConfig{AllowBash: true}})
	if !r.Allowed {
		t.Error("Bash should be allowed when toggle on")
	}
}

func TestCheck_UnknownToolAllowed(t *testing.T) {
	r := Check(PermissionInput{ToolName: "TodoWrite"})
	if !r.Allowed {
		t.Error("side-effect-free tools should be allowed by default")
	}
}

func TestSpaceDirResolution(t *testing.T) {
	// 用 filepath.Join 测试相对路径解析的稳健性
	spaceDir := filepath.Clean("/app/docs/demo")
	if !isPathInsideSpace(filepath.Join(spaceDir, "a/b.md"), spaceDir) {
		t.Error("joined subpath should be inside")
	}
}

func TestCheck_ReadAllowsAttachDir(t *testing.T) {
	// AttachDir 内的文件应该允许 Read（claude 读取 session 附件）
	r := Check(PermissionInput{
		ToolName:  "Read",
		ToolInput: map[string]any{"file_path": "/tmp/akmdlibrary/session/abc/att_xxx_image.png"},
		SpaceDir:  "/app/docs/demo",
		AttachDir: "/tmp/akmdlibrary/session/abc",
	})
	if !r.Allowed {
		t.Errorf("expected attach dir access allowed, got deny: %s", r.Reason)
	}
}

func TestCheck_ReadDeniesOtherTmpPath(t *testing.T) {
	// AttachDir 外的 /tmp 路径仍应被拒绝
	r := Check(PermissionInput{
		ToolName:  "Read",
		ToolInput: map[string]any{"file_path": "/etc/passwd"},
		SpaceDir:  "/app/docs/demo",
		AttachDir: "/tmp/akmdlibrary/session/abc",
	})
	if r.Allowed {
		t.Error("path outside space & attach dir should be denied")
	}
}
