import PigeonSchema from "./pigeon-schema";
import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";

const ppMondwest = localFont({
  src: "../../public/PPMondwest-Regular.ttf",
  variable: "--font-mondwest",
  display: "swap",
  weight: "400",
  style: "normal",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Howdy: Hire Vetted Creative Freelancers, Fast",
  description:
    "Need a brand designer, video editor, motion artist, or illustrator? Howdy finds them, vets them, and makes the intro.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${ppMondwest.variable} ${geistMono.variable} ${inter.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <PigeonSchema />
        <div
          aria-hidden
          className="pointer-events-none fixed inset-0 -z-20 bg-cover bg-center bg-no-repeat"
          style={{
            backgroundImage: "url('/bg.jpg')",
            filter: "blur(6px)",
            transform: "scale(1.03)",
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none fixed inset-0 -z-10 bg-black/20"
        />
        {children}
      </body>
    </html>
  );
}
