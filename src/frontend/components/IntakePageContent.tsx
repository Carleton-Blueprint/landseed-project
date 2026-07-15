"use client";

import React from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { IntakeDraftProvider } from "@/frontend/contexts/IntakeDraftContext";
import { GuidedIntakeForm } from "@/frontend/components/GuidedIntakeForm";
import { IntakeForm } from "@/frontend/components/IntakeForm";
import { IntakeLeaveGuard } from "@/frontend/components/IntakeLeaveGuard";
import { Button } from "@/frontend/components/ui/button";
import { ShieldCheck, LogIn, UserPlus, Sparkles } from "lucide-react";

export function IntakePageContent() {
  const { data: session, status } = useSession();

  if (status === "loading") {
    return (
      <div className="py-16 flex flex-col items-center justify-center gap-4 animate-in fade-in duration-200">
        <div className="w-10 h-10 border-3 border-emerald-600 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm font-semibold text-gray-600">Loading assessment...</p>
      </div>
    );
  }

  if (!session?.user) {
    return (
      <div className="py-8 animate-in fade-in zoom-in-95 duration-300">
        <div className="rounded-3xl border border-emerald-200/80 bg-gradient-to-b from-emerald-50/90 via-white to-slate-50 p-6 sm:p-10 shadow-lg text-center max-w-xl mx-auto space-y-6">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-md">
            <ShieldCheck className="h-9 w-9" />
          </div>

          <div className="space-y-2">
            <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
              Sign In to Start Your Assessment
            </h2>
            <p className="text-base text-gray-600 leading-relaxed">
              To protect your health privacy as you complete the home adaptation intake, please sign in or create an account first.
            </p>
          </div>

          <div className="rounded-2xl bg-emerald-50/70 border border-emerald-200/60 p-4 text-left text-xs sm:text-sm text-emerald-900 space-y-2 shadow-2xs">
            <div className="flex items-center gap-2 font-bold text-emerald-950">
              <Sparkles className="h-4 w-4 text-emerald-600 shrink-0" />
              <span>Secure Portal Protection</span>
            </div>
            <p className="text-emerald-800 pl-6 leading-relaxed">
              Once signed in, your progress is saved so you can leave at any time and return right where you left off without losing your answers.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
            <Link href="/auth/signin?callbackUrl=/" className="block w-full">
              <Button className="w-full h-12 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white rounded-xl font-semibold text-base shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2">
                <LogIn className="h-4 w-4" />
                <span>Sign In to Continue</span>
              </Button>
            </Link>

            <Link href="/auth/signup?callbackUrl=/" className="block w-full">
              <Button variant="outline" className="w-full h-12 border-2 border-emerald-600 text-emerald-700 hover:bg-emerald-50 rounded-xl font-semibold text-base transition-all flex items-center justify-center gap-2">
                <UserPlus className="h-4 w-4" />
                <span>Create New Account</span>
              </Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <IntakeDraftProvider>
      <IntakeLeaveGuard />

      <div id="guided-intake" className="mb-12">
        <GuidedIntakeForm />
      </div>
      <div id="intake-form">
        <IntakeForm />
      </div>
    </IntakeDraftProvider>
  );
}
