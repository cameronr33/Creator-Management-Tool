import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

// Inter is the typeface on sentic.io; self-hosted by next/font, no runtime requests.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Creator Manager · Sentic",
    template: "%s · Creator Manager",
  },
  description: "Sentic's creator relationship tool — conversations, deals, shipping and posted videos in one place.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
