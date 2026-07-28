package frontmatter

import (
	"bytes"
	"strings"

	"gopkg.in/yaml.v3"
)

type FrontmatterData struct {
	ID            string             `yaml:"id,omitempty"`
	Title         string             `yaml:"title,omitempty"`
	Type          string             `yaml:"type,omitempty"`
	DB            string             `yaml:"db,omitempty"`
	Icon          string             `yaml:"icon,omitempty"`
	Cover         string             `yaml:"cover,omitempty"`
	FullPage      *bool              `yaml:"full_page,omitempty"`
	Locked        *bool              `yaml:"locked,omitempty"`
	IconLarge     *bool              `yaml:"icon_large,omitempty"`
	CoverOffset   *int               `yaml:"cover_offset,omitempty"`
	Starred       *bool              `yaml:"starred,omitempty"`
	DatabaseTrash *DatabaseTrashData `yaml:"database_trash,omitempty"`
}

type DatabaseTrashData struct {
	Type                    string            `yaml:"type,omitempty"`
	DatabaseID              string            `yaml:"database_id,omitempty"`
	DatabaseDir             string            `yaml:"database_dir,omitempty"`
	DatabaseName            string            `yaml:"database_name,omitempty"`
	RowID                   string            `yaml:"row_id,omitempty"`
	PageExistedBeforeDelete bool              `yaml:"page_existed_before_delete"`
	RestorePageBinding      bool              `yaml:"restore_page_binding"`
	DeletedAt               string            `yaml:"deleted_at,omitempty"`
	RowValues               map[string]string `yaml:"row_values,omitempty"`
	RowDisplayValues        map[string]string `yaml:"row_display_values,omitempty"`
}

// IsEmpty returns true if all fields are zero values.
func (fm FrontmatterData) IsEmpty() bool {
	return fm.ID == "" && fm.Title == "" && fm.Type == "" && fm.DB == "" && fm.Icon == "" && fm.Cover == "" && fm.FullPage == nil && fm.Locked == nil && fm.IconLarge == nil && fm.CoverOffset == nil && fm.Starred == nil && fm.DatabaseTrash == nil
}

// Parse extracts frontmatter and body from raw markdown file bytes.
// If the file does not start with "---\n", returns empty FrontmatterData and the full content as body.
func Parse(raw []byte) (FrontmatterData, string, error) {
	var fm FrontmatterData

	// Must start with "---\n" or "---\r\n"
	if !bytes.HasPrefix(raw, []byte("---\n")) && !bytes.HasPrefix(raw, []byte("---\r\n")) {
		return fm, string(raw), nil
	}

	// Find the closing "---"
	rest := raw[4:] // skip opening "---\n"
	endIdx := bytes.Index(rest, []byte("\n---\n"))
	if endIdx == -1 {
		// Try at the very end (no trailing newline)
		if bytes.HasSuffix(rest, []byte("\n---")) {
			yamlPart := rest[:len(rest)-4] // strip "\n---"
			if err := yaml.Unmarshal(yamlPart, &fm); err != nil {
				return fm, string(raw), nil // fallback: treat entire file as body
			}
			return fm, "", nil
		}
		// No closing delimiter found — treat entire file as body
		return fm, string(raw), nil
	}

	yamlPart := rest[:endIdx]
	body := rest[endIdx+5:] // skip "\n---\n"

	if err := yaml.Unmarshal(yamlPart, &fm); err != nil {
		return fm, string(raw), nil // fallback: treat entire file as body
	}

	return fm, string(body), nil
}

// Render assembles a complete file from frontmatter and body.
// If all frontmatter fields are empty, returns only the body (no frontmatter block).
func Render(fm FrontmatterData, body string) []byte {
	if fm.IsEmpty() {
		return []byte(body)
	}

	yamlBytes, err := yaml.Marshal(&fm)
	if err != nil {
		return []byte(body) // fallback: just body
	}

	yamlStr := strings.TrimSuffix(string(yamlBytes), "\n")
	var sb strings.Builder
	sb.WriteString("---\n")
	sb.WriteString(yamlStr)
	sb.WriteString("\n---\n")
	sb.WriteString(body)
	return []byte(sb.String())
}
