"use client";

// Komponen & helper yang dipakai lintas modul (beranda, keuangan, donatur tetap, dst).

import { ChevronRight } from "lucide-react";

export const money = (value: number) => new Intl.NumberFormat("id-ID", {
  style: "currency", currency: "IDR", maximumFractionDigits: 0,
}).format(value);

export function currentJakartaPeriod() {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}`;
}

export function jakartaToday() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function dateId(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value || "data terakhir";
  return new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${value}T12:00:00+07:00`));
}

export function monthId(period: string) {
  if (!/^\d{4}-\d{2}$/.test(period)) return "bulan ini";
  return new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric" }).format(new Date(`${period}-01T12:00:00+07:00`));
}

export function Stat({ label, value, note, icon, color }: { label: React.ReactNode; value: string; note: string; icon: React.ReactNode; color: string }) {
  return <article className="stat"><span className={"stat-icon " + color}>{icon}</span><small>{label}</small><strong>{value}</strong><em>{note}</em></article>;
}

export function Panel({ title, action, onAction, children }: { title: string; action: string; onAction?: () => void; children: React.ReactNode }) {
  return <section className="panel"><div className="panel-head"><h3>{title}</h3><button onClick={onAction}>{action}<ChevronRight /></button></div>{children}</section>;
}

export function Intro({ eyebrow, title, description, children }: { eyebrow: string; title: string; description: string; children?: React.ReactNode }) {
  return <div className="intro"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2><p>{description}</p></div>{children}</div>;
}

export function NumberField({ label, value, setValue }: { label: string; value: number; setValue: (value: number) => void }) {
  return <label className="field">{label}<input type="number" min="0" inputMode="numeric" value={value || ""} onChange={(event) => setValue(Number(event.target.value))} /></label>;
}
