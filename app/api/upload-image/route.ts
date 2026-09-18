const MAX_FILE_BYTES = 8 * 1024 * 1024;

export async function POST(request: Request) {
  const apiKey = process.env.IMGBB_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "Layanan unggah gambar belum dikonfigurasi (IMGBB_API_KEY belum diisi)." }, { status: 503 });
  }

  const incoming = await request.formData();
  const file = incoming.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "File tidak ditemukan." }, { status: 400 });
  }
  if (!file.type.startsWith("image/")) {
    return Response.json({ error: "File harus berupa gambar." }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return Response.json({ error: "Ukuran gambar maksimal 8MB." }, { status: 400 });
  }

  const outgoing = new FormData();
  outgoing.append("image", file);

  try {
    const response = await fetch(`https://api.imgbb.com/1/upload?key=${apiKey}`, {
      method: "POST",
      body: outgoing,
      signal: AbortSignal.timeout(20000),
    });
    const payload = await response.json() as { success?: boolean; data?: { url?: string } };
    if (!response.ok || !payload.success || !payload.data?.url) throw new Error("ImgBB upload failed");
    return Response.json({ url: payload.data.url });
  } catch {
    return Response.json({ error: "Gagal mengunggah gambar. Coba lagi." }, { status: 502 });
  }
}
