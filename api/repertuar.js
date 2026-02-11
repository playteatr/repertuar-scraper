import cheerio from 'cheerio';
import { fetch as undiciFetch } from 'undici';

export default async function handler(req, res) {
  try {
    const url = 'https://teatrslaski.art.pl/repertuar/';
    const r = await undiciFetch(url);
    const html = await r.text();

    const $ = cheerio.load(html);

    const events = [];

    $('.event, .reper-item, li').each((_, el) => {
      const title = $(el).find('.title, a, h3').first().text().trim();
      const date = $(el).find('.date').first().text().trim();
      const time = $(el).find('.time').first().text().trim();
      const href = $(el).find('a').first().attr('href');

      if (title && date) {
        events.push({
          city: "Katowice",
          theatre: "Teatr Śląski",
          title,
          date,
          time,
          url: href?.startsWith('http') ? href : (href ? `${url}${href}` : url)
        });
      }
    });

    res.setHeader('Content-Type', 'application/json');
    res.status(200).json(events);

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
