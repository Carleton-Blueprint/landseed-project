"use client";

import React from "react";
import Image from "next/image";
import { CameraIcon, HourglassIcon } from "@/frontend/components/icons";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

type PhotoItem = {
  id: string;
  imageUrl: string | null;
  generatedImageUrl?: string | null;
};

type ViewMode = "original" | "generated" | "compare";

/* ------------------------------------------------------------------ */
/* Before / After Comparison Slider                                    */
/* ------------------------------------------------------------------ */

function ComparisonSlider({
  beforeSrc,
  afterSrc,
  alt,
}: {
  beforeSrc: string;
  afterSrc: string;
  alt: string;
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [position, setPosition] = React.useState(50);
  const dragging = React.useRef(false);

  const updatePosition = React.useCallback(
    (clientX: number) => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
      setPosition((x / rect.width) * 100);
    },
    []
  );

  React.useEffect(() => {
    const onMove = (e: MouseEvent | TouchEvent) => {
      if (!dragging.current) return;
      e.preventDefault();
      const clientX =
        "touches" in e ? e.touches[0].clientX : e.clientX;
      updatePosition(clientX);
    };
    const onUp = () => {
      dragging.current = false;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onUp);
    };
  }, [updatePosition]);

  return (
    <div
      ref={containerRef}
      className="relative w-full select-none overflow-hidden rounded-lg border"
      style={{ aspectRatio: "3/2", cursor: "ew-resize" }}
      onMouseDown={(e) => {
        dragging.current = true;
        updatePosition(e.clientX);
      }}
      onTouchStart={(e) => {
        dragging.current = true;
        updatePosition(e.touches[0].clientX);
      }}
      role="slider"
      aria-valuenow={Math.round(position)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Before and after comparison slider"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") setPosition((p) => Math.max(0, p - 2));
        if (e.key === "ArrowRight") setPosition((p) => Math.min(100, p + 2));
      }}
    >
      {/* After (full-width background) */}
      <Image
        src={afterSrc}
        alt={`${alt} — InPlace AI rendition`}
        fill
        className="object-cover"
        sizes="(max-width: 640px) 100vw, 50vw"
      />

      {/* Before (clipped) */}
      <div
        className="absolute inset-0 overflow-hidden"
        style={{ width: `${position}%` }}
      >
        <Image
          src={beforeSrc}
          alt={`${alt} — Original`}
          fill
          className="object-cover"
          sizes="(max-width: 640px) 100vw, 50vw"
        />
      </div>

      {/* Divider line */}
      <div
        className="absolute top-0 bottom-0 z-10 w-0.5 bg-white/90 shadow"
        style={{ left: `${position}%`, transform: "translateX(-50%)" }}
      />

      {/* Handle */}
      <div
        className="absolute top-1/2 z-20 flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white bg-white/90 shadow-lg backdrop-blur-sm transition-transform hover:scale-110"
        style={{ left: `${position}%` }}
      >
        <svg
          width={20}
          height={20}
          viewBox="0 0 20 20"
          fill="none"
          className="text-gray-700"
        >
          <path d="M7 4L3 10L7 16" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          <path d="M13 4L17 10L13 16" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>

      {/* Labels */}
      <span className="absolute left-3 top-3 z-10 rounded-md bg-black/60 px-2 py-0.5 text-xs font-medium text-white backdrop-blur-sm">
        Original
      </span>
      <span className="absolute right-3 top-3 z-10 rounded-md bg-violet-600/80 px-2 py-0.5 text-xs font-medium text-white backdrop-blur-sm">
        InPlace AI Rendition
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Lightbox Modal                                                      */
/* ------------------------------------------------------------------ */

function LightboxModal({
  src,
  alt,
  label,
  onClose,
}: {
  src: string;
  alt: string;
  label: string;
  onClose: () => void;
}) {
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={alt}
    >
      <div
        className="relative max-h-[90vh] max-w-[90vw] overflow-hidden rounded-xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          aria-label="Close lightbox"
        >
          ✕
        </button>
        <Image
          src={src}
          alt={alt}
          width={1200}
          height={800}
          className="max-h-[85vh] w-auto object-contain"
        />
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent px-4 py-3">
          <p className="text-sm font-medium text-white/90">{label}</p>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main Gallery Component                                              */
/* ------------------------------------------------------------------ */

export function ProjectVisualizationGallery({
  photos,
}: {
  photos: PhotoItem[];
}) {
  const [viewMode, setViewMode] = React.useState<ViewMode>("original");
  const [lightbox, setLightbox] = React.useState<{
    src: string;
    alt: string;
    label: string;
  } | null>(null);

  const viewModes: { key: ViewMode; label: string; icon: React.ReactNode; disabled?: boolean }[] = [
    { key: "original", label: "Original Photos", icon: <CameraIcon size={16} /> },
    { key: "generated", label: "InPlace AI Renditions", icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" /></svg>, disabled: photos.length === 0 },
    { key: "compare", label: "Visual Comparison (Before / After)", icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3H5a2 2 0 00-2 2v14a2 2 0 002 2h3M16 3h3a2 2 0 012 2v14a2 2 0 01-2 2h-3M12 3v18" /></svg>, disabled: photos.length === 0 },
  ];

  return (
    <div className="rounded-xl border bg-white p-5 shadow-sm">
      {/* Header */}
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap mb-1">
            <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <svg
                className="h-5 w-5 text-indigo-500"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.41a2.25 2.25 0 013.182 0l2.909 2.91m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z"
                />
              </svg>
              Space Visualizations
            </h2>
            <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-violet-600 to-indigo-600 px-3 py-0.5 text-xs font-semibold text-white shadow-sm">
              ✨ Visual Comparison Gallery
            </span>
          </div>
          <p className="text-sm text-gray-500">
            {viewMode === "compare"
              ? "Compare original senior-submitted photos side-by-side with InPlace AI-generated renovation renditions and interactive overlay sliders."
              : "Toggle between your original uploaded photos and InPlace AI-generated modification visuals."}
          </p>
        </div>

        <div className="flex gap-1.5 rounded-lg border bg-gray-100 p-1">
          {viewModes.map((mode) => (
            <button
              key={mode.key}
              type="button"
              disabled={mode.disabled}
              onClick={() => setViewMode(mode.key)}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-all duration-150 ${
                viewMode === mode.key
                  ? "bg-white text-gray-900 shadow-sm"
                  : mode.disabled
                  ? "text-gray-400 cursor-not-allowed"
                  : "text-gray-600 hover:text-gray-900 hover:bg-white/60"
              }`}
              id={`viz-mode-${mode.key}`}
            >
              <span className="text-base flex items-center">{mode.icon}</span>
              <span className="hidden sm:inline">{mode.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Photo grid */}
      {photos.length > 0 ? (
        <div
          className={`grid gap-4 ${
            viewMode === "compare" ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2"
          }`}
        >
          {photos.map((photo, index) => {
            const originalSrc =
              photo.imageUrl ?? "https://placehold.co/600x400?text=No+image";
            const generatedSrc =
              photo.generatedImageUrl ??
              "https://placehold.co/600x400?text=InPlace+AI+visual+pending";

            /* --- Comparison slider mode --- */
            if (viewMode === "compare") {
              if (!photo.generatedImageUrl) {
                return (
                  <div
                    key={photo.id}
                    className="group relative overflow-hidden rounded-xl border border-dashed border-violet-200 bg-gradient-to-br from-violet-50/20 to-indigo-50/20 p-6 flex flex-col items-center justify-center text-center shadow-sm"
                    style={{ aspectRatio: "3/2" }}
                  >
                    <div className="relative mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-violet-100 text-violet-600 shadow-inner">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet-400 opacity-20"></span>
                      <HourglassIcon size={24} className="text-violet-600 animate-spin [animation-duration:3s]" />
                    </div>
                    <h4 className="text-sm font-semibold text-gray-900">Before & After Slider</h4>
                    <p className="mt-1 max-w-[260px] text-xs text-gray-500 leading-normal">
                      InPlace AI rendition pending — comparison will appear when generated.
                    </p>
                    <span className="mt-3.5 inline-flex items-center gap-1 rounded-full bg-violet-100 px-2.5 py-0.5 text-[10px] font-semibold text-violet-700">
                      <span className="h-1.5 w-1.5 rounded-full bg-violet-500 animate-pulse" />
                      Generating InPlace AI View
                    </span>
                  </div>
                );
              }
              return (
                <div
                  key={photo.id}
                  className="rounded-2xl border border-gray-200/80 bg-gradient-to-b from-white to-slate-50/50 p-5 sm:p-6 shadow-md transition-all duration-300 hover:shadow-lg"
                >
                  {/* Card Header */}
                  <div className="mb-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-gray-100 pb-4">
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-violet-100 text-violet-600 text-xs font-bold shadow-inner">
                        #{index + 1}
                      </span>
                      <div>
                        <h3 className="font-bold text-gray-900 text-base flex items-center gap-2">
                          Visual Comparison
                          <span className="hidden sm:inline-block h-1 w-1 rounded-full bg-gray-300" />
                          <span className="text-sm font-medium text-gray-500">Space Renovation Projection</span>
                        </h3>
                      </div>
                    </div>
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-violet-600/10 to-indigo-600/10 border border-violet-200/80 px-3 py-1 text-xs font-semibold text-violet-700 shadow-sm self-start sm:self-auto">
                      <span className="h-2 w-2 rounded-full bg-violet-600 animate-pulse" />
                      InPlace AI Rendition Active
                    </span>
                  </div>

                  {/* Side-by-Side Display Section */}
                  <div className="mb-6">
                    <div className="mb-3 flex items-center justify-between">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-gray-700 flex items-center gap-1.5">
                        <svg className="h-4 w-4 text-indigo-600" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25" />
                        </svg>
                        Side-by-Side View
                      </h4>
                      <span className="text-xs text-gray-500">Click either image to enlarge</span>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Left: Original Photo */}
                      <div
                        className="group relative overflow-hidden rounded-xl border border-gray-200 bg-slate-900 shadow-sm transition-all duration-300 hover:shadow-md cursor-pointer"
                        onClick={() =>
                          setLightbox({
                            src: originalSrc,
                            alt: "Original senior-submitted space",
                            label: "Original Senior-Submitted Photo (Before Renovation)",
                          })
                        }
                      >
                        <div className="relative w-full" style={{ aspectRatio: "3/2" }}>
                          <Image
                            src={originalSrc}
                            alt="Original senior-submitted space"
                            fill
                            className="object-cover transition-transform duration-500 group-hover:scale-105"
                            sizes="(max-width: 768px) 100vw, 50vw"
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent opacity-80 transition-opacity group-hover:opacity-70" />
                          <div className="absolute top-3 left-3 z-10 flex items-center gap-1.5 rounded-lg bg-black/60 backdrop-blur-md px-3 py-1.5 text-xs font-semibold text-white shadow-sm border border-white/10">
                            <CameraIcon size={14} className="text-gray-300" />
                            <span>Original Submitted Photo</span>
                          </div>
                          <div className="absolute bottom-3 left-3 right-3 z-10 flex items-center justify-between">
                            <p className="text-xs text-gray-200 font-medium">Existing Senior Home Space</p>
                            <span className="text-[10px] font-bold tracking-wider uppercase bg-gray-700/80 text-gray-300 px-2 py-0.5 rounded border border-gray-600">Before</span>
                          </div>
                        </div>
                      </div>

                      {/* Right: InPlace AI Renovation Rendition */}
                      <div
                        className="group relative overflow-hidden rounded-xl border border-violet-200 bg-violet-950 shadow-sm transition-all duration-300 hover:shadow-md cursor-pointer"
                        onClick={() =>
                          setLightbox({
                            src: generatedSrc,
                            alt: "InPlace AI renovation rendition",
                            label: "InPlace AI-Generated Renovation Rendition (Proposed Modifications)",
                          })
                        }
                      >
                        <div className="relative w-full" style={{ aspectRatio: "3/2" }}>
                          <Image
                            src={generatedSrc}
                            alt="InPlace AI renovation rendition"
                            fill
                            className="object-cover transition-transform duration-500 group-hover:scale-105"
                            sizes="(max-width: 768px) 100vw, 50vw"
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-violet-950/90 via-violet-950/10 to-transparent opacity-80 transition-opacity group-hover:opacity-70" />
                          <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5 rounded-lg bg-violet-600/90 backdrop-blur-md px-3 py-1.5 text-xs font-semibold text-white shadow-lg border border-violet-400/30">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" /></svg>
                            <span>InPlace AI Rendition</span>
                          </div>
                          <div className="absolute bottom-3 left-3 right-3 z-10 flex items-center justify-between">
                            <p className="text-xs text-violet-100 font-medium truncate pr-2">Proposed Renovation Projection</p>
                            <span className="text-[10px] font-bold tracking-wider uppercase bg-violet-500/50 text-violet-100 px-2 py-0.5 rounded border border-violet-400/40 shrink-0">After</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Interactive Slider Section */}
                  <div className="rounded-xl border border-gray-200/80 bg-gray-50/70 p-4">
                    <div className="mb-3 flex items-center justify-between flex-wrap gap-2">
                      <span className="text-xs font-bold text-gray-700 uppercase tracking-wider flex items-center gap-1.5">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-indigo-600"><path d="M8 3H5a2 2 0 00-2 2v14a2 2 0 002 2h3M16 3h3a2 2 0 012 2v14a2 2 0 01-2 2h-3M12 3v18" /></svg>
                        Interactive Transition Overlay
                      </span>
                      <span className="text-xs text-gray-500 bg-white px-2.5 py-1 rounded-md border border-gray-200 shadow-2xs font-medium">
                        ↔ Drag center slider left/right to compare
                      </span>
                    </div>
                    <ComparisonSlider
                      beforeSrc={originalSrc}
                      afterSrc={generatedSrc}
                      alt="Project space comparison"
                    />
                  </div>
                </div>
              );
            }

            /* --- Single image mode (original or generated) --- */
            const isShowingGenerated =
              viewMode === "generated" && !!photo.generatedImageUrl;
            
            const isPendingGenerated =
              viewMode === "generated" && !photo.generatedImageUrl;

            const displaySrc =
              viewMode === "generated"
                ? photo.generatedImageUrl || originalSrc
                : originalSrc;

            const label = isShowingGenerated
              ? "InPlace AI-generated modification visual"
              : isPendingGenerated
              ? "InPlace AI visual not available yet — showing original"
              : "Original uploaded photo";

            return (
              <div
                key={photo.id}
                className="group overflow-hidden rounded-xl border transition-shadow duration-200 hover:shadow-md cursor-pointer"
                onClick={() =>
                  setLightbox({
                    src: displaySrc,
                    alt: "Project photo",
                    label,
                  })
                }
              >
                <div className="relative" style={{ aspectRatio: "3/2" }}>
                  <Image
                    src={displaySrc}
                    alt="Project photo"
                    fill
                    className="object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                    sizes="(max-width: 640px) 100vw, 50vw"
                  />
                  {isShowingGenerated && (
                    <span className="absolute left-3 top-3 rounded-md bg-violet-600/80 px-2 py-0.5 text-xs font-medium text-white backdrop-blur-sm flex items-center gap-1">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" /></svg>
                      InPlace AI Rendition
                    </span>
                  )}
                  
                  {isPendingGenerated ? (
                    /* Frosted glass overlay for pending state */
                    <div className="absolute inset-0 bg-slate-900/65 backdrop-blur-[3px] flex flex-col items-center justify-center p-4 text-center">
                      <div className="relative mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-violet-500/20 text-violet-300 border border-violet-400/30">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet-400 opacity-20"></span>
                        <svg className="h-5 w-5 animate-pulse" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                        </svg>
                      </div>
                      <h4 className="text-sm font-semibold text-white">InPlace AI Visual Rendering</h4>
                      <p className="mt-1 max-w-[220px] text-xs text-slate-300 leading-normal">
                        Visual projection is generating. The original photo will be updated automatically.
                      </p>
                      <span className="mt-3 inline-flex items-center gap-1 rounded-full bg-violet-500/30 border border-violet-400/40 px-2.5 py-0.5 text-[10px] font-medium text-violet-200">
                        <span className="h-1.5 w-1.5 rounded-full bg-violet-400 animate-pulse" />
                        Processing
                      </span>
                    </div>
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors duration-200 group-hover:bg-black/10">
                      <svg
                        className="h-8 w-8 text-white opacity-0 transition-opacity duration-200 group-hover:opacity-80 drop-shadow-md"
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth={1.5}
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607zM10.5 7.5v6m3-3h-6"
                        />
                      </svg>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 border-t bg-gray-50/80 px-3 py-2 text-sm text-gray-600">
                  {isShowingGenerated ? (
                    <span className="inline-block h-2 w-2 rounded-full bg-violet-500" />
                  ) : isPendingGenerated ? (
                    <span className="inline-block h-2 w-2 rounded-full bg-violet-400 animate-pulse" />
                  ) : (
                    <span className="inline-block h-2 w-2 rounded-full bg-gray-400" />
                  )}
                  {label}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex items-center gap-3 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-6">
          <CameraIcon size={24} className="text-gray-400" />
          <div>
            <p className="text-sm font-medium text-gray-700">No Photos Submitted</p>
            <p className="text-xs text-gray-500">
              Upload project photos to see InPlace AI-generated visual renditions of proposed modifications.
            </p>
          </div>
        </div>
      )}

      {/* Lightbox */}
      {lightbox && (
        <LightboxModal
          src={lightbox.src}
          alt={lightbox.alt}
          label={lightbox.label}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  );
}