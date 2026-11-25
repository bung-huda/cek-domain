// api/check.js — GET /api/check?domain=google.com
// Jalan sebagai Vercel Serverless Function maupun lewat server.js (Node biasa).
import { normalize, candidates, age, cache, rateLimit, getPlan } from '../lib/util.js';
import { lookupRDAP, lookupDNS, probe } from '../lib/lookup.js';

const TTL = Number(process.env.CACHE_TTL_MIN || 10) * 60_000;

async function run(domain) {
  const [dns, rdap] = await Promise.all([lookupDNS(domain), lookupRDAP(candidates(domain))]);
  const R = dns.records;
  const ips = [...R.A, ...R.AAAA].map(x => x.v);
  const http = await probe(domain, ips);
  const hasDns = Object.values(R).some(a => a.length);
  const found = rdap.state === 'found';

  // Status: registered | available (kemungkinan) | error
  let status = 'error';
  if (found || hasDns) status = 'registered';
  else if (rdap.state === 'notfound' || (rdap.state === 'unsupported' && dns.nx)) status = 'available';

  const notes = [];
  if (rdap.state === 'unsupported') notes.push('TLD ini belum menyediakan RDAP publik, jadi data WHOIS tidak tersedia.');
  if (rdap.state === 'error') notes.push(rdap.message + '.');
  if (!found && hasDns && rdap.state === 'notfound') notes.push('RDAP tidak menemukan data, tetapi DNS merespons.');
  if (dns.failed === 5) notes.push('Server DNS publik tidak dapat dihubungi.');

  const { state, ...whois } = rdap;
  return {
    domain, status, active: ips.length > 0 && http.reachable !== false,
    whois: found ? whois : null, rdapState: state,
    age: found && whois.created ? age(whois.created) : null,
    daysToExpiry: found && whois.expires ? Math.floor((new Date(whois.expires) - Date.now()) / 864e5) : null,
    dns: R, nxdomain: dns.nx, http, notes, fetchedAt: new Date().toISOString()
  };
}

function send(res, code, body, headers = {}) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  // CORS: batasi ke domain blog Anda lewat env ALLOWED_ORIGINS="https://www.bunghuda.id,https://bunghuda.blogspot.com"
  const allow = (process.env.ALLOWED_ORIGINS || '*').split(',').map(s => s.trim());
  res.setHeader('Access-Control-Allow-Origin', allow.includes('*') ? '*' : (allow.includes(req.headers.origin) ? req.headers.origin : allow[0]));
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key');
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (req.method !== 'GET') return send(res, 405, { error: 'Method tidak diizinkan' });

  const domain = normalize(new URL(req.url, 'http://x').searchParams.get('domain'));
  if (!domain) return send(res, 400, { error: 'Format domain tidak valid. Contoh: google.com' });

  // Rate limit per IP
  const plan = getPlan(req);
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
  const rl = rateLimit(`${plan.name}:${ip}`, plan.limit);
  const rlh = { 'X-RateLimit-Limit': rl.limit, 'X-RateLimit-Remaining': rl.remaining };
  if (!rl.ok) return send(res, 429, { error: `Terlalu banyak permintaan. Coba lagi dalam ${rl.retryAfter} detik.`, retryAfter: rl.retryAfter }, { ...rlh, 'Retry-After': rl.retryAfter });

  // Cache memori agar domain yang sama tidak memanggil API eksternal berulang
  let data = cache.get(domain), cached = !!data;
  if (!data) {
    try { data = await run(domain); } catch { return send(res, 502, { error: 'Gagal memeriksa domain. Coba lagi nanti.' }, rlh); }
    if (data.status !== 'error') cache.set(domain, data, TTL);
  }

  const out = { ...data, cached, plan: plan.name };
  // HOOK VIP: if (plan.extras) out.seo = await fetchSeoMetrics(domain); // Moz/Ahrefs/Majestic, dsb.
  return send(res, 200, out, { ...rlh, 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=60' });
}
