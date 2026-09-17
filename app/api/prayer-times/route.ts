const prayerKeys = ["Fajr", "Sunrise", "Dhuhr", "Asr", "Maghrib", "Isha"] as const;

function jakartaDate() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta", day: "2-digit", month: "2-digit", year: "numeric",
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.day}-${value.month}-${value.year}`;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchWithRetry(endpoint: string, attempts = 3) {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(endpoint, { next: { revalidate: 21600 }, signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error(`Prayer API request failed (${response.status})`);
      return response;
    } catch (caught) {
      lastError = caught;
      if (attempt < attempts - 1) await sleep(400 * (attempt + 1));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Prayer API request failed");
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const lat = Number(url.searchParams.get("lat"));
    const lon = Number(url.searchParams.get("lon"));
    const useGps = Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;

    const date = jakartaDate();
    const endpoint = useGps
      ? `https://api.aladhan.com/v1/timings/${date}?latitude=${lat}&longitude=${lon}&method=20`
      : `https://api.aladhan.com/v1/timingsByCity/${date}?city=Surabaya&country=Indonesia&method=20`;
    const response = await fetchWithRetry(endpoint);
    const payload = await response.json() as {
      code: number;
      data: { timings: Record<string, string>; date: { readable: string; hijri: { date: string; month: { en: string } } } };
    };
    if (payload.code !== 200 || !payload.data?.timings) throw new Error("Prayer API response invalid");

    const timings = Object.fromEntries(prayerKeys.map((key) => [key, payload.data.timings[key].slice(0, 5)]));
    return Response.json({
      timings,
      dateLabel: `${payload.data.date.readable} · ${payload.data.date.hijri.date} ${payload.data.date.hijri.month.en}`,
      location: useGps ? `Lokasi Anda (${lat.toFixed(3)}, ${lon.toFixed(3)})` : "Gunung Anyar, Surabaya",
      method: "Kementerian Agama Republik Indonesia",
    }, { headers: { "Cache-Control": useGps ? "no-store" : "public, s-maxage=21600, stale-while-revalidate=86400" } });
  } catch {
    return Response.json({ error: "Jadwal salat belum tersedia." }, { status: 503 });
  }
}
