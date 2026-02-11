export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");

  const today = new Date().toISOString().slice(0, 10);

  res.status(200).json([
    {
      city: "Test City",
      theatre: "Test Theatre",
      title: "Świat działa",
      date: today,
      time: "19:00",
      url: "https://example.com"
    }
  ]);
}
