/**
 * Tests for AskQuestionPanel component.
 * Verifies rendering, form interaction, category selection, and question listing.
 */
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { AskQuestionPanel } from "../AskQuestionPanel";

// Mock fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe("AskQuestionPanel", () => {
  const defaultProps = {
    quoteId: "test-quote-123",
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // Default: return empty questions list
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ questions: [] }),
    });
  });

  it("renders the header with title and description", async () => {
    render(<AskQuestionPanel {...defaultProps} />);

    expect(screen.getByText("Ask the Advisory Team")).toBeInTheDocument();
    expect(
      screen.getByText("Request clarifications or modifications to your estimate")
    ).toBeInTheDocument();
  });

  it("renders the Ask a Question button", async () => {
    render(<AskQuestionPanel {...defaultProps} />);

    expect(screen.getByText("Ask a Question")).toBeInTheDocument();
  });

  it("opens the form when Ask a Question is clicked", async () => {
    render(<AskQuestionPanel {...defaultProps} />);

    fireEvent.click(screen.getByText("Ask a Question"));

    expect(screen.getByText("New Question")).toBeInTheDocument();
    expect(screen.getByText("What is your question about?")).toBeInTheDocument();
  });

  it("shows all question categories in the form", async () => {
    render(<AskQuestionPanel {...defaultProps} />);

    fireEvent.click(screen.getByText("Ask a Question"));

    expect(screen.getByText("Pricing & Costs")).toBeInTheDocument();
    expect(screen.getByText("Scope of Work")).toBeInTheDocument();
    expect(screen.getByText("Timeline")).toBeInTheDocument();
    expect(screen.getByText("Materials")).toBeInTheDocument();
    expect(screen.getByText("Grant Eligibility")).toBeInTheDocument();
    expect(screen.getByText("Modification Request")).toBeInTheDocument();
    expect(screen.getByText("General Question")).toBeInTheDocument();
  });

  it("shows subject and message fields in the form", async () => {
    render(<AskQuestionPanel {...defaultProps} />);

    fireEvent.click(screen.getByText("Ask a Question"));

    expect(screen.getByLabelText("Subject")).toBeInTheDocument();
    expect(screen.getByLabelText("Your Question")).toBeInTheDocument();
  });

  it("shows Submit Question button that is disabled by default", async () => {
    render(<AskQuestionPanel {...defaultProps} />);

    fireEvent.click(screen.getByText("Ask a Question"));

    const submitBtn = screen.getByText("Submit Question");
    expect(submitBtn).toBeInTheDocument();
    expect(submitBtn.closest("button")).toBeDisabled();
  });

  it("closes the form when Cancel is clicked", async () => {
    render(<AskQuestionPanel {...defaultProps} />);

    fireEvent.click(screen.getByText("Ask a Question"));
    expect(screen.getByText("New Question")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.queryByText("New Question")).not.toBeInTheDocument();
  });

  it("shows empty state when no questions exist", async () => {
    render(<AskQuestionPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("No questions yet")).toBeInTheDocument();
    });
  });

  it("fetches questions on mount", async () => {
    render(<AskQuestionPanel {...defaultProps} />);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        `/api/quote/${defaultProps.quoteId}/questions`
      );
    });
  });

  it("displays fetched questions", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        questions: [
          {
            id: "q-1",
            category: "PRICING",
            subject: "Can I get a discount?",
            message: "I was wondering if there are any discounts available.",
            status: "OPEN",
            response: null,
            respondedAt: null,
            createdAt: "2026-03-28T12:00:00Z",
          },
          {
            id: "q-2",
            category: "TIMELINE",
            subject: "When can we start?",
            message: "What is the earliest possible start date?",
            status: "ANSWERED",
            response: "We can begin as early as next week.",
            respondedAt: "2026-03-28T14:00:00Z",
            createdAt: "2026-03-27T10:00:00Z",
          },
        ],
      }),
    });

    render(<AskQuestionPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Can I get a discount?")).toBeInTheDocument();
      expect(screen.getByText("When can we start?")).toBeInTheDocument();
    });
  });

  it("shows status badges for questions", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        questions: [
          {
            id: "q-1",
            category: "PRICING",
            subject: "Test question",
            message: "Test message content here",
            status: "OPEN",
            response: null,
            respondedAt: null,
            createdAt: "2026-03-28T12:00:00Z",
          },
        ],
      }),
    });

    render(<AskQuestionPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Awaiting Response")).toBeInTheDocument();
    });
  });

  it("shows response time info in the form footer", async () => {
    render(<AskQuestionPanel {...defaultProps} />);

    fireEvent.click(screen.getByText("Ask a Question"));

    expect(
      screen.getByText("Our team typically responds within 1-2 business days")
    ).toBeInTheDocument();
  });

  it("shows character counts for inputs", async () => {
    render(<AskQuestionPanel {...defaultProps} />);

    fireEvent.click(screen.getByText("Ask a Question"));

    expect(screen.getByText("0/150")).toBeInTheDocument();
    expect(screen.getByText("0/2000")).toBeInTheDocument();
  });
});
