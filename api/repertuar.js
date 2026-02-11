// /api/repertuar — agregator: pobiera "na dziś" z wielu teatrów GZM/okolic.
// Zero zewnętrznych zależności. Nigdy nie zwraca HTML-a błędu; zawsze JSON (tablica).
// Jeżeli dla danego dnia brak danych w źródle — po prostu je pomijamy.

const TZ = 'Europe/Warsaw';

// ====== KONFIG: lista teatrów i ich strony repertuarowe ======
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
  { id:'teatr_zaglebie',       city:'Sosnowiec',    theatre:'Teatr Zagłębia',                       url:'https://teatrzaglebia.pl/repertuar/' },
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

// Wyciąganie JSON-LD (Event) — uniwersalne
function extractEventsFromJsonLd(html, defaults) {
  const blocks = [...html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  )];
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
        if (date) {
          out.push({
            city: defaults.city,
            theatre: defaults.theatre,
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
      else if (v && typeof v === 'object') walk(v);
    }
  };

  for (const m of blocks) {
    try {
      const data = JSON.parse(m[1]);
      if (Array.isArray(data)) data.forEach(walk); else walk(data);
    } catch {/* ignoruj błędny blok */}
  }
  return out;
}

// ====== FALLBACK DLA OPERy ŚLĄSKIEJ (custom) ======
// Heurystyka: bierzemy segmenty z <time datetime="..."> albo z datą/ godziną w tekście
// i w pobliżu szukamy tytułu (w <a> lub <h1-6>). Zero zależności, czysty tekst/regex.
function fallbackOperaSlaska(html, defaults) {
  const out = [];
  if (!html) return out;

  // 1) Spróbuj time[datetime] (najlepszy sygnał)
  const timeBlocks = [...html.matchAll(/<time[^>]*datetime=["']([^"']+)["'][^>]*>([\s\S]*?)<\/time>/gi)];
  for (const m of timeBlocks) {
    const start = m[1];
    const { date, time } = toDateTimeInTZ(start, TZ);
    if (!date) continue;

    // Szukamy tytułu w oknie +/- 300 znaków względem znacznika <time>
    const idx = m.index ?? 0;
    const winStart = Math.max(0, idx - 300);
    const winEnd   = Math.min(html.length, idx + 600);
    const win = html.slice(winStart, winEnd);

    // Kandydat tytułu: najbliższy <a>...</a> lub <h1-6>...</h1-6>
    let title = null;
    const aMatch = win.match(/<a\b[^>]*>([^<]{3,120})<\/a>/i);
    const hMatch = win.match(/<h[1-6]\b[^>]*>([^<]{3,160})<\/h[1-6]>/i);
    if (aMatch) title = aMatch[1].replace(/\s+/g,' ').trim();
    if (!title && hMatch) title = hMatch[1].replace(/\s+/g,' ').trim();

    if (title) {
      out.push({
        city: defaults.city, theatre: defaults.theatre,
        title, date, time, url: defaults.url
      });
    }
  }

  // 2) Jeśli nic nie wyszło, próbuj heurystyki tekstowej (data + godzina blisko siebie)
  if (out.length === 0) {
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const dateRe = /(\d{4}-\d{2}-\d{2}|\b\d{1,2}\.\d{1,2}\.\d{4}\b)/g;
    const timeRe = /\b\d{1,2}:\d{2}\b/;

    let m;
    while ((m = dateRe.exec(text)) !== null) {
      const iso = normalizeDateToken(m[1]);
      if (!iso) continue;

      const around = text.slice(Math.max(0, m.index - 120), m.index + 160);
      const timeM = around.match(timeRe);
      const titleCand = around
        .replace(dateRe, ' ')
        .replace(timeRe, ' ')
        .replace(/\s+/g,' ')
        .trim()
        .slice(0, 120);

      if (titleCand) {
        out.push({
          city: defaults.city, theatre: defaults.theatre,
          title: titleCand, date: iso, time: timeM ? timeM[0] : null, url: defaults.url
        });
      }
    }
  }

  // Unikalność (title+date+time)
  const seen = new Set();
  return out.filter(e=>{
    const key = `${e.title}|${e.date}|${e.time||''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ====== OGÓLNY fallback — bardzo zachowawczy (dla innych stron) ======
function ultraSafeFallback(html, defaults) {
  const events = [];
  if (!html) return events;

  // 1) time[datetime] blisko jakiegoś linku/nagłówka
  const timeBlocks = [...html.matchAll(/<time[^>]*datetime=["']([^"']+)["'][^>]*>([\s\S]*?)<\/time>/gi)];
  for (const m of timeBlocks) {
    const start = m[1];
    const { date, time } = toDateTimeInTZ(start, TZ);
    if (!date) continue;

    const idx = m.index ?? 0;
    const winStart = Math.max(0, idx - 250);
    const winEnd   = Math.min(html.length, idx + 500);
    const win = html.slice(winStart, winEnd);
    let title = null;
    const aMatch = win.match(/<a\b[^>]*>([^<]{3,120})<\/a>/i);
    const hMatch = win.match(/<h[1-6]\b[^>]*>([^<]{3,160})<\/h[1-6]>/i);
    if (aMatch) title = aMatch[1].replace(/\s+/g,' ').trim();
    if (!title && hMatch) title = hMatch[1].replace(/\s+/g,' ').trim();

    if (title) {
      events.push({
        city: defaults.city, theatre: defaults.theatre,
        title, date, time, url: defaults.url
      });
    }
  }

  // 2) Bardzo miękki tekstowy fallback
  if (events.length === 0) {
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const dateRe = /(\d{4}-\d{2}-\d{2}|\b\d{1,2}\.\d{1,2}\.\d{4}\b)/g;
    const timeRe = /\b\d{1,2}:\d{2}\b/;

    let m;

