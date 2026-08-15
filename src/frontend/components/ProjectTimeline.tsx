"use client";

import React, { useState } from "react";
import {
  GrabBarIcon,
  DropletIcon,
  ShowerIcon,
  DoorIcon,
  StairsIcon,
  HandrailIcon,
  WrenchIcon,
} from "@/frontend/components/icons";

/* ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ */

const MOD_ICON_MAP: Record<string, (props: { size: number; className?: string }) => React.ReactNode> = {
  "Grab bars":       (p) => <GrabBarIcon {...p} />,
  "Raised toilet":   (p) => <DropletIcon {...p} />,
  "Walk-in shower":  (p) => <ShowerIcon {...p} />,
  "Widened doorway": (p) => <DoorIcon {...p} />,
  "Stair lift":      (p) => <StairsIcon {...p} />,
  "Handrails":       (p) => <HandrailIcon {...p} />,
};
const FALLBACK_ICON_FN = (p: { size: number; className?: string }) => <WrenchIcon {...p} />;

/* ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ */

type Phase = { name: string; days: number; color: string };

const MODIFICATION_TIMELINE: Record<
  string,
  { label: string; daysMin: number; daysMax: number; phases: Phase[] }
> = {
  "Grab bars": {
    label: "Grab Bars",
    daysMin: 1,
    daysMax: 2,
    phases: [
      { name: "Site Assessment", days: 0.5, color: "#818cf8" },
      { name: "Installation", days: 0.5, color: "#34d399" },
      { name: "Inspection", days: 0.5, color: "#fbbf24" },
    ],
  },
  "Raised toilet": {
    label: "Raised Toilet",
    daysMin: 1,
    daysMax: 2,
    phases: [
      { name: "Plumbing Assessment", days: 0.5, color: "#818cf8" },
      { name: "Removal & Prep", days: 0.5, color: "#f87171" },
      { name: "Installation", days: 0.5, color: "#34d399" },
      { name: "Testing", days: 0.5, color: "#fbbf24" },
    ],
  },
  "Walk-in shower": {
    label: "Walk-In Shower",
    daysMin: 5,
    daysMax: 10,
    phases: [
      { name: "Design & Planning", days: 1, color: "#818cf8" },
      { name: "Demolition", days: 1.5, color: "#f87171" },
      { name: "Plumbing Rough-In", days: 1.5, color: "#60a5fa" },
      { name: "Waterproofing & Tile", days: 3, color: "#34d399" },
      { name: "Fixtures & Finish", days: 1.5, color: "#a78bfa" },
      { name: "Inspection", days: 0.5, color: "#fbbf24" },
    ],
  },
  "Widened doorway": {
    label: "Widened Doorway",
    daysMin: 2,
    daysMax: 4,
    phases: [
      { name: "Structural Assessment", days: 0.5, color: "#818cf8" },
      { name: "Framing & Header", days: 1, color: "#f87171" },
      { name: "Drywall & Finish", days: 1, color: "#34d399" },
      { name: "Door Installation", days: 0.5, color: "#a78bfa" },
      { name: "Paint & Trim", days: 0.5, color: "#fbbf24" },
    ],
  },
  "Stair lift": {
    label: "Stair Lift",
    daysMin: 3,
    daysMax: 5,
    phases: [
      { name: "Stairway Survey", days: 0.5, color: "#818cf8" },
      { name: "Rail Fabrication", days: 1.5, color: "#60a5fa" },
      { name: "Electrical Prep", days: 0.5, color: "#f87171" },
      { name: "Rail & Unit Install", days: 1, color: "#34d399" },
      { name: "Calibration & Safety Test", days: 0.5, color: "#fbbf24" },
    ],
  },
  "Handrails": {
    label: "Handrails",
    daysMin: 1,
    daysMax: 2,
    phases: [
      { name: "Measurement", days: 0.5, color: "#818cf8" },
      { name: "Installation", days: 0.5, color: "#34d399" },
      { name: "Inspection", days: 0.5, color: "#fbbf24" },
    ],
  },
};

const FALLBACK_TIMELINE = {
  label: "Custom Modification",
  daysMin: 2,
  daysMax: 5,
  phases: [
    { name: "Assessment", days: 1, color: "#818cf8" },
    { name: "Execution", days: 2, color: "#34d399" },
    { name: "Inspection", days: 0.5, color: "#fbbf24" },
  ],
};

/* ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ */

function getTimeline(item: string) {
  return MODIFICATION_TIMELINE[item] ?? { ...FALLBACK_TIMELINE, label: formatLabel(item) };
}

function getIconFn(item: string) {
  return MOD_ICON_MAP[item] ?? FALLBACK_ICON_FN;
}

function formatLabel(s: string) {
  return s.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function sumDays(phases: Phase[]) {
  return phases.reduce((s, p) => s + p.days, 0);
}

/* ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ */

interface ProjectTimelineProps {
  modificationItems: string[];
}

export function ProjectTimeline({ modificationItems }: ProjectTimelineProps) {
  const [expandedItem, setExpandedItem] = useState<string | null>(null);

  if (!modificationItems.length) return null;

  const timelines = modificationItems.map(item => ({ key: item, ...getTimeline(item) }));
  const totalMin = timelines.reduce((s, t) => s + t.daysMin, 0);
  const totalMax = timelines.reduce((s, t) => s + t.daysMax, 0);
  const totalWeeksMin = Math.ceil(totalMin / 5);
  const totalWeeksMax = Math.ceil(totalMax / 5);

  return (
    <section id="project-timeline" aria-label="Project Timeline" style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      <div style={{
        background: "linear-gradient(135deg, #1e1b4b 0%, #312e81 50%, #4338ca 100%)",
        borderRadius: "16px 16px 0 0", padding: "24px", color: "#fff", position: "relative", overflow: "hidden",
      }}>
        <div style={{ position: "absolute", top: -30, right: -30, width: 140, height: 140, borderRadius: "50%", background: "rgba(255,255,255,0.05)", filter: "blur(30px)" }} />
        <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 12, background: "rgba(255,255,255,0.15)",
            backdropFilter: "blur(8px)", border: "1px solid rgba(255,255,255,0.2)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
          </div>
          <div>
            <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Project Timeline</h3>
            <p style={{ fontSize: 13, opacity: 0.75, margin: "2px 0 0" }}>
              Estimated duration for your home modifications
            </p>
          </div>
        </div>

        <div style={{ position: "relative", zIndex: 1, display: "flex", gap: 12, marginTop: 16, flexWrap: "wrap" }}>
          <div style={{
            background: "rgba(255,255,255,0.12)", backdropFilter: "blur(6px)",
            border: "1px solid rgba(255,255,255,0.15)", borderRadius: 10, padding: "8px 14px",
          }}>
            <p style={{ fontSize: 11, opacity: 0.7, margin: 0, textTransform: "uppercase", letterSpacing: "0.5px", fontWeight: 600 }}>Total Duration</p>
            <p style={{ fontSize: 18, fontWeight: 700, margin: "2px 0 0" }}>
              {totalMin === totalMax ? `~${totalMin} days` : `${totalMin}--${totalMax} days`}
            </p>
          </div>
          <div style={{
            background: "rgba(255,255,255,0.12)", backdropFilter: "blur(6px)",
            border: "1px solid rgba(255,255,255,0.15)", borderRadius: 10, padding: "8px 14px",
          }}>
            <p style={{ fontSize: 11, opacity: 0.7, margin: 0, textTransform: "uppercase", letterSpacing: "0.5px", fontWeight: 600 }}>Approx. Weeks</p>
            <p style={{ fontSize: 18, fontWeight: 700, margin: "2px 0 0" }}>
              {totalWeeksMin === totalWeeksMax ? `${totalWeeksMin}` : `${totalWeeksMin}--${totalWeeksMax}`} week{totalWeeksMax !== 1 ? "s" : ""}
            </p>
          </div>
          <div style={{
            background: "rgba(255,255,255,0.12)", backdropFilter: "blur(6px)",
            border: "1px solid rgba(255,255,255,0.15)", borderRadius: 10, padding: "8px 14px",
          }}>
            <p style={{ fontSize: 11, opacity: 0.7, margin: 0, textTransform: "uppercase", letterSpacing: "0.5px", fontWeight: 600 }}>Modifications</p>
            <p style={{ fontSize: 18, fontWeight: 700, margin: "2px 0 0" }}>
              {timelines.length} item{timelines.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>
      </div>

      <div style={{
        background: "#fff", border: "1px solid #e5e7eb", borderTop: "none",
        borderRadius: "0 0 16px 16px", padding: "20px 24px",
      }}>
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, alignItems: "center" }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.5px" }}>
              Overview
            </span>
            <span style={{ fontSize: 12, color: "#9ca3af" }}>
              Sequential execution estimate
            </span>
          </div>
          <div style={{ display: "flex", gap: 2, height: 8, borderRadius: 6, overflow: "hidden", background: "#f3f4f6" }}>
            {timelines.map(t => {
              const pct = (sumDays(t.phases) / (totalMax || 1)) * 100;
              return (
                <div key={t.key} title={`${t.label}: ~${sumDays(t.phases)} days`} style={{
                  width: `${pct}%`, minWidth: 4,
                  background: `linear-gradient(135deg, ${t.phases[0]?.color || "#818cf8"}, ${t.phases[t.phases.length - 1]?.color || "#34d399"})`,
                  borderRadius: 4, transition: "width 0.3s ease",
                }} />
              );
            })}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {timelines.map((t, idx) => {
            const isExpanded = expandedItem === t.key;
            const totalPhaseDays = sumDays(t.phases);

            return (
              <div key={t.key} id={`timeline-item-${idx}`} style={{
                border: isExpanded ? "1.5px solid #c7d2fe" : "1px solid #e5e7eb",
                borderRadius: 12, overflow: "hidden",
                background: isExpanded ? "#fafafe" : "#fff",
                transition: "all 0.2s ease",
              }}>
                <button type="button" onClick={() => setExpandedItem(isExpanded ? null : t.key)}
                  style={{
                    width: "100%", display: "flex", alignItems: "center", gap: 12,
                    padding: "14px 16px", background: "none", border: "none", cursor: "pointer",
                    textAlign: "left",
                  }}>
                  <div style={{
                    width: 40, height: 40, borderRadius: 10,
                    background: isExpanded ? "#eef2ff" : "#f9fafb",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    flexShrink: 0, transition: "background 0.2s",
                  }}>
                    {getIconFn(t.key)({ size: 18, className: isExpanded ? "text-indigo-700" : "text-gray-500" })}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 14, fontWeight: 600, color: "#1f2937", margin: 0 }}>{t.label}</p>
                    <p style={{ fontSize: 12, color: "#9ca3af", margin: "2px 0 0" }}>
                      {t.daysMin === t.daysMax ? `~${t.daysMin} day${t.daysMin !== 1 ? "s" : ""}` : `${t.daysMin}--${t.daysMax} days`}
                      {" / "}{t.phases.length} phase{t.phases.length !== 1 ? "s" : ""}
                    </p>
                  </div>

                  <div style={{ width: 80, display: "flex", gap: 1, height: 6, borderRadius: 4, overflow: "hidden", flexShrink: 0 }}>
                    {t.phases.map((p, pi) => (
                      <div key={pi} style={{
                        flex: p.days, background: p.color, minWidth: 3, borderRadius: 2,
                      }} />
                    ))}
                  </div>

                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2"
                    style={{ flexShrink: 0, transition: "transform 0.2s", transform: isExpanded ? "rotate(180deg)" : "rotate(0)" }}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {isExpanded && (
                  <div style={{ padding: "0 16px 16px", borderTop: "1px solid #f3f4f6" }}>
                    <div style={{ display: "flex", gap: 2, height: 12, borderRadius: 6, overflow: "hidden", margin: "14px 0 16px", background: "#f3f4f6" }}>
                      {t.phases.map((p, pi) => (
                        <div key={pi} title={`${p.name}: ${p.days} day${p.days !== 1 ? "s" : ""}`} style={{
                          flex: p.days, background: p.color, minWidth: 6, borderRadius: 4,
                          position: "relative",
                        }} />
                      ))}
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                      {t.phases.map((p, pi) => {
                        const phasePct = Math.round((p.days / totalPhaseDays) * 100);
                        const isLast = pi === t.phases.length - 1;
                        return (
                          <div key={pi} style={{ display: "flex", gap: 12, position: "relative", paddingBottom: isLast ? 0 : 16 }}>
                            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 20, flexShrink: 0 }}>
                              <div style={{
                                width: 12, height: 12, borderRadius: "50%", background: p.color,
                                border: "2px solid #fff", boxShadow: `0 0 0 2px ${p.color}33`,
                                flexShrink: 0, zIndex: 1,
                              }} />
                              {!isLast && (
                                <div style={{ width: 2, flex: 1, background: `linear-gradient(${p.color}, ${t.phases[pi + 1]?.color || "#e5e7eb"})`, marginTop: 2 }} />
                              )}
                            </div>

                            <div style={{ flex: 1, paddingTop: 0 }}>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <span style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>{p.name}</span>
                                <span style={{ fontSize: 11, color: "#9ca3af", fontWeight: 500 }}>
                                  {p.days} day{p.days !== 1 ? "s" : ""} / {phasePct}%
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div style={{
          marginTop: 16, padding: "10px 14px", borderRadius: 10,
          background: "#fffbeb", border: "1px solid #fde68a",
          display: "flex", gap: 8, alignItems: "flex-start",
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#92400e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
          <p style={{ fontSize: 12, color: "#92400e", margin: 0, lineHeight: 1.5 }}>
            Timelines are estimates based on typical project complexity. Actual durations may vary depending on site conditions, material availability, and permit requirements. Your advisory specialist will provide a precise schedule after acceptance.
          </p>
        </div>
      </div>
    </section>
  );
}
