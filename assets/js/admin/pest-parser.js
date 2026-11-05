// ===== ตัวอ่านทำเนียบศูนย์จัดการศัตรูพืชชุมชน (ศจช.) =====
// รูปแบบไฟล์ส่งออกจากระบบ ศจช.: หัวตาราง 3 แถว (กลุ่มหัวข้อ / ชื่อคอลัมน์ / คำต่อท้าย)
// หนึ่งศูนย์อาจกินหลายแถว: แถวต่อเนื่องมีเฉพาะ "สถานะอื่นๆ" และ "การผลิตชีวภัณฑ์"
// พิกัดเป็น UTM 47N (X, Y) → แปลงเป็น lat/lng และตรวจว่าอยู่ในอำเภอที่ระบุ
// ใช้ได้ทั้งเบราว์เซอร์ (window.PestParser) และ Node
(function (root) {
  'use strict';
  const SP = (typeof module !== 'undefined' && module.exports) ? require('./soil-parser.js') : root.SoilParser;
  const norm = SP.norm;
  const num = (v) => { const s = norm(v).replace(/[,\s]/g, ''); if (!s) return null; const n = Number(s); return isFinite(n) ? n : null; };
  const yes = (v) => /^(yes|ใช่|มี|1|true)$/i.test(norm(v));
  const LEVELS = ['A', 'B', 'C'];

  /** ชื่อศูนย์: ตัดคำนำหน้าที่ซ้ำ เช่น "ศูนย์จัดการศัตรูพืชชุมชนศูนย์จัดการศัตรูพืชชุมตำบลคณฑี" → "ศจช. ตำบลคณฑี" */
  function shortName(s) {
    let t = norm(s).replace(/\s+/g, ' ');
    for (let i = 0; i < 3; i++) t = t.replace(/^(ศูนย์จัดการศัตรูพืชชุม(ชน)?|ศจช\.?)\s*/, '');
    return 'ศจช. ' + (t || norm(s));
  }

  function findHeader(grid) {
    for (let r = 0; r < Math.min(grid.length, 15); r++) {
      const h = (grid[r] || []).map(norm);
      if (h.some((x) => /ชื่อศูนย์จัดการศัตรูพืช/.test(x)) && h.includes('X') && h.includes('Y')) return r;
    }
    return -1;
  }

  function parse(grid, ctx) {
    ctx = ctx || {};
    grid = (grid || []).map((r) => (r || []).map((v) => (v === null || v === undefined ? '' : v)));
    const hr = findHeader(grid);
    if (hr < 0) return { kind: 'unknown', rows: [], problems: ['ไม่พบหัวตาราง ศจช. (ต้องมีคอลัมน์ "ชื่อศูนย์จัดการศัตรูพืชชุมชน", X, Y)'] };
    const h = grid[hr].map(norm), top = (grid[hr - 1] || []).map(norm), sub = (grid[hr + 1] || []).map(norm);
    const at = (re, from = 0) => h.findIndex((x, i) => i >= from && re.test(x));
    const topAt = (re) => top.findIndex((x) => re.test(x));
    const subAt = (re) => sub.findIndex((x) => re.test(x));
    const C = {
      name: at(/ชื่อศูนย์จัดการศัตรูพืช/), year: at(/ปีที่จัดตั้ง/), level0: at(/^ระดับชั้น$/), members: at(/จำนวนสมาชิก/),
      moo: at(/^หมู่/), tambon: at(/^ตำบล/), district: at(/^อำเภอ/), province: at(/^จังหวัด/), x: h.indexOf('X'), y: h.indexOf('Y'),
      crop: at(/พืชหลัก/), other: at(/สถานะอื่น/), bio: at(/ชีวภัณฑ์/),
      prefix: at(/คำนำหน้า/), first: at(/^ชื่อ$/), last: at(/นามสกุล/),
      area_farm: subAt(/แปลงใหญ่/), area_risk: subAt(/การระบาด/), area_gap: subAt(/GAP/i), area_normal: subAt(/ทั่วไป/),
    };
    // ระดับชั้นตามปีงบประมาณล่าสุด: คอลัมน์ใต้หัวข้อ "ระดับชั้นตามปีงบประมาณ" (เช่น 2569)
    const lvTop = topAt(/ระดับชั้นตามปี/);
    C.level = lvTop >= 0 ? lvTop : C.level0;
    const levelYear = lvTop >= 0 ? (String(grid[hr][lvTop]).match(/25\d\d/) || [])[0] || '' : '';
    const byName = {};
    (ctx.districts || []).forEach((d) => { byName[norm(d.district).replace(/\s/g, '')] = String(d.district_code); });
    const g = (r, k) => (C[k] >= 0 ? r[C[k]] : '');
    const rows = [], problems = [];
    let cur = null;
    const addList = (key, v) => { v = norm(v); if (v && !/^(ไม่มี)?สถานะอื่น/.test(v) && !cur[key].includes(v)) cur[key].push(v); };
    for (let i = hr + 2; i < grid.length; i++) {
      const r = grid[i] || [];
      const name = norm(g(r, 'name'));
      if (/^แสดง\s*\d+\s*ถึง/.test(norm(r[0]))) break; // บรรทัดท้ายตาราง
      if (!name) { if (cur) { addList('other', g(r, 'other')); addList('bio', g(r, 'bio')); } continue; }
      const prov = norm(g(r, 'province'));
      if (prov && prov !== 'กำแพงเพชร') { cur = null; continue; }
      const dName = norm(g(r, 'district'));
      const c = SP.fixCoord(g(r, 'x'), g(r, 'y'));
      let note = c.note || '';
      const code = byName[dName.replace(/\s/g, '')] || '';
      let lat = c.lat, lng = c.lng;
      if (lat === null && (norm(g(r, 'x')) || norm(g(r, 'y')))) { note = `พิกัดไม่ถูกต้อง (X=${norm(g(r, 'x'))}, Y=${norm(g(r, 'y'))})`; problems.push(`แถว ${i + 1} ${shortName(name)}: ${note}`); }
      if (lat !== null && ctx.geo) {
        const d = SP.districtAt(lat, lng, ctx.geo);
        if (d && code && d.code !== code) { note = (note ? note + '; ' : '') + 'พิกัดตกในอำเภอ' + d.name; problems.push(`แถว ${i + 1} ${shortName(name)}: ${note}`); }
      }
      const lv = norm(g(r, 'level')).toUpperCase() || norm(g(r, 'level0')).toUpperCase();
      cur = {
        id: '', name: shortName(name), full_name: name.replace(/\s+/g, ' '), year_start: num(g(r, 'year')), level: LEVELS.includes(lv) ? lv : '', level_year: levelYear,
        members: num(g(r, 'members')) || 0, moo: norm(g(r, 'moo')), tambon: norm(g(r, 'tambon')), district: dName, district_code: code,
        lat: lat === null ? null : Math.round(lat * 1e6) / 1e6, lng: lng === null ? null : Math.round(lng * 1e6) / 1e6,
        utm_x: num(g(r, 'x')), utm_y: num(g(r, 'y')), coord_note: note, crop: norm(g(r, 'crop')),
        area_farm: yes(g(r, 'area_farm')), area_risk: yes(g(r, 'area_risk')), area_gap: yes(g(r, 'area_gap')), area_normal: yes(g(r, 'area_normal')),
        other: [], bio: [],
        chair: [norm(g(r, 'prefix')), norm(g(r, 'first')), norm(g(r, 'last'))].filter(Boolean).join(' ').replace(/^(นาย|นาง|นางสาว) /, '$1'),
      };
      addList('other', g(r, 'other')); addList('bio', g(r, 'bio'));
      rows.push(cur);
    }
    rows.forEach((o) => { o.other = o.other.join('; '); o.bio = o.bio.join('; '); });
    return { kind: 'pest', rows, problems, levelYear };
  }

  const api = { parse, shortName };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.PestParser = api;
})(typeof window !== 'undefined' ? window : globalThis);
