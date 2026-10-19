package service

import (
	"encoding/xml"
	"testing"
	"time"
)

func TestPersonalTodoXMLRoundTrip(t *testing.T) {
	document := personalTodoDocumentXML{Todos: []personalTodoXML{
		{
			ID:         "todo-1",
			Done:       "0",
			CreatedAt:  "2026-10-18T10:00:00+08:00",
			TodayOn:    "2026-10-18",
			TodaySetAt: "2026-10-18T11:00:00+08:00",
			Text:       "Review <draft> & notes",
			Link: &personalTodoLinkXML{
				Type:       "page",
				SpaceSlug:  "demo",
				PageID:     "page-1",
				DatabaseID: "",
				RowID:      "",
			},
		},
	}}

	raw, err := xml.MarshalIndent(document, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	var decoded personalTodoDocumentXML
	if err := xml.Unmarshal(raw, &decoded); err != nil {
		t.Fatal(err)
	}
	if len(decoded.Todos) != 1 {
		t.Fatalf("expected 1 todo, got %d", len(decoded.Todos))
	}
	if decoded.Todos[0].Text != "Review <draft> & notes" {
		t.Fatalf("unexpected text: %q", decoded.Todos[0].Text)
	}
	if decoded.Todos[0].Link == nil || decoded.Todos[0].Link.PageID != "page-1" {
		t.Fatalf("link did not round-trip: %#v", decoded.Todos[0].Link)
	}
}

func TestLegacyTodoRecords(t *testing.T) {
	records := legacyTodoRecords("# 待办\n- [ ] 第一条\n- [x] 第二条")
	if len(records) != 2 {
		t.Fatalf("expected 2 todos, got %d", len(records))
	}
	if records[0].Text != "第一条" || records[0].Done != "0" {
		t.Fatalf("unexpected first todo: %#v", records[0])
	}
	if records[1].Text != "第二条" || records[1].Done != "1" {
		t.Fatalf("unexpected second todo: %#v", records[1])
	}
}

func TestTodoOverdueAndToday(t *testing.T) {
	now := time.Date(2026, 10, 18, 12, 0, 0, 0, time.Local)
	overdue := todoFromXML(personalTodoXML{
		ID:        "overdue",
		Done:      "0",
		TodayOn:   "2026-10-17",
		CreatedAt: "2026-10-17T10:00:00+08:00",
		Text:      "Overdue",
	}, now)
	today := todoFromXML(personalTodoXML{
		ID:        "today",
		Done:      "0",
		TodayOn:   "2026-10-18",
		CreatedAt: "2026-10-18T10:00:00+08:00",
		Text:      "Today",
	}, now)
	if !overdue.Overdue || overdue.IsToday {
		t.Fatalf("unexpected overdue flags: %#v", overdue)
	}
	if !today.IsToday || today.Overdue {
		t.Fatalf("unexpected today flags: %#v", today)
	}
}
