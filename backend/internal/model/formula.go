package model

type FormulaCase struct {
	Expr     string         `json:"expr"`
	Props    map[string]any `json:"props"`
	Expected any            `json:"expected"`
	Desc     string         `json:"desc"`
}
