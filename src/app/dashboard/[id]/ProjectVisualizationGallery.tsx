"use client";

import React from "react";
import Image from "next/image";
import { Button } from "@/frontend/components/ui/button";

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
        alt={`${alt} — AI rendition`}
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
        AI Rendition
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

  const hasGeneratedImages = photos.some(
    (photo) => photo.generatedImageUrl
  );

  const viewModes: { key: ViewMode; label: string; icon: string; disabled?: boolean }[] = [
    { key: "original", label: "Original Photos", icon: "📷" },
    { key: "generated", label: "AI Renditions", icon: "✨", disabled: !hasGeneratedImages },
    { key: "compare", label: "Before / After", icon: "↔️", disabled: !hasGeneratedImages },
  ];

  return (
    <div className="rounded-xl border bg-white p-5 shadow-sm">
      {/* Header */}
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
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
          <p className="text-sm text-gray-500">
            {viewMode === "compare"
              ? "Drag the slider to compare original photos with AI-generated modification visuals."
              : "Toggle between your original uploaded photos and AI-generated modification visuals."}
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
              <span className="text-base">{mode.icon}</span>
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
          {photos.map((photo) => {
            const originalSrc =
              photo.imageUrl ?? "https://placehold.co/600x400?text=No+image";
            const generatedSrc =
              photo.generatedImageUrl ??
              "https://placehold.co/600x400?text=AI+visual+pending";

            /* --- Comparison slider mode --- */
            if (viewMode === "compare") {
              if (!photo.generatedImageUrl) {
                return (
                  <div
                    key={photo.id}
                    className="flex items-center gap-3 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4"
                  >
                    <span className="text-xl">⏳</span>
                    <p className="text-sm text-gray-500">
                      AI rendition pending — comparison will appear when generated.
                    </p>
                  </div>
                );
              }
              return (
                <ComparisonSlider
                  key={photo.id}
                  beforeSrc={originalSrc}
                  afterSrc={generatedSrc}
                  alt="Project space"
                />
              );
            }

            /* --- Single image mode (original or generated) --- */
            const displaySrc =
              viewMode === "generated"
                ? photo.generatedImageUrl || originalSrc
                : originalSrc;

            const isShowingGenerated =
              viewMode === "generated" && !!photo.generatedImageUrl;

            const label = isShowingGenerated
              ? "AI-generated modification visual"
              : viewMode === "generated" && !photo.generatedImageUrl
              ? "AI visual not available yet — showing original"
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
                    <span className="absolute left-3 top-3 rounded-md bg-violet-600/80 px-2 py-0.5 text-xs font-medium text-white backdrop-blur-sm">
                      ✨ AI Rendition
                    </span>
                  )}
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
                </div>

                <div className="flex items-center gap-2 border-t bg-gray-50/80 px-3 py-2 text-sm text-gray-600">
                  {isShowingGenerated ? (
                    <span className="inline-block h-2 w-2 rounded-full bg-violet-500" />
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
          <span className="text-2xl">📸</span>
          <div>
            <p className="text-sm font-medium text-gray-700">No Photos Submitted</p>
            <p className="text-xs text-gray-500">
              Upload project photos to see AI-generated visual renditions of proposed modifications.
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