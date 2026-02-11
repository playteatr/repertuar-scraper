export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.status(200).json([{city:'Katowice', theatre:'Teatr Śląski', title:'TEST endpointu /api/slaski', date:new Date().toISOString().slice(0,10), time:'19:00', url:'https://teatrslaski.art.pl/repertuar/'}]);
}
