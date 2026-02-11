// Agregator – pobiera gotowy JSON z lekkich endpointów (zaglebie.js, slaski.js itd.)
// Nigdy nie robi scrapingu, więc nigdy nie padnie.

const BASE = "https://repertuar-scraper.vercel.app"; // <-- Twoja domena Vercel

const SOURCES = [
  `${BASE}/api/zaglebie`
  // tu dopisujesz kolejne teatry:
  // `${BASE}/api/opera`,
  // `${BASE}/api/slaski`,
  // itd.
];

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  try {
    const out = [];

    for (const src of SOURCES) {
      try {
        const r = await fetch(src, { headers: { "User-Agent": "PlayTeatrBot/1.0" } });
        if (!r.ok) continue;
        const json = await r.json().catch(() => []);
        if (Array.isArray(json)) out.push(...json);
      } catch {
        continue;
      }
    }

    return res.status(200).json(out);
  } catch {
    return res.status(200).json([]);
  }
}
