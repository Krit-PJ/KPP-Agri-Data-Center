'use strict';
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path');
const XLSX = require('xlsx'), Papa = require('papaparse'), S = require('../assets/js/admin/soil-parser.js');
const ROOT = path.join(__dirname, '..');
const geo = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/kpp_districts.json')));
const districts = Papa.parse(fs.readFileSync(path.join(ROOT, 'data/districts.csv'), 'utf8').trim(), { header: true }).data;

test('coordinate fixes: swapped, UTM 47N, combined cell, invalid', () => {
  assert.deepStrictEqual(S.fixCoord(16.5, 99.5), { lat: 16.5, lng: 99.5, note: '' });
  assert.strictEqual(S.fixCoord(99.5, 16.5).note, 'สลับ lat/long');
  const u = S.fixCoord(546272, 1826502);
  assert.ok(Math.abs(u.lat - 16.51996) < 1e-4 && Math.abs(u.lng - 99.43362) < 1e-4, JSON.stringify(u));
  assert.strictEqual(S.fixCoord('16.6, 99.6', '').lat, 16.6);
  assert.strictEqual(S.fixCoord('B', '').lat, null);
});

test('point in polygon finds districts', () => {
  assert.strictEqual(S.districtAt(16.4259, 99.5089, geo).name, 'เมืองกำแพงเพชร');
  assert.strictEqual(S.districtAt(16.35795, 99.840581, geo).name, 'ไทรงาม');
  assert.strictEqual(S.districtAt(13.75, 100.5, geo), null);
});

test('real ทำเนียบ ศดปช. 2569 file', () => {
  const wb = XLSX.readFile(path.join(__dirname, 'fixtures/soil-centers-2569.xlsx'));
  const r = S.parse(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' }), { geo, districts });
  assert.strictEqual(r.rows.length, 31);
  assert.strictEqual(r.rows.reduce((a, x) => a + x.members, 0), 877);
  assert.deepStrictEqual([r.rows.filter((x) => x.type === 'หลัก').length, r.rows.filter((x) => x.type === 'เครือข่าย').length], [11, 20]);
  assert.ok(r.rows.every((x) => x.lat > 15.5 && x.lat < 17.2 && x.lng > 98.8 && x.lng < 100.4 && x.district_code));
  const shifted = r.rows.find((x) => x.name === 'ศดปช. บ้านนาถัง');
  assert.deepStrictEqual([shifted.members, shifted.year_start, shifted.type, shifted.verified], [25, 2559, 'หลัก', false]);
  assert.ok(r.rows.some((x) => x.name === 'ศดปช. บ้านลำมะโกรก'), 'Thai PUA glyphs fixed in names');
  assert.strictEqual(r.rows.filter((x) => x.oss === 'ได้รับ').length, 1);
});
