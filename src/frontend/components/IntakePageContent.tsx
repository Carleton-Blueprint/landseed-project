"use client";

import React from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { IntakeDraftProvider } from "@/frontend/contexts/IntakeDraftContext";
import { GuidedIntakeForm } from "@/frontend/components/GuidedIntakeForm";
import { IntakeForm } from "@/frontend/components/IntakeForm";
import { DraftSaveStatus } from "@/frontend/components/DraftSaveStatus";
import { IntakeLeaveGuard } from "@/frontend/components/IntakeLeaveGuard";
import { ResumeDraftBanner } from "@/frontend/components/ResumeDraftBanner";
import { Button } from "@/frontend/components/ui/button";
import { ShieldCheck, Sparkles, LogIn, UserPlus } from "lucide-react";

export function IntakePageContent() {
  const { data: session, status } = useSession();

  if (status === "loading") {
    return (
      <div className="py-16 flex flex-col items-center justify-center gap-4 animate-in fade-in duration-200">
        <div className="w-10 h-10 border-3 border-emerald-600 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm font-semibold text-gray-600">Checking portal security and loading assessment...</p>
      </div>
    );
  }

  // Require user to sign in or create an account before filling in the intake form
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
              To protect your health privacy and automatically save your progress as you complete the home adaptation intake, please sign in or create an account first.
            </p>
          </div>

          <div className="rounded-2xl bg-emerald-50/70 border border-emerald-200/60 p-4 text-left text-xs sm:text-sm text-emerald-900 space-y-2 shadow-2xs">
            <div className="flex items-center gap-2 font-bold text-emerald-950">
              <Sparkles className="h-4 w-4 text-emerald-600 shrink-0" />
              <span>InPlace AI Auto-Save & Privacy Protection</span>
            </div>
            <p className="text-emerald-800 pl-6 leading-relaxed">
              Once signed in, every answer you select saves automatically to your secure portal. You can leave at any time and return right where you left off without losing a single detail.
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

          <p className="text-xs text-gray-500 pt-2">
            256-Bit Encrypted Portal — Designed for Seniors, Families, and Caregivers
          </p>
        </div>
      </div>
    );
  }

  return (
    <IntakeDraftProvider>
      <IntakeLeaveGuard />
      <ResumeDraftBanner />

      {/* Prominent Auto-Save Banner */}
      <div className="mb-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 rounded-2xl bg-gradient-to-r from-emerald-50/90 via-teal-50/50 to-white border border-emerald-200/80 p-4 text-sm text-emerald-900 shadow-2xs">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-sm shrink-0">
            <Sparkles className="h-5 w-5 animate-pulse" />
          </div>
          <div>
            <p className="font-extrabold text-slate-900 text-base">InPlace AI Auto-Save Active</p>
            <p className="text-xs text-slate-600">Your progress is saved automatically as you fill in the form. You can safely leave and continue anytime.</p>
          </div>
        </div>
        <div className="shrink-0 self-end sm:self-center">
          <DraftSaveStatus />
        </div>
      </div>

      <div id="guided-intake" className="mb-12">
        <GuidedIntakeForm />
      </div>
      <div id="intake-form">
        <IntakeForm />
      </div>
    </IntakeDraftProvider>
  );
}
