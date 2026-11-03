// ===== ขอดาวน์โหลดข้อมูล + หน้ารับไฟล์ (?dl=token) =====
window.RequestForm = (function () {
  const C = window.APP_CONFIG;
  const D = window.AgriData;
  let ctx;

  function init(_ctx) {
    ctx = _ctx;
    document.getElementById('purpose-type').innerHTML = '<option value="">— เลือก —</option>' +
      C.PURPOSE_TYPES.map((p) => `<option>${D.esc(p)}</option>`).join('');
    document.getElementById('req-crops').innerHTML = ctx.crops.map((c) =>
      `<label><input type="checkbox" name="crops" value="${D.esc(c)}" /> ${CropIcons.svg(c, 22)} ${D.esc(c)}</label>`).join('');
    const years = [...new Set(ctx.rows.map((r) => r.year))].sort();
    const opts = (sel) => years.map((y) => `<option${y === sel ? ' selected' : ''}>${y}</option>`).join('');
    document.getElementById('req-from').innerHTML = opts(years[0]);
    document.getElementById('req-to').innerHTML = opts(years[years.length - 1]);
    document.getElementById('req-form').addEventListener('submit', submit);
    if (!API.enabled()) msg('ระบบขอข้อมูลจะใช้งานได้เมื่อเชื่อมต่อระบบหลังบ้าน (Apps Script) แล้ว', 'err');
    const token = new URLSearchParams(location.search).get('dl');
    if (token) ready(token);
  }

  function msg(t, cls) { const el = document.getElementById('req-msg'); el.className = 'form-msg ' + (cls || ''); el.textContent = t; }

  async function submit(e) {
    e.preventDefault();
    const fm = e.target, fd = new FormData(fm);
    const data = Object.fromEntries(fd.entries());
    data.crops = fd.getAll('crops');
    data.consent = !!fd.get('consent');
    const miss = ['name', 'position', 'agency', 'email', 'purposeType', 'purposeDetail'].filter((k) => !String(data[k] || '').trim());
    if (miss.length) { msg('กรุณากรอกข้อมูลที่มีเครื่องหมาย * ให้ครบ', 'err'); fm.elements[miss[0]].focus(); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(data.email)) { msg('อีเมลไม่ถูกต้อง', 'err'); fm.elements.email.focus(); return; }
    if (String(data.purposeDetail).trim().length < 10) { msg('กรุณาอธิบายการนำข้อมูลไปใช้ อย่างน้อย 10 ตัวอักษร', 'err'); return; }
    if (!data.consent) { msg('กรุณายินยอมการเก็บข้อมูลส่วนบุคคลก่อนส่งคำขอ', 'err'); return; }
    const btn = document.getElementById('req-submit');
    btn.disabled = true; btn.textContent = 'กำลังส่ง…';
    try {
      const r = await API.post('requestDownload', [data]);
      msg('✅ ' + r.message, 'ok');
      fm.reset();
    } catch (err) {
      msg(err.message, 'err');
    } finally {
      btn.disabled = false; btn.textContent = 'ส่งคำขอ';
    }
  }

  // ---------- หน้ารับไฟล์ ----------
  async function ready(token) {
    location.hash = 'request';
    const box = document.getElementById('dl-ready');
    box.innerHTML = '<div class="card dl-card">กำลังตรวจสอบลิงก์ดาวน์โหลด…</div>';
    try {
      const r = await API.get('download', { token });
      box.innerHTML = `<div class="card dl-card"><h3>✅ คำขอ ${D.esc(r.requestId)} ได้รับอนุมัติแล้ว</h3>
        <div>ผู้ขอ: ${D.esc(r.name)} · พืช: ${D.esc(r.crops)} · ${r.yearFrom ? 'ปี ' + D.esc(r.yearFrom) + '–' + D.esc(r.yearTo) : 'ทุกปี'} · ${D.fmt(r.rows.length)} แถว</div>
        <div class="muted">ลิงก์ใช้ได้ถึง ${D.esc(r.expires)} · ${D.esc(r.citation)}</div>
        <div class="dl-actions"><button class="btn primary" id="dl-csv">⬇️ ดาวน์โหลด CSV</button><button class="btn" id="dl-xlsx">⬇️ ดาวน์โหลด Excel</button></div></div>`;
      const head = ['ปี พ.ศ.', 'พืช', 'รหัสอำเภอ', 'อำเภอ', 'เนื้อที่เพาะปลูก (ไร่)', 'เนื้อที่เก็บเกี่ยว (ไร่)', 'ผลผลิต (ตัน)', 'ผลผลิตต่อไร่ ปลูก (กก.)', 'ผลผลิตต่อไร่ เก็บเกี่ยว (กก.)'];
      const name = `KPP_Agri_${r.requestId}`;
      document.getElementById('dl-csv').onclick = () => {
        const csv = '﻿' + [head].concat(r.rows).map((row) => row.map((v) => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v).join(',')).join('\r\n');
        save(new Blob([csv], { type: 'text/csv;charset=utf-8' }), name + '.csv');
      };
      document.getElementById('dl-xlsx').onclick = async () => {
        await loadScript('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js');
        const ws = XLSX.utils.aoa_to_sheet([head].concat(r.rows));
        ws['!cols'] = head.map((h, i) => ({ wch: i === 3 ? 16 : 14 }));
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'data');
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['แหล่งที่มา', r.citation], ['เลขที่คำขอ', r.requestId]]), 'อ้างอิง');
        XLSX.writeFile(wb, name + '.xlsx');
      };
    } catch (err) {
      box.innerHTML = `<div class="card dl-card" style="border-color:#f1b0a8;background:#fff6f5"><h3>ไม่สามารถดาวน์โหลดได้</h3><div>${D.esc(err.message)}</div></div>`;
    }
  }

  function save(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  function loadScript(src) {
    return new Promise((ok, bad) => { if ([...document.scripts].some((s) => s.src === src)) return ok(); const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = bad; document.head.appendChild(s); });
  }

  return { init };
})();
