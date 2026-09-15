"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import type { User } from "firebase/auth";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";
import {
  addDoc, collection, deleteDoc, doc, getDoc, onSnapshot, orderBy, query,
  serverTimestamp, setDoc, writeBatch, type DocumentData, type QueryDocumentSnapshot, type Unsubscribe,
} from "firebase/firestore";
import {
  ArrowDownLeft, ArrowUpRight, CalendarDays, CheckCircle2, ChevronRight,
  Clock3, HeartHandshake, Home, Landmark, LayoutGrid, LogOut, MapPin,
  Moon, Plus, RefreshCw, Settings, ShieldCheck, Sun, Trash2, Users, Wallet, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { auth, db } from "@/lib/firebase";
import historicalTransactions from "@/data/finance-history.json";

type View = "beranda" | "shalat" | "keuangan" | "program" | "kegiatan" | "jamaah" | "pengaturan" | "menu";
type Kind = "transaction" | "program" | "event" | "member";
type DataRecord = {
  id: string; kind: Kind; title: string; date: string; amount: number; type: string;
  category: string; details: string; target: number; phone: string; address: string;
};
type SaveRecord = Omit<DataRecord, "id">;
type FinanceSummary = {
  income: number; expense: number; balance: number; transactionCount: number;
  openingBalance: number; periodIncome: number; periodExpense: number; period: string;
  updatedThrough: string; live: boolean;
};

const paths: Record<Kind, string> = {
  transaction: "transactions", program: "programs", event: "events", member: "members",
};
const publicNav = [
  ["beranda", "Beranda", Home],
  ["shalat", "Jadwal Shalat", Clock3],
  ["program", "Kebaikan", HeartHandshake],
  ["kegiatan", "Kegiatan", CalendarDays],
] as const;
const privateNav = [
  ["keuangan", "Keuangan", Wallet],
  ["jamaah", "Data Jamaah", Users],
] as const;
const money = (value: number) => new Intl.NumberFormat("id-ID", {
  style: "currency", currency: "IDR", maximumFractionDigits: 0,
}).format(value);
function currentJakartaPeriod() {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}`;
}

function summarizeTransactions(items: Array<{ type: string; amount: number; date: string }>, live = true): FinanceSummary {
  const period = currentJakartaPeriod();
  const summary: FinanceSummary = {
    income: 0, expense: 0, balance: 0, transactionCount: 0,
    openingBalance: 0, periodIncome: 0, periodExpense: 0, period,
    updatedThrough: "", live,
  };
  for (const item of items) {
    const incoming = item.type === "Pemasukan";
    if (incoming) summary.income += item.amount;
    if (item.type === "Pengeluaran") summary.expense += item.amount;
    summary.transactionCount += 1;
    if (item.date > summary.updatedThrough) summary.updatedThrough = item.date;
    if (item.date.slice(0, 7) < period) summary.openingBalance += incoming ? item.amount : -item.amount;
    if (item.date.slice(0, 7) === period && incoming) summary.periodIncome += item.amount;
    if (item.date.slice(0, 7) === period && item.type === "Pengeluaran") summary.periodExpense += item.amount;
  }
  summary.balance = summary.openingBalance + summary.periodIncome - summary.periodExpense;
  return summary;
}
const historicalFinance = summarizeTransactions(historicalTransactions, false);

function dateId(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value || "data terakhir";
  return new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${value}T12:00:00+07:00`));
}
function monthId(period: string) {
  if (!/^\d{4}-\d{2}$/.test(period)) return "bulan ini";
  return new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric" }).format(new Date(`${period}-01T12:00:00+07:00`));
}
function previousMonthId(period: string) {
  if (!/^\d{4}-\d{2}$/.test(period)) return "Bulan Lalu";
  const [year, month] = period.split("-").map(Number);
  return new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric" }).format(new Date(Date.UTC(year, month - 2, 1)));
}

function mapRecord(kind: Kind, item: QueryDocumentSnapshot<DocumentData>): DataRecord {
  const data = item.data();
  return {
    id: item.id, kind, title: String(data.title ?? ""), date: String(data.date ?? ""),
    amount: Number(data.amount ?? 0), type: String(data.type ?? ""),
    category: String(data.category ?? ""), details: String(data.details ?? ""),
    target: Number(data.target ?? 0), phone: String(data.phone ?? ""),
    address: String(data.address ?? ""),
  };
}

export default function Page() {
  const [view, setView] = useState<View>("beranda");
  const [records, setRecords] = useState<DataRecord[]>([]);
  const [form, setForm] = useState<Kind | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [donateOpen, setDonateOpen] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [admin, setAdmin] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [financeSummary, setFinanceSummary] = useState<FinanceSummary>(historicalFinance);
  const [error, setError] = useState("");
  const lastLogoTap = useRef(0);

  useEffect(() => onAuthStateChanged(auth, async (currentUser) => {
    setUser(currentUser);
    setAdmin(false);
    if (!currentUser) {
      setRecords((current) => current.filter((item) => item.kind === "program" || item.kind === "event"));
    }
    if (currentUser) {
      try {
        const status = await getDoc(doc(db, "admins", currentUser.uid));
        setAdmin(status.exists() && status.data().active === true);
      } catch {
        setError("Status pengurus tidak dapat diverifikasi.");
      }
    }
    setAuthReady(true);
  }), []);

  useEffect(() => {
    const unsubscribers: Unsubscribe[] = [];
    const subscribe = (kind: Kind) => {
      const source = query(collection(db, paths[kind]), orderBy("createdAt", "desc"));
      unsubscribers.push(onSnapshot(source, (snapshot) => {
        const next = snapshot.docs.map((item) => mapRecord(kind, item));
        setRecords((current) => [...current.filter((item) => item.kind !== kind), ...next]);
        if (kind === "transaction") {
          const summary = summarizeTransactions(next);
          setFinanceSummary(summary);
          void setDoc(doc(db, "publicStats", "finance"), {
            income: summary.income, expense: summary.expense, balance: summary.balance,
            openingBalance: summary.openingBalance, periodIncome: summary.periodIncome,
            periodExpense: summary.periodExpense, period: summary.period,
            transactionCount: summary.transactionCount, updatedThrough: summary.updatedThrough,
            updatedAt: serverTimestamp(),
          }, { merge: true }).catch(() => undefined);
        }
        setError("");
      }, () => setError("Sebagian data belum dapat dimuat. Silakan muat ulang halaman.")));
    };
    subscribe("program");
    subscribe("event");
    if (admin) {
      subscribe("transaction");
      subscribe("member");
    }
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [admin]);

  useEffect(() => onSnapshot(doc(db, "publicStats", "finance"), (snapshot) => {
    if (!snapshot.exists()) return;
    const data = snapshot.data();
    const balance = Number(data.balance);
    if (!Number.isFinite(balance)) return;
    setFinanceSummary({
      income: Number(data.income ?? 0), expense: Number(data.expense ?? 0), balance,
      openingBalance: Number(data.openingBalance ?? historicalFinance.openingBalance),
      periodIncome: Number(data.periodIncome ?? historicalFinance.periodIncome),
      periodExpense: Number(data.periodExpense ?? historicalFinance.periodExpense),
      period: String(data.period ?? historicalFinance.period),
      transactionCount: Number(data.transactionCount ?? 0),
      updatedThrough: String(data.updatedThrough ?? ""), live: true,
    });
  }, () => undefined), []);

  async function login(email: string, password: string) {
    const credential = await signInWithEmailAndPassword(auth, email, password);
    const status = await getDoc(doc(db, "admins", credential.user.uid));
    if (!status.exists() || status.data().active !== true) {
      await signOut(auth);
      throw new Error("Akun bukan pengurus aktif.");
    }
    setLoginOpen(false);
  }
  async function logout() {
    await signOut(auth);
    setAdmin(false);
    if (view === "keuangan" || view === "jamaah" || view === "pengaturan") setView("beranda");
  }
  async function save(data: SaveRecord) {
    if (!user || !admin) throw new Error("Silakan masuk sebagai pengurus.");
    await addDoc(collection(db, paths[data.kind]), {
      ...data, createdAt: serverTimestamp(), createdBy: user.uid,
    });
    setForm(null);
  }
  async function remove(record: DataRecord) {
    if (!admin || !confirm("Hapus data ini?")) return;
    await deleteDoc(doc(db, paths[record.kind], record.id));
  }

  function handleLogoTap() {
    if (admin || !authReady) return;
    const now = Date.now();
    if (now - lastLogoTap.current < 500) {
      setLoginOpen(true);
      lastLogoTap.current = 0;
    } else {
      lastLogoTap.current = now;
    }
  }

  const nav = admin ? [...publicNav, ...privateNav] : publicNav;
  const mobileNav = admin ? [
    ["beranda", "Beranda", Home],
    ["shalat", "Shalat", Clock3],
    ["keuangan", "Keuangan", Wallet],
    ["program", "Donasi", HeartHandshake],
    ["menu", "Menu", LayoutGrid],
  ] as const : publicNav;
  return <div className="shell">
    <aside className="sidebar">
      <button className="brand" onClick={handleLogoTap} aria-label="Logo Masjid Baitul Fadli"><Image src="/logo-baitul-fadli-header.png" alt="Masjid Baitul Fadli" width={1198} height={572} priority /></button>
      <p className="caption">MENU UTAMA</p>
      <nav>{nav.map(([id, label, Icon]) => <button key={id} className={view === id ? "active" : ""} onClick={() => setView(id)}><Icon />{label}</button>)}</nav>
      <div className="sidebar-foot">{admin && <button className={view === "pengaturan" ? "active" : ""} onClick={() => setView("pengaturan")}><Settings />Pengaturan</button>}<section><ShieldCheck /><strong>{admin ? "Mode pengurus aktif" : "Data masjid aman"}</strong><small>{admin ? "Anda dapat mengelola data masjid." : "Informasi publik dapat dibuka tanpa akun."}</small></section></div>
    </aside>
    <main>
      <header className="clean-header"><button className="mobile-brand" onClick={handleLogoTap} aria-label="Logo Masjid Baitul Fadli"><Image src="/logo-baitul-fadli-header.png" alt="Masjid Baitul Fadli" width={1198} height={572} priority /></button></header>
      <div className="page">
        {error && <p className="data-alert">{error}</p>}
        {view === "beranda" ? <Dashboard records={records} finance={financeSummary} admin={admin} go={setView} donate={() => setDonateOpen(true)} />
          : view === "shalat" ? <PrayerPage />
          : view === "keuangan" && admin ? <Finance records={records} add={() => setForm("transaction")} remove={remove} />
          : view === "program" ? <Programs records={records} admin={admin} add={() => setForm("program")} donate={() => setDonateOpen(true)} remove={remove} />
          : view === "kegiatan" ? <Events records={records} admin={admin} add={() => setForm("event")} remove={remove} />
          : view === "jamaah" && admin ? <Members records={records} add={() => setForm("member")} remove={remove} />
          : view === "pengaturan" && admin && user ? <SettingsPage user={user} logout={logout} />
          : view === "menu" && admin && user ? <AdminMenu go={setView} logout={logout} />
          : <Dashboard records={records} finance={financeSummary} admin={admin} go={setView} donate={() => setDonateOpen(true)} />}
      </div>
    </main>
    <nav className="bottom-nav" style={{ gridTemplateColumns: `repeat(${mobileNav.length}, minmax(0, 1fr))` }}>{mobileNav.map(([id, label, Icon]) => <button key={id} className={view === id || (id === "menu" && ["kegiatan", "jamaah", "pengaturan"].includes(view)) ? "active" : ""} onClick={() => setView(id)}><Icon /><span>{id === "program" ? "Kebaikan" : label.replace("Data ", "")}</span></button>)}</nav>
    {form && <EntryForm kind={form} close={() => setForm(null)} save={save} />}
    {loginOpen && <LoginModal close={() => setLoginOpen(false)} login={login} />}
    {donateOpen && <DonationModal close={() => setDonateOpen(false)} />}
  </div>;
}

function Dashboard({ records, finance, admin, go, donate }: { records: DataRecord[]; finance: FinanceSummary; admin: boolean; go: (view: View) => void; donate: () => void }) {
  const transactions = records.filter((item) => item.kind === "transaction");
  const programs = records.filter((item) => item.kind === "program");
  const events = records.filter((item) => item.kind === "event");
  const members = records.filter((item) => item.kind === "member");
  const income = transactions.filter((item) => item.type === "Pemasukan").reduce((sum, item) => sum + item.amount, 0);
  const expense = transactions.filter((item) => item.type === "Pengeluaran").reduce((sum, item) => sum + item.amount, 0);
  return <>
    <PrayerHero onOpen={() => go("shalat")} />
    <section className="welcome modern-welcome"><div className="welcome-copy"><p className="eyebrow">ASSALAMUALAIKUM</p><h2>Semoga hari ini penuh keberkahan.</h2><p>Informasi kegiatan, program, dan layanan jamaah Masjid Baitul Fadli.</p><Button onClick={donate}><HeartHandshake />Dukung Masjid</Button></div><div className="mosque-photo"><Image src="/masjid-baitul-fadli.webp" alt="Fasad Masjid Baitul Fadli di Gunung Anyar, Surabaya" fill sizes="100vw" priority /></div></section>
    <div className={admin ? "stats" : "stats public-stats"}>{admin ? <>
      <Stat label="Saldo Kas" value={money(finance.balance)} note={`Diperbarui ${dateId(finance.updatedThrough)}`} icon={<Wallet />} color="green" />
      <Stat label="Total Pemasukan" value={money(income)} note="Data Firestore" icon={<ArrowDownLeft />} color="blue" />
      <Stat label="Total Pengeluaran" value={money(expense)} note="Data Firestore" icon={<ArrowUpRight />} color="gold" />
      <Stat label="Jamaah Terdaftar" value={String(members.length)} note="Data pengurus" icon={<Users />} color="navy" />
    </> : <>
      <Stat label={`Saldo ${previousMonthId(finance.period)}`} value={money(finance.openingBalance)} note="Saldo awal bulan" icon={<Wallet />} color="navy" />
      <Stat label={`Uang Masuk ${monthId(finance.period)}`} value={money(finance.periodIncome)} note="Penerimaan bulan berjalan" icon={<ArrowDownLeft />} color="green" />
      <Stat label={`Uang Keluar ${monthId(finance.period)}`} value={money(finance.periodExpense)} note="Pengeluaran bulan berjalan" icon={<ArrowUpRight />} color="gold" />
      <Stat label={`Saldo ${monthId(finance.period)}`} value={money(finance.balance)} note={`Diperbarui ${dateId(finance.updatedThrough)}`} icon={<Wallet />} color="blue" />
    </>}</div>
    <div className="dashboard-grid">
      {admin && <Panel title="Transaksi Terbaru" action="Lihat laporan" onAction={() => go("keuangan")}><TransactionList records={transactions.slice(0, 4)} /></Panel>}
      <Panel title="Program Berjalan" action="Lihat semua" onAction={() => go("program")}><ProgramList records={programs.slice(0, 3)} /></Panel>
      <Panel title="Agenda Terdekat" action="Lihat agenda" onAction={() => go("kegiatan")}><EventList records={events.slice(0, 4)} /></Panel>
      <section className="quote"><b>“</b><p>Perumpamaan orang yang menginfakkan hartanya di jalan Allah seperti sebutir biji yang menumbuhkan tujuh tangkai.</p><small>QS. Al-Baqarah: 261</small></section>
    </div>
  </>;
}

type PrayerKey = "Fajr" | "Sunrise" | "Dhuhr" | "Asr" | "Maghrib" | "Isha";
type PrayerSchedule = Record<PrayerKey, string>;
const prayerItems: Array<{ key: PrayerKey; label: string; icon: typeof Clock3 }> = [
  { key: "Fajr", label: "Subuh", icon: Moon },
  { key: "Sunrise", label: "Terbit", icon: Sun },
  { key: "Dhuhr", label: "Dzuhur", icon: Sun },
  { key: "Asr", label: "Ashar", icon: Clock3 },
  { key: "Maghrib", label: "Maghrib", icon: Moon },
  { key: "Isha", label: "Isya", icon: Moon },
];
const jakartaClock = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
});
async function fetchPrayerSchedule() {
  const response = await fetch("/api/prayer-times", { cache: "no-store" });
  if (!response.ok) throw new Error("Jadwal tidak tersedia");
  return response.json() as Promise<{ timings: PrayerSchedule; dateLabel: string }>;
}

function usePrayerTimes() {
  const [schedule, setSchedule] = useState<PrayerSchedule | null>(null);
  const [dateLabel, setDateLabel] = useState("");
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  async function load() {
    setLoading(true); setFailed(false);
    try {
      const result = await fetchPrayerSchedule();
      setSchedule(result.timings); setDateLabel(result.dateLabel);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    fetchPrayerSchedule().then((result) => {
      if (!active) return;
      setSchedule(result.timings); setDateLabel(result.dateLabel); setLoading(false);
    }).catch(() => {
      if (!active) return;
      setFailed(true); setLoading(false);
    });
    return () => { active = false; };
  }, []);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);

  const current = jakartaClock.format(new Date(now)).split(":").map(Number);
  const nowSeconds = current[0] * 3600 + current[1] * 60 + current[2];
  const prayerOnly = prayerItems.filter((item) => item.key !== "Sunrise");
  const next = schedule ? prayerOnly.find((item) => timeToSeconds(schedule[item.key]) > nowSeconds) ?? prayerOnly[0] : null;
  const target = next && schedule ? timeToSeconds(schedule[next.key]) + (next.key === "Fajr" && timeToSeconds(schedule.Fajr) <= nowSeconds ? 86400 : 0) : 0;
  const countdown = target ? formatCountdown(target - nowSeconds) : "--:--:--";
  return { schedule, dateLabel, loading, failed, next, countdown, reload: load };
}

function timeToSeconds(value: string) {
  const [hour, minute] = value.slice(0, 5).split(":").map(Number);
  return hour * 3600 + minute * 60;
}
function formatCountdown(value: number) {
  const safe = Math.max(0, value);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

function PrayerHero({ onOpen }: { onOpen: () => void }) {
  const { schedule, next, countdown, loading, failed } = usePrayerTimes();
  return <section className="prayer-hero">
    <div className="roof-shape" aria-hidden="true"><i /><i /><i /></div>
    <div className="prayer-copy"><span className="location-pill"><MapPin />Gunung Anyar, Surabaya</span><p>Salat berikutnya</p><h2>{loading ? "Memuat jadwal..." : failed || !next || !schedule ? "Jadwal belum tersedia" : `${next.label} · ${schedule[next.key].slice(0, 5)}`}</h2><strong className="countdown">{countdown}</strong><small>Metode Kementerian Agama RI · WIB</small></div>
    <button className="prayer-link" onClick={onOpen}>Lihat jadwal lengkap <ChevronRight /></button>
  </section>;
}

function PrayerPage() {
  const { schedule, dateLabel, loading, failed, next, countdown, reload } = usePrayerTimes();
  return <div className="stack prayer-page">
    <Intro eyebrow="WAKTU IBADAH" title="Jadwal Shalat Hari Ini" description="Jadwal untuk Gunung Anyar, Kota Surabaya, menggunakan metode Kementerian Agama Republik Indonesia." />
    <section className="prayer-focus"><div className="minaret-art" aria-hidden="true"><span /><i /></div><div><span>MENUJU WAKTU SALAT</span><h2>{next && schedule ? `${next.label} · ${schedule[next.key].slice(0, 5)}` : "Memuat jadwal"}</h2><strong>{countdown}</strong><small>{dateLabel || "Waktu Indonesia Barat"}</small></div></section>
    {failed ? <section className="prayer-error"><Clock3 /><h3>Jadwal belum dapat dimuat</h3><p>Periksa koneksi internet lalu coba kembali.</p><Button variant="outline" onClick={() => void reload()}><RefreshCw />Muat ulang</Button></section> : <div className="prayer-list">{prayerItems.map(({ key, label, icon: Icon }) => <article className={next?.key === key ? "next" : ""} key={key}><span><Icon /></span><div><small>{key === "Sunrise" ? "Matahari terbit" : "Waktu salat"}</small><strong>{label}</strong></div><b>{loading ? "--:--" : schedule?.[key]?.slice(0, 5) ?? "--:--"}</b>{next?.key === key && <em>Berikutnya</em>}</article>)}</div>}
    <p className="prayer-note">Jadwal bersifat panduan. Untuk iqamah dan perubahan kegiatan, ikuti pengumuman resmi takmir Masjid Baitul Fadli.</p>
  </div>;
}

function AdminMenu({ go, logout }: { go: (view: View) => void; logout: () => Promise<void> }) {
  const items = [
    ["kegiatan", "Kelola Kegiatan", "Publikasikan agenda masjid", CalendarDays],
    ["jamaah", "Data Jamaah", "Data privat khusus pengurus", Users],
    ["pengaturan", "Pengaturan", "Akun, Firestore, dan impor data", Settings],
  ] as const;
  return <div className="stack"><Intro eyebrow="MENU PENGURUS" title="Kelola Masjid" description="Fitur administrasi hanya tampil setelah akun pengurus terverifikasi." /><div className="admin-menu">{items.map(([id, title, note, Icon]) => <button key={id} onClick={() => go(id)}><span><Icon /></span><div><strong>{title}</strong><small>{note}</small></div><ChevronRight /></button>)}<button className="logout-menu" onClick={() => void logout()}><span><LogOut /></span><div><strong>Keluar</strong><small>Tutup akses pengurus di perangkat ini</small></div><ChevronRight /></button></div></div>;
}

function SettingsPage({ user, logout }: { user: User; logout: () => Promise<void> }) {
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState("");

  async function importFinanceHistory() {
    if (!confirm("Impor 779 transaksi sampai 11 September 2026? Data lama dengan ID yang sama akan diperbarui, bukan digandakan.")) return;
    setImporting(true); setImportResult("");
    try {
      for (let start = 0; start < historicalTransactions.length; start += 400) {
        const batch = writeBatch(db);
        historicalTransactions.slice(start, start + 400).forEach((item) => {
          batch.set(doc(db, "transactions", item.id), {
            title: item.title, date: item.date, amount: item.amount, type: item.type,
            category: item.category, details: item.details, target: 0, phone: "", address: "",
            createdAt: new Date(`${item.date}T00:00:00`), createdBy: user.uid,
            source: "Google Sheet MBF", sourceSheet: item.sourceSheet, importVersion: "2026-09-11",
          }, { merge: true });
        });
        await batch.commit();
      }
      try {
        await setDoc(doc(db, "publicStats", "finance"), {
          income: historicalFinance.income, expense: historicalFinance.expense,
          balance: historicalFinance.balance, openingBalance: historicalFinance.openingBalance,
          periodIncome: historicalFinance.periodIncome, periodExpense: historicalFinance.periodExpense,
          period: historicalFinance.period, transactionCount: historicalFinance.transactionCount,
          updatedThrough: historicalFinance.updatedThrough, updatedAt: serverTimestamp(),
        }, { merge: true });
        setImportResult("Berhasil: 779 transaksi dan ringkasan saldo publik telah diperbarui. Saldo per 11 September 2026 adalah Rp1.230.000.");
      } catch {
        setImportResult("Transaksi berhasil diimpor dan saldo aplikasi sudah Rp1.230.000. Agar pembaruan berikutnya tampil untuk jamaah secara langsung, tambahkan izin publicStats pada Rules Firestore.");
      }
    } catch {
      setImportResult("Impor belum berhasil. Pastikan akun masih aktif dan Rules Firestore mengizinkan pengurus menulis transaksi.");
    } finally {
      setImporting(false);
    }
  }

  return <div className="stack">
    <Intro eyebrow="PENGATURAN AKUN" title="Pengaturan Pengurus" description="Informasi akun dan koneksi penyimpanan aplikasi Masjid Baitul Fadli." />
    <div className="settings-grid">
      <section className="setting-card"><span><ShieldCheck /></span><div><small>AKUN AKTIF</small><h3>{user.email}</h3><p>Akun ini terdaftar sebagai pengurus aktif dan dapat mengelola data masjid.</p></div></section>
      <section className="setting-card"><span><Settings /></span><div><small>PENYIMPANAN</small><h3>Firebase Firestore</h3><p>Transaksi, program, kegiatan, dan data jamaah tersimpan pada basis data masjid.</p></div></section>
      <section className="setting-card wide finance-import"><span><Wallet /></span><div><small>RIWAYAT KEUANGAN</small><h3>Data sampai 11 September 2026</h3><p>Impor 779 transaksi dari laporan lama. Proses ini aman dijalankan ulang karena menggunakan ID tetap sehingga tidak menggandakan data.</p>{importResult && <p className="import-result">{importResult}</p>}</div><Button className="primary" disabled={importing} onClick={importFinanceHistory}>{importing ? "Mengimpor..." : "Impor ke Firestore"}</Button></section>
      <section className="setting-card wide"><span><Landmark /></span><div><small>IDENTITAS APLIKASI</small><h3>Masjid Baitul Fadli</h3><p>Logo resmi dan nama masjid telah diterapkan pada tampilan aplikasi.</p></div><Button variant="outline" onClick={logout}><LogOut />Keluar dari akun</Button></section>
    </div>
  </div>;
}

function Stat({ label, value, note, icon, color }: { label: string; value: string; note: string; icon: React.ReactNode; color: string }) {
  return <article className="stat"><span className={"stat-icon " + color}>{icon}</span><small>{label}</small><strong>{value}</strong><em>{note}</em></article>;
}
function Panel({ title, action, onAction, children }: { title: string; action: string; onAction?: () => void; children: React.ReactNode }) {
  return <section className="panel"><div className="panel-head"><h3>{title}</h3><button onClick={onAction}>{action}<ChevronRight /></button></div>{children}</section>;
}
function TransactionList({ records }: { records: DataRecord[] }) {
  if (!records.length) return <p className="empty">Belum ada transaksi.</p>;
  return <div>{records.map((item) => { const incoming = item.type === "Pemasukan"; return <div className="transaction" key={item.id}><span className={incoming ? "in" : "out"}>{incoming ? <ArrowDownLeft /> : <ArrowUpRight />}</span><div><strong>{item.title}</strong><small>{item.date || "Tanpa tanggal"}</small></div><b className={incoming ? "plus" : "minus"}>{incoming ? "+" : "−"}{money(item.amount)}</b></div>; })}</div>;
}
function ProgramList({ records }: { records: DataRecord[] }) {
  if (!records.length) return <p className="empty">Belum ada program yang dipublikasikan.</p>;
  return <div className="mini-programs">{records.map((item) => { const pct = item.target ? Math.min(100, Math.round(item.amount / item.target * 100)) : 0; return <div key={item.id}><div className="program-line"><strong>{item.title}</strong><span>{pct}%</span></div><Progress value={pct} /><small>{money(item.amount)} dari {money(item.target)}</small></div>; })}</div>;
}
function EventList({ records }: { records: DataRecord[] }) {
  if (!records.length) return <p className="empty">Belum ada agenda yang dipublikasikan.</p>;
  return <div>{records.map((item) => <div className="event-row" key={item.id}><span className="date"><b>{item.date.slice(8, 10) || "--"}</b><small>{item.date.slice(5, 7) || "BLN"}</small></span><div><strong>{item.title}</strong><small>{item.details || "Informasi menyusul"}</small></div><em>{item.category || "Kegiatan"}</em></div>)}</div>;
}
function Intro({ eyebrow, title, description, children }: { eyebrow: string; title: string; description: string; children?: React.ReactNode }) {
  return <div className="intro"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2><p>{description}</p></div>{children}</div>;
}

function Finance({ records, add, remove }: { records: DataRecord[]; add: () => void; remove: (record: DataRecord) => void }) {
  const items = records.filter((item) => item.kind === "transaction");
  const income = items.filter((item) => item.type === "Pemasukan").reduce((sum, item) => sum + item.amount, 0);
  const expense = items.filter((item) => item.type === "Pengeluaran").reduce((sum, item) => sum + item.amount, 0);
  return <div className="stack"><Intro eyebrow="TRANSPARAN & AKUNTABEL" title="Laporan Keuangan Masjid" description="Data keuangan hanya dapat dibuka dan dikelola oleh pengurus."><Button className="primary" onClick={add}><Plus />Catat Transaksi</Button></Intro><div className="stats three"><Stat label="Total Pemasukan" value={money(income)} note="Data Firestore" icon={<ArrowDownLeft />} color="green" /><Stat label="Total Pengeluaran" value={money(expense)} note="Data Firestore" icon={<ArrowUpRight />} color="gold" /><Stat label="Saldo" value={money(income - expense)} note={items.length + " transaksi"} icon={<Wallet />} color="navy" /></div><Panel title="Daftar Transaksi" action={items.length + " transaksi"}><div className="table"><div className="tr th"><span>Transaksi</span><span>Tanggal</span><span>Kategori</span><span>Nominal</span><span /></div>{items.map((item) => <div className="tr" key={item.id}><span><i className={"dot " + (item.type === "Pemasukan" ? "in" : "out")} /><strong>{item.title}</strong></span><span>{item.date || "-"}</span><span><em>{item.category || "-"}</em></span><b className={item.type === "Pemasukan" ? "plus" : "minus"}>{item.type === "Pemasukan" ? "+" : "−"}{money(item.amount)}</b><button onClick={() => remove(item)} aria-label="Hapus transaksi"><Trash2 /></button></div>)}{!items.length && <p className="empty">Belum ada transaksi.</p>}</div></Panel></div>;
}
function Programs({ records, admin, add, donate, remove }: { records: DataRecord[]; admin: boolean; add: () => void; donate: () => void; remove: (record: DataRecord) => void }) {
  const items = records.filter((item) => item.kind === "program");
  return <div className="stack"><Intro eyebrow="PROGRAM KEBAIKAN" title="Tumbuhkan Manfaat Bersama" description="Setiap rupiah dikelola untuk kebutuhan jamaah dan kemakmuran masjid."><div className="actions">{admin && <Button variant="outline" onClick={add}><Plus />Tambah Program</Button>}<Button className="gold-btn" onClick={donate}><HeartHandshake />Dukung Masjid</Button></div></Intro><div className="program-cards">{items.map((item, index) => { const pct = item.target ? Math.min(100, Math.round(item.amount / item.target * 100)) : 0; return <article key={item.id}><div className={"program-top " + ["emerald", "amber", "blue"][index % 3]}><span><Landmark /></span><b>{item.category || "Program"}</b></div><div className="program-body"><h3>{item.title}</h3><p>{item.details || "Program kebaikan Masjid Baitul Fadli."}</p><div className="program-line"><strong>{money(item.amount)}</strong><span>{pct}%</span></div><Progress value={pct} /><small>Target {money(item.target)}</small><div className="card-actions"><Button variant="outline" onClick={donate}>Dukung<ChevronRight /></Button>{admin && <Button variant="outline" onClick={() => remove(item)} aria-label="Hapus program"><Trash2 /></Button>}</div></div></article>; })}{!items.length && <p className="empty">Belum ada program yang dipublikasikan.</p>}</div></div>;
}
function Events({ records, admin, add, remove }: { records: DataRecord[]; admin: boolean; add: () => void; remove: (record: DataRecord) => void }) {
  const items = records.filter((item) => item.kind === "event");
  return <div className="stack"><Intro eyebrow="AGENDA MASJID" title="Hidupkan Masjid, Eratkan Ukhuwah" description="Jadwal ibadah, pendidikan, dan kegiatan sosial untuk seluruh jamaah.">{admin && <Button className="primary" onClick={add}><Plus />Tambah Kegiatan</Button>}</Intro><div className="event-cards">{items.map((item) => <article key={item.id}><span className="date large"><small>{item.date.slice(5, 7) || "BLN"}</small><b>{item.date.slice(8, 10) || "--"}</b></span><div><em>{item.category || "Kegiatan"}</em><h3>{item.title}</h3><p>{item.details}</p></div>{admin && <button onClick={() => remove(item)} aria-label="Hapus kegiatan"><Trash2 /></button>}</article>)}{!items.length && <p className="empty">Belum ada kegiatan yang dipublikasikan.</p>}</div></div>;
}
function Members({ records, add, remove }: { records: DataRecord[]; add: () => void; remove: (record: DataRecord) => void }) {
  const items = records.filter((item) => item.kind === "member");
  return <div className="stack"><Intro eyebrow="DATABASE JAMAAH" title="Jamaah Masjid Baitul Fadli" description="Data pribadi jamaah hanya dapat dibuka pengurus."><Button className="primary" onClick={add}><Plus />Tambah Jamaah</Button></Intro><div className="stats three"><Stat label="Total Jamaah" value={String(items.length)} note="Data Firestore" icon={<Users />} color="green" /><Stat label="Relawan" value={String(items.filter((item) => item.category === "Relawan").length)} note="Siap membantu" icon={<HeartHandshake />} color="blue" /><Stat label="Kepala Keluarga" value={String(items.filter((item) => item.type === "Kepala Keluarga").length)} note="Terdata" icon={<Home />} color="gold" /></div><Panel title="Daftar Jamaah" action={items.length + " jamaah"}><div className="members">{items.map((item) => <article key={item.id}><span>{item.title.split(" ").map((word) => word[0]).slice(0, 2).join("")}</span><div><strong>{item.title}</strong><small>{item.phone || "-"} · {item.address || "-"}</small></div><button onClick={() => remove(item)} aria-label="Hapus jamaah"><Trash2 /></button></article>)}{!items.length && <p className="empty">Belum ada jamaah.</p>}</div></Panel></div>;
}

function EntryForm({ kind, close, save }: { kind: Kind; close: () => void; save: (data: SaveRecord) => Promise<void> }) {
  const [title, setTitle] = useState(""); const [date, setDate] = useState("");
  const [amount, setAmount] = useState(0); const [target, setTarget] = useState(0);
  const [type, setType] = useState(kind === "transaction" ? "Pemasukan" : kind === "member" ? "Jamaah" : "");
  const [category, setCategory] = useState(""); const [details, setDetails] = useState("");
  const [phone, setPhone] = useState(""); const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const labels = { transaction: "Transaksi", program: "Program Donasi", event: "Kegiatan", member: "Jamaah" };
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!title) return setError("Nama/judul wajib diisi.");
    setBusy(true); setError("");
    try { await save({ kind, title, date, amount, type, category, details, target, phone, address }); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Gagal menyimpan data."); }
    finally { setBusy(false); }
  }
  const options = kind === "transaction" ? ["Infak", "Operasional", "Sosial", "Pembangunan"] : kind === "program" ? ["Fasilitas", "Sosial", "Operasional"] : kind === "event" ? ["Kajian", "Sosial", "Pendidikan"] : ["Jamaah", "Relawan"];
  return <div className="modal-wrap"><button className="backdrop" onClick={close} aria-label="Tutup" /><form className="modal entry-form" onSubmit={submit}><button type="button" className="modal-x" onClick={close}><X /></button><p className="eyebrow">INPUT DATA</p><h2>Tambah {labels[kind]}</h2><label className="field">{kind === "member" ? "Nama lengkap" : "Nama / judul"}<input value={title} onChange={(event) => setTitle(event.target.value)} required /></label>{(kind === "transaction" || kind === "event") && <label className="field">Tanggal<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>}{kind === "transaction" && <><label className="field">Jenis<select value={type} onChange={(event) => setType(event.target.value)}><option>Pemasukan</option><option>Pengeluaran</option></select></label><NumberField label="Nominal" value={amount} setValue={setAmount} /></>}{kind === "program" && <><NumberField label="Dana terkumpul" value={amount} setValue={setAmount} /><NumberField label="Target dana" value={target} setValue={setTarget} /></>}{kind === "member" && <><label className="field">Nomor WhatsApp<input value={phone} onChange={(event) => setPhone(event.target.value)} /></label><label className="field">Alamat / RT<input value={address} onChange={(event) => setAddress(event.target.value)} /></label><label className="field">Status<select value={type} onChange={(event) => setType(event.target.value)}><option>Jamaah</option><option>Kepala Keluarga</option></select></label></>}<label className="field">Kategori<select value={category} onChange={(event) => setCategory(event.target.value)}><option value="">Pilih kategori</option>{options.map((option) => <option key={option}>{option}</option>)}</select></label>{kind !== "member" && <label className="field">Keterangan<textarea value={details} onChange={(event) => setDetails(event.target.value)} /></label>}{error && <p className="form-error">{error}</p>}<Button className="primary" disabled={busy}>{busy ? "Menyimpan..." : "Simpan Data"}</Button></form></div>;
}
function NumberField({ label, value, setValue }: { label: string; value: number; setValue: (value: number) => void }) {
  return <label className="field">{label}<input type="number" min="0" value={value || ""} onChange={(event) => setValue(Number(event.target.value))} /></label>;
}
function LoginModal({ close, login }: { close: () => void; login: (email: string, password: string) => Promise<void> }) {
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { await login(email, password); } catch { setError("Email atau password salah, atau akun bukan pengurus aktif."); } finally { setBusy(false); }
  }
  return <div className="modal-wrap"><button className="backdrop" onClick={close} aria-label="Tutup" /><form className="modal login-form" onSubmit={submit}><button type="button" className="modal-x" onClick={close}><X /></button><p className="eyebrow">AKSES TERBATAS</p><h2>Masuk sebagai Pengurus</h2><p>Gunakan akun yang telah didaftarkan oleh administrator masjid.</p><label className="field">Email<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label><label className="field">Password<input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>{error && <p className="form-error">{error}</p>}<Button className="primary" disabled={busy}>{busy ? "Memeriksa..." : "Masuk"}</Button></form></div>;
}
function DonationModal({ close }: { close: () => void }) {
  const [amount, setAmount] = useState(100000); const [done, setDone] = useState(false);
  return <div className="modal-wrap"><button className="backdrop" onClick={close} aria-label="Tutup" /><section className="modal"><button className="modal-x" onClick={close}><X /></button>{done ? <div className="success"><span><CheckCircle2 /></span><h2>Jazakumullahu khairan</h2><p>Silakan hubungi pengurus untuk memperoleh rekening resmi dan konfirmasi donasi.</p><div><small>Nominal yang dipilih</small><strong>{money(amount)}</strong></div><Button onClick={close}>Selesai</Button></div> : <><p className="eyebrow">DONASI MASJID</p><h2>Mulai kebaikan hari ini</h2><p>Pilih nominal donasi. Pastikan transfer hanya ke rekening resmi yang disampaikan pengurus.</p><div className="amounts">{[50000, 100000, 250000, 500000].map((value) => <button className={amount === value ? "chosen" : ""} onClick={() => setAmount(value)} key={value}>{money(value)}</button>)}</div><NumberField label="Nominal lainnya" value={amount} setValue={setAmount} /><Button className="primary" onClick={() => setDone(true)}>Lanjutkan <ChevronRight /></Button></>}</section></div>;
}
