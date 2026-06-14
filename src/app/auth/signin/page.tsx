"use client";

import React, { useState, Suspense } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/frontend/components/ui/button";

function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/dashboard";

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");

    try {
      const res = await signIn("credentials", {
        redirect: false,
        name,
        email,
        phone,
        callbackUrl,
      });

      if (res?.error) {
        setError("Invalid credentials. Please try again.");
      } else {
        router.push(callbackUrl);
      }
    } catch {
      setError("An unexpected error occurred.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">Name</label>
        <input
          id="name"
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all shadow-sm"
          placeholder="Jane Doe"
        />
      </div>
      
      <div>
        <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">Email</label>
        <input
          id="email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all shadow-sm"
          placeholder="jane@example.com"
        />
      </div>

      <div>
        <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-1">Phone (Optional)</label>
        <input
          id="phone"
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all shadow-sm"
          placeholder="(555) 000-0000"
        />
      </div>

      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
          <p className="text-sm text-red-400 text-center">{error}</p>
        </div>
      )}

      <Button 
        type="submit" 
        disabled={isLoading}
        className="w-full py-6 mt-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl font-medium transition-colors disabled:opacity-50 text-base"
      >
        {isLoading ? "Entering Portal..." : "Enter Portal"}
      </Button>
    </form>
  );
}

export default function SignInPage() {
  return (
    <div className="relative min-h-screen bg-white flex items-center justify-center overflow-hidden font-sans z-0">
      <style>{`
        @keyframes drift-1 {
          from { background-position: 0 0; }
          to { background-position: 200px -200px; }
        }
        @keyframes drift-2 {
          from { background-position: 0 0; }
          to { background-position: -300px 300px; }
        }
        .bg-houses-1 {
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 24 24' fill='none' stroke='%2310b981' stroke-width='0.4' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'/%3E%3Cpolyline points='9 22 9 12 15 12 15 22'/%3E%3C/svg%3E");
          background-size: 200px 200px;
          animation: drift-1 50s linear infinite;
        }
        .bg-houses-2 {
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40' viewBox='0 0 24 24' fill='%2310b981' opacity='0.15' stroke='none'%3E%3Cpath d='m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'/%3E%3C/svg%3E");
          background-size: 300px 300px;
          animation: drift-2 70s linear infinite;
        }
      `}</style>
      
      <title>Client Portal — Landseed</title>
      
      {/* Background Layers */}
      <div className="fixed inset-0 -z-10 bg-houses-1 opacity-20 pointer-events-none" />
      <div className="fixed inset-0 -z-10 bg-houses-2 opacity-50 pointer-events-none" />
      
      <div className="relative z-10 w-full max-w-md mx-4 p-8 bg-white/90 backdrop-blur-md border border-gray-200/60 rounded-3xl shadow-xl">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-extrabold tracking-tight text-gray-900">Client Portal</h1>
          <p className="text-sm text-gray-500 mt-2">Enter your details to access your projects</p>
        </div>

        <Suspense fallback={<div className="h-[300px] flex items-center justify-center"><div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" /></div>}>
          <SignInForm />
        </Suspense>
      </div>
    </div>
  );
}
