"use client";

import React from "react";
import Image from "next/image";
import { Button } from "@/frontend/components/ui/button";

type PhotoItem = {
  id: string;
  imageUrl: string | null;
  generatedImageUrl?: string | null;
};

export function ProjectVisualizationGallery({
  photos,
}: {
  photos: PhotoItem[];
}) {
  const [viewMode, setViewMode] = React.useState<"original" | "generated">(
    "original"
  );

  const hasGeneratedImages = photos.some(
    (photo) => photo.generatedImageUrl
  );

  return (
    <div className="rounded-md border p-4 bg-white shadow-sm">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Space Visualizations</h2>
          <p className="text-sm text-gray-500">
            Toggle between your original uploaded photos and AI-generated
            modification visuals.
          </p>
        </div>

        <div className="flex gap-2">
          <Button
            type="button"
            variant={viewMode === "original" ? "default" : "outline"}
            onClick={() => setViewMode("original")}
          >
            Original Photos
          </Button>

          <Button
            type="button"
            variant={viewMode === "generated" ? "default" : "outline"}
            onClick={() => setViewMode("generated")}
            disabled={!hasGeneratedImages}
          >
            AI Visuals
          </Button>
        </div>
      </div>

      {photos.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {photos.map((photo) => {
            const currentSrc =
              viewMode === "generated"
                ? photo.generatedImageUrl || photo.imageUrl
                : photo.imageUrl;

            return (
              <div
                key={photo.id}
                className="overflow-hidden rounded-md border"
              >
                <Image
                src={currentSrc ?? "https://placehold.co/300x200?text=No+image"}
                alt="Project photo"
                width={300}
                height={200}
                className="h-auto w-full object-cover"
                />

                <div className="border-t bg-gray-50 px-3 py-2 text-sm text-gray-600">
                  {viewMode === "generated"
                    ? photo.generatedImageUrl
                      ? "AI-generated modification visual"
                      : "AI visual not available yet — showing original"
                    : "Original uploaded photo"}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-gray-500">
          No photos submitted for this project.
        </p>
      )}
    </div>
  );
}