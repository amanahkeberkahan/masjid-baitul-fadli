"use client";

// Modul Donatur Tetap.
// Dua jalur pengumpulan:
//   1. Transfer  — donatur bayar sendiri via m-banking / QRIS (pengingat WA berisi link QRIS + nominal).
//   2. Diambil   — petugas mengambil tunai ke rumah. Uang tunai berstatus "di petugas" sampai
//                  bendahara menerima setoran; baru saat itu tercatat di Laporan Kas.
// Fitur lain: ceklis per bulan, tanda terima WA ke donatur, impor daftar teks, rekap tahunan.

import { useEffect, useMemo, useState } from "react";
import {
  BellRing, Bike, CheckCircle2, ClipboardCopy, FileUp, HandCoins, MapPin, MessageCircle, Pencil, Plus, Receipt, Search,
  Trash2, Undo2, UserCheck, Wallet, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { Intro, NumberField, Panel, Stat, currentJakartaPeriod, dateId, jakartaToday, money, monthId } from "./shared";

export type DonationSettings = {
  bankName: string; accountNumber: string; accountHolder: string; qrisUrl: string;
  reminderTemplate: string; pickupTemplate: string;
};
type CashAccount = { id: string; name: string };

export type Supporter = {
  id: string; name: string; phone: string; address: string; amount: number; frequency: string;
  status: string; reminderDay: number; method: Channel; collector: string; pickupNote: string;
  notes: string; anonymous: boolean; startPeriod: string; lastRemindedAt: string; createdAt: string;
};
type Payment = {
  id: string; supporterId: string; period: string; amount: number; paidAt: string;
  method: string; collector: string; depositedAt: string; transactionId: string; note: string;
};
type Channel = "Transfer" | "Diambil";
type Filter = "semua" | "belum" | "lunas" | "jatuh-tempo" | "transfer" | "diambil" | "tanpa-wa" | "nonaktif";
type Tab = "bulanan" | "jemput" | "tahunan";
type PaymentInput = { amount: number; paidAt: string; method: string; collector: string; note: string; kas: string; toLedger: boolean };

const CHANNEL_LABEL: Record<Channel, string> = { Transfer: "Transfer / QRIS", Diambil: "Diambil ke rumah" };
const PAY_METHODS = ["QRIS", "Transfer", "Tunai"];
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

export const DEFAULT_REMINDER_TEMPLATE = `Assalamu'alaikum warahmatullahi wabarakatuh, {nama}.

Semoga Allah senantiasa melimpahkan keberkahan, kesehatan, dan kelapangan rezeki untuk Bapak/Ibu sekeluarga.

Kami dari pengurus Masjid Baitul Fadli izin mengingatkan infaq donatur tetap bulan *{bulan}* sebesar *{nominal}*.

Pembayaran bisa melalui QRIS masjid (nominal sudah terisi):
{link}
{rekening}

Mohon abaikan pesan ini apabila sudah menunaikan. Jazakumullahu khairan katsiran atas dukungan Bapak/Ibu untuk kemakmuran masjid.

Wassalamu'alaikum warahmatullahi wabarakatuh.
Pengurus Masjid Baitul Fadli`;

export const DEFAULT_PICKUP_TEMPLATE = `Assalamu'alaikum warahmatullahi wabarakatuh, {nama}.

Semoga Allah senantiasa melimpahkan keberkahan, kesehatan, dan kelapangan rezeki untuk Bapak/Ibu sekeluarga.

Kami dari pengurus Masjid Baitul Fadli izin menginformasikan, insya Allah *{petugas}* akan berkunjung untuk mengambil infaq donatur tetap bulan *{bulan}* sebesar *{nominal}*.

Mohon kabari kami waktu yang paling longgar untuk Bapak/Ibu. Bila lebih nyaman, infaq juga bisa ditunaikan melalui QRIS:
{link}

Jazakumullahu khairan katsiran.
Wassalamu'alaikum warahmatullahi wabarakatuh.
Pengurus Masjid Baitul Fadli`;

function toChannel(value: unknown): Channel {
  const text = String(value ?? "").toLowerCase();
  return text === "diambil" || text === "tunai" ? "Diambil" : "Transfer";
}
function mapSupporter(row: Record<string, unknown>): Supporter {
  return {
    id: String(row.id), name: String(row.name ?? ""), phone: String(row.phone ?? ""), address: String(row.address ?? ""),
    amount: Number(row.amount ?? 0), frequency: String(row.frequency ?? "Bulanan") || "Bulanan",
    status: String(row.status ?? "baru"), reminderDay: Number(row.reminder_day ?? 1) || 1,
    method: toChannel(row.method), collector: String(row.collector ?? ""), pickupNote: String(row.pickup_note ?? ""),
    notes: String(row.notes ?? ""), anonymous: row.anonymous === true,
    startPeriod: String(row.start_period ?? ""), lastRemindedAt: String(row.last_reminded_at ?? ""),
    createdAt: String(row.created_at ?? ""),
  };
}
function mapPayment(row: Record<string, unknown>): Payment {
  return {
    id: String(row.id), supporterId: String(row.supporter_id), period: String(row.period ?? ""),
    amount: Number(row.amount ?? 0), paidAt: String(row.paid_at ?? ""), method: String(row.method ?? ""),
    collector: String(row.collector ?? ""), depositedAt: String(row.deposited_at ?? ""),
    transactionId: String(row.transaction_id ?? ""), note: String(row.note ?? ""),
  };
}
/** Tunai yang masih dipegang petugas (belum diserahkan ke bendahara). */
const isHeldCash = (payment: Payment) => payment.method === "Tunai" && !payment.depositedAt;

/** Nomor WA Indonesia ke format internasional tanpa "+" untuk wa.me (0812… / +62812… / 812… -> 62812…). */
export function normalizePhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("62")) return digits;
  if (digits.startsWith("0")) return `62${digits.slice(1)}`;
  if (digits.startsWith("8")) return `62${digits}`;
  return digits;
}
const waUrl = (phone: string, text: string) => `https://wa.me/${normalizePhone(phone)}?text=${encodeURIComponent(text)}`;
const mapsUrl = (address: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;

/** "100k", "100 K", "150rb", "1,5jt", "100.000" -> rupiah. */
function parseAmount(raw: string, suffix: string) {
  const unit = suffix.toLowerCase();
  if (unit === "jt" || unit === "juta") return Math.round(Number(raw.replace(",", ".")) * 1_000_000);
  if (unit) return Math.round(Number(raw.replace(",", ".")) * 1000);
  return Number(raw.replace(/[.,]/g, ""));
}

export type ParsedDonor = { name: string; amount: number; phone: string; anonymous: boolean; line: string };
/** Membaca daftar seperti "1. Dito 100k" / "17. Andi Witim, 100 K" / "Agus 0812xxxx 150rb" per baris. */
export function parseDonorList(text: string): { donors: ParsedDonor[]; skipped: string[] } {
  const donors: ParsedDonor[] = []; const skipped: string[] = [];
  for (const original of text.split(/\r?\n/)) {
    let line = original.trim();
    if (!line) continue;
    line = line.replace(/^\d+\s*[.)]\s*/, "").trim();
    if (!line || /^[.\s…-]+$/.test(line)) continue; // baris "18. .." kosong
    if (/^daftar\b/i.test(line)) continue; // judul daftar
    let phone = "";
    const phoneMatch = line.match(/(?:\+?62[\s-]?|0)8\d{1,3}(?:[\s-]?\d{2,4}){2,3}(?![\d.,])/);
    if (phoneMatch) { phone = normalizePhone(phoneMatch[0]); line = line.replace(phoneMatch[0], " "); }
    const amountMatch = line.match(/(?:rp\.?\s*)?(\d+(?:[.,]\d+)*)\s*(k|rb|ribu|jt|juta)?\s*$/i);
    if (!amountMatch) { skipped.push(original.trim()); continue; }
    const amount = parseAmount(amountMatch[1], amountMatch[2] ?? "");
    const name = line.slice(0, amountMatch.index).replace(/[\s,;:=\-–]+$/, "").replace(/\s+/g, " ").trim();
    if (!name || !Number.isFinite(amount) || amount <= 0) { skipped.push(original.trim()); continue; }
    donors.push({ name, amount, phone, anonymous: /^hamba\s*al+a+h/i.test(name), line: original.trim() });
  }
  return { donors, skipped };
}

function fillTemplate(template: string, values: Record<string, string>) {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match).replace(/\n{3,}/g, "\n\n").trim();
}
function shiftPeriod(period: string, delta: number) {
  const [year, month] = period.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}
function initials(name: string) {
  return name.replace(/[^A-Za-z\s]/g, " ").split(/\s+/).filter(Boolean).map((word) => word[0]).slice(0, 2).join("").toUpperCase() || "?";
}
const displayName = (item: Supporter) => item.anonymous ? "Hamba Allah" : item.name;
const collectorLabel = (name: string) => name.trim() || "Belum ditentukan";

async function copyText(text: string, done: (message: string) => void, message: string) {
  try { await navigator.clipboard.writeText(text); done(message); }
  catch { window.prompt("Salin teks berikut:", text); }
}

export function DonorsPage({ donationSettings, cashAccounts, userId, saveTemplates }: {
  donationSettings: DonationSettings; cashAccounts: CashAccount[]; userId: string;
  saveTemplates: (templates: { reminder: string; pickup: string }) => Promise<void>;
}) {
  const thisPeriod = currentJakartaPeriod();
  const [supporters, setSupporters] = useState<Supporter[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]); // pembayaran satu tahun dari periode terpilih
  const [heldCash, setHeldCash] = useState<Payment[]>([]); // tunai di petugas, lintas periode
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [period, setPeriod] = useState(thisPeriod);
  const [tab, setTab] = useState<Tab>("bulanan");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("semua");
  const [formFor, setFormFor] = useState<Supporter | "new" | null>(null);
  const [payFor, setPayFor] = useState<Supporter | null>(null);
  const [depositFor, setDepositFor] = useState<{ collector: string; items: Payment[] } | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const year = period.slice(0, 4);

  useEffect(() => {
    let timer: number | undefined;
    async function fetchSupporters() {
      const { data, error: queryError } = await supabase.from("supporters").select("*").order("name");
      if (queryError) {
        setError(`Data donatur belum dapat dimuat: ${queryError.message}`);
        setLoaded(true); return;
      }
      setSupporters((data ?? []).map(mapSupporter)); setLoaded(true);
      // Kolom baru belum ada = file SQL modul ini belum dijalankan.
      if (data?.length && !("collector" in data[0])) setError("Database belum diperbarui. Jalankan supabase/donatur_tetap.sql di Supabase SQL Editor.");
    }
    void fetchSupporters();
    const channel = supabase.channel("supporters-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "supporters" }, () => {
        window.clearTimeout(timer); timer = window.setTimeout(() => void fetchSupporters(), 400);
      }).subscribe();
    return () => { window.clearTimeout(timer); void supabase.removeChannel(channel); };
  }, []);

  useEffect(() => {
    let timer: number | undefined;
    let active = true;
    async function fetchPayments() {
      const [yearResult, heldResult] = await Promise.all([
        supabase.from("supporter_payments").select("*").like("period", `${year}-%`),
        supabase.from("supporter_payments").select("*").eq("method", "Tunai").is("deposited_at", null).order("paid_at"),
      ]);
      if (!active) return;
      if (yearResult.error) { setError(`Data pembayaran belum dapat dimuat: ${yearResult.error.message}`); return; }
      setPayments((yearResult.data ?? []).map(mapPayment));
      if (!heldResult.error) setHeldCash((heldResult.data ?? []).map(mapPayment));
    }
    void fetchPayments();
    const channel = supabase.channel(`supporter-payments-${year}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "supporter_payments" }, () => {
        window.clearTimeout(timer); timer = window.setTimeout(() => void fetchPayments(), 400);
      }).subscribe();
    return () => { active = false; window.clearTimeout(timer); void supabase.removeChannel(channel); };
  }, [year]);

  const paidMap = useMemo(() => {
    const map = new Map<string, Payment>();
    for (const payment of payments) if (payment.period === period) map.set(payment.supporterId, payment);
    return map;
  }, [payments, period]);
  const byId = useMemo(() => new Map(supporters.map((item) => [item.id, item])), [supporters]);

  const active = supporters.filter((item) => item.status === "aktif");
  const pending = supporters.filter((item) => item.status === "baru");
  const commitment = active.reduce((sum, item) => sum + item.amount, 0);
  const collected = Array.from(paidMap.values()).reduce((sum, item) => sum + item.amount, 0);
  const unpaid = active.filter((item) => !paidMap.has(item.id));
  const unpaidTransfer = unpaid.filter((item) => item.method === "Transfer");
  const unpaidPickup = unpaid.filter((item) => item.method === "Diambil");
  const heldTotal = heldCash.reduce((sum, item) => sum + item.amount, 0);
  const collectors = Array.from(new Set(supporters.map((item) => item.collector.trim()).filter(Boolean))).sort();
  const todayDay = Number(jakartaToday().slice(8, 10));
  const isDue = (item: Supporter) => !paidMap.has(item.id) && (period < thisPeriod || (period === thisPeriod && todayDay >= item.reminderDay));

  const query = search.trim().toLowerCase();
  const listed = supporters.filter((item) => item.status !== "baru")
    .filter((item) => !query || item.name.toLowerCase().includes(query) || item.phone.includes(query)
      || item.address.toLowerCase().includes(query) || item.collector.toLowerCase().includes(query))
    .filter((item) => {
      if (filter === "nonaktif") return item.status === "nonaktif";
      if (item.status !== "aktif") return filter === "semua";
      if (filter === "belum") return !paidMap.has(item.id);
      if (filter === "lunas") return paidMap.has(item.id);
      if (filter === "jatuh-tempo") return isDue(item);
      if (filter === "transfer") return item.method === "Transfer";
      if (filter === "diambil") return item.method === "Diambil";
      if (filter === "tanpa-wa") return !item.phone;
      return true;
    })
    .sort((a, b) => (a.status === "aktif" ? 0 : 1) - (b.status === "aktif" ? 0 : 1)
      || Number(paidMap.has(a.id)) - Number(paidMap.has(b.id)) || a.name.localeCompare(b.name));

  // ----- Pesan WhatsApp -----
  function qrisLink(amount: number) { return `${window.location.origin}/?donasi=${amount}`; }
  function rekeningLine() {
    return donationSettings.accountNumber
      ? `Atau transfer ke ${donationSettings.bankName} ${donationSettings.accountNumber} a.n. ${donationSettings.accountHolder}`.replace(/\s+/g, " ")
      : "";
  }
  function reminderText(item: Supporter) {
    const pickup = item.method === "Diambil";
    const template = pickup ? donationSettings.pickupTemplate || DEFAULT_PICKUP_TEMPLATE : donationSettings.reminderTemplate || DEFAULT_REMINDER_TEMPLATE;
    return fillTemplate(template, {
      nama: item.anonymous ? "Bapak/Ibu" : item.name, bulan: monthId(period), nominal: money(item.amount),
      link: qrisLink(item.amount), rekening: rekeningLine(),
      petugas: item.collector.trim() ? `petugas kami, ${item.collector.trim()},` : "petugas kami",
    });
  }
  const reminderUrl = (item: Supporter) => waUrl(item.phone, reminderText(item)); // tanpa nomor: pilih kontak manual
  function receiptUrl(item: Supporter, payment: Payment) {
    const via = payment.method === "Tunai" ? `secara tunai${payment.collector ? ` melalui ${payment.collector}` : ""}` : `melalui ${payment.method}`;
    const text = `Assalamu'alaikum warahmatullahi wabarakatuh, ${item.anonymous ? "Bapak/Ibu" : item.name}.\n\nAlhamdulillah, infaq donatur tetap bulan *${monthId(payment.period)}* sebesar *${money(payment.amount)}* telah kami terima ${via} pada ${dateId(payment.paidAt)}.\n\nJazakumullahu khairan katsiran. Semoga Allah membalas dengan pahala berlipat, keberkahan harta, dan kebaikan untuk keluarga.\n\nWassalamu'alaikum warahmatullahi wabarakatuh.\nPengurus Masjid Baitul Fadli`;
    return waUrl(item.phone, text);
  }
  async function markReminded(item: Supporter) {
    setSupporters((current) => current.map((row) => row.id === item.id ? { ...row, lastRemindedAt: new Date().toISOString() } : row));
    await supabase.from("supporters").update({ last_reminded_at: new Date().toISOString() }).eq("id", item.id);
  }

  // ----- Data donatur -----
  async function saveSupporter(data: Omit<Supporter, "id" | "lastRemindedAt" | "createdAt">, existing?: Supporter) {
    const row = {
      name: data.name.trim(), phone: data.phone.trim(), address: data.address.trim(), amount: data.amount,
      frequency: data.frequency, status: data.status, reminder_day: data.reminderDay, method: data.method,
      collector: data.collector.trim(), pickup_note: data.pickupNote.trim(),
      notes: data.notes.trim(), anonymous: data.anonymous, start_period: data.startPeriod,
    };
    const { error: saveError } = existing
      ? await supabase.from("supporters").update({ ...row, updated_at: new Date().toISOString(), updated_by: userId }).eq("id", existing.id)
      : await supabase.from("supporters").insert(row);
    if (saveError) throw new Error(saveError.message);
    setFormFor(null);
  }
  async function removeSupporter(item: Supporter) {
    if (!confirm(`Hapus ${item.name} dari daftar donatur tetap?\nRiwayat ceklis pembayarannya ikut terhapus (catatan kas tetap ada).\n\nJika hanya berhenti sementara, pilih Edit lalu ubah status menjadi Nonaktif.`)) return;
    const { error: deleteError } = await supabase.from("supporters").delete().eq("id", item.id);
    if (deleteError) setError(deleteError.message);
  }
  async function approve(item: Supporter) {
    const { error: updateError } = await supabase.from("supporters").update({ status: "aktif", start_period: item.startPeriod || thisPeriod, updated_at: new Date().toISOString(), updated_by: userId }).eq("id", item.id);
    if (updateError) setError(updateError.message);
  }

  // ----- Pembayaran & setoran -----
  async function insertLedger(payment: { supporter: Supporter; amount: number; date: string; method: string; collector: string; note: string; kas: string; period: string }) {
    const { data: tx, error: txError } = await supabase.from("transactions").insert({
      title: `Donatur tetap - ${displayName(payment.supporter)} (${monthId(payment.period)})`,
      date: payment.date, amount: payment.amount, type: "Pemasukan", category: "Donatur Tetap",
      details: [payment.method === "Tunai" ? `Tunai${payment.collector ? ` via ${payment.collector}` : ""}` : payment.method, payment.note].filter(Boolean).join(" · "),
      kas: payment.kas, created_by: userId,
    }).select("id").single();
    if (txError) throw new Error(`Gagal mencatat ke kas: ${txError.message}`);
    return String(tx.id);
  }
  async function recordPayment(item: Supporter, data: PaymentInput) {
    const cash = data.method === "Tunai";
    let transactionId: string | null = null;
    // Transfer/QRIS: uang sudah di rekening masjid -> langsung masuk kas (opsional).
    // Tunai: masuk kas hanya jika sudah diserahkan ke bendahara; selain itu tercatat "di petugas".
    if (data.toLedger) {
      transactionId = await insertLedger({ supporter: item, amount: data.amount, date: data.paidAt, method: data.method, collector: data.collector, note: data.note, kas: data.kas, period });
    }
    const { error: payError } = await supabase.from("supporter_payments").insert({
      supporter_id: item.id, period, amount: data.amount, paid_at: data.paidAt, method: data.method,
      collector: cash ? data.collector.trim() : "", deposited_at: cash && data.toLedger ? new Date().toISOString() : null,
      note: data.note, transaction_id: transactionId, created_by: userId,
    });
    if (payError) {
      if (transactionId) await supabase.from("transactions").delete().eq("id", transactionId); // batalkan agar kas tidak dobel
      throw new Error(payError.code === "23505" ? "Pembayaran bulan ini sudah tercatat." : payError.message);
    }
    setPayFor(null);
    setNotice(cash && !data.toLedger
      ? `${item.name} lunas ${monthId(period)}. Uang ${money(data.amount)} tercatat di ${collectorLabel(data.collector)} sampai disetor ke bendahara.`
      : `Pembayaran ${item.name} untuk ${monthId(period)} tercatat${transactionId ? " dan masuk ke Laporan Kas" : ""}.`);
  }
  async function undoPayment(item: Supporter) {
    const payment = paidMap.get(item.id);
    if (!payment) return;
    if (!confirm(`Batalkan pembayaran ${item.name} bulan ${monthId(period)}?${payment.transactionId ? "\nCatatan pemasukan di Laporan Kas juga akan dihapus." : ""}`)) return;
    const { error: deleteError } = await supabase.from("supporter_payments").delete().eq("id", payment.id);
    if (deleteError) return setError(deleteError.message);
    if (payment.transactionId) await supabase.from("transactions").delete().eq("id", payment.transactionId);
  }
  async function receiveDeposit(items: Payment[], kas: string, date: string) {
    let done = 0;
    for (const payment of items) {
      const supporter = byId.get(payment.supporterId);
      if (!supporter) continue;
      const transactionId = await insertLedger({ supporter, amount: payment.amount, date, method: "Tunai", collector: payment.collector, note: payment.note, kas, period: payment.period });
      const { error: updateError } = await supabase.from("supporter_payments")
        .update({ deposited_at: new Date().toISOString(), transaction_id: transactionId }).eq("id", payment.id);
      if (updateError) {
        await supabase.from("transactions").delete().eq("id", transactionId);
        throw new Error(`Setoran ${supporter.name} gagal: ${updateError.message}${done ? ` (${done} lainnya sudah tercatat)` : ""}`);
      }
      done += 1;
    }
    setDepositFor(null);
    setNotice(`Setoran ${done} donatur (${money(items.reduce((sum, item) => sum + item.amount, 0))}) diterima dan masuk ke Laporan Kas.`);
  }

  async function importDonors(rows: ParsedDonor[], channel: Channel) {
    const { error: insertError } = await supabase.from("supporters").insert(rows.map((row) => ({
      name: row.name, amount: row.amount, phone: row.phone, anonymous: row.anonymous,
      frequency: "Bulanan", status: "aktif", start_period: thisPeriod, method: channel,
    })));
    if (insertError) throw new Error(insertError.message);
    setImportOpen(false);
    setNotice(`${rows.length} donatur berhasil ditambahkan.`);
  }

  function groupRecapText() {
    const lines = active.slice().sort((a, b) => a.name.localeCompare(b.name))
      .map((item, index) => `${index + 1}. ${displayName(item)} ${paidMap.has(item.id) ? "✅" : ""}`.trim());
    return `*Rekap Donatur Tetap Masjid Baitul Fadli*\n*${monthId(period)}*\n\n${lines.join("\n")}\n\nSudah menunaikan: ${active.length - unpaid.length} dari ${active.length} donatur\nTerkumpul: ${money(collected)}\n\nJazakumullahu khairan atas dukungan Bapak/Ibu sekalian.`;
  }

  if (!loaded) return <p className="empty">Memuat data donatur...</p>;

  return <div className="stack donors-page">
    <Intro eyebrow="DONATUR TETAP" title="Donatur Tetap Masjid" description="Dua jalur pengumpulan: transfer/QRIS mandiri dan diambil petugas ke rumah. Tunai baru masuk kas setelah disetor ke bendahara.">
      <div className="donor-intro-actions">
        <Button variant="outline" onClick={() => setImportOpen(true)}><FileUp />Impor Daftar</Button>
        <Button className="primary" onClick={() => setFormFor("new")}><Plus />Tambah Donatur</Button>
      </div>
    </Intro>
    {error && <p className="data-alert">{error}</p>}
    {notice && <p className="donor-notice" role="status"><CheckCircle2 />{notice}<button onClick={() => setNotice("")} aria-label="Tutup"><X /></button></p>}

    <div className="period-switch">
      <button onClick={() => setPeriod(shiftPeriod(period, -1))} aria-label="Bulan sebelumnya">‹</button>
      <label><span>Periode</span><input type="month" value={period} onChange={(event) => event.target.value && setPeriod(event.target.value)} /></label>
      <button onClick={() => setPeriod(shiftPeriod(period, 1))} aria-label="Bulan berikutnya">›</button>
      {period !== thisPeriod && <button className="period-today" onClick={() => setPeriod(thisPeriod)}>Bulan ini</button>}
    </div>

    <div className="stats">
      <Stat label="Komitmen / Bulan" value={money(commitment)} note={`${active.length} donatur aktif${pending.length ? ` · ${pending.length} pendaftar baru` : ""}`} icon={<HandCoins />} color="blue" />
      <Stat label={`Terkumpul ${MONTHS_SHORT[Number(period.slice(5, 7)) - 1]}`} value={money(collected)} note={commitment ? `${Math.round((collected / commitment) * 100)}% dari komitmen` : "Belum ada komitmen"} icon={<Wallet />} color="green" />
      <Stat label="Belum Menunaikan" value={String(unpaid.length)} note={`${unpaidTransfer.length} transfer · ${unpaidPickup.length} diambil`} icon={<BellRing />} color="gold" />
      <Stat label="Tunai di Petugas" value={money(heldTotal)} note={heldCash.length ? `${heldCash.length} pembayaran belum disetor` : "Semua sudah disetor"} icon={<Bike />} color="navy" />
    </div>

    {pending.length > 0 && <Panel title="Pendaftar Baru dari Website" action={`${pending.length} menunggu konfirmasi`}>
      <div className="donor-list">{pending.map((item) => <article key={item.id} className="donor-row">
        <span className="donor-avatar">{initials(item.name)}</span>
        <div className="donor-main"><strong>{item.name}</strong><small>{money(item.amount)} · {item.frequency} · {item.phone || "tanpa WA"}{item.address && ` · ${item.address}`}</small></div>
        <div className="donor-actions">
          <Button className="primary" onClick={() => setFormFor(item)}><UserCheck />Tinjau & Terima</Button>
          <button className="icon-btn" onClick={() => void approve(item)} aria-label="Terima langsung" title="Terima langsung"><CheckCircle2 /></button>
          <button className="icon-btn" onClick={() => void removeSupporter(item)} aria-label="Tolak / hapus"><Trash2 /></button>
        </div>
      </article>)}</div>
    </Panel>}

    <div className="donor-tabs" role="tablist">
      <button role="tab" aria-selected={tab === "bulanan"} className={tab === "bulanan" ? "active" : ""} onClick={() => setTab("bulanan")}>Ceklis {MONTHS_SHORT[Number(period.slice(5, 7)) - 1]}</button>
      <button role="tab" aria-selected={tab === "jemput"} className={tab === "jemput" ? "active" : ""} onClick={() => setTab("jemput")}>Jemput & Setoran{heldCash.length ? ` (${heldCash.length})` : ""}</button>
      <button role="tab" aria-selected={tab === "tahunan"} className={tab === "tahunan" ? "active" : ""} onClick={() => setTab("tahunan")}>Rekap {year}</button>
    </div>

    {tab === "bulanan" && <>
      <div className="finance-toolbar donor-toolbar">
        <label className="field search-field"><Search />Cari donatur<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nama, nomor, alamat, petugas..." /></label>
        <label className="field">Tampilkan<select value={filter} onChange={(event) => setFilter(event.target.value as Filter)}>
          <option value="semua">Semua donatur</option>
          <option value="belum">Belum menunaikan</option>
          <option value="jatuh-tempo">Sudah jatuh tempo</option>
          <option value="lunas">Sudah menunaikan</option>
          <option value="transfer">Jalur transfer / QRIS</option>
          <option value="diambil">Jalur diambil ke rumah</option>
          <option value="tanpa-wa">Belum ada nomor WA</option>
          <option value="nonaktif">Nonaktif</option>
        </select></label>
        <div className="donor-bulk">
          <Button className="primary" disabled={!unpaid.length} onClick={() => setQueueOpen(true)}><BellRing />Kirim Pengingat ({unpaid.length})</Button>
          <Button variant="outline" onClick={() => void copyText(groupRecapText(), setNotice, "Rekap disalin. Tempel di grup WhatsApp donatur.")}><ClipboardCopy />Salin Rekap Grup</Button>
          <button className="text-link" onClick={() => setTemplateOpen(true)}>Ubah pesan pengingat</button>
        </div>
      </div>
      <Panel title="Daftar Donatur" action={`${listed.length} dari ${supporters.length - pending.length} donatur`}>
        <div className="donor-list">{listed.map((item) => {
          const payment = paidMap.get(item.id);
          const due = item.status === "aktif" && isDue(item);
          return <article key={item.id} className={`donor-row${item.status !== "aktif" ? " inactive" : ""}`}>
            <span className={`donor-avatar${payment ? " paid" : ""}`}>{payment ? <CheckCircle2 /> : initials(item.name)}</span>
            <div className="donor-main">
              <strong>{item.name}{item.anonymous && <em className="donor-tag">anonim</em>}<em className={`donor-tag channel-${item.method.toLowerCase()}`}>{item.method === "Diambil" ? <><Bike />Diambil{item.collector && ` · ${item.collector}`}</> : "Transfer/QRIS"}</em></strong>
              <small>{money(item.amount)} / {item.frequency.toLowerCase()} · {item.phone ? item.phone : <span className="warn">belum ada nomor WA</span>} · tgl {item.reminderDay}{item.method === "Diambil" && !item.address && <> · <span className="warn">alamat belum diisi</span></>}</small>
              <span className={`donor-badge ${item.status !== "aktif" ? "off" : payment ? (isHeldCash(payment) ? "held" : "paid") : due ? "due" : "wait"}`}>
                {item.status !== "aktif" ? "Nonaktif"
                  : payment ? `Lunas ${payment.paidAt.slice(8, 10)}/${payment.paidAt.slice(5, 7)} · ${payment.method}${payment.amount !== item.amount ? ` · ${money(payment.amount)}` : ""}${isHeldCash(payment) ? ` · di ${collectorLabel(payment.collector)}, belum disetor` : ""}`
                  : due ? "Jatuh tempo" : `Tempo tgl ${item.reminderDay}`}
              </span>
              {!payment && item.lastRemindedAt && <small className="donor-reminded">Diingatkan {new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" }).format(new Date(item.lastRemindedAt))}</small>}
            </div>
            <div className="donor-actions">
              {item.status === "aktif" && (payment
                ? <>
                  <a className="icon-btn wa-icon" href={receiptUrl(item, payment)} target="_blank" rel="noopener noreferrer" title="Kirim tanda terima ke donatur" aria-label="Kirim tanda terima"><Receipt /></a>
                  <button className="icon-btn" onClick={() => void undoPayment(item)} aria-label="Batalkan pembayaran" title="Batalkan pembayaran"><Undo2 /></button>
                </>
                : <>
                  <a className="wa-btn" href={reminderUrl(item)} target="_blank" rel="noopener noreferrer" onClick={() => void markReminded(item)} title={item.phone ? "Kirim pesan WhatsApp" : "Nomor belum ada — pilih kontak di WhatsApp"}><MessageCircle /><span>{item.method === "Diambil" ? "Kabari" : "Ingatkan"}</span></a>
                  <Button className="primary" onClick={() => setPayFor(item)}><CheckCircle2 />{item.method === "Diambil" ? "Sudah Diambil" : "Sudah Bayar"}</Button>
                </>)}
              <button className="icon-btn" onClick={() => setFormFor(item)} aria-label="Edit donatur"><Pencil /></button>
              <button className="icon-btn" onClick={() => void removeSupporter(item)} aria-label="Hapus donatur"><Trash2 /></button>
            </div>
          </article>;
        })}{!listed.length && <p className="empty">{supporters.length ? "Tidak ada donatur yang cocok dengan filter." : "Belum ada donatur. Gunakan Impor Daftar untuk menempelkan daftar dari WhatsApp."}</p>}</div>
      </Panel>
    </>}

    {tab === "jemput" && <PickupTab
      period={period} unpaidPickup={unpaidPickup} heldCash={heldCash} byId={byId}
      reminderUrl={reminderUrl} markReminded={markReminded}
      collect={(item) => setPayFor(item)} edit={(item) => setFormFor(item)}
      deposit={(collector, items) => setDepositFor({ collector, items })}
      copy={(text, message) => void copyText(text, setNotice, message)}
    />}

    {tab === "tahunan" && <YearRecap supporters={supporters} payments={payments} year={year} />}

    {formFor && <DonorForm editing={formFor === "new" ? null : formFor} collectors={collectors} close={() => setFormFor(null)} save={saveSupporter} defaultPeriod={thisPeriod} />}
    {payFor && <PaymentForm supporter={payFor} period={period} cashAccounts={cashAccounts} collectors={collectors} close={() => setPayFor(null)} save={(data) => recordPayment(payFor, data)} />}
    {depositFor && <DepositForm collector={depositFor.collector} items={depositFor.items} byId={byId} cashAccounts={cashAccounts} close={() => setDepositFor(null)} save={(kas, date) => receiveDeposit(depositFor.items, kas, date)} />}
    {importOpen && <ImportForm existing={supporters} close={() => setImportOpen(false)} save={importDonors} />}
    {queueOpen && <ReminderQueue items={unpaid} period={period} urlFor={reminderUrl} markReminded={markReminded} close={() => setQueueOpen(false)} />}
    {templateOpen && <TemplateForm
      templates={{ reminder: donationSettings.reminderTemplate || DEFAULT_REMINDER_TEMPLATE, pickup: donationSettings.pickupTemplate || DEFAULT_PICKUP_TEMPLATE }}
      preview={(template) => fillTemplate(template, { nama: "Mario", bulan: monthId(period), nominal: money(300000), link: qrisLink(300000), rekening: rekeningLine(), petugas: "petugas kami, Pak Agus," })}
      close={() => setTemplateOpen(false)}
      save={async (templates) => {
        await saveTemplates({
          reminder: templates.reminder === DEFAULT_REMINDER_TEMPLATE ? "" : templates.reminder,
          pickup: templates.pickup === DEFAULT_PICKUP_TEMPLATE ? "" : templates.pickup,
        });
        setTemplateOpen(false); setNotice("Pesan pengingat disimpan.");
      }} />}
  </div>;
}

function PickupTab({ period, unpaidPickup, heldCash, byId, reminderUrl, markReminded, collect, edit, deposit, copy }: {
  period: string; unpaidPickup: Supporter[]; heldCash: Payment[]; byId: Map<string, Supporter>;
  reminderUrl: (item: Supporter) => string; markReminded: (item: Supporter) => Promise<void>;
  collect: (item: Supporter) => void; edit: (item: Supporter) => void;
  deposit: (collector: string, items: Payment[]) => void; copy: (text: string, message: string) => void;
}) {
  const routeGroups = groupBy(unpaidPickup, (item) => collectorLabel(item.collector));
  const heldGroups = groupBy(heldCash, (item) => collectorLabel(item.collector));

  function routeText(collector: string, items: Supporter[]) {
    const lines = items.map((item, index) => [
      `${index + 1}. *${item.name}* – ${money(item.amount)}`,
      item.address ? `   📍 ${item.address}` : "   📍 (alamat belum diisi)",
      item.pickupNote ? `   📝 ${item.pickupNote}` : "",
      item.phone ? `   📱 wa.me/${normalizePhone(item.phone)}` : "",
      item.address ? `   🗺️ ${mapsUrl(item.address)}` : "",
    ].filter(Boolean).join("\n"));
    const total = items.reduce((sum, item) => sum + item.amount, 0);
    return `*Daftar Jemput Infaq Donatur Tetap*\n*Masjid Baitul Fadli – ${monthId(period)}*\nPetugas: ${collector}\n\n${lines.join("\n\n")}\n\nTotal: ${items.length} donatur · ${money(total)}\n\nMohon setorkan ke bendahara di hari yang sama dan laporkan di grup pengurus. Jazakumullahu khairan.`;
  }

  return <>
    <Panel title={`Daftar Jemput ${monthId(period)}`} action={`${unpaidPickup.length} donatur · ${money(unpaidPickup.reduce((sum, item) => sum + item.amount, 0))}`}>
      {routeGroups.length ? routeGroups.map(([collector, items]) => <div className="pickup-group" key={collector}>
        <div className="pickup-group-head">
          <div><strong><Bike />{collector}</strong><small>{items.length} rumah · {money(items.reduce((sum, item) => sum + item.amount, 0))}</small></div>
          <div className="donor-actions">
            <a className="wa-btn" href={waUrl("", routeText(collector, items))} target="_blank" rel="noopener noreferrer"><MessageCircle /><span>Kirim ke Petugas</span></a>
            <button className="icon-btn" onClick={() => copy(routeText(collector, items), `Daftar jemput ${collector} disalin.`)} aria-label="Salin daftar" title="Salin daftar"><ClipboardCopy /></button>
          </div>
        </div>
        <div className="donor-list">{items.map((item) => <article key={item.id} className="donor-row">
          <span className="donor-avatar">{initials(item.name)}</span>
          <div className="donor-main">
            <strong>{item.name}</strong>
            <small>{money(item.amount)} · {item.address || <span className="warn">alamat belum diisi</span>}</small>
            {item.pickupNote && <small className="pickup-note">📝 {item.pickupNote}</small>}
          </div>
          <div className="donor-actions">
            {item.address && <a className="icon-btn" href={mapsUrl(item.address)} target="_blank" rel="noopener noreferrer" aria-label="Buka peta" title="Buka di Google Maps"><MapPin /></a>}
            <a className="icon-btn wa-icon" href={reminderUrl(item)} target="_blank" rel="noopener noreferrer" onClick={() => void markReminded(item)} aria-label="Kabari donatur" title="Kabari jadwal pengambilan"><MessageCircle /></a>
            <Button className="primary" onClick={() => collect(item)}><CheckCircle2 />Sudah Diambil</Button>
            {!item.address && <button className="icon-btn" onClick={() => edit(item)} aria-label="Lengkapi alamat"><Pencil /></button>}
          </div>
        </article>)}</div>
      </div>) : <p className="empty">Semua donatur jalur jemput sudah menunaikan untuk {monthId(period)}. Alhamdulillah.</p>}
    </Panel>

    <Panel title="Tunai di Petugas (Belum Disetor)" action={heldCash.length ? money(heldCash.reduce((sum, item) => sum + item.amount, 0)) : "Nihil"}>
      <p className="modal-hint">Uang tunai baru tercatat di Laporan Kas setelah bendahara menerima setoran. Daftar ini menjaga amanah: setiap rupiah yang sudah diambil terlihat sampai benar-benar diserahkan.</p>
      {heldGroups.length ? heldGroups.map(([collector, items]) => {
        const oldest = items.reduce((min, item) => item.paidAt < min ? item.paidAt : min, items[0].paidAt);
        const days = Math.floor((Date.parse(`${jakartaToday()}T00:00:00Z`) - Date.parse(`${oldest}T00:00:00Z`)) / 86_400_000);
        return <div className="pickup-group" key={collector}>
          <div className="pickup-group-head">
            <div><strong><Wallet />{collector}</strong><small>{items.length} pembayaran · {money(items.reduce((sum, item) => sum + item.amount, 0))}{days >= 3 && <span className="warn"> · tertahan {days} hari</span>}</small></div>
            <Button className="primary" onClick={() => deposit(collector, items)}><HandCoins />Terima Setoran</Button>
          </div>
          <ul className="held-list">{items.map((item) => <li key={item.id}><span>{byId.get(item.supporterId)?.name ?? "Donatur terhapus"}</span><span>{monthId(item.period)} · diambil {dateId(item.paidAt)}</span><b>{money(item.amount)}</b></li>)}</ul>
        </div>;
      }) : <p className="empty">Tidak ada uang tunai yang tertahan di petugas.</p>}
    </Panel>
  </>;
}

function groupBy<T>(items: T[], key: (item: T) => string): Array<[string, T[]]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const name = key(item);
    if (!map.has(name)) map.set(name, []);
    map.get(name)!.push(item);
  }
  const unassigned = collectorLabel("");
  return Array.from(map.entries()).sort(([a], [b]) => Number(a === unassigned) - Number(b === unassigned) || a.localeCompare(b));
}

function YearRecap({ supporters, payments, year }: { supporters: Supporter[]; payments: Payment[]; year: string }) {
  const byDonor = new Map<string, Map<number, Payment>>();
  for (const payment of payments) {
    const month = Number(payment.period.slice(5, 7)) - 1;
    if (!byDonor.has(payment.supporterId)) byDonor.set(payment.supporterId, new Map());
    byDonor.get(payment.supporterId)!.set(month, payment);
  }
  const rows = supporters.filter((item) => item.status === "aktif" || byDonor.has(item.id)).sort((a, b) => a.name.localeCompare(b.name));
  const monthTotals = MONTHS_SHORT.map((_, month) => payments.filter((payment) => Number(payment.period.slice(5, 7)) - 1 === month).reduce((sum, payment) => sum + payment.amount, 0));
  const grand = monthTotals.reduce((sum, value) => sum + value, 0);
  const compact = (value: number) => value >= 1_000_000 ? `${(value / 1_000_000).toLocaleString("id-ID", { maximumFractionDigits: 1 })}jt` : value ? `${Math.round(value / 1000)}rb` : "";
  return <Panel title={`Rekap Pembayaran ${year}`} action={`Total ${money(grand)}`}>
    <div className="recap-scroll"><table className="recap-table">
      <thead><tr><th>Donatur</th>{MONTHS_SHORT.map((month) => <th key={month}>{month}</th>)}<th>Total</th></tr></thead>
      <tbody>{rows.map((item) => {
        const months = byDonor.get(item.id);
        const total = months ? Array.from(months.values()).reduce((sum, payment) => sum + payment.amount, 0) : 0;
        return <tr key={item.id}><th>{item.name}<small>{money(item.amount)} · {item.method === "Diambil" ? "diambil" : "transfer"}</small></th>{MONTHS_SHORT.map((month, index) => {
          const payment = months?.get(index);
          return <td key={month} className={payment ? (isHeldCash(payment) ? "held" : "paid") : ""} title={payment ? `${money(payment.amount)} · ${payment.paidAt} · ${payment.method}${isHeldCash(payment) ? " · belum disetor" : ""}` : undefined}>{payment ? "✓" : ""}</td>;
        })}<td className="total">{compact(total)}</td></tr>;
      })}</tbody>
      <tfoot><tr><th>Total</th>{monthTotals.map((value, index) => <td key={index}>{compact(value)}</td>)}<td className="total">{compact(grand)}</td></tr></tfoot>
    </table></div>
    {!rows.length && <p className="empty">Belum ada data.</p>}
  </Panel>;
}

function Modal({ close, children, wide }: { close: () => void; children: React.ReactNode; wide?: boolean }) {
  return <div className="modal-wrap"><button className="backdrop" onClick={close} aria-label="Tutup" /><section className={`modal entry-form${wide ? " modal-wide" : ""}`}><button type="button" className="modal-x" onClick={close} aria-label="Tutup"><X /></button>{children}</section></div>;
}

function ChannelPicker({ value, onChange }: { value: Channel; onChange: (value: Channel) => void }) {
  return <div className="channel-picker" role="radiogroup" aria-label="Cara pengumpulan">
    {(["Transfer", "Diambil"] as const).map((option) => <button type="button" role="radio" aria-checked={value === option} key={option} className={value === option ? "active" : ""} onClick={() => onChange(option)}>
      {option === "Transfer" ? <Wallet /> : <Bike />}<strong>{CHANNEL_LABEL[option]}</strong>
      <small>{option === "Transfer" ? "Donatur bayar sendiri via m-banking / QRIS" : "Petugas mengambil tunai ke rumah"}</small>
    </button>)}
  </div>;
}

function DonorForm({ editing, collectors, close, save, defaultPeriod }: {
  editing: Supporter | null; collectors: string[]; close: () => void; defaultPeriod: string;
  save: (data: Omit<Supporter, "id" | "lastRemindedAt" | "createdAt">, existing?: Supporter) => Promise<void>;
}) {
  const [name, setName] = useState(editing?.name ?? ""); const [phone, setPhone] = useState(editing?.phone ?? "");
  const [address, setAddress] = useState(editing?.address ?? ""); const [amount, setAmount] = useState(editing?.amount ?? 100000);
  const [frequency, setFrequency] = useState(editing?.frequency ?? "Bulanan");
  const [status, setStatus] = useState(editing?.status === "baru" ? "aktif" : editing?.status ?? "aktif");
  const [reminderDay, setReminderDay] = useState(editing?.reminderDay ?? 1);
  const [method, setMethod] = useState<Channel>(editing?.method ?? "Transfer");
  const [collector, setCollector] = useState(editing?.collector ?? ""); const [pickupNote, setPickupNote] = useState(editing?.pickupNote ?? "");
  const [notes, setNotes] = useState(editing?.notes ?? ""); const [anonymous, setAnonymous] = useState(editing?.anonymous ?? false);
  const [startPeriod, setStartPeriod] = useState(editing?.startPeriod || defaultPeriod);
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const pickup = method === "Diambil";
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return setError("Nama wajib diisi.");
    if (amount <= 0) return setError("Nominal komitmen wajib diisi.");
    if (phone && normalizePhone(phone).length < 10) return setError("Nomor WhatsApp tidak valid. Contoh: 081234567890");
    if (pickup && !address.trim()) return setError("Alamat wajib diisi untuk donatur yang diambil ke rumah.");
    setBusy(true); setError("");
    try { await save({ name, phone, address, amount, frequency, status, reminderDay, method, collector: pickup ? collector : "", pickupNote: pickup ? pickupNote : "", notes, anonymous, startPeriod }, editing ?? undefined); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Gagal menyimpan."); }
    finally { setBusy(false); }
  }
  return <Modal close={close}><form onSubmit={submit}>
    <p className="eyebrow">DONATUR TETAP</p><h2>{editing ? (editing.status === "baru" ? "Tinjau Pendaftar" : "Edit Donatur") : "Tambah Donatur"}</h2>
    <label className="field">Nama (sesuai sapaan)<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Contoh: Pak Khusnul" required /></label>
    <label className="field">Nomor WhatsApp<input value={phone} onChange={(event) => setPhone(event.target.value)} inputMode="tel" placeholder="081234567890" /></label>
    <NumberField label="Komitmen per bulan (Rp)" value={amount} setValue={setAmount} />
    <div className="field channel-field"><span>Cara pengumpulan</span><ChannelPicker value={method} onChange={setMethod} /></div>
    <label className="field">Alamat rumah{pickup ? " (wajib)" : " / RT"}<input value={address} onChange={(event) => setAddress(event.target.value)} placeholder="Jl. ..., RT/RW, Gunung Anyar" required={pickup} /></label>
    {pickup && <>
      <label className="field">Petugas pengambil<input value={collector} onChange={(event) => setCollector(event.target.value)} list="collector-options" placeholder="Nama pengurus yang menjemput" /></label>
      <datalist id="collector-options">{collectors.map((option) => <option key={option} value={option} />)}</datalist>
      <label className="field">Patokan / waktu yang pas<input value={pickupNote} onChange={(event) => setPickupNote(event.target.value)} placeholder="Mis. pagar hijau, ambil setelah Maghrib" /></label>
    </>}
    <div className="field-row">
      <label className="field">{pickup ? "Tanggal penjemputan" : "Tanggal pengingat"}<select value={reminderDay} onChange={(event) => setReminderDay(Number(event.target.value))}>{Array.from({ length: 28 }, (_, index) => index + 1).map((day) => <option key={day} value={day}>Tanggal {day}</option>)}</select></label>
      <label className="field">Status<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="aktif">Aktif</option><option value="nonaktif">Nonaktif</option></select></label>
    </div>
    <div className="field-row">
      <label className="field">Frekuensi<select value={frequency} onChange={(event) => setFrequency(event.target.value)}><option>Bulanan</option><option>Mingguan</option></select></label>
      <label className="field">Mulai berdonasi<input type="month" value={startPeriod} onChange={(event) => setStartPeriod(event.target.value)} /></label>
    </div>
    <label className="field">Catatan internal<textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Catatan untuk pengurus" /></label>
    <label className="check-field"><input type="checkbox" checked={anonymous} onChange={(event) => setAnonymous(event.target.checked)} />Tampilkan sebagai &ldquo;Hamba Allah&rdquo; di rekap grup & kas</label>
    {error && <p className="form-error">{error}</p>}
    <Button className="primary" disabled={busy}>{busy ? "Menyimpan..." : editing?.status === "baru" ? "Simpan & Terima" : editing ? "Simpan Perubahan" : "Simpan Donatur"}</Button>
  </form></Modal>;
}

function PaymentForm({ supporter, period, cashAccounts, collectors, close, save }: {
  supporter: Supporter; period: string; cashAccounts: CashAccount[]; collectors: string[]; close: () => void;
  save: (data: PaymentInput) => Promise<void>;
}) {
  const [amount, setAmount] = useState(supporter.amount); const [paidAt, setPaidAt] = useState(jakartaToday());
  const [method, setMethod] = useState(supporter.method === "Diambil" ? "Tunai" : "QRIS"); const [note, setNote] = useState("");
  const [collector, setCollector] = useState(supporter.collector);
  const kasOptions = cashAccounts.map((item) => item.name);
  const [kas, setKas] = useState(kasOptions[0] ?? "");
  const [transferToLedger, setTransferToLedger] = useState(true);
  const [handedOver, setHandedOver] = useState(false); // tunai langsung diserahkan ke bendahara
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const cash = method === "Tunai";
  const toLedger = cash ? handedOver : transferToLedger;
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (amount <= 0) return setError("Nominal wajib diisi.");
    if (!paidAt) return setError("Tanggal wajib diisi.");
    if (cash && !collector.trim()) return setError("Isi nama petugas yang menerima uang tunai.");
    if (toLedger && kasOptions.length && !kas) return setError("Pilih akun kas.");
    setBusy(true); setError("");
    try { await save({ amount, paidAt, method, collector, note, kas, toLedger }); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Gagal menyimpan."); }
    finally { setBusy(false); }
  }
  return <Modal close={close}><form onSubmit={submit}>
    <p className="eyebrow">CATAT PEMBAYARAN · {monthId(period).toUpperCase()}</p><h2>{supporter.name}</h2>
    <NumberField label="Nominal diterima (Rp)" value={amount} setValue={setAmount} />
    <div className="field-row">
      <label className="field">{cash ? "Tanggal diambil" : "Tanggal bayar"}<input type="date" value={paidAt} onChange={(event) => setPaidAt(event.target.value)} /></label>
      <label className="field">Cara bayar<select value={method} onChange={(event) => setMethod(event.target.value)}>{PAY_METHODS.map((option) => <option key={option} value={option}>{option === "Tunai" ? "Tunai (diambil)" : option}</option>)}</select></label>
    </div>
    {cash && <>
      <label className="field">Diterima oleh petugas<input value={collector} onChange={(event) => setCollector(event.target.value)} list="collector-options-pay" placeholder="Nama petugas" /></label>
      <datalist id="collector-options-pay">{collectors.map((option) => <option key={option} value={option} />)}</datalist>
    </>}
    <label className="field">Catatan (opsional)<input value={note} onChange={(event) => setNote(event.target.value)} placeholder={cash ? "Mis. dititipkan ke istri" : "Mis. bukti transfer di grup"} /></label>
    {cash
      ? <label className="check-field"><input type="checkbox" checked={handedOver} onChange={(event) => setHandedOver(event.target.checked)} />Uang sudah diserahkan ke bendahara sekarang (langsung masuk Laporan Kas). Jika belum, tercatat sebagai &ldquo;tunai di petugas&rdquo;.</label>
      : <label className="check-field"><input type="checkbox" checked={transferToLedger} onChange={(event) => setTransferToLedger(event.target.checked)} />Catat juga sebagai pemasukan di Laporan Kas (kategori Donatur Tetap)</label>}
    {toLedger && kasOptions.length > 0 && <label className="field">Masuk ke kas<select value={kas} onChange={(event) => setKas(event.target.value)}>{kasOptions.map((option) => <option key={option}>{option}</option>)}</select></label>}
    {error && <p className="form-error">{error}</p>}
    <Button className="primary" disabled={busy}>{busy ? "Menyimpan..." : `Simpan · ${money(amount)}`}</Button>
  </form></Modal>;
}

function DepositForm({ collector, items, byId, cashAccounts, close, save }: {
  collector: string; items: Payment[]; byId: Map<string, Supporter>; cashAccounts: CashAccount[]; close: () => void;
  save: (kas: string, date: string) => Promise<void>;
}) {
  const kasOptions = cashAccounts.map((item) => item.name);
  const [kas, setKas] = useState(kasOptions[0] ?? ""); const [date, setDate] = useState(jakartaToday());
  const [counted, setCounted] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const total = items.reduce((sum, item) => sum + item.amount, 0);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!counted) return setError("Hitung uang fisik dan centang konfirmasi terlebih dahulu.");
    if (kasOptions.length && !kas) return setError("Pilih akun kas.");
    setBusy(true); setError("");
    try { await save(kas, date); } catch (caught) { setError(caught instanceof Error ? caught.message : "Gagal menyimpan."); } finally { setBusy(false); }
  }
  return <Modal close={close}><form onSubmit={submit}>
    <p className="eyebrow">TERIMA SETORAN TUNAI</p><h2>{collector}</h2>
    <ul className="held-list">{items.map((item) => <li key={item.id}><span>{byId.get(item.supporterId)?.name ?? "Donatur terhapus"}</span><span>{monthId(item.period)}</span><b>{money(item.amount)}</b></li>)}</ul>
    <p className="deposit-total">Total yang harus diterima <strong>{money(total)}</strong></p>
    <div className="field-row">
      <label className="field">Tanggal setor<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
      {kasOptions.length > 0 && <label className="field">Masuk ke kas<select value={kas} onChange={(event) => setKas(event.target.value)}>{kasOptions.map((option) => <option key={option}>{option}</option>)}</select></label>}
    </div>
    <label className="check-field"><input type="checkbox" checked={counted} onChange={(event) => setCounted(event.target.checked)} />Saya sudah menghitung uang fisik dan jumlahnya sesuai {money(total)}.</label>
    {error && <p className="form-error">{error}</p>}
    <Button className="primary" disabled={busy}>{busy ? "Menyimpan..." : `Terima Setoran · ${money(total)}`}</Button>
  </form></Modal>;
}

function ImportForm({ existing, close, save }: { existing: Supporter[]; close: () => void; save: (rows: ParsedDonor[], channel: Channel) => Promise<void> }) {
  const [text, setText] = useState(""); const [channel, setChannel] = useState<Channel>("Transfer");
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const existingNames = new Set(existing.map((item) => item.name.trim().toLowerCase()));
  const { donors, skipped } = parseDonorList(text);
  const fresh = donors.filter((row, index) => !existingNames.has(row.name.toLowerCase()) && donors.findIndex((other) => other.name.toLowerCase() === row.name.toLowerCase()) === index);
  const duplicates = donors.length - fresh.length;
  async function submit() {
    if (!fresh.length) return setError("Tidak ada donatur baru untuk ditambahkan.");
    setBusy(true); setError("");
    try { await save(fresh, channel); } catch (caught) { setError(caught instanceof Error ? caught.message : "Gagal mengimpor."); } finally { setBusy(false); }
  }
  return <Modal close={close} wide>
    <p className="eyebrow">IMPOR DONATUR</p><h2>Tempel Daftar dari WhatsApp</h2>
    <p className="modal-hint">Satu donatur per baris. Format bebas, misalnya <code>1. Dito 100k</code>, <code>Andi Witim, 100 K</code>, <code>Agus 081234567890 150rb</code>. Nama yang sudah ada otomatis dilewati.</p>
    <label className="field">Daftar donatur<textarea value={text} onChange={(event) => setText(event.target.value)} rows={8} placeholder={"Daftar penyumbang tetap MBF :\n1. Dito 100k\n2. Mario 300k"} /></label>
    <div className="field channel-field"><span>Cara pengumpulan untuk semua nama di atas (bisa diubah per donatur nanti)</span><ChannelPicker value={channel} onChange={setChannel} /></div>
    {donors.length > 0 && <div className="import-preview">
      <strong>{fresh.length} donatur baru · {money(fresh.reduce((sum, row) => sum + row.amount, 0))}/bulan</strong>
      {duplicates > 0 && <small>{duplicates} nama sudah terdaftar/dobel, dilewati.</small>}
      <ul>{fresh.map((row) => <li key={row.line}><span>{row.name}{row.anonymous && " (anonim)"}</span><span>{row.phone || "—"}</span><b>{money(row.amount)}</b></li>)}</ul>
    </div>}
    {skipped.length > 0 && <p className="form-error">Baris tidak terbaca (tanpa nominal): {skipped.join(" · ")}</p>}
    {error && <p className="form-error">{error}</p>}
    <Button className="primary" disabled={busy || !fresh.length} onClick={() => void submit()}>{busy ? "Menyimpan..." : `Tambahkan ${fresh.length} Donatur`}</Button>
  </Modal>;
}

function ReminderQueue({ items, period, urlFor, markReminded, close }: {
  items: Supporter[]; period: string; urlFor: (item: Supporter) => string; markReminded: (item: Supporter) => Promise<void>; close: () => void;
}) {
  const [sent, setSent] = useState<Set<string>>(() => new Set());
  const sorted = items.slice().sort((a, b) => a.method.localeCompare(b.method) || Number(!a.phone) - Number(!b.phone) || a.name.localeCompare(b.name));
  return <Modal close={close} wide>
    <p className="eyebrow">PENGINGAT · {monthId(period).toUpperCase()}</p><h2>Kirim Pesan ke {items.length} Donatur</h2>
    <p className="modal-hint">Tekan <b>Kirim</b> satu per satu. Donatur jalur transfer menerima link QRIS dengan nominal terisi; donatur jalur jemput menerima kabar kunjungan petugas. Dikirim satu per satu agar nomor masjid tidak dianggap spam.</p>
    <p className="queue-progress">{sent.size} dari {items.length} sudah dibuka</p>
    <div className="donor-list queue-list">{sorted.map((item) => <article key={item.id} className={`donor-row${sent.has(item.id) ? " sent" : ""}`}>
      <span className="donor-avatar">{sent.has(item.id) ? <CheckCircle2 /> : initials(item.name)}</span>
      <div className="donor-main"><strong>{item.name}<em className={`donor-tag channel-${item.method.toLowerCase()}`}>{item.method === "Diambil" ? "Diambil" : "Transfer"}</em></strong><small>{money(item.amount)} · {item.phone || <span className="warn">pilih kontak manual</span>}</small></div>
      <a className="wa-btn" href={urlFor(item)} target="_blank" rel="noopener noreferrer" onClick={() => { setSent((current) => new Set(current).add(item.id)); void markReminded(item); }}><MessageCircle /><span>{sent.has(item.id) ? "Kirim lagi" : "Kirim"}</span></a>
    </article>)}</div>
    <Button className="primary" onClick={close}>Selesai</Button>
  </Modal>;
}

function TemplateForm({ templates, preview, close, save }: {
  templates: { reminder: string; pickup: string }; preview: (template: string) => string; close: () => void;
  save: (templates: { reminder: string; pickup: string }) => Promise<void>;
}) {
  const [values, setValues] = useState(templates);
  const [which, setWhich] = useState<"reminder" | "pickup">("reminder");
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const defaults = { reminder: DEFAULT_REMINDER_TEMPLATE, pickup: DEFAULT_PICKUP_TEMPLATE };
  async function submit() {
    setBusy(true); setError("");
    try { await save({ reminder: values.reminder.trim() || DEFAULT_REMINDER_TEMPLATE, pickup: values.pickup.trim() || DEFAULT_PICKUP_TEMPLATE }); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Gagal menyimpan."); }
    finally { setBusy(false); }
  }
  return <Modal close={close} wide>
    <p className="eyebrow">PESAN PENGINGAT</p><h2>Ubah Pesan WhatsApp</h2>
    <div className="donor-tabs compact" role="tablist">
      <button type="button" role="tab" aria-selected={which === "reminder"} className={which === "reminder" ? "active" : ""} onClick={() => setWhich("reminder")}>Jalur Transfer / QRIS</button>
      <button type="button" role="tab" aria-selected={which === "pickup"} className={which === "pickup" ? "active" : ""} onClick={() => setWhich("pickup")}>Jalur Diambil</button>
    </div>
    <p className="modal-hint">Kode yang otomatis diganti: <code>{"{nama}"}</code> <code>{"{bulan}"}</code> <code>{"{nominal}"}</code> <code>{"{link}"}</code> (QRIS dengan nominal) <code>{"{rekening}"}</code>{which === "pickup" && <> <code>{"{petugas}"}</code></>}. Tanda *teks* membuat huruf tebal di WhatsApp.</p>
    <label className="field">Isi pesan<textarea value={values[which]} onChange={(event) => setValues((current) => ({ ...current, [which]: event.target.value }))} rows={12} /></label>
    <details className="template-preview"><summary>Lihat contoh pesan</summary><pre>{preview(values[which])}</pre></details>
    {error && <p className="form-error">{error}</p>}
    <div className="field-row">
      <Button variant="outline" type="button" onClick={() => setValues((current) => ({ ...current, [which]: defaults[which] }))}>Kembalikan Bawaan</Button>
      <Button className="primary" disabled={busy} onClick={() => void submit()}>{busy ? "Menyimpan..." : "Simpan Pesan"}</Button>
    </div>
  </Modal>;
}
