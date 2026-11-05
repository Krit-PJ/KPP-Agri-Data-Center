// ===== App: state กลาง, routing, แถบไอคอนพืช, ลิงก์, ตัวนับ =====
(async function () {
  const C = window.APP_CONFIG;
  const D = window.AgriData;
  const VIEWS = ['map', 'dashboard', 'soil', 'farm', 'lc', 'request', 'links'];
  const HUB = ['soil', 'farm', 'lc']; // หน้า "ศูนย์และกลุ่ม"
  const state = { crop: null, year: null, years: [], metric: 'planted', openDistrict: null };

  // โลโก้
  const setLogo = (id, src) => { const el = document.getElementById(id); el.src = src; el.onerror = () => el.classList.add('err'); };
  setLogo('logo-doae', C.LOGO_DOAE);
  setLogo('logo-prov', C.LOGO_PROVINCE);

  let ctx;
  try { ctx = await D.load(); } catch (e) {
    document.getElementById('loading').innerHTML = `<p>โหลดข้อมูลไม่สำเร็จ: ${D.esc(e.message)}</p>`;
    return;
  }

  // สถานะเริ่มต้นจาก URL เช่น #dashboard?crop=อ้อย&years=2565,2566
  const parseHash = () => {
    const [v, q] = location.hash.replace('#', '').split('?');
    return { view: VIEWS.includes(v) ? v : 'map', q: new URLSearchParams(q || '') };
  };
  const latestOf = (crop) => Math.max(...ctx.rows.filter((r) => r.crop === crop).map((r) => r.year));
  function applyQuery(q) {
    const crop = q.get('crop');
    state.crop = ctx.crops.includes(crop) ? crop : (state.crop || ctx.crops[0]);
    const latest = latestOf(state.crop);
    const y = +q.get('year');
    state.year = y || state.year || latest;
    const ys = (q.get('years') || '').split(',').map(Number).filter(Boolean);
    if (ys.length) state.years = ys;
    else if (!state.years.length) state.years = [latest - 1, latest];
    if (q.get('metric') && D.METRICS[q.get('metric')]) state.metric = q.get('metric');
    // ลิงก์รูปแบบเดิม (soil=1 / layers=…) ยังเปิดได้ แต่จุดที่ตั้งย้ายไปอยู่หน้า "ศูนย์และกลุ่ม" แล้ว
  }
  applyQuery(parseHash().q);

  SmartMap.init(ctx, state);
  Dashboard.init(ctx, state);
  RequestForm.init(ctx);
  SoilView.init(ctx);
  FarmView.init(ctx);
  LcView.init(ctx);

  // ---------- แถบไอคอนพืช (ใช้ร่วมกันทั้งแผนที่และแดชบอร์ด) ----------
  function renderCropbar() {
    const bar = document.getElementById('cropbar');
    bar.innerHTML = ctx.crops.map((c) =>
      `<button class="crop-btn ${c === state.crop ? 'on' : ''}" role="tab" aria-selected="${c === state.crop}" data-crop="${D.esc(c)}" title="${D.esc(c)}">${CropIcons.svg(c, 34)}<span>${D.esc(c)}</span></button>`).join('');
    const on = bar.querySelector('.on');
    if (on) on.scrollIntoView({ block: 'nearest', inline: 'center' });
  }

  // ---------- routing ----------
  let current = null;
  function writeHash(view) {
    const q = new URLSearchParams();
    if (view === 'map' || view === 'dashboard') {
      q.set('crop', state.crop);
      if (view === 'map') { q.set('year', state.year); q.set('metric', state.metric); } else q.set('years', [...state.years].sort().join(','));
    }
    const h = '#' + view + (q.toString() ? '?' + q.toString() : '');
    if (location.hash !== h) history.replaceState(null, '', location.pathname + location.search + h);
  }
  function show(view) {
    const changed = current !== view;
    current = view;
    document.body.dataset.view = view;
    document.querySelectorAll('.view').forEach((s) => s.classList.toggle('active', s.id === 'view-' + view));
    document.querySelectorAll('[data-go]').forEach((b) => b.classList.toggle('on', b.dataset.go === view || (b.dataset.hub === '1' && HUB.includes(view))));
    document.getElementById('cropbar').classList.toggle('hidden', !(view === 'map' || view === 'dashboard'));
    renderCropbar();
    if (view === 'map') { SmartMap.render(); SmartMap.invalidate(); }
    if (view === 'dashboard') Dashboard.render();
    if (view === 'links') renderLinks();
    if (view === 'soil') SoilView.render();
    if (view === 'farm') FarmView.render();
    if (view === 'lc') LcView.render();
    if (changed) window.scrollTo(0, 0);
    writeHash(view);
  }
  window.addEventListener('hashchange', () => { const h = parseHash(); applyQuery(h.q); show(h.view); });
  window.App = { state, go: (v) => show(v), writeHash: () => writeHash(current) };

  // ---------- events ----------
  document.body.addEventListener('click', (e) => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.go) { show(t.dataset.go); return; }
    if (t.dataset.crop) {
      state.crop = t.dataset.crop;
      const ys = [...new Set(ctx.rows.filter((r) => r.crop === state.crop).map((r) => r.year))];
      if (!ys.includes(state.year)) state.year = Math.max(...ys);
      const kept = state.years.filter((y) => ys.includes(y));
      // ถ้าปีที่เลือกไว้ไม่มีครบในพืชใหม่ ให้กลับไปใช้ 2 ปีล่าสุดของพืชนั้น
      state.years = kept.length === state.years.length ? kept : [Math.max(...ys) - 1, Math.max(...ys)].filter((y) => ys.includes(y));
      show(current);
    }
    if (t.dataset.year) { state.year = +t.dataset.year; SmartMap.render(); writeHash('map'); }
    if (t.dataset.metric) { state.metric = t.dataset.metric; SmartMap.render(); writeHash('map'); }
    if (t.dataset.dyear) {
      const y = +t.dataset.dyear;
      state.years = state.years.includes(y) ? state.years.filter((x) => x !== y) : [...state.years, y];
      if (!state.years.length) state.years = [y];
      Dashboard.render(); writeHash('dashboard');
    }
  });

  // ---------- ลิงก์เชื่อมโยง ----------
  function renderLinks() {
    document.getElementById('link-grid').innerHTML = ctx.links.map((l) =>
      `<a class="card link-card" href="${D.esc(l.url)}" target="_blank" rel="noopener"><span class="ic">${D.esc(l.icon || '🔗')}</span>
        <span><b>${D.esc(l.title)}</b><small>${D.esc(l.description || l.url)}</small></span><span class="go">↗</span></a>`).join('');
    document.getElementById('about-src').textContent = ctx.source === 'api'
      ? 'ข้อมูลจาก Google Sheets (อัปเดตล่าสุด ' + new Date(ctx.updated).toLocaleString('th-TH') + ')'
      : 'กำลังแสดงข้อมูลจากไฟล์สำรอง';
    renderVisits();
  }

  // ---------- ตัวนับการเข้าใช้งาน ----------
  let visits = null;
  function renderVisits() {
    const el = document.getElementById('visit-stats');
    if (!visits) { el.innerHTML = `<div class="stat" style="grid-column:1/-1"><small>${API.enabled() ? 'กำลังโหลด…' : 'ตัวนับจะทำงานเมื่อเชื่อมต่อระบบหลังบ้านแล้ว'}</small></div>`; return; }
    el.innerHTML = [['วันนี้ (ครั้ง)', visits.today], ['ผู้เข้าชมวันนี้ (คน)', visits.todayVisitors], ['เดือนนี้ (ครั้ง)', visits.month], ['ทั้งหมด (ครั้ง)', visits.total]]
      .map(([l, v]) => `<div class="stat"><b>${D.fmt(v)}</b><small>${l}</small></div>`).join('');
  }
  async function countVisit() {
    if (!API.enabled()) return;
    try {
      const today = new Date().toISOString().slice(0, 10);
      let counted = false, newVisitor = false;
      try { counted = sessionStorage.getItem('kpp_hit') === today; } catch (e) { /* ignore */ }
      try { newVisitor = localStorage.getItem('kpp_seen') !== today; } catch (e) { newVisitor = true; }
      visits = counted ? await API.get('visits') : await API.get('hit', { v: newVisitor ? '1' : '0' });
      try { sessionStorage.setItem('kpp_hit', today); localStorage.setItem('kpp_seen', today); } catch (e) { /* ignore */ }
      const txt = `👁 ผู้เข้าชมวันนี้ ${D.fmt(visits.today)} ครั้ง · รวม ${D.fmt(visits.total)} ครั้ง`;
      document.querySelectorAll('[data-counter]').forEach((el) => { el.textContent = txt; el.hidden = false; });
      if (current === 'links') renderVisits();
    } catch (e) { console.warn('[counter]', e.message); }
  }

  document.getElementById('loading').classList.add('hide');
  show(parseHash().view);
  countVisit();
  let wasMobile = window.innerWidth < 760;
  window.addEventListener('resize', () => {
    if (current !== 'map') return;
    SmartMap.invalidate();
    const m = window.innerWidth < 760;
    if (m !== wasMobile) { wasMobile = m; SmartMap.render(); } // ตัวเลขเต็ม ↔ ตัวเลขย่อ
  });
})();
