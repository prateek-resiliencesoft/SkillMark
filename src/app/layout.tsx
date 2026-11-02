import { Providers } from "@/components/providers";
import { Toaster } from "@/components/ui/toaster";
import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

/** Self-hosted — no Google Fonts fetch at build (CI/Docker safe). */
const inter = localFont({
  src: "../fonts/inter-latin-wght-normal.woff2",
  weight: "100 900",
  display: "swap",
  variable: "--font-inter",
  fallback: [
    "-apple-system",
    "BlinkMacSystemFont",
    "Segoe UI",
    "Roboto",
    "sans-serif",
  ],
});

const plusJakartaSans = localFont({
  src: "../fonts/plus-jakarta-sans-latin-wght-normal.woff2",
  weight: "200 800",
  display: "swap",
  variable: "--font-heading",
  fallback: [
    "-apple-system",
    "BlinkMacSystemFont",
    "Segoe UI",
    "sans-serif",
  ],
});

const ibmPlexSansCondensed = localFont({
  src: [
    {
      path: "../fonts/ibm-plex-sans-condensed-latin-400-normal.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../fonts/ibm-plex-sans-condensed-latin-500-normal.woff2",
      weight: "500",
      style: "normal",
    },
    {
      path: "../fonts/ibm-plex-sans-condensed-latin-600-normal.woff2",
      weight: "600",
      style: "normal",
    },
    {
      path: "../fonts/ibm-plex-sans-condensed-latin-700-normal.woff2",
      weight: "700",
      style: "normal",
    },
  ],
  display: "swap",
  variable: "--font-ibm-plex",
  fallback: [
    "system-ui",
    "-apple-system",
    "BlinkMacSystemFont",
    "Segoe UI",
    "sans-serif",
  ],
});

const siteUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://aural-ai.com";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Skillmark — Measure what matters",
    template: "%s | Skillmark",
  },
  description:
    "Skillmark — Measure what matters. The open-source AI interview platform for structured voice, chat, and video interviews. Automate candidate screening, get real-time insights, and scale your interview process.",
  keywords: [
    "AI interview platform",
    "voice interview",
    "AI interviews",
    "interview platform",
    "structured interviews",
    "voice interviews",
    "video interviews",
    "AI voice interview",
    "automated interviews",
    "interview automation",
    "candidate assessment",
    "interview analytics",
  ],
  alternates: {
    canonical: siteUrl,
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    siteName: "Skillmark",
    title: "Skillmark - AI Interview Platform | Voice & Video Interviews",
    description:
      "Skillmark is the AI interview platform for structured voice, chat, and video interviews. Automate candidate screening, get real-time insights, and scale your interview process.",
    url: siteUrl,
    images: [
      {
        url: `${siteUrl}/images/marketing/hero-screenshots.webp`,
        width: 1920,
        height: 960,
        alt: "Skillmark AI Interview Platform",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Skillmark - AI Interview Platform | Voice & Video Interviews",
    description:
      "Skillmark is the AI interview platform for structured voice, chat, and video interviews. Automate candidate screening, get real-time insights, and scale your interview process.",
    images: [`${siteUrl}/images/marketing/hero-screenshots.webp`],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${plusJakartaSans.variable} ${ibmPlexSansCondensed.variable}`}
    >
      <body className="min-h-screen bg-background text-foreground font-sans antialiased">
        <Providers>
          {children}
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
