import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { AdminDashboardClient, SerializedProject } from "../AdminDashboardClient";
import "@testing-library/jest-dom";

jest.mock("next/link", () => {
  const MockLink = ({ children, href }: { children: React.ReactNode; href: string }) => {
    return <a href={href}>{children}</a>;
  };
  MockLink.displayName = "MockLink";
  return MockLink;
});

const mockProjectWithSubmission: SerializedProject = {
  id: "proj-submission-1",
  address: "100 Senior Way",
  status: "submitted",
  createdAt: new Date("2026-07-01T10:00:00Z").toISOString(),
  updatedAt: new Date("2026-07-01T10:00:00Z").toISOString(),
  modificationType: "GRAB_BARS",
  client: { id: "u-sub-1", name: "Eleanor Vance", email: "eleanor@example.com" },
  photoCount: 2,
  documentCount: 0,
  documentsPendingReview: 0,
  quote: null,
  eligibility: null,
  builderTrendTransfer: null,
  submissionData: {
    name: "Eleanor Vance",
    email: "eleanor@example.com",
    phone: "555-0199",
    addressLine1: "100 Senior Way",
    city: "Ottawa",
    province: "ON",
    postalCode: "K1A 0B1",
    ownershipStatus: "owner",
    isCaregiver: true,
    seniorName: "Arthur Vance",
    relationshipToSenior: "Daughter",
    caregiverConsentConfirmed: true,
    modificationItems: ["Grab Bars in Shower", "Handrail on front steps"],
    additionalDetails: "Please call before arriving.",
    urgency: "within_month",
    submittedAt: new Date("2026-07-01T11:00:00Z").toISOString(),
  },
  photos: [
    {
      id: "photo-1",
      url: "https://example.com/photo1.jpg",
      virus_scan_status: "clean",
      createdAt: new Date("2026-07-01T10:30:00Z").toISOString(),
    },
    {
      id: "photo-2",
      url: "https://example.com/photo2.jpg",
      virus_scan_status: "clean",
      createdAt: new Date("2026-07-01T10:31:00Z").toISOString(),
    },
  ],
};

const mockProjectEmptySubmission: SerializedProject = {
  id: "proj-empty-1",
  address: "200 Empty Rd",
  status: "draft",
  createdAt: new Date("2026-07-02T10:00:00Z").toISOString(),
  updatedAt: new Date("2026-07-02T10:00:00Z").toISOString(),
  modificationType: "RAMPS",
  client: { id: "u-empty-1", name: "George Smith", email: "george@example.com" },
  photoCount: 0,
  documentCount: 0,
  documentsPendingReview: 0,
  quote: null,
  eligibility: null,
  builderTrendTransfer: null,
};

describe("Admin Dashboard Detail View", () => {
  it("renders full submission details when a project row is expanded", () => {
    render(<AdminDashboardClient projects={[mockProjectWithSubmission]} userName="Advisor" />);

    // Click on the row or address to expand detail view
    const projectRow = screen.getByText("100 Senior Way");
    fireEvent.click(projectRow);

    // Verify section header
    expect(screen.getByText("Client Intake Submission Details")).toBeInTheDocument();

    // Verify Client Info
    expect(screen.getByText("555-0199")).toBeInTheDocument();
    expect(screen.getByText(/Ottawa, ON, K1A 0B1/)).toBeInTheDocument();

    // Verify Scope & Modifications
    expect(screen.getByText("Grab Bars in Shower")).toBeInTheDocument();
    expect(screen.getByText("Handrail on front steps")).toBeInTheDocument();
    expect(screen.getByText("Please call before arriving.")).toBeInTheDocument();

    // Verify Caregiver Info
    expect(screen.getByText("Arthur Vance")).toBeInTheDocument();
    expect(screen.getByText("Daughter")).toBeInTheDocument();
    expect(screen.getByText("Caregiver consent confirmed")).toBeInTheDocument();

    // Verify Photos
    expect(screen.getByText("Submitted Photos (2)")).toBeInTheDocument();
    const images = screen.getAllByRole("img", { name: "Submitted photo" });
    expect(images).toHaveLength(2);
    expect(images[0]).toHaveAttribute("src", "https://example.com/photo1.jpg");
  });

  it("handles empty or missing submission data gracefully", () => {
    render(<AdminDashboardClient projects={[mockProjectEmptySubmission]} userName="Advisor" />);

    const projectRow = screen.getByText("200 Empty Rd");
    fireEvent.click(projectRow);

    expect(screen.getByText("Client Intake Submission Details")).toBeInTheDocument();
    expect(screen.getByText("Submitted directly by client (not a caregiver).")).toBeInTheDocument();
    expect(screen.getByText("No photos uploaded.")).toBeInTheDocument();
  });
});
