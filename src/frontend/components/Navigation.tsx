"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { House, LogOut } from "lucide-react";

export function Navigation() {
  const pathname = usePathname();
  const { data: session } = useSession();

  const isAuthenticated = !!session?.user;
  const isAdmin = session?.user?.role === "ADMIN";

  if (!isAuthenticated) return null;

  const navLinks = [
    { href: "/dashboard", label: "My Projects" },
    ...(isAdmin ? [{ href: "/admin", label: "Advisor Panel" }] : []),
  ];

  const initials = session?.user?.name
    ? session.user.name
        .split(" ")
        .map((n: string) => n[0])
        .join("")
        .slice(0, 2)
        .toUpperCase()
    : session?.user?.email?.[0]?.toUpperCase() ?? "?";

  return (
    <header className="sticky top-0 z-40 border-b border-gray-100 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/85 shadow-sm">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link
          href="/dashboard"
          className="flex items-center gap-2 group"
          aria-label="LandSeed home"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-sm transition-transform duration-200 group-hover:scale-105">
            <House className="h-4 w-4" />
          </div>
          <span className="text-sm font-bold text-slate-800 transition-colors group-hover:text-emerald-700">
            LandSeed
          </span>
        </Link>

        <nav className="flex items-center gap-1" aria-label="Main navigation">
          {navLinks.map((link) => {
            const isActive = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all duration-150 ${
                  isActive
                    ? "bg-emerald-50 text-emerald-700"
                    : "text-gray-500 hover:bg-gray-50 hover:text-gray-800"
                }`}
              >
                {link.label}
              </Link>
            );
          })}

          <div className="mx-2 h-5 w-px bg-gray-200" aria-hidden />

          <div className="flex items-center gap-2">
            <Link
              href="/profile"
              className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-white shadow transition-all duration-150 ${
                pathname === "/profile"
                  ? "bg-emerald-600 ring-2 ring-emerald-300"
                  : "bg-slate-700 hover:bg-emerald-600 hover:scale-105"
              }`}
              title="My Profile"
              aria-label="My Profile"
            >
              {initials}
            </Link>
            <button
              onClick={() => signOut({ callbackUrl: "/" })}
              className="flex h-8 w-8 items-center justify-center rounded-full text-gray-400 transition-all duration-150 hover:bg-red-50 hover:text-red-500"
              title="Sign out"
              aria-label="Sign out"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        </nav>
      </div>
    </header>
  );
}
