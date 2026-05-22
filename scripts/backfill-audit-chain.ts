import crypto from 'node:crypto';
import { prisma } from 'lib/prisma';

async function run() {
  console.log('Starting audit event chain backfill...');

  const events = await prisma.auditEvent.findMany({ orderBy: { createdAt: 'asc' } });
  console.log(`Found ${events.length} audit events`);

  let prevHash: string | null = null;

  for (const ev of events) {
    const payload = {
      id: ev.id,
      category: ev.category,
      action: ev.action,
      outcome: ev.outcome,
      resourceType: ev.resourceType,
      resourceId: ev.resourceId,
      projectId: ev.projectId,
      actorUserId: ev.actorUserId,
      createdAt: ev.createdAt,
      beforeState: ev.beforeState,
      afterState: ev.afterState,
      metadata: ev.metadata,
    };

    const hash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');

    await prisma.auditEvent.update({
      where: { id: ev.id },
      data: {
        eventHash: hash,
        prevHash: prevHash,
      },
    });

    prevHash = hash;
  }

  console.log('Backfill complete.');
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exit(1);
  });
