// /api/repertuar — agregator repertuarów "na dziś" (lub ?date=YYYY-MM-DD).
// Zero zewnętrznych paczek. Zawsze JSON (w najgorszym razie []).
// Dedykowane fallbacki: Opera Śląska (Bytom), Teatr Zagłębia (Sosnowiec).

const TZ = 'Europe/Warsaw';

// ====== TEATRY ======
const THEATRES = [
  { id:'teatr_bedzin_dorman', city:'Będzin',       theatre:'Teatr Dzieci Zagłębia im. J. Dormana', url:'https://teatr.bedzin.pl/repertuar/' },
  { id:'teatr_polski_bielsko',city:'Bielsko-Biała',theatre:'Teatr Polski w Bielsku-Białej',        url:'https://www.teatr.bielsko.pl/repertuar' },
  { id:'banialuka',            city:'Bielsko-Biała',theatre:'Teatr Lalek Banialuka im. J. Zitzmana',url:'https://banialuka.pl/repertuar' },
  { id:'opera_slaska',         city:'Bytom',        theatre:'Opera Śląska',                         url:'https://opera-slaska.pl/repertuar' },
  { id:'rozbark',              city:'Bytom',        theatre:'Bytomski Teatr Tańca i Ruchu ROZBARK', url:'https://teatrrozbark.pl/' },
  { id:'teatr_rozrywki',       city:'Chorzów',      theatre:'Teatr Rozrywki',                       url:'https://teatr-rozrywki.pl/repertuar.html' },
  { id:'teatr_mick_cz',        city:'Częstochowa',  theatre:'Teatr im. A. Mickiewicza',             url:'https://www.teatr-mickiewicza.pl/spektakl,repertuar' },
  { id:'teatr_miejski_gli',    city:'Gliwice',      theatre:'Teatr Miejski w Gliwicach',            url:'https://teatr.gliwice.pl/repertuar/' },
  { id:'teatr_slaski',         city:'Katowice',     theatre:'Teatr Śląski im. S. Wyspiańskiego',    url:'https://teatrslaski.art.pl/repertuar/' },
  { id:'ateneum_kato',         city:'Katowice',     theatre:'Śląski Teatr Lalki i Aktora Ateneum',  url:'https://ateneumteatr.pl/' },
  { id:'teatr_zaglebie',       city:'Sosnowiec',    theatre:'Teatr Zagłębia',                       url:'https://teatrzaglebia.pl/repertuar/' }, // tabela Data/Godzina/Tytuł [1](https://www.hyperframer.com/framer-fetch-and-display-dynamic-data-from-api/)
  { id:'teatr_maly_tychy',     city:'Tychy',        theatre:'Teatr Mały',                           url:'https://teatrmaly.tychy.pl/kalendarium/' },
  { id:'teatr_nowy_zabrze',    city:'Zabrze',       theatre:'Teatr Nowy w Zabrzu',                  url:'https://teatrzabrze.pl/repertuar/' },
  { id:'teatr_mick_cieszyn',   city:'Cieszyn',      theatre:'Teatr im. A. Mickiewicza',             url:'https://teatr.cieszyn.pl/' }
];

// ====== POMOCNICZE ======
function todayInTZ(timeZone = TZ) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year:'numeric', month:'2-digit', day:'2-digit' })
    .formatToParts(new Date());
  const y = parts.find(p=>p.type==='year')?.value;
  const m = parts.find(p=>p.type==='month')?.value;
  const d = parts.find(p=>p.type==='day')?.value;
  return `${y}-${m}-${d}`; // YYYY-MM-DD
}

function toDateTimeInTZ(isoOrDateLike, timeZone = TZ) {
  const dt = new Date(isoOrDateLike);
  if (isNaN(dt)) return { date:null, time:null };
  const date = new Intl.DateTimeFormat('en-CA', { timeZone, year:'numeric', month:'2-digit', day:'2-digit' }).format(dt);
  const time = new Intl.DateTimeFormat('en-GB', { timeZone, hour:'2-digit', minute:'2-digit', hour12:false }).format(dt);
  return { date, time }; // { 'YYYY-MM-DD', 'HH:mm' }
}

async function getHtml(url, timeoutMs = 9000) {
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'PlayTeatr/1.0 (+contact: you@example.com)' }
    });
    if (!r.ok) return '';
    return await r.text();
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

function normalizeDateToken(s) {
  if (!s) return null;
  s = String(s).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;              // YYYY-MM-DD
  const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);      // DD.MM.YYYY
  if (m) {
    const dd = m[1].padStart(2,'0'), mm = m[2].padStart(2,'0'), yyyy = m[3];
    return `${yyyy}-${mm}-${dd}`;
  }
  return null;
}

// polskie miesiące -> MM (np. "8 lutego 2026")
function plDateToISO(s) {
  if (!s) return null;
  const txt = String(s).toLowerCase().normalize('NFC').trim();
  const map = {
    'stycznia':'01','lutego':'02','marca':'03','kwietnia':'04','maja':'05','czerwca':'06',
    'lipca':'07','sierpnia':'08','września':'09','października':'10','listopada':'11','grudnia':'12'
  };
  const m = txt.match(/(\d{1,2})\s+([a-ząćęłńóśźż]+)\s+(\d{4})/i);
  if (!m) return null;
  const dd = m[1].padStart(2,'0');
  const mm = map[m[2]] || null;
  const yyyy = m[3];
  if (!mm) return null;
  return `${yyyy}-${mm}-${dd}`;
}

function stripTags(html) {
  return String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

// ====== JSON-LD (Event) — uniwersalne ======
function extractEventsFromJsonLd(html, defaults) {
  const blocks = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const out = [];

  const walk = (obj) => {
    if (!obj || typeof obj !== 'object') return;
    const types = Array.isArray(obj['@type']) ? obj['@type'] : (obj['@type'] ? [obj['@type']] : []);
    if (types.includes('Event')) {
      const title = String(obj.name || obj.headline || '').trim();
      const start = obj.startDate || obj.startTime || obj.start || null;
      const url   = obj.url || defaults.url;
      if (title && start) {
        const { date, time } = toDateTimeInTZ(start, TZ);
        if (date) out.push({ city: defaults.city, theatre: defaults.theatre, title, date, time, url });
      }
    }
    for (const k in obj) {
      const v = obj[k];
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') walk(v);
    }
  };

  for (const m of blocks) {
    try {
      const data = JSON.parse(m[1]);
      Array.isArray(data) ? data.forEach(walk) : walk(data);
    } catch { /* ignoruj błędny blok */ }
  }
  return out;
}

// ====== FALLBACK: OPERA ŚLĄSKA (Bytom) ======
function fallbackOperaSlaska(html, defaults) {
  const out = [];
  if (!html) return out;

  // <time datetime="..."> … </time> + tytuł w pobliżu
  const timeBlocks = [...html.matchAll(/<time[^>]*datetime=["']([^"']+)["'][^>]*>[\s\S]*?<\/time>/gi)];
  for (const m of timeBlocks) {
    const start = m[1];
    const { date, time } = toDateTimeInTZ(start, TZ);
    if (!date) continue;

    const idx = m.index ?? 0;
    const win = html.slice(Math.max(0, idx - 300), Math.min(html.length, idx + 600));
    const a = win.match(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]{3,200}?)<\/a>/i);
    const h = win.match(/<h[1-6][^>]*>([\s\S]{3,220}?)<\/h[1-6]>/i);
    const title = stripTags(a?.[2] || h?.[1] || '');

    if (title) {
      out.push({ city: defaults.city, theatre: defaults.theatre, title, date, time, url: a?.[1] || defaults.url });
    }
  }

  // awaryjnie: dopasowania tekstowe data+godzina
  if (out.length === 0) {
    const text = stripTags(html);
    const dateRe = /(\d{4}-\d{2}-\d{2}|\b\d{1,2}\.\d{1,2}\.\d{4}\b)/g;
    const timeRe = /\b\d{1,2}:\d{2}\b/;
    let m;
    while ((m = dateRe.exec(text)) !== null) {
      const iso = normalizeDateToken(m[1]);
      if (!iso) continue;
      const around = text.slice(Math.max(0, m.index - 120), m.index + 160);
      const timeM = around.match(timeRe);
      const title = stripTags(around.replace(dateRe, ' ').replace(timeRe, ' ')).slice(0, 140);
      if (title) out.push({ city: defaults.city, theatre: defaults.theatre, title, date: iso, time: timeM?.[0] || null, url: defaults.url });
    }
  }

  // deduplikacja
  const seen = new Set();
  return out.filter(e => { const k=`${e.title}|${e.date}|${e.time||''}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

// ====== FALLBACK: TEATR ZAGŁĘBIA (Sosnowiec) ======
// Układ tabelaryczny "Data / Godzina / Tytuł" + przyciski "Kup bilet"/"Rezerwuj" na stronie repertuaru. [1](https://www.hyperframer.com/framer-fetch-and-display-dynamic-data-from-api/)
function fallbackTeatrZaglebie(html, defaults) {
  const out = [];
  if (!html) return out;

  // 1) Wiersze <tr>...
  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
  for (const r of rows) {
    const row = r[1];

    // data: <time datetime="..."> | "8 lutego 2026" | "08.02.2026"
    const timeAttr = row.match(/<time[^>]*datetime=["']([^"']+)["']/i)?.[1] || null;
    const humanPl  = row.match(/(\d{1,2}\s+(stycznia|lutego|marca|kwietnia|maja|czerwca|lipca|sierpnia|września|października|listopada|grudnia)\s+\d{4})/i)?.[1] || null;
    const humanDot = row.match(/\b\d{1,2}\.\d{1,2}\.\d{4}\b/)?.[0] || null;

    const iso = normalizeDateToken(timeAttr) || plDateToISO(humanPl) || normalizeDateToken(humanDot);
    const time = row.match(/\b\d{1,2}:\d{2}\b/)?.[0] || null;

    // tytuł z <a>/<strong>/<hN>
    const a = row.match(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]{3,200}?)<\/a>/i);
    const strong = row.match(/<strong[^>]*>([\s\S]{3,200}?)<\/strong>/i);
    const h = row.match(/<h[1-6][^>]*>([\s\S]{3,200}?)<\/h[1-6]>/i);
    const title = stripTags(a?.[2] || strong?.[1] || h?.[1] || '');

    let href = a?.[1] || defaults.url;
    if (href && !href.startsWith('http')) {
      try { href = new URL(href, defaults.url).href; } catch {}
    }

    if (iso && title) out.push({ city: defaults.city, theatre: defaults.theatre, title, date: iso, time, url: href });
  }

  // 2) Marker "Kup bilet"/"Rezerwuj" — okno ~700 znaków wstecz
  if (out.length === 0) {
    const markers = [...html.matchAll(/(?:Kup bilet|Rezerwuj)/gi)];
    for (const m of markers) {
      const idx = m.index ?? 0;
      const win = html.slice(Math.max(0, idx - 700), idx + 50);

      const timeAttr = win.match(/<time[^>]*datetime=["']([^"']+)["']/i)?.[1] || null;
      const humanPl  = win.match(/(\d{1,2}\s+(stycznia|lutego|marca|kwietnia|maja|czerwca|lipca|sierpnia|września|października|listopada|grudnia)\s+\d{4})/i)?.[1] || null;
      const humanDot = win.match(/\b\d{1,2}\.\d{1,2}\.\d{4}\b/)?.[0] || null;

      const iso = normalizeDateToken(timeAttr) || plDateToISO(humanPl) || normalizeDateToken(humanDot);
      const time = win.match(/\b\d{1,2}:\d{2}\b/)?.[0] || null;

      const a = win.match(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]{3,200}?)<\/a>/i);
      const strong = win.match(/<strong[^>]*>([\s\S]{3,200}?)<\/strong>/i);
      const h = win.match(/<h[1-6][^>]*>([\s\S]{3,200}?)<\/h[1-6]>/i);
      const title = stripTags(a?.[2] || strong?.[1] || h?.[1] || '');

      let href = a?.[1] || defaults.url;
      if (href && !href.startsWith('http')) {
        try { href = new URL(href, defaults.url).href; } catch {}
      }

      if (iso && title) out.push({ city: defaults.city, theatre: defaults.theatre, title, date: iso, time, url: href });
    }
  }

  // deduplikacja
  const seen = new Set();
  return out.filter(e => { const k=`${e.title}|${e.date}|${e.time||''}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

// ====== OGÓLNY fallback — bardzo zachowawczy (dla innych) ======
function ultraSafeFallback(html, defaults) {
  const events = [];
  if (!html) return events;

  // <time datetime="..."> + tytuł w pobliżu linku/nagłówka
  const timeTags = [...html.matchAll(/<time[^>]*datetime=["']([^"']+)["'][^>]*>[\s\S]*?<\/time>/gi)];
  for (const m of timeTags) {
    const start = m[1];
    const { date, time } = toDateTimeInTZ(start, TZ);
    if (!date) continue;

    const idx = m.index ?? 0;
    const win = html.slice(Math.max(0, idx - 250), Math.min(html.length, idx + 500));
    const a = win.match(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]{3,200}?)<\/a>/i);
    const h = win.match(/<h[1-6][^>]*>([\s\S]{3,220}?)<\/h[1-6]>/i);
    const title = stripTags(a?.[2] || h?.[1] || '');

    if (title) events.push({ city: defaults.city, theatre: defaults.theatre, title, date, time, url: a?.[1] || defaults.url });
  }

  // bardzo miękki fallback tekstowy
  if (events.length === 0) {
    const text = stripTags(html);
    const dateRe = /(\d{4}-\d{2}-\d{2}|\b\d{1,2}\.\d{1,2}\.\d{4}\b)/g;
    const timeRe = /\b\d{1,2}:\d{2}\b/;
    let m;
    while ((m = dateRe.exec(text)) !== null) {
      const iso = normalizeDateToken(m[1]);
      if (!iso) continue;
      const around = text.slice(Math.max(0, m.index - 120), m.index + 160);
      const timeM = around.match(timeRe);
      const title = stripTags(around.replace(dateRe, ' ').replace(timeRe, ' ')).slice(0, 140);
      if (title) events.push({ city: defaults.city, theatre: defaults.theatre, title, date: iso, time: timeM?.[0] || null, url: defaults.url });
    }
  }

  const seen = new Set();
  return events.filter(e => { const k=`${e.title}|${e.date}|${e.time||''}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

// ====== HANDLER ======
export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  // dzień do pobrania
  let wantDate = todayInTZ(TZ);
  try {
    const u = new URL(req.url, 'http://localhost');
    wantDate = u.searchParams.get('date') || wantDate;
  } catch {}

  try {
    const results = [];

    // po kolei po teatrach — każdy w try/catch
    for (const t of THEATRES) {
      try {
        const html = await getHtml(t.url);
        if (!html) continue;

        // JSON-LD:
        let items = extractEventsFromJsonLd(html, t);

        // fallbacki:
        if (items.length === 0) {
          if (t.id === 'opera_slaska') {
            items = fallbackOperaSlaska(html, t);
          } else if (t.id === 'teatr_zaglebie') {
            items = fallbackTeatrZaglebie(html, t);
          } else {
            items = ultraSafeFallback(html, t);
          }
        }

        // filtr daty:
        items = items.filter(e => e.date === wantDate);
        results.push(...items);
      } catch {
        // ignoruj pojedyncze źródło
      }
    }

    // sort globalny: miasto → godzina → teatr → tytuł
    results.sort((a,b)=>{
      const c=(a.city||'').localeCompare(b.city||''); if(c) return c;
      const at=a.time||'99:99', bt=b.time||'99:99'; if(at!==bt) return at.localeCompare(bt);
      const t=(a.theatre||'').localeCompare(b.theatre||''); if(t) return t;
      return (a.title||'').localeCompare(b.title||'');
    });

    return res.status(200).json(results);
  } catch {
    // Nigdy 500 — najwyżej pusta lista
    return res.status(200).json([]);
  }
}
