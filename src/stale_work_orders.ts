import { z } from "zod";

export const workOrderSchema = z.object({
  id: z.string().min(1),
  dispatchStatus: z.enum(["scheduled", "en_route", "completed", "cancelled"]),
  technicianFollowUp: z.enum(["pending", "done", "not_required"]),
  closedAt: z.string().datetime(),
  photoKeys: z.array(z.string().min(1)),
});

export const sweepRequestSchema = z.object({
  asOf: z.string().datetime(),
  retentionDays: z.number().int().positive().max(3650),
  workOrders: z.array(workOrderSchema),
});

export type SweepRequest = z.infer<typeof sweepRequestSchema>;
export type WorkOrder = z.infer<typeof workOrderSchema>;

export type SweepDecision = {
  staleWorkOrderIds: string[];
  photoKeysToDelete: string[];
  retainedWorkOrderIds: string[];
};

export function decideStaleWorkOrders(input: SweepRequest): SweepDecision {
  const cutoff = new Date(input.asOf).getTime() - input.retentionDays * 86_400_000;
  const staleWorkOrderIds: string[] = [];
  const retainedWorkOrderIds: string[] = [];
  const photoKeysToDelete = new Set<string>();

  for (const order of input.workOrders) {
    const followUpSettled = order.technicianFollowUp !== "pending";
    const terminalDispatch = order.dispatchStatus === "completed" || order.dispatchStatus === "cancelled";
    const isStale = terminalDispatch && followUpSettled && new Date(order.closedAt).getTime() < cutoff;

    if (isStale) {
      staleWorkOrderIds.push(order.id);
      order.photoKeys.forEach((key) => photoKeysToDelete.add(key));
    } else {
      retainedWorkOrderIds.push(order.id);
    }
  }

  return { staleWorkOrderIds, photoKeysToDelete: [...photoKeysToDelete], retainedWorkOrderIds };
}
