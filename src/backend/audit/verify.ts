import { createHash, createVerify } from 'node:crypto';
import { prisma } from 'lib/prisma';

export type VerificationResult = {
  id: string;
  index: number;
  ok: boolean;
  reason?: string;
  error?: string;
};

export async function verifyAuditChain(limit?: number): Promise<{ total: number; mismatches: VerificationResult[] }>{
  const events = await prisma.auditEvent.findMany({ orderBy: { createdAt: 'asc' }, take: limit ?? undefined });
  const mismatches: VerificationResult[] = [];

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];

    const payloadForHash = {
      id: ev.id,
      category: ev.category,
      action: ev.action,
      outcome: ev.outcome,
      resourceType: ev.resourceType,
      resourceId: ev.resourceId ?? null,
      projectId: ev.projectId ?? null,
      actorUserId: ev.actorUserId ?? null,
      createdAt: ev.createdAt?.toISOString(),
      beforeState: ev.beforeState ?? null,
      afterState: ev.afterState ?? null,
      metadata: ev.metadata ?? null,
    };

    const expectedHash = createHash('sha256').update(JSON.stringify(payloadForHash)).digest('hex');

    if (ev.eventHash !== expectedHash) {
      mismatches.push({ id: ev.id, index: i, ok: false, reason: 'hash_mismatch' });
      continue;
    }

    if (i > 0) {
      const prev = events[i - 1];
      if (ev.prevHash !== prev.eventHash) {
        mismatches.push({ id: ev.id, index: i, ok: false, reason: 'prevhash_mismatch' });
        continue;
      }
    }

    // If signed, verify signature
    if (ev.signature) {
      const publicKey = process.env.AUDIT_SIGNING_PUBLIC_KEY;
      if (!publicKey) {
        mismatches.push({ id: ev.id, index: i, ok: false, reason: 'missing_public_key' });
        continue;
      }
      try {
        const verify = createVerify('RSA-SHA256');
        verify.update(ev.eventHash || '');
        verify.end();
        const valid = verify.verify(publicKey, ev.signature, 'base64');
        if (!valid) {
          mismatches.push({ id: ev.id, index: i, ok: false, reason: 'invalid_signature' });
          continue;
        }
      } catch (err) {
        mismatches.push({ id: ev.id, index: i, ok: false, reason: 'signature_verification_error', error: (err as Error).message });
        continue;
      }
    }

    // All checks passed for this event
  }

  return { total: events.length, mismatches };
}
