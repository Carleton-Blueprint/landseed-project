import { redirect } from "next/navigation";

/** Redirect unauthenticated users to the custom sign-in page. */
export function redirectToSignIn(callbackUrl: string): never {
  redirect(`/auth/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`);
}
