/**
 * ตัวนับการเข้าใช้งาน (บันทึกจริงในชีต visit_stats)
 * หน้าเว็บเรียก ?action=hit ครั้งเดียวต่อการเปิดใช้งาน (sessionStorage)
 * และส่ง v=1 ถ้าเป็นการเข้าครั้งแรกของวันจากเบราว์เซอร์นั้น (localStorage) → นับเป็นผู้เข้าชม
 * ไม่เก็บ IP หรือข้อมูลระบุตัวตนใด ๆ
 *   visit_stats: Date | Visits (ครั้ง) | Visitors (คน/วัน) | Updated_At
 */
const VISIT_HEADERS = ['Date', 'Visits', 'Visitors', 'Updated_At'];
const VISIT_CACHE_KEY = 'visits:v2';

function recordVisit_(isNewVisitor) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return visitCounts_();
  try {
    const sh = ensureSheet_('visit_stats', VISIT_HEADERS);
    const today = today_();
    const last = sh.getLastRow();
    let row = 0;
    for (let r = last; r >= Math.max(2, last - 3); r--) {
      if (String(sh.getRange(r, 1).getDisplayValue ? sh.getRange(r, 1).getDisplayValue() : sh.getRange(r, 1).getValue()).trim() === today) { row = r; break; }
    }
    if (row) {
      const v = sh.getRange(row, 2, 1, 2).getValues()[0];
      sh.getRange(row, 2, 1, 3).setValues([[(Number(v[0]) || 0) + 1, (Number(v[1]) || 0) + (isNewVisitor ? 1 : 0), new Date()]]);
    } else {
      sh.appendRow([today, 1, isNewVisitor ? 1 : 0, new Date()]);
      sh.getRange(sh.getLastRow(), 1).setNumberFormat('@').setValue(today);
    }
    CacheService.getScriptCache().remove(VISIT_CACHE_KEY);
  } finally {
    lock.releaseLock();
  }
  return visitCounts_();
}

function visitCounts_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get(VISIT_CACHE_KEY);
  if (hit) return JSON.parse(hit);
  const rows = dataRows_(ensureSheet_('visit_stats', VISIT_HEADERS));
  const today = today_(), month = today.slice(0, 7);
  const out = { today: 0, todayVisitors: 0, month: 0, total: 0, totalVisitors: 0, since: rows.length ? String(rows[0][0]) : today };
  rows.forEach(function (r) {
    const d = String(r[0]).slice(0, 10), v = Number(r[1]) || 0, u = Number(r[2]) || 0;
    out.total += v; out.totalVisitors += u;
    if (d === today) { out.today += v; out.todayVisitors += u; }
    if (d.slice(0, 7) === month) out.month += v;
  });
  cache.put(VISIT_CACHE_KEY, JSON.stringify(out), 60);
  return out;
}

function visitStats_(days) {
  const rows = dataRows_(ensureSheet_('visit_stats', VISIT_HEADERS));
  return { counts: visitCounts_(), daily: rows.slice(-(days || 60)).map(function (r) { return { date: String(r[0]).slice(0, 10), visits: Number(r[1]) || 0, visitors: Number(r[2]) || 0 }; }) };
}
