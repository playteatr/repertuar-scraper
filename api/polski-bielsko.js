// /api/polski-bielsko — Teatr Polski w Bielsku-Białej
// Lekki, odporny endpoint: 1 fetch + bezpieczne heurystyki.
// ZAWSZE zwraca JSON (w najgorszym razie pustą tablicę []).

const URL = "https://www.teatr.bielsko.pl/repertuar"; // oficjalny repertuar
const CITY = "Bielsko-Biała";
const THEATRE = "Teatr Polski w Bielsku-Białej";
const TZ = "Europe/Warsaw";

// --- helpers ---
function todayTZ() {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit"
  });
  return f.format(new Date()); // YYYY-MM-DD
}

function stripTags(s){ return String(s||"").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim(); }

function toDateTimeInTZ(x){
  const d = new Date(x);
  if (isNaN(d)) return { date:null, time:null };
  const date = new Intl.DateTimeFormat("en-CA",{timeZone:TZ,year:"numeric",month:"2-digit",day:"2-digit"}).format(d);
  const time = new Intl.DateTimeFormat("en-GB",{timeZone:TZ,hour:"2-digit",minute:"2-digit",hour12:false}).format(d);
  return { date, time };
}

function normalizeDateToken(s){
  if(!s) return null;
  s = String(s).trim();
  if(/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;                 // YYYY-MM-DD
  const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);       // DD.MM.YYYY
  if(m){ return `${m[3]}-${m[2].padStart(2,"0")}-${m[1].padStart(2,"0")}`; }
  return null;
}
function plDateToISO(s){
  if(!s) return null;
  const map = {"stycznia":"01","lutego":"02","marca":"03","kwietnia":"04","maja":"05","czerwca":"06",
               "lipca":"07","sierpnia":"08","września":"09","października":"10","listopada":"11","grudnia":"12"};
  const m = String(s).toLowerCase().match(/(\d{1,2})\s+([a-ząćęłńóśźż]+)\s+(\d{4})/i);
  if(!m) return null;
  const mm = map[m[2]]; if(!mm) return null;
  return `${m[3]}-${mm}-${m[1].padStart(2,"0")}`;
}

// --- handler ---
export default async function handler(req, res) {
  res.setHeader("Content-Type","application/json; charset=utf-8");

  try {
    // 1) Docelowa data
    const want = (() => {
      try { const u = new URL(req.url,"http://localhost"); return u.searchParams.get("date") || todayTZ(); }
      catch { return todayTZ(); }
    })();

    // 2) Pobierz HTML
    const ctrl = new AbortController();
    const timer = setTimeout(()=>ctrl.abort(), 9000);
    const r = await fetch(URL, { signal: ctrl.signal, headers: { "User-Agent":"PlayTeatrBot/1.0" } }).catch(()=>null);
    clearTimeout(timer);
    if(!r || !r.ok) return res.status(200).json([]);

    const html = await r.text();
    if(!html) return res.status(200).json([]);

    const events = [];

    // 3) Najpierw JSON-LD (Event) — jeśli jest
    const ldBlocks = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
    const walk = (o)=>{
      if(!o || typeof o!=="object") return;
      const types = Array.isArray(o["@type"]) ? o["@type"] : (o["@type"] ? [o["@type"]] : []);
      if (types.includes("Event")) {
        const title = String(o.name || o.headline || "").trim();
        const start = o.startDate || o.startTime || o.start || null;
        const url   = o.url || URL;
        if (title && start) {
          const { date, time } = toDateTimeInTZ(start);
          if (date) events.push({ city:CITY, theatre:THEATRE, title, date, time, url });
        }
      }
      for (const k in o) {
        const v = o[k];
        if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v==="object") walk(v);
      }
    };
    for (const b of ldBlocks) {
      try { const data = JSON.parse(b[1]); Array.isArray(data)?data.forEach(walk):walk(data); } catch {}
    }

    // 4) Fallback #1: „tabela/wiersze” + data/godzina/tytuł/link
    if (events.length === 0) {
      // wiersze <tr> ...
      const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
      for (const m of rows) {
        const row = m[1];

        // data: 3 warianty
        const dAttr = row.match(/<time[^>]*datetime=["']([^"']+)["'][^>]*>/i)?.[1] || null;
        const dPL   = row.match(/(\d{1,2}\s+(stycznia|lutego|marca|kwietnia|maja|czerwca|lipca|sierpnia|września|października|listopada|grudnia)\s+\d{4})/i)?.[1] || null;
        const dDOT  = row.match(/\b(\d{1,2}\.\d{1,2}\.\d{4})\b/)?.[1] || null;

        const iso = (dAttr ? toDateTimeInTZ(dAttr).date : null) || plDateToISO(dPL) || normalizeDateToken(dDOT);
        const time = row.match(/\b\d{1,2}:\d{2}\b/)?.[0] || null;

        // tytuł
        const a = row.match(/<a[^>]*>([\s\S]{3,240}?)<\/a>/i);
        const h = row.match(/<h[1-6][^>]*>([\s\S]{3,260}?)<\/h[1-6]>/i);
        const strong = row.match(/<strong[^>]*>([\s\S]{3,260}?)<\/strong>/i);
        const title = stripTags(a?.[1] || h?.[1] || strong?.[1] || "");
        if (!iso || !title) continue;

        // link (jeśli względny → absolutny)
        let href = a ? (a[0].match(/href=["']([^"']+)["']/i)?.[1] || URL) : URL;
        if (href && !href.startsWith("http")) { try { href = new URL(href, URL).href; } catch {} }

        events.push({ city: CITY, theatre: THEATRE, title, date: iso, time, url: href });
      }
    }

    // 5) Fallback #2: marker „Kup bilet” – cofnij ~700 znaków
    if (events.length === 0) {
      const markers = [...html.matchAll(/Kup bilet/gi)];
      for (const m of markers) {
        const idx = m.index ?? 0;
        const win = html.slice(Math.max(0, idx - 700), Math.min(html.length, idx + 50));

        const dAttr = win.match(/<time[^>]*datetime=["']([^"']+)["'][^>]*>/i)?.[1] || null;
        const dPL   = win.match(/(\d{1,2}\s+(stycznia|lutego|marca|kwietnia|maja|czerwca|lipca|sierpnia|września|października|listopada|grudnia)\s+\d{4})/i)?.[1] || null;
        const dDOT  = win.match(/\b(\d{1,2}\.\d{1,2}\.\d{4})\b/)?.[1] || null;

        const iso = (dAttr ? toDateTimeInTZ(dAttr).date : null) || plDateToISO(dPL) || normalizeDateToken(dDOT);
        const time = win.match(/\b\d{1,2}:\d{2}\b/)?.[0] || null;

        const a = win.match(/<a[^>]*>([\s\S]{3,240}?)<\/a>/i);
        const h = win.match(/<h[1-6][^match(/<strong[^>]*>([\s\S]{3,260}?)<\/strong>/i);
        const title = stripTags(a?.[1] || h?.[1] || strong?.[1] || "");
        if (!iso || !title) continue;

        let href = a ? (a[^"']+["']/i)?.[1] || URL) : URL;
        if (href && !href.startsWith("http")) { try { href = new URL(href, URL).href; } catch {} }

        events.push({ city: CITY, theatre: THEATRE, title, date: iso, time, url: href });
      }
    }

    // 6) Dedup + filtr „na dziś”
    const seen = new Set();
    const dedup = events.filter(e => { const key=`${e.title}|${e.date}|${e.time||""}`; if(seen.has(key)) return false; seen.add(key); return true; });
    const todayOnly = dedup.filter(e => e.date === want);

    // 7) Sortowanie: godzina → tytuł
    todayOnly.sort((a,b)=> (a.time||"99:99").localeCompare(b.time||"99:99") || (a.title||"").localeCompare(b.title||""));

    return res.status(200).json(todayOnly);
  } catch {
    // Nigdy 500
    return res.status(200).json([]);
  }
}
