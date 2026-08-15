"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { Button } from "@/frontend/components/ui/button";
import {
  CheckCircleIcon,
  ClipboardIcon,
  EyeIcon,
  InfoIcon,
  GlobeIcon,
  BuildingIcon,
  MapPinIcon,
  SearchIcon,
  HomeIcon,
  CameraIcon,
} from "@/frontend/components/icons";

/* ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ */

export interface DiscoveredGrantSummary {
  grantId: string;
  title: string;
  scope: string;
  decision: string;
  relevanceScore: number;
  confidence: string;
}

export interface DashboardProjectItem {
  id: string;
  address: string;
  status: string;
  createdAt: string;
  photoCount: number;
  grantDocumentKey?: string | null;
  estimateSummary: {
    title: string;
    value: string;
    explanation: string;
  };
  eligibility?: {
    overallDecision: string;
    discoveredGrants: DiscoveredGrantSummary[];
    provider: string | null;
    assessedAt: string;
  } | null;
}

export interface DashboardProjectsClientProps {
  projects: DashboardProjectItem[];
  initialTab?: "all" | "submitted" | "draft";
  isSubmitted?: boolean;
  newProjectId?: string | null;
}

/* ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ */

function getStatusLabel(status: string) {
  if (status === "draft") return "Pending";
  return status.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function getStatusStyle(status: string) {
  if (status === "draft")
    return "border-amber-200 bg-amber-50 text-amber-700";
  if (status === "submitted")
    return "border-blue-200 bg-blue-50 text-blue-700";
  if (status === "estimate_expired")
    return "border-orange-200 bg-orange-50 text-orange-700";
  return "border-emerald-200 bg-emerald-50 text-emerald-700";
}

const DECISION_DISPLAY: Record<string, { label: string; icon: React.ReactNode; color: string; bg: string; border: string }> = {
  ELIGIBLE: {
    label: "Grants Found",
    icon: <CheckCircleIcon size={18} className="text-emerald-600" />,
    color: "text-emerald-700",
    bg: "bg-emerald-50",
    border: "border-emerald-200",
  },
  NEEDS_MORE_INFO: {
    label: "More Info Needed",
    icon: <ClipboardIcon size={18} className="text-amber-600" />,
    color: "text-amber-700",
    bg: "bg-amber-50",
    border: "border-amber-200",
  },
  MANUAL_REVIEW: {
    label: "Manual Review",
    icon: <EyeIcon size={18} className="text-orange-600" />,
    color: "text-orange-700",
    bg: "bg-orange-50",
    border: "border-orange-200",
  },
  INELIGIBLE: {
    label: "No Matches",
    icon: <InfoIcon size={18} className="text-gray-500" />,
    color: "text-gray-600",
    bg: "bg-gray-50",
    border: "border-gray-200",
  },
};

const SCOPE_ICONS: Record<string, React.ReactNode> = {
  NATIONAL: <GlobeIcon size={14} />,
  PROVINCIAL: <BuildingIcon size={14} />,
  MUNICIPAL: <MapPinIcon size={14} />,
};

function countByScope(grants: DiscoveredGrantSummary[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const g of grants) {
    counts[g.scope] = (counts[g.scope] ?? 0) + 1;
  }
  return counts;
}

/* ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ */

export function DashboardProjectsClient({
  projects,
  initialTab = "all",
  isSubmitted = false,
  newProjectId = null,
}: DashboardProjectsClientProps) {
  const [activeTab, setActiveTab] = useState<"all" | "submitted" | "draft">(initialTab);
  const [showToast, setShowToast] = useState(isSubmitted);

  useEffect(() => {
    if (showToast) {
      const timer = setTimeout(() => {
        setShowToast(false);
      }, 8000);
      return () => clearTimeout(timer);
    }
  }, [showToast]);

  const submittedProjects = projects.filter((p) => p.status !== "draft");
  const draftProjects = projects.filter((p) => p.status === "draft");

  const filteredProjects =
    activeTab === "submitted"
      ? submittedProjects
      : activeTab === "draft"
      ? draftProjects
      : projects;

  return (
    <div className="space-y-6">
      {showToast && (
        <div className="animate-in fade-in slide-in-from-top-4 duration-300">
          <div className="relative overflow-hidden rounded-2xl border border-emerald-300 bg-gradient-to-r from-emerald-50 via-teal-50 to-emerald-50 p-5 shadow-lg shadow-emerald-500/10">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3.5">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-md shadow-emerald-500/20">
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
                    Submission Successful!
                    <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
                      Live
                    </span>
                  </h3>
                  <p className="mt-1 text-sm text-gray-700 leading-relaxed">
                    Thank you for submitting your request! Your project is now being processed by our team and InPlace AI. You can track its progress below — your new request is at the top of your list.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowToast(false)}
                className="rounded-lg p-1.5 text-gray-400 hover:bg-emerald-100 hover:text-gray-600 transition-colors"
                aria-label="Close notification"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-gray-200 pb-4">
        <nav className="flex space-x-2" aria-label="Projects Filter">
          <button
            onClick={() => setActiveTab("all")}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200 ${
              activeTab === "all"
                ? "bg-emerald-600 text-white shadow-sm"
                : "bg-white text-gray-600 hover:bg-gray-100 border border-gray-200"
            }`}
          >
            All Projects <span className={`ml-1 rounded-full px-2 py-0.5 text-xs ${activeTab === "all" ? "bg-emerald-700 text-white" : "bg-gray-100 text-gray-600"}`}>{projects.length}</span>
          </button>
          <button
            onClick={() => setActiveTab("submitted")}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200 ${
              activeTab === "submitted"
                ? "bg-emerald-600 text-white shadow-sm"
                : "bg-white text-gray-600 hover:bg-gray-100 border border-gray-200"
            }`}
          >
            Submitted Projects <span className={`ml-1 rounded-full px-2 py-0.5 text-xs ${activeTab === "submitted" ? "bg-emerald-700 text-white" : "bg-gray-100 text-gray-600"}`}>{submittedProjects.length}</span>
          </button>
          <button
            onClick={() => setActiveTab("draft")}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200 ${
              activeTab === "draft"
                ? "bg-emerald-600 text-white shadow-sm"
                : "bg-white text-gray-600 hover:bg-gray-100 border border-gray-200"
            }`}
          >
            Drafts <span className={`ml-1 rounded-full px-2 py-0.5 text-xs ${activeTab === "draft" ? "bg-emerald-700 text-white" : "bg-gray-100 text-gray-600"}`}>{draftProjects.length}</span>
          </button>
        </nav>

        {projects.length > 0 && (
          <Link href="/">
            <Button className="h-9 gap-2 rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 transition-all">
              <span className="text-base leading-none">+</span>
              Start New Project
            </Button>
          </Link>
        )}
      </div>

      {filteredProjects.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-10 text-center shadow-sm">
          <HomeIcon size={36} className="mx-auto text-gray-300" />
          <h2 className="mt-3 text-lg font-semibold text-gray-900">
            {activeTab === "submitted"
              ? "No Submitted Projects Yet"
              : activeTab === "draft"
              ? "No Drafts Found"
              : "No Projects Yet"}
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            {activeTab === "submitted"
              ? "When you submit a project request, it will appear here."
              : activeTab === "draft"
              ? "You don't have any pending project applications."
              : "Submit a request to start a new home modification project."}
          </p>
          {projects.length === 0 && (
            <div className="mt-6">
              <Link href="/">
                <Button className="gap-2 rounded-xl bg-slate-900 px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 transition-all">
                  <span className="text-base leading-none">+</span>
                  Start New Project
                </Button>
              </Link>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-5">
          {filteredProjects.map((project) => {
            const { estimateSummary, eligibility } = project;
            const isNewSubmission = newProjectId === project.id;

            const eligibleGrants = eligibility
              ? eligibility.discoveredGrants.filter((g) => g.decision === "ELIGIBLE")
              : [];
            const scopeCounts = eligibility
              ? countByScope(eligibility.discoveredGrants)
              : {};
            const decisionDisplay = eligibility
              ? DECISION_DISPLAY[eligibility.overallDecision] ?? DECISION_DISPLAY.MANUAL_REVIEW
              : null;

            return (
              <div
                key={project.id}
                className={`overflow-hidden rounded-xl border transition-all duration-200 hover:shadow-md ${
                  isNewSubmission
                    ? "border-emerald-500 ring-2 ring-emerald-400/50 bg-emerald-50/10 shadow-md"
                    : "border-gray-200 bg-white shadow-sm"
                }`}
                id={`project-card-${project.id}`}
              >
                <div
                  className={`h-1.5 w-full ${
                    isNewSubmission
                      ? "bg-gradient-to-r from-emerald-500 via-teal-500 to-emerald-600 animate-pulse"
                      : eligibility?.overallDecision === "ELIGIBLE"
                      ? "bg-gradient-to-r from-emerald-400 to-teal-500"
                      : eligibility?.overallDecision === "NEEDS_MORE_INFO"
                      ? "bg-gradient-to-r from-amber-400 to-orange-400"
                      : "bg-gradient-to-r from-gray-300 to-gray-400"
                  }`}
                />

                <div className="p-5 sm:p-6">
                  <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1 space-y-4">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-lg font-bold text-gray-900">{project.address}</h3>
                          {isNewSubmission && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-emerald-600 to-teal-600 px-2.5 py-0.5 text-xs font-bold text-white shadow-sm animate-bounce">
                              ✨ Just Submitted
                            </span>
                          )}
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-2">
                          <span
                            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${getStatusStyle(
                              project.status
                            )}`}
                          >
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${
                                project.status === "draft" ? "bg-amber-500" : "bg-emerald-500"
                              }`}
                            />
                            {getStatusLabel(project.status)}
                          </span>
                          <span className="text-xs text-gray-500">
                            {new Date(project.createdAt).toLocaleDateString("en-CA", {
                              year: "numeric",
                              month: "short",
                              day: "numeric",
                            })}
                          </span>
                          <span className="text-xs text-gray-500 flex items-center gap-1">
                            <CameraIcon size={12} /> {project.photoCount} photo{project.photoCount === 1 ? "" : "s"}
                          </span>
                        </div>
                      </div>

                      <div className="rounded-lg border bg-gray-50/80 p-3.5">
                        <p className="text-sm font-medium text-gray-900 flex items-center gap-1.5">
                          <svg className="h-4 w-4 text-emerald-500 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          {estimateSummary.title}: {estimateSummary.value}
                        </p>
                        <p className="mt-1 text-xs text-gray-500 leading-relaxed">
                          {estimateSummary.explanation}
                        </p>
                      </div>

                      {/* ═══ AI-Discovered Grant Eligibility ═══ */}
                      {eligibility ? (
                        <div
                          className={`rounded-lg border p-3.5 ${decisionDisplay!.bg} ${decisionDisplay!.border}`}
                        >
                          <div className="flex items-start gap-2.5">
                            <span className="text-lg leading-none mt-0.5">{decisionDisplay!.icon}</span>
                            <div className="flex-1 min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className={`text-sm font-bold ${decisionDisplay!.color}`}>
                                  {decisionDisplay!.label}
                                </p>
                                <span className="inline-flex items-center gap-1 rounded-full bg-white/80 border border-violet-200 px-2 py-0.5 text-[10px] font-medium text-violet-600">
                                  <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                                  </svg>
                                  InPlace AI‑Discovered
                                </span>
                              </div>

                              {eligibility.discoveredGrants.length > 0 ? (
                                <div className="mt-2 flex flex-wrap gap-2">
                                  {Object.entries(scopeCounts).map(([scope, count]) => (
                                    <span
                                      key={scope}
                                      className="inline-flex items-center gap-1 rounded-md bg-white/70 border border-gray-200 px-2 py-0.5 text-xs text-gray-700"
                                    >
                                      <span>{SCOPE_ICONS[scope] ?? <ClipboardIcon size={12} />}</span>
                                      {count} {scope.charAt(0) + scope.slice(1).toLowerCase()}
                                    </span>
                                  ))}
                                  {eligibleGrants.length > 0 && (
                                    <span className="inline-flex items-center gap-1 rounded-md bg-emerald-100 border border-emerald-300 px-2 py-0.5 text-xs font-medium text-emerald-700">
                                      ✓ {eligibleGrants.length} eligible
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <p className="mt-1 text-xs text-gray-600">
                                  No grant programs matched the current project profile.
                                </p>
                              )}

                              {eligibleGrants.length > 0 && (
                                <p className="mt-2 text-xs text-gray-600 leading-relaxed">
                                  Top match: <span className="font-medium text-gray-800">{eligibleGrants[0].title}</span>
                                  {eligibleGrants.length > 1 && (
                                    <span className="text-gray-500">
                                      {" "}and {eligibleGrants.length - 1} more
                                    </span>
                                  )}
                                </p>
                              )}
                            </div>
                          </div>

                          <div className="mt-2.5 flex items-center gap-3 border-t border-gray-200/60 pt-2 text-[10px] text-gray-400">
                            <span>
                              Provider: {eligibility.provider === "OPENAI" ? "InPlace AI Web Search" : "Heuristic Engine"}
                            </span>
                            <span>
                              Assessed: {new Date(eligibility.assessedAt).toLocaleDateString("en-CA", {
                                month: "short",
                                day: "numeric",
                              })}
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-3.5">
                          <div className="flex items-center gap-2.5">
                            <SearchIcon size={18} className="text-gray-400" />
                            <div>
                              <p className="text-sm font-medium text-gray-700">
                                InPlace AI Grant Discovery Pending
                              </p>
                              <p className="mt-0.5 text-xs text-gray-500">
                                Grant eligibility will be automatically assessed once your project request is finalized.
                              </p>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="flex shrink-0 flex-col gap-2 sm:w-auto">
                      {project.status === "draft" ? (
                        <Link href="/">
                          <Button className="w-full gap-1.5 sm:w-auto">
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                            </svg>
                            Continue application
                          </Button>
                        </Link>
                      ) : null}

                      <Link href={`/dashboard/${project.id}`}>
                        <Button variant="outline" className="w-full gap-1.5 sm:w-auto">
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          </svg>
                          View Details
                        </Button>
                      </Link>

                      {project.grantDocumentKey ? (
                        <Link href={`/api/documents/${project.id}/download`}>
                          <Button
                            variant="default"
                            className="flex w-full items-center gap-2 sm:w-auto"
                          >
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                            </svg>
                            Grant PDF
                          </Button>
                        </Link>
                      ) : (
                        <Button variant="outline" disabled className="w-full gap-1.5 sm:w-auto">
                          <div className="h-3.5 w-3.5 rounded-full border-2 border-gray-400 border-t-transparent animate-spin" />
                          Generating PDF…
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
