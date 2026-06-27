export {
  EMAIL_VERIFICATION_REQUIRED_CODE,
  EMAIL_VERIFICATION_REQUIRED_MESSAGE,
} from "@/backend/auth/requireVerifiedEmail";

export function getApiErrorMessage(
  body: { code?: string; error?: string; message?: string } | null,
  fallback: string
): string {
  if (!body) {
    return fallback;
  }

  return body.error ?? body.message ?? fallback;
}
