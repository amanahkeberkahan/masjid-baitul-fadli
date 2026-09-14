import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { records } from "../../../db/schema";
const kinds = new Set(["transaction", "program", "event", "member"]);
export async function GET(request: Request) {
  try {
    const kind = new URL(request.url).searchParams.get("kind") ?? "";
    const db = getDb();
    const rows = kind && kinds.has(kind)
      ? await db.select().from(records).where(eq(records.kind, kind)).orderBy(desc(records.id))
      : await db.select().from(records).orderBy(desc(records.id));
    return Response.json({ records: rows });
  } catch { return Response.json({ error: "Data belum dapat dimuat." }, { status: 500 }); }
}
export async function POST(request: Request) {
  try {
    const p = await request.json() as Record<string, string | number>;
    const kind = String(p.kind ?? ""), title = String(p.title ?? "").trim();
    if (!kinds.has(kind) || !title) return Response.json({ error: "Data wajib belum lengkap." }, { status: 400 });
    const [record] = await getDb().insert(records).values({
      kind, title, date: String(p.date ?? ""), amount: Number(p.amount ?? 0),
      type: String(p.type ?? ""), category: String(p.category ?? ""), details: String(p.details ?? ""),
      target: Number(p.target ?? 0), phone: String(p.phone ?? ""), address: String(p.address ?? ""),
    }).returning();
    return Response.json({ record }, { status: 201 });
  } catch { return Response.json({ error: "Data gagal disimpan." }, { status: 500 }); }
}
export async function DELETE(request: Request) {
  try {
    const id = Number(new URL(request.url).searchParams.get("id"));
    if (!id) return Response.json({ error: "ID tidak valid." }, { status: 400 });
    await getDb().delete(records).where(eq(records.id, id));
    return Response.json({ ok: true });
  } catch { return Response.json({ error: "Data gagal dihapus." }, { status: 500 }); }
}
