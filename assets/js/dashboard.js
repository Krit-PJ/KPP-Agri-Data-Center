// ===== Dashboard รายพืช (โครงเดียวกับหน้า Power BI) =====
window.Dashboard = (function () {
  const C = window.APP_CONFIG;
  const D = window.AgriData;
  let ctx, state, charts = {};

  // ชุดสีจำแนกประเภท (ลำดับคงที่ ไม่วนสุ่ม) — ผ่าน validator สำหรับกราฟเส้น/แท่ง
  const CAT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
  const OTHER = '#a3abb5';
  let allYears = [];
  const yearColor = (y) => CAT[(allYears.indexOf(y) + CAT.length) % CAT.length]; // สีผูกกับปี ไม่ผูกกับลำดับที่เลือก
  const cropColor = (c) => { const i = C.CROPS.indexOf(c); return i >= 0 && i < CAT.length ? CAT[i] : OTHER; };

  Chart.defaults.font.family = "'Prompt', system-ui, sans-serif";
  Chart.defaults.color = '#4d5866';

  function init(_ctx, _state) {
    ctx = _ctx; state = _state;
    allYears = [...new Set(ctx.rows.map((r) => r.year))].sort();
    document.getElementById('foot').innerHTML =
      `ที่มาข้อมูล: สำนักงานเกษตรจังหวัดกำแพงเพชร · ฐานข้อมูล ${ctx.source === 'api' ? 'Google Sheets (อัปเดตสด)' : 'ไฟล์สำรองใน repo'} · ` +
      `ผลผลิตเฉลี่ย = ผลผลิต ÷ เนื้อที่เก็บเกี่ยว × 1,000`;
  }

  const cropYears = () => [...new Set(D.filter(ctx.rows, { crop: state.crop }).map((r) => r.year))].sort();

  function renderControls() {
    const ys = cropYears();
    state.years = state.years.filter((y) => ys.includes(y));
    if (!state.years.length) state.years = ys.slice(-2);
    document.getElementById('dash-years').innerHTML = ys
      .map((y) => `<button class="${state.years.includes(y) ? 'on' : ''}" data-dyear="${y}">${y}</button>`).join('');
  }

  function kpis() {
    const rs = D.filter(ctx.rows, { crop: state.crop, years: state.years });
    const one = state.years.length === 1 ? state.years[0] : null;
    const items = [
      ['h-purple', 'เนื้อที่เพาะปลูก (ไร่)', 'planted'],
      ['h-blue', 'เนื้อที่เก็บเกี่ยว (ไร่)', 'harvested'],
      ['h-yellow', 'ผลผลิต (ตัน)', 'production'],
      ['h-salmon', 'ผลผลิตเฉลี่ย (กก./ไร่)', 'yield'],
    ];
    document.getElementById('kpis').innerHTML = items.map(([cls, label, key]) => {
      const v = D.METRICS[key].fn(rs);
      let sub = `รวม ${state.years.length} ปี (${[...state.years].sort().join(', ')})`;
      if (key === 'yield') sub = state.years.length > 1 ? 'ถ่วงน้ำหนักตามเนื้อที่เก็บเกี่ยว' : '';
      if (one) {
        const y = D.yoy(ctx.rows, key, { crop: state.crop }, one);
        sub = y === null ? 'ไม่มีข้อมูลปีก่อนหน้า' : `${arrow(y)} ${D.fmt(y * 100, 2)}% เทียบปี ${one - 1}`;
      }
      return `<div class="kpi"><div class="h ${cls}">${label}</div><div class="v">${D.fmt(v)}</div><div class="d">${sub}</div></div>`;
    }).join('');
  }

  const arrow = (v) => v === null ? '' : v > 0.0005 ? '<span class="arw up">▲</span>' : v < -0.0005 ? '<span class="arw down">▼</span>' : '<span class="arw flat">▬</span>';

  function districtSeries(metric) {
    const yrs = [...state.years].sort();
    // เรียงอำเภอจากมากไปน้อยตามปีล่าสุดที่เลือก
    const last = yrs[yrs.length - 1];
    const order = ctx.districts.map((d) => ({ d, v: D.METRICS[metric].fn(D.filter(ctx.rows, { crop: state.crop, year: last, district_code: d.district_code })) }))
      .sort((a, b) => b.v - a.v).map((x) => x.d);
    return {
      labels: order.map((d) => d.district),
      datasets: yrs.map((y) => ({
        label: String(y),
        data: order.map((d) => D.METRICS[metric].fn(D.filter(ctx.rows, { crop: state.crop, year: y, district_code: d.district_code }))),
        borderColor: yearColor(y), backgroundColor: yearColor(y),
      })),
    };
  }

  const isMobile = () => window.innerWidth < 760;
  // มือถือ: แกนอำเภอเป็นแนวตั้ง (แท่งแนวนอน) เพื่อให้อ่านชื่ออำเภอได้ครบ
  const baseOpts = (unit) => {
    const m = isMobile();
    const cat = { grid: { display: false }, ticks: { font: { size: m ? 11 : 10 }, autoSkip: false, ...(m ? {} : { maxRotation: 50, minRotation: 40 }) } };
    const val = { beginAtZero: true, grid: { color: '#eef1f4' }, border: { display: false }, ticks: { font: { size: 11 }, callback: (v) => D.fmtShort(v) } };
    return {
      maintainAspectRatio: false, indexAxis: m ? 'y' : 'x', interaction: { mode: 'index', intersect: false, axis: m ? 'y' : 'x' },
      plugins: {
        legend: { position: 'top', align: 'start', labels: { usePointStyle: true, boxWidth: 8, font: { size: 12 } } },
        tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${D.fmt(m ? c.parsed.x : c.parsed.y)} ${unit}` } },
      },
      scales: m ? { y: cat, x: val } : { x: cat, y: val },
    };
  };

  function draw(id, cfg) {
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart(document.getElementById(id), cfg);
  }

  function charts_() {
    const p = districtSeries('planted');
    p.datasets.forEach((d) => Object.assign(d, { borderWidth: 2, pointRadius: 3, pointHoverRadius: 6, tension: 0.2 }));
    if (isMobile()) p.datasets.forEach((d) => Object.assign(d, { borderRadius: 4, borderSkipped: 'start', categoryPercentage: 0.8, barPercentage: 0.9 }));
    draw('ch-planted', { type: isMobile() ? 'bar' : 'line', data: p, options: baseOpts('ไร่') });

    const o = districtSeries('production');
    o.datasets.forEach((d) => Object.assign(d, { borderRadius: 4, borderSkipped: 'start', categoryPercentage: 0.75, barPercentage: 0.9, borderColor: '#fff', borderWidth: { left: 1, right: 1 } }));
    draw('ch-production', { type: 'bar', data: o, options: baseOpts('ตัน') });

    // สัดส่วนเนื้อที่เพาะปลูกรายชนิดพืช (ปีที่เลือก) = DIVIDE([planted], CALCULATE([planted], ALL(crop)))
    const shares = ctx.crops.map((c) => ({ c, v: D.M.planted(D.filter(ctx.rows, { crop: c, years: state.years })) })).filter((x) => x.v > 0);
    const total = shares.reduce((a, x) => a + x.v, 0);
    draw('ch-share', {
      type: 'doughnut',
      data: { labels: shares.map((x) => x.c), datasets: [{ data: shares.map((x) => x.v), backgroundColor: shares.map((x) => cropColor(x.c)), borderColor: '#fff', borderWidth: 2,
        offset: shares.map((x) => x.c === state.crop ? 14 : 0) }] },
      options: {
        maintainAspectRatio: false, cutout: '58%',
        plugins: {
          legend: { position: isMobile() ? 'bottom' : 'left', labels: { usePointStyle: true, boxWidth: 8, font: { size: 11 } } },
          tooltip: { callbacks: { label: (c) => ` ${c.label}: ${D.fmt(c.parsed)} ไร่ (${D.fmt((c.parsed / total) * 100, 1)}%)` } },
        },
      },
    });
  }

  function table() {
    const ys = cropYears().reverse();
    const head = `<tr><th>ปี พ.ศ.</th><th>เนื้อที่เพาะปลูก (ไร่)</th><th>เนื้อที่เก็บเกี่ยว (ไร่)</th><th>ผลผลิต (ตัน)</th><th>ผลผลิตเฉลี่ย (กก./ไร่)</th><th>เปลี่ยนแปลงเนื้อที่ปลูก (%)</th><th>เปลี่ยนแปลงผลผลิต (%)</th></tr>`;
    const body = ys.map((y) => {
      const rs = D.filter(ctx.rows, { crop: state.crop, year: y });
      const a = D.yoy(ctx.rows, 'planted', { crop: state.crop }, y);
      const b = D.yoy(ctx.rows, 'production', { crop: state.crop }, y);
      const pct = (v) => v === null ? '–' : `${arrow(v)} ${D.fmt(v * 100, 2)}`;
      return `<tr class="${state.years.includes(y) ? 'sel' : ''}"><td>${y}</td><td>${D.fmt(D.M.planted(rs))}</td><td>${D.fmt(D.M.harvested(rs))}</td><td>${D.fmt(D.M.production(rs))}</td><td>${D.fmt(D.M.yield(rs))}</td><td>${pct(a)}</td><td>${pct(b)}</td></tr>`;
    }).join('');
    document.getElementById('year-table').innerHTML = `<thead>${head}</thead><tbody>${body}</tbody>`;
    document.getElementById('title-card').innerHTML = `<div class="t1">สถานการณ์การเพาะปลูก</div><div class="t2">${CropIcons.svg(state.crop, 44)} ${D.esc(state.crop)}</div><div class="t3">${C.PROVINCE}</div><div class="t4">ปีที่เลือก: ${[...state.years].sort().join(', ')}</div>`;
  }

  let lastMobile = null;
  window.addEventListener('resize', () => { const m = isMobile(); if (lastMobile !== null && m !== lastMobile && document.getElementById('view-dashboard').classList.contains('active')) render(); });
  function render() { lastMobile = isMobile(); renderControls(); kpis(); charts_(); table(); }
  return { init, render };
})();
