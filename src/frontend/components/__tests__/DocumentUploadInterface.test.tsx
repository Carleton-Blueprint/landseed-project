/**
 * Tests for DocumentUploadInterface component.
 * Verifies rendering, category selection, upload flow, and document listing.
 */
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  DocumentUploadInterface,
  DOCUMENT_CATEGORIES,
} from "../DocumentUploadInterface";

// Mock react-dropzone
jest.mock("react-dropzone", () => ({
  useDropzone: jest.fn(({ disabled }) => ({
    getRootProps: () => ({
      onClick: disabled
        ? undefined
        : () => {
            // Simulate selecting a file via the dropzone
          },
    }),
    getInputProps: () => ({}),
    isDragActive: false,
  })),
}));

// Mock fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe("DocumentUploadInterface", () => {
  const defaultProps = {
    projectId: "test-project-123",
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // Default: return empty document list
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ documents: [] }),
    });
  });

  it("renders the header and description", async () => {
    render(<DocumentUploadInterface {...defaultProps} />);

    expect(screen.getByText("Supporting Documents")).toBeInTheDocument();
    expect(
      screen.getByText("Upload required documents for your grant application")
    ).toBeInTheDocument();
  });

  it("renders all document categories", async () => {
    render(<DocumentUploadInterface {...defaultProps} />);

    for (const cat of DOCUMENT_CATEGORIES) {
      expect(screen.getAllByText(cat.label).length).toBeGreaterThan(0);
    }
  });

  it("shows step 1 and step 2 headings", async () => {
    render(<DocumentUploadInterface {...defaultProps} />);

    expect(screen.getByText("Step 1: Select Document Type")).toBeInTheDocument();
    expect(screen.getByText("Step 2: Upload Your Document")).toBeInTheDocument();
  });

  it("shows warning when no category is selected", async () => {
    render(<DocumentUploadInterface {...defaultProps} />);

    expect(
      screen.getByText(/Please select a document type above first/i)
    ).toBeInTheDocument();
  });

  it("updates UI when a category is selected", async () => {
    render(<DocumentUploadInterface {...defaultProps} />);

    // Click on "Proof of Income"
    fireEvent.click(screen.getByRole("button", { name: /Proof of Income/ }));

    // The warning should be replaced with selected category info
    expect(
      screen.queryByText(/Please select a document type above first/i)
    ).not.toBeInTheDocument();
  });

  it("shows empty state when no documents are uploaded", async () => {
    render(<DocumentUploadInterface {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("No documents uploaded yet")).toBeInTheDocument();
    });
  });

  it("renders the requirements checklist for required categories", async () => {
    render(<DocumentUploadInterface {...defaultProps} />);

    expect(screen.getByText("Requirements Checklist")).toBeInTheDocument();

    // Check that required categories appear in the checklist
    const requiredCats = DOCUMENT_CATEGORIES.filter((c) => c.required);
    for (const cat of requiredCats) {
      // The checklist items render the label with the icon prefix
      const labels = screen.getAllByText(new RegExp(cat.label));
      expect(labels.length).toBeGreaterThan(0);
    }
  });

  it("shows progress indicator with 0/N when no required docs uploaded", async () => {
    render(<DocumentUploadInterface {...defaultProps} />);

    const requiredCount = DOCUMENT_CATEGORIES.filter((c) => c.required).length;
    expect(
      screen.getByText(`0/${requiredCount} required`)
    ).toBeInTheDocument();
  });

  it("fetches documents on mount", async () => {
    render(<DocumentUploadInterface {...defaultProps} />);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        `/api/documents/list/${defaultProps.projectId}`
      );
    });
  });

  it("displays fetched documents", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        documents: [
          {
            id: "doc-1",
            fileName: "income_proof.pdf",
            fileSize: 1024 * 500,
            documentType: "PROOF_OF_INCOME",
            virusScanStatus: "clean",
            reviewStatus: "PENDING",
            createdAt: "2026-03-28T12:00:00Z",
          },
        ],
      }),
    });

    render(<DocumentUploadInterface {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("income_proof.pdf")).toBeInTheDocument();
    });
  });

  it("shows correct file type descriptions", () => {
    render(<DocumentUploadInterface {...defaultProps} />);

    expect(
      screen.getByText(
        "Recent pay stubs, tax returns, or income verification letter"
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Doctor's letter, medical reports, or disability documentation"
      )
    ).toBeInTheDocument();
  });
});
