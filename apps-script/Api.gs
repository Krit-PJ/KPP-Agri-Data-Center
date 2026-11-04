/**
 * จุดเข้าของ Web App
 *
 * GET  ?action=bootstrap            ข้อมูลทั้งหมดสำหรับหน้าเว็บ (data, districts, links, crops)
 * GET  ?action=hit&v=0|1            นับการเข้าใช้ 1 ครั้ง (v=1 = ผู้เข้าชมใหม่ของวันนี้) แล้วคืนยอด
 * GET  ?action=visits               ยอดผู้เข้าชม
 * GET  ?action=download&token=...   ดาวน์โหลดข้อมูลตามคำขอที่อนุมัติแล้ว
 * GET  ?action=health
 *
 * POST body (text/plain) = {"method": "...", "args": [...], "token": "..."}
 *   ไม่ต้องล็อกอิน: requestDownload
 *   ต้องล็อกอิน: ดู API_METHODS
 */
const API_METHODS = {
  // public
  requestDownload: { role: null, fn: function (a) { return requestDownload_(a[0]); } },
  // auth
  adminLogin: { role: null, fn: function (a) { return adminLogin_(a[0]); } },
  adminClaim: { role: null, fn: function (a) { return adminClaim_(a[0]); } },
  superClaimResend: { role: null, fn: function () { return superClaimResend_(); } },
  adminRequest: { role: null, fn: function (a) { return adminRequest_(a[0]); } },
  adminRequestList: { role: 'super', fn: function (a) { return adminRequestList_(a[0]); } },
  adminRequestDecide: { role: 'super', fn: function (a, s) { return adminRequestDecide_(a[0], s); } },
  soilList: { role: 'admin', fn: function () { return soilList_(); } },
  soilImport: { role: 'admin', fn: function (a, s) { return soilImport_(a[0], s); } },
  soilUpdate: { role: 'admin', fn: function (a, s) { return soilUpdate_(a[0], s); } },
  adminLogout: { role: 'admin', fn: function (a, s, t) { return adminLogout_(t); } },
  adminMe: { role: 'admin', fn: function (a, s) { return { username: s.username, name: s.name, role: s.role, version: APP_VERSION }; } },
  adminChangePassword: { role: 'admin', fn: function (a, s) { return adminChangePassword_(a[0], s); } },
  // import
  importCheck: { role: 'admin', fn: function (a) { return importCheck_(a[0]); } },
  importCommit: { role: 'admin', fn: function (a, s) { return importCommit_(a[0], s); } },
  importList: { role: 'admin', fn: function () { return importList_(); } },
  importRollback: { role: 'admin', fn: function (a, s) { return importRollback_(a[0], s); } },
  rebuildViews: { role: 'admin', fn: function (a, s) { const r = rebuildCropViews_(); audit_(s, 'rebuild_views', r.join(', ')); return { views: r }; } },
  districtsList: { role: 'admin', fn: function () { return readDistricts_(); } },
  // download requests
  requestList: { role: 'admin', fn: function (a) { return requestList_(a[0]); } },
  requestDecide: { role: 'admin', fn: function (a, s) { return requestDecide_(a[0], s); } },
  // links (super)
  linkList: { role: 'super', fn: function () { return linkList_(true); } },
  linkSave: { role: 'super', fn: function (a, s) { return linkSave_(a[0], s); } },
  linkDelete: { role: 'super', fn: function (a, s) { return linkDelete_(a[0], s); } },
  // admins (super)
  adminList: { role: 'super', fn: function () { return adminList_(); } },
  adminSave: { role: 'super', fn: function (a, s) { return adminSave_(a[0], s); } },
  adminResetPassword: { role: 'super', fn: function (a, s) { return adminResetPassword_(a[0], s); } },
  auditList: { role: 'super', fn: function () { return auditList_(); } },
  visitStats: { role: 'admin', fn: function () { return visitStats_(60); } }
};

function doGet(e) {
  const p = (e && e.parameter) || {};
  try {
    autoSetup_();
    switch (String(p.action || 'bootstrap')) {
      case 'bootstrap': return json_({ ok: true, result: bootstrap_() });
      case 'hit': return json_({ ok: true, result: recordVisit_(p.v === '1') });
      case 'visits': return json_({ ok: true, result: visitCounts_() });
      case 'download': return json_({ ok: true, result: downloadByToken_(p.token) });
      case 'health': return json_({ ok: true, result: { version: APP_VERSION, time: new Date().toISOString() } });
      default: throw new Error('ไม่รู้จัก action');
    }
  } catch (err) {
    return json_({ ok: false, error: publicError_(err) });
  }
}

function doPost(e) {
  let out;
  try {
    autoSetup_();
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const def = API_METHODS[String(body.method || '')];
    if (!def) throw new Error('Method not allowed');
    const args = Array.isArray(body.args) ? body.args : [];
    const session = def.role ? requireAdmin_(body.token, def.role) : null;
    out = { ok: true, result: def.fn(args, session, String(body.token || '')) };
  } catch (err) {
    out = { ok: false, error: publicError_(err) };
  }
  return json_(out);
}
