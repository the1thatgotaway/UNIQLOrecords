import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSalesQuestion, validateSalesFilters } from '../../salesQuery.ts';

test('parses sales lookups with exact IDs, spelling variations, dates, and comparisons', () => {
  assert.deepEqual(parseSalesQuestion('Retrieve sales where gross unit price is greater than 1000 and product code is UQ - HT - 02.'), [[
    { field: 'unitPrice', op: 'gt', value: '1000' },
    { field: 'sku', op: 'eq', value: 'UQ-HT-02' },
  ]]);
  assert.deepEqual(parseSalesQuestion('Show sales involving EMP - 033 and store STORE-033'), [[
    { field: 'employee', op: 'eq', value: 'EMP-033' },
    { field: 'store', op: 'eq', value: 'STORE-033' },
  ]]);
  assert.deepEqual(parseSalesQuestion('Find sales from March 2024 (2024-03) involving UQ-BAG-01 and promo_limited'), [[
    { field: 'date', op: 'gte', value: '2024-03-01' },
    { field: 'date', op: 'lte', value: '2024-03-31' },
    { field: 'sku', op: 'eq', value: 'UQ-BAG-01' },
    { field: 'promotion', op: 'eq', value: 'PROMO-LIMITED' },
  ]]);
});

test('keeps AND and OR precedence and applies conversational refinements', () => {
  const prior = parseSalesQuestion('Show sales for (UQ-LINEN-01 OR UQ-UT-01) AND price between 500 and 1500');
  assert.ok(prior);
  assert.equal(prior.length, 2);
  assert.ok(prior.every(group => group.length === 3));
  const followUp = parseSalesQuestion('And only in 2025', prior);
  assert.ok(followUp?.every(group => group.some(rule => rule.value === '2025-01-01') &&
    group.some(rule => rule.value === '500')));
  const replacement = parseSalesQuestion('Use product name "AIRism V-Neck Short Sleeve T-Shirt" instead', prior);
  assert.ok(replacement?.every(group => group.some(rule => rule.field === 'product') &&
    group.every(rule => rule.field !== 'sku')));
});

test('rejects invalid dates, incomplete filters, and unrecognized query fields', () => {
  assert.throws(() => parseSalesQuestion('Show sales on 2024-02-30'), /valid date/);
  assert.throws(() => parseSalesQuestion('Show sales where gross unit price > 1000 and'), /each side/);
  assert.throws(() => parseSalesQuestion('Show sales for UQ-HT-02 and profit above 100'), /could not read/);
  assert.throws(() => validateSalesFilters([[{ field: 'unitPrice', op: 'gt', value: '0; select 1' }]]), /Invalid/);
  assert.equal(parseSalesQuestion('How does Isolation Forest work?'), null);
});

test('treats the exam employee/store question as standalone and explicit follow-ups as refinements', () => {
  const prior = parseSalesQuestion('Show sales involving customer Benjamin Aquino and product UQ-AIR-01.');
  assert.ok(prior);
  const followUp = 'Involving employee EMP – 033 and store STORE – 033?';
  const extra = [
    { field: 'employee', op: 'eq', value: 'EMP-033' },
    { field: 'store', op: 'eq', value: 'STORE-033' },
  ];
  assert.deepEqual(parseSalesQuestion(followUp, prior), [extra]);
  assert.deepEqual(parseSalesQuestion('And ' + followUp, prior), [[...prior[0], ...extra]]);
  assert.deepEqual(parseSalesQuestion(followUp), [extra]);
});

test('accepts the exact exam wording and spaced month', () => {
  assert.deepEqual(parseSalesQuestion('Records of sales that has a gross unit price greater than 1000 and product is\n\nUQ - HT - 02?'), [[
    { field: 'unitPrice', op: 'gt', value: '1000' },
    { field: 'sku', op: 'eq', value: 'UQ-HT-02' },
  ]]);
  assert.deepEqual(parseSalesQuestion('Records of sales from 2024 - 03 and product UQ - BAG - 01 and promo_limited?'), [[
    { field: 'date', op: 'gte', value: '2024-03-01' },
    { field: 'date', op: 'lte', value: '2024-03-31' },
    { field: 'sku', op: 'eq', value: 'UQ-BAG-01' },
    { field: 'promotion', op: 'eq', value: 'PROMO-LIMITED' },
  ]]);
});
