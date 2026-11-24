import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyQueryIntent, selectSystemKnowledge } from './systemKnowledge.ts';

test('classifyQueryIntent routes navigation and import questions accurately', () => {
  const nav = classifyQueryIntent('How do I use this system?');
  assert.equal(nav.intent, 'navigation');
  assert.ok(nav.sections.includes('navigation'));
  assert.ok(nav.sections.includes('scenarios'));

  const imp = classifyQueryIntent('How do I import sales records from Supabase?');
  assert.equal(imp.intent, 'navigation');
  assert.ok(imp.sections.includes('imports_midterm'));

  const taglish = classifyQueryIntent('Paano gamitin ang CSV export at print report?');
  assert.equal(taglish.intent, 'navigation');
  assert.ok(taglish.sections.includes('filtering_exports'));
});

test('classifyQueryIntent routes methodology and anomaly questions accurately', () => {
  const ml = classifyQueryIntent('How does Isolation Forest work?');
  assert.equal(ml.intent, 'methodology');
  assert.ok(ml.sections.includes('isolation_forest'));

  const iqr = classifyQueryIntent('How is the IQR upper fence calculated?');
  assert.equal(iqr.intent, 'methodology');
  assert.ok(iqr.sections.includes('iqr_anomalies'));

  const anomalies = classifyQueryIntent('Explain the current sales anomalies.');
  assert.equal(anomalies.intent, 'anomaly');
  assert.ok(anomalies.sections.includes('iqr_anomalies'));
});

test('classifyQueryIntent routes numerical questions and off-topic deflections', () => {
  const topProducts = classifyQueryIntent('What are the highest-performing products?');
  assert.equal(topProducts.intent, 'data');
  assert.ok(topProducts.sections.includes('metrics_caveats'));

  const offTopic = classifyQueryIntent('What is the weather forecast or basketball NBA score today?');
  assert.equal(offTopic.intent, 'off_topic');
});

test('selectSystemKnowledge embeds key formulas, thresholds, and simulated date caveats', () => {
  const mlDoc = selectSystemKnowledge('How does Isolation Forest work?');
  assert.ok(mlDoc.knowledgeText.includes('96 random isolation trees'));
  assert.ok(mlDoc.knowledgeText.includes('Q3 + 1.5'));

  const navDoc = selectSystemKnowledge('How do I import sales records?');
  assert.ok(navDoc.knowledgeText.includes('Supabase SQL Editor'));
  assert.ok(navDoc.knowledgeText.includes('source of truth'));
});
