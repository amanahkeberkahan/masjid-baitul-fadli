import { supabaseAdmin } from "@/lib/supabase-admin";

export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return Response.json({ error: "Tidak terotentikasi." }, { status: 401 });

  const { data: callerData, error: callerError } = await supabaseAdmin.auth.getUser(token);
  if (callerError || !callerData.user) return Response.json({ error: "Sesi tidak valid." }, { status: 401 });

  const { data: callerAdmin } = await supabaseAdmin.from("admins").select("active, role").eq("id", callerData.user.id).maybeSingle();
  if (!callerAdmin || callerAdmin.active !== true || callerAdmin.role === "staff") {
    return Response.json({ error: "Hanya pengurus penuh yang dapat menambah akun." }, { status: 403 });
  }

  const body = await request.json() as { email?: string; password?: string; role?: string };
  const email = body.email?.trim();
  const password = body.password ?? "";
  const role = body.role === "staff" ? "staff" : "pengurus";
  if (!email || password.length < 6) {
    return Response.json({ error: "Email atau password tidak valid (password minimal 6 karakter)." }, { status: 400 });
  }

  const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email, password, email_confirm: true,
  });
  if (createError || !created.user) {
    const message = createError?.message ?? "";
    if (message.toLowerCase().includes("already")) {
      return Response.json({ error: "Email ini sudah terdaftar sebagai akun di Supabase Authentication. Gunakan email lain." }, { status: 409 });
    }
    return Response.json({ error: message || "Gagal membuat akun." }, { status: 400 });
  }

  const { error: insertError } = await supabaseAdmin.from("admins").insert({
    id: created.user.id, email, active: true, role, created_by: callerData.user.id,
  });
  if (insertError) {
    return Response.json({ error: `Akun dibuat di Supabase Authentication, tapi gagal disimpan sebagai pengurus: ${insertError.message}` }, { status: 500 });
  }
  return Response.json({ ok: true });
}
