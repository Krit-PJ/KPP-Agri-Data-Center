// ===== หน้าผู้ดูแลระบบ =====
(function () {
  'use strict';
  const I = window.Importer;
  const TOKEN_KEY = 'kpp_admin_token';
  const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs';
  const PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';
  const S = { token: '', me: null, districts: [], crops: [], tables: [], checked: null, reqStatus: 'pending', reqs: [] };
  try { S.token = sessionStorage.getItem(TOKEN_KEY) || ''; } catch (e) { /* ignore */ }

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (v, d = 0) => (v === null || v === undefined || v === '' || isNaN(v)) ? '–' : Number(v).toLocaleString('th-TH', { maximumFractionDigits: d });
  function toast(t) { const el = $('toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 3500); }
  function msg(id, t, cls) { const el = $(id); el.className = 'form-msg ' + (cls || ''); el.textContent = t || ''; }

  async function call(method, ...args) {
    try { return await API.post(method, args, S.token); }
    catch (e) {
      if (e.code === 'ADMIN_SESSION_EXPIRED') { logout(true); throw new Error('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่'); }
      throw e;
    }
  }

  // ---------- login ----------
  function showLogin() { $('login').classList.remove('hidden'); $('app').classList.add('hidden'); $('who').innerHTML = ''; }
  async function logout(expired) {
    if (!expired && S.token) { try { await API.post('adminLogout', [], S.token); } catch (e) { /* ignore */ } }
    S.token = ''; S.me = null;
    try { sessionStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignore */ }
    showLogin();
    if (expired) msg('login-msg', 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่', 'err');
  }
  $('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    msg('login-msg', 'กำลังตรวจสอบ…');
    try {
      const r = await API.post('adminLogin', [{ username: f.get('username'), password: f.get('password') }]);
      S.token = r.token;
      try { sessionStorage.setItem(TOKEN_KEY, r.token); } catch (err) { /* ignore */ }
      e.target.reset(); msg('login-msg', '');
      await enter();
    } catch (err) { msg('login-msg', err.message, 'err'); }
  });

  async function enter() {
    S.me = await call('adminMe');
    const b = await API.get('bootstrap');
    S.districts = b.districts; S.crops = b.crops;
    $('login').classList.add('hidden'); $('app').classList.remove('hidden');
    $('who').innerHTML = `<span class="nm"><b>${esc(S.me.name)}</b> (${esc(S.me.username)})</span><span class="role ${S.me.role}">${S.me.role === 'super' ? 'Super Admin' : 'Admin'}</span><button class="btn sm" id="btn-logout">ออกจากระบบ</button>`;
    $('btn-logout').onclick = () => logout(false);
    document.querySelectorAll('[data-super]').forEach((b) => b.classList.toggle('hidden', S.me.role !== 'super'));
    const want = location.hash.replace('#', '');
    tab(document.querySelector(`[data-tab="${want}"]:not(.hidden)`) ? want : 'import');
    refreshPending();
  }

  // ---------- tabs ----------
  const LOADERS = { history: loadHistory, requests: loadRequests, links: loadLinks, admins: loadAdmins, log: loadLog, soil: loadSoil, adminreq: loadAdminReq };
  function tab(name) {
    document.querySelectorAll('#adm-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.id === 'tab-' + name));
    history.replaceState(null, '', '#' + name);
    if (LOADERS[name]) LOADERS[name]().catch((e) => toast(e.message));
  }
  $('adm-tabs').addEventListener('click', (e) => { const b = e.target.closest('button[data-tab]'); if (b) tab(b.dataset.tab); });

  // =====================================================================
  // IMPORT
  // =====================================================================
  const drop = $('drop');
  ['dragover', 'dragenter'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => readFiles([...e.dataTransfer.files]));
  $('file').addEventListener('change', (e) => { readFiles([...e.target.files]); e.target.value = ''; });

  async function readFiles(files) {
    if (!files.length) return;
    msg('file-msg', 'กำลังอ่านไฟล์…');
    const errs = [];
    for (const f of files) {
      try {
        const grids = await toGrids(f);
        grids.forEach((g) => addTable(g.name, g.grid, f.name));
      } catch (e) { errs.push(f.name + ': ' + e.message); }
    }
    msg('file-msg', errs.length ? errs.join(' · ') : `อ่านแล้ว ${files.length} ไฟล์ พบ ${S.tables.length} ตาราง`, errs.length ? 'err' : '');
    renderTables();
  }

  async function toGrids(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext === 'csv' || file.type === 'text/csv') {
      const buf = await file.arrayBuffer();
      let text = new TextDecoder('utf-8').decode(buf);
      if ((text.match(/�/g) || []).length > 3) text = new TextDecoder('windows-874').decode(buf); // ไฟล์ CSV จาก Excel ภาษาไทยรุ่นเก่า
      return [{ name: file.name, grid: Papa.parse(text.replace(/^﻿/, ''), { skipEmptyLines: false }).data }];
    }
    if (ext === 'xlsx' || ext === 'xls') {
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      return wb.SheetNames.map((n) => ({ name: file.name + ' › ' + n, grid: XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' }) }));
    }
    if (ext === 'pdf' || file.type === 'application/pdf') {
      const pdfjs = await import(PDFJS);
      pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
      const out = [];
      for (let p = 1; p <= doc.numPages; p++) {
        const tc = await (await doc.getPage(p)).getTextContent();
        const grid = I.pdfItemsToGrid(tc.items);
        out.push({ name: `${file.name} › หน้า ${p}`, grid });
      }
      if (!out.some((o) => o.grid.length)) throw new Error('ไม่พบข้อความใน PDF (อาจเป็นไฟล์สแกน) กรุณาใช้ไฟล์ Excel/CSV แทน');
      return out;
    }
    throw new Error('ไม่รองรับไฟล์ชนิดนี้');
  }

  function ctxFor(t) { return { name: t.name, districts: S.districts, crops: S.crops, crop: t.userCrop || null, year: t.userYear || null }; }
  function addTable(name, grid, file) {
    const t = { id: Math.random().toString(36).slice(2), name, file, grid };
    Object.assign(t, I.extractTable(grid, ctxFor(t)));
    // PDF หลายหน้า: หน้าที่ไม่มีหัวตาราง ใช้การจับคู่คอลัมน์ของหน้าก่อนหน้า
    const prev = S.tables[S.tables.length - 1];
    if (t.headerRow < 0 && prev && prev.file === file && prev.headerRow >= 0) {
      Object.assign(t, I.extractTable([[]].concat(grid), Object.assign(ctxFor(t), { mapping: prev.mapping, headerRow: 0, crop: prev.crop, year: prev.year })));
      t.inherited = true;
    }
    t.include = t.rows.length > 0;
    S.tables.push(t);
  }
  function rebuild(t) {
    const keep = { include: t.include, userCrop: t.userCrop, userYear: t.userYear };
    Object.assign(t, I.extractTable(t.grid, Object.assign(ctxFor(t), { mapping: t.mapping, headerRow: t.headerRow })), keep);
    S.checked = null; renderTables();
  }

  const FIELD_OPTS = [['', '— ไม่ใช้ —']].concat(I.FIELDS.map((f) => [f, I.FIELD_LABEL[f]]));
  function renderTables() {
    const box = $('tables');
    box.innerHTML = S.tables.map((t) => {
      const fieldOf = (c) => (t.mapping[c] ? t.mapping[c].field : '');
      const hasCol = (f) => Object.values(t.mapping).some((m) => m.field === f);
      const valid = t.rows.filter((r) => !r.errors.length).length;
      const bad = t.rows.length - valid;
      const cropSel = hasCol('crop') ? '<span class="muted">พืช: จากคอลัมน์</span>' :
        `<label>พืช <select data-act="crop" data-t="${t.id}"><option value="">— เลือก —</option>${S.crops.map((c) => `<option ${c === t.crop ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>`;
      const yearSel = hasCol('year') ? '<span class="muted">ปี: จากคอลัมน์</span>' :
        `<label>ปี พ.ศ. <input type="number" min="2500" max="2700" style="width:90px" data-act="year" data-t="${t.id}" value="${t.year || ''}"></label>`;
      const cols = t.columns.map((c) => `<div class="mapcol ${fieldOf(c.index) ? 'used' : ''}"><span class="hdr" title="${esc(c.header)}">${esc(c.header)}</span>
        <select data-act="map" data-t="${t.id}" data-c="${c.index}">${FIELD_OPTS.map(([v, l]) => `<option value="${v}" ${v === fieldOf(c.index) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>`).join('');
      const rowsHtml = t.rows.slice(0, 12).map((r) => `<tr class="${r.errors.length ? 'bad' : ''} ${r.warn ? 'warn' : ''}" title="${esc(r.errors.concat(r.warn || []).join(' · '))}">
        <td>${esc(r.district)}</td><td>${esc(r.year || '?')}</td><td>${r.crop ? CropIcons.svg(r.crop, 18) + ' ' + esc(r.crop) : '?'}</td>
        ${I.NUM_FIELDS.map((f) => `<td class="n">${fmt(r[f], 2)}${r.computed && r.computed.includes(f) ? ' <small>คำนวณ</small>' : ''}</td>`).join('')}
        <td class="${r.errors.length ? 'err' : ''}">${r.errors.length ? esc(r.errors.join(', ')) : '✓'}</td></tr>`).join('');
      return `<div class="card tcard ${t.include ? '' : 'off'}">
        <div class="thead"><label><input type="checkbox" data-act="inc" data-t="${t.id}" ${t.include ? 'checked' : ''}> นำเข้า</label>
          <span class="tname">${esc(t.name)}</span>${t.headerRow >= 0 ? `<span class="muted">หัวตารางแถว ${t.headerRow + 1}${t.inherited ? ' (ใช้ของหน้าก่อน)' : ''}</span>` : ''}
          ${cropSel}${yearSel}<button class="btn sm danger" data-act="del" data-t="${t.id}">ลบตารางนี้</button></div>
        ${(t.problems.length || (t.warnings || []).length) ? `<div class="tmsg">${t.problems.map((p) => `<div class="p">⛔ ${esc(p)}</div>`).join('')}${(t.warnings || []).map((w) => `<div class="w">⚠️ ${esc(w)}</div>`).join('')}</div>` : ''}
        ${t.columns.length ? `<div class="mapgrid">${cols}</div>` : ''}
        ${t.rows.length ? `<div class="tbl-wrap"><table class="prev"><thead><tr><th>อำเภอ</th><th>ปี</th><th>พืช</th>${I.NUM_FIELDS.map((f) => `<th>${esc(I.FIELD_LABEL[f])}</th>`).join('')}<th>ตรวจ</th></tr></thead><tbody>${rowsHtml}</tbody></table></div>` : ''}
        <div class="sumline">พบ ${t.rows.length} แถว · ใช้ได้ <b>${valid}</b>${bad ? ` · <span style="color:var(--down)">ผิดพลาด ${bad}</span>` : ''}${t.rows.length > 12 ? ' · แสดงตัวอย่าง 12 แถวแรก' : ''}
          ${t.skipped.length ? ` · ข้าม ${t.skipped.length} แถวที่ไม่ใช่อำเภอ (เช่น ${esc(t.skipped.slice(0, 2).map((s) => s.text).join(' / '))})` : ''}</div>
      </div>`;
    }).join('');
    const sum = I.combine(S.tables);
    const errRows = S.tables.filter((t) => t.include).reduce((a, t) => a + t.rows.filter((r) => r.errors.length).length, 0);
    $('import-bar').classList.toggle('hidden', !S.tables.length);
    $('import-sum').innerHTML = `<b>พร้อมนำเข้า ${fmt(sum.rows.length)} แถว</b> จาก ${S.tables.filter((t) => t.include).length} ตาราง` +
      (errRows ? ` · <span style="color:var(--down)">มีแถวผิดพลาด ${errRows} แถว (จะไม่ถูกนำเข้า)</span>` : '') +
      (sum.duplicates.length ? ` · ⚠️ ซ้ำกัน ${sum.duplicates.length} คีย์ (ใช้ค่าจากตารางหลัง)` : '');
    $('btn-commit').disabled = !S.checked;
    if (!S.checked) $('check-result').innerHTML = '';
  }

  $('tables').addEventListener('change', (e) => {
    const el = e.target, t = S.tables.find((x) => x.id === el.dataset.t);
    if (!t) return;
    if (el.dataset.act === 'inc') { t.include = el.checked; S.checked = null; renderTables(); }
    if (el.dataset.act === 'crop') { t.userCrop = el.value || null; rebuild(t); }
    if (el.dataset.act === 'year') { t.userYear = +el.value || null; rebuild(t); }
    if (el.dataset.act === 'map') {
      const c = +el.dataset.c, f = el.value;
      Object.keys(t.mapping).forEach((k) => { if (t.mapping[k].field === f) delete t.mapping[k]; });
      if (f) t.mapping[c] = { field: f, factor: 1, header: t.columns[c].header }; else delete t.mapping[c];
      rebuild(t);
    }
  });
  $('tables').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act="del"]'); if (!b) return;
    S.tables = S.tables.filter((x) => x.id !== b.dataset.t); S.checked = null; renderTables();
  });

  $('btn-check').onclick = async () => {
    const { rows } = I.combine(S.tables);
    if (!rows.length) return toast('ไม่มีแถวที่พร้อมนำเข้า');
    $('check-result').innerHTML = '<div class="chkres">กำลังตรวจสอบ…</div>';
    try {
      const r = await call('importCheck', { rows });
      S.checked = r.errorCount ? null : rows;
      $('check-result').innerHTML = `<div class="chkres"><div class="nums"><span><b>${fmt(r.insert)}</b>แถวใหม่</span><span><b>${fmt(r.update)}</b>แก้ไขค่าเดิม</span>
        <span><b>${fmt(r.unchanged)}</b>เหมือนเดิม</span>${r.errorCount ? `<span style="color:var(--down)"><b>${r.errorCount}</b>ผิดพลาด</span>` : ''}</div>
        ${r.errors.length ? `<div class="form-msg err">${r.errors.slice(0, 10).map((x) => 'แถว ' + x.row + ': ' + esc(x.error)).join('<br>')}</div>` : ''}
        ${r.update ? '<div class="w tmsg" style="padding:6px 0">⚠️ มีการแก้ไขค่าที่มีอยู่แล้ว กรุณาตรวจตัวอย่างด้านล่างก่อนยืนยัน</div>' : ''}
        ${r.changes.length ? `<div class="tbl-wrap"><table class="diff"><thead><tr><th>ประเภท</th><th>ปี|พืช|อำเภอ</th>${I.NUM_FIELDS.map((f) => `<th>${esc(I.FIELD_LABEL[f])}</th>`).join('')}</tr></thead><tbody>
          ${r.changes.map((c) => `<tr><td>${c.type}</td><td>${esc(c.key)}</td>${c.after.map((v, i) => `<td class="n">${c.before && c.before[i] !== v ? `<span class="before">${fmt(c.before[i], 2)}</span> ` : ''}${fmt(v, 2)}</td>`).join('')}</tr>`).join('')}
        </tbody></table></div>` : ''}</div>`;
      $('btn-commit').disabled = !S.checked || (!r.insert && !r.update);
    } catch (e) { $('check-result').innerHTML = `<div class="form-msg err">${esc(e.message)}</div>`; }
  };

  $('btn-commit').onclick = async () => {
    if (!S.checked) return;
    if (!confirm('ยืนยันนำเข้าข้อมูล? ระบบจะสำรองข้อมูลเดิมไว้และย้อนกลับได้')) return;
    $('btn-commit').disabled = true;
    try {
      const files = [...new Set(S.tables.filter((t) => t.include).map((t) => t.file))].join(', ');
      const r = await call('importCommit', { rows: S.checked, fileName: files, note: $('import-note').value });
      toast(r.message);
      S.tables = []; S.checked = null; $('import-note').value = '';
      renderTables();
      $('import-bar').classList.remove('hidden');
      $('check-result').innerHTML = `<div class="form-msg ok">✅ ${esc(r.message)}${r.importId ? ' (เลขที่ ' + esc(r.importId) + ') ดูหรือย้อนกลับได้ที่แท็บประวัติการนำเข้า' : ''}</div>`;
    } catch (e) { toast(e.message); $('btn-commit').disabled = false; }
  };

  // =====================================================================
  // HISTORY
  // =====================================================================
  async function loadHistory() {
    const rows = await call('importList');
    $('hist-table').innerHTML = `<thead><tr><th>เลขที่</th><th>เวลา</th><th>ผู้นำเข้า</th><th>ไฟล์</th><th>แถว</th><th>ใหม่</th><th>แก้ไข</th><th>สถานะ</th><th></th></tr></thead><tbody>` +
      (rows.length ? rows.map((r) => `<tr><td>${esc(r.id)}</td><td>${esc(r.time)}</td><td>${esc(r.name)}</td><td>${esc(r.file)}${r.note ? '<br><small class="muted">' + esc(r.note) + '</small>' : ''}</td>
        <td class="n">${fmt(r.rows)}</td><td class="n">${fmt(r.insert)}</td><td class="n">${fmt(r.update)}</td>
        <td>${r.status === 'committed' ? '<span class="st approved">นำเข้าแล้ว</span>' : '<span class="st rejected">ย้อนกลับแล้ว</span>'}</td>
        <td>${r.canRollback ? `<button class="btn sm danger" data-rb="${esc(r.id)}">↩️ ย้อนกลับ</button>` : ''}</td></tr>`).join('')
        : '<tr><td colspan="9" class="muted">ยังไม่มีการนำเข้า</td></tr>') + '</tbody>';
  }
  $('hist-table').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-rb]'); if (!b) return;
    if (!confirm('ย้อนกลับการนำเข้า ' + b.dataset.rb + '? ข้อมูลจะกลับเป็นเหมือนก่อนนำเข้า')) return;
    try { toast((await call('importRollback', { id: b.dataset.rb })).message); loadHistory(); } catch (err) { toast(err.message); }
  });

  // =====================================================================
  // REQUESTS
  // =====================================================================
  async function refreshPending() {
    try { const p = await call('requestList', { status: 'pending' }); $('pending-badge').textContent = p.length || ''; } catch (e) { /* ignore */ }
    if (S.me && S.me.role === 'super') { try { const a = await call('adminRequestList', { status: 'pending' }); $('areq-badge').textContent = a.length || ''; } catch (e) { /* ignore */ } }
  }
  async function loadRequests() {
    S.reqs = await call('requestList', { status: S.reqStatus });
    const label = { pending: 'รอพิจารณา', approved: 'อนุมัติแล้ว', rejected: 'ไม่อนุมัติ' };
    $('req-list').innerHTML = S.reqs.length ? S.reqs.map((r) => `<div class="card req" data-id="${esc(r.id)}">
      <div class="top"><b>${esc(r.name)}</b><span class="muted">${esc(r.position)} · ${esc(r.agency)}</span><span class="st ${r.status}">${label[r.status] || r.status}</span><span class="muted" style="margin-left:auto">${esc(r.id)} · ${esc(r.time)}</span></div>
      <dl><dt>อีเมล / โทร</dt><dd>${esc(r.email)}${r.phone ? ' · ' + esc(r.phone) : ''}</dd>
        <dt>วัตถุประสงค์</dt><dd><b>${esc(r.purposeType)}</b> — ${esc(r.purposeDetail)}</dd>
        <dt>ข้อมูลที่ขอ</dt><dd>${esc(r.crops)} · ${r.yearFrom ? 'ปี ' + esc(r.yearFrom) + '–' + esc(r.yearTo) : 'ทุกปี'}</dd>
        ${r.decidedBy ? `<dt>ผู้พิจารณา</dt><dd>${esc(r.decidedBy)} · ${esc(r.decidedAt)}${r.note ? ' · ' + esc(r.note) : ''}</dd>` : ''}
        ${r.status === 'approved' ? `<dt>ลิงก์</dt><dd>หมดอายุ ${esc(r.expires)} · ดาวน์โหลดแล้ว ${r.downloads} ครั้ง${r.lastDownload ? ' (ล่าสุด ' + esc(r.lastDownload) + ')' : ''}</dd>` : ''}</dl>
      ${r.status === 'pending' ? `<textarea placeholder="หมายเหตุถึงผู้ขอ (จำเป็นเมื่อไม่อนุมัติ)" maxlength="500"></textarea>
        <div class="row-btns"><button class="btn sm ok" data-dec="approve">✅ อนุมัติและส่งลิงก์</button><button class="btn sm danger" data-dec="reject">✖ ไม่อนุมัติ</button></div>`
      : r.status === 'approved' ? '<div class="row-btns"><button class="btn sm" data-dec="approve">🔁 ส่งลิงก์ใหม่ (ต่ออายุ 7 วัน)</button></div>' : ''}
      <div class="out"></div></div>`).join('') : '<div class="card pad muted">ไม่มีคำขอ</div>';
  }
  $('req-filter').addEventListener('click', (e) => {
    const b = e.target.closest('[data-st]'); if (!b) return;
    S.reqStatus = b.dataset.st;
    document.querySelectorAll('#req-filter .chip').forEach((c) => c.classList.toggle('on', c === b));
    loadRequests().catch((err) => toast(err.message));
  });
  $('req-list').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-dec]'); if (!b) return;
    const card = b.closest('.req'), id = card.dataset.id, note = (card.querySelector('textarea') || {}).value || '';
    if (b.dataset.dec === 'reject' && !note.trim()) { toast('กรุณาระบุเหตุผลที่ไม่อนุมัติ'); return; }
    b.disabled = true;
    try {
      const r = await call('requestDecide', { id, decision: b.dataset.dec, note });
      toast(r.message);
      card.querySelector('.out').innerHTML = r.link ? `<div class="form-msg ${r.mailed ? 'ok' : 'err'}">${esc(r.message)}</div>
        <div class="linkbox"><input readonly value="${esc(r.link)}"><button class="btn sm" data-copy="${esc(r.link)}">คัดลอกลิงก์</button></div>` : `<div class="form-msg ok">${esc(r.message)}</div>`;
      card.querySelectorAll('[data-dec],textarea').forEach((x) => x.remove());
      const st = card.querySelector('.st'); st.className = 'st ' + (b.dataset.dec === 'approve' ? 'approved' : 'rejected'); st.textContent = b.dataset.dec === 'approve' ? 'อนุมัติแล้ว' : 'ไม่อนุมัติ';
      refreshPending();
    } catch (err) { toast(err.message); b.disabled = false; }
  });
  document.body.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-copy]'); if (!b) return;
    try { await navigator.clipboard.writeText(b.dataset.copy); toast('คัดลอกลิงก์แล้ว'); } catch (err) { toast('คัดลอกไม่ได้ กรุณาคัดลอกจากช่องข้อความ'); }
  });

  // =====================================================================
  // ADMIN ACCESS REQUESTS (super)
  // =====================================================================
  let areqStatus = 'pending';
  async function loadAdminReq() {
    const list = await call('adminRequestList', { status: areqStatus });
    const label = { pending: 'รอพิจารณา', approved: 'อนุมัติแล้ว', rejected: 'ไม่อนุมัติ' };
    $('areq-list').innerHTML = list.length ? list.map((r) => `<div class="card req" data-id="${esc(r.id)}">
      <div class="top"><b>${esc(r.name)}</b><span class="muted">${esc(r.position)} · ${esc(r.agency)}</span><span class="st ${r.status}">${label[r.status] || r.status}</span><span class="muted" style="margin-left:auto">${esc(r.id)} · ${esc(r.time)}</span></div>
      <dl><dt>เบอร์ (ชื่อผู้ใช้)</dt><dd><b>${esc(r.phone)}</b></dd><dt>อีเมล</dt><dd>${esc(r.email || '-')}</dd><dt>เหตุผล</dt><dd>${esc(r.reason || '-')}</dd>
        ${r.decidedBy ? `<dt>ผู้พิจารณา</dt><dd>${esc(r.decidedBy)} · ${esc(r.decidedAt)}${r.note ? ' · ' + esc(r.note) : ''}</dd>` : ''}</dl>
      ${r.status === 'pending' ? `<textarea placeholder="หมายเหตุ (จำเป็นเมื่อไม่อนุมัติ)" maxlength="300"></textarea>
        <div class="row-btns"><button class="btn sm ok" data-adec="approve">✅ อนุมัติเป็น Admin</button><button class="btn sm danger" data-adec="reject">✖ ไม่อนุมัติ</button></div>` : ''}
      <div class="out"></div></div>`).join('') : '<div class="card pad muted">ไม่มีคำขอ</div>';
  }
  $('areq-filter').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ast]'); if (!b) return;
    areqStatus = b.dataset.ast;
    document.querySelectorAll('#areq-filter .chip').forEach((c) => c.classList.toggle('on', c === b));
    loadAdminReq().catch((err) => toast(err.message));
  });
  $('areq-list').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-adec]'); if (!b) return;
    const card = b.closest('.req'), note = (card.querySelector('textarea') || {}).value || '';
    if (b.dataset.adec === 'reject' && !note.trim()) return toast('กรุณาระบุเหตุผลที่ไม่อนุมัติ');
    b.disabled = true;
    try {
      const r = await call('adminRequestDecide', { id: card.dataset.id, decision: b.dataset.adec, note });
      toast(r.message); card.querySelector('.out').innerHTML = `<div class="form-msg ok">${esc(r.message)}</div>`;
      card.querySelectorAll('[data-adec],textarea').forEach((x) => x.remove()); refreshPending();
    } catch (err) { toast(err.message); b.disabled = false; }
  });

  // =====================================================================
  // ศดปช.
  // =====================================================================
  let soil = [], soilFilter = 'pending', soilParsed = null, geo = null;
  async function loadSoil() {
    soil = await call('soilList');
    const rows = soil.filter((c) => !soilFilter || !c.verified);
    $('soil-admin-table').innerHTML = '<thead><tr><th>ศดปช.</th><th>อำเภอ</th><th>ประเภท</th><th>สมาชิก</th><th>Lat</th><th>Lng</th><th>หมายเหตุ</th><th>ประธาน (เฉพาะผู้ดูแล)</th><th></th></tr></thead><tbody>' +
      (rows.length ? rows.map((c) => `<tr data-id="${esc(c.id)}"><td><b>${esc(c.name)}</b><br><small class="muted">${esc(c.location)}</small></td><td>${esc(c.district)}</td><td>${esc(c.type)}</td><td class="n">${fmt(c.members)}</td>
        <td><input data-k="lat" value="${c.lat ?? ''}" inputmode="decimal"></td><td><input data-k="lng" value="${c.lng ?? ''}" inputmode="decimal"></td>
        <td>${c.verified ? '✅ ยืนยันแล้ว' : '<span class="chk-flag">⚠️ ' + esc(c.note || 'รอตรวจสอบ') + '</span>'}</td>
        <td>${esc(c.chair || '-')}<br><small class="muted">${esc(c.chair_phone || '')}</small></td>
        <td><button class="btn xs ok" data-sv="1">${c.verified ? 'บันทึก' : 'บันทึก + ยืนยัน'}</button>
          ${c.lat !== null ? `<a class="btn xs" target="_blank" rel="noopener" href="https://www.google.com/maps?q=${c.lat},${c.lng}">ดูพิกัด</a>` : ''}</td></tr>`).join('')
        : '<tr><td colspan="9" class="muted">ไม่มีรายการ' + (soilFilter ? 'ที่รอตรวจสอบ ✅' : '') + '</td></tr>') + '</tbody>';
  }
  $('soil-filter').addEventListener('click', (e) => {
    const b = e.target.closest('[data-sf]'); if (!b) return;
    soilFilter = b.dataset.sf;
    document.querySelectorAll('#soil-filter .chip').forEach((c) => c.classList.toggle('on', c === b));
    loadSoil().catch((err) => toast(err.message));
  });
  $('soil-admin-table').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-sv]'); if (!b) return;
    const tr = b.closest('tr'), v = (k) => tr.querySelector(`[data-k="${k}"]`).value.trim();
    b.disabled = true;
    try { toast((await call('soilUpdate', { id: tr.dataset.id, lat: v('lat'), lng: v('lng'), verified: true, note: '' })).message); loadSoil(); }
    catch (err) { toast(err.message); b.disabled = false; }
  });
  $('soil-file').addEventListener('change', async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    try {
      if (!geo) geo = await (await fetch('data/kpp_districts.json')).json();
      const grids = (await toGrids(f)).map((g) => g.grid);
      const rows = grids.flatMap((g) => SoilParser.parse(g, { geo, districts: S.districts }).rows);
      if (!rows.length) throw new Error('ไม่พบรายการ ศดปช. ในไฟล์ (ต้องมีหัวตาราง "ชื่อ ศดปช." และพิกัด)');
      soilParsed = { rows, file: f.name };
      const pend = rows.filter((r) => !r.verified).length;
      $('soil-preview').innerHTML = `<div class="chkres"><div class="nums"><span><b>${rows.length}</b>ศูนย์</span><span><b>${fmt(rows.reduce((a, r) => a + r.members, 0))}</b>สมาชิก</span>
        <span><b>${rows.filter((r) => r.type === 'หลัก').length}</b>หลัก</span><span><b>${rows.filter((r) => r.type === 'เครือข่าย').length}</b>เครือข่าย</span><span><b>${pend}</b>แก้พิกัด/รอตรวจ</span></div>
        <div class="tbl-wrap"><table class="prev"><thead><tr><th>ศดปช.</th><th>อำเภอ</th><th>ประเภท</th><th>สมาชิก</th><th>พิกัด</th><th>หมายเหตุ</th></tr></thead><tbody>
        ${rows.map((r) => `<tr class="${r.verified ? '' : 'warn'}"><td>${esc(r.name)}</td><td>${esc(r.district)}</td><td>${esc(r.type)}</td><td class="n">${fmt(r.members)}</td><td>${r.lat ?? '-'}, ${r.lng ?? '-'}</td><td><small>${esc(r.note)}</small></td></tr>`).join('')}
        </tbody></table></div><div class="row-btns"><button class="btn primary" id="soil-commit">✅ แทนที่ข้อมูล ศดปช. ทั้งชุด (${rows.length} ศูนย์)</button></div></div>`;
      $('soil-commit').onclick = async () => {
        if (!confirm('แทนที่ข้อมูล ศดปช. ทั้งหมดด้วยไฟล์นี้? ระบบจะสำรองข้อมูลเดิมไว้')) return;
        try { toast((await call('soilImport', { rows: soilParsed.rows, fileName: soilParsed.file })).message); $('soil-preview').innerHTML = ''; loadSoil(); }
        catch (err) { toast(err.message); }
      };
    } catch (err) { $('soil-preview').innerHTML = `<div class="form-msg err">${esc(err.message)}</div>`; }
  });

  // =====================================================================
  // LINKS (super)
  // =====================================================================
  let links = [];
  async function loadLinks() {
    links = await call('linkList');
    $('link-table').innerHTML = '<thead><tr><th>ลำดับ</th><th>ลิงก์</th><th>สถานะ</th><th>แก้ไขล่าสุด</th><th></th></tr></thead><tbody>' +
      links.map((l) => `<tr><td class="n">${l.order}</td><td>${esc(l.icon)} <b>${esc(l.title)}</b><br><a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.url)}</a><br><small class="muted">${esc(l.description)}</small></td>
        <td>${l.active ? '<span class="st approved">แสดง</span>' : '<span class="st rejected">ซ่อน</span>'}</td><td><small>${esc(l.updatedAt)}<br>${esc(l.updatedBy)}</small></td>
        <td><button class="btn sm" data-edit-link="${esc(l.id)}">แก้ไข</button> <button class="btn sm danger" data-del-link="${esc(l.id)}">ลบ</button></td></tr>`).join('') + '</tbody>';
  }
  $('link-table').addEventListener('click', async (e) => {
    const ed = e.target.closest('[data-edit-link]'), del = e.target.closest('[data-del-link]');
    if (ed) {
      const l = links.find((x) => x.id === ed.dataset.editLink), f = $('link-form');
      ['id', 'title', 'url', 'description', 'icon', 'order'].forEach((k) => { f.elements[k].value = l[k] ?? ''; });
      f.elements.active.checked = l.active; $('link-form-h').textContent = 'แก้ไขลิงก์'; f.scrollIntoView({ behavior: 'smooth' });
    }
    if (del && confirm('ลบลิงก์นี้?')) { try { toast((await call('linkDelete', { id: del.dataset.delLink })).message); loadLinks(); } catch (err) { toast(err.message); } }
  });
  $('link-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target, d = Object.fromEntries(new FormData(f).entries());
    d.active = f.elements.active.checked;
    try { toast((await call('linkSave', d)).message); f.reset(); f.elements.id.value = ''; $('link-form-h').textContent = 'เพิ่มลิงก์'; loadLinks(); } catch (err) { toast(err.message); }
  });
  $('link-reset').onclick = () => { $('link-form').elements.id.value = ''; $('link-form-h').textContent = 'เพิ่มลิงก์'; };

  // =====================================================================
  // ADMINS (super)
  // =====================================================================
  let admins = [];
  async function loadAdmins() {
    admins = await call('adminList');
    $('admin-table').innerHTML = '<thead><tr><th>ชื่อผู้ใช้</th><th>ชื่อ</th><th>บทบาท</th><th>สถานะ</th><th>เข้าใช้ล่าสุด</th><th></th></tr></thead><tbody>' +
      admins.map((a) => `<tr><td>${esc(a.username)}</td><td>${esc(a.name)}${a.phone ? '<br><small class="muted">' + esc(a.phone) + '</small>' : ''}</td>
        <td><span class="role ${a.role}">${a.role === 'super' ? 'Super Admin' : 'Admin'}</span></td><td>${a.status === 'active' ? 'ใช้งาน' : '<span style="color:var(--down)">ระงับ</span>'}</td>
        <td><small>${esc(a.lastLogin || '-')}</small></td>
        <td><button class="btn sm" data-edit-admin="${esc(a.username)}">แก้ไข</button> <button class="btn sm" data-pw-admin="${esc(a.username)}">ตั้งรหัสผ่านใหม่</button></td></tr>`).join('') + '</tbody>';
  }
  function adminFormMode(edit) {
    const f = $('admin-form');
    f.elements.username.readOnly = !!edit;
    $('pw-label').classList.toggle('hidden', !!edit);
    $('admin-form-h').textContent = edit ? 'แก้ไขผู้ดูแล' : 'เพิ่มผู้ดูแล';
  }
  $('admin-table').addEventListener('click', async (e) => {
    const ed = e.target.closest('[data-edit-admin]'), pw = e.target.closest('[data-pw-admin]');
    if (ed) {
      const a = admins.find((x) => x.username === ed.dataset.editAdmin), f = $('admin-form');
      ['username', 'name', 'role', 'status', 'phone'].forEach((k) => { f.elements[k].value = a[k] || ''; });
      adminFormMode(true); f.scrollIntoView({ behavior: 'smooth' });
    }
    if (pw) {
      const p = prompt('ตั้งรหัสผ่านใหม่ให้ ' + pw.dataset.pwAdmin + ' (อย่างน้อย 8 ตัว)');
      if (p) { try { toast((await call('adminResetPassword', { username: pw.dataset.pwAdmin, password: p })).message); } catch (err) { toast(err.message); } }
    }
  });
  $('admin-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target, d = Object.fromEntries(new FormData(f).entries());
    try { toast((await call('adminSave', d)).message); f.reset(); adminFormMode(false); loadAdmins(); } catch (err) { toast(err.message); }
  });
  $('admin-reset').onclick = () => adminFormMode(false);

  // =====================================================================
  // LOG (super)
  // =====================================================================
  async function loadLog() {
    const [v, a] = await Promise.all([call('visitStats'), call('auditList')]);
    const c = v.counts;
    $('log-visits').innerHTML = [['วันนี้ (ครั้ง)', c.today], ['ผู้เข้าชมวันนี้ (คน)', c.todayVisitors], ['เดือนนี้ (ครั้ง)', c.month], ['ทั้งหมด (ครั้ง)', c.total]]
      .map(([l, n]) => `<div class="stat"><b>${fmt(n)}</b><small>${l}</small></div>`).join('');
    $('visit-table').innerHTML = '<thead><tr><th>วันที่</th><th>ครั้ง</th><th>ผู้เข้าชม (คน)</th></tr></thead><tbody>' +
      v.daily.slice().reverse().map((d) => `<tr><td>${esc(d.date)}</td><td class="n">${fmt(d.visits)}</td><td class="n">${fmt(d.visitors)}</td></tr>`).join('') + '</tbody>';
    $('audit-table').innerHTML = '<thead><tr><th>เวลา</th><th>ผู้ใช้</th><th>การทำงาน</th><th>รายละเอียด</th></tr></thead><tbody>' +
      a.map((x) => `<tr><td><small>${esc(x.time)}</small></td><td>${esc(x.name)}<br><small class="muted">${esc(x.username)}</small></td><td>${esc(x.action)}</td><td>${esc(x.detail)}</td></tr>`).join('') + '</tbody>';
  }

  // =====================================================================
  // ACCOUNT
  // =====================================================================
  $('pw-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target).entries());
    if (d.next !== d.next2) return toast('รหัสผ่านใหม่ไม่ตรงกัน');
    try { toast((await call('adminChangePassword', { current: d.current, next: d.next })).message); e.target.reset(); } catch (err) { toast(err.message); }
  });
  $('btn-views').onclick = async () => { try { const r = await call('rebuildViews'); toast('สร้างแล้ว ' + r.views.length + ' ชีต'); } catch (e) { toast(e.message); } };

  // ---------- start ----------
  if (!API.enabled()) { showLogin(); msg('login-msg', 'ยังไม่ได้ตั้งค่า API_URL ใน assets/js/config.js (ดู docs/DEPLOY.md)', 'err'); return; }
  function showAreq() { $('login').classList.add('hidden'); $('areq').classList.remove('hidden'); }
  $('go-areq').addEventListener('click', (e) => { e.preventDefault(); history.replaceState(null, '', '#request-admin'); showAreq(); });
  $('go-claim').addEventListener('click', async (e) => {
    e.preventDefault();
    try { msg('login-msg', (await API.post('superClaimResend', [])).message, 'ok'); } catch (err) { msg('login-msg', err.message, 'err'); }
  });
  $('areq-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target).entries());
    d.phone = String(d.phone || '').replace(/\D/g, ''); d.consent = !!e.target.elements.consent.checked;
    if (!/^0\d{9}$/.test(d.phone)) return msg('areq-msg', 'เบอร์โทรศัพท์ต้องมี 10 หลัก', 'err');
    if (!d.name || !d.position || !d.agency) return msg('areq-msg', 'กรุณากรอกข้อมูลที่มี * ให้ครบ', 'err');
    if (String(d.password).length < 8) return msg('areq-msg', 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัว', 'err');
    if (d.password !== d.password2) return msg('areq-msg', 'รหัสผ่านไม่ตรงกัน', 'err');
    if (!d.consent) return msg('areq-msg', 'กรุณายินยอมการเก็บข้อมูลส่วนบุคคล', 'err');
    delete d.password2;
    try { const r = await API.post('adminRequest', [d]); msg('areq-msg', '✅ ' + r.message, 'ok'); e.target.reset(); }
    catch (err) { msg('areq-msg', err.message, 'err'); }
  });
  if (location.hash === '#request-admin') { showAreq(); return; }

  const claim = (location.hash.match(/^#claim=([0-9a-f]{64})$/) || [])[1];
  if (claim) {
    $('claim').classList.remove('hidden');
    $('claim-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      if (f.get('password') !== f.get('password2')) return msg('claim-msg', 'รหัสผ่านไม่ตรงกัน', 'err');
      try {
        const r = await API.post('adminClaim', [{ token: claim, password: f.get('password') }]);
        history.replaceState(null, '', location.pathname);
        $('claim').classList.add('hidden'); showLogin();
        msg('login-msg', '✅ ' + r.message, 'ok');
        document.querySelector('#login-form [name=username]').value = r.username;
      } catch (err) { msg('claim-msg', err.message, 'err'); }
    });
    return;
  }
  if (S.token) enter().catch(() => logout(true)); else showLogin();
})();
