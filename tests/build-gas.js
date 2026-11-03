// รวมไฟล์ .gs ทั้งหมดเป็นไฟล์เดียว (apps-script/build/Code.gs) สำหรับวางใน Apps Script ครั้งเดียว
'use strict';
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, '..', 'apps-script');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.gs')).sort((a, b) => (a === 'Config.gs' ? -1 : b === 'Config.gs' ? 1 : a.localeCompare(b)));
const out = '/** KPP Agri Data Center — Apps Script (ไฟล์รวม สร้างจาก apps-script/*.gs ด้วย npm run build:gas อย่าแก้ไฟล์นี้โดยตรง) */\n\n' +
  files.map((f) => `// ===================== ${f} =====================\n` + fs.readFileSync(path.join(dir, f), 'utf8').trim() + '\n').join('\n');
fs.writeFileSync(path.join(dir, 'build', 'Code.gs'), out);
console.log('apps-script/build/Code.gs', out.length, 'chars from', files.join(', '));
