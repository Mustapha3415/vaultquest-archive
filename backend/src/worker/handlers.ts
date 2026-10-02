import { z } from "zod";
import type { DrawProofService } from "../services/drawProofService.js";
import type { CacheRepairService } from "../services/cacheRepairService.js";
import { NonRetryableJobError, type JobHandler } from "./types.js";

export const JOB_TYPES = {
  DRAW_PROOF_GENERATE: "draw_proof.generate",
  CACHE_REPAIR: "cache.repair"
} as const;

export const drawProofPayload = z.object({ actionId: z.string().min(1) });

export const notificationDeliverPayload = z.object({
  notificationId: z.string().min(1)
});

export const cacheRepairPayload = z.object({
  dryRun: z.boolean().optional(),
  limit: z.number().int().positive().max(1000).optional(),
  kinds: z.array(z.enum(["vault_accounting", "prize_draws", "user_dashboard", "protocol_reporting"])).optional()
});

export function drawProofJobKey(actionId: string): string {
  return `${JOB_TYPES.DRAW_PROOF_GENERATE}:${actionId}`;
}

export function cacheRepairJobKey(scope: string): string {
  return `${JOB_TYPES.CACHE_REPAIR}:${scope}`;
}

export function notificationDeliverJobKey(notificationId: string): string {
  return `${JOB_TYPES.NOTIFICATION_DELIVER}:${notificationId}`;
}

/**
 * Handlers must be idempotent: the queue is at-least-once. Draw-proof
 * generation checks for an existing proof before inserting, so a re-run after
 * a crash or lock takeover is a no-op. The cache repair handler delegates
 * to CacheRepairService, which is write-idempotent and supports dry-run.
 */
export function createJobHandlers(deps: {
  drawProofs: DrawProofService;
  cacheRepair: CacheRepairService;
}): Record<string, JobHandler> {
  return {
    [JOB_TYPES.DRAW_PROOF_GENERATE]: async (job) => {
      const parsed = drawProofPayload.safeParse(job.payload);
      if (!parsed.success) throw new NonRetryableJobError("invalid draw_proof.generate payload", "INVALID_PAYLOAD");
      await deps.drawProofs.generateProof({ actionId: parsed.data.actionId });
    },
    [JOB_TYPES.CACHE_REPAIR]: async (job) => {
      const parsed = cacheRepairPayload.safeParse(job.payload);
      if (!parsed.success) throw new NonRetryableJobError("invalid cache.repair payload", "INVALID_PAYLOAD");
      await deps.cacheRepair.repair({
        dryRun: parsed.data.dryRun ?? false,
        limit: parsed.data.limit,
        kinds: parsed.data.kinds
      });
    }
  };
}
