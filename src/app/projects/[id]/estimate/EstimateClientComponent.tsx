"use client";

import React, { useState } from "react";
import {
  DollarIcon,
  ClockIcon,
  RefreshIcon,
  EditIcon,
  PauseIcon,
  MessageIcon,
} from "@/frontend/components/icons";

type QuoteStatus = "PENDING" | "ACCEPTED" | "DECLINED" | "EXPIRED";
type Step = "decision" | "confirm-accept" | "survey" | "done";

interface EstimateClientProps {
  quoteId: string;
  initialStatus: QuoteStatus;
  initialReason: string | null;
}

const DECLINE_ICON_MAP: Record<string, (props: { selected: boolean }) => React.ReactNode> = {
  too_expensive: ({ selected }) => <DollarIcon size={20} className={selected ? "text-indigo-700" : "text-gray-500"} />,
  timeline_too_long: ({ selected }) => <ClockIcon size={20} className={selected ? "text-indigo-700" : "text-gray-500"} />,
  found_another_provider: ({ selected }) => <RefreshIcon size={20} className={selected ? "text-indigo-700" : "text-gray-500"} />,
  scope_changed: ({ selected }) => <EditIcon size={20} className={selected ? "text-indigo-700" : "text-gray-500"} />,
  not_ready: ({ selected }) => <PauseIcon size={20} className={selected ? "text-indigo-700" : "text-gray-500"} />,
  other: ({ selected }) => <MessageIcon size={20} className={selected ? "text-indigo-700" : "text-gray-500"} />,
};

const DECLINE_REASONS = [
  { id: "too_expensive", label: "Too Expensive", desc: "The estimate exceeds my budget" },
  { id: "timeline_too_long", label: "Timeline Too Long", desc: "The project timeline doesn't work for me" },
  { id: "found_another_provider", label: "Found Another Provider", desc: "I'm going with a different contractor" },
  { id: "scope_changed", label: "Project Scope Changed", desc: "My project requirements have changed" },
  { id: "not_ready", label: "Not Ready Yet", desc: "I need more time before proceeding" },
  { id: "other", label: "Other Reason", desc: "I have a different reason" },
] as const;

const SUB_REASONS: Record<string, string[]> = {
  too_expensive: ["More than 20% over budget", "Slightly over budget", "Need financing options", "Expected grant to cover more"],
  timeline_too_long: ["Need it done sooner", "Scheduling conflict", "Seasonal timing issue"],
  found_another_provider: ["Better price elsewhere", "Recommended by someone", "Previous relationship"],
  scope_changed: ["No longer need modifications", "Want different modifications", "Property situation changed"],
  not_ready: ["Need to save more", "Waiting on approval", "Personal reasons"],
};

export function EstimateClientComponent({ quoteId, initialStatus, initialReason }: EstimateClientProps) {
  const [status, setStatus] = useState<QuoteStatus>(initialStatus);
  const [step, setStep] = useState<Step>(initialStatus === "PENDING" ? "decision" : "done");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isReactivating, setIsReactivating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Survey state
  const [primaryReason, setPrimaryReason] = useState<string>("");
  const [selectedSubs, setSelectedSubs] = useState<string[]>([]);
  const [satisfaction, setSatisfaction] = useState<number>(0);
  const [comments, setComments] = useState("");
  const [wouldReconsider, setWouldReconsider] = useState(false);

  const handleAccept = async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/quote/${quoteId}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "ACCEPTED", reason: null }),
      });
      if (!res.ok) throw new Error("Failed to accept estimate");
      setStatus("ACCEPTED");
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeclineSubmit = async () => {
    if (!primaryReason) { setError("Please select a reason."); return; }
    setIsSubmitting(true);
    setError(null);
    const reasonLabel = DECLINE_REASONS.find(r => r.id === primaryReason)?.label || primaryReason;
    try {
      const res = await fetch(`/api/quote/${quoteId}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "DECLINED",
          reason: reasonLabel,
          survey: {
            primaryReason,
            subReasons: selectedSubs,
            satisfactionRating: satisfaction || null,
            additionalComments: comments || null,
            wouldReconsider,
          },
        }),
      });
      if (!res.ok) throw new Error("Failed to submit response");
      setStatus("DECLINED");
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReactivate = async () => {
    setIsReactivating(true);
    setError(null);
    try {
      const res = await fetch(`/api/quote/${quoteId}/reactivate`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to reactivate estimate");
      setStatus("PENDING");
      setStep("decision");
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsReactivating(false);
    }
  };

  const toggleSub = (s: string) => setSelectedSubs(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);

  // ─── Accepted State ───
  if (status === "ACCEPTED" && step === "done") {
    return (
      <div id="estimate-accepted-banner" style={{
        background: "linear-gradient(135deg, #059669 0%, #047857 100%)",
        borderRadius: 16, padding: "32px 28px", color: "#fff", position: "relative", overflow: "hidden",
      }}>
        <div style={{ position: "absolute", top: -20, right: -20, width: 120, height: 120, borderRadius: "50%", background: "rgba(255,255,255,0.1)" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 12 }}>
          <div style={{ width: 48, height: 48, borderRadius: 14, background: "rgba(255,255,255,0.2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24 }}>✓</div>
          <div>
            <h3 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Estimate Accepted</h3>
            <p style={{ margin: "4px 0 0", fontSize: 14, opacity: 0.85 }}>Your project is moving forward</p>
          </div>
        </div>
        <p style={{ fontSize: 14, opacity: 0.9, lineHeight: 1.6 }}>
          Thank you for accepting! Our team will contact you shortly to schedule the next steps for your home modifications.
        </p>
      </div>
    );
  }

  // ─── Declined State ───
  if (status === "DECLINED" && step === "done") {
    return (
      <div id="estimate-declined-banner" style={{
        background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 16, padding: "28px 24px",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: "#f3f4f6", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>✕</div>
          <div>
            <h3 style={{ fontSize: 18, fontWeight: 700, color: "#374151", margin: 0 }}>Estimate Declined</h3>
            <p style={{ margin: "2px 0 0", fontSize: 13, color: "#9ca3af" }}>We appreciate your feedback</p>
          </div>
        </div>
        {initialReason && (
          <p style={{ fontSize: 14, color: "#6b7280", fontStyle: "italic", borderLeft: "3px solid #d1d5db", paddingLeft: 12, margin: "16px 0 0" }}>
            &quot;{initialReason}&quot;
          </p>
        )}
      </div>
    );
  }

  // ─── Expired State ───
  if (status === "EXPIRED") {
    return (
      <div id="estimate-expired-banner" style={{
        background: "linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)", border: "1px solid #fbbf24",
        borderRadius: 16, padding: "28px 24px",
      }}>
        <h3 style={{ fontSize: 18, fontWeight: 700, color: "#92400e", margin: "0 0 8px" }}>Estimate Expired</h3>
        <p style={{ fontSize: 14, color: "#92400e", marginBottom: 16 }}>This estimate is no longer active. You can reactivate it to continue.</p>
        {error && <div style={{ background: "#fef2f2", color: "#dc2626", padding: "10px 14px", borderRadius: 10, fontSize: 13, marginBottom: 12 }}>{error}</div>}
        <button id="reactivate-estimate-btn" onClick={handleReactivate} disabled={isReactivating} style={{
          background: "#d97706", color: "#fff", fontWeight: 600, padding: "10px 20px", borderRadius: 10, border: "none", cursor: "pointer", fontSize: 14, opacity: isReactivating ? 0.6 : 1,
        }}>
          {isReactivating ? "Reactivating..." : "Reactivate Estimate"}
        </button>
      </div>
    );
  }

  // ─── Decision Step ───
  if (step === "decision") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{
          background: "linear-gradient(135deg, #1e1b4b 0%, #312e81 50%, #4338ca 100%)",
          borderRadius: 16, padding: "28px 24px", color: "#fff", position: "relative", overflow: "hidden",
        }}>
          <div style={{ position: "absolute", top: 0, right: 0, width: 160, height: 160, borderRadius: "50%", background: "rgba(255,255,255,0.05)", filter: "blur(40px)" }} />
          <h3 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 6px", position: "relative", zIndex: 1 }}>Your Decision</h3>
          <p style={{ fontSize: 14, opacity: 0.75, margin: 0, position: "relative", zIndex: 1 }}>Review your estimate and choose how to proceed</p>
        </div>

        {error && <div style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#dc2626", padding: "10px 14px", borderRadius: 10, fontSize: 13 }}>{error}</div>}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <button id="accept-estimate-btn" onClick={() => setStep("confirm-accept")} disabled={isSubmitting} style={{
            background: "linear-gradient(135deg, #059669, #047857)", color: "#fff", border: "none", borderRadius: 14,
            padding: "20px 16px", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
            transition: "transform 0.2s, box-shadow 0.2s", boxShadow: "0 4px 14px rgba(5,150,105,0.25)",
          }} onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 8px 24px rgba(5,150,105,0.35)"; }}
             onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "0 4px 14px rgba(5,150,105,0.25)"; }}>
            <span style={{ fontSize: 28 }}>✓</span>
            <span style={{ fontWeight: 700, fontSize: 15 }}>Accept Estimate</span>
            <span style={{ fontSize: 12, opacity: 0.8 }}>Proceed with your project</span>
          </button>

          <button id="decline-estimate-btn" onClick={() => { setStep("survey"); setError(null); }} disabled={isSubmitting} style={{
            background: "#fff", color: "#dc2626", border: "2px solid #fecaca", borderRadius: 14,
            padding: "20px 16px", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
            transition: "transform 0.2s, box-shadow 0.2s, border-color 0.2s",
          }} onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.borderColor = "#f87171"; e.currentTarget.style.boxShadow = "0 8px 24px rgba(239,68,68,0.15)"; }}
             onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.borderColor = "#fecaca"; e.currentTarget.style.boxShadow = "none"; }}>
            <span style={{ fontSize: 28 }}>✕</span>
            <span style={{ fontWeight: 700, fontSize: 15 }}>Decline Estimate</span>
            <span style={{ fontSize: 12, opacity: 0.7 }}>Share feedback with us</span>
          </button>
        </div>
      </div>
    );
  }

  // ─── Confirm Accept Step ───
  if (step === "confirm-accept") {
    return (
      <div style={{ background: "#fff", border: "1px solid #d1fae5", borderRadius: 16, padding: 24, boxShadow: "0 4px 20px rgba(5,150,105,0.08)" }}>
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <div style={{ width: 56, height: 56, borderRadius: "50%", background: "#d1fae5", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 28, marginBottom: 12 }}>✓</div>
          <h3 style={{ fontSize: 20, fontWeight: 700, color: "#065f46", margin: "0 0 6px" }}>Confirm Acceptance</h3>
          <p style={{ fontSize: 14, color: "#6b7280", margin: 0 }}>Once accepted, our team will begin scheduling your project.</p>
        </div>
        {error && <div style={{ background: "#fef2f2", color: "#dc2626", padding: "10px 14px", borderRadius: 10, fontSize: 13, marginBottom: 12 }}>{error}</div>}
        <div style={{ display: "flex", gap: 12 }}>
          <button onClick={() => { setStep("decision"); setError(null); }} disabled={isSubmitting} style={{
            flex: 1, padding: "12px", borderRadius: 10, border: "1px solid #d1d5db", background: "#fff", color: "#374151", fontWeight: 600, fontSize: 14, cursor: "pointer",
          }}>Go Back</button>
          <button id="confirm-accept-btn" onClick={handleAccept} disabled={isSubmitting} style={{
            flex: 1, padding: "12px", borderRadius: 10, border: "none", background: "linear-gradient(135deg, #059669, #047857)",
            color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer", opacity: isSubmitting ? 0.6 : 1,
          }}>
            {isSubmitting ? "Processing..." : "Yes, Accept Estimate"}
          </button>
        </div>
      </div>
    );
  }

  // ─── Survey Step ───
  if (step === "survey") {
    const currentSubs = SUB_REASONS[primaryReason] || [];
    const canSubmit = primaryReason && satisfaction > 0;

    return (
      <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 16, overflow: "hidden", boxShadow: "0 4px 20px rgba(0,0,0,0.06)" }}>
        {/* Survey Header */}
        <div style={{ background: "linear-gradient(135deg, #7f1d1d, #991b1b)", padding: "20px 24px", color: "#fff" }}>
          <h3 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 4px" }}>Help Us Improve</h3>
          <p style={{ fontSize: 13, opacity: 0.8, margin: 0 }}>Your feedback is mandatory before declining — it helps us serve you better.</p>
        </div>

        <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 24 }}>
          {/* Step 1: Primary Reason */}
          <div>
            <label style={{ display: "block", fontSize: 14, fontWeight: 600, color: "#374151", marginBottom: 10 }}>
              1. What is the primary reason for declining? <span style={{ color: "#dc2626" }}>*</span>
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {DECLINE_REASONS.map(r => (
                <button key={r.id} type="button" id={`reason-${r.id}`} onClick={() => { setPrimaryReason(r.id); setSelectedSubs([]); setError(null); }}
                  style={{
                    textAlign: "left", padding: "12px 14px", borderRadius: 12, cursor: "pointer",
                    border: primaryReason === r.id ? "2px solid #4f46e5" : "1px solid #e5e7eb",
                    background: primaryReason === r.id ? "#eef2ff" : "#fff",
                    transition: "all 0.15s",
                  }}>
                  {DECLINE_ICON_MAP[r.id]?.({ selected: primaryReason === r.id })}
                  <p style={{ fontSize: 13, fontWeight: 600, color: primaryReason === r.id ? "#4338ca" : "#374151", margin: "4px 0 0" }}>{r.label}</p>
                  <p style={{ fontSize: 11, color: "#9ca3af", margin: "2px 0 0" }}>{r.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Step 2: Sub-reasons */}
          {currentSubs.length > 0 && (
            <div>
              <label style={{ display: "block", fontSize: 14, fontWeight: 600, color: "#374151", marginBottom: 8 }}>
                2. Can you tell us more? <span style={{ fontSize: 12, fontWeight: 400, color: "#9ca3af" }}>(optional, select all that apply)</span>
              </label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {currentSubs.map(s => (
                  <button key={s} type="button" onClick={() => toggleSub(s)} style={{
                    padding: "8px 14px", borderRadius: 20, fontSize: 13, cursor: "pointer",
                    border: selectedSubs.includes(s) ? "1.5px solid #4f46e5" : "1px solid #d1d5db",
                    background: selectedSubs.includes(s) ? "#eef2ff" : "#f9fafb",
                    color: selectedSubs.includes(s) ? "#4338ca" : "#4b5563",
                    fontWeight: selectedSubs.includes(s) ? 600 : 400,
                    transition: "all 0.15s",
                  }}>{s}</button>
                ))}
              </div>
            </div>
          )}

          {/* Step 3: Satisfaction */}
          <div>
            <label style={{ display: "block", fontSize: 14, fontWeight: 600, color: "#374151", marginBottom: 8 }}>
              {currentSubs.length > 0 ? "3" : "2"}. How satisfied were you with the estimate process? <span style={{ color: "#dc2626" }}>*</span>
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              {[1, 2, 3, 4, 5].map(n => (
                <button key={n} type="button" id={`satisfaction-${n}`} onClick={() => setSatisfaction(n)} style={{
                  width: 44, height: 44, borderRadius: 10, border: satisfaction === n ? "2px solid #4f46e5" : "1px solid #d1d5db",
                  background: satisfaction === n ? "#4f46e5" : "#f9fafb", color: satisfaction === n ? "#fff" : "#6b7280",
                  fontWeight: 700, fontSize: 16, cursor: "pointer", transition: "all 0.15s",
                }}>{n}</button>
              ))}
            </div>
            <p style={{ fontSize: 11, color: "#9ca3af", margin: "6px 0 0" }}>1 = Very Dissatisfied, 5 = Very Satisfied</p>
          </div>

          {/* Step 4: Comments */}
          <div>
            <label style={{ display: "block", fontSize: 14, fontWeight: 600, color: "#374151", marginBottom: 6 }}>
              Additional Comments <span style={{ fontSize: 12, fontWeight: 400, color: "#9ca3af" }}>(optional)</span>
            </label>
            <textarea id="decline-comments" value={comments} onChange={e => setComments(e.target.value)} placeholder="Any additional feedback..."
              rows={3} maxLength={1000} style={{
                width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid #d1d5db", fontSize: 14,
                resize: "none", outline: "none", fontFamily: "inherit", boxSizing: "border-box",
              }} />
          </div>

          {/* Would reconsider */}
          <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
            <input type="checkbox" checked={wouldReconsider} onChange={e => setWouldReconsider(e.target.checked)}
              style={{ width: 18, height: 18, accentColor: "#4f46e5" }} />
            <span style={{ fontSize: 14, color: "#374151" }}>I would consider Landseed again in the future</span>
          </label>

          {error && <div style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#dc2626", padding: "10px 14px", borderRadius: 10, fontSize: 13 }}>{error}</div>}

          {/* Actions */}
          <div style={{ display: "flex", gap: 12, paddingTop: 8, borderTop: "1px solid #f3f4f6" }}>
            <button onClick={() => { setStep("decision"); setError(null); }} disabled={isSubmitting} style={{
              flex: 1, padding: "12px", borderRadius: 10, border: "1px solid #d1d5db", background: "#fff", color: "#374151", fontWeight: 600, fontSize: 14, cursor: "pointer",
            }}>Go Back</button>
            <button id="submit-decline-btn" onClick={handleDeclineSubmit} disabled={isSubmitting || !canSubmit} style={{
              flex: 1, padding: "12px", borderRadius: 10, border: "none",
              background: canSubmit ? "linear-gradient(135deg, #dc2626, #b91c1c)" : "#e5e7eb",
              color: canSubmit ? "#fff" : "#9ca3af", fontWeight: 700, fontSize: 14,
              cursor: canSubmit ? "pointer" : "not-allowed", opacity: isSubmitting ? 0.6 : 1,
            }}>
              {isSubmitting ? "Submitting..." : "Submit & Decline"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
