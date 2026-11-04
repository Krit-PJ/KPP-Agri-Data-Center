// สร้างข้อมูล ศดปช. ตั้งต้นจากไฟล์ทำเนียบ (ตัดชื่อ/เบอร์ประธานออก — ไม่เผยแพร่ข้อมูลส่วนบุคคลใน repo สาธารณะ)
// ใช้: node tests/build-soil-seed.js tests/fixtures/soil-centers-2569.xlsx
'use strict';
const fs = require('fs'), path = require('path');
const XLSX = require('xlsx'), Papa = require('papaparse');
const S = require('../assets/js/admin/soil-parser.js');
const ROOT = path.join(__dirname, '..');
const geo = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/kpp_districts.json')));
const districts = Papa.parse(fs.readFileSync(path.join(ROOT, 'data/districts.csv'), 'utf8').trim(), { header: true }).data;
const wb = XLSX.readFile(process.argv[2]);
const rows = wb.SheetNames.flatMap((n) => S.parse(XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' }), { geo, districts }).rows);
const pub = rows.map(({ chair, chair_phone, line, ...r }, i) => ({ id: 'S' + String(i + 1).padStart(3, '0'), ...r }));
fs.writeFileSync(path.join(ROOT, 'data/soil_centers.json'), JSON.stringify({ source: 'ทำเนียบ ศดปช. ปี 2569 สำนักงานเกษตรจังหวัดกำแพงเพชร', rows: pub }, null, 1));
fs.writeFileSync(path.join(ROOT, 'apps-script/SoilSeed.gs'), '/** ข้อมูล ศดปช. ตั้งต้น (สร้างโดย tests/build-soil-seed.js ไม่มีข้อมูลส่วนบุคคล) */\nconst SOIL_SEED = ' + JSON.stringify(pub) + ';\n');
console.log(pub.length, 'centers; members', pub.reduce((a, r) => a + r.members, 0), '; unverified', pub.filter((r) => !r.verified).length);
