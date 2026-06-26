/** Legacy name/email sign-in (no password) when true in local development. */
export function isDevAuthBypassEnabled(): boolean {
  return (
    process.env.NODE_ENV === "development" && process.env.DEV_AUTH_BYPASS === "true"
  );
}
