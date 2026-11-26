import type { SalesFilter, SalesFilterField, SalesFilters } from './src/types/salesLookup.ts';

const textFields = new Set(['sku', 'product', 'customer', 'employee', 'store', 'promotion']);
const numericFields = new Set(['unitPrice', 'netSales', 'quantity', 'saleId']);
const fields: Record<SalesFilterField, string> = {
  sku: 'Product code', product: 'Product name', customer: 'Customer', employee: 'Employee',
  store: 'Store', promotion: 'Promotion', unitPrice: 'Gross unit price', netSales: 'Net sales',
  quantity: 'Quantity', saleId: 'Sale ID', date: 'Sale date',
};
const operators = { eq: '=', gt: '>', gte: '≥', lt: '<', lte: '≤' } as const;
const monthNames = 'january february march april may june july august september october november december'.split(' ');
const numberToken = '(?:₱|php\\s*)?\\s*[0-9]+(?:,[0-9]{3})*(?:\\.[0-9]{1,2})?';
const dateToken = '(?:[0-9]{4}-[0-9]{2}-[0-9]{2}|[0-9]{4}-[0-9]{2}|(?:' + monthNames.join('|') + ')\\s+[0-9]{4}|[0-9]{4})';
const rangeMarker = '~';
const maxGroups = 8;
const maxConditions = 10;

function parseDay(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const date = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function validateSalesFilters(input: unknown): SalesFilters {
  if (!Array.isArray(input) || !input.length || input.length > maxGroups) throw new Error('Invalid sales filter groups.');
  return input.map(group => {
    if (!Array.isArray(group) || !group.length || group.length > maxConditions) throw new Error('Invalid sales conditions.');
    return group.map((rule: Partial<SalesFilter> | null) => {
      if (!rule || !rule.field || !Object.hasOwn(fields, rule.field) ||
          !rule.op || !Object.hasOwn(operators, rule.op) ||
          typeof rule.value !== 'string' || !rule.value.trim() || rule.value.length > 120) {
        throw new Error('Invalid sales condition.');
      }
      const { field, op, value } = rule as SalesFilter;
      if ((textFields.has(field) && op !== 'eq') ||
          (numericFields.has(field) && !/^\d{1,10}(?:\.\d{1,2})?$/.test(value)) ||
          (field === 'date' && !parseDay(value))) throw new Error('Invalid sales filter value.');
      return { field, op, value };
    });
  });
}

function dateBounds(raw: string): [string, string] {
  const month = /^([a-z]+)\s+(\d{4})$/i.exec(raw);
  const value = month
    ? month[2] + '-' + String(monthNames.indexOf(month[1].toLowerCase()) + 1).padStart(2, '0')
    : raw;
  if (value.length === 10 && parseDay(value)) return [value, value];
  if (/^\d{4}$/.test(value) && value !== '0000') return [value + '-01-01', value + '-12-31'];
  if (/^\d{4}-(?:0[1-9]|1[0-2])$/.test(value) && !value.startsWith('0000')) {
    const end = new Date(value + '-01T00:00:00Z');
    end.setUTCMonth(end.getUTCMonth() + 1, 0);
    return [value + '-01', end.toISOString().slice(0, 10)];
  }
  throw new Error('Use a valid date, month, or year, such as 2024-03-15, March 2024, or 2024.');
}

function combine(a: SalesFilters, b: SalesFilters): SalesFilters {
  if (a.length * b.length > maxGroups) throw new Error('Please split the lookup into fewer OR groups.');
  return a.flatMap(left => b.map(right => [...left, ...right]));
}

function operator(value: string): SalesFilter['op'] {
  if (/^(?:>=|≥|at least|on or after|greater than or equal to)/i.test(value)) return 'gte';
  if (/^(?:<=|≤|at most|on or before|less than or equal to)/i.test(value)) return 'lte';
  if (/^(?:>|more than|greater than|above|over|after)/i.test(value)) return 'gt';
  if (/^(?:<|less than|below|under|before)/i.test(value)) return 'lt';
  return 'eq';
}

const comparator = 'greater than or equal to|less than or equal to|on or after|on or before|at least|at most|greater than|more than|less than|equal to|above|over|below|under|before|after|>=|<=|≥|≤|>|<|=|is|of';
const numericName = 'gross unit price|unit price|gross price|net sales(?: collected)?|quantity(?: sold)?|units(?: sold)?|sales fact id|sale id|transaction id|price';
const selectNumeric = (name: string): SalesFilterField => /^net sales/i.test(name) ? 'netSales'
  : /^(?:quantity|units)/i.test(name) ? 'quantity' : /id$/i.test(name) ? 'saleId' : 'unitPrice';

function clauseFilters(clause: string, previousField?: SalesFilterField): SalesFilter[] {
  const result: SalesFilter[] = [];
  const add = (field: SalesFilterField, op: SalesFilter['op'], value: string) =>
    result.push({ field, op, value });
  let remaining = clause;
  const take = (pattern: RegExp, handler: (...matches: string[]) => void) => {
    remaining = remaining.replace(pattern, (...args: string[]) => {
      handler(...args.slice(1, -2));
      return ' ';
    });
  };
  const money = (value: string) => value.replace(/php|[₱,\s]/gi, '');
  take(new RegExp('\\b(' + numericName + ')\\s+(?:is\\s+)?between\\s+(' + numberToken + ')\\s*~\\s*(' + numberToken + ')(?![\\d.])', 'gi'), (name, lower, upper) => {
    if (+money(lower) > +money(upper)) throw new Error('The lower numeric bound must come first.');
    add(selectNumeric(name), 'gte', money(lower));
    add(selectNumeric(name), 'lte', money(upper));
  });
  take(new RegExp('\\b(?:date\\s*(?:is\\s*)?)?(?:between|from)\\s+(' + dateToken + ')\\s*(?:~|to|through|until)\\s*(' + dateToken + ')(?![\\d-])', 'gi'), (first, last) => {
    const [lower] = dateBounds(first);
    const [, upper] = dateBounds(last);
    if (lower > upper) throw new Error('The earlier date must come first.');
    add('date', 'gte', lower);
    add('date', 'lte', upper);
  });
  take(new RegExp('\\b(' + numericName + ')\\s*(?:is\\s*)?(' + comparator + ')?\\s*(' + numberToken + ')(?![\\d.-])', 'gi'), (name, op, value) =>
    add(selectNumeric(name), operator(op || ''), money(value)));
  take(new RegExp('\\b(?:sale date|transaction date|date)\\s*(?:is\\s*)?(' + comparator + '|on|in)?\\s*(' + dateToken + ')(?![\\d-])|\\b(on or after|on or before|after|before|during|from|on|in)\\s+(' + dateToken + ')(?![\\d-])', 'gi'), (op1, date1, op2, date2) => {
    const [first, last] = dateBounds(date1 || date2);
    const op = operator(op1 || op2 || '');
    if (op === 'eq' && first !== last) {
      add('date', 'gte', first);
      add('date', 'lte', last);
    } else add('date', op, op === 'gt' || op === 'lte' ? last : first);
  });
  take(/\b(?:product\s*(?:code|sku)?|sku)\s*(?:is\s*|=\s*)?["']?(uq-[a-z0-9]+-[a-z0-9]+)["']?|\b(uq-[a-z0-9]+-[a-z0-9]+)\b/gi, (sku, bareSku) =>
    add('sku', 'eq', (sku || bareSku).toUpperCase()));
  for (const [field, prefix] of [['employee', 'emp'], ['store', 'store'], ['promotion', 'promo']] as const) {
    take(new RegExp('\\b(?:' + field + '(?: (?:code|id))?\\s*(?:is\\s*|=\\s*)?)?["\']?(' + prefix + '-[a-z0-9]+)["\']?\\b', 'gi'),
      code => add(field, 'eq', code.toUpperCase()));
  }
  take(/\b(customer(?: name)?|product name)\s*(?:is\s+|=\s*)?(?:"([^"]+)"|'([^']+)'|([\p{L}][\p{L}\p{N}.'’ -]*?))(?=\s+(?:with|for|in|on|during|from|where|product|sku|employee|store|promotion|gross unit price|price|quantity|net sales|buy|bought|purchase|purchased)\b|\s*$)/giu, (name, doubleQuoted, quoted, bare) =>
    add(/^customer/i.test(name) ? 'customer' : 'product', 'eq', (doubleQuoted || quoted || bare).trim()));

  const shorthand = remaining.trim().replace(/^instead\s+|\s+instead$/gi, '');
  if (previousField && !result.length && shorthand) {
    if (numericFields.has(previousField)) {
      const match = new RegExp('^(' + comparator + ')?\\s*(' + numberToken + ')$', 'i').exec(shorthand);
      if (match) { add(previousField, operator(match[1] || ''), money(match[2])); remaining = ''; }
    }
  }
  if (!result.length && new RegExp('^' + dateToken + '$', 'i').test(shorthand)) {
    const [first, last] = dateBounds(shorthand);
    add('date', first === last ? 'eq' : 'gte', first);
    if (first !== last) add('date', 'lte', last);
    remaining = '';
  }
  // Only ignore wording that does not change which records match.
  const leftover = remaining.replace(/[,.?!"'\s]/g, ' ').replace(
    /\b(?:please|can|could|you|show|list|retrieve|find|get|give|return|display|use|me|all|a|the|sales|records|transactions|involving|for|with|where|whose|having|of|that|have|has|are|is|was|were|what|about|and|also|only|instead|same|those|which|matching|how|many|did|buy|bought|purchase|purchased)\b/gi,
    ''
  ).trim();
  if (leftover || !result.length) throw new Error('I could not read every filter. Try a product code, customer name, date, or a price condition such as “gross unit price > 1000”.');
  return result;
}

export function parseSalesQuestion(question: string, prior?: SalesFilters): SalesFilters | null {
  let input = question.normalize('NFKC').trim().replace(/\s+/g, ' ')
    .replace(/[?.!]+$/, '').replace(/[–—‑]/g, '-').replaceAll('`', '')
    .replace(/\b(\d{4})\s*-\s*(\d{2})(?:\s*-\s*(\d{2}))?\b/g, (_, year, month, day) =>
      day ? `${year}-${month}-${day}` : `${year}-${month}`)
    .replace(/\b(?:gross_unit_price|net_sales_collected|quantity_sold|sales_fact_id)\b/gi, name => name.replaceAll('_', ' '));
  const refinement = /^(?:and|also|only|what about|same|now)\b/i.test(input) || /\binstead\s*$/i.test(input);
  const addToPrevious = /^(?:and|also)\b/i.test(input) && !/\binstead\s*$/i.test(input);
  input = input.replace(/\b(uq|emp|store|promo)\s*[-_]\s*([a-z0-9]+)(?:\s*[-_]\s*([a-z0-9]+))?/gi, (_match, prefix, middle, last) =>
    [prefix, middle, last].filter(Boolean).join('-'));
  const startsLikeLookup = /\b(?:show|list|retrieve|find|get|return|display|give me|how many|any)\b.*\b(?:sales|records|transactions)\b/i.test(input);
  const queryField = /\b(?:uq-|emp-|store-|promo-|customer\s+|product name\s+|gross unit price|unit price|net sales|sale date)\b/i.test(input);
  const queryVerb = /^(?:please\s+)?(?:show|list|retrieve|find|get|return|display|give|all|sales|records|transactions|involving|with|how many|which|what (?:did|is|was|were|are|sales|transactions|records)|any)\b/i.test(input);
  const bareFilter = /^(?:uq-|emp-|store-|promo-|sku\b|customer\s+|product (?:name|code)\s+|gross unit price|unit price|net sales|sale date|(?:in|during|from|on)\s+\d)/i.test(input);
  if (!startsLikeLookup && !(queryVerb && queryField) && !bareFilter && !(refinement && prior)) return null;

  // A parenthetical ISO version of a named month is explanatory.
  input = input.replace(/([a-z]+)\s+(\d{4})\s*\((\d{4}-\d{2})\)/gi, (full, month, year, iso) =>
    year + '-' + String(monthNames.indexOf(month.toLowerCase()) + 1).padStart(2, '0') === iso ? iso : full);
  input = input.replace(/^(?:and|also|only|what about|same(?: filters)?(?: but)?|now)\s+/i, '');
  input = input.replace(/\binstead\s*$/i, '');
  input = input.replace(/^(?:(?:please|can|could|you|show|list|retrieve|find|get|give|return|display|me|all|the|sales|records|transactions|involving|for|with|where)\s+)+(?=\()/i, '');
  input = input.replace(new RegExp('\\b(between\\s+(?:' + dateToken + '|' + numberToken + '))\\s+and\\s+', 'gi'), '$1 ' + rangeMarker + ' ');
  const protectedOr = '\u0001';
  input = input.replace(/\b(?:greater than or equal to|less than or equal to|on or before|on or after)\b/gi, phrase => phrase.replace(/ or /i, protectedOr));
  const tokens = input.split(/("[^"]*"|'[^']*')/).flatMap((piece, index) => index % 2
    ? [piece]
    : piece.split(/(\(|\)|\band\b|\bor\b)/i));
  const parts: string[] = [];
  let text = '';
  for (const token of tokens) {
    if (/^(?:\(|\)|and|or)$/i.test(token)) {
      if (text.trim()) parts.push(text.trim());
      parts.push(token.toLowerCase());
      text = '';
    } else text += token;
  }
  if (text.trim()) parts.push(text.trim());
  let index = 0;
  const previousNumeric = prior?.[0].filter(rule => numericFields.has(rule.field));
  let lastField = refinement
    ? (/^(?:<=|>=|[<>=]|above|below|under|over|at least|at most)\b|^[<>=]/i.test(input) && previousNumeric?.length
      ? previousNumeric.at(-1)?.field
      : prior?.[0]?.at(-1)?.field)
    : undefined;
  const factor = (): SalesFilters => {
    const next = parts[index++];
    if (next === '(') {
      const grouped = expression();
      if (parts[index++] !== ')') throw new Error('Close the parentheses around your filters.');
      return grouped;
    }
    if (!next || /^(?:and|or|\))$/.test(next)) throw new Error('Add a filter on each side of AND or OR.');
    const rules = clauseFilters(next.replaceAll(protectedOr, ' or '), lastField);
    lastField = rules.at(-1)?.field;
    return [rules];
  };
  const conjunction = (): SalesFilters => {
    let result = factor();
    while (parts[index] === 'and') { index++; result = combine(result, factor()); }
    return result;
  };
  const expression = (): SalesFilters => {
    let result = conjunction();
    while (parts[index] === 'or') { index++; result = [...result, ...conjunction()]; }
    return result;
  };
  const parsed = expression();
  if (index !== parts.length) throw new Error('Separate your filters with AND or OR.');
  if (!refinement || !prior) return validateSalesFilters(parsed);
  if (addToPrevious) return validateSalesFilters(combine(prior, parsed));
  const result = prior.flatMap(old => parsed.map(next => {
    const changed = new Set(next.map(rule => rule.field));
    if (changed.has('sku') || changed.has('product')) {
      changed.add('sku');
      changed.add('product');
    }
    return [...old.filter(rule => !changed.has(rule.field)), ...next];
  }));
  return validateSalesFilters(result);
}

export function describeSalesFilters(filters: SalesFilters): string {
  return filters.map(group => group.map(rule =>
    `${fields[rule.field]} ${operators[rule.op]} ${rule.value}`
  ).join(' AND ')).map(group => filters.length > 1 ? `(${group})` : group).join(' OR ');
}
