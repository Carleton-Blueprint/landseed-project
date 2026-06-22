import {
  BACK_NAVIGATION,
  shouldInterceptNavigation,
  useIntakeLeaveGuard,
} from "../useIntakeLeaveGuard";
import { act, renderHook } from "@testing-library/react";

const mockPush = jest.fn();
const mockBack = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
    back: mockBack,
  }),
}));

describe("shouldInterceptNavigation", () => {
  it("ignores hash, mailto, and same-page links", () => {
    expect(shouldInterceptNavigation("#section", "/", "http://localhost")).toBe(false);
    expect(shouldInterceptNavigation("mailto:test@example.com", "/", "http://localhost")).toBe(
      false
    );
    expect(shouldInterceptNavigation("/", "/", "http://localhost")).toBe(false);
  });

  it("intercepts same-origin in-app navigation", () => {
    expect(shouldInterceptNavigation("/dashboard", "/", "http://localhost")).toBe(true);
  });

  it("ignores external links", () => {
    expect(shouldInterceptNavigation("https://example.com", "/", "http://localhost")).toBe(false);
  });
});

describe("useIntakeLeaveGuard", () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockBack.mockReset();
  });

  it("does not open modal when guard is disabled", () => {
    const { result } = renderHook(() =>
      useIntakeLeaveGuard({
        enabled: false,
        isSaving: false,
        saveNow: jest.fn(),
        flushBeaconSave: jest.fn(),
      })
    );

    act(() => {
      document.body.innerHTML = '<a href="/dashboard">Leave</a>';
      const link = document.querySelector("a")!;
      link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    expect(result.current.isModalOpen).toBe(false);
  });

  it("opens modal when clicking an in-app link while dirty", () => {
    const { result } = renderHook(() =>
      useIntakeLeaveGuard({
        enabled: true,
        isSaving: false,
        saveNow: jest.fn(),
        flushBeaconSave: jest.fn(),
      })
    );

    act(() => {
      document.body.innerHTML = '<a href="/dashboard">Leave</a>';
      const link = document.querySelector("a")!;
      link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    expect(result.current.isModalOpen).toBe(true);
  });

  it("save and leave awaits saveNow then navigates", async () => {
    const saveNow = jest.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useIntakeLeaveGuard({
        enabled: true,
        isSaving: false,
        saveNow,
        flushBeaconSave: jest.fn(),
      })
    );

    act(() => {
      document.body.innerHTML = '<a href="/dashboard">Leave</a>';
      const link = document.querySelector("a")!;
      link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    await act(async () => {
      await result.current.handleSaveAndLeave();
    });

    expect(saveNow).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith("/dashboard");
    expect(result.current.isModalOpen).toBe(false);
  });

  it("uses router.back for back navigation sentinel", async () => {
    const saveNow = jest.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useIntakeLeaveGuard({
        enabled: true,
        isSaving: false,
        saveNow,
        flushBeaconSave: jest.fn(),
      })
    );

    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    expect(result.current.isModalOpen).toBe(true);

    await act(async () => {
      await result.current.handleSaveAndLeave();
    });

    expect(saveNow).toHaveBeenCalledTimes(1);
    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(BACK_NAVIGATION).toBe("__back__");
  });

  it("calls flushBeaconSave on pagehide when enabled", () => {
    const flushBeaconSave = jest.fn();

    renderHook(() =>
      useIntakeLeaveGuard({
        enabled: true,
        isSaving: false,
        saveNow: jest.fn(),
        flushBeaconSave,
      })
    );

    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });

    expect(flushBeaconSave).toHaveBeenCalledTimes(1);
  });
});
