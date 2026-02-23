import type { Metadata } from "next";
import Image from "next/image";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Cal-Pacific Golf Classic",
  description: "Cal-Pacific Golf Classic scoring",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <div className="fixed top-3 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
          <Image
            src="/calp-logo.svg"
            alt="Cal-Pacific Golf Classic 38"
            width={140}
            height={140}
            priority
          />
        </div>
        {children}
      </body>
    </html>
  );
}
