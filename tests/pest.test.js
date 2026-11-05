'use strict';
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path');
const XLSX = require('xlsx'), Papa = require('papaparse'), PP = require('../assets/js/admin/pest-parser.js');
const ROOT = path.join(__dirname, '..');
const geo = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/kpp_districts.json')));
const districts = Papa.parse(fs.readFileSync(path.join(ROOT, 'data/districts.csv'), 'utf8').trim(), { header: true }).data;

test('ทำเนียบ ศจช.: หัว 3 แถว, แถวต่อเนื่อง, UTM, พิกัดผิด', () => {
  const wb = XLSX.readFile(path.join(__dirname, 'fixtures/pest-sample.xlsx'));
  const r = PP.parse(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' }), { geo, districts });
  assert.strictEqual(r.kind, 'pest');
  assert.strictEqual(r.levelYear, '2569');
  assert.deepStrictEqual(r.rows.map((x) => x.name), ['ศจช. บ้านหนองโดนใต้', 'ศจช. บ้านศรีวิไล', 'ศจช. บ้านทรงธรรม', 'ศจช. บ้านกระบวยทองใต้', 'ศจช. บ้านบ่อทอง', 'ศจช. บ้านหนองแม่แตง']);
  const a = r.rows[3];
  assert.deepStrictEqual([a.level, a.members, a.district_code, a.area_farm, a.area_risk], ['A', 46, '6210', true, true]);
  assert.match(a.other, /ศูนย์ข้าวชุมชน/);
  assert.strictEqual(a.bio, 'เชื้อราไตรโคเดอร์มาพร้อมใช้; เชื้อราบิวเวอเรียพร้อมใช้; เชื้อราเมตาไรเซียมพร้อมใช้');
  assert.ok(Math.abs(a.lat - 16.14) < 0.01 && Math.abs(a.lng - 99.97) < 0.01);
  assert.strictEqual(r.rows[4].bio.split('; ').length, 6);
  assert.strictEqual(r.rows[5].lat, null);
  assert.match(r.problems.join(), /หนองแม่แตง.*พิกัดไม่ถูกต้อง/);
  assert.strictEqual(r.rows[0].chair, 'นายทดสอบ ระบบ');
  assert.strictEqual(PP.shortName('ศูนย์จัดการศัตรูพืชชุมชนศูนย์จัดการศัตรูพืชชุมตำบลคณฑี'), 'ศจช. ตำบลคณฑี');
  assert.strictEqual(PP.shortName('ศูนย์จัดการศัตรูพืชชุมชนศจช.บ้านทุ่งทรายเหนือ'), 'ศจช. บ้านทุ่งทรายเหนือ');
});

test('ข้อมูล ศจช. ตั้งต้นไม่มีข้อมูลส่วนบุคคล', () => {
  const txt = fs.readFileSync(path.join(ROOT, 'data/pest_centers.json'), 'utf8') + fs.readFileSync(path.join(ROOT, 'apps-script/PestSeed.gs'), 'utf8');
  assert.ok(!/"chair|นาย|นางสาว|0[689]\d{8}/.test(txt));
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(ROOT, 'data/pest_centers.json'))).rows.length, 36);
});
