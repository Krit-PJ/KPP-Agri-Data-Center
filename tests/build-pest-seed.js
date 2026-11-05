// สร้างข้อมูล ศจช. ตั้งต้นจากไฟล์ทำเนียบ (ตัดชื่อประธานออก — ไม่เผยแพร่ข้อมูลส่วนบุคคลใน repo สาธารณะ)
// ใช้: node tests/build-pest-seed.js <ไฟล์ทำเนียบ ศจช.xlsx>   (ไฟล์ต้นฉบับมีข้อมูลส่วนบุคคล ห้าม commit)
'use strict';
const fs = require('fs'), path = require('path');
const XLSX = require('xlsx'), Papa = require('papaparse');
const PP = require('../assets/js/admin/pest-parser.js');
const ROOT = path.join(__dirname, '..');
const geo = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/kpp_districts.json')));
const districts = Papa.parse(fs.readFileSync(path.join(ROOT, 'data/districts.csv'), 'utf8').trim(), { header: true }).data;
const wb = XLSX.readFile(process.argv[2]);
const res = wb.SheetNames.map((n) => PP.parse(XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' }), { geo, districts }));
const rows = res.flatMap((r) => r.rows);
const pub = rows.map(({ chair, ...r }, i) => ({ ...r, id: 'P' + String(i + 1).padStart(3, '0') }));
fs.writeFileSync(path.join(ROOT, 'data/pest_centers.json'), JSON.stringify({ source: 'ทำเนียบศูนย์จัดการศัตรูพืชชุมชน (ศจช.) จังหวัดกำแพงเพชร (ระดับชั้นปี ' + (res[0].levelYear || '-') + ')', rows: pub }, null, 1));
fs.writeFileSync(path.join(ROOT, 'apps-script/PestSeed.gs'), '/** ข้อมูล ศจช. ตั้งต้น (สร้างโดย tests/build-pest-seed.js ไม่มีข้อมูลส่วนบุคคล) */\nconst PEST_SEED = ' + JSON.stringify(pub) + ';\n');
console.log(pub.length, 'centers; members', pub.reduce((a, r) => a + r.members, 0), '; with coords', pub.filter((r) => r.lat !== null).length,
  '; levels', JSON.stringify(pub.reduce((a, r) => { a[r.level] = (a[r.level] || 0) + 1; return a; }, {})));
res.forEach((r) => r.problems.forEach((p) => console.log('  ⚠️', p)));
