// server.js — server lokal / hosting Node biasa (Render, Railway, VPS). Tanpa dependensi.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import handler from './api/check.js';

const PORT = process.env.PORT || 3000;
http.createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  if (path === '/api/check') return handler(req, res);
  if (path === '/' || path === '/index.html') { // halaman uji: pakai backend di origin yang sama
    const html = (await readFile(new URL('./blogger/cek-domain.html', import.meta.url), 'utf8')).replace("const API_BASE='';", 'const API_BASE=location.origin;');
    res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end(html);
  }
  res.statusCode = 404; res.end('Not found');
}).listen(PORT, () => console.log(`Cek Domain berjalan di http://localhost:${PORT}`));
