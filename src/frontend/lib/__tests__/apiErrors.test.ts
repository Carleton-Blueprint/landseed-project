import { getApiErrorMessage } from "@/frontend/lib/apiErrors";
import { EMAIL_VERIFICATION_REQUIRED_MESSAGE } from "@/backend/auth/requireVerifiedEmail";

describe("getApiErrorMessage", () => {
  it("returns the API error message when present", () => {
    expect(
      getApiErrorMessage(
        { code: "EMAIL_VERIFICATION_REQUIRED", error: EMAIL_VERIFICATION_REQUIRED_MESSAGE },
        "fallback"
      )
    ).toBe(EMAIL_VERIFICATION_REQUIRED_MESSAGE);
  });

  it("falls back when the body is empty", () => {
    expect(getApiErrorMessage(null, "fallback")).toBe("fallback");
  });
});
