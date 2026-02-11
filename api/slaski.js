import { fetch as undiciFetch } from 'undici';
import cheerio from 'cheerio';
import dayjs from 'dayjs';
import utc from 'dayjs-plugin-utc';
import tz from 'dayjs-plugin-timezone';

dayjs.extend(utc);
dayjs.extend(tz);
const TZ = 'Europe/Warsaw';
const BASE = 'https://teatrslaski.art.pl/repertuar/';

// mały helper z timeoutem
async function getHtml(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await undiciFetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'PlayTeatr/1.0 (+contact: you@example.com)' }
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } finally {
    clearTimeout(timer);
  }
}

function norm(s) {
  return (s || '').replace(/\s+/g, ' ').trim();
}

// próba wyjęcia zdarzeń z JSON-LD
function parseJsonLd(html) {
  const out = [];
  const $ = cheerio.load(html);
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const txt = $(el).contents().text();
      const data = JSON.parse(txt);
      const arr = Array.isArray(data) ? data : [data];
      for (const o of arr) {
        if (!o) continue;
        const types = [].concat(o['@type'] || []);
        if (types.includes('Event')) {
          const start = o.startDate || o.startTime || o.start;
          const dt = start ? dayjs.tz(start, TZ) : null;
          out.push({
            city: 'Katowice',
            theatre: 'Teatr Śląski',
            title: norm(o.name || o.headline || ''),
            date: dt?.isValid() ? dt.format('YYYY-MM-DD') : null,
            time: dt?.isValid() ? dt.format('HH:mm') : null,
            url: o.url || BASE
          });
        }
      }
    } catch {}
  });
  return out.filter(e => e.title && e.date);
}

// fallback po selektorach (gdy brak JSON-LD)
function parseBySelectors(html) {
  const out = [];
  const $ = cheerio.load(html);

  // łap szeroko – różne klasy; w razie zmiany struktury i tak nie wywalimy funkcji.
  $('.event, .reper-item, li, article, .row, .item').each((_, el) => {
    const title = norm($(el).find('.title, h3, h2, a').first().text());
    const dateTxt = norm(
      $(el).find('time[datetime]').attr('datetime') ||
      $(el).find('.date, .data').first().text()
    );
    const timeTxt = norm($(el).find('.time, .godzina').first().text());
    let href = $(el).find('a').first().attr('href') || BASE;

    if (href && !href.startsWith('http')) {
      try { href = new URL(href, BASE).href; } catch {}
    }

    // spróbuj różne formaty dat
    let d = null;
    if (/\d{4}-\d{2}-\d{2}/.test(dateTxt)) {
      d = dayjs.tz(dateTxt, TZ);
    } else if (/\d{1,2}\.\d{1,2}\.\d{4}/.test(dateTxt)) {
      const normDate = dateTxt.replace(/(\d{1,2})\.(\d{1,2})\.(\d{4})/, '$3-$2-$1');
      d = dayjs.tz(normDate, TZ);
    }

    const timeMatch = timeTxt.match(/\b\d{1,2}:\d{2}\b/);

    if (title && d?.isValid()) {
      out.push({
        city: 'Katowice',
        theatre: 'Teatr Śląski',
        title,
        date: d.format('YYYY-MM-DD'),
        time: timeMatch ? timeMatch[0] : null,
        url: href
      });
    }
  });

  return out;
}

export default async function handler(req, res) {
  try {
    const html = await getHtml(BASE);
    let events = parseJsonLd(html);
    if (events.length === 0) {
      events = parseBySelectors(html);
    }

    // filtr „na dziś” (jak w Sheets)
    const q = new URL(req.url, 'http://localhost');
    const filterDate = q.searchParams.get('date')
      ? dayjs.tz(q.searchParams.get('date'), TZ).format('YYYY-MM-DD')
      : dayjs().tz(TZ).format('YYYY-MM-DD');

    events = events.filter(e => e.date === filterDate);

    // sort: godzina → tytuł
    events.sort((a, b) => {
      const at = a.time || '99:99', bt = b.time || '99:99';
      if (at !== bt) return at.localeCompare(bt);
      return (a.title || '').localeCompare(b.title || '');
    });

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(200).json(events);
  } catch (e) {
    // zamiast 500 z HTML-em — porządny JSON z błędem
    return res.status(200).json([]); // na „produkcyjnie” lepiej oddać pustą listę niż crash
  }
}
