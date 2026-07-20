package databasecsv

import (
	"bytes"
	"encoding/csv"
	"io"
	"os"
	"strings"
)

type Table struct {
	Header []string
	Rows   []map[string]string
}

func Read(path string) (*Table, error) {
	raw, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return &Table{Header: []string{"uuid"}, Rows: []map[string]string{}}, nil
	}
	if err != nil {
		return nil, err
	}
	raw = bytes.TrimPrefix(raw, []byte{0xEF, 0xBB, 0xBF})
	r := csv.NewReader(bytes.NewReader(raw))
	r.FieldsPerRecord = -1
	records, err := r.ReadAll()
	if err == io.EOF || len(records) == 0 {
		return &Table{Header: []string{"uuid"}, Rows: []map[string]string{}}, nil
	}
	if err != nil {
		return nil, err
	}
	header := records[0]
	rows := make([]map[string]string, 0, len(records)-1)
	for _, rec := range records[1:] {
		row := make(map[string]string, len(header))
		for i, col := range header {
			if i < len(rec) {
				row[col] = rec[i]
			} else {
				row[col] = ""
			}
		}
		rows = append(rows, row)
	}
	return &Table{Header: header, Rows: rows}, nil
}

func NormalizeHeader(header []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(header))
	for _, h := range header {
		h = strings.TrimSpace(h)
		if h == "" || seen[h] {
			continue
		}
		seen[h] = true
		out = append(out, h)
	}
	if len(out) == 0 || out[0] != "uuid" {
		next := []string{"uuid"}
		for _, h := range out {
			if h != "uuid" {
				next = append(next, h)
			}
		}
		out = next
	}
	return out
}
