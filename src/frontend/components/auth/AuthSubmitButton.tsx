import type { ReactNode } from "react";
import { Button } from "@/frontend/components/ui/button";

/** Primary submit button shared by the auth pages (sign in, sign up, forgot/reset password). */
export function AuthSubmitButton({
  disabled,
  children,
}: {
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <Button
      type="submit"
      disabled={disabled}
      className="w-full py-6 mt-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl font-medium transition-colors disabled:opacity-50 text-base"
    >
      {children}
    </Button>
  );
}
