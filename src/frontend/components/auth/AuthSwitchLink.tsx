import Link from "next/link";

/** "Don't have an account? Sign up" / "Already have an account? Sign in" footer link, shared by the sign-in and sign-up pages. */
export function AuthSwitchLink({
  prompt,
  href,
  label,
}: {
  prompt: string;
  href: string;
  label: string;
}) {
  return (
    <div className="mt-6 text-center text-sm text-gray-600">
      {prompt}{" "}
      <Link href={href} className="font-semibold text-emerald-700 hover:text-emerald-600">
        {label}
      </Link>
    </div>
  );
}
