/**
 * Tests for ProjectVisualizationGallery component.
 * Verifies rendering of photo grids, view mode toggles, slider interactions, and empty states.
 */
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ProjectVisualizationGallery } from "@/app/dashboard/[id]/ProjectVisualizationGallery";

describe("ProjectVisualizationGallery", () => {
  const mockPhotos = [
    {
      id: "photo-1",
      imageUrl: "https://placehold.co/800x600?text=Original+Bathroom",
      generatedImageUrl: "https://placehold.co/800x600?text=AI+Rendition+Bathroom",
    },
    {
      id: "photo-2",
      imageUrl: "https://placehold.co/800x600?text=Original+Entryway",
      generatedImageUrl: null, // Test photo without generated image yet
    },
  ];

  it("renders correctly with default Original view mode", () => {
    render(<ProjectVisualizationGallery photos={mockPhotos} />);

    expect(screen.getByText("Space Visualizations")).toBeInTheDocument();
    expect(screen.getAllByText("Original uploaded photo").length).toBe(2);
    expect(
      screen.getByText("Toggle between your original uploaded photos and AI-generated modification visuals.")
    ).toBeInTheDocument();
  });

  it("renders view mode selection buttons", () => {
    render(<ProjectVisualizationGallery photos={mockPhotos} />);

    expect(screen.getByRole("button", { name: /original photos/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ai renditions/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /before \/ after/i })).toBeInTheDocument();
  });

  it("can switch to AI Renditions view mode", () => {
    render(<ProjectVisualizationGallery photos={mockPhotos} />);

    const aiButton = screen.getByRole("button", { name: /ai renditions/i });
    fireEvent.click(aiButton);

    expect(screen.getByText("AI-generated modification visual")).toBeInTheDocument();
    expect(screen.getByText("AI visual not available yet — showing original")).toBeInTheDocument();
  });

  it("can switch to Before / After slider view mode", () => {
    render(<ProjectVisualizationGallery photos={mockPhotos} />);

    const sliderButton = screen.getByRole("button", { name: /before \/ after/i });
    fireEvent.click(sliderButton);

    expect(screen.getByRole("slider")).toBeInTheDocument();
    expect(screen.getByText("AI rendition pending — comparison will appear when generated.")).toBeInTheDocument();
  });

  it("opens lightbox modal when a photo is clicked", () => {
    render(<ProjectVisualizationGallery photos={mockPhotos} />);

    const imageContainers = screen.getAllByRole("img");
    expect(imageContainers.length).toBeGreaterThan(0);

    // Click the first photo to open lightbox
    fireEvent.click(imageContainers[0].closest(".group")!);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /close lightbox/i })).toBeInTheDocument();

    // Close the lightbox
    fireEvent.click(screen.getByRole("button", { name: /close lightbox/i }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("displays empty state when photos list is empty", () => {
    render(<ProjectVisualizationGallery photos={[]} />);

    expect(screen.getByText("No Photos Submitted")).toBeInTheDocument();
    expect(
      screen.getByText("Upload project photos to see AI-generated visual renditions of proposed modifications.")
    ).toBeInTheDocument();
  });
});
