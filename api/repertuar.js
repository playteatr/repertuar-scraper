import { fetch as undiciFetch } from 'undici';

const SOURCES = [
  'https://repertuar-scraper.vercel.app/api/slaski',
  // tu później dopiszemy kolejne: /api/polski-bielsko, /api/gliwice, ...
];

export default async function handler(req, res) {
  try {
    const urlSelf = new URL(req.url, 'http://localhost');
    const date = urlSelf.searchParams.get('date'); // przekażemy w dół

    const results = [];
    for (const src of SOURCES) {
      const u = date ? `${src}?date=${encodeURIComponent(date)}` : src;
      try {
        const r = await undiciFetch(u, {
          headers: { 'User-Agent': 'PlayTeatr/1.0 (+contact: you@example.com)' }
        });
        if (!r.ok) continue;
        const json = await r.json().catch(() => []);
        if (Array.isArray(json)) results.push(...json);
      } catch (_) {
        // ignoruj pojedyncze padnięte źródło
      }
    }

    // sortowanie globalne (miasto → godzina → teatr → tytuł)
    results.sort((a,b)=>{
      const c=(a.city||'').localeCompare(b.city||''); if(c) return c;
      const at=a.time||'99:99', bt=b.time||'99:99'; if(at!==bt) return at.localeCompare(bt);
      const t=(a.theatre||'').localeCompare(b.theatre||''); if(t) return t;
      return (a.title||'').localeCompare(b.title||'');
    });

    res.setHeader('Content-Type','application/json; charset=utf-8');
    return res.status(200).json(results);
  } catch (e) {
    // nawet gdy coś poszło nie tak — zwróć listę (być może pustą), a nie crash
    return res.status(200).json([]);
  }
}
