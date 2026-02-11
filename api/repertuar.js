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
    } catch {
      // ignoruj błędny blok
    }
  }
  return out;
}

// (opcjonalny) bardzo zachowawczy fallback — tylko próba podłapania dat/godzin w treści.
function ultraSafeFallback(html, defaults) {
  // Szukamy fragmentów z datą i godziną, ale nic nie gwarantujemy — lepiej zwrócić []
  // niż zepsuć cały endpoint. Docelowo można tu dodać dedykowane selektory per teatr.
  const events = [];
  // przykład: dopasuj YYYY-MM-DD lub DD.MM.YYYY oraz HH:mm w odległości do 120 znaków
  const dateRe = /(\d{4}-\d{2}-\d{2}|\b\d{1,2}\.\d{1,2}\.\d{4}\b)/g;
  const timeRe = /\b\d{1,2}:\d{2}\b/;

  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  let m;
  while ((m = dateRe.exec(text)) !== null) {
    const around = text.slice(Math.max(0, m.index - 120), m.index + 120);
    const timeM = around.match(timeRe);
    const title = around.replace(dateRe, ' ').replace(timeRe, ' ').trim().slice(0, 120);
    // Uproszczona normalizacja daty
    let iso = m[1];
    if (/^\d{1,2}\.\d{1,2}\.\d{4}$/.test(iso)) {
      const [d,mm,y] = iso.split('.');
      iso = `${y}-${mm.padStart(2,'0')}-${d.padStart(2,'0')}`;
    }
    const { date, time } = { date: iso, time: timeM ? timeM[0] : null };
    if (date && title) {
      events.push({
        city: defaults.city, theatre: defaults.theatre,
        title: title, date, time, url: defaults.url
      });
    }
  }
  return events;
}

// ====== HANDLER ======
export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  // 1) Jaki dzień bierzemy?
  let wantDate = todayInTZ(TZ);
  try {
    const u = new URL(req.url, 'http://localhost');
    wantDate = u.searchParams.get('date') || wantDate;
  } catch {}

  try {
    const results = [];

    // 2) Jedziemy po teatrach — sekwencyjnie, z try/catch; żadnych crashy
    for (const t of THEATRES) {
      try {
        const html = await getHtml(t.url);
        if (!html) continue;
        // Najpierw JSON-LD:
        let items = extractEventsFromJsonLd(html, t);
        // Jeśli brak — ultra ostrożny fallback (może nic nie złapać; to OK):
        if (items.length === 0) {
          items = ultraSafeFallback(html, t);
        }
        // Filtr na dzień:
        items = items.filter(e => e.date === wantDate);
        results.push(...items);
      } catch {
        // ignoruj pojedyncze padnięte źródło
      }
    }

    // 3) Sort: miasto → godzina → teatr → tytuł
    results.sort((a,b)=>{
      const c=(a.city||'').localeCompare(b.city||''); if(c) return c;
      const at=a.time||'99:99', bt=b.time||'99:99'; if(at!==bt) return at.localeCompare(bt);
      const t=(a.theatre||'').localeCompare(b.theatre||''); if(t) return t;
      return (a.title||'').localeCompare(b.title||'');
    });

    return res.status(200).json(results);
  } catch {
    // Nigdy 500 z HTML-em — najwyżej pustą listę
    return res.status(200).json([]);
  }
}
