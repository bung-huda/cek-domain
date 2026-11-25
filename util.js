// lib/util.js — validasi domain, hitung umur, cache & rate limit (memori), hook paket VIP

// Suffix 2-level umum, agar domain "contoh.co.id" tidak salah terbaca sebagai "co.id"
const SLD = new Set('co.id or.id web.id my.id ac.id go.id sch.id biz.id desa.id ponpes.id mil.id net.id co.uk org.uk ac.uk com.au net.au co.nz co.jp com.br com.sg com.my co.in com.cn com.hk co.za com.tr com.mx'.split(' '));

// Bersihkan input (URL/email/port) -> hostname valid (IDN diubah ke punycode) atau null
export function normalize(input) {
  let s = String(input || '').trim().toLowerCase();
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').split(/[/?#]/)[0].replace(/^.*@/, '').replace(/:\d+$/, '').replace(/\.$/, '');
  if (!s) return null;
  try { s = new URL('http://' + s).hostname; } catch { return null; }
  const labels = s.split('.');
  if (s.length > 253 || labels.length < 2) return null;
  if (!labels.every(l => /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(l))) return null;
  if (!/^([a-z]{2,63}|xn--[a-z0-9-]{1,59})$/.test(labels.at(-1))) return null;
  return s.replace(/^www\./, '');
}

// Kandidat domain terdaftar untuk RDAP, dari yang terpanjang ke terpendek (maks 4)
export function candidates(d) {
  const l = d.split('.'), out = [];
  for (let i = 0; i <= l.length - 2; i++) { const c = l.slice(i).join('.'); if (SLD.has(c)) break; out.push(c); }
  return out.slice(-4);
}

// Umur domain: tahun, bulan, hari (selisih kalender) + total hari
export function age(from, to = new Date()) {
  const a = new Date(from); if (isNaN(a)) return null;
  let y = to.getUTCFullYear() - a.getUTCFullYear(), m = to.getUTCMonth() - a.getUTCMonth(), d = to.getUTCDate() - a.getUTCDate();
  if (d < 0) { m--; d += new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 0)).getUTCDate(); }
  if (m < 0) { y--; m += 12; }
  return { years: y, months: m, days: d, totalDays: Math.floor((to - a) / 864e5) };
}

// ---- Cache memori (TTL + batas ukuran). Serverless: berlaku per instance. ----
// Ingin cache permanen lintas instance? Ganti dengan Upstash Redis / Vercel KV.
const store = new Map();
export const cache = {
  get(k) { const e = store.get(k); if (!e) return null; if (e.exp < Date.now()) { store.delete(k); return null; } return e.v; },
  set(k, v, ttl) { if (store.size >= 500) store.delete(store.keys().next().value); store.set(k, { v, exp: Date.now() + ttl }); }
};

// ---- Rate limit per IP (fixed window, memori) ----
const hits = new Map();
export function rateLimit(key, limit = 20, windowMs = 60_000) {
  const now = Date.now();
  let h = hits.get(key);
  if (!h || h.reset < now) { h = { count: 0, reset: now + windowMs }; hits.set(key, h); }
  h.count++;
  if (hits.size > 5000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
  return { ok: h.count <= limit, limit, remaining: Math.max(0, limit - h.count), retryAfter: Math.ceil((h.reset - now) / 1000) };
}

// ---- HOOK PAKET (free / VIP) ----
// Contoh: set env VIP_KEYS="kunci1,kunci2" lalu kirim header X-API-Key.
// Ganti dengan pengecekan database/Stripe/Lemon Squeezy bila nanti jadi berbayar.
export function getPlan(req) {
  const key = req.headers['x-api-key'];
  if (key && (process.env.VIP_KEYS || '').split(',').includes(key)) return { name: 'vip', limit: 300, extras: true };
  return { name: 'free', limit: Number(process.env.RATE_LIMIT || 20), extras: false };
}
