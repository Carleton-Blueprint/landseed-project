"use client";

import React, { useState, Suspense } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { IntakePageContent } from "@/frontend/components/IntakePageContent";
import Link from "next/link";
import { Input } from "@/frontend/components/ui/input";
import { Button } from "@/frontend/components/ui/button";
import {
  Mail,
  Lock,
  Eye,
  EyeOff,
  ArrowRight,
  AlertCircle,
  CheckCircle2,
  House,
} from "lucide-react";

const BG_STYLES = `
  @keyframes drift-slow {
    from { transform: translate(0, 0) rotate(0deg); }
    to   { transform: translate(40px, -40px) rotate(8deg); }
  }
  @keyframes drift-slower {
    from { transform: translate(0, 0) rotate(0deg); }
    to   { transform: translate(-60px, 60px) rotate(-10deg); }
  }
  @keyframes fade-up {
    from { opacity: 0; transform: translateY(24px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .anim-fade-up   { animation: fade-up 0.55s cubic-bezier(.22,1,.36,1) both; }
  .anim-fade-up-1 { animation: fade-up 0.55s 0.08s cubic-bezier(.22,1,.36,1) both; }
  .anim-fade-up-2 { animation: fade-up 0.55s 0.16s cubic-bezier(.22,1,.36,1) both; }
  .anim-fade-up-3 { animation: fade-up 0.55s 0.24s cubic-bezier(.22,1,.36,1) both; }
`;

function SignInFormInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/dashboard";
  const resetSuccess = searchParams.get("reset") === "success";
  const messageParam = searchParams.get("message");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");
    try {
      const res = await signIn("credentials", {
        redirect: false,
        email,
        password,
        callbackUrl,
      });
      if (res?.error) {
        setError("Incorrect email or password. Please try again.");
      } else {
        router.push(callbackUrl);
      }
    } catch {
      setError("Connection error. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      {(resetSuccess || messageParam) && (
        <div className="flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 anim-fade-up">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
          <span className="font-medium">
            {messageParam || "Password reset — please sign in."}
          </span>
        </div>
      )}

      <div>
        <label
          htmlFor="home-email"
          className="mb-1.5 block text-sm font-medium text-gray-600"
        >
          Email
        </label>
        <div className="relative">
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-gray-400">
            <Mail className="h-4 w-4" />
          </span>
          <Input
            id="home-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="dev-user@example.com"
            required
            className="h-11 pl-10 pr-4 text-base rounded-xl border-gray-200 bg-white/80 transition-all focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/20"
          />
        </div>
      </div>

      <div>
        <label
          htmlFor="home-password"
          className="mb-1.5 block text-sm font-medium text-gray-600"
        >
          Password
        </label>
        <div className="relative">
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-gray-400">
            <Lock className="h-4 w-4" />
          </span>
          <Input
            id="home-password"
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            required
            className="h-11 pl-10 pr-11 text-base rounded-xl border-gray-200 bg-white/80 transition-all focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/20"
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute inset-y-0 right-3 flex items-center text-gray-400 hover:text-gray-600 focus:outline-none"
            aria-label={showPassword ? "Hide password" : "Show password"}
          >
            {showPassword ? (
              <EyeOff className="h-4 w-4" />
            ) : (
              <Eye className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="flex items-center gap-2.5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 anim-fade-up"
        >
          <AlertCircle className="h-4 w-4 shrink-0 text-red-500" />
          <span className="font-medium">{error}</span>
        </div>
      )}

      <Button
        type="submit"
        disabled={isLoading}
        className="h-11 w-full rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-base font-semibold text-white shadow-md shadow-emerald-600/25 transition-all duration-200 hover:from-emerald-700 hover:to-teal-700 hover:shadow-lg hover:shadow-emerald-600/30 active:scale-[0.99] disabled:opacity-60 flex items-center justify-center gap-2"
      >
        {isLoading ? (
          <>
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
            <span>Signing in…</span>
          </>
        ) : (
          <>
            <span>Sign In</span>
            <ArrowRight className="h-4 w-4" />
          </>
        )}
      </Button>
    </form>
  );
}

function HomePageInner() {
  const { data: session, status } = useSession();

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" />
      </div>
    );
  }

  if (status === "authenticated") {
    return (
      <div className="mx-auto max-w-5xl px-6 py-8 md:px-8">
        <IntakePageContent />
      </div>
    );
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-slate-50 via-white to-emerald-50/40 px-4">
      <style>{BG_STYLES}</style>

      <div
        aria-hidden
        className="pointer-events-none fixed -top-24 -right-24 h-96 w-96 rounded-full bg-emerald-100/50 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none fixed -bottom-24 -left-24 h-80 w-80 rounded-full bg-teal-100/40 blur-3xl"
      />

      <div className="relative z-10 w-full max-w-sm space-y-8">
        <div className="anim-fade-up text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-600 shadow-lg shadow-emerald-200">
            <House className="h-6 w-6 text-white" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">
            LandSeed
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Your home adaptation portal
          </p>
        </div>

        <div className="anim-fade-up-1 rounded-2xl border border-gray-100 bg-white/90 p-7 shadow-xl shadow-gray-100/60 backdrop-blur-sm">
          <h2 className="mb-5 text-base font-semibold text-gray-800">
            Sign in to your account
          </h2>

          <Suspense
            fallback={
              <div className="flex justify-center py-8">
                <span className="h-6 w-6 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" />
              </div>
            }
          >
            <SignInFormInner />
          </Suspense>
        </div>

        <p className="anim-fade-up-2 text-center text-sm text-gray-500">
          Don&apos;t have an account?{" "}
          <Link
            href="/auth/signup"
            className="font-semibold text-emerald-600 transition-colors hover:text-emerald-700 hover:underline"
          >
            Create an account
          </Link>
        </p>
      </div>
    </div>
  );
}

export function HomePageContent() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" />
        </div>
      }
    >
      <HomePageInner />
    </Suspense>
  );
}
