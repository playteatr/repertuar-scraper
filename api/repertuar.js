// /api/repertuar — LEKKI agregator (bez scrapingu).
// Zbiera JSON z lokalnych, lekkich endpointów (np. /api/zaglebie).
// Nigdy nie zwraca 500 — w najgorszym razie `[]`.

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  try {
    // 1) Zbuduj bazowy URL w oparciu o nagłówki żądania (zamiast hardkodować domenę)
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const base = `${proto}://${host}`;

    // 2) Przenieś parametr ?date do źródeł (jeśli jest)
    let dateParam = null;
    try {
      const u = new URL(req.url, base);
      dateParam = u.searchParams.get('date');
    } catch {}

    // 3) Tu wpisujesz źródła (na start tylko zaglebie)
    
const SOURCES = [
  `${base}/api/zaglebie${dateParam ? `?date=${encodeURIComponent(dateParam)}` : ''}`,
  `${base}/api/opera${dateParam ? `?date=${encodeURIComponent(dateParam)}` : ''}` // <— DODANE
];


    const results = [];

    // 4) Pobierz źródła sekwencyjnie — defensywnie (żadne nie wysadzi funkcji)
    for (const src of SOURCES) {
      try {
        const r = await fetch(src, { headers: { 'User-Agent': 'PlayTeatrBot/1.0' } });
        if (!r.ok) continue;                 // jeśli źródło padło → pomiń
        const json = await r.json().catch(()=>[]); // jeśli nie JSON → potraktuj jako []
        if (Array.isArray(json)) results.push(...json);
      } catch {
        // pojedyncze źródło ignorujemy
      }
    }

    // 5) Zwróć zebrane dane (zawsze 200, zawsze JSON)
    return res.status(200).json(results);
  } catch {
    // absolutna siatka bezpieczeństwa
    return res.status(200).json([]);
  }
}
