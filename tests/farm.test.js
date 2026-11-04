'use strict';
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path');
const XLSX = require('xlsx'), Papa = require('papaparse'), F = require('../assets/js/admin/farm-parser.js');
const ROOT = path.join(__dirname, '..');
const districts = Papa.parse(fs.readFileSync(path.join(ROOT, 'data/districts.csv'), 'utf8').trim(), { header: true }).data;
const grid = (f) => { const wb = XLSX.readFile(path.join(__dirname, 'fixtures', f)); return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' }); };

test('DOAE large-farm export: KPP rows only, duplicate headers resolved', () => {
  const r = F.parse(grid('farms-sample.xlsx'), { districts });
  assert.strictEqual(r.kind, 'farms');
  assert.strictEqual(r.rows.length, 6);
  assert.strictEqual(r.skipped, 1);
  const a = r.rows[0];
  assert.strictEqual(a.id, 'F85');
  assert.strictEqual(a.year_start, 2559);
  assert.strictEqual(a.district_code, '6201');
  assert.deepStrictEqual([a.members, a.plot_farmers, a.plots, a.cost_before, a.cost_after, a.yield_after], [100, 101, 158, 4427, 3850, 5112]);
  assert.strictEqual(a.chair_phone, '0812345678');
  assert.strictEqual(a.market_after, 'ต่างคนต่างขาย');
});

test('coordinate file: UTM, lat/lng, blank, unknown name', () => {
  const farms = F.parse(grid('farms-sample.xlsx'), { districts }).rows;
  const c = F.parse(grid('farm-coords-sample.xlsx'));
  assert.strictEqual(c.kind, 'coords');
  assert.strictEqual(c.rows.length, 4);
  const res = F.applyCoords(farms, c.rows);
  assert.strictEqual(res.matched, 2);
  assert.strictEqual(res.unmatched.length, 2);
  assert.ok(Math.abs(farms[0].lat - 16.52) < 0.01 && /UTM/.test(farms[0].coord_note));
  assert.deepStrictEqual([farms[1].lat, farms[1].lng], [16.5, 99.5]);
  assert.strictEqual(farms[2].lat, null);
});

test('public seeds carry no personal data', () => {
  const txt = ['data/large_farms.json', 'data/lc_centers.json', 'apps-script/FarmSeed.gs'].map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  assert.ok(!/manager|chair|"phone"|0[689]\d-?\d{3}-?\d{4}/.test(txt));
  const lc = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/lc_centers.json')));
  assert.strictEqual(lc.rows.length, 11);
  assert.strictEqual(lc.types.reduce((a, r) => a + r.count, 0), 206);
  assert.ok(lc.rows.every((r) => r.lat > 15.5 && r.lat < 17.2 && !r.coord_note));
});
