import { CredentialsSignin } from "next-auth";

/**
 * Thrown from authorize() to signal specific MFA outcomes to the client via
 * signIn()'s returned `code` — without ever issuing a session. Auth.js
 * surfaces the `code` we set here on the client's SignInResponse.
 */
export class MfaRequiredError extends CredentialsSignin {
  code = "mfa_required";
}

export class MfaInvalidCodeError extends CredentialsSignin {
  code = "mfa_invalid_code";
}

export class MfaLockedError extends CredentialsSignin {
  code = "mfa_locked";
}
