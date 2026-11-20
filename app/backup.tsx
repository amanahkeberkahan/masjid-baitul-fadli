"use client";

// Backup Data: unduh seluruh isi database (sesuai hak akses pengurus penuh / RLS)
// dalam format Excel (.xlsx, satu sheet per tabel), SQL (INSERT siap dipulihkan), dan JSON.
// Tanpa library tambahan: file .xlsx dirakit sendiri (zip "stored" + XML SpreadsheetML).

import { useEffect, useState } from "react";
import { Database, Download, FileCode2, FileJson, FileSpreadsheet } from "lucide-react";
import { supabase } from "@/lib/supabase";

type Row = Record<string, unknown>;
type TableDump = { table: string; label: string; rows: Row[]; error?: string };

// Urutan mengikuti ketergantungan foreign key, agar file SQL bisa dijalankan dari atas ke bawah.
const TABLES: Array<[string, string]> = [
  ["admins", "Akun Pengurus"],
  ["finance_categories", "Kategori Keuangan"],
  ["member_categories", "Kategori Jamaah"],
  ["cash_accounts", "Akun Kas"],
  ["transactions", "Transaksi Kas"],
  ["programs", "Program Donasi"],
  ["events", "Kegiatan"],
  ["members", "Data Jamaah"],
  ["org_structure", "Struktur Organisasi"],
  ["settings", "Pengaturan"],
  ["public_stats", "Ringkasan Publik"],
  ["supporters", "Donatur Tetap"],
  ["supporter_payments", "Pembayaran Donatur"],
];
const PAGE = 1000; // batas baris per request PostgREST
const MAX_PAGES = 500; // pengaman: maks 500 ribu baris per tabel
const LAST_BACKUP_KEY = "mbf-last-backup";

async function fetchTable(table: string): Promise<{ rows: Row[]; error?: string }> {
  const rows: Row[] = [];
  for (let page = 0, from = 0; page < MAX_PAGES; page += 1, from += PAGE) {
    const { data, error } = await supabase.from(table).select("*").range(from, from + PAGE - 1);
    if (error) {
      // Tabel belum dibuat (mis. modul donatur belum di-SQL-kan) tidak menggagalkan backup lain.
      return { rows, error: error.code === "42P01" || /does not exist|schema cache/i.test(error.message) ? "tabel belum ada" : error.message };
    }
    rows.push(...((data ?? []) as Row[]));
    if (!data || data.length < PAGE) break;
  }
  // Urutan stabil agar backup mudah dibandingkan antarwaktu.
  if (rows.length && "created_at" in rows[0]) rows.sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")));
  return { rows };
}

export async function collectBackup(onProgress?: (message: string) => void): Promise<TableDump[]> {
  const result: TableDump[] = [];
  for (const [table, label] of TABLES) {
    onProgress?.(`Mengambil ${label}...`);
    const { rows, error } = await fetchTable(table);
    result.push({ table, label, rows, error });
  }
  return result;
}

function columnsOf(rows: Row[]) {
  const columns: string[] = [];
  for (const row of rows) for (const key of Object.keys(row)) if (!columns.includes(key)) columns.push(key);
  return columns;
}

// ---------- SQL ----------
function sqlValue(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "object") return `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
  return `'${String(value).replace(/'/g, "''")}'`;
}
const ident = (name: string) => /^[a-z_][a-z0-9_]*$/.test(name) ? name : `"${name.replace(/"/g, '""')}"`;

export function toSql(dump: TableDump[], meta: { createdAt: string; email: string }) {
  const lines = [
    "-- Backup data Masjid Baitul Fadli",
    `-- Dibuat: ${meta.createdAt} oleh ${meta.email}`,
    "-- Isi: data saja (INSERT). Struktur tabel ada di supabase/schema.sql, storage.sql, donatur_tetap.sql.",
    "--",
    "-- Cara memulihkan ke project Supabase (baru atau lama):",
    "--   1. Jalankan supabase/schema.sql, lalu supabase/storage.sql dan supabase/donatur_tetap.sql.",
    "--   2. Buat ulang akun login pengurus di Authentication (tabel admins merujuk auth.users),",
    "--      atau hapus bagian admins di bawah bila id akunnya berbeda.",
    "--   3. Jalankan file ini di SQL Editor. Baris yang sudah ada (id sama) dilewati, aman diulang.",
    "",
    "begin;",
    "",
  ];
  for (const { table, label, rows, error } of dump) {
    lines.push(`-- ${label} (${table}): ${error ? `DILEWATI - ${error}` : `${rows.length} baris`}`);
    if (error || !rows.length) { lines.push(""); continue; }
    const columns = columnsOf(rows);
    const conflictKey = columns.includes("id") ? "id" : columns.includes("key") ? "key" : "";
    const head = `insert into public.${ident(table)} (${columns.map(ident).join(", ")}) values`;
    // Dipecah per 200 baris agar satu statement tidak terlalu besar di SQL Editor.
    for (let index = 0; index < rows.length; index += 200) {
      const chunk = rows.slice(index, index + 200).map((row) => `  (${columns.map((column) => sqlValue(row[column])).join(", ")})`);
      lines.push(`${head}\n${chunk.join(",\n")}\n${conflictKey ? `on conflict (${conflictKey}) do nothing` : ""};`);
    }
    lines.push("");
  }
  lines.push("commit;", "");
  return lines.join("\n");
}

// ---------- JSON ----------
export function toJson(dump: TableDump[], meta: { createdAt: string; email: string }) {
  return JSON.stringify({
    app: "Masjid Baitul Fadli", createdAt: meta.createdAt, createdBy: meta.email,
    tables: Object.fromEntries(dump.map(({ table, rows, error }) => [table, error ? { error } : rows])),
  }, null, 2);
}

// ---------- XLSX (tanpa library) ----------
const xmlEscape = (text: string) => text.replace(/[<>&"]/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[char]!))
  // Karakter kontrol tidak sah di XML.
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
function colName(index: number) {
  let name = ""; let n = index + 1;
  while (n > 0) { const rem = (n - 1) % 26; name = String.fromCharCode(65 + rem) + name; n = Math.floor((n - 1) / 26); }
  return name;
}
function cellXml(ref: string, value: unknown, header = false) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "number" && Number.isFinite(value)) return `<c r="${ref}"><v>${value}</v></c>`;
  const text = typeof value === "object" ? JSON.stringify(value) : typeof value === "boolean" ? (value ? "TRUE" : "FALSE") : String(value);
  return `<c r="${ref}" t="inlineStr"${header ? ' s="1"' : ""}><is><t xml:space="preserve">${xmlEscape(text.slice(0, 32000))}</t></is></c>`;
}
function sheetXml(rows: Row[], note?: string) {
  const columns = columnsOf(rows);
  const body: string[] = [];
  if (!columns.length) {
    body.push(`<row r="1">${cellXml("A1", note ?? "Tidak ada data")}</row>`);
  } else {
    body.push(`<row r="1">${columns.map((column, index) => cellXml(`${colName(index)}1`, column, true)).join("")}</row>`);
    rows.forEach((row, rowIndex) => {
      const r = rowIndex + 2;
      body.push(`<row r="${r}">${columns.map((column, index) => cellXml(`${colName(index)}${r}`, row[column])).join("")}</row>`);
    });
  }
  const widths = columns.map((column, index) => {
    const longest = Math.max(column.length, ...rows.slice(0, 200).map((row) => String(row[column] ?? "").length));
    return `<col min="${index + 1}" max="${index + 1}" width="${Math.min(60, Math.max(10, longest + 2))}" customWidth="1"/>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0">${columns.length ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' : ""}</sheetView></sheetViews>${widths ? `<cols>${widths}</cols>` : ""}<sheetData>${body.join("")}</sheetData></worksheet>`;
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
  return table;
})();
function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) crc = crcTable[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
/** Zip tanpa kompresi (metode "stored"), cukup untuk .xlsx dan dibaca Excel/LibreOffice/Google Sheets. */
function zipStored(files: Array<{ name: string; content: string }>) {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = []; const central: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name); const data = encoder.encode(file.content); const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, 0, true); local.setUint32(14, crc, true); local.setUint32(18, data.length, true); local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    chunks.push(new Uint8Array(local.buffer), name, data);
    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true); entry.setUint16(4, 20, true); entry.setUint16(6, 20, true); entry.setUint16(8, 0x0800, true);
    entry.setUint32(16, crc, true); entry.setUint32(20, data.length, true); entry.setUint32(24, data.length, true);
    entry.setUint16(28, name.length, true); entry.setUint32(42, offset, true);
    central.push(new Uint8Array(entry.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true); end.setUint32(16, offset, true);
  return new Blob([...chunks, ...central, new Uint8Array(end.buffer)] as BlobPart[], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

export function toXlsx(dump: TableDump[], meta: { createdAt: string; email: string }) {
  const summary: Row[] = dump.map(({ label, table, rows, error }) => ({ Sheet: label, Tabel: table, "Jumlah Baris": error ? 0 : rows.length, Keterangan: error ?? "" }));
  summary.unshift({ Sheet: "Backup Masjid Baitul Fadli", Tabel: meta.createdAt, "Jumlah Baris": "", Keterangan: `oleh ${meta.email}` });
  const sheets = [{ name: "Ringkasan", xml: sheetXml(summary) }, ...dump.map(({ label, rows, error }) => ({ name: label.slice(0, 31), xml: sheetXml(rows, error ? `Dilewati: ${error}` : undefined) }))];
  const files = [
    { name: "[Content_Types].xml", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>` },
    { name: "_rels/.rels", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: "xl/workbook.xml", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((sheet, index) => `<sheet name="${xmlEscape(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("")}</sheets></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: "xl/styles.xml", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF08765A"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>` },
    ...sheets.map((sheet, index) => ({ name: `xl/worksheets/sheet${index + 1}.xml`, content: sheet.xml })),
  ];
  return zipStored(files);
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = filename;
  document.body.appendChild(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function BackupCard({ email }: { email: string }) {
  const [busy, setBusy] = useState<"" | "xlsx" | "sql" | "json">("");
  const [status, setStatus] = useState("");
  const [lastBackup, setLastBackup] = useState("");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sekali baca dari localStorage setelah mount
    try { setLastBackup(localStorage.getItem(LAST_BACKUP_KEY) ?? ""); } catch { /* storage opsional */ }
  }, []);

  async function download(format: "xlsx" | "sql" | "json") {
    setBusy(format); setStatus("Menyiapkan backup...");
    try {
      const dump = await collectBackup(setStatus);
      const now = new Date();
      const createdAt = new Intl.DateTimeFormat("id-ID", { dateStyle: "long", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(now) + " WIB";
      const stamp = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
        .format(now).replace(", ", "_").replace(":", "");
      const meta = { createdAt, email };
      const base = `Backup-Masjid-Baitul-Fadli-${stamp}`;
      if (format === "xlsx") saveBlob(toXlsx(dump, meta), `${base}.xlsx`);
      if (format === "sql") saveBlob(new Blob([toSql(dump, meta)], { type: "application/sql;charset=utf-8" }), `${base}.sql`);
      if (format === "json") saveBlob(new Blob([toJson(dump, meta)], { type: "application/json;charset=utf-8" }), `${base}.json`);
      const total = dump.reduce((sum, item) => sum + (item.error ? 0 : item.rows.length), 0);
      const skipped = dump.filter((item) => item.error).map((item) => item.label);
      setStatus(`Selesai: ${total.toLocaleString("id-ID")} baris dari ${dump.length - skipped.length} tabel.${skipped.length ? ` Dilewati: ${skipped.join(", ")}.` : ""}`);
      const record = `${createdAt} · ${format.toUpperCase()}`;
      setLastBackup(record);
      try { localStorage.setItem(LAST_BACKUP_KEY, record); } catch { /* storage opsional */ }
    } catch (caught) {
      setStatus(`Backup gagal: ${caught instanceof Error ? caught.message : "periksa koneksi internet lalu coba lagi."}`);
    } finally {
      setBusy("");
    }
  }

  return <section className="setting-card wide backup-card">
    <span><Database /></span>
    <div>
      <small>PENYIMPANAN & BACKUP</small>
      <h3>Supabase · Unduh Backup Data</h3>
      <p>Seluruh data tersimpan di database Supabase. Unduh salinan lengkap (keuangan, jamaah, donatur, pembayaran, kegiatan, pengaturan) untuk arsip bendahara atau pemulihan. Disarankan minimal sebulan sekali dan disimpan di Google Drive masjid.</p>
      <div className="backup-actions">
        <button type="button" onClick={() => void download("xlsx")} disabled={!!busy}><FileSpreadsheet /><span><strong>Excel</strong><small>.xlsx · satu sheet per tabel</small></span>{busy === "xlsx" ? <em>…</em> : <Download />}</button>
        <button type="button" onClick={() => void download("sql")} disabled={!!busy}><FileCode2 /><span><strong>SQL</strong><small>.sql · siap dipulihkan ke Supabase</small></span>{busy === "sql" ? <em>…</em> : <Download />}</button>
        <button type="button" onClick={() => void download("json")} disabled={!!busy}><FileJson /><span><strong>JSON</strong><small>.json · arsip teknis lengkap</small></span>{busy === "json" ? <em>…</em> : <Download />}</button>
      </div>
      {status && <p className="import-result backup-status" role="status">{status}</p>}
      {lastBackup && <p className="backup-last">Backup terakhir di perangkat ini: {lastBackup}</p>}
      <p className="backup-note">File berisi data pribadi jamaah dan donatur. Simpan di tempat aman dan jangan dibagikan di grup umum.</p>
    </div>
  </section>;
}
