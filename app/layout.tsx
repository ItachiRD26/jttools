// LOCATION: app/layout.tsx
import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

const geistSans = localFont({
  src: "../node_modules/geist/dist/fonts/geist-sans/Geist-Variable.woff2",
  variable: "--font-geist-sans",
  display: "swap",
});

const geistMono = localFont({
  src: "../node_modules/geist/dist/fonts/geist-mono/GeistMono-Variable.woff2",
  variable: "--font-geist-mono",
  display: "swap",
});

export const viewport: Viewport = {
  themeColor: "#7F77DD",
};

export const metadata: Metadata = {
  metadataBase: new URL("https://jeterdev.tools"),
  title: {
    default: "JeterDev Tools — Etsy API Bridge",
    template: "%s | JeterDev Tools",
  },
  description: "Access the Etsy API v3 with a single API key. Rate limiting, plans, and authentication included.",
  keywords: ["Etsy API", "API Bridge", "Etsy listings", "JeterDev Tools", "Etsy developer"],
  authors: [{ name: "JeterDev" }],
  openGraph: {
    title: "JeterDev Tools — Etsy API Bridge",
    description: "Access the Etsy API v3 with a single API key.",
    url: "https://jeterdev.tools",
    siteName: "JeterDev Tools",
    locale: "en_US",
    type: "website",
    images: [{ url: "/logo.webp", width: 512, height: 512, alt: "JeterDev Tools" }],
  },
  twitter: {
    card: "summary",
    title: "JeterDev Tools — Etsy API Bridge",
    description: "Access the Etsy API v3 with a single API key.",
    images: ["/logo.webp"],
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <head>
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="icon" href="/logo.webp" type="image/webp" />
        <link rel="apple-touch-icon" href="/logo.webp" />
      </head>
      <body className="antialiased" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}