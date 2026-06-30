import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PANDO — Private Equity Intelligence",
  description: "AI-powered deal sourcing and portfolio intelligence",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
