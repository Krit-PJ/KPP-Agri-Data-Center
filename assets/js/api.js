// ===== เชื่อมต่อ Apps Script Web App =====
// GET ใช้ fetch ธรรมดา, POST ส่ง JSON เป็น text/plain เพื่อไม่ให้เบราว์เซอร์ส่ง CORS preflight
window.API = (function () {
  const url = () => (window.APP_CONFIG.API_URL || '').trim();
  const enabled = () => /^https:\/\/script\.google(usercontent)?\.com\//.test(url()) || /^http:\/\/localhost/.test(url());

  async function get(action, params = {}) {
    if (!enabled()) throw new Error('ยังไม่ได้ตั้งค่า API_URL');
    const q = new URLSearchParams({ action, ...params });
    const r = await fetch(url() + '?' + q.toString(), { redirect: 'follow' });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'เกิดข้อผิดพลาด');
    return j.result;
  }

  async function post(method, args = [], token = '') {
    if (!enabled()) throw new Error('ยังไม่ได้เชื่อมต่อระบบหลังบ้าน (API_URL)');
    const r = await fetch(url(), { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ method, args, token }) });
    const j = await r.json();
    if (!j.ok) { const e = new Error(j.error || 'เกิดข้อผิดพลาด'); e.code = j.error; throw e; }
    return j.result;
  }

  return { get, post, enabled };
})();
