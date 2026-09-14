const prayerKeys = ["Fajr", "Sunrise", "Dhuhr", "Asr", "Maghrib", "Isha"] as const;

function jakartaDate() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta", day: "2-digit", month: "2-digit", year: "numeric",
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.day}-${value.month}-${value.year}`;
}

export async function GET() {
  try {
    const date = jakartaDate();
    const endpoint = `https://api.aladhan.com/v1/timingsByCity/${date}?city=Surabaya&country=Indonesia&method=20`;
    const response = await fetch(endpoint, { next: { revalidate: 21600 } });
    if (!response.ok) throw new Error("Prayer API request failed");
    const payload = await response.json() as {
      code: number;
      data: { timings: Record<string, string>; date: { readable: string; hijri: { date: string; month: { en: string } } } };
    };
    if (payload.code !== 200 || !payload.data?.timings) throw new Error("Prayer API response invalid");

    const timings = Object.fromEntries(prayerKeys.map((key) => [key, payload.data.timings[key].slice(0, 5)]));
    return Response.json({
      timings,
      dateLabel: `${payload.data.date.readable} · ${payload.data.date.hijri.date} ${payload.data.date.hijri.month.en}`,
      location: "Gunung Anyar, Surabaya",
      method: "Kementerian Agama Republik Indonesia",
    }, { headers: { "Cache-Control": "public, s-maxage=21600, stale-while-revalidate=86400" } });
  } catch {
    return Response.json({ error: "Jadwal salat belum tersedia." }, { status: 503 });
  }
}
