import type { Metadata } from "next";
import { Instrument_Serif, Geist_Mono } from "next/font/google";
import "./globals.css";

const instrumentSerif = Instrument_Serif({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400"],
  style: ["normal", "italic"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Howdy: Hire Vetted Freelancers, Fast",
  description:
    "Need a designer, developer, editor, or specialist? Howdy finds them, vets them, and makes the intro.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${instrumentSerif.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
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
