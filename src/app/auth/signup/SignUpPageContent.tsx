"use client";

import React, { useState, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { Button } from "@/frontend/components/ui/button";
import { Input } from "@/frontend/components/ui/input";
import { 
  User, 
  Mail, 
  Phone, 
  Lock, 
  Eye, 
  EyeOff, 
  ShieldCheck, 
  CheckCircle2, 
  AlertCircle, 
  ArrowRight, 
  Sparkles 
} from "lucide-react";

function SignUpForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/dashboard";

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  // Live real-time password checks (minimum 8 characters, uppercase, lowercase, number, special character)
  const isLengthValid = password.length >= 8;
  const isUpperValid = /[A-Z]/.test(password);
  const isLowerValid = /[a-z]/.test(password);
  const isNumberValid = /[0-9]/.test(password);
  const isSpecialValid = /[^A-Za-z0-9]/.test(password);
  const isMatchValid = password.length > 0 && password === confirmPassword;

  const isAllValid =
    isLengthValid &&
    isUpperValid &&
    isLowerValid &&
    isNumberValid &&
    isSpecialValid &&
    isMatchValid;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAllValid) {
      setError("Please satisfy all password security requirements before creating your account.");
      return;
    }

    setIsLoading(true);
    setError("");

    try {
      const response = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim(),
          password,
        }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok || !data?.success) {
        setError(data?.error ?? "Failed to create your account. Please try again.");
      } else {
        setIsSuccess(true);
      }
    } catch {
      setError("An unexpected network error occurred. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleProceedToSignIn = async () => {
    setIsLoading(true);
    try {
      const res = await signIn("credentials", {
        redirect: false,
        email: email.trim().toLowerCase(),
        password,
        callbackUrl,
      });

      if (res?.error) {
        router.push(`/auth/signin?email=${encodeURIComponent(email)}&callbackUrl=${encodeURIComponent(callbackUrl)}`);
      } else {
        router.push(callbackUrl);
      }
    } catch {
      router.push(`/auth/signin?email=${encodeURIComponent(email)}&callbackUrl=${encodeURIComponent(callbackUrl)}`);
    }
  };

  if (isSuccess) {
    return (
      <div className="space-y-6 text-center animate-in fade-in-50 duration-300 py-4">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 shadow-inner">
          <Sparkles className="h-8 w-8 animate-pulse" />
        </div>

        <div>
          <h3 className="text-xl font-bold text-gray-900">Account Created Successfully!</h3>
          <p className="mt-2 text-sm text-gray-600 max-w-sm mx-auto leading-relaxed">
            Welcome to LandSeed, <strong className="text-gray-900">{name || email}</strong>! Your secure client portal is ready.
          </p>
        </div>

        <div className="rounded-xl bg-emerald-50/80 border border-emerald-200/60 p-4 text-left text-xs text-emerald-800 space-y-1.5 shadow-2xs">
          <div className="flex items-center gap-2 font-semibold text-emerald-900">
            <ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0" />
            <span>InPlace AI Security Active</span>
          </div>
          <p className="pl-6 text-emerald-700">
            Your account is protected with 256-bit encryption and automated privacy controls.
          </p>
        </div>

        <Button
          type="button"
          onClick={handleProceedToSignIn}
          disabled={isLoading}
          className="w-full h-12 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white rounded-xl font-semibold shadow-md hover:shadow-lg transition-all duration-200 text-base flex items-center justify-center gap-2"
        >
          {isLoading ? (
            <>
              <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              <span>Entering Portal...</span>
            </>
          ) : (
            <>
              <span>Continue to Assessment & Portal</span>
              <ArrowRight className="h-4 w-4" />
            </>
          )}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Reassurance Badge */}
      <div className="flex items-center justify-center gap-2 rounded-xl bg-emerald-50/90 border border-emerald-200/80 p-3 text-xs font-medium text-emerald-800 shadow-2xs">
        <ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0" />
        <span>256-Bit Encrypted Portal — Senior & Caregiver Protected</span>
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
            Phone Number <span className="text-gray-400 font-normal">(Optional)</span>
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

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="password" className="block text-sm font-semibold text-gray-700 mb-1.5">
              Password
            </label>
            <div className="relative">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-gray-400">
                <Lock className="h-4 w-4" />
              </div>
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pl-10 pr-10 h-11 rounded-xl border-gray-200 bg-white/80 text-gray-900 placeholder-gray-400 focus-visible:ring-emerald-500 focus-visible:border-emerald-500 shadow-2xs transition-all text-base sm:text-sm"
                placeholder="Create password"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-600 focus:outline-none transition-colors"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div>
            <label htmlFor="confirmPassword" className="block text-sm font-semibold text-gray-700 mb-1.5">
              Confirm Password
            </label>
            <div className="relative">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-gray-400">
                <Lock className="h-4 w-4" />
              </div>
              <Input
                id="confirmPassword"
                type={showConfirmPassword ? "text" : "password"}
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="pl-10 pr-10 h-11 rounded-xl border-gray-200 bg-white/80 text-gray-900 placeholder-gray-400 focus-visible:ring-emerald-500 focus-visible:border-emerald-500 shadow-2xs transition-all text-base sm:text-sm"
                placeholder="Repeat password"
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-600 focus:outline-none transition-colors"
                aria-label={showConfirmPassword ? "Hide password" : "Show password"}
              >
                {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </div>

        {/* Live Password Requirements Checklist with Real-Time Feedback */}
        <div className="rounded-xl bg-gray-50/90 border border-gray-200/80 p-3.5 space-y-2 shadow-2xs">
          <p className="text-xs font-bold uppercase tracking-wider text-gray-700 flex items-center gap-1.5">
            <ShieldCheck className="h-4 w-4 text-emerald-600" />
            Secure Password Requirements
          </p>
          <ul className="space-y-1.5 text-xs">
            <li
              className={`flex items-center gap-2 font-medium transition-colors ${
                isLengthValid ? "text-emerald-700 font-semibold" : "text-gray-500"
              }`}
            >
              <CheckCircle2
                className={`h-4 w-4 shrink-0 ${
                  isLengthValid ? "text-emerald-600" : "text-gray-300"
                }`}
              />
              <span>At least 8 characters long</span>
            </li>
            <li
              className={`flex items-center gap-2 font-medium transition-colors ${
                isUpperValid ? "text-emerald-700 font-semibold" : "text-gray-500"
              }`}
            >
              <CheckCircle2
                className={`h-4 w-4 shrink-0 ${
                  isUpperValid ? "text-emerald-600" : "text-gray-300"
                }`}
              />
              <span>At least one uppercase letter (A–Z)</span>
            </li>
            <li
              className={`flex items-center gap-2 font-medium transition-colors ${
                isLowerValid ? "text-emerald-700 font-semibold" : "text-gray-500"
              }`}
            >
              <CheckCircle2
                className={`h-4 w-4 shrink-0 ${
                  isLowerValid ? "text-emerald-600" : "text-gray-300"
                }`}
              />
              <span>At least one lowercase letter (a–z)</span>
            </li>
            <li
              className={`flex items-center gap-2 font-medium transition-colors ${
                isNumberValid ? "text-emerald-700 font-semibold" : "text-gray-500"
              }`}
            >
              <CheckCircle2
                className={`h-4 w-4 shrink-0 ${
                  isNumberValid ? "text-emerald-600" : "text-gray-300"
                }`}
              />
              <span>At least one number (0–9)</span>
            </li>
            <li
              className={`flex items-center gap-2 font-medium transition-colors ${
                isSpecialValid ? "text-emerald-700 font-semibold" : "text-gray-500"
              }`}
            >
              <CheckCircle2
                className={`h-4 w-4 shrink-0 ${
                  isSpecialValid ? "text-emerald-600" : "text-gray-300"
                }`}
              />
              <span>At least one special character (!@#$%^&*)</span>
            </li>
            <li
              className={`flex items-center gap-2 font-medium transition-colors ${
                isMatchValid ? "text-emerald-700 font-semibold" : "text-gray-500"
              }`}
            >
              <CheckCircle2
                className={`h-4 w-4 shrink-0 ${
                  isMatchValid ? "text-emerald-600" : "text-gray-300"
                }`}
              />
              <span>Both passwords match exactly</span>
            </li>
          </ul>
        </div>

        {error && (
          <div className="flex items-center gap-2.5 p-3.5 bg-red-50 border border-red-200/80 rounded-xl text-red-700 text-sm animate-in fade-in-50 duration-200">
            <AlertCircle className="h-5 w-5 text-red-500 shrink-0" />
            <p className="font-medium">{error}</p>
          </div>
        )}

        <Button
          type="submit"
          disabled={isLoading || !isAllValid}
          className="w-full h-12 mt-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white rounded-xl font-semibold shadow-md hover:shadow-lg transition-all duration-200 disabled:opacity-50 text-base flex items-center justify-center gap-2"
        >
          {isLoading ? (
            <>
              <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              <span>Creating Account...</span>
            </>
          ) : (
            <>
              <span>Create Client Account</span>
              <ArrowRight className="h-4 w-4" />
            </>
          )}
        </Button>
      </form>

      {/* Sign In Link */}
      <div className="border-t border-gray-100 pt-4 text-center">
        <p className="text-sm text-gray-500">
          Already have an account?{" "}
          <Link
            href="/"
            className="font-semibold text-emerald-600 hover:text-emerald-700 hover:underline transition-colors"
          >
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}

const SIGNUP_BG = `
  @keyframes fade-up {
    from { opacity: 0; transform: translateY(24px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .su-fade-up   { animation: fade-up 0.55s cubic-bezier(.22,1,.36,1) both; }
  .su-fade-up-1 { animation: fade-up 0.55s 0.08s cubic-bezier(.22,1,.36,1) both; }
  .su-fade-up-2 { animation: fade-up 0.55s 0.16s cubic-bezier(.22,1,.36,1) both; }
`;

export function SignUpPageContent() {
  return (
    <div className="relative flex min-h-screen items-start justify-center overflow-hidden bg-gradient-to-br from-slate-50 via-white to-emerald-50/40 px-4 py-12 sm:items-center">
      <style>{SIGNUP_BG}</style>

      {/* Decorative blobs */}
      <div aria-hidden className="pointer-events-none fixed -top-24 -right-24 h-96 w-96 rounded-full bg-emerald-100/50 blur-3xl" />
      <div aria-hidden className="pointer-events-none fixed -bottom-24 -left-24 h-80 w-80 rounded-full bg-teal-100/40 blur-3xl" />

      <div className="relative z-10 w-full max-w-sm space-y-8">
        {/* Logo */}
        <div className="su-fade-up text-center">
          <Link href="/" className="inline-flex flex-col items-center gap-3 group">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-600 shadow-lg shadow-emerald-200 transition-transform group-hover:scale-105">
              <Sparkles className="h-6 w-6 text-white" />
            </div>
            <span className="text-2xl font-bold tracking-tight text-gray-900">LandSeed</span>
          </Link>
          <p className="mt-1 text-sm text-gray-500">Create your secure account</p>
        </div>

        {/* Card */}
        <div className="su-fade-up-1 rounded-2xl border border-gray-100 bg-white/90 p-7 shadow-xl shadow-gray-100/60 backdrop-blur-sm">
          <h2 className="mb-5 text-base font-semibold text-gray-800">Set up your account</h2>
          <Suspense
            fallback={
              <div className="flex justify-center py-10">
                <span className="h-6 w-6 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" />
              </div>
            }
          >
            <SignUpForm />
          </Suspense>
        </div>

        {/* Sign in link */}
        <p className="su-fade-up-2 text-center text-sm text-gray-500">
          Already have an account?{" "}
          <Link href="/" className="font-semibold text-emerald-600 hover:text-emerald-700 hover:underline transition-colors">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}

