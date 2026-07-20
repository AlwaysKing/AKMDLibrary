package databasecsv

import (
	"encoding/csv"
	"os"
)

func Write(path string, header []string, rows []map[string]string) error {
	tmp := path + ".tmp"
	f, err := os.Create(tmp)
	if err != nil {
		return err
	}
	cleanup := true
	defer func() {
		_ = f.Close()
		if cleanup {
			_ = os.Remove(tmp)
		}
	}()

	if _, err := f.Write([]byte{0xEF, 0xBB, 0xBF}); err != nil {
		return err
	}
	w := csv.NewWriter(f)
	header = NormalizeHeader(header)
	if err := w.Write(header); err != nil {
		return err
	}
	for _, row := range rows {
		rec := make([]string, len(header))
		for i, col := range header {
			rec[i] = row[col]
		}
		if err := w.Write(rec); err != nil {
			return err
		}
	}
	w.Flush()
	if err := w.Error(); err != nil {
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	cleanup = false
	return os.Rename(tmp, path)
}
