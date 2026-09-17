"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import type { User } from "firebase/auth";
import { createUserWithEmailAndPassword, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";
import {
  addDoc, collection, deleteDoc, doc, getDoc, onSnapshot, orderBy, query,
  serverTimestamp, setDoc, writeBatch, type DocumentData, type QueryDocumentSnapshot, type Unsubscribe,
} from "firebase/firestore";
import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import {
  ArrowDownLeft, ArrowUpRight, Building2, CalendarDays, CheckCircle2, ChevronRight,
  Clock3, Download, FileDown, HeartHandshake, Home, Landmark, LayoutGrid, LocateFixed, LogOut, MapPin,
  Moon, Pencil, Plus, QrCode, RefreshCw, Search, Settings, ShieldCheck, Sun, Tags, Trash2, Upload, UserPlus, Users, Wallet, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { auth, db, getSecondaryAuth, storage } from "@/lib/firebase";
import historicalTransactions from "@/data/finance-history.json";

type View = "beranda" | "shalat" | "keuangan" | "program" | "kegiatan" | "jamaah" | "master" | "pengaturan" | "menu";
type Kind = "transaction" | "program" | "event" | "member" | "structure";
type DataRecord = {
  id: string; kind: Kind; title: string; date: string; amount: number; type: string;
  category: string; details: string; target: number; phone: string; address: string;
};
type SaveRecord = Omit<DataRecord, "id">;
type SupporterEntry = { name: string; phone: string; address: string; amount: number; frequency: string };
type CategoryItem = { id: string; name: string; type: string };
type DonationSettings = { bankName: string; accountNumber: string; accountHolder: string; qrisUrl: string };
type AdminAccount = { id: string; email: string; active: boolean };
type FinanceSummary = {
  income: number; expense: number; balance: number; transactionCount: number;
  openingBalance: number; periodIncome: number; periodExpense: number; period: string;
  updatedThrough: string; live: boolean;
};

const paths: Record<Kind, string> = {
  transaction: "transactions", program: "programs", event: "events", member: "members", structure: "orgStructure",
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
  ["master", "Master Data", Tags],
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
  const [editing, setEditing] = useState<DataRecord | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [donateOpen, setDonateOpen] = useState(false);
  const [supporterOpen, setSupporterOpen] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [admin, setAdmin] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [financeSummary, setFinanceSummary] = useState<FinanceSummary>(historicalFinance);
  const [financeCategories, setFinanceCategories] = useState<CategoryItem[]>([]);
  const [memberCategories, setMemberCategories] = useState<CategoryItem[]>([]);
  const [donationSettings, setDonationSettings] = useState<DonationSettings>({ bankName: "", accountNumber: "", accountHolder: "", qrisUrl: "" });
  const [admins, setAdmins] = useState<AdminAccount[]>([]);
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
      subscribe("structure");
      const mapCategory = (item: QueryDocumentSnapshot<DocumentData>): CategoryItem => {
        const data = item.data();
        return { id: item.id, name: String(data.name ?? ""), type: String(data.type ?? "") };
      };
      const subscribeCategories = (path: string, setValue: (value: CategoryItem[]) => void) => {
        unsubscribers.push(onSnapshot(query(collection(db, path), orderBy("name")), (snapshot) => {
          setValue(snapshot.docs.map(mapCategory));
        }, () => undefined));
      };
      subscribeCategories("financeCategories", setFinanceCategories);
      subscribeCategories("memberCategories", setMemberCategories);
      unsubscribers.push(onSnapshot(collection(db, "admins"), (snapshot) => {
        setAdmins(snapshot.docs.map((item) => ({ id: item.id, email: String(item.data().email ?? ""), active: item.data().active === true })));
      }, () => undefined));
    }
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [admin]);

  useEffect(() => onSnapshot(doc(db, "settings", "donation"), (snapshot) => {
    if (!snapshot.exists()) return;
    const data = snapshot.data();
    setDonationSettings({
      bankName: String(data.bankName ?? ""), accountNumber: String(data.accountNumber ?? ""),
      accountHolder: String(data.accountHolder ?? ""), qrisUrl: String(data.qrisUrl ?? ""),
    });
  }, () => undefined), []);

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
  async function update(record: DataRecord, data: SaveRecord) {
    if (!user || !admin) throw new Error("Silakan masuk sebagai pengurus.");
    await setDoc(doc(db, paths[record.kind], record.id), { ...data, updatedAt: serverTimestamp(), updatedBy: user.uid }, { merge: true });
    setForm(null); setEditing(null);
  }
  async function remove(record: DataRecord) {
    if (!admin || !confirm("Hapus data ini?")) return;
    await deleteDoc(doc(db, paths[record.kind], record.id));
  }
  function editStart(record: DataRecord) {
    setEditing(record); setForm(record.kind);
  }
  async function registerSupporter(data: SupporterEntry) {
    await addDoc(collection(db, "supporters"), {
      ...data, status: "baru", createdAt: serverTimestamp(),
    });
  }
  async function addCategory(path: string, name: string, type: string) {
    if (!admin) throw new Error("Silakan masuk sebagai pengurus.");
    await addDoc(collection(db, path), { name, type, createdAt: serverTimestamp() });
  }
  async function removeCategory(path: string, id: string) {
    if (!admin || !confirm("Hapus kategori ini?")) return;
    await deleteDoc(doc(db, path, id));
  }
  async function saveDonationSettings(data: DonationSettings) {
    if (!admin) throw new Error("Silakan masuk sebagai pengurus.");
    await setDoc(doc(db, "settings", "donation"), { ...data, updatedAt: serverTimestamp() }, { merge: true });
  }
  async function uploadQris(file: File) {
    if (!admin) throw new Error("Silakan masuk sebagai pengurus.");
    const fileRef = storageRef(storage, "qris/donasi-masjid-baitul-fadli.png");
    await uploadBytes(fileRef, file);
    const url = await getDownloadURL(fileRef);
    await setDoc(doc(db, "settings", "donation"), { qrisUrl: url, updatedAt: serverTimestamp() }, { merge: true });
    return url;
  }
  async function addAdminAccount(email: string, password: string) {
    if (!admin || !user) throw new Error("Silakan masuk sebagai pengurus.");
    const secondaryAuth = getSecondaryAuth();
    const credential = await createUserWithEmailAndPassword(secondaryAuth, email, password);
    await setDoc(doc(db, "admins", credential.user.uid), {
      email, active: true, createdAt: serverTimestamp(), createdBy: user.uid,
    });
    await signOut(secondaryAuth);
  }
  async function toggleAdminActive(account: AdminAccount) {
    if (!admin) return;
    if (account.id === user?.uid && account.active) {
      if (!confirm("Ini akun Anda sendiri. Nonaktifkan akses pengurus untuk akun ini?")) return;
    }
    await setDoc(doc(db, "admins", account.id), { active: !account.active }, { merge: true });
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
        {view === "beranda" ? <Dashboard records={records} finance={financeSummary} admin={admin} go={setView} donate={() => setDonateOpen(true)} joinSupporter={() => setSupporterOpen(true)} />
          : view === "shalat" ? <PrayerPage />
          : view === "keuangan" && admin ? <Finance records={records} add={() => setForm("transaction")} remove={remove} />
          : view === "program" ? <Programs records={records} admin={admin} add={() => setForm("program")} donate={() => setDonateOpen(true)} remove={remove} />
          : view === "kegiatan" ? <Events records={records} admin={admin} add={() => setForm("event")} remove={remove} />
          : view === "jamaah" && admin ? <Members records={records} add={() => setForm("member")} edit={editStart} remove={remove} />
          : view === "master" && admin ? <MasterData records={records} financeCategories={financeCategories} memberCategories={memberCategories} addCategory={addCategory} removeCategory={removeCategory} addStructure={() => setForm("structure")} remove={remove} />
          : view === "pengaturan" && admin && user ? <SettingsPage user={user} logout={logout} donationSettings={donationSettings} saveDonationSettings={saveDonationSettings} uploadQris={uploadQris} admins={admins} addAdminAccount={addAdminAccount} toggleAdminActive={toggleAdminActive} />
          : view === "menu" && admin && user ? <AdminMenu go={setView} logout={logout} />
          : <Dashboard records={records} finance={financeSummary} admin={admin} go={setView} donate={() => setDonateOpen(true)} joinSupporter={() => setSupporterOpen(true)} />}
      </div>
    </main>
    <nav className="bottom-nav" style={{ gridTemplateColumns: `repeat(${mobileNav.length}, minmax(0, 1fr))` }}>{mobileNav.map(([id, label, Icon]) => <button key={id} className={view === id || (id === "menu" && ["kegiatan", "jamaah", "master", "pengaturan"].includes(view)) ? "active" : ""} onClick={() => setView(id)}><Icon /><span>{id === "program" ? "Kebaikan" : label.replace("Data ", "")}</span></button>)}</nav>
    {form && <EntryForm kind={form} editing={editing} close={() => { setForm(null); setEditing(null); }} save={save} update={update} financeCategories={financeCategories} memberCategories={memberCategories} />}
    {loginOpen && <LoginModal close={() => setLoginOpen(false)} login={login} />}
    {donateOpen && <DonationModal close={() => setDonateOpen(false)} donationSettings={donationSettings} />}
    {supporterOpen && <SupporterModal close={() => setSupporterOpen(false)} register={registerSupporter} />}
  </div>;
}

function Dashboard({ records, finance, admin, go, donate, joinSupporter }: { records: DataRecord[]; finance: FinanceSummary; admin: boolean; go: (view: View) => void; donate: () => void; joinSupporter: () => void }) {
  const transactions = records.filter((item) => item.kind === "transaction");
  const programs = records.filter((item) => item.kind === "program");
  const events = records.filter((item) => item.kind === "event");
  const members = records.filter((item) => item.kind === "member");
  const income = transactions.filter((item) => item.type === "Pemasukan").reduce((sum, item) => sum + item.amount, 0);
  const expense = transactions.filter((item) => item.type === "Pengeluaran").reduce((sum, item) => sum + item.amount, 0);
  return <>
    <PrayerHero onOpen={() => go("shalat")} />
    <section className="welcome modern-welcome"><div className="welcome-copy"><p className="eyebrow">ASSALAMUALAIKUM</p><h2>Semoga hari ini penuh keberkahan.</h2><p>Informasi kegiatan, program, dan layanan jamaah Masjid Baitul Fadli.</p><div className="actions"><Button onClick={donate}><HeartHandshake />Dukung Masjid</Button><Button variant="outline" onClick={joinSupporter}><UserPlus />Jadi Donatur Tetap</Button></div></div><div className="mosque-photo"><Image src="/masjid-baitul-fadli.webp" alt="Fasad Masjid Baitul Fadli di Gunung Anyar, Surabaya" fill sizes="100vw" priority /></div></section>
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
async function fetchPrayerSchedule(coords?: { lat: number; lon: number }) {
  const params = coords ? `?lat=${coords.lat}&lon=${coords.lon}` : "";
  const response = await fetch(`/api/prayer-times${params}`, { cache: "no-store" });
  if (!response.ok) throw new Error("Jadwal tidak tersedia");
  return response.json() as Promise<{ timings: PrayerSchedule; dateLabel: string; location: string }>;
}

function usePrayerTimes() {
  const [schedule, setSchedule] = useState<PrayerSchedule | null>(null);
  const [dateLabel, setDateLabel] = useState("");
  const [location, setLocation] = useState("Gunung Anyar, Surabaya");
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [locating, setLocating] = useState(false);
  const [gpsError, setGpsError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const lastCoords = useRef<{ lat: number; lon: number } | undefined>(undefined);

  async function load(coords?: { lat: number; lon: number }) {
    lastCoords.current = coords;
    setLoading(true); setFailed(false);
    try {
      const result = await fetchPrayerSchedule(coords);
      setSchedule(result.timings); setDateLabel(result.dateLabel); setLocation(result.location);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }

  function useGps() {
    if (!("geolocation" in navigator)) { setGpsError("Perangkat tidak mendukung GPS."); return; }
    setLocating(true); setGpsError("");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        void load({ lat: position.coords.latitude, lon: position.coords.longitude }).finally(() => setLocating(false));
      },
      () => { setGpsError("Izin lokasi ditolak. Menampilkan jadwal Surabaya."); setLocating(false); },
      { enableHighAccuracy: false, timeout: 10000 },
    );
  }

  useEffect(() => {
    let active = true;
    fetchPrayerSchedule().then((result) => {
      if (!active) return;
      setSchedule(result.timings); setDateLabel(result.dateLabel); setLocation(result.location); setLoading(false);
    }).catch(() => {
      if (!active) return;
      setFailed(true); setLoading(false);
    });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!failed) return;
    const timer = window.setInterval(() => { void load(lastCoords.current); }, 45000);
    return () => window.clearInterval(timer);
  }, [failed]);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);

  const current = jakartaClock.format(new Date(now)).split(":").map(Number);
  const nowSeconds = current[0] * 3600 + current[1] * 60 + current[2];
  const prayerOnly = prayerItems.filter((item) => item.key !== "Sunrise");
  const next = schedule ? prayerOnly.find((item) => timeToSeconds(schedule[item.key]) > nowSeconds) ?? prayerOnly[0] : null;
  const target = next && schedule ? timeToSeconds(schedule[next.key]) + (next.key === "Fajr" && timeToSeconds(schedule.Fajr) <= nowSeconds ? 86400 : 0) : 0;
  const countdown = target ? formatCountdown(target - nowSeconds) : "--:--:--";
  return { schedule, dateLabel, location, loading, failed, next, countdown, reload: () => load(), useGps, locating, gpsError };
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
  const { schedule, next, countdown, loading, failed, location, useGps, locating } = usePrayerTimes();
  return <section className="prayer-hero">
    <div className="prayer-copy"><button type="button" className="location-pill gps-button" onClick={useGps} disabled={locating} title="Gunakan lokasi GPS saya"><MapPin />{locating ? "Mencari lokasi..." : location}</button><p>Salat berikutnya</p><h2>{loading ? "Memuat jadwal..." : failed || !next || !schedule ? "Jadwal belum tersedia" : `${next.label} · ${schedule[next.key].slice(0, 5)}`}</h2><strong className="countdown">{countdown}</strong><small>Metode Kementerian Agama RI · WIB</small></div>
    <button className="prayer-link" onClick={onOpen}>Lihat jadwal lengkap <ChevronRight /></button>
  </section>;
}

function PrayerPage() {
  const { schedule, dateLabel, loading, failed, next, countdown, reload, location, useGps, locating, gpsError } = usePrayerTimes();
  return <div className="stack prayer-page">
    <Intro eyebrow="WAKTU IBADAH" title="Jadwal Shalat Hari Ini" description="Jadwal menggunakan metode Kementerian Agama Republik Indonesia. Sesuaikan lokasi dengan GPS untuk jadwal yang lebih akurat." />
    <div className="finance-toolbar no-print">
      <button type="button" className="location-pill gps-button" onClick={useGps} disabled={locating}><MapPin />{locating ? "Mencari lokasi..." : location}</button>
      <Button variant="outline" disabled={locating} onClick={useGps}><LocateFixed />{locating ? "Mencari..." : "Gunakan Lokasi GPS Saya"}</Button>
    </div>
    {gpsError && <p className="data-alert">{gpsError}</p>}
    <section className="prayer-focus"><div><span>MENUJU WAKTU SALAT</span><h2>{next && schedule ? `${next.label} · ${schedule[next.key].slice(0, 5)}` : "Memuat jadwal"}</h2><strong>{countdown}</strong><small>{dateLabel || "Waktu Indonesia Barat"}</small></div></section>
    {failed ? <section className="prayer-error"><Clock3 /><h3>Jadwal belum dapat dimuat</h3><p>Periksa koneksi internet lalu coba kembali.</p><Button variant="outline" onClick={() => void reload()}><RefreshCw />Muat ulang</Button></section> : <div className="prayer-list">{prayerItems.map(({ key, label, icon: Icon }) => <article className={next?.key === key ? "next" : ""} key={key}><span><Icon /></span><div><small>{key === "Sunrise" ? "Matahari terbit" : "Waktu salat"}</small><strong>{label}</strong></div><b>{loading ? "--:--" : schedule?.[key]?.slice(0, 5) ?? "--:--"}</b>{next?.key === key && <em>Berikutnya</em>}</article>)}</div>}
    <p className="prayer-note">Jadwal bersifat panduan. Untuk iqamah dan perubahan kegiatan, ikuti pengumuman resmi takmir Masjid Baitul Fadli.</p>
  </div>;
}

function AdminMenu({ go, logout }: { go: (view: View) => void; logout: () => Promise<void> }) {
  const items = [
    ["kegiatan", "Kelola Kegiatan", "Publikasikan agenda masjid", CalendarDays],
    ["jamaah", "Data Jamaah", "Data privat khusus pengurus", Users],
    ["master", "Master Data", "Kategori, struktur organisasi", Tags],
    ["pengaturan", "Pengaturan", "Akun, QRIS, dan impor data", Settings],
  ] as const;
  return <div className="stack"><Intro eyebrow="MENU PENGURUS" title="Kelola Masjid" description="Fitur administrasi hanya tampil setelah akun pengurus terverifikasi." /><div className="admin-menu">{items.map(([id, title, note, Icon]) => <button key={id} onClick={() => go(id)}><span><Icon /></span><div><strong>{title}</strong><small>{note}</small></div><ChevronRight /></button>)}<button className="logout-menu" onClick={() => void logout()}><span><LogOut /></span><div><strong>Keluar</strong><small>Tutup akses pengurus di perangkat ini</small></div><ChevronRight /></button></div></div>;
}

function adminErrorMessage(caught: unknown) {
  const code = caught && typeof caught === "object" && "code" in caught ? String((caught as { code: unknown }).code) : "";
  if (code === "auth/email-already-in-use") return "Email ini sudah terdaftar sebagai akun di Firebase Authentication. Gunakan email lain, atau jika akun tersebut memang milik pengurus baru, minta developer menautkan UID-nya ke koleksi admins secara manual.";
  if (code === "auth/invalid-email") return "Format email tidak valid.";
  if (code === "auth/weak-password") return "Password terlalu lemah, gunakan minimal 6 karakter.";
  if (code === "auth/network-request-failed") return "Koneksi bermasalah. Periksa internet lalu coba lagi.";
  if (code === "auth/operation-not-allowed") return "Metode masuk Email/Password belum diaktifkan di Firebase Authentication.";
  return caught instanceof Error ? caught.message : "Gagal membuat akun pengurus.";
}
function SettingsPage({ user, logout, donationSettings, saveDonationSettings, uploadQris, admins, addAdminAccount, toggleAdminActive }: {
  user: User; logout: () => Promise<void>; donationSettings: DonationSettings;
  saveDonationSettings: (data: DonationSettings) => Promise<void>; uploadQris: (file: File) => Promise<string>;
  admins: AdminAccount[]; addAdminAccount: (email: string, password: string) => Promise<void>; toggleAdminActive: (account: AdminAccount) => Promise<void>;
}) {
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState("");
  const [bankName, setBankName] = useState(donationSettings.bankName);
  const [accountNumber, setAccountNumber] = useState(donationSettings.accountNumber);
  const [accountHolder, setAccountHolder] = useState(donationSettings.accountHolder);
  const [savingAccount, setSavingAccount] = useState(false);
  const [accountResult, setAccountResult] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState("");
  const [newEmail, setNewEmail] = useState(""); const [newPassword, setNewPassword] = useState("");
  const [addingAdmin, setAddingAdmin] = useState(false); const [adminResult, setAdminResult] = useState("");

  async function submitAccount(event: React.FormEvent) {
    event.preventDefault();
    setSavingAccount(true); setAccountResult("");
    try {
      await saveDonationSettings({ bankName, accountNumber, accountHolder, qrisUrl: donationSettings.qrisUrl });
      setAccountResult("Informasi rekening tersimpan.");
    } catch {
      setAccountResult("Gagal menyimpan. Pastikan Rules Firestore mengizinkan pengurus menulis settings/donation.");
    } finally {
      setSavingAccount(false);
    }
  }
  async function handleQrisUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploading(true); setUploadResult("");
    try {
      await uploadQris(file);
      setUploadResult("QRIS berhasil diunggah dan langsung tampil di halaman donasi.");
    } catch {
      setUploadResult("Gagal mengunggah QRIS. Pastikan Firebase Storage sudah aktif dan Rules mengizinkan pengurus menulis.");
    } finally {
      setUploading(false);
    }
  }
  async function submitAdmin(event: React.FormEvent) {
    event.preventDefault();
    if (newPassword.length < 6) return setAdminResult("Password minimal 6 karakter.");
    setAddingAdmin(true); setAdminResult("");
    try {
      await addAdminAccount(newEmail, newPassword);
      setAdminResult(`Akun pengurus ${newEmail} berhasil dibuat.`);
      setNewEmail(""); setNewPassword("");
    } catch (caught) {
      setAdminResult(adminErrorMessage(caught));
    } finally {
      setAddingAdmin(false);
    }
  }

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
      <section className="setting-card wide admin-accounts">
        <span><UserPlus /></span>
        <div>
          <small>AKUN PENGURUS</small>
          <h3>Kelola Akses Pengurus</h3>
          <p>Tambahkan akun pengurus baru atau nonaktifkan akses pengurus yang sudah tidak aktif.</p>
          <div className="admin-list">
            {admins.map((account) => <div className="admin-row" key={account.id}><span className={account.active ? "on" : "off"}><ShieldCheck /></span><div><strong>{account.email || account.id}</strong><small>{account.active ? "Aktif" : "Nonaktif"}</small></div><Button variant="outline" onClick={() => void toggleAdminActive(account)}>{account.active ? "Nonaktifkan" : "Aktifkan"}</Button></div>)}
            {!admins.length && <p className="empty">Belum ada data akun pengurus.</p>}
          </div>
          <form className="account-form" onSubmit={submitAdmin}>
            <label className="field">Email pengurus baru<input type="email" value={newEmail} onChange={(event) => setNewEmail(event.target.value)} required /></label>
            <label className="field">Password awal<input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} minLength={6} required /></label>
            {adminResult && <p className="import-result">{adminResult}</p>}
            <Button className="primary" disabled={addingAdmin}>{addingAdmin ? "Membuat akun..." : "Tambah Akun Pengurus"}</Button>
          </form>
        </div>
      </section>
      <section className="setting-card wide finance-import"><span><Wallet /></span><div><small>RIWAYAT KEUANGAN</small><h3>Data sampai 11 September 2026</h3><p>Impor 779 transaksi dari laporan lama. Proses ini aman dijalankan ulang karena menggunakan ID tetap sehingga tidak menggandakan data.</p>{importResult && <p className="import-result">{importResult}</p>}</div><Button className="primary" disabled={importing} onClick={importFinanceHistory}>{importing ? "Mengimpor..." : "Impor ke Firestore"}</Button></section>
      <section className="setting-card wide"><span><Landmark /></span><div><small>IDENTITAS APLIKASI</small><h3>Masjid Baitul Fadli</h3><p>Logo resmi dan nama masjid telah diterapkan pada tampilan aplikasi.</p></div><Button variant="outline" onClick={logout}><LogOut />Keluar dari akun</Button></section>
      <section className="setting-card wide qris-settings">
        <span><QrCode /></span>
        <div>
          <small>QRIS & REKENING DONASI</small>
          <h3>Kelola Metode Donasi</h3>
          <p>Unggah QRIS resmi masjid dan lengkapi info rekening. Keduanya akan tampil saat jamaah donasi.</p>
          <form className="account-form" onSubmit={submitAccount}>
            <label className="field">Nama Bank<input value={bankName} onChange={(event) => setBankName(event.target.value)} placeholder="Contoh: Bank Jatim Syariah" /></label>
            <label className="field">Nomor Rekening<input value={accountNumber} onChange={(event) => setAccountNumber(event.target.value)} /></label>
            <label className="field">Atas Nama<input value={accountHolder} onChange={(event) => setAccountHolder(event.target.value)} placeholder="Contoh: Masjid Baitul Fadli" /></label>
            {accountResult && <p className="import-result">{accountResult}</p>}
            <Button className="primary" disabled={savingAccount}>{savingAccount ? "Menyimpan..." : "Simpan Rekening"}</Button>
          </form>
          <div className="qris-upload">
            {donationSettings.qrisUrl ? <Image src={donationSettings.qrisUrl} alt="QRIS Masjid Baitul Fadli" width={140} height={140} unoptimized /> : <p className="empty">Belum ada QRIS diunggah.</p>}
            <label className="upload-button"><Upload />{uploading ? "Mengunggah..." : "Unggah QRIS Baru"}<input type="file" accept="image/*" onChange={handleQrisUpload} disabled={uploading} hidden /></label>
          </div>
          {uploadResult && <p className="import-result">{uploadResult}</p>}
        </div>
      </section>
    </div>
    <p className="app-signature">Powered by: PT Multi Power Abadi</p>
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
  const allItems = records.filter((item) => item.kind === "transaction");
  const months = Array.from(new Set(allItems.map((item) => item.date.slice(0, 7)).filter(Boolean))).sort().reverse();
  const [month, setMonth] = useState("");
  const items = month ? allItems.filter((item) => item.date.slice(0, 7) === month) : allItems;
  const income = items.filter((item) => item.type === "Pemasukan").reduce((sum, item) => sum + item.amount, 0);
  const expense = items.filter((item) => item.type === "Pengeluaran").reduce((sum, item) => sum + item.amount, 0);
  const periodLabel = month ? monthId(month) : "Seluruh periode";
  const printedLabel = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Jakarta" }).format(new Date());
  return <div className="stack">
    <div className="print-header"><h1>Laporan Keuangan Masjid Baitul Fadli</h1><p>Periode: {periodLabel} · Dicetak {printedLabel}</p></div>
    <div className="no-print">
      <Intro eyebrow="TRANSPARAN & AKUNTABEL" title="Laporan Keuangan Masjid" description="Data keuangan hanya dapat dibuka dan dikelola oleh pengurus."><Button className="primary" onClick={add}><Plus />Catat Transaksi</Button></Intro>
      <div className="finance-toolbar">
        <label className="field">Filter bulan<select value={month} onChange={(event) => setMonth(event.target.value)}><option value="">Semua periode</option>{months.map((value) => <option key={value} value={value}>{monthId(value)}</option>)}</select></label>
        <Button variant="outline" onClick={() => window.print()}><FileDown />Ekspor PDF</Button>
      </div>
      <div className="stats three"><Stat label="Total Pemasukan" value={money(income)} note="Data Firestore" icon={<ArrowDownLeft />} color="green" /><Stat label="Total Pengeluaran" value={money(expense)} note="Data Firestore" icon={<ArrowUpRight />} color="gold" /><Stat label="Saldo" value={money(income - expense)} note={items.length + " transaksi"} icon={<Wallet />} color="navy" /></div>
      <Panel title="Daftar Transaksi" action={items.length + " transaksi"}><div className="table"><div className="tr th"><span>Transaksi</span><span>Tanggal</span><span>Kategori</span><span>Nominal</span><span /></div>{items.map((item) => <div className="tr" key={item.id}><span><i className={"dot " + (item.type === "Pemasukan" ? "in" : "out")} /><strong>{item.title}</strong></span><span>{item.date || "-"}</span><span><em>{item.category || "-"}</em></span><b className={item.type === "Pemasukan" ? "plus" : "minus"}>{item.type === "Pemasukan" ? "+" : "−"}{money(item.amount)}</b><button onClick={() => remove(item)} aria-label="Hapus transaksi"><Trash2 /></button></div>)}{!items.length && <p className="empty">Belum ada transaksi.</p>}</div></Panel>
    </div>
    <table className="print-summary"><tbody>
      <tr><td>Total Pemasukan</td><td>{money(income)}</td></tr>
      <tr><td>Total Pengeluaran</td><td>{money(expense)}</td></tr>
      <tr className="total"><td>Saldo {periodLabel}</td><td>{money(income - expense)}</td></tr>
    </tbody></table>
    <table className="print-table">
      <thead><tr><th>No</th><th>Tanggal</th><th>Uraian</th><th>Kategori</th><th>Jenis</th><th>Nominal</th></tr></thead>
      <tbody>{items.map((item, index) => <tr key={item.id}><td>{index + 1}</td><td>{item.date || "-"}</td><td>{item.title}</td><td>{item.category || "-"}</td><td>{item.type}</td><td className="num">{item.type === "Pemasukan" ? "+" : "−"}{money(item.amount)}</td></tr>)}
      {!items.length && <tr><td colSpan={6}>Belum ada transaksi pada periode ini.</td></tr>}</tbody>
    </table>
    <div className="print-signature">
      <div><span>Mengetahui,</span><strong>Ketua Takmir</strong><em>Masjid Baitul Fadli</em><i className="sign-line" /><small>( ..................................... )</small></div>
      <div><span>Dibuat oleh,</span><strong>Bendahara</strong><em>Masjid Baitul Fadli</em><i className="sign-line" /><small>( ..................................... )</small></div>
    </div>
  </div>;
}
function Programs({ records, admin, add, donate, remove }: { records: DataRecord[]; admin: boolean; add: () => void; donate: () => void; remove: (record: DataRecord) => void }) {
  const items = records.filter((item) => item.kind === "program");
  return <div className="stack"><Intro eyebrow="PROGRAM KEBAIKAN" title="Tumbuhkan Manfaat Bersama" description="Setiap rupiah dikelola untuk kebutuhan jamaah dan kemakmuran masjid."><div className="actions">{admin && <Button variant="outline" onClick={add}><Plus />Tambah Program</Button>}<Button className="gold-btn" onClick={donate}><HeartHandshake />Dukung Masjid</Button></div></Intro><div className="program-cards">{items.map((item, index) => { const pct = item.target ? Math.min(100, Math.round(item.amount / item.target * 100)) : 0; return <article key={item.id}><div className={"program-top " + ["emerald", "amber", "blue"][index % 3]}><span><Landmark /></span><b>{item.category || "Program"}</b></div><div className="program-body"><h3>{item.title}</h3><p>{item.details || "Program kebaikan Masjid Baitul Fadli."}</p><div className="program-line"><strong>{money(item.amount)}</strong><span>{pct}%</span></div><Progress value={pct} /><small>Target {money(item.target)}</small><div className="card-actions"><Button variant="outline" onClick={donate}>Dukung<ChevronRight /></Button>{admin && <Button variant="outline" onClick={() => remove(item)} aria-label="Hapus program"><Trash2 /></Button>}</div></div></article>; })}{!items.length && <p className="empty">Belum ada program yang dipublikasikan.</p>}</div></div>;
}
function Events({ records, admin, add, remove }: { records: DataRecord[]; admin: boolean; add: () => void; remove: (record: DataRecord) => void }) {
  const items = records.filter((item) => item.kind === "event");
  return <div className="stack"><Intro eyebrow="AGENDA MASJID" title="Hidupkan Masjid, Eratkan Ukhuwah" description="Jadwal ibadah, pendidikan, dan kegiatan sosial untuk seluruh jamaah.">{admin && <Button className="primary" onClick={add}><Plus />Tambah Kegiatan</Button>}</Intro><div className="event-cards">{items.map((item) => <article key={item.id}><span className="date large"><small>{item.date.slice(5, 7) || "BLN"}</small><b>{item.date.slice(8, 10) || "--"}</b></span><div><em>{item.category || "Kegiatan"}</em><h3>{item.title}</h3><p>{item.details}</p></div>{admin && <button onClick={() => remove(item)} aria-label="Hapus kegiatan"><Trash2 /></button>}</article>)}{!items.length && <p className="empty">Belum ada kegiatan yang dipublikasikan.</p>}</div></div>;
}
function Members({ records, add, edit, remove }: { records: DataRecord[]; add: () => void; edit: (record: DataRecord) => void; remove: (record: DataRecord) => void }) {
  const items = records.filter((item) => item.kind === "member");
  const [search, setSearch] = useState(""); const [domisili, setDomisili] = useState(""); const [kategori, setKategori] = useState("");
  const kategoriOptions = Array.from(new Set(items.map((item) => item.category).filter(Boolean))).sort();
  const query = search.trim().toLowerCase();
  const filtered = items.filter((item) =>
    (!query || item.title.toLowerCase().includes(query) || item.address.toLowerCase().includes(query) || item.phone.toLowerCase().includes(query)) &&
    (!domisili || item.type === domisili) && (!kategori || item.category === kategori));
  return <div className="stack"><Intro eyebrow="DATABASE JAMAAH" title="Jamaah Masjid Baitul Fadli" description="Data pribadi jamaah hanya dapat dibuka pengurus."><Button className="primary" onClick={add}><Plus />Tambah Jamaah</Button></Intro><div className="stats three"><Stat label="Total Jamaah" value={String(items.length)} note="Data Firestore" icon={<Users />} color="green" /><Stat label="Jamaah Mukim" value={String(items.filter((item) => item.type === "Mukim").length)} note="Berdomisili tetap" icon={<Home />} color="gold" /><Stat label="Non-Mukim" value={String(items.filter((item) => item.type === "Non-Mukim").length)} note="Tidak berdomisili tetap" icon={<Users />} color="blue" /></div>
    <div className="finance-toolbar">
      <label className="field search-field"><Search />Cari nama, alamat, atau nomor<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Ketik untuk mencari..." /></label>
      <label className="field">Status Domisili<select value={domisili} onChange={(event) => setDomisili(event.target.value)}><option value="">Semua status</option><option>Mukim</option><option>Non-Mukim</option></select></label>
      <label className="field">Kategori<select value={kategori} onChange={(event) => setKategori(event.target.value)}><option value="">Semua kategori</option>{kategoriOptions.map((value) => <option key={value}>{value}</option>)}</select></label>
    </div>
    <Panel title="Daftar Jamaah" action={filtered.length + " dari " + items.length + " jamaah"}><div className="members">{filtered.map((item) => <article key={item.id}><span>{item.title.split(" ").map((word) => word[0]).slice(0, 2).join("")}</span><div><strong>{item.title}</strong><small>{item.phone || "-"} · {item.address || "-"}{item.type && ` · ${item.type}`}{item.category && ` · ${item.category}`}</small></div><button onClick={() => edit(item)} aria-label="Edit jamaah"><Pencil /></button><button onClick={() => remove(item)} aria-label="Hapus jamaah"><Trash2 /></button></article>)}{!filtered.length && <p className="empty">{items.length ? "Tidak ada jamaah yang cocok dengan filter." : "Belum ada jamaah."}</p>}</div></Panel></div>;
}

function MasterData({ records, financeCategories, memberCategories, addCategory, removeCategory, addStructure, remove }: {
  records: DataRecord[]; financeCategories: CategoryItem[]; memberCategories: CategoryItem[];
  addCategory: (path: string, name: string, type: string) => Promise<void>;
  removeCategory: (path: string, id: string) => Promise<void>;
  addStructure: () => void; remove: (record: DataRecord) => void;
}) {
  const structure = records.filter((item) => item.kind === "structure");
  return <div className="stack">
    <Intro eyebrow="MASTER DATA" title="Kategori & Struktur Organisasi" description="Kelola daftar kategori transaksi, kategori jamaah, dan struktur pengurus masjid." />
    <Panel title="Kategori Keuangan" action={financeCategories.length + " kategori"}>
      <CategoryManager items={financeCategories} path="financeCategories" withType add={addCategory} remove={removeCategory} />
    </Panel>
    <Panel title="Kategori Jamaah" action={memberCategories.length + " kategori"}>
      <CategoryManager items={memberCategories} path="memberCategories" add={addCategory} remove={removeCategory} />
    </Panel>
    <section className="panel">
      <div className="panel-head"><h3>Struktur Organisasi</h3><button onClick={addStructure}>Tambah<Plus /></button></div>
      <div className="org-list">
        {structure.map((item) => <article className="org-card" key={item.id}><span><Building2 /></span><div><strong>{item.title}</strong><small>{item.category || "Pengurus"}{item.phone && ` · ${item.phone}`}</small></div><button onClick={() => remove(item)} aria-label="Hapus struktur"><Trash2 /></button></article>)}
        {!structure.length && <p className="empty">Belum ada data struktur organisasi.</p>}
      </div>
    </section>
  </div>;
}
function CategoryManager({ items, path, withType, add, remove }: {
  items: CategoryItem[]; path: string; withType?: boolean;
  add: (path: string, name: string, type: string) => Promise<void>;
  remove: (path: string, id: string) => Promise<void>;
}) {
  const [name, setName] = useState(""); const [type, setType] = useState("Pemasukan");
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true); setError("");
    try { await add(path, name.trim(), withType ? type : ""); setName(""); }
    catch { setError("Gagal menyimpan kategori."); }
    finally { setBusy(false); }
  }
  return <div className="category-manager">
    <form className="category-form" onSubmit={submit}>
      <input placeholder="Nama kategori" value={name} onChange={(event) => setName(event.target.value)} />
      {withType && <select value={type} onChange={(event) => setType(event.target.value)}><option>Pemasukan</option><option>Pengeluaran</option></select>}
      <Button disabled={busy || !name.trim()}><Plus />Tambah</Button>
    </form>
    {error && <p className="form-error">{error}</p>}
    <div className="category-list">
      {items.map((item) => <span className="category-chip" key={item.id}>{withType && <em className={item.type === "Pemasukan" ? "in" : "out"}>{item.type}</em>}{item.name}<button onClick={() => remove(path, item.id)} aria-label="Hapus kategori"><X /></button></span>)}
      {!items.length && <p className="empty">Belum ada kategori.</p>}
    </div>
  </div>;
}

function EntryForm({ kind, editing, close, save, update, financeCategories, memberCategories }: {
  kind: Kind; editing: DataRecord | null; close: () => void; save: (data: SaveRecord) => Promise<void>;
  update: (record: DataRecord, data: SaveRecord) => Promise<void>; financeCategories: CategoryItem[]; memberCategories: CategoryItem[];
}) {
  const [title, setTitle] = useState(editing?.title ?? ""); const [date, setDate] = useState(editing?.date ?? "");
  const [amount, setAmount] = useState(editing?.amount ?? 0); const [target, setTarget] = useState(editing?.target ?? 0);
  const [type, setType] = useState(editing?.type ?? (kind === "transaction" ? "Pemasukan" : kind === "member" ? "Mukim" : ""));
  const [category, setCategory] = useState(editing?.category ?? ""); const [details, setDetails] = useState(editing?.details ?? "");
  const [phone, setPhone] = useState(editing?.phone ?? ""); const [address, setAddress] = useState(editing?.address ?? "");
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const labels = { transaction: "Transaksi", program: "Program Donasi", event: "Kegiatan", member: "Jamaah", structure: "Struktur Organisasi" };
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!title) return setError("Nama/judul wajib diisi.");
    setBusy(true); setError("");
    const data = { kind, title, date, amount, type, category, details, target, phone, address };
    try { await (editing ? update(editing, data) : save(data)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Gagal menyimpan data."); }
    finally { setBusy(false); }
  }
  const financeOptions = financeCategories.filter((item) => item.type === type).map((item) => item.name);
  const memberOptions = memberCategories.map((item) => item.name);
  const options = kind === "transaction" ? (financeOptions.length ? financeOptions : ["Infak", "Operasional", "Sosial", "Pembangunan"])
    : kind === "program" ? ["Fasilitas", "Sosial", "Operasional"] : kind === "event" ? ["Kajian", "Sosial", "Pendidikan"]
    : kind === "member" ? (memberOptions.length ? memberOptions : ["Jamaah", "Relawan"]) : [];
  return <div className="modal-wrap"><button className="backdrop" onClick={close} aria-label="Tutup" /><form className="modal entry-form" onSubmit={submit}><button type="button" className="modal-x" onClick={close}><X /></button><p className="eyebrow">INPUT DATA</p><h2>{editing ? "Edit" : "Tambah"} {labels[kind]}</h2><label className="field">{kind === "member" || kind === "structure" ? "Nama lengkap" : "Nama / judul"}<input value={title} onChange={(event) => setTitle(event.target.value)} required /></label>{(kind === "transaction" || kind === "event") && <label className="field">Tanggal<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>}{kind === "transaction" && <><label className="field">Jenis<select value={type} onChange={(event) => setType(event.target.value)}><option>Pemasukan</option><option>Pengeluaran</option></select></label><NumberField label="Nominal" value={amount} setValue={setAmount} /></>}{kind === "program" && <><NumberField label="Dana terkumpul" value={amount} setValue={setAmount} /><NumberField label="Target dana" value={target} setValue={setTarget} /></>}{kind === "member" && <><label className="field">Nomor WhatsApp<input value={phone} onChange={(event) => setPhone(event.target.value)} /></label><label className="field">Alamat / RT<input value={address} onChange={(event) => setAddress(event.target.value)} /></label><label className="field">Status Domisili<select value={type} onChange={(event) => setType(event.target.value)}><option>Mukim</option><option>Non-Mukim</option></select></label></>}{kind === "structure" && <><label className="field">Jabatan<input value={category} onChange={(event) => setCategory(event.target.value)} placeholder="Contoh: Ketua Takmir" /></label><label className="field">Nomor WhatsApp<input value={phone} onChange={(event) => setPhone(event.target.value)} /></label></>}{kind !== "structure" && <label className="field">Kategori<select value={category} onChange={(event) => setCategory(event.target.value)}><option value="">Pilih kategori</option>{options.map((option) => <option key={option}>{option}</option>)}</select></label>}{kind !== "member" && <label className="field">Keterangan<textarea value={details} onChange={(event) => setDetails(event.target.value)} /></label>}{error && <p className="form-error">{error}</p>}<Button className="primary" disabled={busy}>{busy ? "Menyimpan..." : editing ? "Simpan Perubahan" : "Simpan Data"}</Button></form></div>;
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
function DonationModal({ close, donationSettings }: { close: () => void; donationSettings: DonationSettings }) {
  const [amount, setAmount] = useState(100000);
  const [step, setStep] = useState<"amount" | "qris" | "done">("amount");
  const qrisSrc = donationSettings.qrisUrl || "/qris-masjid-baitul-fadli.svg";
  const hasAccount = donationSettings.bankName || donationSettings.accountNumber;
  return <div className="modal-wrap"><button className="backdrop" onClick={close} aria-label="Tutup" /><section className="modal">
    <button className="modal-x" onClick={close}><X /></button>
    {step === "done" ? <div className="success"><span><CheckCircle2 /></span><h2>Jazakumullahu khairan</h2><p>Konfirmasi donasi Anda akan diverifikasi oleh pengurus masjid.</p><div><small>Nominal yang dipilih</small><strong>{money(amount)}</strong></div><Button onClick={close}>Selesai</Button></div>
      : step === "qris" ? <div className="qris-step">
        <div className="donate-steps"><span className="active" /><span className="active" /><span /></div>
        <p className="eyebrow">SCAN QRIS</p><h2>Bayar dengan QRIS</h2>
        <Image src={qrisSrc} alt="Kode QRIS Masjid Baitul Fadli" width={230} height={230} unoptimized={!!donationSettings.qrisUrl} />
        <a className="qris-download" href={qrisSrc} download="QRIS-Masjid-Baitul-Fadli.png" target="_blank" rel="noopener"><Download />Download QRIS</a>
        <div className="qris-nominal"><small>Nominal donasi</small><strong>{money(amount)}</strong></div>
        {hasAccount && <div className="qris-account"><small>Atau transfer ke rekening</small><strong>{donationSettings.bankName}</strong><span>{donationSettings.accountNumber} a.n. {donationSettings.accountHolder}</span></div>}
        <p className="qris-hint">Buka aplikasi e-wallet, m-banking, atau dompet digital Anda, pilih Scan QRIS, lalu masukkan nominal di atas sebelum membayar.</p>
        <Button className="primary" onClick={() => setStep("done")}>Saya Sudah Transfer <ChevronRight /></Button>
      </div>
      : <><div className="donate-steps"><span className="active" /><span /><span /></div><p className="eyebrow">DONASI MASJID</p><h2>Mulai kebaikan hari ini</h2><p>Pilih nominal donasi, lalu bayar langsung melalui QRIS masjid.</p><div className="amounts">{[50000, 100000, 250000, 500000].map((value) => <button className={amount === value ? "chosen" : ""} onClick={() => setAmount(value)} key={value}>{money(value)}</button>)}</div><NumberField label="Nominal lainnya" value={amount} setValue={setAmount} /><Button className="primary" disabled={!amount} onClick={() => setStep("qris")}><QrCode />Tampilkan QRIS</Button></>}
  </section></div>;
}
function SupporterModal({ close, register }: { close: () => void; register: (data: SupporterEntry) => Promise<void> }) {
  const [name, setName] = useState(""); const [phone, setPhone] = useState(""); const [address, setAddress] = useState("");
  const [amount, setAmount] = useState(100000); const [frequency, setFrequency] = useState("Bulanan");
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [done, setDone] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!name || !phone) return setError("Nama dan nomor WhatsApp wajib diisi.");
    setBusy(true); setError("");
    try { await register({ name, phone, address, amount, frequency }); setDone(true); }
    catch { setError("Gagal menyimpan pendaftaran. Silakan coba lagi."); }
    finally { setBusy(false); }
  }
  return <div className="modal-wrap"><button className="backdrop" onClick={close} aria-label="Tutup" /><section className="modal">
    <button className="modal-x" onClick={close}><X /></button>
    {done ? <div className="success"><span><CheckCircle2 /></span><h2>Terima kasih, {name}</h2><p>Pendaftaran donatur tetap Anda telah kami terima. Pengurus akan menghubungi Anda melalui WhatsApp untuk konfirmasi.</p><Button onClick={close}>Selesai</Button></div>
      : <form onSubmit={submit}><p className="eyebrow">DONATUR TETAP</p><h2>Jadi Donatur Tetap</h2><p>Daftar sebagai donatur tetap bulanan untuk mendukung program dan operasional Masjid Baitul Fadli secara berkelanjutan.</p>
        <label className="field">Nama lengkap<input value={name} onChange={(event) => setName(event.target.value)} required /></label>
        <label className="field">Nomor WhatsApp<input value={phone} onChange={(event) => setPhone(event.target.value)} required /></label>
        <label className="field">Alamat<input value={address} onChange={(event) => setAddress(event.target.value)} /></label>
        <NumberField label="Rencana donasi per bulan" value={amount} setValue={setAmount} />
        <label className="field">Frekuensi<select value={frequency} onChange={(event) => setFrequency(event.target.value)}><option>Bulanan</option><option>Mingguan</option></select></label>
        {error && <p className="form-error">{error}</p>}
        <Button className="primary" disabled={busy}>{busy ? "Menyimpan..." : "Daftar Sekarang"}</Button>
      </form>}
  </section></div>;
}
