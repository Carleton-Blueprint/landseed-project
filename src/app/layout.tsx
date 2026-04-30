/**
 * Root layout: wraps every page with HTML shell, fonts, and client providers (React Query + NextAuth).
 * Metadata here applies to the whole app unless overridden by a page.
 */
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { Providers } from "@/frontend/providers/Providers";
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
  const navLinks = [
    { href: "/dashboard", label: "Dashboard" },
    { href: "/", label: "Intake" },
    { href: "/submitted", label: "Submitted" },
    { href: "/admin", label: "Admin" },
  ];

  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased`}
      >
        <Providers>
          <div className="min-h-screen bg-background">
            <header className="sticky top-0 z-40 border-b bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
              <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
                <div className="text-sm font-semibold tracking-tight text-gray-900">
                  LandSeed Demo
                </div>
                <nav
                  className="flex flex-wrap items-center justify-end gap-2"
                  aria-label="Global navigation"
                >
                  {navLinks.map((link) => (
                    <Link
                      key={link.href}
                      href={link.href}
                      className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
                    >
                      {link.label}
                    </Link>
                  ))}
                </nav>
              </div>
            </header>
            {children}
          </div>
        </Providers>
      </body>
    </html>
  );
}
