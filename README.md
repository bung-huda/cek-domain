# Cek Domain (WHOIS/RDAP + DNS)

```
cek-domain/
├── api/check.js            # Endpoint GET /api/check?domain=... (CORS, rate limit, cache)
├── lib/util.js             # Validasi domain, umur, cache, rate limit, hook paket VIP
├── lib/lookup.js           # RDAP, DNS-over-HTTPS (Cloudflare), probe HTTP
├── blogger/cek-domain.html # Kode tempel Blogger (UI)
├── server.js               # Server lokal / hosting Node biasa
└── package.json
```

## Jalankan lokal (Node 18+, tanpa dependensi)
    npm start        # buka http://localhost:3000

## Deploy gratis backend
**Vercel:** push folder ke GitHub → vercel.com → Add New Project → Deploy.
Endpoint: https://NAMA-ANDA.vercel.app/api/check
Env opsional: ALLOWED_ORIGINS=https://www.bunghuda.id,https://bunghuda.blogspot.com
RATE_LIMIT=20 (per menit per IP), CACHE_TTL_MIN=10, VIP_KEYS=kunci1,kunci2

**Render (alternatif):** New Web Service → Build: (kosong) → Start: `npm start`.

## Pasang di Blogger
1. Buka blogger/cek-domain.html, ubah `const API_BASE='';` menjadi URL backend Anda.
2. Blogger → Laman/Entri baru → mode **HTML view** → tempel seluruh isi file → Terbitkan.

## Hook fitur VIP
- `lib/util.js → getPlan()` : tentukan paket dari header X-API-Key.
- `api/check.js` : cari komentar `HOOK VIP` untuk menambah data SEO (DR/DA) dari API berbayar.
- Cache/rate limit memori bersifat per instance; untuk akurasi lintas instance gunakan Upstash Redis / Vercel KV.
