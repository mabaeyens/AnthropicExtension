'use strict';

// E06 — unit tests for chart-builder.parseChartSpec, the three-pass lenient parser
// (strict JSON → relaxJson repair → regex salvage). Fixtures include the real Ministral
// 3B failure modes (fenced block, // comments, backtick-wrapped values, measure OBJECTS,
// trailing commas) plus prose→null. No network, no DOM — qlik/jquery are stubbed.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadAmd } = require('./amd-loader');

// parseChartSpec uses none of qlik/$/config — stub them minimally.
const noopLog = { error() {}, warn() {}, info() {}, debug() {} };
const chartBuilder = loadAmd('js/chart-builder.js', {
  qlik: {},
  jquery: function () { return { on() {}, append() {} }; },
  './config': { DATA: {} },
  './log': noopLog,
});

test('parses a clean fenced qlik-chart block', () => {
  const spec = chartBuilder.parseChartSpec(
    'Here you go:\n```qlik-chart\n{"type":"barchart","title":"Sales by Region",' +
    '"dimensions":["Region"],"measures":["=Sum(Sales)"]}\n```');
  assert.equal(spec.type, 'barchart');
  assert.equal(spec.title, 'Sales by Region');
  assert.deepEqual(spec.dimensions, ['Region']);
  assert.deepEqual(spec.measures, ['=Sum(Sales)']);
});

test('parses a bare (unfenced) JSON object containing "type"', () => {
  const spec = chartBuilder.parseChartSpec(
    'prose {"type":"linechart","dimensions":["Date"],"measures":["=Sum(Amt)"]} more prose');
  assert.equal(spec.type, 'linechart');
  assert.deepEqual(spec.dimensions, ['Date']);
});

test('repairs // comments and trailing commas (relaxJson pass)', () => {
  const spec = chartBuilder.parseChartSpec(
    '```qlik-chart\n{\n  "type": "barchart", // best for categories\n' +
    '  "title": "Rev",\n  "dimensions": ["Category",],\n  "measures": ["=Sum(Rev)",]\n}\n```');
  assert.equal(spec.type, 'barchart');
  assert.deepEqual(spec.dimensions, ['Category']);
  assert.deepEqual(spec.measures, ['=Sum(Rev)']);
});

test('coerces measure OBJECTS to tokens (3B off-schema output)', () => {
  const spec = chartBuilder.parseChartSpec(
    '```qlik-chart\n{"type":"barchart","dimensions":[{"name":"Region"}],' +
    '"measures":[{"expression":"=Sum(Sales)"}]}\n```');
  assert.equal(spec.type, 'barchart');
  assert.deepEqual(spec.dimensions, ['Region']);
  assert.deepEqual(spec.measures, ['=Sum(Sales)']);
});

test('returns a title default when none is given', () => {
  const spec = chartBuilder.parseChartSpec(
    '```qlik-chart\n{"type":"kpi","measures":["=Sum(Sales)"]}\n```');
  assert.equal(spec.title, 'Suggested chart');
});

test('prose with no spec → null', () => {
  assert.equal(chartBuilder.parseChartSpec('I cannot suggest a chart for this data.'), null);
});

test('empty / non-string input → null', () => {
  assert.equal(chartBuilder.parseChartSpec(''), null);
  assert.equal(chartBuilder.parseChartSpec(null), null);
  assert.equal(chartBuilder.parseChartSpec(42), null);
});

test('a spec with neither dimensions nor measures → null', () => {
  assert.equal(chartBuilder.parseChartSpec('```qlik-chart\n{"type":"barchart"}\n```'), null);
});

test('a spec with no type → null', () => {
  assert.equal(chartBuilder.parseChartSpec('```qlik-chart\n{"dimensions":["X"],"measures":["=Sum(Y)"]}\n```'), null);
});
