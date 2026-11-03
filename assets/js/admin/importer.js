// ===== ตัวอ่านไฟล์นำเข้า: CSV / Excel / PDF → ตาราง → จับหัวตาราง + ชื่ออำเภอ + พืช + ปี =====
// ใช้ได้ทั้งในเบราว์เซอร์ (window.Importer) และ Node (require) เพื่อทดสอบ
(function (root) {
  'use strict';
  const FIELDS = ['district', 'district_code', 'year', 'crop', 'planted', 'harvested', 'production', 'yield_planted', 'yield_harvested'];
  const NUM_FIELDS = ['planted', 'harvested', 'production', 'yield_planted', 'yield_harvested'];
  const FIELD_LABEL = {
    district: 'อำเภอ', district_code: 'รหัสอำเภอ', year: 'ปี พ.ศ.', crop: 'ชนิดพืช', planted: 'เนื้อที่เพาะปลูก (ไร่)', harvested: 'เนื้อที่เก็บเกี่ยว (ไร่)',
    production: 'ผลผลิต (ตัน)', yield_planted: 'ผลผลิตต่อไร่ ปลูก (กก.)', yield_harvested: 'ผลผลิตต่อไร่ เก็บเกี่ยว (กก.)'
  };

  // ---------- ข้อความ ----------
  // ฟอนต์ไทยใน PDF มักใช้อักขระ Private Use Area (U+F700–F71A) แทนสระ/วรรณยุกต์ที่เลื่อนตำแหน่ง → แปลงกลับเป็นอักขระมาตรฐาน
  const PUA = { 0xF700: 0x0E10, 0xF701: 0x0E34, 0xF702: 0x0E35, 0xF703: 0x0E36, 0xF704: 0x0E37, 0xF705: 0x0E48, 0xF706: 0x0E49, 0xF707: 0x0E4A,
    0xF708: 0x0E4B, 0xF709: 0x0E4C, 0xF70A: 0x0E48, 0xF70B: 0x0E49, 0xF70C: 0x0E4A, 0xF70D: 0x0E4B, 0xF70E: 0x0E4C, 0xF70F: 0x0E0D, 0xF710: 0x0E31,
    0xF711: 0x0E4D, 0xF712: 0x0E47, 0xF713: 0x0E48, 0xF714: 0x0E49, 0xF715: 0x0E4A, 0xF716: 0x0E4B, 0xF717: 0x0E4C, 0xF718: 0x0E38, 0xF719: 0x0E39, 0xF71A: 0x0E3A };
  // ำ ที่ PDF แยกเป็น ํ + า (U+0E4D U+0E32) → รวมกลับเป็น ำ (U+0E33); ตัด zero-width; NBSP → space
  const norm = (s) => String(s === null || s === undefined ? '' : s).replace(/[\uF700-\uF71A]/g, (c) => String.fromCharCode(PUA[c.charCodeAt(0)])).replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\u0E4D\u0E32/g, '\u0E33').replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
  const squash = (s) => norm(s).replace(/\s+/g, '').toLowerCase();
  // pdf.js มักแยกสระ/วรรณยุกต์ออกจากพยัญชนะ: ตัดอักขระกำกับออกเมื่อเปรียบเทียบ
  const skeleton = (s) => squash(s).replace(/[ัิ-ฺ็-๎]/g, '');

  // ---------- หัวตาราง ----------
  const RULES = [
    ['district_code', /รหัส|code/i],
    ['district', /อำเภอ|district|อ\.$/i],
    ['year', /^ปี(\s|$|\(|เพาะ|การ|ที่)|พ\.\s*ศ|ปีเพาะปลูก|ปีการผลิต|^year/i],
    ['crop', /พืช|crop|ชนิด|สินค้า/i],
    ['yield_harvested', /((ต่อ|\/)\s*ไร่|yield).*(เก็บ|harvest|กรีด)|(เก็บ|harvest).*((ต่อ|\/)\s*ไร่|yield)/i],
    ['yield_planted', /((ต่อ|\/)\s*ไร่|yield).*(ปลูก|plant)|(ปลูก|plant).*((ต่อ|\/)\s*ไร่|yield)/i],
    ['yield_harvested', /(ต่อ|\/)\s*ไร่|yield/i],
    ['harvested', /เก็บเกี่ยว|เก็บได้|harvest|กรีด|ให้ผล/i],
    ['planted', /เพาะปลูก|ปลูก|planted|ยืนต้น|area/i],
    ['production', /ผลผลิต|production|output|ปริมาณ/i],
  ];
  // PDF มักทำวรรณยุกต์หาย (ไร่ → ไร) จึงเทียบแบบตัดสระบน/ล่างและวรรณยุกต์ออกด้วย
  const MARKS = /[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/g;
  const SK_RULES = RULES.map(([f, re]) => [f, new RegExp(re.source.replace(MARKS, ''), re.flags)]);
  function headerField(text) {
    const t = norm(text);
    if (!t) return null;
    const sk = t.replace(MARKS, '');
    for (let i = 0; i < RULES.length; i++) if (RULES[i][1].test(t) || SK_RULES[i][1].test(sk)) return RULES[i][0];
    return null;
  }
  // หน่วย: ผลผลิตเป็น กก. → หาร 1000 ให้เป็นตัน; เนื้อที่เป็น งาน/ตร.ม. ไม่รองรับ (เตือน)
  function unitFactor(field, text) {
    const t = norm(text);
    if (field === 'production' && /(กก|กิโลกรัม|kg)/i.test(t) && !/(ต่อ|\/)\s*ไร่/.test(t)) return 0.001;
    return 1;
  }

  // ---------- อำเภอ / พืช / ปี ----------
  function districtMatcher(districts) {
    const list = districts.map((d) => ({ code: String(d.district_code), name: d.district, sq: squash(d.district), sk: skeleton(d.district),
      en: squash(d.district_en || '') }));
    return function (cell) {
      const raw = norm(cell);
      if (!raw) return null;
      const m = raw.match(/\b(6[0-9]{3})\b/);
      if (m) { const d = list.find((x) => x.code === m[1]); if (d) return d; }
      let s = squash(raw).replace(/^(กิ่งอำเภอ|กิ่งอ\.|อำเภอ|อ\.)/, '').replace(/[0-9.()]/g, '');
      if (!s || /^(รวม|ทั้งหมด|จังหวัด|total)/.test(s)) return null;
      let d = list.find((x) => x.sq === s) || list.find((x) => x.en && x.en === s.replace(/[^a-z]/g, ''));
      if (d) return d;
      const sk = skeleton(s);
      d = list.find((x) => x.sk === sk);
      if (d) return d;
      // "เมือง" / "เมืองฯ" → เมืองกำแพงเพชร, หรือมีชื่ออำเภออยู่ในข้อความ
      if (/^เมือง/.test(s)) return list.find((x) => x.sq.startsWith('เมือง')) || null;
      const cands = list.filter((x) => s.includes(x.sq) || (sk.length >= 4 && x.sk.includes(sk)));
      return cands.length === 1 ? cands[0] : null;
    };
  }

  const CROP_SYNONYMS = [
    [/นาปรัง|ข้าวนาปรัง|off.?season/i, 'ข้าวนาปรัง'],
    [/นาปี|ข้าวนาปี|main.?season/i, 'ข้าวนาปี'],
    [/ข้าวโพด.*(รุ่น|ครั้ง)\s*(ที่)?\s*(2|๒)|corn.*2/i, 'ข้าวโพด รุ่น2'],
    [/ข้าวโพด.*(รุ่น|ครั้ง)\s*(ที่)?\s*(1|๑)|corn.*1|ข้าวโพด/i, 'ข้าวโพด รุ่น1'],
    [/มันสำปะหลัง|มันสําปะหลัง|cassava/i, 'มันสำปะหลัง'],
    [/อ้อย|sugar.?cane/i, 'อ้อย'],
    [/ปาล์ม|palm/i, 'ปาล์มน้ำมัน'],
    [/ยางพารา|ยาง|rubber/i, 'ยางพารา'],
    [/กล้วยไข่|กล้อวยไข่|กล้วย|banana/i, 'กล้วยไข่'],
  ];
  function detectCrop(text, crops) {
    const t = norm(text);
    if (!t) return null;
    const exact = (crops || []).find((c) => squash(c) === squash(t));
    if (exact) return exact;
    for (const [re, c] of CROP_SYNONYMS) if (re.test(t) || re.test(squash(t))) return c;
    const sk = t.replace(/[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/g, '');
    for (const [re, c] of CROP_SYNONYMS) if (new RegExp(re.source.replace(/[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/g, ''), re.flags).test(sk)) return c;
    return null;
  }
  function detectYear(text) {
    const t = norm(text);
    let m = t.match(/(?:^|\D)(25[4-9]\d)(?:\D|$)/);
    if (m) return +m[1];
    m = t.match(/(?:^|\D)(19[89]\d|20[0-4]\d)(?:\D|$)/);
    if (m) return +m[1] + 543;
    m = t.match(/(?:ปี|พ\.?ศ\.?)\s*(\d{2})(?:\D|$)/);
    if (m) return 2500 + +m[1];
    return null;
  }

  function parseNumber(v) {
    if (typeof v === 'number') return isFinite(v) ? v : NaN;
    let s = norm(v);
    if (!s || /^[-–—.]+$/.test(s) || /^(n\/?a|ไม่มี)$/i.test(s)) return 0;
    s = s.replace(/[๐-๙]/g, (d) => '๐๑๒๓๔๕๖๗๘๙'.indexOf(d));
    const neg = /^\(.*\)$/.test(s);
    s = s.replace(/[,\s()]/g, '').replace(/[^\d.\-]/g, '');
    if (!s || s === '.' || s === '-') return NaN;
    const n = Number(s);
    return isFinite(n) ? (neg ? -n : n) : NaN;
  }

  // ---------- หาแถวหัวตาราง ----------
  function headerCandidates(grid, r) {
    const row = grid[r] || [], above = grid[r - 1] || [];
    const width = Math.max(row.length, above.length);
    const single = [], combined = [];
    let carry = '';
    for (let c = 0; c < width; c++) {
      const a = norm(above[c]);
      if (a) carry = a; else if (c === 0) carry = '';
      single.push(norm(row[c]));
      combined.push(norm((a || (norm(row[c]) ? carry : '')) + ' ' + norm(row[c])));
    }
    return [single, combined];
  }
  function mapHeader(cells) {
    const map = {}, used = new Set();
    cells.forEach((h, c) => {
      const f = headerField(h);
      if (f && !used.has(f)) { map[c] = { field: f, factor: unitFactor(f, h), header: h }; used.add(f); }
    });
    return { map, used };
  }
  function scoreMap(used) {
    if (!used.has('district') && !used.has('district_code')) return 0;
    const nums = NUM_FIELDS.filter((f) => used.has(f)).length;
    return nums ? nums * 2 + used.size : 0;
  }
  function detectHeader(grid, limit) {
    let best = null;
    for (let r = 0; r < Math.min(grid.length, limit || 30); r++) {
      headerCandidates(grid, r).forEach((cells, variant) => {
        const { map, used } = mapHeader(cells);
        const s = scoreMap(used);
        if (s && (!best || s > best.score)) best = { row: r, map, score: s, cells, variant: variant ? 'สองแถว' : 'แถวเดียว' };
      });
    }
    return best;
  }

  // ---------- แปลงตารางหนึ่งตาราง ----------
  /**
   * @param grid   array ของแถว (array ของเซลล์)
   * @param ctx    { name, districts, crops, crop?, year?, mapping? }
   * @returns { name, headerRow, mapping, columns, crop, year, rows, skipped, problems }
   */
  function extractTable(grid, ctx) {
    grid = (grid || []).map((r) => (r || []).map((v) => (v === null || v === undefined ? '' : v)));
    const det = ctx.mapping ? { row: ctx.headerRow || 0, map: ctx.mapping } : detectHeader(grid);
    const out = { name: ctx.name || '', headerRow: det ? det.row : -1, mapping: det ? det.map : {}, columns: [], rows: [], skipped: [], problems: [] };
    if (!det) { out.problems.push('ไม่พบหัวตารางที่มีคอลัมน์อำเภอและตัวเลข'); return out; }
    const width = Math.max(...grid.slice(det.row, det.row + 30).map((r) => r.length), 0);
    const hcells = det.cells || (ctx.mapping ? (Object.values(det.map).some((m) => /\s/.test(m.header || '')) ? headerCandidates(grid, det.row)[1] : headerCandidates(grid, det.row)[0]) : []);
    out.columns = Array.from({ length: width }, (_, c) => ({ index: c, header: hcells[c] || norm((grid[det.row] || [])[c]) || ('คอลัมน์ ' + (c + 1)) }));
    const fieldCol = {};
    Object.entries(det.map).forEach(([c, m]) => { fieldCol[m.field] = +c; });

    // ปี/พืชระดับตาราง: จากผู้ใช้ → ชื่อชีต/ไฟล์ → ข้อความเหนือหัวตาราง
    const titleText = [ctx.name || ''].concat(grid.slice(0, det.row).map((r) => r.map(norm).join(' '))).join(' ');
    out.year = ctx.year || (fieldCol.year === undefined ? detectYear(titleText) : null);
    out.crop = ctx.crop || (fieldCol.crop === undefined ? detectCrop(titleText, ctx.crops) : null);
    if (fieldCol.year === undefined && !out.year) out.problems.push('ไม่พบปี พ.ศ. กรุณาเลือกปี');
    if (fieldCol.crop === undefined && !out.crop) out.problems.push('ไม่พบชนิดพืช กรุณาเลือกพืช');
    if (fieldCol.district === undefined && fieldCol.district_code === undefined) out.problems.push('ไม่พบคอลัมน์อำเภอ');

    // คอลัมน์ปีซ้อน (เช่น "ปี พ.ศ." 2558 กับ "คอลัมน์1" 2559 = ปีเพาะปลูกคาบเกี่ยว) → เตือนให้ผู้ใช้เลือก
    out.warnings = [];
    const body = grid.slice(det.row + 1).filter((r) => r.some((v) => norm(v)));
    for (let c = 0; c < width; c++) {
      if (det.map[c]) continue;
      const vals = body.map((r) => norm(r[c])).filter(Boolean);
      if (vals.length >= 3 && vals.filter((v) => /^25[4-9]\d$/.test(v)).length / vals.length >= 0.8) {
        out.altYearCols = (out.altYearCols || []).concat(c);
        const yc = fieldCol.year !== undefined ? norm(body[0][fieldCol.year]) : out.year;
        out.warnings.push(`พบคอลัมน์ "${out.columns[c].header}" ที่เป็นปี พ.ศ. ด้วย (แถวแรก ${norm(body[0][c])} คู่กับปีที่ใช้อยู่ ${yc}) ` +
          'อาจเป็นปีเพาะปลูกคาบเกี่ยว กรุณาตรวจสอบว่าต้องใช้ปีจากคอลัมน์ใด แล้วแก้การจับคู่คอลัมน์');
      }
    }

    const matchD = districtMatcher(ctx.districts);
    for (let r = det.row + 1; r < grid.length; r++) {
      const row = grid[r];
      if (!row.some((v) => norm(v))) continue;
      const dCell = fieldCol.district_code !== undefined ? row[fieldCol.district_code] : row[fieldCol.district];
      const d = matchD(dCell) || (fieldCol.district !== undefined ? matchD(row[fieldCol.district]) : null);
      if (!d) { if (out.skipped.length < 50) out.skipped.push({ line: r + 1, text: row.map(norm).filter(Boolean).slice(0, 4).join(' | ') }); continue; }
      // แถวหัวตารางซ้ำ (เช่น PDF หลายหน้า)
      if (headerField(row[fieldCol.planted]) || headerField(row[fieldCol.production])) continue;
      const rec = { district_code: d.code, district: d.name, line: r + 1, errors: [], computed: [] };
      rec.year = fieldCol.year !== undefined ? detectYear(row[fieldCol.year]) : out.year;
      rec.crop = fieldCol.crop !== undefined ? (detectCrop(row[fieldCol.crop], ctx.crops) || norm(row[fieldCol.crop])) : out.crop;
      NUM_FIELDS.forEach((f) => {
        if (fieldCol[f] === undefined) { rec[f] = null; return; }
        const n = parseNumber(row[fieldCol[f]]);
        if (isNaN(n)) { rec.errors.push(FIELD_LABEL[f] + ' ไม่ใช่ตัวเลข: "' + norm(row[fieldCol[f]]) + '"'); rec[f] = 0; }
        else if (n < 0) { rec.errors.push(FIELD_LABEL[f] + ' ติดลบ'); rec[f] = n; }
        else rec[f] = Math.round(n * det.map[fieldCol[f]].factor * 100) / 100;
      });
      if (rec.planted === null && rec.harvested === null && rec.production === null) { rec.errors.push('ไม่มีค่าเนื้อที่หรือผลผลิต'); }
      ['planted', 'harvested', 'production'].forEach((f) => { if (rec[f] === null) rec[f] = 0; });
      if (rec.yield_harvested === null) { rec.yield_harvested = rec.harvested ? Math.round(rec.production / rec.harvested * 1000) : 0; if (rec.harvested) rec.computed.push('yield_harvested'); }
      if (rec.yield_planted === null) { rec.yield_planted = rec.planted ? Math.round(rec.production / rec.planted * 1000) : 0; if (rec.planted) rec.computed.push('yield_planted'); }
      if (!rec.year) rec.errors.push('ไม่มีปี');
      if (!rec.crop) rec.errors.push('ไม่มีชนิดพืช');
      if (rec.harvested > rec.planted * 1.05 && rec.planted > 0) rec.warn = 'เนื้อที่เก็บเกี่ยวมากกว่าเนื้อที่ปลูก';
      out.rows.push(rec);
    }
    if (!out.rows.length) out.problems.push('ไม่พบแถวข้อมูลที่ตรงกับชื่ออำเภอ');
    return out;
  }

  /** ใส่ปี/พืชระดับตารางใหม่ (เมื่อผู้ใช้เลือกเอง) โดยไม่ต้องอ่านไฟล์ซ้ำ */
  function reextract(table, grid, ctx) {
    return extractTable(grid, Object.assign({}, ctx, { mapping: table.mapping, headerRow: table.headerRow }));
  }

  /** รวมหลายตาราง + ตรวจคีย์ซ้ำ (ปี|พืช|อำเภอ) ตารางหลังทับตารางก่อน */
  function combine(tables) {
    const byKey = new Map(), dups = [];
    tables.forEach((t) => (t.include === false ? [] : t.rows).forEach((r) => {
      if (r.errors && r.errors.length) return;
      const k = r.year + '|' + r.crop + '|' + r.district_code;
      if (byKey.has(k)) dups.push(k);
      byKey.set(k, { year: r.year, crop: r.crop, district_code: r.district_code, district: r.district,
        planted: r.planted, harvested: r.harvested, production: r.production, yield_planted: r.yield_planted, yield_harvested: r.yield_harvested });
    }));
    return { rows: [...byKey.values()], duplicates: dups };
  }

  // ---------- PDF (ข้อความจริง ไม่ใช่ภาพสแกน) ----------
  /** แปลง text items ของ pdf.js หนึ่งหน้าเป็นตาราง โดยจัดกลุ่มตามแนว y และแบ่งเซลล์ตามช่องว่างแนว x */
  function pdfItemsToGrid(items) {
    const its = items.filter((i) => norm(i.str)).map((i) => ({ s: i.str, x: i.transform[4], y: i.transform[5], w: i.width || 0, h: Math.abs(i.transform[3]) || 10 }));
    if (!its.length) return [];
    its.sort((a, b) => b.y - a.y || a.x - b.x);
    const lines = [];
    its.forEach((it) => {
      const ln = lines.find((l) => Math.abs(l.y - it.y) <= Math.max(2.5, it.h * 0.35));
      if (ln) ln.items.push(it); else lines.push({ y: it.y, items: [it] });
    });
    // ขอบคอลัมน์จากตำแหน่งเริ่มของกลุ่มข้อความ (รวมทุกบรรทัด)
    const segs = lines.map((l) => {
      l.items.sort((a, b) => a.x - b.x);
      const out = [];
      l.items.forEach((it) => {
        const last = out[out.length - 1];
        const gap = last ? it.x - (last.x1) : Infinity;
        if (last && gap < Math.max(4, it.h * 0.6)) { last.s += (gap > it.h * 0.2 ? ' ' : '') + it.s; last.x1 = it.x + it.w; }
        else out.push({ s: it.s, x0: it.x, x1: it.x + it.w });
      });
      return out;
    });
    // จัดเซลล์ลงคอลัมน์: ใช้บรรทัดที่มีเซลล์มากที่สุดเป็นแม่แบบ ใช้จุดกึ่งกลางแต่ละเซลล์เทียบ
    const tmpl = segs.reduce((a, b) => (b.length > a.length ? b : a), []);
    const centers = tmpl.map((c) => (c.x0 + c.x1) / 2);
    return segs.map((row) => {
      if (row.length === tmpl.length) return row.map((c) => norm(c.s));
      const out = new Array(tmpl.length).fill('');
      row.forEach((c) => {
        const mid = (c.x0 + c.x1) / 2;
        let k = 0, best = Infinity;
        centers.forEach((x, i) => { const d = Math.abs(x - mid); if (d < best) { best = d; k = i; } });
        out[k] = norm(out[k] + ' ' + c.s);
      });
      return out;
    });
  }

  const api = { FIELDS, NUM_FIELDS, FIELD_LABEL, norm, headerField, detectHeader, detectCrop, detectYear, parseNumber, districtMatcher,
    extractTable, reextract, combine, pdfItemsToGrid };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Importer = api;
})(typeof window !== 'undefined' ? window : globalThis);
