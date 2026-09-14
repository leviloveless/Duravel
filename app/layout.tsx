import type { Metadata } from "next";
import { Archivo, IBM_Plex_Mono, Saira_Condensed } from "next/font/google";
import "./globals.css";
import NavBar from "@/components/nav-bar";
import SiteFooter from "@/components/site-footer";
import TimezoneSync from "@/components/timezone-sync";

/**
 * Three faces, each with a job (2026-09-13).
 *
 * `mono` is not a stylistic choice — every number this app shows an athlete is a
 * split, a pace, a distance or a load, and those belong in tabular figures so a
 * column of them lines up and a changing clock does not make the layout jump.
 */
const archivo = Archivo({ subsets: ["latin"], variable: "--font-archivo", display: "swap" });
const saira = Saira_Condensed({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-saira",
  display: "swap",
});
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Duravel",
  description: "AI-powered HYROX training program generator.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`h-full antialiased ${archivo.variable} ${saira.variable} ${plexMono.variable}`}
    >
      <body className="flex min-h-full flex-col font-sans">
        <NavBar />
        <TimezoneSync />
        <div className="flex-1">{children}</div>
        <SiteFooter />
      </body>
    </html>
  );
}
