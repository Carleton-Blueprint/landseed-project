"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function Navigation() {
  const pathname = usePathname();

  const navLinks = [
    { href: "/dashboard", label: "My Projects" },
    { href: "/", label: "Request Assessment" },
    { href: "/submitted", label: "Submitted" },
    { href: "/profile/access", label: "Caregivers" },
    { href: "/admin", label: "Advisor Panel" },
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-gray-100 bg-white/95 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-white/80">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        
        {/* Brand Logo */}
        <Link href="/dashboard" className="flex items-center gap-2 group">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600 text-white shadow-md transition-all duration-200 group-hover:scale-105 group-hover:bg-emerald-700">
            <svg className="h-4.5 w-4.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 12 8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75" />
            </svg>
          </div>
          <span className="text-base font-extrabold text-slate-800 transition-colors duration-200 group-hover:text-emerald-700">
            LandSeed <span className="text-emerald-600">Demo</span>
          </span>
        </Link>

        {/* Global Navigation */}
        <nav
          className="flex flex-wrap items-center justify-end gap-2"
          aria-label="Global navigation"
        >
          {navLinks.map((link) => {
            const isActive = pathname === link.href;

            return (
              <Link
                key={link.href}
                href={link.href}
                className={`rounded-lg border px-3.5 py-1.5 text-xs font-semibold tracking-wide transition-all duration-200 active:scale-95 ${
                  isActive
                    ? "border-emerald-500 bg-emerald-50 text-emerald-800 shadow-sm"
                    : "border-gray-200 bg-white text-gray-600 hover:border-emerald-300 hover:bg-emerald-50/30 hover:text-emerald-700"
                }`}
              >
                {link.label}
              </Link>
            );
          })}

          {/* Elegant Profile Link */}
          <div className="h-6 w-[1px] bg-gray-200 mx-1 hidden sm:block" />
          
          <Link
            href="/profile"
            className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-white shadow-md transition-all duration-200 active:scale-90 ${
              pathname === "/profile"
                ? "bg-emerald-600 ring-2 ring-emerald-400"
                : "bg-slate-700 hover:bg-emerald-600 hover:scale-105"
            }`}
            title="My Profile"
          >
            DU
          </Link>
        </nav>
        
      </div>
    </header>
  );
}
