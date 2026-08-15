/**
 * /auth/signin → redirects to home (login lives on the home page).
 * Preserves any callbackUrl so deep links still work.
 */
import { redirect } from "next/navigation";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedParams = await searchParams;
  const callbackUrl =
    typeof resolvedParams.callbackUrl === "string"
      ? resolvedParams.callbackUrl
      : undefined;

  const target = callbackUrl ? `/?callbackUrl=${encodeURIComponent(callbackUrl)}` : "/";
  redirect(target);
}
