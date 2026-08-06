# Encryption at Rest and KMS Key Management

Status of the "Encryption at Rest and KMS Key Management" ticket's
acceptance criteria, and what to check/apply during handoff.

## Database (PostgreSQL / Neon)

Production Postgres is hosted on [Neon](https://neon.com). Neon encrypts
all customer data at rest by default — AES-256, implemented in hardware on
the underlying NVMe storage — for every project, with no console toggle or
opt-in required. This is a platform default, not something configured by
this repo. See Neon's
[security overview](https://neon.com/docs/security/security-overview).

**Handoff action:** confirm the production Neon project is on a plan/region
where this default applies (it does for all standard Neon deployments as of
this writing) — no further action needed beyond that confirmation.

Local development Postgres (`landseed-infra/docker-compose.yml`) is a plain
`postgres:16-alpine` container with no encryption configured — this is
expected and fine, since it never holds real client data.

Sensitive PII lives in `Project.draftData`/`IntakeDraft` JSON columns and
`Document`/`Photo` metadata rows as plaintext, relying on Neon's at-rest
encryption rather than column-level encryption — this satisfies the
ticket's acceptance criterion as written ("via Neon... **or**
application-level field encryption"). If a future requirement needs
per-column encryption (e.g. for a specific regulatory reason), that's a new
ticket, not a gap in this one.

## S3 (client photos, documents, generated files)

All S3 writes go through `lib/s3.ts`'s `uploadToS3`/`uploadStreamToS3`,
which set `ServerSideEncryption: "aws:kms"` and `SSEKMSKeyId` on every
`PutObjectCommand`. Uploads throw an error rather than proceeding
unencrypted if `AWS_KMS_KEY_ID` is unset — there is no silent fallback to
bucket-default or unencrypted behavior.

This is backed by `landseed-infra/terraform/s3-kms/` (its own git repo,
`landseed-infra`), which defines:
- Default SSE-KMS encryption on the bucket itself.
- A bucket policy denying any `PutObject` that doesn't carry the matching
  SSE-KMS header — defense in depth in case anything ever writes to the
  bucket outside `lib/s3.ts` (console, a script, future code).

**Handoff action:** that Terraform module is written but **unapplied** — no
AWS credentials were available when it was authored. Whoever has AWS access
must run `terraform apply` there (see that module's own README for the full
procedure) and then set the resulting `kms_key_arn` output as
`AWS_KMS_KEY_ID` in the app's environment.

**Important caveat:** encryption config and the deny-policy only affect
*future* writes. Any objects already in the bucket from before this was
applied are not retroactively encrypted — see the Terraform module's README
for the re-encryption procedure if that applies to your bucket.

## KMS key management

- One customer-managed key (CMK), defined in
  `landseed-infra/terraform/s3-kms/kms.tf`, dedicated to S3 client-data
  encryption.
- The key's resource policy explicitly enumerates exactly two sets of
  principals: designated key administrators (rotate, disable, delete,
  change the policy) and the application's IAM principal (`kms:Decrypt`,
  `kms:GenerateDataKey*`, `kms:DescribeKey` only — never administration).
  No blanket "enable IAM user permissions" statement is included, so access
  is enforced by the key's own policy, not by whatever IAM policies happen
  to exist elsewhere in the AWS account.
- A matching least-privilege IAM policy (`iam.tf`) is attached to the app's
  IAM principal, scoped to this one key's ARN and the bucket's ARN — no
  wildcard resources.

**Known gap:** the app currently authenticates to AWS with a static IAM
*user* access key (`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`), not an
assumable role. The Terraform module supports attaching its policy to
either a role or a user, so it satisfies "restricted to the application's
IAM role/principal only" as configured — but migrating off long-lived
static credentials to an assumable role is a real hardening step, not
covered by this ticket. Flagged as a follow-up (see below).

## Rotation policy

`enable_key_rotation = true` on the CMK turns on **AWS KMS's automatic
annual rotation** — this is a managed, transparent mechanism: AWS rotates
the underlying cryptographic material once a year without any action from
the app or infra team, and without changing the key's ARN (so
`AWS_KMS_KEY_ID` never needs to change because of routine rotation).

**Manual/incident rotation:** KMS never exposes raw key material, even to
account admins, so "the key was leaked" isn't a realistic scenario the way
it is for a static secret. The realistic compromise scenario is the IAM
principal's credentials being leaked. If that's suspected:
1. Immediately deactivate/rotate the compromised IAM user's access keys (or
   the role's trust policy, if applicable).
2. Review CloudTrail for `kms:Decrypt`/`kms:GenerateDataKey` and
   `s3:GetObject`/`s3:PutObject` calls from that principal to scope the
   exposure.
3. If full key compromise is genuinely suspected (not just credential
   leakage), use `kms:RotateKeyOnDemand` to force new key material
   immediately rather than waiting for the annual cycle — the key ARN and
   `AWS_KMS_KEY_ID` still don't need to change.

## Known gaps / follow-ups (out of scope for this ticket)

Flagged for the team lead, not fixed here:

- **`MFA_ENCRYPTION_KEY`** (`src/backend/auth/mfaSecretCrypto.ts`) — AES-256-GCM
  key for TOTP secrets, stored as a static base64 value in `.env`. Not
  KMS-managed, no rotation mechanism.
- **`AUDIT_SIGNING_PRIVATE_KEY`/`AUDIT_SIGNING_PUBLIC_KEY`** (`src/backend/audit/log.ts`) —
  static PEM env vars used to sign the audit-event hash chain. Same gap:
  not KMS-managed, no rotation mechanism.
- **Static IAM user for AWS access** (see above) — recommend migrating to
  an assumable role once the production hosting target (and thus the
  available role-assumption mechanism — ECS task role, EC2 instance
  profile, OIDC federation, etc.) is finalized.

## Reference

- Terraform module: `landseed-infra/terraform/s3-kms/` (separate git repo
  from this one — see its README for apply instructions).
- S3 upload code: `lib/s3.ts`.
- Neon encryption defaults:
  [neon.com/docs/security/security-overview](https://neon.com/docs/security/security-overview).
