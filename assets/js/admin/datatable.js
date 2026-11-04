// ===== ตารางข้อมูลแต่ละชั้นข้อมูล: ดู เพิ่ม แก้ไข ลบ นำเข้า =====
// ใช้ API: dsSchema, dsList, dsSave, dsDelete (Super Admin), dsImport
window.DataTable = (function () {
  'use strict';
  const A = () => window.AdminCtx;
  const $ = (id) => document.getElementById(id);
  const PAGE = 50;
  const T = { schema: null, ds: null, rows: [], page: 0, editing: null, pendingImport: null };
  const esc = (s) => A().esc(s);

  async function load() {
    if (!T.schema) {
      T.schema = await A().call('dsSchema');
      $('ds-pick').innerHTML = T.schema.map((d, i) => `<button class="chip ${i === 0 ? 'on' : ''}" data-ds="${d.name}">${esc(d.label)}</button>`).join('');
      T.ds = T.schema[0];
    }
    await reload();
  }
  async function reload() {
    $('ds-table').innerHTML = '<tbody><tr><td class="muted">กำลังโหลด…</td></tr></tbody>';
    const r = await A().call('dsList', { dataset: T.ds.name });
    T.rows = r.rows;
    T.page = 0;
    $('ds-note').hidden = !T.ds.note; $('ds-note').textContent = T.ds.note || '';
    $('ds-import-btn').classList.toggle('hidden', !T.ds.importable);
    $('ds-import').innerHTML = '';
    render();
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
    const cols = T.ds.fields.filter((f) => f.type !== 'long' && !f.pii && !/^(utm_|market_|commodity2|grouping|member_area|plot_farmers|coord_note)/.test(f.key));
    return cols.slice(0, pii ? 7 : 10).concat(pii ? T.ds.fields.filter((f) => f.pii) : []);
  }
  function filtered() {
    const q = $('ds-q').value.trim().toLowerCase();
    if (!q) return T.rows;
    const pii = $('ds-pii').checked;
    return T.rows.filter((r) => T.ds.fields.some((f) => (pii || !f.pii) && String(r[f.key] ?? '').toLowerCase().includes(q)));
  }
  function render() {
    const rows = filtered(), cols = columns();
    const pages = Math.max(1, Math.ceil(rows.length / PAGE));
    T.page = Math.min(T.page, pages - 1);
    const view = rows.slice(T.page * PAGE, (T.page + 1) * PAGE);
    $('ds-count').textContent = `${A().fmt(rows.length)} แถว` + (rows.length !== T.rows.length ? ` (จาก ${A().fmt(T.rows.length)})` : '');
    $('ds-table').innerHTML = `<thead><tr>${cols.map((f) => `<th>${f.pii ? '🔒 ' : ''}${esc(f.label)}</th>`).join('')}<th></th></tr></thead><tbody>` +
      (view.length ? view.map((r) => `<tr data-id="${esc(r._id)}">${cols.map((f) => `<td class="${f.type === 'num' || f.type === 'int' ? 'n' : ''}${f.pii ? ' pii' : ''}">${show(r[f.key], f)}</td>`).join('')}
        <td class="act"><button class="btn sm" data-ds-edit>แก้ไข</button>${T.ds.canDelete ? ' <button class="btn sm danger" data-ds-del>ลบ</button>' : ''}</td></tr>`).join('')
        : `<tr><td colspan="${cols.length + 1}" class="muted">ไม่พบรายการ</td></tr>`) + '</tbody>';
    $('ds-pager').innerHTML = pages > 1 ? `<button class="btn sm" data-pg="-1" ${T.page ? '' : 'disabled'}>‹ ก่อนหน้า</button><span>หน้า ${T.page + 1} / ${pages}</span><button class="btn sm" data-pg="1" ${T.page < pages - 1 ? '' : 'disabled'}>ถัดไป ›</button>` : '';
  }

  // ---------- ฟอร์มเพิ่ม/แก้ไข ----------
  function input(f, v) {
    const val = v === null || v === undefined ? '' : v;
    const lab = `${f.pii ? '🔒 ' : ''}${esc(f.label)}${f.required ? ' *' : ''}`;
    const span = f.type === 'long' || /name/.test(f.key) ? ' class="span2"' : '';
    if (f.type === 'bool') return `<label class="chk"${span}><input type="checkbox" name="${f.key}" ${val ? 'checked' : ''} /> ${lab}</label>`;
    if (f.type === 'long') return `<label${span}>${lab}<textarea name="${f.key}" rows="3" maxlength="600">${esc(val)}</textarea></label>`;
    if (f.options) return `<label${span}>${lab}<select name="${f.key}"><option value=""></option>${f.options.map((o) => `<option ${o === val ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></label>`;
    const num = ['int', 'num', 'year', 'lat', 'lng'].includes(f.type);
    const step = f.type === 'int' || f.type === 'year' ? '1' : 'any';
    return `<label${span}>${lab}<input name="${f.key}" ${num ? `type="number" step="${step}" inputmode="decimal"` : f.type === 'phone' ? 'type="tel"' : ''} value="${esc(val)}" ${f.required ? 'required' : ''} />${f.pii ? '<small class="muted">ข้อมูลส่วนบุคคล — ไม่แสดงบนเว็บสาธารณะ</small>' : ''}</label>`;
  }
  function openForm(row) {
    T.editing = row || null;
    const keyLocked = (f) => row && f.key === 'id';
    $('ds-form-h').textContent = (row ? 'แก้ไข: ' : 'เพิ่มแถวใหม่: ') + T.ds.label;
    $('ds-fields').innerHTML = T.ds.fields.map((f) => (f.key === 'id' && !row) ? '' : keyLocked(f) ? `<label>${esc(f.label)}<input value="${esc(row[f.key])}" disabled /></label>` : input(f, row ? row[f.key] : (f.type === 'bool' ? false : ''))).join('');
    $('ds-msg').textContent = ''; $('ds-msg').className = 'form-msg';
    $('ds-dialog').showModal();
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
    // ส่งเฉพาะช่องที่เปลี่ยน (ลดโอกาสบันทึกทับค่าที่ผู้อื่นแก้)
    const r0 = T.editing;
    if (r0) Object.keys(item).forEach((k) => { if (String(item[k]) === String(r0[k] ?? '')) delete item[k]; });
    if (r0 && !Object.keys(item).length) { $('ds-dialog').close(); return; }
    $('ds-msg').textContent = 'กำลังบันทึก…';
    try {
      const res = await A().call('dsSave', { dataset: T.ds.name, id: r0 ? r0._id : null, v: r0 ? r0._v : null, item });
      $('ds-dialog').close();
      A().toast(res.message);
      if (r0) Object.assign(r0, res.item); else T.rows.push(res.item);
      render();
    } catch (err) {
      $('ds-msg').className = 'form-msg err';
      $('ds-msg').textContent = /^CONFLICT/.test(err.message) ? err.message.replace(/^CONFLICT:\s*/, '⚠️ ') : err.message;
      if (/^CONFLICT/.test(err.message)) { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn sm'; b.textContent = '🔄 โหลดตารางใหม่'; b.onclick = () => { $('ds-dialog').close(); reload(); }; $('ds-msg').append(' ', b); }
    }
  }
  async function del(row) {
    const name = row.name || row.crop && `${row.crop} ${row.year} ${row.district}` || row._id;
    if (!confirm(`ลบ "${name}" ออกจาก ${T.ds.label}?\nระบบบันทึกค่าทั้งแถวไว้ในบันทึกการทำงาน`)) return;
    try {
      A().toast((await A().call('dsDelete', { dataset: T.ds.name, id: row._id, v: row._v })).message);
      T.rows = T.rows.filter((r) => r !== row); render();
    } catch (err) { A().toast(err.message); if (/^CONFLICT/.test(err.message)) reload(); }
  }

  // ---------- นำเข้าไฟล์ ----------
  // แปลงใหญ่: ไฟล์ส่งออกระบบแปลงใหญ่ (แทนที่ทั้งชุด) หรือไฟล์พิกัด (ปรับเฉพาะพิกัด)
  // ชุดอื่น: ตารางที่มีหัวคอลัมน์ตรงกับชื่อช่อง (key หรือป้ายชื่อ) → แทนที่ทั้งชุด
  function genericParse(grid) {
    const norm = (v) => String(v ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
    const want = T.ds.fields.map((f) => [f.key, norm(f.key), norm(f.label).replace(/^🔒\s*/, '')]);
    for (let r = 0; r < Math.min(grid.length, 15); r++) {
      const h = (grid[r] || []).map(norm);
      const map = {};
      want.forEach(([k, a, b]) => { const i = h.findIndex((x) => x === a || x === b); if (i >= 0) map[k] = i; });
      if (Object.keys(map).length >= 2) {
        const rows = grid.slice(r + 1).filter((row) => row && row.some((v) => String(v ?? '').trim() !== ''))
          .map((row) => { const o = {}; Object.entries(map).forEach(([k, i]) => { o[k] = row[i] ?? ''; }); return o; });
        return { rows, cols: Object.keys(map) };
      }
    }
    return null;
  }
  async function importFile(file) {
    const box = $('ds-import');
    box.innerHTML = '<p class="muted">กำลังอ่านไฟล์…</p>';
    try {
      const grids = (await A().toGrids(file)).map((g) => g.grid);
      let plan = null;
      if (T.ds.name === 'farm') {
        const res = grids.map((g) => FarmParser.parse(g, { districts: A().S.districts }));
        const farms = res.filter((r) => r.kind === 'farms').flatMap((r) => r.rows);
        const coords = res.filter((r) => r.kind === 'coords').flatMap((r) => r.rows);
        if (farms.length) {
          plan = { mode: 'replace', rows: farms, html: `<b>ไฟล์ส่งออกระบบแปลงใหญ่</b>: ${farms.length} กลุ่มของจังหวัดกำแพงเพชร (ข้ามจังหวัดอื่น ${res.reduce((a, r) => a + (r.skipped || 0), 0)} แถว) · จะ<b>แทนที่ข้อมูลทั้งชุด</b> โดยคงพิกัดเดิมของกลุ่มที่รหัสตรงกัน` };
          const old = {}; T.rows.forEach((r) => { old[r.id] = r; });
          farms.forEach((f) => { const o = old[f.id]; if (o && f.lat === null && o.lat !== null) { f.lat = o.lat; f.lng = o.lng; f.coord_note = o.coord_note; } });
        } else if (coords.length) {
          const copy = T.rows.map((r) => ({ id: r.id, name: r.name, lat: null, lng: null, coord_note: '' }));
          const m = FarmParser.applyCoords(copy, coords);
          const rows = copy.filter((r) => r.lat !== null);
          plan = { mode: 'upsert', rows, html: `<b>ไฟล์พิกัดแปลงใหญ่</b>: ${coords.length} รายการ · จับคู่ได้ ${m.matched} กลุ่ม · จะ<b>ปรับเฉพาะพิกัด</b> ของกลุ่มที่จับคู่ได้` +
            (m.unmatched.length ? `<details><summary>จับคู่ไม่ได้หรือพิกัดไม่ถูกต้อง ${m.unmatched.length} รายการ</summary><ul>${m.unmatched.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></details>` : '') };
        }
      } else {
        const g = grids.map(genericParse).find(Boolean);
        if (g) plan = { mode: 'replace', rows: g.rows, html: `<b>${esc(T.ds.label)}</b>: ${g.rows.length} แถว · คอลัมน์ที่ใช้: ${g.cols.map(esc).join(', ')} · จะ<b>แทนที่ข้อมูลทั้งชุด</b>` };
      }
      if (!plan || !plan.rows.length) throw new Error('ไม่พบข้อมูลที่ใช้ได้ในไฟล์ (ตรวจสอบหัวคอลัมน์)');
      T.pendingImport = { ...plan, fileName: file.name };
      box.innerHTML = `<div class="chkres">${plan.html}<div class="row-btns"><button class="btn primary" id="ds-import-go">✅ นำเข้า ${plan.rows.length} แถว</button><button class="btn" id="ds-import-cancel">ยกเลิก</button></div><p class="muted small">ระบบสำรองชีตเดิมไว้ทุกครั้ง (5 ชุดล่าสุด)</p></div>`;
      $('ds-import-cancel').onclick = () => { box.innerHTML = ''; T.pendingImport = null; };
      $('ds-import-go').onclick = async () => {
        const p = T.pendingImport;
        if (p.mode === 'replace' && !confirm(`แทนที่ข้อมูล ${T.ds.label} ทั้งชุดด้วย ${p.rows.length} แถว?`)) return;
        try { A().toast((await A().call('dsImport', { dataset: T.ds.name, mode: p.mode, rows: p.rows, fileName: p.fileName })).message); await reload(); }
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
  $('ds-file').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importFile(f); });
  $('ds-pager').addEventListener('click', (e) => { const b = e.target.closest('[data-pg]'); if (b) { T.page += +b.dataset.pg; render(); } });
  $('ds-table').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-id]'); if (!tr) return;
    const row = T.rows.find((r) => String(r._id) === tr.dataset.id);
    if (e.target.closest('[data-ds-edit]')) openForm(row);
    if (e.target.closest('[data-ds-del]')) del(row);
  });
  $('ds-form').addEventListener('submit', save);
  $('ds-cancel').onclick = () => $('ds-dialog').close();

  return { load, reload };
})();
