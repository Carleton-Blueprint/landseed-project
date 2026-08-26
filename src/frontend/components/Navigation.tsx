"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";

function getInitials(name?: string | null, email?: string | null): string {
  const trimmedName = name?.trim();
  if (trimmedName) {
    const parts = trimmedName.split(/\s+/);
    const initials = parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0];
    return initials.toUpperCase();
  }
  const trimmedEmail = email?.trim();
  if (trimmedEmail) return trimmedEmail.slice(0, 2).toUpperCase();
  return "?";
}

export function Navigation() {
  const pathname = usePathname();
  const { data: session } = useSession();

  const isAuthenticated = !!session?.user;
  const isAdmin = session?.user?.role === "ADMIN";

  const navLinks = isAuthenticated
    ? [
        { href: "/dashboard", label: "Project Tracker" },
        ...(isAdmin ? [{ href: "/admin", label: "Advisor Panel" }] : []),
      ]
    : [];

  return (
    <header className="sticky top-0 z-40 border-b border-gray-100 bg-white/95 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-white/80">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        
        {/* Brand Logo */}
        <Link href={isAuthenticated ? "/dashboard" : "/"} className="flex items-center gap-2 group">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600 text-white shadow-md transition-all duration-200 group-hover:scale-105 group-hover:bg-emerald-700">
            <svg className="h-4.5 w-4.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 12 8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75" />
            </svg>
          </div>
          <span className="text-base font-extrabold text-slate-800 transition-colors duration-200 group-hover:text-emerald-700">
            LandSeed
          </span>
        </Link>

        {/* Global Navigation */}
        <nav
          className="flex flex-wrap items-center justify-end gap-2"
          aria-label="Global navigation"
        >
          {navLinks.map((link) => {
            const isActive = pathname === link.href;
            const linkClassName = `rounded-lg border px-3.5 py-1.5 text-xs font-semibold tracking-wide transition-all duration-200 active:scale-95 ${
              isActive
                ? "border-emerald-500 bg-emerald-50 text-emerald-800 shadow-sm"
                : "border-gray-200 bg-white text-gray-600 hover:border-emerald-300 hover:bg-emerald-50/30 hover:text-emerald-700"
            }`;

            // Plain <a> (hard navigation) instead of <Link>: /admin's layout is
            // fully dynamic (headers() + a DB call) and redirects unenrolled
            // admins to /admin/mfa-setup. Reaching it via Next's client-side
            // router triggers a request-storm loop against that redirect; a
            // full page load bypasses the client router entirely and avoids it.
            if (link.href === "/admin") {
              return (
                <a key={link.href} href={link.href} className={linkClassName}>
                  {link.label}
                </a>
              );
            }

            return (
              <Link key={link.href} href={link.href} className={linkClassName}>
                {link.label}
              </Link>
            );
          })}

          {/* Account access */}
          <div className="h-6 w-[1px] bg-gray-200 mx-1 hidden sm:block" />
          <Link
            href={isAuthenticated ? "/profile" : "/auth/signin"}
            className={`flex h-11 w-11 items-center justify-center rounded-full text-xs font-bold text-white shadow-md transition-all duration-200 active:scale-90 ${
              pathname === "/profile"
                ? "bg-emerald-600 ring-2 ring-emerald-400"
                : "bg-slate-700 hover:bg-emerald-600 hover:scale-105"
            }`}
            title={isAuthenticated ? "My Profile" : "Sign in"}
          >
            {isAuthenticated ? (
              getInitials(session?.user?.name, session?.user?.email)
            ) : (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
              </svg>
            )}
          </Link>
        </nav>
        
      </div>
    </header>
  );
}
