// /api/opera — Opera Śląska (Bytom)
// Lekki, odporny endpoint: 1 fetch + bezpieczne heurystyki.
// ZAWSZE zwraca JSON (w najgorszym razie pustą tablicę []).

const URL = "https://opera-slaska.pl/repertuar";
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

function toDateTimeInTZ(isoOrDateLike) {
  const dt = new Date(isoOrDateLike);
  if (isNaN(dt)) return { date: null, time: null };
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(dt);
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(dt);
  return { date, time }; // 'YYYY-MM-DD', 'HH:mm'
}

function stripTags(html) {
  return String(html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeDateToken(s) {
  if (!s) return null;
  s = String(s).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s; // YYYY-MM-DD
  const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/); // DD.MM.YYYY
  if (m) {
    const dd = m[1].padStart(2, "0");
    const mm = m[2].padStart(2, "0");
    const yyyy = m[3];
    return `${yyyy}-${mm}-${dd}`;
  }
  return null;
}

function plDateToISO(s) {
  if (!s) return null;
  const txt = String(s).toLowerCase().normalize("NFC").trim();
  const map = {
    "stycznia": "01", "lutego": "02", "marca": "03", "kwietnia": "04", "maja": "05", "czerwca": "06",
    "lipca": "07", "sierpnia": "08", "września": "09", "października": "10", "listopada": "11", "grudnia": "12"
  };
  const m = txt.match(/(\d{1,2})\s+([a-ząćęłńóśźż]+)\s+(\d{4})/i);
  if (!m) return null;
  const dd = m[1].padStart(2, "0");
  const mm = map[m[2]] || null;
  const yyyy = m[3];
  return mm ? `${yyyy}-${mm}-${dd}` : null;
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  try {
    // 1) Data docelowa (z query ?date=..., domyślnie dziś w Europe/Warsaw)
    const want = (() => {
      try {
        const u = new URL(req.url, "http://localhost");
        return u.searchParams.get("date") || todayTZ();
      } catch {
        return todayTZ();
      }
    })();

    // 2) Pobierz HTML (z krótkim timeoutem)
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 9000);
    const r = await fetch(URL, {
      signal: controller.signal,
      headers: { "User-Agent": "PlayTeatrBot/1.0 (+contact: you@example.com)" }
    }).catch(() => null);
    clearTimeout(timer);

    if (!r || !r.ok) return res.status(200).json([]);

    const html = await r.text();
    if (!html) return res.status(200).json([]);

    const events = [];

    // 3) JSON-LD (Event) — jeśli jest, to najpewniejsze
    const ldBlocks = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
    const walk = (obj) => {
      if (!obj || typeof obj !== "object") return;
      const types = Array.isArray(obj["@type"]) ? obj["@type"] : obj["@type"] ? [obj["@type"]] : [];
      if (types.includes("Event")) {
        const title = String(obj.name || obj.headline || "").trim();
        const start = obj.startDate || obj.startTime || obj.start || null;
        const url = obj.url || URL;
        if (title && start) {
          const { date, time } = toDateTimeInTZ(start);
          if (date) {
            events.push({
              city: "Bytom",
              theatre: "Opera Śląska",
              title,
              date,
              time,
              url
            });
          }
        }
      }
      for (const k in obj) {
        const v = obj[k];
        if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === "object") walk(v);
      }
    };

    for (const b of ldBlocks) {
      try {
        const data = JSON.parse(b[1]);
        Array.isArray(data) ? data.forEach(walk) : walk(data);
      } catch { /* ignoruj pojedynczy zły blok */ }
    }

    // 4) Fallback po <time datetime="..."> + tytuł w oknie kontekstu
    if (events.length === 0) {
      const timeTags = [...html.matchAll(/<time[^>]*datetime=["']([^"']+)["'][^>]*>[\s\S]*?<\/time>/gi)];
      for (const t of timeTags) {
        const start = t[1];
        const { date, time } = toDateTimeInTZ(start);
        if (!date) continue;

        // okno kontekstu do wyłuskania tytułu i linku
        const idx = t.index ?? 0;
        const win = html.slice(Math.max(0, idx - 400), Math.min(html.length, idx + 800));

        const aMatch = win.match(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]{3,240}?)<\/a>/i);
        const hMatch = win.match(/<h[1-6][^>]*>([\s\S]{3,260}?)<\/h[1-6]>/i);

        const title = stripTags((aMatch && aMatch[2]) || (hMatch && hMatch[1]) || "");
        let href = (aMatch && aMatch[1]) || URL;
        if (href && !href.startsWith("http")) {
          try { href = new URL(href, URL).href; } catch {}
        }

        if (title) {
          events.push({
            city: "Bytom",
            theatre: "Opera Śląska",
            title,
            date,
            time,
            url: href
          });
        }
      }
    }

    // 5) Ultra-ostrożny fallback tekstowy (data + godzina blisko tytułu)
    if (events.length === 0) {
      const text = stripTags(html);
      const dateRe = /(\d{4}-\d{2}-\d{2}|\b\d{1,2}\.\d{1,2}\.\d{4}\b|(\d{1,2}\s+(stycznia|lutego|marca|kwietnia|maja|czerwca|lipca|sierpnia|września|października|listopada|grudnia)\s+\d{4}))/gi;
      const timeRe = /\b\d{1,2}:\d{2}\b/;
      let m;
      while ((m = dateRe.exec(text)) !== null) {
        const token = m[1];
        const iso = normalizeDateToken(token) || plDateToISO(token);
        if (!iso) continue;

        const around = text.slice(Math.max(0, m.index - 140), m.index + 200);
        const timeM = around.match(timeRe);
        const title = stripTags(around.replace(dateRe, " ").replace(timeRe, " ")).slice(0, 140);

        if (title) {
          events.push({
            city: "Bytom",
            theatre: "Opera Śląska",
            title,
            date: iso,
            time: timeM?.[0] || null,
            url: URL
          });
        }
      }
    }

    // 6) Dedup
    const seen = new Set();
    const dedup = events.filter(e => {
      const key = `${e.title}|${e.date}|${e.time || ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // 7) Filtr na żądaną datę
    const todayOnly = dedup.filter(e => e.date === want);

    // 8) Sort: godzina → tytuł
    todayOnly.sort((a, b) => {
      const at = a.time || "99:99";
      const bt = b.time || "99:99";
      if (at !== bt) return at.localeCompare(bt);
      return (a.title || "").localeCompare(b.title || "");
    });

    return res.status(200).json(todayOnly);
  } catch {
    // Nigdy 500
    return res.status(200).json([]);
  }
}
