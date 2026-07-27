import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Now / Next / Later",
  description: "Daily brief task list",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
