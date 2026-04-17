import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const siteUrl = "https://teddox.com";

const geist = localFont({
  src: [
    {
      path: "../public/fonts/geist-latin.woff2",
      weight: "100 900",
      style: "normal",
    },
    {
      path: "../public/fonts/geist-latin-ext.woff2",
      weight: "100 900",
      style: "normal",
    },
  ],
  display: "swap",
  variable: "--font-geist",
});

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Teddox | Collaborative Docs and Whiteboards for Product Teams",
    template: "%s | Teddox",
  },
  description:
    "Teddox is a collaborative workspace for product teams to organize docs, whiteboards, and shared knowledge in one searchable place.",
  keywords: [
    "collaborative docs",
    "team knowledge base",
    "product documentation",
    "whiteboard collaboration",
    "workspace for teams",
    "document collaboration",
  ],
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    url: siteUrl,
    title: "Teddox | Collaborative Docs and Whiteboards for Product Teams",
    description:
      "Bring docs, whiteboards, and team knowledge together in one collaborative workspace.",
    siteName: "Teddox",
    images: [
      {
        url: "/hero-home-screen.png",
        width: 2192,
        height: 1232,
        alt: "Teddox landing page hero product screen",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Teddox | Collaborative Docs and Whiteboards for Product Teams",
    description:
      "Bring docs, whiteboards, and team knowledge together in one collaborative workspace.",
    images: ["/hero-home-screen.png"],
  },
  category: "technology",
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={geist.variable}>{children}</body>
    </html>
  );
}
