// EWS-10/11/21 — the lease-claim primitive, dialect-aware so the identical runner and test
// suite run on SQLite (dev/test) and Postgres (prod).
//
//   Postgres: a single atomic UPDATE whose row set comes from
//             SELECT ... FOR UPDATE SKIP LOCKED — concurrent claimers never collide and
//             never block on each other.
//   SQLite:   an interactive transaction (SQLite serializes writers, so the first claimer's
//             UPDATE holds the write lock; the second re-reads and sees the rows already
//             leased). Same observable contract: a job is claimed by exactly one worker.
//
// A due job is: pending & nextRunAt<=now, OR a crashed lease (leased/running with an elapsed
// leaseUntil) — the latter gives stuck-lease reclaim for free (EWS-21).
import type { Job } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import prisma from '../lib/prisma';
import { isPostgres } from '../lib/spineEnv';

export async function claimJobs(limit: number, leaseMs: number): Promise<Job[]> {
  const lease = randomUUID();
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + leaseMs);

  if (isPostgres()) {
    // $queryRawUnsafe with positional params; RETURNING * gives the claimed rows back.
    const rows = await prisma.$queryRawUnsafe<Job[]>(
      `UPDATE "Job" AS j
         SET status = 'leased', lease = $1, "leaseUntil" = $2, "updatedAt" = NOW()
       WHERE j.id IN (
         SELECT id FROM "Job"
          WHERE "nextRunAt" <= $3
            AND ( status = 'pending'
                  OR ( status IN ('leased','running') AND "leaseUntil" < $3 ) )
          ORDER BY "nextRunAt" ASC
          LIMIT $4
          FOR UPDATE SKIP LOCKED
       )
       RETURNING j.*;`,
      lease,
      leaseUntil,
      now,
      limit,
    );
    return rows;
  }

  // SQLite: serialize via an interactive transaction.
  return prisma.$transaction(async (tx) => {
    const candidates = await tx.job.findMany({
      where: {
        nextRunAt: { lte: now },
        OR: [{ status: 'pending' }, { status: { in: ['leased', 'running'] }, leaseUntil: { lt: now } }],
      },
      orderBy: { nextRunAt: 'asc' },
      take: limit,
      select: { id: true },
    });
    if (!candidates.length) return [];
    const ids = candidates.map((c) => c.id);
    await tx.job.updateMany({ where: { id: { in: ids } }, data: { status: 'leased', lease, leaseUntil } });
    return tx.job.findMany({ where: { id: { in: ids }, lease } });
  });
}
