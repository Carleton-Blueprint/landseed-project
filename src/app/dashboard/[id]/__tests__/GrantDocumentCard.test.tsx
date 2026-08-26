/**
 * Tests for GrantDocumentCard: gating on assessment completeness, the
 * loading/generating state, the download button/link, and the background
 * poll that picks up the PDF once it's ready.
 */
import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { GrantDocumentCard } from "../GrantDocumentCard";

const mockRefresh = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

const mockFetch = jest.fn();
global.fetch = mockFetch;

describe("GrantDocumentCard", () => {
  beforeEach(() => {
    mockRefresh.mockClear();
    mockFetch.mockClear();
  });

  it("renders nothing when the eligibility assessment is not complete", () => {
    const { container } = render(
      <GrantDocumentCard
        projectId="proj-1"
        assessmentComplete={false}
        hasDocument={false}
        lastGeneratedAt={null}
        incompleteFields={[]}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a generating/loading state once the assessment is complete but the PDF isn't ready", () => {
    render(
      <GrantDocumentCard
        projectId="proj-1"
        assessmentComplete={true}
        hasDocument={false}
        lastGeneratedAt={null}
        incompleteFields={[]}
      />
    );
    expect(screen.getByText(/generating your grant eligibility summary/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /download grant eligibility summary/i })).not.toBeInTheDocument();
  });

  it("polls for the PDF while it isn't ready yet", () => {
    jest.useFakeTimers();
    try {
      render(
        <GrantDocumentCard
          projectId="proj-1"
          assessmentComplete={true}
          hasDocument={false}
          lastGeneratedAt={null}
          incompleteFields={[]}
        />
      );
      expect(mockRefresh).not.toHaveBeenCalled();
      act(() => {
        jest.advanceTimersByTime(5000);
      });
      expect(mockRefresh).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it("shows a working download link once the PDF is ready, using the secure download route", () => {
    render(
      <GrantDocumentCard
        projectId="proj-42"
        assessmentComplete={true}
        hasDocument={true}
        lastGeneratedAt="2026-08-01T00:00:00.000Z"
        incompleteFields={[]}
      />
    );
    const link = screen.getByRole("link", { name: /download grant eligibility summary/i });
    expect(link).toHaveAttribute("href", "/api/documents/proj-42/download");
  });

  it("does not poll once the document is ready", () => {
    jest.useFakeTimers();
    try {
      render(
        <GrantDocumentCard
          projectId="proj-1"
          assessmentComplete={true}
          hasDocument={true}
          lastGeneratedAt={null}
          incompleteFields={[]}
        />
      );
      act(() => {
        jest.advanceTimersByTime(20000);
      });
      expect(mockRefresh).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it("regenerates the PDF on demand", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    render(
      <GrantDocumentCard
        projectId="proj-1"
        assessmentComplete={true}
        hasDocument={true}
        lastGeneratedAt={null}
        incompleteFields={[]}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /regenerate pdf/i }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/project/proj-1/grant-document/regenerate",
        expect.objectContaining({ method: "POST" })
      );
      expect(mockRefresh).toHaveBeenCalled();
    });
  });

  it("surfaces incomplete-field warnings without exposing internal codes", () => {
    render(
      <GrantDocumentCard
        projectId="proj-1"
        assessmentComplete={true}
        hasDocument={true}
        lastGeneratedAt={null}
        incompleteFields={["client phone", "estimated cost"]}
      />
    );
    expect(screen.getByText("client phone, estimated cost")).toBeInTheDocument();
  });
});
