"use client";

import React, { useState, useEffect, useCallback } from "react";

/* ──────────────────────────── Types ──────────────────────────── */

interface QuestionData {
  id: string;
  category: string;
  subject: string;
  message: string;
  status: "OPEN" | "ANSWERED" | "CLOSED";
  response: string | null;
  respondedAt: string | null;
  createdAt: string;
}

export interface AskQuestionPanelProps {
  quoteId: string;
}

const QUESTION_CATEGORIES = [
  {
    value: "PRICING",
    label: "Pricing & Costs",
    icon: "💰",
    description: "Questions about pricing, discounts, or payment options",
  },
  {
    value: "SCOPE",
    label: "Scope of Work",
    icon: "📐",
    description: "What's included or excluded in the estimate",
  },
  {
    value: "TIMELINE",
    label: "Timeline",
    icon: "📅",
    description: "Project duration, scheduling, or start dates",
  },
  {
    value: "MATERIALS",
    label: "Materials",
    icon: "🧱",
    description: "Material choices, quality, or alternatives",
  },
  {
    value: "GRANT_ELIGIBILITY",
    label: "Grant Eligibility",
    icon: "🏛️",
    description: "Questions about grant coverage or eligibility",
  },
  {
    value: "MODIFICATION_REQUEST",
    label: "Modification Request",
    icon: "✏️",
    description: "Request changes to the proposed scope or approach",
  },
  {
    value: "GENERAL",
    label: "General Question",
    icon: "💬",
    description: "Any other questions about your estimate",
  },
];

/* ──────────────────────────── Helpers ──────────────────────────── */

function getStatusInfo(status: string) {
  switch (status) {
    case "ANSWERED":
      return {
        label: "Answered",
        classes: "text-emerald-700 bg-emerald-50 border-emerald-200",
        dot: "bg-emerald-500",
      };
    case "CLOSED":
      return {
        label: "Closed",
        classes: "text-gray-600 bg-gray-50 border-gray-200",
        dot: "bg-gray-400",
      };
    default:
      return {
        label: "Awaiting Response",
        classes: "text-amber-700 bg-amber-50 border-amber-200",
        dot: "bg-amber-500",
      };
  }
}

function getCategoryInfo(value: string) {
  return QUESTION_CATEGORIES.find((c) => c.value === value) || QUESTION_CATEGORIES[6];
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString("en-CA", {
    month: "short",
    day: "numeric",
  });
}

/* ──────────────────────────── Component ──────────────────────────── */

export function AskQuestionPanel({ quoteId }: AskQuestionPanelProps) {
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  const [questions, setQuestions] = useState<QuestionData[]>([]);
  const [isLoadingQuestions, setIsLoadingQuestions] = useState(true);
  const [expandedQuestion, setExpandedQuestion] = useState<string | null>(null);

  // Fetch existing questions
  const fetchQuestions = useCallback(async () => {
    try {
      const res = await fetch(`/api/quote/${quoteId}/questions`);
      if (res.ok) {
        const data = await res.json();
        setQuestions(data.questions || []);
      }
    } catch {
      console.error("Failed to fetch questions");
    } finally {
      setIsLoadingQuestions(false);
    }
  }, [quoteId]);

  useEffect(() => {
    fetchQuestions();
  }, [fetchQuestions]);

  // Submit a question
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    if (!selectedCategory) {
      setSubmitError("Please select a question category.");
      return;
    }
    if (subject.trim().length < 3) {
      setSubmitError("Subject must be at least 3 characters.");
      return;
    }
    if (message.trim().length < 10) {
      setSubmitError("Please provide more detail (at least 10 characters).");
      return;
    }

    setIsSubmitting(true);

    try {
      const res = await fetch(`/api/quote/${quoteId}/question`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: selectedCategory,
          subject: subject.trim(),
          message: message.trim(),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to submit question");
      }

      const data = await res.json();

      // Add to list and reset form
      setQuestions((prev) => [data.question, ...prev]);
      setSubmitSuccess(true);
      setSelectedCategory(null);
      setSubject("");
      setMessage("");

      // Hide success message after 4s
      setTimeout(() => {
        setSubmitSuccess(false);
        setIsFormOpen(false);
      }, 4000);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsSubmitting(false);
    }
  };

  const openCount = questions.filter((q) => q.status === "OPEN").length;
  const answeredCount = questions.filter((q) => q.status === "ANSWERED").length;

  return (
    <div className="space-y-6">
      {/* ─── Header Card ─── */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-600 via-indigo-700 to-purple-800 p-6 text-white shadow-xl">
        <div className="absolute top-0 right-0 w-40 h-40 bg-gradient-to-bl from-white/10 to-transparent rounded-full blur-2xl" />
        <div className="absolute bottom-0 left-0 w-32 h-32 bg-gradient-to-tr from-purple-400/15 to-transparent rounded-full blur-xl" />

        <div className="relative z-10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-11 h-11 rounded-xl bg-white/15 backdrop-blur-sm border border-white/20">
              <span className="text-xl">❓</span>
            </div>
            <div>
              <h3 className="text-lg font-bold tracking-tight">
                Ask the Advisory Team
              </h3>
              <p className="text-indigo-200 text-sm">
                Request clarifications or modifications to your estimate
              </p>
            </div>
          </div>

          {!isFormOpen && (
            <button
              type="button"
              onClick={() => setIsFormOpen(true)}
              id="ask-question-button"
              className="
                flex items-center gap-2 px-5 py-2.5 rounded-xl
                bg-white text-indigo-700 font-semibold text-sm
                hover:bg-indigo-50 hover:shadow-lg
                transition-all duration-200 shadow-md
              "
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Ask a Question
            </button>
          )}
        </div>

        {/* Stats */}
        {questions.length > 0 && (
          <div className="relative z-10 flex gap-4 mt-4 pt-4 border-t border-white/15">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-amber-400" />
              <span className="text-sm text-indigo-200">
                {openCount} awaiting response
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <span className="text-sm text-indigo-200">
                {answeredCount} answered
              </span>
            </div>
          </div>
        )}
      </div>

      {/* ─── Question Form ─── */}
      {isFormOpen && (
        <div className="rounded-2xl border border-gray-200 bg-white shadow-lg overflow-hidden animate-in">
          {/* Success State */}
          {submitSuccess ? (
            <div className="p-8 text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-emerald-100 text-emerald-600 mb-4">
                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h4 className="text-xl font-bold text-gray-900 mb-2">Question Submitted!</h4>
              <p className="text-gray-500">
                Our Advisory Team will review and respond to your question shortly.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              {/* Form Header */}
              <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50 flex items-center justify-between">
                <h4 className="font-semibold text-gray-800">New Question</h4>
                <button
                  type="button"
                  onClick={() => {
                    setIsFormOpen(false);
                    setSubmitError(null);
                  }}
                  className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100 transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="p-6 space-y-5">
                {/* Category Selector */}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    What is your question about?
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {QUESTION_CATEGORIES.map((cat) => {
                      const isSelected = selectedCategory === cat.value;
                      return (
                        <button
                          key={cat.value}
                          type="button"
                          onClick={() => {
                            setSelectedCategory(cat.value);
                            setSubmitError(null);
                          }}
                          className={`
                            text-left p-3 rounded-xl border transition-all duration-200 group
                            ${isSelected
                              ? "border-indigo-500 bg-indigo-50 shadow-sm"
                              : "border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50"
                            }
                          `}
                        >
                          <span className="text-lg group-hover:scale-110 transition-transform duration-200 inline-block">
                            {cat.icon}
                          </span>
                          <p className={`text-xs font-medium mt-1 ${isSelected ? "text-indigo-700" : "text-gray-700"}`}>
                            {cat.label}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Subject */}
                <div>
                  <label htmlFor="question-subject" className="block text-sm font-semibold text-gray-700 mb-1.5">
                    Subject
                  </label>
                  <input
                    id="question-subject"
                    type="text"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="Brief summary of your question..."
                    maxLength={150}
                    className="
                      w-full px-4 py-2.5 rounded-xl border border-gray-200
                      text-gray-800 placeholder-gray-400
                      focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400
                      transition-all duration-200
                    "
                  />
                  <p className="text-xs text-gray-400 mt-1 text-right">
                    {subject.length}/150
                  </p>
                </div>

                {/* Message */}
                <div>
                  <label htmlFor="question-message" className="block text-sm font-semibold text-gray-700 mb-1.5">
                    Your Question
                  </label>
                  <textarea
                    id="question-message"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Please describe your question or request in detail. The more context you provide, the better our team can assist you..."
                    rows={4}
                    maxLength={2000}
                    className="
                      w-full px-4 py-3 rounded-xl border border-gray-200
                      text-gray-800 placeholder-gray-400 resize-none
                      focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400
                      transition-all duration-200
                    "
                  />
                  <p className="text-xs text-gray-400 mt-1 text-right">
                    {message.length}/2000
                  </p>
                </div>

                {/* Error */}
                {submitError && (
                  <div className="flex items-center gap-2 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
                    <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                    </svg>
                    {submitError}
                  </div>
                )}
              </div>

              {/* Form Footer */}
              <div className="px-6 py-4 border-t border-gray-100 bg-gray-50/50 flex items-center justify-between">
                <p className="text-xs text-gray-400">
                  Our team typically responds within 1-2 business days
                </p>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setIsFormOpen(false);
                      setSubmitError(null);
                    }}
                    disabled={isSubmitting}
                    className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 font-medium rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting || !selectedCategory || !subject.trim() || !message.trim()}
                    id="submit-question-button"
                    className="
                      px-5 py-2 text-sm font-semibold text-white rounded-xl
                      bg-gradient-to-r from-indigo-600 to-purple-600
                      hover:from-indigo-700 hover:to-purple-700
                      shadow-md hover:shadow-lg
                      transition-all duration-200
                      disabled:opacity-50 disabled:cursor-not-allowed
                    "
                  >
                    {isSubmitting ? (
                      <span className="flex items-center gap-2">
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Sending...
                      </span>
                    ) : (
                      "Submit Question"
                    )}
                  </button>
                </div>
              </div>
            </form>
          )}
        </div>
      )}

      {/* ─── Questions List ─── */}
      <div>
        <h4 className="text-base font-semibold text-gray-800 mb-3 flex items-center gap-2">
          <span className="text-lg">💬</span>
          Your Questions
          {questions.length > 0 && (
            <span className="text-sm font-normal text-gray-400">
              ({questions.length})
            </span>
          )}
        </h4>

        {isLoadingQuestions ? (
          <div className="flex items-center justify-center py-10">
            <svg className="w-5 h-5 animate-spin text-gray-400 mr-3" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span className="text-gray-500 text-sm">Loading questions...</span>
          </div>
        ) : questions.length === 0 ? (
          <div className="text-center py-10 rounded-2xl border-2 border-dashed border-gray-200 bg-gray-50/50">
            <div className="mx-auto w-14 h-14 rounded-2xl bg-gray-100 flex items-center justify-center mb-3">
              <span className="text-2xl">🤔</span>
            </div>
            <p className="text-gray-500 font-medium">No questions yet</p>
            <p className="text-sm text-gray-400 mt-1">
              Have a question about your estimate? Click &ldquo;Ask a Question&rdquo; above.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {questions.map((q) => {
              const statusInfo = getStatusInfo(q.status);
              const catInfo = getCategoryInfo(q.category);
              const isExpanded = expandedQuestion === q.id;

              return (
                <div
                  key={q.id}
                  className="rounded-xl border border-gray-200 bg-white overflow-hidden hover:shadow-md transition-shadow duration-200"
                >
                  {/* Question Header */}
                  <button
                    type="button"
                    onClick={() => setExpandedQuestion(isExpanded ? null : q.id)}
                    className="w-full text-left px-5 py-4 flex items-center gap-4 hover:bg-gray-50/50 transition-colors"
                  >
                    <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center">
                      <span className="text-lg">{catInfo?.icon}</span>
                    </div>

                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-gray-800 text-sm truncate">
                        {q.subject}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-gray-400">{catInfo?.label}</span>
                        <span className="text-gray-200">·</span>
                        <span className="text-xs text-gray-400">{timeAgo(q.createdAt)}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${statusInfo.classes}`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${statusInfo.dot}`} />
                        {statusInfo.label}
                      </span>
                      <svg
                        className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </button>

                  {/* Expanded Content */}
                  {isExpanded && (
                    <div className="border-t border-gray-100">
                      {/* Client's Question */}
                      <div className="px-5 py-4 bg-gray-50/50">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-xs font-bold">
                            You
                          </span>
                          <span className="text-xs text-gray-500">
                            {new Date(q.createdAt).toLocaleDateString("en-CA", {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                              hour: "numeric",
                              minute: "2-digit",
                            })}
                          </span>
                        </div>
                        <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed pl-8">
                          {q.message}
                        </p>
                      </div>

                      {/* Advisory Team Response */}
                      {q.response ? (
                        <div className="px-5 py-4 bg-emerald-50/30 border-t border-gray-100">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="w-6 h-6 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-xs font-bold">
                              AT
                            </span>
                            <span className="text-xs font-medium text-emerald-700">Advisory Team</span>
                            {q.respondedAt && (
                              <>
                                <span className="text-gray-200">·</span>
                                <span className="text-xs text-gray-500">
                                  {new Date(q.respondedAt).toLocaleDateString("en-CA", {
                                    month: "short",
                                    day: "numeric",
                                    year: "numeric",
                                    hour: "numeric",
                                    minute: "2-digit",
                                  })}
                                </span>
                              </>
                            )}
                          </div>
                          <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed pl-8">
                            {q.response}
                          </p>
                        </div>
                      ) : (
                        <div className="px-5 py-4 border-t border-gray-100">
                          <div className="flex items-center gap-2 text-amber-600">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <p className="text-sm font-medium">
                              Awaiting response from the Advisory Team
                            </p>
                          </div>
                          <p className="text-xs text-gray-400 mt-1 ml-6">
                            We typically respond within 1-2 business days
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
