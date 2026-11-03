// node --test tests/importer.test.js   (ต้องมี xlsx และ pdfjs-dist ใน NODE_PATH)
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const Papa = require('papaparse');
const I = require('../assets/js/admin/importer.js');

const ROOT = path.join(__dirname, '..');
const FIX = path.join(__dirname, 'fixtures');
const districts = Papa.parse(fs.readFileSync(path.join(ROOT, 'data/districts.csv'), 'utf8').trim(), { header: true }).data;
const truth = Papa.parse(fs.readFileSync(path.join(ROOT, 'data/agri_data.csv'), 'utf8').trim(), { header: true }).data;
const CROPS = ['ข้าวนาปี', 'ข้าวนาปรัง', 'ข้าวโพด รุ่น1', 'ข้าวโพด รุ่น2', 'มันสำปะหลัง', 'อ้อย', 'ปาล์มน้ำมัน', 'ยางพารา', 'กล้วยไข่'];
const ctx = (name, extra) => Object.assign({ name, districts, crops: CROPS }, extra || {});
const truthOf = (crop, year, code) => truth.find((r) => r.crop === crop && +r.year === year && r.district_code === code);

test('header field rules', () => {
  const cases = {
    'อำเภอ': 'district', 'ชื่ออำเภอ': 'district', 'ปี พ.ศ.': 'year', 'พืช ': 'crop', 'เนื้อที่เพาะปลูก (ไร่)': 'planted', 'พื้นที่ปลูก (ไร่)': 'planted',
    'เนื้อที่เก็บเกี่ยว (ไร่)': 'harvested', 'ผลผลิต (ตัน)': 'production', 'ปลูกผลผลิตต่อไร่ (กก.) ณ ความชื้น 14.5%': 'yield_planted',
    'ผลผลิตเก็บต่อไร่ (กก.) ณ ความชื้น 14.5%': 'yield_harvested', 'ผลผลิตเก็บต่อไร่ / เนื้อที่กรีด (กก.)': 'yield_harvested',
    'ผลผลิตต่อไร่ (กก.)': 'yield_harvested', 'คอลัมน์1': null, 'รหัสอำเภอ': 'district_code', 'Planted area (rai)': 'planted'
  };
  for (const [h, f] of Object.entries(cases)) assert.strictEqual(I.headerField(h), f, h);
});

test('district / crop / year / number parsing', () => {
  const m = I.districtMatcher(districts);
  for (const s of ['อ.เมือง', ' บึงสามัคคี ', 'อำเภอ คลองลาน', '6209', 'Sai Ngam', 'ขาณุวรลักษบุรี']) assert.ok(m(s), s);
  for (const s of ['รวม', 'รวมทั้งจังหวัด', '', 'จังหวัดกำแพงเพชร']) assert.strictEqual(m(s), null, s);
  assert.strictEqual(I.detectCrop('1-9 กล้อวยไข่', CROPS), 'กล้วยไข่');
  assert.strictEqual(I.detectCrop('ข้าวโพดเลี้ยงสัตว์ รุ่นที่ 2', CROPS), 'ข้าวโพด รุ่น2');
  assert.strictEqual(I.detectCrop('ข้าวโพดรุ่น1', CROPS), 'ข้าวโพด รุ่น1');
  assert.strictEqual(I.detectCrop('อ้อยโรงงาน', CROPS), 'อ้อย');
  assert.strictEqual(I.detectYear('ปีการผลิต 2566/67'), 2566);
  assert.strictEqual(I.detectYear('crop year 2024'), 2567);
  assert.deepStrictEqual(['1,234.5', '-', '', '(12)', '๑๒๓', 'abc'].map(I.parseNumber), [1234.5, 0, 0, -12, 123, NaN]);
});

test('original Excel workbook: every crop sheet parses exactly as the cells say', () => {
  const wb = XLSX.readFile(path.join(FIX, 'source-original.xlsx'));
  const sheets = wb.SheetNames.filter((n) => /^1-\d/.test(n) && !/ทุเรียน|ลำไย/.test(n));
  assert.strictEqual(sheets.length, 9);
  const report = [];
  for (const name of sheets) {
    const grid = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' });
    const t = I.extractTable(grid, ctx(name));
    assert.deepStrictEqual(t.problems, [], name);
    assert.ok(t.rows.length >= 99, name + ' rows=' + t.rows.length);
    assert.ok(t.rows.every((r) => !r.errors.length), name + ': ' + JSON.stringify(t.rows.find((r) => r.errors.length)));
    const pc = +Object.keys(t.mapping).find((c) => t.mapping[c].field === 'planted');
    for (const r of t.rows) assert.strictEqual(r.planted, Math.round(I.parseNumber(grid[r.line - 1][pc]) * 100) / 100, name + ' line ' + r.line);
    if (t.altYearCols) assert.match(t.warnings[0], /ปีเพาะปลูกคาบเกี่ยว/);
    // นับจุดที่ไม่ตรงกับฐานข้อมูล (ข้อมูลต้นฉบับไม่สอดคล้องกันระหว่างชีต) เพื่อรายงาน
    const diff = t.rows.filter((r) => { const db = truthOf(r.crop, r.year, r.district_code); return db && Math.abs(+db.planted - r.planted) > 0.01; }).length;
    report.push(`${name}: ${t.rows.length} แถว, ต่างจากฐานข้อมูล ${diff}${t.altYearCols ? ' (มีคอลัมน์ปีซ้อน)' : ''}`);
  }
  fs.writeFileSync(path.join(__dirname, 'fixtures', 'source-consistency.txt'), report.join('\n') + '\n');
});

test('combined sheet with crop + year columns', () => {
  const wb = XLSX.readFile(path.join(FIX, 'source-original.xlsx'));
  const grid = XLSX.utils.sheet_to_json(wb.Sheets['รายละเอียดรวม'], { header: 1, raw: true, defval: '' });
  const t = I.extractTable(grid, ctx('รายละเอียดรวม'));
  assert.strictEqual(t.rows.length, 693);
  assert.strictEqual(new Set(t.rows.map((r) => r.crop)).size, 7);
  assert.ok(t.rows.some((r) => r.district === 'บึงสามัคคี')); // ชื่อมีช่องว่างเกินในต้นฉบับ
});

test('CSV with different header names/order, อ. prefix, commas, total row', () => {
  const grid = Papa.parse(fs.readFileSync(path.join(FIX, 'ข้าวนาปรัง_2566_variant.csv'), 'utf8').replace(/^﻿/, '')).data;
  const t = I.extractTable(grid, ctx('ข้าวนาปรัง_2566_variant.csv'));
  assert.strictEqual(t.crop, 'ข้าวนาปรัง'); assert.strictEqual(t.year, 2566);
  assert.strictEqual(t.rows.length, 11);
  assert.ok(t.skipped.some((s) => /รวม/.test(s.text)));
  const r = t.rows.find((x) => x.district_code === '6201');
  const db = truthOf('ข้าวนาปรัง', 2566, '6201');
  assert.strictEqual(r.planted, Math.round(+db.planted));
  assert.strictEqual(r.yield_harvested, +db.yield_harvested);
  assert.deepStrictEqual(r.computed, ['yield_planted']);
});

test('Excel with 2-row merged header and crop/year only in the title', () => {
  const wb = XLSX.readFile(path.join(FIX, 'sugarcane_2row_header.xlsx'));
  const grid = XLSX.utils.sheet_to_json(wb.Sheets.Sheet1, { header: 1, raw: true, defval: '' });
  const t = I.extractTable(grid, ctx('Sheet1'));
  assert.strictEqual(t.crop, 'อ้อย'); assert.strictEqual(t.year, 2566);
  const fields = Object.values(t.mapping).map((m) => m.field).sort();
  assert.deepStrictEqual(fields, ['district', 'harvested', 'planted', 'production', 'yield_harvested', 'yield_planted']);
  assert.strictEqual(t.rows.length, 11);
  const db = truthOf('อ้อย', 2566, '6210');
  assert.ok(Math.abs(t.rows.find((x) => x.district_code === '6210').production - +db.production) < 0.01);
});

test('text PDF (Thai) → table', async () => {
  const pdfjs = await import(require.resolve('pdfjs-dist/legacy/build/pdf.mjs'));
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(path.join(FIX, 'cassava_2567.pdf'))) }).promise;
  const page = await doc.getPage(1);
  const tc = await page.getTextContent();
  const grid = I.pdfItemsToGrid(tc.items);
  const t = I.extractTable(grid, ctx('cassava_2567.pdf'));
  assert.deepStrictEqual(t.problems, [], JSON.stringify(grid.slice(0, 4)));
  assert.strictEqual(t.crop, 'มันสำปะหลัง'); assert.strictEqual(t.year, 2567);
  assert.strictEqual(t.rows.length, 11, JSON.stringify(t.skipped));
  for (const r of t.rows) {
    const db = truthOf('มันสำปะหลัง', 2567, r.district_code);
    assert.strictEqual(r.planted, Math.round(+db.planted), r.district);
    assert.strictEqual(r.production, Math.round(+db.production), r.district);
  }
});

test('combine: later tables override duplicates, error rows excluded', () => {
  const a = { rows: [{ year: 2566, crop: 'อ้อย', district_code: '6201', planted: 1, errors: [] }, { year: 2566, crop: 'อ้อย', district_code: '6202', errors: ['x'] }] };
  const b = { rows: [{ year: 2566, crop: 'อ้อย', district_code: '6201', planted: 2, errors: [] }] };
  const c = I.combine([a, b]);
  assert.strictEqual(c.rows.length, 1); assert.strictEqual(c.rows[0].planted, 2); assert.strictEqual(c.duplicates.length, 1);
});
