import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const geist = localFont({
  src: "./fonts/Geist.woff2",
  variable: "--font-geist",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Masjid Baitul Fadli | Pusat Layanan Jamaah",
  description: "Informasi keuangan, kegiatan jamaah, dan program donasi Masjid Baitul Fadli.",
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
    <html lang="id" className={geist.variable}>
      <body className="antialiased">{children}</body>
    </html>
  );
}
