package claude

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"github.com/alwaysking/akmdlibrary/internal/repository"
)

// ToolConfig 是 site_settings 里 claude_tool_config 键的 JSON 内容。
type ToolConfig struct {
	AllowBash bool `json:"allow_bash"`
	AllowWeb  bool `json:"allow_web"`
}

// AdminConfig 是管理员后台 Claude 页面读写完整配置的载体。
type AdminConfig struct {
	SettingsJSON map[string]any `json:"settings_json"`
	SystemPrompt string         `json:"system_prompt"`
	ToolConfig   ToolConfig     `json:"tool_config"`
}

// ConfigStore 管理 data/claude/* 文件 + site_settings 中的 tool_config 键。
type ConfigStore struct {
	mu            sync.Mutex
	dataClaudeDir string // 通常 /app/data/claude
	settingsRepo  *repository.SiteSettingRepository
}

func NewConfigStore(dataDir string, repo *repository.SiteSettingRepository) *ConfigStore {
	dir := filepath.Join(dataDir, "claude")
	os.MkdirAll(dir, 0755)
	return &ConfigStore{dataClaudeDir: dir, settingsRepo: repo}
}

// EnsureDefaults 启动时调用：保证骨架文件存在。
func (s *ConfigStore) EnsureDefaults() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	sj := filepath.Join(s.dataClaudeDir, "settings.json")
	if _, err := os.Stat(sj); os.IsNotExist(err) {
		if err := os.WriteFile(sj, []byte("{\n  \"env\": {}\n}\n"), 0644); err != nil {
			return err
		}
	}
	sp := filepath.Join(s.dataClaudeDir, "system-prompt.md")
	if _, err := os.Stat(sp); os.IsNotExist(err) {
		if err := os.WriteFile(sp, []byte(""), 0644); err != nil {
			return err
		}
	}
	return nil
}

// Load 读出完整管理员配置。
func (s *ConfigStore) Load() (*AdminConfig, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	cfg := &AdminConfig{}

	// settings.json
	raw, err := os.ReadFile(filepath.Join(s.dataClaudeDir, "settings.json"))
	if err != nil {
		return nil, fmt.Errorf("read settings.json: %w", err)
	}
	var settings map[string]any
	if err := json.Unmarshal(raw, &settings); err != nil {
		return nil, fmt.Errorf("parse settings.json: %w", err)
	}
	cfg.SettingsJSON = settings

	// system prompt
	sp, err := os.ReadFile(filepath.Join(s.dataClaudeDir, "system-prompt.md"))
	if err != nil {
		return nil, fmt.Errorf("read system-prompt.md: %w", err)
	}
	cfg.SystemPrompt = string(sp)

	// tool config
	tcRaw, err := s.settingsRepo.Get("claude_tool_config")
	if err != nil {
		return nil, fmt.Errorf("load tool_config: %w", err)
	}
	if tcRaw == "" {
		cfg.ToolConfig = ToolConfig{}
	} else if err := json.Unmarshal([]byte(tcRaw), &cfg.ToolConfig); err != nil {
		return nil, fmt.Errorf("parse tool_config: %w", err)
	}
	return cfg, nil
}

// Save 写入完整管理员配置。
func (s *ConfigStore) Save(cfg *AdminConfig) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	// settings.json
	raw, err := json.MarshalIndent(cfg.SettingsJSON, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal settings.json: %w", err)
	}
	if err := os.WriteFile(filepath.Join(s.dataClaudeDir, "settings.json"), raw, 0644); err != nil {
		return fmt.Errorf("write settings.json: %w", err)
	}

	// system prompt
	if err := os.WriteFile(filepath.Join(s.dataClaudeDir, "system-prompt.md"), []byte(cfg.SystemPrompt), 0644); err != nil {
		return fmt.Errorf("write system-prompt.md: %w", err)
	}

	// tool config
	tcRaw, err := json.Marshal(cfg.ToolConfig)
	if err != nil {
		return fmt.Errorf("marshal tool_config: %w", err)
	}
	if err := s.settingsRepo.Set("claude_tool_config", string(tcRaw)); err != nil {
		return fmt.Errorf("save tool_config: %w", err)
	}
	return nil
}

// LoadToolConfig 只读 tool_config（每个 claude session 启动时用）。
func (s *ConfigStore) LoadToolConfig() ToolConfig {
	cfg, err := s.Load()
	if err != nil || cfg == nil {
		return ToolConfig{}
	}
	return cfg.ToolConfig
}

// LoadSystemPrompt 只读 system-prompt.md（每个 claude session 启动时用）。
func (s *ConfigStore) LoadSystemPrompt() string {
	raw, err := os.ReadFile(filepath.Join(s.dataClaudeDir, "system-prompt.md"))
	if err != nil {
		return ""
	}
	return string(raw)
}

// LoadSettingsEnv 读 settings.json 中的 env 字段（用于 spawn claude 时注入环境变量）。
// 如果 settings.json 整体非法或 env 缺失，返回空 map。
func (s *ConfigStore) LoadSettingsEnv() map[string]string {
	raw, err := os.ReadFile(filepath.Join(s.dataClaudeDir, "settings.json"))
	if err != nil {
		return map[string]string{}
	}
	var parsed struct {
		Env map[string]string `json:"env"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return map[string]string{}
	}
	if parsed.Env == nil {
		return map[string]string{}
	}
	return parsed.Env
}
