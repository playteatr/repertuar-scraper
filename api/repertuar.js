export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  const today = new Date().toISOString().slice(0, 10);
  res.status(200).json([
    {
      city: "Katowice",
      theatre: "Test Theatre",
      title: "API DZIAŁA",
      date: today,
      time: "19:00",
      url: "https://example.com"
    }
  ]);
}
