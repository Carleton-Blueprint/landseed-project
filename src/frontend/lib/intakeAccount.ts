import { signIn } from "next-auth/react";

export type IntakeAccountInput = {
  name: string;
  email: string;
  phone: string;
  password: string;
};

export async function registerIntakeAccount(input: IntakeAccountInput): Promise<string | null> {
  const response = await fetch("/api/intake", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  if (response.status === 409) {
    const signInResult = await signIn("credentials", {
      redirect: false,
      email: input.email.trim().toLowerCase(),
      password: input.password,
    });

    if (!signInResult?.error) {
      return null;
    }

    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    return body?.error ?? "Invalid email or password. Please try again.";
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    return body?.error ?? "Could not create your account. Please try again.";
  }

  const signInResult = await signIn("credentials", {
    redirect: false,
    email: input.email.trim().toLowerCase(),
    password: input.password,
  });

  if (signInResult?.error) {
    return "Account created but sign-in failed. Please sign in from the client portal.";
  }

  return null;
}

export function hasAuthenticatedSession(session: { user?: { id?: string | null } | null } | null) {
  return Boolean(session?.user?.id && session.user.id !== "dev-user-id");
}
