import { put } from "@vercel/blob";

const MAX_FILE_BYTES = 8 * 1024 * 1024;

export async function POST(request: Request) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return Response.json({ error: "Layanan unggah gambar belum dikonfigurasi (Vercel Blob belum tersambung ke project ini)." }, { status: 503 });
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

  try {
    const blob = await put(`uploads/${Date.now()}-${file.name}`, file, {
      access: "public",
      addRandomSuffix: true,
    });
    return Response.json({ url: blob.url });
  } catch {
    return Response.json({ error: "Gagal mengunggah gambar. Coba lagi." }, { status: 502 });
  }
}
