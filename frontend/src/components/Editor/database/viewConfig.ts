export type DatabaseViewType = 'table' | 'board' | 'timeline' | 'calendar' | 'list' | 'gallery' | 'chart' | 'activity' | 'map';

export interface ViewColumnRule {
  property?: string;
  width?: number;
  hidden?: boolean;
  readonly?: boolean;
  align?: 'left' | 'center' | 'right';
}

export type ViewFilterOperator = 'contains' | 'not_contains' | 'equals' | 'not_equals' | 'starts_with' | 'ends_with' | 'is_empty' | 'is_not_empty' | 'relative_to_today' | 'before' | 'after' | 'on_or_before' | 'on_or_after' | 'between';

export interface ViewFilterRule {
  id: string;
  property: string;
  op: ViewFilterOperator;
  value?: string | string[] | boolean;
}

export type ViewAdvancedFilterNode =
  | { type: 'rule'; rule: ViewFilterRule }
  | ViewAdvancedFilterGroup;

export interface ViewAdvancedFilterGroup {
  type: 'group';
  id: string;
  op: 'and' | 'or';
  children: ViewAdvancedFilterNode[];
}

export interface ViewSortRule {
  id: string;
  property: string;
  dir: 'asc' | 'desc';
}

export type ViewGroupSort = 'manual' | 'ascending' | 'descending';
export type ViewStatusGroupMode = 'option' | 'group';
export type ViewDateGroupMode = 'relative' | 'day' | 'week' | 'month' | 'year';
export type ViewConditionalColorScope = 'cell' | 'row';
export type ViewConditionalColorSource = 'option' | 'custom';

export interface ViewConditionalColorRule {
  id: string;
  property: string;
  op: ViewFilterOperator;
  value?: string | string[] | boolean;
  scope?: ViewConditionalColorScope;
  colorSource?: ViewConditionalColorSource;
  color?: string;
}

export interface DatabaseViewConfig {
  id: string;
  type: DatabaseViewType;
  name: string;
  icon?: string;
  source?: string;
  readonly?: boolean;
  showSourceTitle?: boolean;
  showVerticalLines?: boolean;
  showPageIcon?: boolean;
  wrapContent?: boolean;
  openMode?: 'peek' | 'full' | 'center';
  columns: ViewColumnRule[];
  filters?: ViewFilterRule[];
  advancedFilter?: ViewAdvancedFilterGroup;
  sorts?: ViewSortRule[];
  conditionalColors?: ViewConditionalColorRule[];
  groupBy?: string;
  groupSort?: ViewGroupSort;
  groupStatusMode?: ViewStatusGroupMode;
  groupDateMode?: ViewDateGroupMode;
  hideEmptyGroups?: boolean;
  hiddenGroups?: string[];
  groupOrder?: string[];
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
    conditionalColors: [],
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
    const conditionalColors = parseConditionalColorRules(body);
    const advancedFilter = parseAdvancedFilter(body);
    views.push({
      id: attrs.id,
      type: attrs.type as DatabaseViewType,
      name: attrs.name || attrs.type,
      icon: attrs.icon,
      source: attrs.source || attrs.src,
      readonly: attrs.readonly === 'true',
      showSourceTitle: optionalBooleanAttr(attrs['show-source-title']),
      showVerticalLines: optionalBooleanAttr(attrs['show-vertical-lines']),
      showPageIcon: optionalBooleanAttr(attrs['show-page-icon']),
      wrapContent: optionalBooleanAttr(attrs['wrap-content']),
      openMode: normalizeOpenMode(attrs['open-mode']),
      columns,
      filters,
      advancedFilter,
      sorts,
      conditionalColors,
      ...parseGroupBy(body),
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
    const advancedFilter = normalizeAdvancedFilter(v.advancedFilter);
    const conditionalColors = (v.conditionalColors || []).filter((rule) => rule.property).map((rule, index) => normalizeConditionalColorRule(rule, index));
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
      advancedFilter ? `    <advanced-filter value="${esc(encodeAdvancedFilter(advancedFilter))}"/>` : '',
      conditionalColors.length ? `    <conditional-colors>\n${conditionalColors}\n    </conditional-colors>` : '',
      sorts ? `    <sort>\n${sorts}\n    </sort>` : '',
      v.groupBy ? `    <group-by ${[
        `property="${esc(v.groupBy)}"`,
        v.groupSort && v.groupSort !== 'manual' ? `sort="${esc(v.groupSort)}"` : '',
        v.groupStatusMode && v.groupStatusMode !== 'option' ? `status-mode="${esc(v.groupStatusMode)}"` : '',
        v.groupDateMode && v.groupDateMode !== 'relative' ? `date-mode="${esc(v.groupDateMode)}"` : '',
        v.hideEmptyGroups ? 'hide-empty="true"' : '',
        v.hiddenGroups?.length ? `hidden="${esc(v.hiddenGroups.join(','))}"` : '',
        v.groupOrder?.length ? `order="${esc(v.groupOrder.join(','))}"` : '',
      ].filter(Boolean).join(' ')}/>` : '',
      v.cover ? `    <cover property="${esc(v.cover)}"/>` : '',
      v.cardSize ? `    <card-size>${v.cardSize}</card-size>` : '',
      v.date ? `    <date property="${esc(v.date)}"/>` : '',
      v.startDate ? `    <start-date property="${esc(v.startDate)}"/>` : '',
      v.endDate ? `    <end-date property="${esc(v.endDate)}"/>` : '',
      v.limit ? `    <limit>${v.limit}</limit>` : '',
    ].filter(Boolean).join('\n');
    const viewAttrs = [
      `id="${esc(v.id)}"`,
      `type="${esc(v.type)}"`,
      `name="${esc(v.name)}"`,
      v.icon ? `icon="${esc(v.icon)}"` : '',
      v.source ? `source="${esc(v.source)}"` : '',
      v.readonly ? 'readonly="true"' : '',
      v.showSourceTitle === false ? 'show-source-title="false"' : '',
      v.showVerticalLines === false ? 'show-vertical-lines="false"' : '',
      v.showPageIcon === false ? 'show-page-icon="false"' : '',
      v.wrapContent ? 'wrap-content="true"' : '',
      v.openMode && v.openMode !== 'peek' ? `open-mode="${esc(v.openMode)}"` : '',
    ].filter(Boolean).join(' ');
    return `  <view ${viewAttrs}>\n    <column>\n${cols}\n    </column>${extra ? `\n${extra}` : ''}\n  </view>`;
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
function parseGroupBy(body: string): Pick<DatabaseViewConfig, 'groupBy' | 'groupSort' | 'groupStatusMode' | 'groupDateMode' | 'hideEmptyGroups' | 'hiddenGroups' | 'groupOrder'> {
  const attrs = body.match(/<group-by\s+([^>]*)\/>/)?.[1];
  if (!attrs) return {};
  const values = attrsOf(attrs);
  return {
    groupBy: values.property,
    groupSort: normalizeGroupSort(values.sort),
    groupStatusMode: normalizeStatusGroupMode(values['status-mode']),
    groupDateMode: normalizeDateGroupMode(values['date-mode']),
    hideEmptyGroups: optionalBooleanAttr(values['hide-empty']),
    hiddenGroups: values.hidden ? values.hidden.split(',').map((item) => item.trim()).filter(Boolean) : undefined,
    groupOrder: values.order ? values.order.split(',').map((item) => item.trim()).filter(Boolean) : undefined,
  };
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
function parseAdvancedFilter(body: string): ViewAdvancedFilterGroup | undefined {
  const attrs = body.match(/<advanced-filter\s+([^>]*?)\/>/)?.[1];
  if (!attrs) return undefined;
  const value = attrsOf(attrs).value;
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value);
    return normalizeAdvancedFilter(parsed);
  } catch {
    return undefined;
  }
}

function parseConditionalColorRules(body: string): ViewConditionalColorRule[] {
  const colorBody = body.match(/<conditional-colors>([\s\S]*?)<\/conditional-colors>/)?.[1] || '';
  const rules: ViewConditionalColorRule[] = [];
  const ruleRe = /<rule\s+([^>]*?)\/>/g;
  let r: RegExpExecArray | null;
  while ((r = ruleRe.exec(colorBody)) !== null) {
    const a = attrsOf(r[1]);
    if (!a.property) continue;
    rules.push({
      id: a.id || `conditional-color:${a.property}:${rules.length}`,
      property: a.property,
      op: normalizeFilterOperator(a.op),
      value: decodeRuleValue(a.value),
      scope: a.scope === 'row' ? 'row' : 'cell',
      colorSource: a['color-source'] === 'option' ? 'option' : 'custom',
      color: a.color || 'gray',
    });
  }
  return rules;
}

function normalizeConditionalColorRule(rule: ViewConditionalColorRule, index: number): string {
  const attrs = [
    `id="${esc(rule.id || `conditional-color:${index}`)}"`,
    `property="${esc(rule.property)}"`,
    `op="${esc(rule.op)}"`,
    rule.value !== undefined ? `value="${esc(encodeRuleValue(rule.value))}"` : '',
    `scope="${esc(rule.scope || 'cell')}"`,
    `color-source="${esc(rule.colorSource || 'custom')}"`,
    `color="${esc(rule.color || 'gray')}"`,
  ].filter(Boolean).join(' ');
  return `      <rule ${attrs}/>`;
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
    || op === 'relative_to_today'
    || op === 'before'
    || op === 'after'
    || op === 'on_or_before'
    || op === 'on_or_after'
    || op === 'between'
  ) return op;
  return 'contains';
}
function normalizeGroupSort(value = ''): ViewGroupSort | undefined {
  if (value === 'ascending' || value === 'descending') return value;
  if (value === 'manual') return 'manual';
  return undefined;
}
function normalizeStatusGroupMode(value = ''): ViewStatusGroupMode | undefined {
  if (value === 'group') return 'group';
  if (value === 'option') return 'option';
  return undefined;
}
function normalizeDateGroupMode(value = ''): ViewDateGroupMode | undefined {
  if (value === 'relative' || value === 'day' || value === 'week' || value === 'month' || value === 'year') return value;
  return undefined;
}
function normalizeColumnAlign(align = ''): ViewColumnRule['align'] {
  if (align === 'left' || align === 'center' || align === 'right') return align;
  return undefined;
}
function optionalBooleanAttr(value?: string): boolean | undefined {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}
function normalizeOpenMode(value = ''): DatabaseViewConfig['openMode'] {
  if (value === 'peek' || value === 'full' || value === 'center') return value;
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
function encodeAdvancedFilter(group: ViewAdvancedFilterGroup) {
  return JSON.stringify(group);
}
function normalizeAdvancedFilter(value: any): ViewAdvancedFilterGroup | undefined {
  if (!value || value.type !== 'group') return undefined;
  const op = value.op === 'or' ? 'or' : 'and';
  const children = Array.isArray(value.children)
    ? value.children.map(normalizeAdvancedFilterNode).filter(Boolean) as ViewAdvancedFilterNode[]
    : [];
  if (!children.length) return undefined;
  return {
    type: 'group',
    id: String(value.id || `advanced:${crypto.randomUUID()}`),
    op,
    children,
  };
}
function normalizeAdvancedFilterNode(value: any): ViewAdvancedFilterNode | undefined {
  if (!value) return undefined;
  if (value.type === 'group') return normalizeAdvancedFilter(value);
  if (value.type === 'rule' && value.rule?.property) {
    return {
      type: 'rule',
      rule: {
        id: String(value.rule.id || `filter:${value.rule.property}:${crypto.randomUUID()}`),
        property: String(value.rule.property),
        op: normalizeFilterOperator(value.rule.op),
        value: value.rule.value,
      },
    };
  }
  return undefined;
}
function esc(v: string) { return String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function unesc(v: string) { return String(v).replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'); }
