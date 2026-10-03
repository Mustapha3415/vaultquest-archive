import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { AppError } from "../errors.js";
import { requireServiceAuth } from "../middleware/service-auth.js";
import { ok } from "../responses.js";
import { JOB_STATUSES, type JobRecord } from "../worker/types.js";
import type { JobQueue } from "../worker/jobWorker.js";

const listQuery = z.object({
  status: z.enum(JOB_STATUSES).optional(),
  type: z.string().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50)
});
const idParams = z.object({ id: z.string().uuid() });

const staleQuery = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  type: z.string().min(1).max(100).optional()
});

const repairBody = z.object({
  dry_run: z.boolean().default(true),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  type: z.string().min(1).max(100).optional(),
  ids: z.array(z.string().min(1).max(200)).max(500).optional()
});

export interface StaleCacheEntry {
  id: string;
  cache_key: string;
  source_type: string;
  source_id: string;
  source_version: number;
  cached_version: number;
  updated_at: string;
  reason: "version_mismatch" | "missing_cache";
}

export interface StaleCacheDetector {
  detectStale(options?: { limit?: number; type?: string }): Promise<StaleCacheEntry[]>;
}

export interface CacheRepairJob {
  run(options: { dryRun: boolean; limit: number; type?: string; ids?: string[] }): Promise<{
    dry_run: boolean;
    detected: number;
    repaired: number;
    failed: number;
    entries: StaleCacheEntry[];
    errors: Array<{ id: string; message: string }>;
  }>;
}

export function serializeJob(j: JobRecord) {
  return {
    id: j.id,
    type: j.type,
    status: j.status,
    idempotency_key: j.idempotencyKey,
    payload: j.payload,
    attempts: j.attempts,
    max_attempts: j.maxAttempts,
    run_at: j.runAt,
    correlation_id: j.correlationId,
    last_error: j.lastError,
    failures: j.failures,
    created_at: j.createdAt,
    updated_at: j.updatedAt,
    completed_at: j.completedAt
  };
}

/** Operator inspection of background jobs. Guarded by the internal service secret. */
export const jobsRoutes = (
  queue: JobQueue,
  secret: string,
  detector?: StaleCacheDetector,
  repairer?: CacheRepairJob
): FastifyPluginAsync =>
  async (app) => {
    const guard = requireServiceAuth(secret);

    app.get("/internal/jobs", { preHandler: [guard] }, async (req) => {
      const q = listQuery.parse(req.query);
      return ok((await queue.listJobs(q)).map(serializeJob));
    });

    // Stale-cache inspection and repair are opt-in: they only register when the
    // caller wires a detector/repairer, and use a literal segment so they can
    // never collide with `/internal/jobs/:id` (find-my-way rejects duplicate
    // parametric siblings with different names).
    const activeDetector = detector;
    if (activeDetector) {
      app.get("/internal/jobs/stale", { preHandler: [guard] }, async (req) => {
        const q = staleQuery.parse(req.query);
        const entries = await activeDetector.detectStale({ limit: q.limit, type: q.type });
        return ok({ count: entries.length, entries });
      });
    }

    const activeRepairer = repairer;
    if (activeRepairer) {
      app.post("/internal/jobs/repair-cache", { preHandler: [guard] }, async (req) => {
        const body = repairBody.parse(req.body ?? {});
        const result = await activeRepairer.run({
          dryRun: body.dry_run,
          limit: body.limit,
          type: body.type,
          ids: body.ids
        });
        return ok(result);
      });
    }

    app.get("/internal/jobs/:id", { preHandler: [guard] }, async (req) => {
      const { id } = idParams.parse(req.params);
      const job = await queue.getJob(id);
      if (!job) throw AppError.notFound(`job ${id} not found`);
      return ok(serializeJob(job));
    });

    app.post("/internal/jobs/:id/retry", { preHandler: [guard] }, async (req) => {
      const { id } = idParams.parse(req.params);
      const job = await queue.retryDeadJob(id);
      if (!job) throw AppError.notFound(`dead job ${id} not found`);
      return ok(serializeJob(job));
    });
  };
