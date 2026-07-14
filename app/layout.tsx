import type { Metadata, Viewport } from "next";
import "./globals.css";
import NavBar from "@/components/nav-bar";

export const metadata: Metadata = {
  title: "HyroxAI",
  description: "AI-powered HYROX training program generator.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "HyroxAI" },
};

// viewport-fit=cover + theme color so the app renders edge-to-edge and clears the
// notch / home indicator when installed as a PWA or wrapped with Capacitor
// (App Store plan §2.1). Safe-area padding is applied in globals.css.
export const viewport: Viewport = {
  themeColor: "#0a0a0a",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col font-sans">
        <NavBar />
        <div className="flex-1">{children}</div>
      </body>
    </html>
  );
}
