import { isDevAuthBypassEnabled } from "@/backend/auth/devBypass";
import { SignInPageContent } from "./SignInPageContent";

export default function SignInPage() {
  return <SignInPageContent legacyMode={isDevAuthBypassEnabled()} />;
}
