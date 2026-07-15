/**
 * Root layout: wraps every page with HTML shell, fonts, and client providers (React Query + NextAuth).
 * Metadata here applies to the whole app unless overridden by a page.
 */
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Providers } from "@/frontend/providers/Providers";
import { Navigation } from "@/frontend/components/Navigation";
import "@/app/globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Landseed Project",
  description: "Digital intake and project management",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased`}
      >
        <Providers>
          {/* Navigation hides itself when the user is unauthenticated */}
          <Navigation />
          {children}
        </Providers>
      </body>
    </html>
  );
}

