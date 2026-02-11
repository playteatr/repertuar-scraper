import { fetch as undiciFetch } from 'undici';
import cheerio from 'cheerio';
import dayjs from 'dayjs';
import utc from 'dayjs-plugin-utc';
import tz from 'dayjs-plugin-timezone';

dayjs.extend(utc);
dayjs.extend(tz);
const TZ = 'Europe/Warsaw';

async function getHtml(url) {
  const r = await undiciFetch(url, {
    headers: { 'User-Agent': 'AD-repertuar/1.0 (+contact: you@example.com)' }
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return await r.text();
}
function normalize(s){return (s||'').replace(/\s+/g,' ').replace(/[ \t]+$/gm,'').trim();}
function jsonLdEvents(html, baseUrl, defaults={}) {
  const out=[]; const $=cheerio.load(html);
  $('script[type="application/ld+json"]').each((_,el)=>{
    try{
      const data=JSON.parse($(el).contents().text());
      const arr=Array.isArray(data)?data:[data];
      const walk=(o)=>{
        if(!o) return;
        if(o['@type']==='Event'||o['@type']?.includes?.('Event')){
          const start=o.startDate||o.startTime||o.start;
          const dt=start?dayjs.tz(start,TZ):null;
          out.push({
            title: normalize(o.name||o.headline||o.about||''),
            date: dt?.format('YYYY-MM-DD')||null,
            time: dt?.format('HH:mm')||null,
            url: o.url||baseUrl,
            ...defaults
          });
        }
        for(const k of Object.keys(o||{})){
          const v=o[k];
          if(Array.isArray(v)) v.forEach(walk);
          else if(v&&typeof v==='object') walk(v);
        }
      };
      arr.forEach(walk);
    }catch(e){}
  });
  return out.filter(e=>e.title);
}
function onlyDate(d){return d?dayjs.tz(d,TZ).format('YYYY-MM-DD'):dayjs().tz(TZ).format('YYYY-MM-DD');}
function sameDay(a,b){return dayjs.tz(a,TZ).isSame(dayjs.tz(b,TZ),'day');}

// ===== ADAPTERY — każdy teatr ma mini-reguły parsowania =====
const ADAPTERS = [
  // Będzin — Teatr Dzieci Zagłębia im. J. Dormana
  { id:'teatr_bedzin_dorman', theatre:'Teatr Dzieci Zagłębia im. J. Dormana', city:'Będzin',
    url:'https://teatr.bedzin.pl/repertuar/', // oficjalny repertuar
    parse: async function(){
      const html=await getHtml(this.url); let items=jsonLdEvents(html,this.url,{city:this.city,theatre:this.theatre});
      if(items.length===0){
        const $=cheerio.load(html);
        $('.repertuar-item, .event, article').each((_,el)=>{
          const title=normalize($(el).find('.title, .event-title, h3, h2').first().text());
          const dTxt=$(el).find('time[datetime]').attr('datetime')||normalize($(el).find('.date, .event-date').first().text());
          const tTxt=normalize($(el).find('.time, .event-time').first().text());
          const href=$(el).find('a').first().attr('href');
          const d=dayjs.tz(dTxt?.replace(/\./g,'-'),TZ);
          if(title&&d.isValid()){
            items.push({title, date:d.format('YYYY-MM-DD'), time:tTxt?.match(/\d{1,2}:\d{2}/)?.[0]||null,
              url: href?.startsWith('http')?href:(href?new URL(href,this.url).href:this.url),
              city:this.city, theatre:this.theatre});
          }
        });
      }
      return items;
    }},

  // Bielsko-Biała — Teatr Polski
  { id:'teatr_polski_bielsko', theatre:'Teatr Polski w Bielsku-Białej', city:'Bielsko-Biała',
    url:'https://www.teatr.bielsko.pl/repertuar',
    parse: async function(){
      const html=await getHtml(this.url); let items=jsonLdEvents(html,this.url,{city:this.city,theatre:this.theatre});
      if(items.length===0){
        const $=cheerio.load(html);
        $('.repertoire-item, .event, li, .show').each((_,el)=>{
          const title=normalize($(el).find('.title, h3, h2, .name, a').first().text());
          const dTxt=$(el).find('time[datetime]').attr('datetime')||normalize($(el).find('.date').first().text());
          const tTxt=normalize($(el).find('.time').first().text());
          const href=$(el).find('a').first().attr('href');
          const d=dayjs.tz(dTxt,TZ);
          if(title&&d.isValid()){
            items.push({title, date:d.format('YYYY-MM-DD'), time:tTxt?.match(/\d{1,2}:\d{2}/)?.[0]||null,
              url: href?.startsWith('http')?href:(href?new URL(href,this.url).href:this.url),
              city:this.city, theatre:this.theatre});
          }
        });
      }
      return items;
    }},

  // Bielsko-Biała — Banialuka
  { id:'banialuka', theatre:'Teatr Lalek Banialuka im. J. Zitzmana', city:'Bielsko-Biała',
    url:'https://banialuka.pl/repertuar',
    parse: async function(){
      const html=await getHtml(this.url); let items=jsonLdEvents(html,this.url,{city:this.city,theatre:this.theatre});
      if(items.length===0){
        const $=cheerio.load(html);
        $('.event, .calendar .event').each((_,el)=>{
          const title=normalize($(el).find('.title, h3, h2').first().text());
          const dTxt=$(el).find('time[datetime]').attr('datetime')||normalize($(el).find('.date').first().text());
          const tTxt=normalize($(el).find('.time').first().text());
          const href=$(el).find('a').first().attr('href');
          const d=dayjs.tz(dTxt,TZ);
          if(title&&d.isValid()){
            items.push({title, date:d.format('YYYY-MM-DD'), time:tTxt?.match(/\d{1,2}:\d{2}/)?.[0]||null,
              url: href?.startsWith('http')?href:(href?new URL(href,this.url).href:this.url),
              city:this.city, theatre:this.theatre});
          }
        });
      }
      return items;
    }},

  // Bytom — Opera Śląska
  { id:'opera_slaska', theatre:'Opera Śląska', city:'Bytom',
    url:'https://opera-slaska.pl/repertuar',
    parse: async function(){
      const html=await getHtml(this.url); let items=jsonLdEvents(html,this.url,{city:this.city,theatre:this.theatre});
      if(items.length===0){
        const $=cheerio.load(html);
        $('.event, .list .item, .repertuar .event').each((_,el)=>{
          const title=normalize($(el).find('.title, h3, h2').first().text());
          const dTxt=$(el).find('time[datetime]').attr('datetime')||normalize($(el).find('.date').first().text());
          const tTxt=normalize($(el).find('.time').first().text());
          const href=$(el).find('a').first().attr('href');
          const d=dayjs.tz(dTxt,TZ);
          if(title&&d.isValid()){
            items.push({title, date:d.format('YYYY-MM-DD'), time:tTxt?.match(/\d{1,2}:\d{2}/)?.[0]||null,
              url: href?.startsWith('http')?href:(href?new URL(href,this.url).href:this.url),
              city:this.city, theatre:this.theatre});
          }
        });
      }
      return items;
    }},

  // Bytom — Teatr Rozbark (strona z newsami/wydarzeniami)
  { id:'rozbark', theatre:'Bytomski Teatr Tańca i Ruchu ROZBARK', city:'Bytom',
    url:'https://teatrrozbark.pl/',
    parse: async function(){
      const html=await getHtml(this.url); let items=jsonLdEvents(html,this.url,{city:this.city,theatre:this.theatre});
      if(items.length===0){
        const $=cheerio.load(html);
        $('article, .post, .event').each((_,el)=>{
          const title=normalize($(el).find('h2, h3, .entry-title').first().text());
          const dTxt=$(el).find('time[datetime]').attr('datetime')||normalize($(el).find('.date').first().text());
          if(title && /(spektakl|premiera|pokaz|koncert|warsztat)/i.test($(el).text())){
            const d=dayjs.tz(dTxt,TZ);
            if(d.isValid()){
              items.push({title, date:d.format('YYYY-MM-DD'),
                time: $(el).text().match(/\b\d{1,2}:\d{2}\b/)?.[0]||null,
                url: $(el).find('a').first().attr('href')||this.url,
                city:this.city, theatre:this.theatre});
            }
          }
        });
      }
      return items;
    }},

  // Chorzów — Teatr Rozrywki
  { id:'teatr_rozrywki', theatre:'Teatr Rozrywki', city:'Chorzów',
    url:'https://teatr-rozrywki.pl/repertuar.html',
    parse: async function(){
      const html=await getHtml(this.url); let items=jsonLdEvents(html,this.url,{city:this.city,theatre:this.theatre});
      if(items.length===0){
        const $=cheerio.load(html);
        $('.repertuar .row, .repertuar tr, .list .item').each((_,el)=>{
          const title=normalize($(el).find('a, .title, h3').first().text());
          const dTxt=normalize($(el).find('.data, .date, time[datetime]').first().text()
             || $(el).find('time[datetime]').attr('datetime'));
          const tTxt=normalize($(el).find('.godzina, .time').first().text());
          const href=$(el).find('a').first().attr('href');
          const d=dayjs.tz(dTxt,TZ);
          if(title&&d.isValid()){
            items.push({title, date:d.format('YYYY-MM-DD'), time:tTxt?.match(/\d{1,2}:\d{2}/)?.[0]||null,
              url: href?.startsWith('http')?href:(href?new URL(href,this.url).href:this.url),
              city:this.city, theatre:this.theatre});
          }
        });
      }
      return items;
    }},

  // Częstochowa — Teatr im. A. Mickiewicza
  { id:'teatr_mickiewicza_czestochowa', theatre:'Teatr im. A. Mickiewicza', city:'Częstochowa',
    url:'https://www.teatr-mickiewicza.pl/spektakl,repertuar',
    parse: async function(){
      const html=await getHtml(this.url); let items=jsonLdEvents(html,this.url,{city:this.city,theatre:this.theatre});
      if(items.length===0){
        const $=cheerio.load(html);
        $('table .row, .repertuar .event, .wydarzenie, li').each((_,el)=>{
          const title=normalize($(el).find('.title, a, h3').first().text());
          const dTxt=$(el).find('time[datetime]').attr('datetime')||normalize($(el).find('.date').first().text());
          const tTxt=normalize($(el).find('.time').first().text());
          const href=$(el).find('a').first().attr('href');
          const d=dayjs.tz(dTxt,TZ);
          if(title&&d.isValid()){
            items.push({title, date:d.format('YYYY-MM-DD'), time:tTxt?.match(/\d{1,2}:\d{2}/)?.[0]||null,
              url: href?.startsWith('http')?href:(href?new URL(href,this.url).href:this.url),
              city:this.city, theatre:this.theatre});
          }
        });
      }
      return items;
    }},

  // Gliwice — Teatr Miejski
  { id:'teatr_miejski_gliwice', theatre:'Teatr Miejski w Gliwicach', city:'Gliwice',
    url:'https://teatr.gliwice.pl/repertuar/',
    parse: async function(){
      const html=await getHtml(this.url); let items=jsonLdEvents(html,this.url,{city:this.city,theatre:this.theatre});
      if(items.length===0){
        const $=cheerio.load(html);
        $('.event, li, .row').each((_,el)=>{
          const title=normalize($(el).find('.title, a, h3').first().text());
          const dTxt=$(el).find('time[datetime]').attr('datetime')||normalize($(el).find('.date').first().text());
          const tTxt=normalize($(el).find('.time').first().text());
          const d=dayjs.tz(dTxt,TZ);
          if(title&&d.isValid()){
            items.push({title, date:d.format('YYYY-MM-DD'),
              time:tTxt?.match(/\d{1,2}:\d{2}/)?.[0]||null,
              url: $(el).find('a').first().attr('href')||this.url,
              city:this.city, theatre:this.theatre});
          }
        });
      }
      return items;
    }},

  // Katowice — Teatr Śląski
  { id:'teatr_slaski', theatre:'Teatr Śląski im. S. Wyspiańskiego', city:'Katowice',
    url:'https://teatrslaski.art.pl/repertuar/',
    parse: async function(){
      const html=await getHtml(this.url); let items=jsonLdEvents(html,this.url,{city:this.city,theatre:this.theatre});
      if(items.length===0){
        const $=cheerio.load(html);
        $('.event, .reper-item, li').each((_,el)=>{
          const title=normalize($(el).find('.title, a, h3').first().text());
          const dTxt=$(el).find('time[datetime]').attr('datetime')||normalize($(el).find('.date').first().text());
          const tTxt=normalize($(el).find('.time').first().text());
          const link=$(el).find('a').first().attr('href');
          const d=dayjs.tz(dTxt,TZ);
          if(title&&d.isValid()){
            items.push({title, date:d.format('YYYY-MM-DD'),
              time:tTxt?.match(/\d{1,2}:\d{2}/)?.[0]||null,
              url: link?.startsWith('http')?link:(link?new URL(link,this.url).href:this.url),
              city:this.city, theatre:this.theatre});
          }
        });
      }
      return items;
    }},

  // Katowice — Ateneum (lalek)
  { id:'ateneum_katowice', theatre:'Śląski Teatr Lalki i Aktora Ateneum', city:'Katowice',
    url:'https://ateneumteatr.pl/',
    parse: async function(){
      const html=await getHtml(this.url);
      const items=jsonLdEvents(html,this.url,{city:this.city,theatre:this.theatre});
      return items;
    }},

  // Sosnowiec — Teatr Zagłębia
  { id:'teatr_zaglebiA', theatre:'Teatr Zagłębia', city:'Sosnowiec',
    url:'https://teatrzaglebia.pl/repertuar/',
    parse: async function(){
      const html=await getHtml(this.url); let items=jsonLdEvents(html,this.url,{city:this.city,theatre:this.theatre});
      if(items.length===0){
        const $=cheerio.load(html);
        $('table tr, .repertuar .row').each((_,el)=>{
          const dateTxt=normalize($(el).find('td:nth-child(1), .date').first().text());
          const timeTxt=normalize($(el).find('td:nth-child(2), .time').first().text());
          const title=normalize($(el).find('td:nth-child(3) a, .title a, .title').first().text());
          const href=$(el).find('td:nth-child(3) a, .title a').first().attr('href');
          const d=dayjs.tz(dateTxt,TZ);
          if(title&&d.isValid()){
            items.push({title, date:d.format('YYYY-MM-DD'), time:timeTxt?.match(/\d{1,2}:\d{2}/)?.[0]||null,
              url: href?.startsWith('http')?href:(href?new URL(href,this.url).href:this.url),
              city:this.city, theatre:this.theatre});
          }
        });
      }
      return items;
    }},

  // Tychy — Teatr Mały (kalendarium)
  { id:'teatr_maly_tychy', theatre:'Teatr Mały', city:'Tychy',
    url:'https://teatrmaly.tychy.pl/kalendarium/',
    parse: async function(){
      const html=await getHtml(this.url); let items=jsonLdEvents(html,this.url,{city:this.city,theatre:this.theatre});
      if(items.length===0){
        const $=cheerio.load(html);
        $('.entry, li, .event, .row').each((_,el)=>{
          const block=$(el).text();
          const title=normalize($(el).find('h3, h2, .title, a').first().text());
          const timeTxt=block.match(/\b\d{1,2}:\d{2}\b/)?.[0]||null;
          const dateTxt=block.match(/\b\d{1,2}\.\d{1,2}\.\d{4}\b/)?.[0]||$(el).find('time[datetime]').attr('datetime');
          const href=$(el).find('a').first().attr('href');
          const d=dateTxt?dayjs.tz(dateTxt.replace(/\./g,'-'),TZ):null;
          if(title&&d?.isValid()){
            items.push({title, date:d.format('YYYY-MM-DD'), time:timeTxt, url:href||this.url,
              city:this.city, theatre:this.theatre});
          }
        });
      }
      return items;
    }},

  // Zabrze — Teatr Nowy
  { id:'teatr_nowy_zabrze', theatre:'Teatr Nowy w Zabrzu', city:'Zabrze',
    url:'https://teatrzabrze.pl/repertuar/',
    parse: async function(){
      const html=await getHtml(this.url); let items=jsonLdEvents(html,this.url,{city:this.city,theatre:this.theatre});
      if(items.length===0){
        const $=cheerio.load(html);
        $('.event, li, .row, tr').each((_,el)=>{
          const title=normalize($(el).find('a, .title, h3').first().text());
          const dTxt=$(el).find('time[datetime]').attr('datetime')||normalize($(el).find('.date, td').first().text());
          const timeTxt=normalize($(el).find('.time, td').eq(1).text());
          const link=$(el).find('a').first().attr('href');
          const d=dayjs.tz(dTxt,TZ);
          if(title&&d.isValid()){
            items.push({title, date:d.format('YYYY-MM-DD'), time:timeTxt?.match(/\d{1,2}:\d{2}/)?.[0]||null,
              url: link?.startsWith('http')?link:(link?new URL(link,this.url).href:this.url),
              city:this.city, theatre:this.theatre});
          }
        });
      }
      return items;
    }},

  // (opcjonalnie) Cieszyn — Teatr im. A. Mickiewicza (jeśli chcesz go mieć równolegle)
  { id:'teatr_mickiewicza_cieszyn', theatre:'Teatr im. A. Mickiewicza', city:'Cieszyn',
    url:'https://teatr.cieszyn.pl/',
    parse: async function(){
      const html=await getHtml(this.url);
      return jsonLdEvents(html,this.url,{city:this.city,theatre:this.theatre});
    }}
];

export default async function handler(req, res){
  try{
    const urlObj=new URL(req.url, 'http://localhost');
    const dateParam=urlObj.searchParams.get('date');
    const filterDate=onlyDate(dateParam);
    const qCity=urlObj.searchParams.get('city')?.toLowerCase();
    const qTheatre=urlObj.searchParams.get('theatre')?.toLowerCase();

    const results=(await Promise.allSettled(ADAPTERS.map(async ad=>{
      const list=await ad.parse();
      return list.map(x=>({
        ...x,
        time: x.time||null,
        url: x.url||ad.url,
        source: ad.id,
        theatre: x.theatre||ad.theatre,
        city: x.city||ad.city
      }));
    }))).flatMap(p=>p.status==='fulfilled'?p.value:[]);

    let today=results.filter(x=>x.date && sameDay(x.date, filterDate));
    if(qCity) today=today.filter(x=>(x.city||'').toLowerCase().includes(qCity));
    if(qTheatre) today=today.filter(x=>(x.theatre||'').toLowerCase().includes(qTheatre));

    today.sort((a,b)=>{
      const c=(a.city||'').localeCompare(b.city||''); if(c) return c;
      const at=a.time||'99:99', bt=b.time||'99:99'; if(at!==bt) return at.localeCompare(bt);
      const t=(a.theatre||'').localeCompare(b.theatre||''); if(t) return t;
      return (a.title||'').localeCompare(b.title||'');
    });

    res.setHeader('Content-Type','application/json; charset=utf-8');
    res.statusCode=200;
    res.end(JSON.stringify(today, null, 2));
  }catch(e){
    res.statusCode=500;
    res.end(JSON.stringify({ error:e.message }));
  }
}
