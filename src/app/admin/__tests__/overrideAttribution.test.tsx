import React from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { AdminDashboardClient, SerializedProject } from "../AdminDashboardClient";
import type { OverrideAttribution } from "@/backend/services/overrideAttributionLabels";
import "@testing-library/jest-dom";

jest.mock("next/link", () => {
  const MockLink = ({ children, href }: { children: React.ReactNode; href: string }) => {
    return <a href={href}>{children}</a>;
  };
  MockLink.displayName = "MockLink";
  return MockLink;
});

// AdminDashboardClient renders StaffNotesPanel, which calls useSession().
jest.mock("next-auth/react", () => ({
  useSession: jest.fn(() => ({ data: null, status: "unauthenticated" })),
}));

// ProjectDetailPanel (rendered on row expand) calls useRouter().
jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: jest.fn(),
  }),
}));

function buildProject(overrideAttribution: OverrideAttribution | null): SerializedProject {
  return {
    id: "proj-attr-1",
    address: "300 Override Ave",
    status: "ESTIMATE_READY",
    statusHistory: [],
    createdAt: new Date("2026-10-01T10:00:00Z").toISOString(),
    updatedAt: new Date("2026-10-01T10:00:00Z").toISOString(),
    modificationType: "GRAB_BARS",
    client: { id: "u-attr-1", name: "Client Person", email: "client@example.com" },
    photoCount: 0,
    documentCount: 0,
    documentsPendingReview: 0,
    quote: {
      id: "quote-1",
      subtotal: "1000.00",
      total: "1100.00",
      status: "PENDING",
      generatedAt: new Date("2026-10-02T10:00:00Z").toISOString(),
      openQuestions: 0,
    },
    eligibility: {
      id: "assessment-1",
      overallDecision: "ELIGIBLE",
      discoveredGrants: [],
      provider: "OPENAI",
      assessedAt: new Date("2026-10-03T10:00:00Z").toISOString(),
    },
    overrideAttribution,
    manualFallbackExport: null,
  };
}

function openProject(project: SerializedProject) {
  render(<AdminDashboardClient projects={[project]} userName="Advisor" />);
  fireEvent.click(screen.getByText(project.address));
}

describe("Admin dashboard override attribution", () => {
  it("shows the assessment label in the AI Grant Discovery panel", () => {
    openProject(
      buildProject({
        assessment: {
          adminAction: "REASSESS",
          adminName: "Dana Admin",
          at: "2026-10-03T15:00:00.000Z",
          stage: "post-estimate",
        },
        postEstimateOverride: null,
        clientOverridden: false,
      })
    );

    expect(screen.getByText(/^Re-assessed by Dana Admin on .+ \(post-estimate\)$/)).toBeInTheDocument();
  });

  it("shows pre-estimate override and manual grants labels", () => {
    const { unmount } = render(
      <AdminDashboardClient
        projects={[
          buildProject({
            assessment: {
              adminAction: "PRE_ESTIMATE_OVERRIDE",
              adminName: "Dana Admin",
              at: "2026-10-03T15:00:00.000Z",
              stage: "pre-estimate",
            },
            postEstimateOverride: null,
            clientOverridden: false,
          }),
        ]}
        userName="Advisor"
      />
    );
    fireEvent.click(screen.getByText("300 Override Ave"));
    expect(screen.getByText(/^Pre-estimate override by Dana Admin on /)).toBeInTheDocument();
    unmount();

    openProject(
      buildProject({
        assessment: {
          adminAction: "MANUAL_GRANTS",
          adminName: "a former staff member",
          at: "2026-10-03T15:00:00.000Z",
          stage: "pre-estimate",
        },
        postEstimateOverride: null,
        clientOverridden: false,
      })
    );
    expect(screen.getByText(/^Manual grants entered by a former staff member on /)).toBeInTheDocument();
  });

  it("shows a single post-estimate override without an edit count or history", () => {
    openProject(
      buildProject({
        assessment: null,
        postEstimateOverride: {
          adminName: "Sam Staff",
          at: "2026-10-04T09:00:00.000Z",
          editCount: 1,
          history: [{ adminName: "Sam Staff", at: "2026-10-04T09:00:00.000Z" }],
        },
        clientOverridden: true,
      })
    );

    expect(screen.getByText(/^Post-estimate override by Sam Staff on [^(]+$/)).toBeInTheDocument();
    expect(screen.queryByText("Override history")).not.toBeInTheDocument();
  });

  it("shows the edit count and an expandable history for repeated overrides", () => {
    openProject(
      buildProject({
        assessment: null,
        postEstimateOverride: {
          adminName: "Sam Staff",
          at: "2026-10-05T09:00:00.000Z",
          editCount: 2,
          history: [
            { adminName: "Sam Staff", at: "2026-10-05T09:00:00.000Z" },
            { adminName: "Dana Admin", at: "2026-10-04T09:00:00.000Z" },
          ],
        },
        clientOverridden: true,
      })
    );

    expect(screen.getByText(/^Post-estimate override by Sam Staff on .+ \(edited 2 times\)$/)).toBeInTheDocument();
    const history = screen.getByText("Override history").closest("details")!;
    const items = within(history).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent(/^Sam Staff on /);
    expect(items[1]).toHaveTextContent(/^Dana Admin on /);
  });

  it("shows no attribution when there is none", () => {
    openProject(buildProject(null));

    expect(screen.queryByText(/override by|Re-assessed by|Manual grants entered by/)).not.toBeInTheDocument();
  });
});
