export async function GET() {
  return Response.json({ records: [], storage: "browser" });
}

export async function POST() {
  return Response.json(
    { error: "Data aplikasi versi ini disimpan di browser pengguna." },
    { status: 410 },
  );
}

export async function DELETE() {
  return Response.json(
    { error: "Data aplikasi versi ini disimpan di browser pengguna." },
    { status: 410 },
  );
}
