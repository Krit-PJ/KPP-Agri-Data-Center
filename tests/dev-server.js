// เซิร์ฟเวอร์ทดสอบในเครื่อง: เสิร์ฟหน้าเว็บ + จำลอง Apps Script Web App ที่ /exec (รันโค้ด .gs จริง)
// ใช้: node tests/dev-server.js [port]  แล้วตั้ง API_URL = 'http://localhost:<port>/exec'
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { createGas, seedFromCsv } = require('./gas-mock');

const ROOT = path.join(__dirname, '..');
const PORT = +process.argv[2] || 8790;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.csv': 'text/csv', '.png': 'image/png', '.svg': 'image/svg+xml' };

function start(port = PORT, opts = {}) {
  const gas = createGas({ gsDir: path.join(ROOT, 'apps-script'), seed: seedFromCsv(path.join(ROOT, 'data/agri_data.csv'), path.join(ROOT, 'data/districts.csv')) });
  gas.props.set('SUPER_ADMIN_USERNAME', 'krit');
  gas.props.set('SUPER_ADMIN_PASSWORD', opts.superPass || 'Dev#pass2026');
  gas.props.set('SITE_URL', `http://localhost:${port}/`);
  gas.api.setupSystem();
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/exec') {
      const done = (out) => { res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(out.getContent()); };
      if (req.method === 'POST') {
        let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => done(gas.ctx.__api.doPost({ postData: { contents: body } })));
      } else done(gas.ctx.__api.doGet({ parameter: Object.fromEntries(u.searchParams) }));
      return;
    }
    let f = path.join(ROOT, decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname));
    if (!f.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    fs.readFile(f, (e, d) => {
      if (e) { res.writeHead(404); return res.end('not found'); }
      let body = d;
      if (f.endsWith('assets/js/config.js') && !opts.noApi) body = Buffer.from(d.toString().replace(/API_URL: '[^']*'/, `API_URL: 'http://localhost:${port}/exec'`));
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
      res.end(body);
    });
  }).listen(port);
  return { srv, gas };
}

if (require.main === module) { start(); console.log('http://localhost:' + PORT); }
module.exports = { start };
