export type DatabaseViewType = 'table' | 'board' | 'gallery' | 'list' | 'calendar' | 'timeline';

export interface ViewColumnRule {
  property?: string;
  width?: number;
  hidden?: boolean;
  readonly?: boolean;
  align?: 'left' | 'center' | 'right';
}

export type ViewFilterOperator = 'contains' | 'not_contains' | 'equals' | 'not_equals' | 'starts_with' | 'ends_with' | 'is_empty' | 'is_not_empty';

export interface ViewFilterRule {
  id: string;
  property: string;
  op: ViewFilterOperator;
  value?: string | string[] | boolean;
}

export interface ViewSortRule {
  id: string;
  property: string;
  dir: 'asc' | 'desc';
}

export interface DatabaseViewConfig {
  id: string;
  type: DatabaseViewType;
  name: string;
  columns: ViewColumnRule[];
  filters?: ViewFilterRule[];
  sorts?: ViewSortRule[];
  groupBy?: string;
  cover?: string;
  cardSize?: 'small' | 'medium' | 'large';
  date?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
}

export function defaultView(columns: { id: string; name: string; type: string }[] = []): DatabaseViewConfig {
  return {
    id: crypto.randomUUID(),
    type: 'table',
    name: '全部',
    columns: columns.filter((c) => !['created_time', 'last_edited_time', 'last_edited_user', 'linked'].includes(c.type))
      .map((c) => ({ property: c.id, width: 150 })),
    filters: [],
    sorts: [],
    limit: 50,
  };
}

export function parseDatabaseMarkdown(markdown = ''): { views: DatabaseViewConfig[] } {
  const views: DatabaseViewConfig[] = [];
  const viewRe = /<view\s+([^>]*)>([\s\S]*?)<\/view>/g;
  let m: RegExpExecArray | null;
  while ((m = viewRe.exec(markdown)) !== null) {
    const attrs = attrsOf(m[1]);
    const body = m[2];
    if (!attrs.id || !attrs.type) continue;
    const columns: ViewColumnRule[] = [];
    const colBody = body.match(/<column>([\s\S]*?)<\/column>/)?.[1] || '';
    const ruleRe = /<rule\s+([^>]*?)\/>/g;
    let r: RegExpExecArray | null;
    while ((r = ruleRe.exec(colBody)) !== null) {
      const a = attrsOf(r[1]);
      columns.push({
        property: a.property,
        width: a.width ? Number(a.width) : undefined,
        hidden: a.hidden === 'true',
        readonly: a.readonly === 'true',
        align: normalizeColumnAlign(a.align),
      });
    }
    const filters = parseFilterRules(body);
    const sorts = parseSortRules(body);
    views.push({
      id: attrs.id,
      type: attrs.type as DatabaseViewType,
      name: attrs.name || attrs.type,
      columns,
      filters,
      sorts,
      groupBy: tagAttr(body, 'group-by', 'property'),
      cover: tagAttr(body, 'cover', 'property'),
      date: tagAttr(body, 'date', 'property'),
      startDate: tagAttr(body, 'start-date', 'property'),
      endDate: tagAttr(body, 'end-date', 'property'),
      cardSize: (tagText(body, 'card-size') as any) || 'medium',
      limit: Number(tagText(body, 'limit') || 0) || undefined,
    });
  }
  return { views };
}

export function serializeDatabaseMarkdown(views: DatabaseViewConfig[]): string {
  return views.map((v) => {
    const cols = v.columns.map((c) => {
      const attrs = [
        c.property ? `property="${esc(c.property)}"` : '',
        c.width ? `width="${c.width}"` : '',
        c.hidden ? `hidden="true"` : '',
        c.readonly ? `readonly="true"` : '',
        c.align ? `align="${esc(c.align)}"` : '',
      ].filter(Boolean).join(' ');
      return `      <rule ${attrs}/>`;
    }).join('\n');
    const filters = (v.filters || []).filter((f) => f.property).map((f) => {
      const attrs = [
        `id="${esc(f.id)}"`,
        `property="${esc(f.property)}"`,
        `op="${esc(f.op)}"`,
        f.value !== undefined ? `value="${esc(encodeRuleValue(f.value))}"` : '',
      ].filter(Boolean).join(' ');
      return `      <rule ${attrs}/>`;
    }).join('\n');
    const sorts = (v.sorts || []).filter((s) => s.property).map((s) => {
      const attrs = [
        `id="${esc(s.id)}"`,
        `property="${esc(s.property)}"`,
        `dir="${esc(s.dir)}"`,
      ].join(' ');
      return `      <rule ${attrs}/>`;
    }).join('\n');
    const extra = [
      filters ? `    <source-filter op="and">\n${filters}\n    </source-filter>` : '',
      sorts ? `    <sort>\n${sorts}\n    </sort>` : '',
      v.groupBy ? `    <group-by property="${esc(v.groupBy)}"/>` : '',
      v.cover ? `    <cover property="${esc(v.cover)}"/>` : '',
      v.cardSize ? `    <card-size>${v.cardSize}</card-size>` : '',
      v.date ? `    <date property="${esc(v.date)}"/>` : '',
      v.startDate ? `    <start-date property="${esc(v.startDate)}"/>` : '',
      v.endDate ? `    <end-date property="${esc(v.endDate)}"/>` : '',
      v.limit ? `    <limit>${v.limit}</limit>` : '',
    ].filter(Boolean).join('\n');
    return `  <view id="${esc(v.id)}" type="${esc(v.type)}" name="${esc(v.name)}">\n    <column>\n${cols}\n    </column>${extra ? `\n${extra}` : ''}\n  </view>`;
  }).join('\n\n');
}

function attrsOf(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  text.replace(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)="([^"]*)"/g, (_, k, v) => {
    out[k] = unesc(v);
    return '';
  });
  return out;
}
function tagAttr(body: string, tag: string, attr: string) {
  const m = body.match(new RegExp(`<${tag}\\s+([^>]*)\\/>`));
  return m ? attrsOf(m[1])[attr] : undefined;
}
function tagText(body: string, tag: string) {
  return body.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`))?.[1]?.trim();
}
function parseFilterRules(body: string): ViewFilterRule[] {
  const filterBody = body.match(/<source-filter(?:\s+[^>]*)?>([\s\S]*?)<\/source-filter>/)?.[1] || '';
  const rules: ViewFilterRule[] = [];
  const ruleRe = /<rule\s+([^>]*?)\/>/g;
  let r: RegExpExecArray | null;
  while ((r = ruleRe.exec(filterBody)) !== null) {
    const a = attrsOf(r[1]);
    if (!a.property) continue;
    rules.push({
      id: a.id || `filter:${a.property}:${rules.length}`,
      property: a.property,
      op: normalizeFilterOperator(a.op),
      value: decodeRuleValue(a.value),
    });
  }
  return rules;
}
function parseSortRules(body: string): ViewSortRule[] {
  const sortBody = body.match(/<sort>([\s\S]*?)<\/sort>/)?.[1] || '';
  const rules: ViewSortRule[] = [];
  const ruleRe = /<rule\s+([^>]*?)\/>/g;
  let r: RegExpExecArray | null;
  while ((r = ruleRe.exec(sortBody)) !== null) {
    const a = attrsOf(r[1]);
    if (!a.property) continue;
    rules.push({
      id: a.id || `sort:${a.property}:${rules.length}`,
      property: a.property,
      dir: a.dir === 'desc' ? 'desc' : 'asc',
    });
  }
  return rules;
}
function normalizeFilterOperator(op = ''): ViewFilterOperator {
  if (
    op === 'contains'
    || op === 'not_contains'
    || op === 'equals'
    || op === 'not_equals'
    || op === 'starts_with'
    || op === 'ends_with'
    || op === 'is_empty'
    || op === 'is_not_empty'
  ) return op;
  return 'contains';
}
function normalizeColumnAlign(align = ''): ViewColumnRule['align'] {
  if (align === 'left' || align === 'center' || align === 'right') return align;
  return undefined;
}
function encodeRuleValue(value: string | string[] | boolean) {
  return Array.isArray(value) || typeof value === 'boolean' ? JSON.stringify(value) : String(value);
}
function decodeRuleValue(value?: string): string | string[] | boolean | undefined {
  if (value === undefined) return undefined;
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value.startsWith('[')) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      return value;
    }
  }
  return value;
}
function esc(v: string) { return String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function unesc(v: string) { return String(v).replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'); }
