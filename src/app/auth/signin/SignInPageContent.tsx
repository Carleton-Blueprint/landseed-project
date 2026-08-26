"use client";

import React, { useState, Suspense } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthSubmitButton } from "@/frontend/components/auth/AuthSubmitButton";
import { AuthPageShell } from "@/frontend/components/auth/AuthPageShell";
import { SignInVerificationAlert } from "@/frontend/components/auth/SignInVerificationAlert";
import { AuthSwitchLink } from "@/frontend/components/auth/AuthSwitchLink";

function PasswordSignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/dashboard";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [mfaRequired, setMfaRequired] = useState(false);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const attemptSignIn = async (extra: { mfaCode?: string }) => {
    const res = await signIn("credentials", {
      redirect: false,
      email,
      password,
      callbackUrl,
      ...extra,
    });

    if (!res?.error) {
      router.push(callbackUrl);
      return;
    }

    switch (res.code) {
      case "mfa_required":
        setMfaRequired(true);
        setError("");
        break;
      case "mfa_invalid_code":
        setError("Invalid verification code. Please try again.");
        break;
      case "mfa_locked":
        setError("Too many failed verification attempts. Try again in a few minutes.");
        setMfaRequired(false);
        break;
      case "rate_limited":
        setError("Too many sign-in attempts. Please wait a few minutes and try again.");
        setMfaRequired(false);
        break;
      default:
        setError("Invalid credentials. Please try again.");
        setMfaRequired(false);
    }
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");
    try {
      await attemptSignIn({});
    } catch {
      setError("An unexpected error occurred.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleMfaSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");
    try {
      await attemptSignIn({ mfaCode });
    } catch {
      setError("An unexpected error occurred.");
    } finally {
      setIsLoading(false);
    }
  };

  if (mfaRequired) {
    return (
      <form onSubmit={handleMfaSubmit} className="space-y-5">
        <div>
          <label htmlFor="mfaCode" className="block text-sm font-medium text-gray-700 mb-1">
            Enter the 6-digit code from your authenticator app
          </label>
          <input
            id="mfaCode"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            autoFocus
            value={mfaCode}
            onChange={(e) => setMfaCode(e.target.value)}
            className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all shadow-sm"
            placeholder="123456"
          />
        </div>

        {error && (
          <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
            <p className="text-sm text-red-400 text-center">{error}</p>
          </div>
        )}

        <AuthSubmitButton disabled={isLoading || !mfaCode.trim()}>
          {isLoading ? "Verifying..." : "Verify"}
        </AuthSubmitButton>

        <button
          type="button"
          onClick={() => {
            setMfaRequired(false);
            setMfaCode("");
            setError("");
          }}
          className="w-full text-center text-sm text-gray-500 hover:underline"
        >
          Back
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={handlePasswordSubmit} className="space-y-5">
      <div>
        <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">Email</label>
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all shadow-sm"
          placeholder="you@example.com"
        />
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between gap-3">
          <label htmlFor="password" className="block text-sm font-medium text-gray-700">
            Password
          </label>
          <Link
            href="/auth/forgot-password"
            className="text-sm font-medium text-emerald-700 hover:underline"
          >
            Forgot password?
          </Link>
        </div>
        <input
          id="password"
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all shadow-sm"
          placeholder="Your password"
        />
      </div>

      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
          <p className="text-sm text-red-400 text-center">{error}</p>
        </div>
      )}

      <AuthSubmitButton disabled={isLoading}>
        {isLoading ? "Signing in..." : "Sign In"}
      </AuthSubmitButton>
    </form>
  );
}

function LegacySignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/dashboard";

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
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
          placeholder="Full name"
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
          placeholder="you@example.com"
        />
      </div>

      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
          <p className="text-sm text-red-400 text-center">{error}</p>
        </div>
      )}

      <AuthSubmitButton disabled={isLoading}>
        {isLoading ? "Signing in..." : "Sign in"}
      </AuthSubmitButton>
    </form>
  );
}

function SignInForm({ legacyMode }: { legacyMode: boolean }) {
  return legacyMode ? <LegacySignInForm /> : <PasswordSignInForm />;
}

export function SignInPageContent({ legacyMode }: { legacyMode: boolean }) {
  return (
    <AuthPageShell title="Client Portal">
      <Suspense
        fallback={
          <div className="h-[300px] flex items-center justify-center">
            <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          </div>
        }
      >
        <SignInVerificationAlert />
        <SignInForm legacyMode={legacyMode} />

        <AuthSwitchLink prompt="Don't have an account?" href="/auth/signup" label="Sign up" />
      </Suspense>
    </AuthPageShell>
  );
}
