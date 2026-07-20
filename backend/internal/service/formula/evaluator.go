package formula

import (
	"fmt"
	"math"
	"strconv"
	"strings"
)

func Eval(expr string, props map[string]any) (any, error) {
	p := parser{s: expr, props: props}
	v, err := p.parseExpr()
	if err != nil {
		return nil, err
	}
	p.skip()
	if p.i != len(p.s) {
		return nil, fmt.Errorf("unexpected token at %d", p.i)
	}
	return v, nil
}

type parser struct {
	s     string
	i     int
	props map[string]any
}

func (p *parser) parseExpr() (any, error) { return p.parseOr() }
func (p *parser) parseOr() (any, error) {
	left, err := p.parseAnd()
	if err != nil {
		return nil, err
	}
	for {
		p.skip()
		if !p.word("or") {
			return left, nil
		}
		right, err := p.parseAnd()
		if err != nil {
			return nil, err
		}
		left = truthy(left) || truthy(right)
	}
}
func (p *parser) parseAnd() (any, error) {
	left, err := p.parseCmp()
	if err != nil {
		return nil, err
	}
	for {
		p.skip()
		if !p.word("and") {
			return left, nil
		}
		right, err := p.parseCmp()
		if err != nil {
			return nil, err
		}
		left = truthy(left) && truthy(right)
	}
}
func (p *parser) parseCmp() (any, error) {
	left, err := p.parseAdd()
	if err != nil {
		return nil, err
	}
	p.skip()
	for _, op := range []string{"==", "!=", ">=", "<=", ">", "<"} {
		if strings.HasPrefix(p.s[p.i:], op) {
			p.i += len(op)
			right, err := p.parseAdd()
			if err != nil {
				return nil, err
			}
			return compare(left, right, op), nil
		}
	}
	return left, nil
}
func (p *parser) parseAdd() (any, error) {
	left, err := p.parseMul()
	if err != nil {
		return nil, err
	}
	for {
		p.skip()
		if p.i >= len(p.s) || (p.s[p.i] != '+' && p.s[p.i] != '-') {
			return left, nil
		}
		op := p.s[p.i]
		p.i++
		right, err := p.parseMul()
		if err != nil {
			return nil, err
		}
		if op == '+' {
			if _, ok := left.(string); ok {
				left = fmt.Sprint(left) + fmt.Sprint(right)
			} else if _, ok := right.(string); ok {
				left = fmt.Sprint(left) + fmt.Sprint(right)
			} else {
				left = num(left) + num(right)
			}
		} else {
			left = num(left) - num(right)
		}
	}
}
func (p *parser) parseMul() (any, error) {
	left, err := p.parseUnary()
	if err != nil {
		return nil, err
	}
	for {
		p.skip()
		if p.i >= len(p.s) || !strings.ContainsRune("*/%", rune(p.s[p.i])) {
			return left, nil
		}
		op := p.s[p.i]
		p.i++
		right, err := p.parseUnary()
		if err != nil {
			return nil, err
		}
		switch op {
		case '*':
			left = num(left) * num(right)
		case '/':
			if num(right) == 0 {
				left = nil
			} else {
				left = num(left) / num(right)
			}
		case '%':
			left = math.Mod(num(left), num(right))
		}
	}
}
func (p *parser) parseUnary() (any, error) {
	p.skip()
	if p.word("not") {
		v, err := p.parseUnary()
		return !truthy(v), err
	}
	if p.i < len(p.s) && p.s[p.i] == '-' {
		p.i++
		v, err := p.parseUnary()
		return -num(v), err
	}
	return p.parsePrimary()
}
func (p *parser) parsePrimary() (any, error) {
	p.skip()
	if p.i >= len(p.s) {
		return nil, fmt.Errorf("unexpected end")
	}
	if p.s[p.i] == '(' {
		p.i++
		v, err := p.parseExpr()
		if err != nil {
			return nil, err
		}
		p.skip()
		if p.i >= len(p.s) || p.s[p.i] != ')' {
			return nil, fmt.Errorf("missing )")
		}
		p.i++
		return v, nil
	}
	if p.s[p.i] == '"' {
		return p.parseString()
	}
	if isDigit(p.s[p.i]) {
		return p.parseNumber()
	}
	name := p.parseIdent()
	switch name {
	case "true":
		return true, nil
	case "false":
		return false, nil
	case "null":
		return nil, nil
	case "prop":
		args, err := p.parseCallArgs()
		if err != nil {
			return nil, err
		}
		if len(args) == 0 {
			return nil, nil
		}
		return p.props[fmt.Sprint(args[0])], nil
	case "length":
		args, _ := p.parseCallArgs()
		if len(args) == 0 || args[0] == nil {
			return float64(0), nil
		}
		switch v := args[0].(type) {
		case string:
			return float64(len(v)), nil
		case []any:
			return float64(len(v)), nil
		default:
			return float64(len(fmt.Sprint(v))), nil
		}
	case "concat":
		args, _ := p.parseCallArgs()
		var b strings.Builder
		for _, a := range args {
			b.WriteString(fmt.Sprint(a))
		}
		return b.String(), nil
	case "contains":
		args, _ := p.parseCallArgs()
		if len(args) < 2 {
			return false, nil
		}
		return strings.Contains(fmt.Sprint(args[0]), fmt.Sprint(args[1])), nil
	case "abs", "round", "floor", "ceil":
		args, _ := p.parseCallArgs()
		n := float64(0)
		if len(args) > 0 {
			n = num(args[0])
		}
		switch name {
		case "abs":
			return math.Abs(n), nil
		case "round":
			return math.Round(n), nil
		case "floor":
			return math.Floor(n), nil
		default:
			return math.Ceil(n), nil
		}
	case "if":
		args, _ := p.parseCallArgs()
		if len(args) < 3 {
			return nil, nil
		}
		if truthy(args[0]) {
			return args[1], nil
		}
		return args[2], nil
	case "coalesce":
		args, _ := p.parseCallArgs()
		for _, a := range args {
			if !empty(a) {
				return a, nil
			}
		}
		return nil, nil
	case "isEmpty":
		args, _ := p.parseCallArgs()
		return len(args) == 0 || empty(args[0]), nil
	default:
		return nil, fmt.Errorf("unknown identifier %q", name)
	}
}
func (p *parser) parseCallArgs() ([]any, error) {
	p.skip()
	if p.i >= len(p.s) || p.s[p.i] != '(' {
		return nil, fmt.Errorf("missing call")
	}
	p.i++
	var args []any
	for {
		p.skip()
		if p.i < len(p.s) && p.s[p.i] == ')' {
			p.i++
			return args, nil
		}
		v, err := p.parseExpr()
		if err != nil {
			return nil, err
		}
		args = append(args, v)
		p.skip()
		if p.i < len(p.s) && p.s[p.i] == ',' {
			p.i++
			continue
		}
		if p.i < len(p.s) && p.s[p.i] == ')' {
			p.i++
			return args, nil
		}
		return nil, fmt.Errorf("missing , or )")
	}
}
func (p *parser) parseString() (string, error) {
	p.i++
	var b strings.Builder
	for p.i < len(p.s) {
		c := p.s[p.i]
		p.i++
		if c == '"' {
			return b.String(), nil
		}
		if c == '\\' && p.i < len(p.s) {
			c = p.s[p.i]
			p.i++
		}
		b.WriteByte(c)
	}
	return "", fmt.Errorf("unterminated string")
}
func (p *parser) parseNumber() (float64, error) {
	start := p.i
	for p.i < len(p.s) && (isDigit(p.s[p.i]) || p.s[p.i] == '.') {
		p.i++
	}
	return strconv.ParseFloat(p.s[start:p.i], 64)
}
func (p *parser) parseIdent() string {
	start := p.i
	for p.i < len(p.s) && (isAlpha(p.s[p.i]) || isDigit(p.s[p.i]) || p.s[p.i] == '_') {
		p.i++
	}
	return p.s[start:p.i]
}
func (p *parser) skip() {
	for p.i < len(p.s) && strings.ContainsRune(" \t\r\n", rune(p.s[p.i])) {
		p.i++
	}
}
func (p *parser) word(w string) bool {
	p.skip()
	if strings.HasPrefix(p.s[p.i:], w) {
		end := p.i + len(w)
		if end == len(p.s) || !isAlpha(p.s[end]) {
			p.i = end
			return true
		}
	}
	return false
}
func isDigit(c byte) bool { return c >= '0' && c <= '9' }
func isAlpha(c byte) bool { return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') }
func num(v any) float64 {
	switch x := v.(type) {
	case nil:
		return 0
	case float64:
		return x
	case int:
		return float64(x)
	case bool:
		if x {
			return 1
		}
		return 0
	default:
		n, _ := strconv.ParseFloat(fmt.Sprint(x), 64)
		return n
	}
}
func truthy(v any) bool {
	if empty(v) {
		return false
	}
	switch x := v.(type) {
	case bool:
		return x
	case float64:
		return x != 0
	default:
		return true
	}
}
func empty(v any) bool { return v == nil || fmt.Sprint(v) == "" || fmt.Sprint(v) == "[]" }
func compare(a, b any, op string) bool {
	if op == "==" {
		return fmt.Sprint(a) == fmt.Sprint(b)
	}
	if op == "!=" {
		return fmt.Sprint(a) != fmt.Sprint(b)
	}
	an, bn := num(a), num(b)
	switch op {
	case ">":
		return an > bn
	case "<":
		return an < bn
	case ">=":
		return an >= bn
	case "<=":
		return an <= bn
	}
	return false
}
