import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Masjid Baitul Fadi | Pusat Layanan Jamaah",
  description: "Informasi keuangan, kegiatan jamaah, dan program donasi Masjid Baitul Fadi.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id">
      <body className="antialiased">{children}</body>
    </html>
  );
}
