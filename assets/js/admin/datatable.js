// ===== ตารางข้อมูลแต่ละชั้นข้อมูล (ดู เพิ่ม แก้ไข ลบ ตรวจพิกัด กรอกทั้งปี) + ศูนย์รวมการนำเข้าข้อมูล =====
// ใช้ API: dsSchema, dsList, dsSave, dsSaveMany, dsDelete (Super Admin), dsImport
window.DataTable = (function () {
  'use strict';
  const A = () => window.AdminCtx;
  const $ = (id) => document.getElementById(id);
  const PAGE = 50;
  const T = { schema: null, ds: null, rows: [], page: 0, editing: null, filter: { coord: '', crop: '', year: '', district: '' }, imp: null, pending: null };
  const esc = (s) => A().esc(s);
  const isSuper = () => A().S.me && A().S.me.role === 'super';
  const has = (ds, k) => ds.fields.some((f) => f.key === k);
  const districts = () => A().S.districts || [];
  const codeOf = (name) => (districts().find((d) => d.district === name) || {}).district_code || '';
  let GEO = null;
  const geo = async () => GEO || (GEO = await (await fetch('data/kpp_districts.json')).json());
  geo().catch(() => {});

  async function ensureSchema() {
    if (T.schema) return T.schema;
    T.schema = await A().call('dsSchema');
    $('ds-pick').innerHTML = T.schema.map((d, i) => `<button class="chip ${i === 0 ? 'on' : ''}" data-ds="${d.name}">${esc(d.label)}</button>`).join('');
    T.ds = T.schema[0];
    return T.schema;
  }
  async function load() { await ensureSchema(); await reload(); }
  async function reload() {
    $('ds-table').innerHTML = '<tbody><tr><td class="muted">กำลังโหลด…</td></tr></tbody>';
    const r = await A().call('dsList', { dataset: T.ds.name });
    T.rows = r.rows;
    if (T.ds.name === 'crops') {
      // เรียง: ปีล่าสุดก่อน → ชนิดพืชตามลำดับของระบบ → อำเภอ
      const order = A().S.crops || [];
      const ci = (c) => (order.indexOf(c) + 1) || 99;
      T.rows.sort((a, b) => b.year - a.year || ci(a.crop) - ci(b.crop) || String(a.district_code).localeCompare(String(b.district_code)));
    }
    T.page = 0;
    $('ds-note').hidden = !T.ds.note; $('ds-note').textContent = T.ds.note || '';
    $('ds-import-btn').classList.remove('hidden');
    $('ds-bulk').classList.toggle('hidden', T.ds.name !== 'crops');
    renderFilters();
    render();
  }

  // ---------- พิกัดที่ต้องตรวจ ----------
  const COORD_BAD = /ตกในอำเภอ|ไม่ถูกต้อง|รอตรวจ|นอกจังหวัด|พิกัดอยู่ใน/;
  function coordState(r) {
    if (!has(T.ds, 'lat')) return '';
    if (r.lat === null || r.lat === '') return 'none';
    if (T.ds.name === 'soil') return r.verified ? '' : 'pending';
    return COORD_BAD.test(r.coord_note || '') ? 'pending' : '';
  }
  const coordNote = (r) => (T.ds.name === 'soil' ? r.note : r.coord_note) || '';

  // ---------- ตัวกรอง ----------
  const sortTh = (a, b) => String(a).localeCompare(String(b), 'th');
  function renderFilters() {
    const F = T.filter = { coord: '', crop: '', year: '', district: '' };
    const parts = [];
    const sel = (id, label, opts) => `<label class="flt">${label}<select id="${id}"><option value="">ทั้งหมด</option>${opts.map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join('')}</select></label>`;
    if (T.ds.name === 'crops') {
      const crops = [...new Set(T.rows.map((r) => r.crop))];
      const order = (A().S.crops || []);
      crops.sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
      parts.push(sel('flt-crop', 'ชนิดพืช', crops));
      parts.push(sel('flt-year', 'ปี พ.ศ.', [...new Set(T.rows.map((r) => r.year))].sort((a, b) => b - a)));
    }
    if (has(T.ds, 'district')) parts.push(sel('flt-district', 'อำเภอ', districts().map((d) => d.district)));
    if (has(T.ds, 'lat')) {
      const n = (s) => T.rows.filter((r) => coordState(r) === s).length;
      parts.push(`<div class="chips sm" id="flt-coord"><button class="chip on" data-cf="">ทั้งหมด</button>
        <button class="chip warn" data-cf="pending">⚠️ รอตรวจสอบพิกัด (${n('pending')})</button><button class="chip" data-cf="none">📍 ยังไม่มีพิกัด (${n('none')})</button></div>`);
    }
    $('ds-filters').innerHTML = parts.join('');
    [['flt-crop', 'crop'], ['flt-year', 'year'], ['flt-district', 'district']].forEach(([id, k]) => {
      const el = $(id); if (el) el.addEventListener('change', () => { F[k] = el.value; T.page = 0; render(); });
    });
    const cf = $('flt-coord');
    if (cf) cf.addEventListener('click', (e) => {
      const b = e.target.closest('[data-cf]'); if (!b) return;
      cf.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === b));
      F.coord = b.dataset.cf; T.page = 0; render();
    });
  }

  function coordCounts() {
    const cf = $('flt-coord'); if (!cf) return;
    const n = (st) => T.rows.filter((r) => coordState(r) === st).length;
    cf.querySelector('[data-cf=pending]').textContent = `⚠️ รอตรวจสอบพิกัด (${n('pending')})`;
    cf.querySelector('[data-cf=none]').textContent = `📍 ยังไม่มีพิกัด (${n('none')})`;
  }

  const show = (v, f) => {
    if (v === null || v === undefined || v === '') return '<span class="muted">–</span>';
    if (f.type === 'bool') return v ? '✔' : '';
    if (f.type === 'num' || f.type === 'int') return A().fmt(v, f.type === 'num' ? 2 : 0);
    if (f.type === 'lat' || f.type === 'lng') return Number(v).toFixed(5);
    return esc(v);
  };
  function columns() {
    const pii = $('ds-pii').checked;
    const cols = T.ds.fields.filter((f) => f.type !== 'long' && !f.pii && f.key !== 'district_code' && !/^(utm_|market_|commodity2|grouping|member_area|plot_farmers|coord_note|full_name|level_year|area_)/.test(f.key));
    return cols.slice(0, pii ? 7 : 10).concat(pii ? T.ds.fields.filter((f) => f.pii) : []);
  }
  function filtered() {
    const q = $('ds-q').value.trim().toLowerCase(), F = T.filter, pii = $('ds-pii').checked;
    return T.rows.filter((r) => (!F.crop || r.crop === F.crop) && (!F.year || String(r.year) === F.year) && (!F.district || r.district === F.district) &&
      (!F.coord || coordState(r) === F.coord) &&
      (!q || T.ds.fields.some((f) => (pii || !f.pii) && String(r[f.key] ?? '').toLowerCase().includes(q))));
  }
  function render() {
    const rows = filtered(), cols = columns();
    const showNote = has(T.ds, 'lat') && T.filter.coord === 'pending';
    const pages = Math.max(1, Math.ceil(rows.length / PAGE));
    T.page = Math.min(T.page, pages - 1);
    const view = rows.slice(T.page * PAGE, (T.page + 1) * PAGE);
    $('ds-count').textContent = `${A().fmt(rows.length)} แถว` + (rows.length !== T.rows.length ? ` (จาก ${A().fmt(T.rows.length)})` : '');
    $('ds-table').innerHTML = `<thead><tr>${cols.map((f) => `<th>${f.pii ? '🔒 ' : ''}${esc(f.label)}</th>`).join('')}${showNote ? '<th>หมายเหตุพิกัด</th>' : ''}<th></th></tr></thead><tbody>` +
      (view.length ? view.map((r) => {
        const st = coordState(r);
        return `<tr data-id="${esc(r._id)}" class="${st === 'pending' ? 'warn' : ''}">${cols.map((f) => `<td class="${f.type === 'num' || f.type === 'int' ? 'n' : ''}${f.pii ? ' pii' : ''}">${show(r[f.key], f)}</td>`).join('')}
        ${showNote ? `<td class="small">${esc(coordNote(r))}</td>` : ''}
        <td class="act">${st === 'pending' ? '<button class="btn sm ok" data-ds-verify title="ยืนยันว่าพิกัดถูกต้อง">✔ ยืนยันพิกัด</button> ' : ''}<button class="btn sm" data-ds-edit>แก้ไข</button>${T.ds.canDelete ? ' <button class="btn sm danger" data-ds-del>ลบ</button>' : ''}</td></tr>`;
      }).join('') : `<tr><td colspan="${cols.length + 2}" class="muted">ไม่พบรายการ${T.filter.coord === 'pending' ? 'ที่รอตรวจสอบ ✅' : ''}</td></tr>`) + '</tbody>';
    $('ds-pager').innerHTML = pages > 1 ? `<button class="btn sm" data-pg="-1" ${T.page ? '' : 'disabled'}>‹ ก่อนหน้า</button><span>หน้า ${T.page + 1} / ${pages}</span><button class="btn sm" data-pg="1" ${T.page < pages - 1 ? '' : 'disabled'}>ถัดไป ›</button>` : '';
  }

  // ---------- ฟอร์มเพิ่ม/แก้ไข ----------
  const YEARS = () => { const max = Math.max(2568, ...T.rows.map((r) => +r.year || 0)) + 1; return Array.from({ length: max - 2556 + 1 }, (_, i) => max - i); };
  function input(f, v, row) {
    const val = v === null || v === undefined ? '' : v;
    const lab = `${f.pii ? '🔒 ' : ''}${esc(f.label)}${f.required ? ' *' : ''}`;
    const span = f.type === 'long' || /name/.test(f.key) ? ' class="span2"' : '';
    const opt = (o, cur) => `<option value="${esc(o)}" ${String(o) === String(cur) ? 'selected' : ''}>${esc(o)}</option>`;
    // อำเภอ: เลือกชื่อ ระบบเติมรหัสให้ (ซ่อนช่องรหัสอำเภอ)
    if (f.key === 'district' && has(T.ds, 'district_code')) {
      return `<label>${lab}<select name="district" ${T.ds.fields.find((x) => x.key === 'district_code').required ? 'required' : ''}><option value=""></option>${districts().map((d) => opt(d.district, val)).join('')}</select></label>`;
    }
    if (f.key === 'district_code' && has(T.ds, 'district')) return '';
    if (T.ds.name === 'crops' && f.key === 'crop') {
      const list = [...new Set((A().S.crops || []).concat(T.rows.map((r) => r.crop)))];
      return `<label>${lab}<select name="crop" required><option value=""></option>${list.map((c) => opt(c, val)).join('')}${isSuper() ? '<option value="__new">➕ ชนิดพืชใหม่…</option>' : ''}</select>
        <input name="crop_new" class="hidden" placeholder="ชื่อชนิดพืชใหม่ (Super Admin)" maxlength="60" />${isSuper() ? '' : '<small class="muted">เพิ่มชนิดพืชใหม่ได้เฉพาะ Super Admin</small>'}</label>`;
    }
    if (f.type === 'year') return `<label>${lab}<select name="${f.key}" ${f.required ? 'required' : ''}><option value=""></option>${YEARS().map((y) => opt(y, val)).join('')}</select></label>`;
    if (f.type === 'bool') return `<label class="chk"${span}><input type="checkbox" name="${f.key}" ${val ? 'checked' : ''} /> ${lab}</label>`;
    if (f.type === 'long') return `<label${span}>${lab}<textarea name="${f.key}" rows="3" maxlength="600">${esc(val)}</textarea></label>`;
    if (f.options) return `<label${span}>${lab}<select name="${f.key}"><option value=""></option>${f.options.map((o) => opt(o, val)).join('')}</select></label>`;
    const num = ['int', 'num', 'lat', 'lng'].includes(f.type);
    const step = f.type === 'int' ? '1' : 'any';
    const hint = T.ds.name === 'crops' && /^yield_/.test(f.key) ? '<small class="muted">เว้นว่าง = คำนวณจากผลผลิต ÷ เนื้อที่</small>' : f.pii ? '<small class="muted">ข้อมูลส่วนบุคคล — ไม่แสดงบนเว็บสาธารณะ</small>' : '';
    const v2 = T.ds.name === 'crops' && /^yield_/.test(f.key) && !row ? '' : val;
    return `<label${span}>${lab}<input name="${f.key}" ${num ? `type="number" step="${step}" inputmode="decimal"` : f.type === 'phone' ? 'type="tel"' : ''} value="${esc(v2)}" ${f.required ? 'required' : ''} />${hint}</label>`;
  }
  function openForm(row) {
    T.editing = row || null;
    $('ds-form-h').textContent = (row ? 'แก้ไข: ' : 'เพิ่มแถวใหม่: ') + T.ds.label;
    $('ds-fields').innerHTML = T.ds.fields.map((f) => (f.key === 'id' && !row) ? '' : (row && f.key === 'id') ? `<label>${esc(f.label)}<input value="${esc(row[f.key])}" disabled /></label>`
      : input(f, row ? row[f.key] : (f.type === 'bool' ? false : ''), row)).join('');
    const cs = $('ds-form').elements.crop;
    if (cs) cs.addEventListener('change', () => { $('ds-form').elements.crop_new.classList.toggle('hidden', cs.value !== '__new'); });
    $('ds-msg').textContent = ''; $('ds-msg').className = 'form-msg';
    $('ds-dialog').showModal();
    picker(row);
  }

  // ---------- แผนที่เลือกพิกัด ----------
  let PM = null;
  function picker(row) {
    const wrap = $('ds-pickmap-wrap');
    const on = has(T.ds, 'lat');
    wrap.classList.toggle('hidden', !on);
    if (!on || !window.L) return;
    const fe = $('ds-form').elements;
    const get = () => { const la = parseFloat(fe.lat.value), lo = parseFloat(fe.lng.value); return isFinite(la) && isFinite(lo) ? [la, lo] : null; };
    geo().then((G) => {
      if (!PM) {
        PM = { map: L.map('ds-pickmap', { zoomSnap: 0.25 }), marker: null };
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 18, attribution: 'Imagery © Esri' }).addTo(PM.map);
        PM.dist = L.geoJSON(G, { style: { color: '#ffd400', weight: 1.5, fill: false }, interactive: false }).addTo(PM.map);
        PM.map.on('click', (e) => place([e.latlng.lat, e.latlng.lng], true));
      }
      setTimeout(() => {
        PM.map.invalidateSize();
        const p = get();
        if (p) { place(p, false); PM.map.setView(p, 13); } else { if (PM.marker) { PM.map.removeLayer(PM.marker); PM.marker = null; } PM.map.fitBounds(PM.dist.getBounds()); msg(); }
      }, 60);
    });
    function place(p, fromMap) {
      if (!PM.marker) {
        PM.marker = L.marker(p, { draggable: true, autoPan: true, icon: L.divIcon({ className: 'pick-pin', html: '<span></span>', iconSize: [26, 26], iconAnchor: [13, 26] }) }).addTo(PM.map);
        PM.marker.on('dragend', () => { const ll = PM.marker.getLatLng(); place([ll.lat, ll.lng], true); });
      } else PM.marker.setLatLng(p);
      if (fromMap) { fe.lat.value = p[0].toFixed(6); fe.lng.value = p[1].toFixed(6); }
      msg();
    }
    function msg() {
      const p = get(), out = $('ds-pick-msg');
      if (!p) { out.innerHTML = '<span class="muted">ยังไม่มีพิกัด</span>'; return; }
      const at = SoilParser.districtAt(p[0], p[1], GEO);
      const want = fe.district ? fe.district.value : '';
      out.innerHTML = !at ? '<span class="bad">⚠️ อยู่นอกจังหวัดกำแพงเพชร</span>'
        : want && at.name !== want ? `<span class="bad">⚠️ อยู่ใน อ.${esc(at.name)} แต่เลือก อ.${esc(want)}</span>` : `<span class="good">✓ อยู่ใน อ.${esc(at.name)}</span>`;
    }
    const onType = () => { const p = get(); if (p) { place(p, false); PM.map.panTo(p); } else msg(); };
    fe.lat.oninput = onType; fe.lng.oninput = onType;
    if (fe.district) fe.district.addEventListener('change', msg);
  }

  async function save(e) {
    e.preventDefault();
    const fd = $('ds-form');
    const item = {};
    T.ds.fields.forEach((f) => {
      const el = fd.elements[f.key];
      if (!el || el.disabled) return;
      item[f.key] = f.type === 'bool' ? el.checked : el.value.trim();
    });
    if (item.crop === '__new') item.crop = fd.elements.crop_new.value.trim();
    if ('district' in item && has(T.ds, 'district_code')) item.district_code = codeOf(item.district);
    const r0 = T.editing;
    // ส่งเฉพาะช่องที่เปลี่ยน (ลดโอกาสบันทึกทับค่าที่ผู้อื่นแก้)
    if (r0) Object.keys(item).forEach((k) => { if (String(item[k]) === String(r0[k] ?? '')) delete item[k]; });
    // ผู้ดูแลแก้พิกัดเอง = ตรวจสอบแล้ว
    if (has(T.ds, 'lat') && ('lat' in item || 'lng' in item) && item.lat !== '') {
      const at = GEO ? SoilParser.districtAt(+(item.lat ?? r0.lat), +(item.lng ?? r0.lng), GEO) : null;
      const dname = item.district ?? (r0 && r0.district);
      const ok = at && (!dname || at.name === dname);
      if (T.ds.name === 'soil') { item.verified = !!ok; item.note = ok ? '' : (at ? `พิกัดอยู่ใน อ.${at.name} แต่ระบุ อ.${dname}` : 'พิกัดอยู่นอกจังหวัด'); }
      else if (has(T.ds, 'coord_note')) item.coord_note = ok ? 'ปรับพิกัดโดยผู้ดูแล' : (at ? 'พิกัดตกในอำเภอ' + at.name : 'พิกัดไม่ถูกต้อง (นอกจังหวัด)');
    }
    if (r0 && !Object.keys(item).length) { $('ds-dialog').close(); return; }
    $('ds-msg').textContent = 'กำลังบันทึก…'; $('ds-msg').className = 'form-msg';
    try {
      const res = await A().call('dsSave', { dataset: T.ds.name, id: r0 ? r0._id : null, v: r0 ? r0._v : null, item });
      $('ds-dialog').close();
      A().toast(res.message);
      if (r0) Object.assign(r0, res.item); else T.rows.push(res.item);
      coordCounts(); render();
    } catch (err) { formError($('ds-msg'), err, () => $('ds-dialog').close()); }
  }
  function formError(box, err, close) {
    box.className = 'form-msg err';
    box.textContent = /CONFLICT/.test(err.message) ? '⚠️ ' + err.message.replace(/CONFLICT:\s*/g, '') : err.message;
    if (/CONFLICT/.test(err.message)) { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn sm'; b.textContent = '🔄 โหลดตารางใหม่'; b.onclick = () => { close(); reload(); }; box.append(' ', b); }
  }
  async function verify(row) {
    if (!confirm(`ยืนยันว่าพิกัดของ "${row.name}" ถูกต้อง?\n(${row.lat}, ${row.lng})${coordNote(row) ? '\nหมายเหตุ: ' + coordNote(row) : ''}`)) return;
    const item = T.ds.name === 'soil' ? { verified: true, note: '' } : { coord_note: 'ตรวจสอบแล้ว' };
    try { const res = await A().call('dsSave', { dataset: T.ds.name, id: row._id, v: row._v, item }); Object.assign(row, res.item); A().toast(res.message); coordCounts(); render(); }
    catch (err) { A().toast(err.message); if (/CONFLICT/.test(err.message)) reload(); }
  }
  async function del(row) {
    const name = row.name || row.crop && `${row.crop} ${row.year} ${row.district}` || row._id;
    if (!confirm(`ลบ "${name}" ออกจาก ${T.ds.label}?\nระบบบันทึกค่าทั้งแถวไว้ในบันทึกการทำงาน`)) return;
    try {
      A().toast((await A().call('dsDelete', { dataset: T.ds.name, id: row._id, v: row._v })).message);
      T.rows = T.rows.filter((r) => r !== row); render();
    } catch (err) { A().toast(err.message); if (/^CONFLICT/.test(err.message)) reload(); }
  }

  // ---------- กรอกทั้งปี: พืช × ปี × 11 อำเภอ ----------
  const NUMS = [['planted', 'เนื้อที่เพาะปลูก (ไร่)'], ['harvested', 'เนื้อที่เก็บเกี่ยว (ไร่)'], ['production', 'ผลผลิต (ตัน)']];
  function openBulk() {
    const crops = [...new Set((A().S.crops || []).concat(T.rows.map((r) => r.crop)))];
    $('bulk-crop').innerHTML = crops.map((c) => `<option>${esc(c)}</option>`).join('');
    $('bulk-year').innerHTML = YEARS().map((y) => `<option>${y}</option>`).join('');
    if (T.filter.crop) $('bulk-crop').value = T.filter.crop;
    $('bulk-year').value = T.filter.year || String(Math.max(...T.rows.map((r) => +r.year)));
    $('bulk-msg').textContent = ''; $('bulk-msg').className = 'form-msg';
    bulkTable();
    $('ds-bulk-dialog').showModal();
  }
  function bulkTable() {
    const crop = $('bulk-crop').value, year = +$('bulk-year').value;
    const cur = {}, prev = {};
    T.rows.forEach((r) => { if (r.crop === crop && +r.year === year) cur[r.district_code] = r; if (r.crop === crop && +r.year === year - 1) prev[r.district_code] = r; });
    const n = Object.keys(cur).length;
    $('bulk-info').textContent = n ? `มีข้อมูลแล้ว ${n} อำเภอ (แก้ไขค่าได้)` : 'ยังไม่มีข้อมูลปีนี้ (เพิ่มใหม่)';
    $('bulk-table').innerHTML = `<thead><tr><th>อำเภอ</th>${NUMS.map(([, l]) => `<th>${l}</th>`).join('')}<th>ผลผลิต/ไร่ปลูก (กก.)</th><th>ผลผลิต/ไร่เก็บเกี่ยว (กก.)</th><th></th></tr></thead><tbody>` +
      districts().map((d) => {
        const r = cur[d.district_code];
        return `<tr data-code="${esc(d.district_code)}"><td><b>${esc(d.district)}</b></td>${NUMS.map(([k]) => `<td><input type="number" step="any" min="0" inputmode="decimal" data-k="${k}" value="${r ? r[k] : ''}" /></td>`).join('')}
          <td class="n" data-y="p"></td><td class="n" data-y="h"></td><td class="warn-cell"></td></tr>`;
      }).join('') + '</tbody><tfoot><tr><th>รวม</th><th class="n" data-sum="planted"></th><th class="n" data-sum="harvested"></th><th class="n" data-sum="production"></th><th class="n" data-sum="yp"></th><th class="n" data-sum="yh"></th><th></th></tr></tfoot>';
    T.bulk = { crop, year, cur, prev };
    bulkCalc();
  }
  function bulkCalc() {
    const sum = { planted: 0, harvested: 0, production: 0 };
    $('bulk-table').querySelectorAll('tbody tr').forEach((tr) => {
      const v = (k) => { const x = tr.querySelector(`[data-k="${k}"]`).value; return x === '' ? null : +x; };
      const p = v('planted'), h = v('harvested'), q = v('production');
      NUMS.forEach(([k]) => { sum[k] += v(k) || 0; });
      tr.querySelector('[data-y="p"]').textContent = p && q !== null ? A().fmt(q / p * 1000) : '';
      tr.querySelector('[data-y="h"]').textContent = h && q !== null ? A().fmt(q / h * 1000) : '';
      const w = [];
      if (p !== null && h !== null && h > p * 1.05) w.push('เนื้อที่เก็บเกี่ยวมากกว่าเนื้อที่ปลูก');
      const pv = T.bulk.prev[tr.dataset.code];
      if (pv) [['planted', 'เนื้อที่ปลูก'], ['production', 'ผลผลิต']].forEach(([k, l]) => {
        const a = v(k), b = +pv[k];
        if (a && b && (a / b > 3 || b / a > 3)) w.push(`${l}ต่างจากปี ${T.bulk.year - 1} (${A().fmt(b)}) เกิน 3 เท่า`);
      });
      const wc = tr.querySelector('.warn-cell');
      wc.textContent = w.length ? '⚠️' : ''; wc.title = w.join('\n');
      tr.classList.toggle('warn', !!w.length);
    });
    const ft = $('bulk-table').querySelector('tfoot');
    NUMS.forEach(([k]) => { ft.querySelector(`[data-sum="${k}"]`).textContent = A().fmt(sum[k]); });
    ft.querySelector('[data-sum="yp"]').textContent = sum.planted ? A().fmt(sum.production / sum.planted * 1000) : '';
    ft.querySelector('[data-sum="yh"]').textContent = sum.harvested ? A().fmt(sum.production / sum.harvested * 1000) : '';
  }
  async function bulkSave(e) {
    e.preventDefault();
    const { crop, year, cur } = T.bulk, items = [];
    $('bulk-table').querySelectorAll('tbody tr').forEach((tr) => {
      const code = tr.dataset.code, r = cur[code];
      const vals = {}; NUMS.forEach(([k]) => { vals[k] = tr.querySelector(`[data-k="${k}"]`).value.trim(); });
      if (r) {
        const ch = {}; NUMS.forEach(([k]) => { const nv = vals[k] === '' ? 0 : +vals[k]; if (nv !== +r[k]) ch[k] = nv; });
        if (Object.keys(ch).length) items.push({ id: r._id, v: r._v, item: ch });
      } else if (NUMS.some(([k]) => vals[k] !== '')) {
        const d = districts().find((x) => x.district_code === code);
        items.push({ item: { year, crop, district_code: code, district: d.district, planted: +vals.planted || 0, harvested: +vals.harvested || 0, production: +vals.production || 0 } });
      }
    });
    if (!items.length) { $('bulk-msg').className = 'form-msg'; $('bulk-msg').textContent = 'ไม่มีการเปลี่ยนแปลง'; return; }
    const warns = $('bulk-table').querySelectorAll('tbody tr.warn').length;
    if (warns && !confirm(`มี ${warns} อำเภอที่ค่าผิดปกติ (⚠️) ยืนยันบันทึก?`)) return;
    $('bulk-msg').className = 'form-msg'; $('bulk-msg').textContent = `กำลังบันทึก ${items.length} แถว…`;
    try {
      const res = await A().call('dsSaveMany', { dataset: 'crops', items });
      $('ds-bulk-dialog').close();
      A().toast(res.message);
      await reload();
    } catch (err) { formError($('bulk-msg'), err, () => $('ds-bulk-dialog').close()); }
  }

  // =====================================================================
  // ศูนย์รวมการนำเข้าข้อมูล (แท็บ "นำเข้าข้อมูล")
  // =====================================================================
  const TPL = {
    crops: ['template_crops.xlsx', 'หนึ่งชีต = หนึ่งชนิดพืช × หนึ่งปี (มีชื่อ 11 อำเภอให้แล้ว) · ไฟล์ Excel/CSV/PDF รูปแบบอื่นก็นำเข้าได้'],
    soil: ['template_soil.xlsx', 'รูปแบบเดียวกับทำเนียบ ศดปช. · นำเข้าแบบแทนที่ทั้งชุด'],
    farm: ['template_farm.xlsx', 'หัวคอลัมน์ตรงกับไฟล์ส่งออกจากระบบแปลงใหญ่ (ใช้ไฟล์จากระบบได้โดยตรง) · หรือใช้ไฟล์พิกัด (ชื่อแปลงใหญ่ + X/Y) เพื่อปรับเฉพาะพิกัด'],
    pest: ['template_pest.xlsx', 'รูปแบบเดียวกับไฟล์ส่งออกจากระบบ ศจช. (ใช้ไฟล์จากระบบได้โดยตรง) · นำเข้าแบบแทนที่ทั้งชุด'],
    lc: ['template_lc.xlsx', 'นำเข้าแบบแทนที่ทั้งชุด · รายการเดิมใส่รหัสเดิมเพื่อคงข้อมูลส่วนบุคคล'],
    lcnet: ['template_lcnet.xlsx', 'มีชื่อ 11 อำเภอให้แล้ว กรอกเฉพาะจำนวน'],
    lctype: ['template_lctype.xlsx', 'หนึ่งแถวต่อหนึ่งประเภท'],
  };
  async function importInit(pick) {
    await ensureSchema();
    if (!T.imp) {
      $('imp-pick').innerHTML = T.schema.map((d) => `<button class="chip" data-imp="${d.name}">${esc(d.label)}</button>`).join('');
      $('imp-pick').addEventListener('click', (e) => { const b = e.target.closest('[data-imp]'); if (b) selectImport(b.dataset.imp); });
      $('gen-file').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importFile(f); });
    }
    selectImport(pick || (T.imp && T.imp.name) || 'crops');
  }
  function selectImport(name) {
    const d = T.schema.find((x) => x.name === name);
    T.imp = d;
    document.querySelectorAll('#imp-pick .chip').forEach((c) => c.classList.toggle('on', c.dataset.imp === name));
    const [file, note] = TPL[name] || ['', ''];
    $('tpl-link').href = 'assets/templates/' + file;
    $('tpl-link').setAttribute('download', file);
    $('tpl-link').textContent = `⬇️ ดาวน์โหลด Template ${d.label} (.xlsx)`;
    $('tpl-note').textContent = note;
    $('imp-crops').hidden = name !== 'crops';
    $('imp-soil').hidden = name !== 'soil';
    $('imp-generic').hidden = name === 'crops' || name === 'soil';
    $('gen-title').textContent = d.label;
    $('gen-desc').textContent = (d.note || '').replace(/ได้ที่แท็บ "นำเข้าข้อมูล"/, 'ได้ที่นี่').replace(/ · นำเข้า[^·]*ใช้แท็บ "นำเข้าข้อมูล"/, '') || 'เลือกไฟล์ Template ที่กรอกแล้ว ระบบแสดงตัวอย่างก่อนยืนยัน';
    $('gen-preview').innerHTML = '';
    T.pending = null;
  }

  async function importFile(file) {
    const d = T.imp, box = $('gen-preview');
    box.innerHTML = '<p class="muted">กำลังอ่านไฟล์…</p>';
    try {
      const [grids, G, cur] = await Promise.all([A().toGrids(file).then((x) => x.map((g) => g.grid)), geo(), A().call('dsList', { dataset: d.name }).then((r) => r.rows)]);
      const ctx = { districts: districts(), geo: G };
      let plan = null, probs = [];
      if (d.name === 'farm') {
        const res = grids.map((g) => FarmParser.parse(g, ctx));
        const farms = res.filter((r) => r.kind === 'farms').flatMap((r) => r.rows);
        const coords = res.filter((r) => r.kind === 'coords').flatMap((r) => r.rows);
        if (farms.length) {
          const old = {}; cur.forEach((r) => { old[r.id] = r; });
          farms.forEach((f) => { const o = old[f.id]; if (o && f.lat === null && o.lat !== null) { f.lat = o.lat; f.lng = o.lng; f.coord_note = o.coord_note; } });
          farms.filter((f) => /ไม่ถูกต้อง/.test(f.coord_note)).forEach((f) => probs.push(`${f.name}: ${f.coord_note}`));
          plan = { mode: 'replace', rows: farms, html: `<b>กลุ่มแปลงใหญ่</b>: ${farms.length} กลุ่มของจังหวัดกำแพงเพชร (ข้ามจังหวัดอื่น ${res.reduce((a, r) => a + (r.skipped || 0), 0)} แถว) · มีพิกัด ${farms.filter((f) => f.lat !== null).length} กลุ่ม · จะ<b>แทนที่ข้อมูลทั้งชุด</b> โดยคงพิกัดเดิมของกลุ่มที่รหัสตรงกัน` };
        } else if (coords.length) {
          const copy = cur.map((r) => ({ id: r.id, name: r.name, lat: null, lng: null, coord_note: '' }));
          const m = FarmParser.applyCoords(copy, coords);
          probs = m.unmatched;
          plan = { mode: 'upsert', rows: copy.filter((r) => r.lat !== null), html: `<b>ไฟล์พิกัดแปลงใหญ่</b>: ${coords.length} รายการ · จับคู่ได้ ${m.matched} กลุ่ม · จะ<b>ปรับเฉพาะพิกัด</b>` };
        }
      } else if (d.name === 'pest') {
        const res = grids.map((g) => PestParser.parse(g, ctx)).filter((r) => r.kind === 'pest');
        const rows = res.flatMap((r) => r.rows); probs = res.flatMap((r) => r.problems);
        const old = {}; cur.forEach((r) => { old[r.full_name || r.name] = r; });
        rows.forEach((r) => { const o = old[r.full_name] || old[r.name]; r.id = o ? o.id : ''; if (o && !r.chair) r.chair = o.chair; });
        if (rows.length) plan = { mode: 'replace', rows, html: `<b>ทำเนียบ ศจช.</b>: ${rows.length} ศูนย์ (ระดับชั้นปี ${esc(res[0] ? res[0].levelYear : '-')}) · มีพิกัด ${rows.filter((r) => r.lat !== null).length} ศูนย์ · จะ<b>แทนที่ข้อมูลทั้งชุด</b> โดยคงรหัสเดิมของศูนย์ที่ชื่อตรงกัน` };
      } else {
        const g = grids.map((x) => GenericParser.parse(x, d, ctx)).find(Boolean);
        if (g) {
          probs = g.problems;
          // รายการที่ไม่ระบุรหัส: ใช้รหัสเดิมของชื่อเดียวกัน (คงข้อมูลส่วนบุคคล/ประวัติ)
          if (has(d, 'id') && has(d, 'name')) { const old = {}; cur.forEach((r) => { old[r.name] = r.id; }); g.rows.forEach((r) => { if (!r.id && old[r.name]) r.id = old[r.name]; }); }
          plan = { mode: 'replace', rows: g.rows, html: `<b>${esc(d.label)}</b>: ${g.rows.length} แถว · คอลัมน์ที่อ่านได้ ${g.cols.length} คอลัมน์ · จะ<b>แทนที่ข้อมูลทั้งชุด</b> (เดิม ${cur.length} แถว)` };
        }
      }
      if (!plan || !plan.rows.length) throw new Error('ไม่พบข้อมูลที่ใช้ได้ในไฟล์ — ตรวจว่าเลือกชุดข้อมูลถูกต้อง และหัวคอลัมน์ตรงกับ Template');
      T.pending = { ...plan, fileName: file.name, ds: d };
      const cols = d.fields.filter((f) => !f.pii && f.type !== 'long' && plan.rows.some((r) => r[f.key] !== undefined && r[f.key] !== '' && r[f.key] !== null)).slice(0, 7);
      box.innerHTML = `<div class="chkres">${plan.html}
        ${probs.length ? `<details open><summary>⚠️ ควรตรวจสอบ ${probs.length} รายการ (นำเข้าได้ แต่จะแสดงในตัวกรอง "รอตรวจสอบพิกัด")</summary><ul>${probs.slice(0, 50).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></details>` : ''}
        <div class="tbl-wrap"><table class="prev"><thead><tr>${cols.map((f) => `<th>${esc(f.label)}</th>`).join('')}</tr></thead><tbody>
        ${plan.rows.slice(0, 15).map((r) => `<tr>${cols.map((f) => `<td>${show(r[f.key], f)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
        ${plan.rows.length > 15 ? `<p class="muted small">แสดง 15 จาก ${plan.rows.length} แถว</p>` : ''}
        <div class="row-btns"><button class="btn primary" id="gen-go">✅ นำเข้า ${plan.rows.length} แถว</button><button class="btn" id="gen-cancel">ยกเลิก</button></div>
        <p class="muted small">ระบบสำรองชีตเดิมไว้ทุกครั้ง (5 ชุดล่าสุด)</p></div>`;
      $('gen-cancel').onclick = () => { box.innerHTML = ''; T.pending = null; };
      $('gen-go').onclick = async () => {
        const p = T.pending;
        if (p.mode === 'replace' && !confirm(`แทนที่ข้อมูล ${p.ds.label} ทั้งชุดด้วย ${p.rows.length} แถว?`)) return;
        try { A().toast((await A().call('dsImport', { dataset: p.ds.name, mode: p.mode, rows: p.rows, fileName: p.fileName })).message); box.innerHTML = `<div class="form-msg ok">✅ นำเข้าแล้ว — ตรวจ/แก้ไขรายแถวได้ที่แท็บ "ตารางข้อมูล"</div>`; }
        catch (err) { box.insertAdjacentHTML('beforeend', `<div class="form-msg err">${esc(err.message)}</div>`); }
      };
    } catch (err) { box.innerHTML = `<div class="form-msg err">${esc(err.message)}</div>`; }
  }

  // ---------- events ----------
  $('ds-pick').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ds]'); if (!b) return;
    document.querySelectorAll('#ds-pick .chip').forEach((x) => x.classList.toggle('on', x === b));
    T.ds = T.schema.find((d) => d.name === b.dataset.ds);
    $('ds-q').value = '';
    reload().catch((err) => A().toast(err.message));
  });
  $('ds-q').addEventListener('input', () => { T.page = 0; render(); });
  $('ds-pii').addEventListener('change', render);
  $('ds-reload').onclick = () => reload().catch((err) => A().toast(err.message));
  $('ds-add').onclick = () => openForm(null);
  $('ds-import-btn').onclick = () => { A().tab('import'); setTimeout(() => importInit(T.ds.name), 0); };
  $('ds-bulk').onclick = openBulk;
  $('bulk-crop').addEventListener('change', bulkTable);
  $('bulk-year').addEventListener('change', bulkTable);
  $('bulk-table').addEventListener('input', bulkCalc);
  $('bulk-form').addEventListener('submit', bulkSave);
  $('bulk-cancel').onclick = () => $('ds-bulk-dialog').close();
  $('ds-pager').addEventListener('click', (e) => { const b = e.target.closest('[data-pg]'); if (b) { T.page += +b.dataset.pg; render(); } });
  $('ds-table').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-id]'); if (!tr) return;
    const row = T.rows.find((r) => String(r._id) === tr.dataset.id);
    if (e.target.closest('[data-ds-edit]')) openForm(row);
    if (e.target.closest('[data-ds-del]')) del(row);
    if (e.target.closest('[data-ds-verify]')) verify(row);
  });
  $('ds-form').addEventListener('submit', save);
  $('ds-cancel').onclick = () => $('ds-dialog').close();

  return { load, reload, importInit };
})();
