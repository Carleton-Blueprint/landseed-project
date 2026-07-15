/**
 * /auth/signin → redirects to home (login lives on the home page).
 * Preserves any callbackUrl so deep links still work.
 */
import { redirect } from "next/navigation";

export default function SignInPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const callbackUrl =
    typeof searchParams.callbackUrl === "string"
      ? searchParams.callbackUrl
      : undefined;

  const target = callbackUrl ? `/?callbackUrl=${encodeURIComponent(callbackUrl)}` : "/";
  redirect(target);
}
