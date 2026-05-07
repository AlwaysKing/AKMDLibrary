package frontmatter

import (
	"bytes"
	"strings"

	"gopkg.in/yaml.v3"
)

type FrontmatterData struct {
	Icon     string `yaml:"icon,omitempty"`
	Cover    string `yaml:"cover,omitempty"`
	FullPage *bool  `yaml:"full_page,omitempty"`
}

// IsEmpty returns true if all fields are zero values.
func (fm FrontmatterData) IsEmpty() bool {
	return fm.Icon == "" && fm.Cover == "" && fm.FullPage == nil
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
