"use client";

import React, { useState, Suspense } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/frontend/components/ui/button";
import { Input } from "@/frontend/components/ui/input";
import { AuthPageShell } from "@/frontend/components/auth/AuthPageShell";
import { SignInVerificationAlert } from "@/frontend/components/auth/SignInVerificationAlert";
import { 
  Lock, 
  Mail, 
  Eye, 
  EyeOff, 
  ShieldCheck, 
  User, 
  Phone, 
  ArrowRight, 
  AlertCircle,
  CheckCircle2
} from "lucide-react";

function PasswordSignInForm() {
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
        setError("Invalid email or password. Please check your credentials and try again.");
      } else {
        router.push(callbackUrl);
      }
    } catch {
      setError("An unexpected connection error occurred. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Reassurance Badge */}
      <div className="flex items-center justify-center gap-2 rounded-xl bg-emerald-50/90 border border-emerald-200/80 p-3 text-xs font-medium text-emerald-800 shadow-2xs">
        <ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0" />
        <span>256-Bit Encrypted Portal — Senior & Caregiver Protected</span>
      </div>

      {/* Password Reset Confirmation Message */}
      {(resetSuccess || messageParam) && (
        <div className="flex items-center gap-2.5 p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-sm animate-in fade-in-50 duration-200 shadow-2xs">
          <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
          <p className="font-semibold">
            {messageParam || "Your password has been reset successfully! Please sign in with your new password."}
          </p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="email" className="block text-sm font-semibold text-gray-700 mb-1.5">
            Email Address
          </label>
          <div className="relative">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-gray-400">
              <Mail className="h-4 w-4" />
            </div>
            <Input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="pl-10 h-11 rounded-xl border-gray-200 bg-white/80 text-gray-900 placeholder-gray-400 focus-visible:ring-emerald-500 focus-visible:border-emerald-500 shadow-2xs transition-all text-base sm:text-sm"
              placeholder="jane@example.com"
            />
          </div>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between gap-3">
            <label htmlFor="password" className="block text-sm font-semibold text-gray-700">
              Password
            </label>
            <Link
              href="/auth/forgot-password"
              className="text-xs sm:text-sm font-semibold text-emerald-600 hover:text-emerald-700 hover:underline transition-colors"
            >
              Forgot password?
            </Link>
          </div>
          <div className="relative">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-gray-400">
              <Lock className="h-4 w-4" />
            </div>
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="pl-10 pr-11 h-11 rounded-xl border-gray-200 bg-white/80 text-gray-900 placeholder-gray-400 focus-visible:ring-emerald-500 focus-visible:border-emerald-500 shadow-2xs transition-all text-base sm:text-sm"
              placeholder="Enter your password"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute inset-y-0 right-0 flex items-center pr-3.5 text-gray-400 hover:text-gray-600 focus:outline-none focus:text-emerald-600 transition-colors"
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2.5 p-3.5 bg-red-50 border border-red-200/80 rounded-xl text-red-700 text-sm animate-in fade-in-50 duration-200">
            <AlertCircle className="h-5 w-5 text-red-500 shrink-0" />
            <p className="font-medium">{error}</p>
          </div>
        )}

        <Button
          type="submit"
          disabled={isLoading}
          className="w-full h-12 mt-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white rounded-xl font-semibold shadow-md hover:shadow-lg transition-all duration-200 disabled:opacity-50 text-base flex items-center justify-center gap-2"
        >
          {isLoading ? (
            <>
              <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              <span>Signing in...</span>
            </>
          ) : (
            <>
              <span>Sign In to Portal</span>
              <ArrowRight className="h-4 w-4" />
            </>
          )}
        </Button>
      </form>

      {/* Account Creation Link */}
      <div className="border-t border-gray-100 pt-5 text-center">
        <p className="text-sm text-gray-600">
          Don&apos;t have a LandSeed account yet?{" "}
          <Link
            href="/auth/signup"
            className="font-semibold text-emerald-600 hover:text-emerald-700 hover:underline transition-colors inline-flex items-center gap-1 ml-1"
          >
            Create an account
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </p>
      </div>
    </div>
  );
}

function LegacySignInForm() {
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
    <div className="space-y-6">
      <div className="flex items-center justify-center gap-2 rounded-xl bg-amber-50/90 border border-amber-200/80 p-3 text-xs font-medium text-amber-800 shadow-2xs">
        <ShieldCheck className="h-4 w-4 text-amber-600 shrink-0" />
        <span>Development Mode — Legacy Quick Access</span>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="name" className="block text-sm font-semibold text-gray-700 mb-1.5">
            Full Name
          </label>
          <div className="relative">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-gray-400">
              <User className="h-4 w-4" />
            </div>
            <Input
              id="name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="pl-10 h-11 rounded-xl border-gray-200 bg-white/80 text-gray-900 placeholder-gray-400 focus-visible:ring-emerald-500 focus-visible:border-emerald-500 shadow-2xs transition-all text-base sm:text-sm"
              placeholder="Jane Doe"
            />
          </div>
        </div>

        <div>
          <label htmlFor="email" className="block text-sm font-semibold text-gray-700 mb-1.5">
            Email Address
          </label>
          <div className="relative">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-gray-400">
              <Mail className="h-4 w-4" />
            </div>
            <Input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="pl-10 h-11 rounded-xl border-gray-200 bg-white/80 text-gray-900 placeholder-gray-400 focus-visible:ring-emerald-500 focus-visible:border-emerald-500 shadow-2xs transition-all text-base sm:text-sm"
              placeholder="jane@example.com"
            />
          </div>
        </div>

        <div>
          <label htmlFor="phone" className="block text-sm font-semibold text-gray-700 mb-1.5">
            Phone Number (Optional)
          </label>
          <div className="relative">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-gray-400">
              <Phone className="h-4 w-4" />
            </div>
            <Input
              id="phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="pl-10 h-11 rounded-xl border-gray-200 bg-white/80 text-gray-900 placeholder-gray-400 focus-visible:ring-emerald-500 focus-visible:border-emerald-500 shadow-2xs transition-all text-base sm:text-sm"
              placeholder="(555) 000-0000"
            />
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2.5 p-3.5 bg-red-50 border border-red-200/80 rounded-xl text-red-700 text-sm animate-in fade-in-50 duration-200">
            <AlertCircle className="h-5 w-5 text-red-500 shrink-0" />
            <p className="font-medium">{error}</p>
          </div>
        )}

        <Button
          type="submit"
          disabled={isLoading}
          className="w-full h-12 mt-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white rounded-xl font-semibold shadow-md hover:shadow-lg transition-all duration-200 disabled:opacity-50 text-base flex items-center justify-center gap-2"
        >
          {isLoading ? (
            <>
              <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              <span>Entering Portal...</span>
            </>
          ) : (
            <>
              <span>Enter Portal</span>
              <ArrowRight className="h-4 w-4" />
            </>
          )}
        </Button>
      </form>

      <div className="border-t border-gray-100 pt-5 text-center">
        <p className="text-sm text-gray-600">
          Don&apos;t have a LandSeed account yet?{" "}
          <Link
            href="/auth/signup"
            className="font-semibold text-emerald-600 hover:text-emerald-700 hover:underline transition-colors inline-flex items-center gap-1 ml-1"
          >
            Create an account
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </p>
      </div>
    </div>
  );
}

function SignInForm({ legacyMode }: { legacyMode: boolean }) {
  return legacyMode ? <LegacySignInForm /> : <PasswordSignInForm />;
}

export function SignInPageContent({ legacyMode }: { legacyMode: boolean }) {
  return (
    <AuthPageShell
      title="Client Portal"
      description={
        legacyMode
          ? "Enter your details to access your home adaptation projects"
          : "Sign in to access your LandSeed home adaptation projects"
      }
    >
      <Suspense
        fallback={
          <div className="h-[300px] flex items-center justify-center">
            <div className="w-8 h-8 border-3 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          </div>
        }
      >
        <SignInVerificationAlert />
        <SignInForm legacyMode={legacyMode} />
      </Suspense>
    </AuthPageShell>
  );
}
