// lib/lookup.js — RDAP (pengganti WHOIS), DNS-over-HTTPS (Cloudflare), dan probe HTTP
const T = ms => AbortSignal.timeout(ms);

// ---------- RDAP ----------
let boot = null, bootAt = 0;
async function rdapBase(tld) {
  try { // daftar server RDAP resmi per TLD dari IANA (di-cache 24 jam)
    if (!boot || Date.now() - bootAt > 864e5) {
      boot = await (await fetch('https://data.iana.org/rdap/dns.json', { signal: T(6000) })).json(); bootAt = Date.now();
    }
    for (const [tlds, urls] of boot.services) if (tlds.includes(tld)) return urls.find(u => u.startsWith('https')) || urls[0];
    return null; // TLD belum punya RDAP
  } catch { return 'https://rdap.org/'; } // fallback agregator
}

function parseRdap(j) {
  const ev = a => (j.events || []).find(e => e.eventAction === a)?.eventDate || null;
  const reg = (j.entities || []).find(e => (e.roles || []).includes('registrar'));
  const fn = (reg?.vcardArray?.[1] || []).find(x => x[0] === 'fn');
  return {
    registrar: fn?.[3] || reg?.handle || null,
    created: ev('registration'), updated: ev('last changed'), expires: ev('expiration'),
    statuses: j.status || [],
    nameservers: (j.nameservers || []).map(n => String(n.ldhName || '').toLowerCase()).filter(Boolean),
    dnssec: j.secureDNS?.delegationSigned ?? null,
    source: 'RDAP'
  };
}

export async function lookupRDAP(cands) {
  for (const c of cands) {
    const base = await rdapBase(c.split('.').pop());
    if (!base) return { state: 'unsupported' };
    try {
      const r = await fetch(`${base}domain/${c}`, { headers: { accept: 'application/rdap+json' }, signal: T(9000) });
      if (r.status === 404) continue; // coba kandidat berikutnya (lebih pendek)
      if (!r.ok) return { state: 'error', message: 'RDAP HTTP ' + r.status };
      return { state: 'found', domain: c, ...parseRdap(await r.json()) };
    } catch (e) { return { state: 'error', message: e.name === 'TimeoutError' ? 'RDAP timeout' : 'RDAP tidak dapat dihubungi' }; }
  }
  return { state: 'notfound' };
}

// ---------- DNS (DoH) ----------
const TY = { A: 1, AAAA: 28, MX: 15, NS: 2, TXT: 16 };
const clean = (t, a) => ({
  v: t === 'TXT' ? a.data.replace(/"\s+"/g, '').replace(/^"|"$/g, '') : a.data.replace(/\.$/, ''),
  ttl: a.TTL
});

export async function lookupDNS(domain) {
  const records = { A: [], AAAA: [], MX: [], NS: [], TXT: [] };
  let nx = false, failed = 0;
  await Promise.all(Object.keys(TY).map(async t => {
    try {
      const r = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=${t}`, { headers: { accept: 'application/dns-json' }, signal: T(6000) });
      const j = await r.json();
      if (j.Status === 3) nx = true; // NXDOMAIN
      for (const a of j.Answer || []) if (a.type === TY[t]) records[t].push(clean(t, a));
    } catch { failed++; }
  }));
  return { records, nx, failed };
}

// ---------- Probe HTTP ----------
// Anti-SSRF dasar: jangan probe jika ada IP privat/loopback. (Risiko DNS-rebinding tetap ada;
// untuk produksi serius, jalankan probe dari sandbox/worker terpisah.)
const priv = ip => /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(ip) || ip === '::1' || /^(fc|fd|fe80)/i.test(ip);

export async function probe(domain, ips) {
  if (!ips.length || ips.some(priv)) return { checked: false };
  for (const proto of ['https', 'http']) {
    const t = Date.now();
    try {
      const r = await fetch(`${proto}://${domain}`, { method: 'HEAD', redirect: 'manual', signal: T(6000), headers: { 'user-agent': 'CekDomainBot/1.0' } });
      return { checked: true, reachable: true, status: r.status, ms: Date.now() - t, https: proto === 'https', location: r.headers.get('location') };
    } catch { /* coba protokol berikutnya */ }
  }
  return { checked: true, reachable: false };
}
