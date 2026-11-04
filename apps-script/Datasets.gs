/**
 * ทะเบียนชุดข้อมูล (Dataset registry) — ตารางข้อมูลของแต่ละชั้นข้อมูลที่ผู้ดูแลเปิดดู เพิ่ม แก้ไข ลบ ได้โดยตรง
 *
 * ชุดข้อมูลใหม่ให้เพิ่มเป็น schema ในไฟล์นี้ (ไม่สร้างจากหน้าเว็บ) เพื่อควบคุมว่าช่องใดเป็นข้อมูลส่วนบุคคล
 *   pii: true    = ข้อมูลส่วนบุคคล (PDPA) — ผู้ดูแลเห็น/แก้ได้ แต่ไม่ส่งออกทาง API สาธารณะ และไม่บันทึกค่าใน log
 *   public: false = ไม่ส่งออกทาง API สาธารณะ (แม้ไม่ใช่ข้อมูลส่วนบุคคล)
 * API สาธารณะส่งเฉพาะช่องที่อนุญาต (allowlist) เท่านั้น
 *
 * สิทธิ์: ดู/เพิ่ม/แก้ไข = Admin ขึ้นไป · ลบ = Super Admin เท่านั้น
 * ทุกการแก้ไข/ลบ บันทึกค่าก่อน-หลังใน admin_log · ตรวจชนกัน: ถ้าแถวถูกแก้หลังจากเปิดอ่าน จะไม่บันทึกทับ
 */

// [key, หัวคอลัมน์ในชีต, ชนิด, ป้ายชื่อ, ตัวเลือกเพิ่มเติม]
// ชนิด: text | long (ข้อความยาว) | int | num | bool | lat | lng | code (รหัสเก็บเป็นข้อความ) | phone | year | select
function f_(key, header, type, label, o) {
  o = o || {};
  return { key: key, header: header || key, type: type || 'text', label: label || key, pii: !!o.pii, public: o.public !== false && !o.pii,
    required: !!o.required, options: o.options || null, max: o.max || (type === 'long' ? 600 : 200), hint: o.hint || '' };
}

// สร้างเมื่อใช้ครั้งแรก (ไฟล์นี้โหลดก่อน Soil.gs จึงอ้างค่าคงที่ของไฟล์อื่นตอนโหลดไม่ได้)
let DATASETS_ = null;
function datasets_() {
  if (DATASETS_) return DATASETS_;
  DATASETS_ = {
  crops: {
    label: 'สถิติพืชเศรษฐกิจที่สำคัญ', sheet: DATA_SHEET, keyFields: ['year', 'crop', 'district_code'], meta: false, order: 1,
    note: 'แก้ไขรายแถวได้ที่นี่ · นำเข้าทั้งไฟล์ใช้แท็บ "นำเข้าข้อมูล" เหมือนเดิม',
    fields: [
      f_('year', 'year', 'year', 'ปี พ.ศ.', { required: true }), f_('crop', 'crop', 'text', 'พืช', { required: true, max: 60 }),
      f_('district_code', 'district_code', 'code', 'รหัสอำเภอ', { required: true }), f_('district', 'district', 'text', 'อำเภอ', { max: 60 }),
      f_('planted', 'planted', 'num', 'เนื้อที่เพาะปลูก (ไร่)'), f_('harvested', 'harvested', 'num', 'เนื้อที่เก็บเกี่ยว (ไร่)'),
      f_('production', 'production', 'num', 'ผลผลิต (ตัน)'), f_('yield_planted', 'yield_planted', 'num', 'ผลผลิต/ไร่ปลูก (กก.)'),
      f_('yield_harvested', 'yield_harvested', 'num', 'ผลผลิต/ไร่เก็บเกี่ยว (กก.)')
    ]
  },
  soil: {
    label: 'ศูนย์จัดการดินปุ๋ยชุมชน (ศดปช.)', sheet: SOIL_SHEET, idPrefix: 'S', order: 2, headers: SOIL_HEADERS,
    note: 'นำเข้าทำเนียบทั้งไฟล์ใช้แท็บ "ศดปช." เหมือนเดิม',
    fields: [
      f_('id', 'Center_ID', 'code', 'รหัส'), f_('name', 'Name', 'text', 'ชื่อ ศดปช.', { required: true }),
      f_('district_code', 'District_Code', 'code', 'รหัสอำเภอ'), f_('district', 'District', 'text', 'อำเภอ', { max: 60 }),
      f_('location', 'Location', 'text', 'ที่ตั้ง'), f_('lat', 'Lat', 'lat', 'ละติจูด'), f_('lng', 'Lng', 'lng', 'ลองจิจูด'),
      f_('type', 'Type', 'select', 'ประเภท', { options: ['หลัก', 'เครือข่าย'] }), f_('level', 'Level', 'text', 'ระดับ', { max: 2 }),
      f_('members', 'Members', 'int', 'สมาชิก (ราย)'), f_('year_start', 'Year_Start', 'year', 'ปีที่จัดตั้ง'), f_('fund', 'Fund', 'num', 'กองทุน (บาท)'),
      f_('crops', 'Crops', 'text', 'พืชหลัก'), f_('network', 'Network', 'long', 'เครือข่าย'), f_('organic', 'Organic', 'text', 'ปุ๋ยอินทรีย์'),
      f_('products', 'Products', 'text', 'ผลิตภัณฑ์'), f_('oss', 'OSS', 'text', 'OSS', { max: 20 }), f_('oss_status', 'OSS_Status', 'text', 'สถานะ OSS', { max: 40 }),
      f_('chair', 'Chair', 'text', 'ประธาน', { pii: true }), f_('chair_phone', 'Chair_Phone', 'phone', 'โทรศัพท์ประธาน', { pii: true }),
      f_('note', 'Note', 'long', 'หมายเหตุ'), f_('verified', 'Verified', 'bool', 'ตรวจสอบพิกัดแล้ว')
    ]
  },
  farm: {
    label: 'กลุ่มแปลงใหญ่', sheet: 'large_farms', idPrefix: 'F', order: 3, seed: 'FARM_SEED',
    note: 'นำเข้าไฟล์ส่งออกจากระบบแปลงใหญ่ หรือไฟล์พิกัด ได้ที่ปุ่ม "นำเข้าไฟล์" ของตารางนี้',
    fields: [
      f_('id', 'id', 'code', 'รหัส'), f_('name', 'name', 'text', 'ชื่อแปลงใหญ่', { required: true }),
      f_('year_start', 'year_start', 'year', 'ปีที่เริ่ม'), f_('group', 'group', 'text', 'กลุ่มสินค้า', { max: 60 }),
      f_('commodity', 'commodity', 'text', 'สินค้าหลัก', { required: true, max: 60 }), f_('commodity2', 'commodity2', 'text', 'สินค้ารอง', { max: 60 }),
      f_('moo', 'moo', 'text', 'หมู่ที่', { max: 40 }), f_('tambon', 'tambon', 'text', 'ตำบล', { max: 60 }),
      f_('district', 'district', 'text', 'อำเภอ', { max: 60 }), f_('district_code', 'district_code', 'code', 'รหัสอำเภอ'),
      f_('members', 'members', 'int', 'สมาชิก (ราย)'), f_('member_area', 'member_area', 'num', 'พื้นที่สมาชิก (ไร่)'),
      f_('plot_farmers', 'plot_farmers', 'int', 'เกษตรกรในแปลง (ราย)'), f_('plots', 'plots', 'int', 'จำนวนแปลง'), f_('plot_area', 'plot_area', 'num', 'พื้นที่แปลง (ไร่)'),
      f_('cost_before', 'cost_before', 'num', 'ต้นทุนก่อน (บาท/ไร่)'), f_('cost_after', 'cost_after', 'num', 'ต้นทุนหลัง (บาท/ไร่)'),
      f_('yield_before', 'yield_before', 'num', 'ผลผลิตก่อน (กก./ไร่)'), f_('yield_after', 'yield_after', 'num', 'ผลผลิตหลัง (กก./ไร่)'),
      f_('gap', 'gap', 'bool', 'มาตรฐาน GAP'), f_('organic', 'organic', 'bool', 'อินทรีย์'), f_('grouping', 'grouping', 'text', 'รูปแบบการรวมกลุ่ม', { max: 80 }),
      f_('market_before', 'market_before', 'text', 'ตลาดก่อน'), f_('market_after', 'market_after', 'text', 'ตลาดหลัง'),
      f_('lat', 'lat', 'lat', 'ละติจูด'), f_('lng', 'lng', 'lng', 'ลองจิจูด'), f_('coord_note', 'coord_note', 'text', 'หมายเหตุพิกัด'),
      f_('manager', 'manager', 'text', 'ผู้จัดการ', { pii: true }), f_('manager_position', 'manager_position', 'text', 'ตำแหน่งผู้จัดการ', { pii: true }),
      f_('manager_phone', 'manager_phone', 'phone', 'โทรศัพท์ผู้จัดการ', { pii: true }),
      f_('chair', 'chair', 'text', 'ประธาน', { pii: true }), f_('chair_phone', 'chair_phone', 'phone', 'โทรศัพท์ประธาน', { pii: true })
    ]
  },
  lc: {
    label: 'ศพก. หลัก', sheet: 'lc_centers', idPrefix: 'L', order: 4, seed: 'LC_SEED',
    fields: [
      f_('id', 'id', 'code', 'รหัส'), f_('name', 'name', 'text', 'ชื่อศูนย์', { required: true }),
      f_('district', 'district', 'text', 'อำเภอ', { max: 60 }), f_('district_code', 'district_code', 'code', 'รหัสอำเภอ'),
      f_('moo', 'moo', 'text', 'หมู่ที่', { max: 20 }), f_('tambon', 'tambon', 'text', 'ตำบล', { max: 60 }),
      f_('commodity', 'commodity', 'text', 'สินค้าหลัก', { max: 60 }), f_('lat', 'lat', 'lat', 'ละติจูด'), f_('lng', 'lng', 'lng', 'ลองจิจูด'),
      f_('utm_x', 'utm_x', 'num', 'UTM X (47N)'), f_('utm_y', 'utm_y', 'num', 'UTM Y (47N)'),
      f_('target_area', 'target_area', 'num', 'พื้นที่เป้าหมาย (ไร่)'), f_('target_farmers', 'target_farmers', 'int', 'เกษตรกรเป้าหมาย (ราย)'),
      f_('highlight', 'highlight', 'long', 'จุดเด่นของศูนย์ (คั่นด้วย ;)'), f_('network', 'network', 'int', 'ศพก. เครือข่าย (แห่ง)'),
      f_('coord_note', 'coord_note', 'text', 'หมายเหตุพิกัด'),
      f_('farmer', 'farmer', 'text', 'เกษตรกรต้นแบบ', { pii: true }), f_('farmer_phone', 'farmer_phone', 'phone', 'โทรศัพท์เกษตรกรต้นแบบ', { pii: true }),
      f_('officer', 'officer', 'text', 'เจ้าหน้าที่ตำบล', { pii: true }), f_('officer_phone', 'officer_phone', 'phone', 'โทรศัพท์เจ้าหน้าที่', { pii: true })
    ]
  },
  lcnet: {
    label: 'ศพก. เครือข่าย รายอำเภอ', sheet: 'lc_network', keyFields: ['district_code'], order: 5, seed: 'LCNET_SEED',
    fields: [f_('district_code', 'district_code', 'code', 'รหัสอำเภอ', { required: true }), f_('district', 'district', 'text', 'อำเภอ', { max: 60 }),
      f_('count', 'count', 'int', 'จำนวน (แห่ง)')]
  },
  lctype: {
    label: 'ศพก. เครือข่าย รายประเภท', sheet: 'lc_types', keyFields: ['type'], order: 6, seed: 'LCTYPE_SEED',
    fields: [f_('type', 'type', 'text', 'ประเภท', { required: true, max: 60 }), f_('count', 'count', 'int', 'จำนวน (แห่ง)')]
  }
  };
  return DATASETS_;
}
const DS_META = ['Updated_At', 'Updated_By'];

function dsDef_(name) {
  const d = datasets_()[String(name || '')];
  if (!d) throw new Error('ไม่รู้จักชุดข้อมูล');
  return d;
}
function dsHeaders_(d) { return d.headers || d.fields.map(function (f) { return f.header; }).concat(d.meta === false ? [] : DS_META); }

function dsBlank_(v) { return v === null || v === undefined || v === ''; }
/** แปลงค่าในชีต/จากผู้ใช้ ให้เป็นชนิดของช่อง */
function dsCast_(f, v) {
  switch (f.type) {
    case 'int': case 'num': case 'year': {
      if (dsBlank_(v)) return f.type === 'year' ? null : (f.key.indexOf('cost_') === 0 || f.key.indexOf('yield_') === 0 || f.key.indexOf('target_') === 0 || f.key.indexOf('utm_') === 0 ? null : 0);
      const n = num_(v);
      return isNaN(n) ? NaN : (f.type === 'num' ? n : Math.round(n));
    }
    case 'lat': case 'lng': { if (dsBlank_(v)) return null; const n = Number(v); return isFinite(n) ? n : NaN; }
    case 'bool': return v === true || /^(true|1|ใช่|มี|yes)$/i.test(String(v).trim());
    case 'code': return cleanText_(v, 40).replace(/\.0$/, '');
    case 'phone': return cleanText_(v, 40).replace(/[^\d\-, ]/g, '');
    default: return cleanText_(v, f.max);
  }
}
function dsToCell_(f, v) {
  if (f.type === 'bool') return v === true;
  if (v === null || v === undefined || (typeof v === 'number' && isNaN(v))) return '';
  return v;
}
function dsKeyOf_(d, o) { return d.keyFields ? d.keyFields.map(function (k) { return String(o[k]); }).join('|') : String(o.id || ''); }
/** ลายนิ้วมือของแถว ใช้ตรวจว่าแถวถูกแก้ไปแล้วหรือยัง */
function dsVer_(d, o) { return sha256Hex_(JSON.stringify(d.fields.map(function (f) { return o[f.key]; }))).slice(0, 16); }

function dsRead_(d) {
  const sh = sheetByName_(d.sheet);
  const head = sh.getLastColumn() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String) : [];
  const idx = {};
  head.forEach(function (h, i) { idx[h] = i; });
  const items = [];
  dataRows_(sh).forEach(function (r, i) {
    const o = {};
    d.fields.forEach(function (f) { o[f.key] = idx[f.header] === undefined ? dsCast_(f, '') : dsCast_(f, r[idx[f.header]]); });
    if (d.fields.filter(function (f) { return f.required; }).every(function (f) { return dsBlank_(o[f.key]); })) return;
    items.push({ row: i + 2, obj: o, raw: r });
  });
  return { sh: sh, head: head, idx: idx, items: items };
}

function dsValidate_(d, o) {
  const e = [];
  d.fields.forEach(function (f) {
    const v = o[f.key];
    if (f.required && dsBlank_(v)) e.push('ต้องระบุ' + f.label);
    if (typeof v === 'number' && isNaN(v)) e.push(f.label + ' ต้องเป็นตัวเลข');
    if (f.type === 'year' && v !== null && !(v >= 2500 && v <= 2700)) e.push(f.label + ' ต้องเป็นปี พ.ศ.');
    if ((f.type === 'int' || f.type === 'num') && typeof v === 'number' && v < 0 && f.key.indexOf('utm') < 0) e.push(f.label + ' ต้องไม่ติดลบ');
    if (f.options && !dsBlank_(v) && f.options.indexOf(v) < 0) e.push(f.label + ' ต้องเป็น ' + f.options.join(' / '));
  });
  const latF = d.fields.find(function (f) { return f.type === 'lat'; });
  if (latF) {
    const la = o.lat, lo = o.lng;
    if ((la === null) !== (lo === null)) e.push('ต้องระบุทั้งละติจูดและลองจิจูด');
    else if (la !== null && !(la > 5 && la < 21 && lo > 97 && lo < 106)) e.push('พิกัดไม่อยู่ในประเทศไทย');
  }
  return e;
}

/** แถวที่จะเขียน: เรียงตามหัวคอลัมน์ที่มีจริงในชีต คอลัมน์ที่ระบบไม่รู้จักคงค่าเดิม */
function dsRowOut_(d, ctx, o, raw, by) {
  const out = ctx.head.map(function (h, i) { return raw ? raw[i] : ''; });
  d.fields.forEach(function (f) { if (ctx.idx[f.header] !== undefined) out[ctx.idx[f.header]] = dsToCell_(f, o[f.key]); });
  if (ctx.idx.Updated_At !== undefined) out[ctx.idx.Updated_At] = new Date();
  if (ctx.idx.Updated_By !== undefined) out[ctx.idx.Updated_By] = by;
  return out;
}

function dsPublicRow_(d, o) {
  const p = {};
  d.fields.forEach(function (f) { if (f.public) p[f.key] = o[f.key]; });
  return p;
}
/** สำหรับ API สาธารณะ: เฉพาะช่องที่อนุญาต */
function dsPublic_(name) {
  const d = dsDef_(name);
  if (!spreadsheet_().getSheetByName(d.sheet)) return [];
  return dsRead_(d).items.map(function (it) { return dsPublicRow_(d, it.obj); });
}

/** สรุปการเปลี่ยนแปลงสำหรับ log (ไม่บันทึกค่าข้อมูลส่วนบุคคล) */
function dsDiff_(d, a, b) {
  const ch = [];
  d.fields.forEach(function (f) {
    const x = a ? a[f.key] : undefined, y = b ? b[f.key] : undefined;
    if (JSON.stringify(x) === JSON.stringify(y)) return;
    if (f.pii) ch.push(f.key + ': (ข้อมูลส่วนบุคคล เปลี่ยนแปลง)');
    else ch.push(f.key + ': ' + (x === undefined ? '' : JSON.stringify(x)) + ' → ' + (y === undefined ? '' : JSON.stringify(y)));
  });
  return ch.join('; ');
}
function dsMask_(d, o) { const m = {}; d.fields.forEach(function (f) { m[f.key] = f.pii ? (dsBlank_(o[f.key]) ? '' : '***') : o[f.key]; }); return m; }

function dsAfterWrite_(name, d, o) {
  invalidateData_();
  if (name === 'crops' && o && CROP_ORDER.indexOf(o.crop) < 0) rebuildCropViews_();
}

// ---------------- API ----------------

function dsSchema_(s) {
  return Object.keys(datasets_()).sort(function (a, b) { return datasets_()[a].order - datasets_()[b].order; }).map(function (k) {
    const d = datasets_()[k];
    return { name: k, label: d.label, note: d.note || '', key: d.keyFields || ['id'], canDelete: s.role === 'super',
      importable: ['farm', 'lc', 'lcnet', 'lctype'].indexOf(k) >= 0,
      fields: d.fields.map(function (f) { return { key: f.key, label: f.label, type: f.type, pii: f.pii, public: f.public, required: f.required, options: f.options }; }) };
  });
}

function dsList_(a) {
  a = a || {};
  const d = dsDef_(a.dataset);
  return { dataset: a.dataset, rows: dsRead_(d).items.map(function (it) {
    const o = it.obj; o._id = dsKeyOf_(d, o); o._v = dsVer_(d, o); return o;
  }) };
}

/** เพิ่ม (ไม่มี id) หรือแก้ไข (มี id + v) หนึ่งแถว */
function dsSave_(a, s) {
  a = a || {};
  const name = String(a.dataset || ''), d = dsDef_(name);
  const input = a.item || {};
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const ctx = dsRead_(d);
    let it = null;
    if (!dsBlank_(a.id)) {
      it = ctx.items.find(function (x) { return dsKeyOf_(d, x.obj) === String(a.id); });
      if (!it) throw new Error('ไม่พบแถวนี้แล้ว (อาจถูกลบไปแล้ว) กรุณาโหลดตารางใหม่');
      if (String(a.v || '') !== dsVer_(d, it.obj)) throw new Error('CONFLICT: แถวนี้ถูกแก้ไขโดยผู้อื่นหลังจากคุณเปิดตาราง กรุณาโหลดตารางใหม่แล้วแก้อีกครั้ง');
    }
    const before = it ? it.obj : null;
    const o = {};
    d.fields.forEach(function (f) { o[f.key] = (f.key in input) ? dsCast_(f, input[f.key]) : (before ? before[f.key] : dsCast_(f, '')); });
    if (!d.keyFields && dsBlank_(o.id)) o.id = d.idPrefix + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyMMddHHmmss') + Math.floor(Math.random() * 90 + 10);
    const e = dsValidate_(d, o);
    if (e.length) throw new Error(e.join(', '));
    const key = dsKeyOf_(d, o);
    const dup = ctx.items.find(function (x) { return x !== it && dsKeyOf_(d, x.obj) === key; });
    if (dup) throw new Error('มีแถว ' + key + ' อยู่แล้ว');
    const row = dsRowOut_(d, ctx, o, it ? it.raw : null, s.username);
    if (it) ctx.sh.getRange(it.row, 1, 1, row.length).setValues([row]);
    else ctx.sh.appendRow(row);
    dsAfterWrite_(name, d, o);
    const diff = dsDiff_(d, before, o);
    audit_(s, (it ? 'ds_update:' : 'ds_add:') + name, key + ' | ' + (it ? diff : JSON.stringify(dsMask_(d, o))));
    o._id = key; o._v = dsVer_(d, o);
    return { message: (it ? 'บันทึกการแก้ไข ' : 'เพิ่ม ') + key + ' แล้ว', item: o, changed: diff };
  } finally {
    lock.releaseLock();
  }
}

/** ลบหนึ่งแถว (Super Admin) บันทึกค่าทั้งแถวใน log */
function dsDelete_(a, s) {
  a = a || {};
  const name = String(a.dataset || ''), d = dsDef_(name);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const ctx = dsRead_(d);
    const it = ctx.items.find(function (x) { return dsKeyOf_(d, x.obj) === String(a.id || ''); });
    if (!it) throw new Error('ไม่พบแถวนี้แล้ว กรุณาโหลดตารางใหม่');
    if (String(a.v || '') !== dsVer_(d, it.obj)) throw new Error('CONFLICT: แถวนี้ถูกแก้ไขหลังจากคุณเปิดตาราง กรุณาโหลดตารางใหม่');
    ctx.sh.deleteRow(it.row);
    dsAfterWrite_(name, d, null);
    audit_(s, 'ds_delete:' + name, String(a.id) + ' | ' + JSON.stringify(dsMask_(d, it.obj)));
    return { message: 'ลบ ' + a.id + ' แล้ว' };
  } finally {
    lock.releaseLock();
  }
}

/**
 * นำเข้าหลายแถว
 *  mode 'replace' = แทนที่ทั้งชุด (สำรองชีตเดิมก่อน; ถ้าแถวใหม่ไม่มีข้อมูลส่วนบุคคล ให้คงค่าเดิมของรหัสเดียวกัน)
 *  mode 'upsert'  = แก้เฉพาะช่องที่ส่งมาของแถวที่มีรหัสอยู่แล้ว และเพิ่มแถวใหม่ (เช่น นำเข้าไฟล์พิกัด)
 */
function dsImport_(a, s) {
  a = a || {};
  const name = String(a.dataset || ''), d = dsDef_(name);
  if (['farm', 'lc', 'lcnet', 'lctype'].indexOf(name) < 0) throw new Error('ชุดข้อมูลนี้ให้นำเข้าที่แท็บเดิม');
  const rows = Array.isArray(a.rows) ? a.rows : [];
  const mode = a.mode === 'upsert' ? 'upsert' : 'replace';
  if (!rows.length) throw new Error('ไม่มีรายการ');
  if (rows.length > 5000) throw new Error('รายการมากเกินไป');
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = spreadsheet_();
    const ctx = dsRead_(d);
    const old = {};
    ctx.items.forEach(function (it) { old[dsKeyOf_(d, it.obj)] = it; });
    const errs = [], out = [], seen = {};
    let updated = 0, added = 0;
    rows.forEach(function (inp, i) {
      const prev = old[dsKeyOf_(d, inp)];
      const o = {};
      d.fields.forEach(function (f) {
        const has = (f.key in inp) && !(f.pii && dsBlank_(inp[f.key]) && prev);
        o[f.key] = has ? dsCast_(f, inp[f.key]) : (prev ? prev.obj[f.key] : dsCast_(f, ''));
      });
      if (!d.keyFields && dsBlank_(o.id)) o.id = d.idPrefix + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyMMdd') + String(i + 1).padStart(4, '0');
      const e = dsValidate_(d, o);
      const k = dsKeyOf_(d, o);
      if (seen[k]) e.push('รหัสซ้ำ ' + k);
      seen[k] = true;
      if (e.length) { errs.push('แถว ' + (i + 1) + ': ' + e.join(', ')); return; }
      if (prev) updated++; else added++;
      out.push({ o: o, prev: prev });
    });
    if (errs.length) throw new Error(errs.slice(0, 5).join(' | ') + (errs.length > 5 ? ' (และอีก ' + (errs.length - 5) + ' แถว)' : ''));
    const bakName = '_bak_' + d.sheet + '_' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyMMddHHmmss');
    ctx.sh.copyTo(ss).setName(bakName).hideSheet();
    if (mode === 'replace') {
      const data = out.map(function (x) { return dsRowOut_(d, ctx, x.o, x.prev ? x.prev.raw : null, s.username); });
      if (ctx.sh.getLastRow() > 1) ctx.sh.getRange(2, 1, ctx.sh.getLastRow() - 1, ctx.head.length).clearContent();
      ctx.sh.getRange(2, 1, data.length, ctx.head.length).setValues(data);
    } else {
      out.forEach(function (x) {
        const row = dsRowOut_(d, ctx, x.o, x.prev ? x.prev.raw : null, s.username);
        if (x.prev) ctx.sh.getRange(x.prev.row, 1, 1, row.length).setValues([row]); else ctx.sh.appendRow(row);
      });
    }
    const baks = ss.getSheets().map(function (x) { return x.getName(); }).filter(function (n) { return n.indexOf('_bak_' + d.sheet + '_') === 0; }).sort();
    while (baks.length > 5) ss.deleteSheet(ss.getSheetByName(baks.shift()));
    dsAfterWrite_(name, d, null);
    audit_(s, 'ds_import:' + name, mode + ' ' + cleanText_(a.fileName, 120) + ' แก้ ' + updated + ' เพิ่ม ' + added + (mode === 'replace' ? ' รวม ' + out.length : '') + ' (สำรอง ' + bakName + ')');
    return { message: (mode === 'replace' ? 'แทนที่ข้อมูลทั้งชุด ' + out.length + ' แถว' : 'ปรับปรุง ' + updated + ' แถว เพิ่ม ' + added + ' แถว') +
      ' (สำรองข้อมูลเดิมไว้ที่ชีต ' + bakName + ')', updated: updated, added: added, total: out.length };
  } finally {
    lock.releaseLock();
  }
}

function dsSeed_(name) {
  switch (name) {
    case 'farm': return typeof FARM_SEED === 'undefined' ? null : FARM_SEED;
    case 'lc': return typeof LC_SEED === 'undefined' ? null : LC_SEED;
    case 'lcnet': return typeof LCNET_SEED === 'undefined' ? null : LCNET_SEED;
    case 'lctype': return typeof LCTYPE_SEED === 'undefined' ? null : LCTYPE_SEED;
    default: return null;
  }
}

/** สร้างชีตของชุดข้อมูลใหม่ และใส่ข้อมูลตั้งต้นเมื่อชีตยังว่าง */
function ensureDatasets_() {
  const out = [];
  ['farm', 'lc', 'lcnet', 'lctype'].forEach(function (name) {
    const d = datasets_()[name];
    const heads = dsHeaders_(d);
    const sh = ensureSheet_(d.sheet, heads);
    d.fields.forEach(function (f, i) { if (f.type === 'code' || f.type === 'phone' || f.key === 'moo') sh.getRange(1, i + 1, Math.max(sh.getMaxRows ? sh.getMaxRows() : 1000, 2), 1).setNumberFormat('@'); });
    if (sh.getLastRow() >= 2) { out.push('PASS: ชีต ' + d.sheet + ' พร้อม (' + (sh.getLastRow() - 1) + ' แถว)'); return; }
    const seed = dsSeed_(name);
    if (!seed || !seed.length) { out.push('INFO: ชีต ' + d.sheet + ' ว่าง'); return; }
    const ctx = { head: heads, idx: {} };
    heads.forEach(function (h, i) { ctx.idx[h] = i; });
    const rows = seed.map(function (src) {
      const o = {};
      d.fields.forEach(function (f) { o[f.key] = dsCast_(f, src[f.key]); });
      return dsRowOut_(d, ctx, o, null, 'seed');
    });
    sh.getRange(2, 1, rows.length, heads.length).setValues(rows);
    out.push('PASS: ใส่ข้อมูลตั้งต้น ' + d.label + ' ' + rows.length + ' แถว');
  });
  return out;
}
