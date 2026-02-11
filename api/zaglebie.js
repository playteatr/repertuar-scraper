// Teatr Zagłębia – lekki endpoint, który nigdy nie wywali 500.
// Pobiera JEDNĄ stronę → przetwarza prostymi wyrażeniami → ZAWSZE JSON.

const URL = "https://teatrzaglebia.pl/repertuar/";
const TZ = "Europe/Warsaw";

function todayTZ() {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  return f.format(new Date()); // YYYY-MM-DD
}

function strip(html) {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  try {
    const want = (() => {
      try {
        const q = new URL(req.url, "http://localhost");
        return q.searchParams.get("date") || todayTZ();
      } catch {
        return todayTZ();
      }
    })();

    // Pobranie HTML
    const r = await fetch(URL, { headers: { "User-Agent": "PlayTeatrBot/1.0" } });
    if (!r.ok) return res.status(200).json([]);

    const html = await r.text();

    // Wszystkie wiersze <tr>
    const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];

    const events = [];

    for (const match of rows) {
      const row = match[1];

      // Data w 3 wariantach
      const datePL = row.match(/(\d{1,2}\s+(stycznia|lutego|marca|kwietnia|maja|czerwca|lipca|sierpnia|września|października|listopada|grudnia)\s+\d{4})/i);
      const dateDOT = row.match(/\b(\d{1,2}\.\d{1,2}\.\d{4})\b/);
      const time = row.match(/\b\d{1,2}:\d{2}\b/)?.[0] ?? null;

      let dateISO = null;

      if (dateDOT) {
        const [d, m, y] = dateDOT[1].split(".");
        dateISO = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
      }

      if (datePL && !dateISO) {
        const map = {
          "stycznia": "01",
          "lutego": "02",
          "marca": "03",
          "kwietnia": "04",
          "maja": "05",
          "czerwca": "06",
          "lipca": "07",
          "sierpnia": "08",
          "września": "09",
          "października": "10",
          "listopada": "11",
          "grudnia": "12"
        };
        const [_, d, mPL, y] = datePL[1].match(/(\d+)\s+([a-ząćęłńóśźż]+)\s+(\d{4})/i);
        dateISO = `${y}-${map[mPL]}-${d.padStart(2, "0")}`;
      }

      if (!dateISO) continue;
     ) continue;

      // Tytuł – bierzemy anchor lub strong lub plain text
      const a = row.match(/<a[^>]*>([\s\S]{3,200})<\/a>/i)?.[1];
      const strong = row.match(/<strong[^>]*>([\s\S]{3,200})<\/strong>/i)?.[1];
      const h = row.match(/<h[1-6][^>]*>([\s\S]{3,200})<\/h[1-6]>/i)?.[1];
      const title = strip(a ?? strong ?? h ?? "").trim();
      if (!title) continue;

      // Link
      let href = row.match(/<a[^"']*href=["']([^"']+)["']/i)?.[1] ?? URL;
      if (href && !href.startsWith("http")) {
        try { href = new URL(href, URL).href; } catch {}
      }

      events.push({
        city: "Sosnowiec",
        theatre: "Teatr Zagłębia",
        title,
        date: dateISO,
        time,
        url: href
      });
    }

    return res.status(200).json(events);
  } catch {
    // Nigdy 500
    return res.status(200).json([]);
  }
}
