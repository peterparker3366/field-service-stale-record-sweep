import assert from "node:assert/strict";
import test from "node:test";
import { decideStaleWorkOrders, sweepRequestSchema } from "../src/stale_work_orders.js";

test("deletes photos only after dispatch and technician follow-up are settled", () => {
  const input = sweepRequestSchema.parse({
    asOf: "2026-09-22T00:00:00.000Z",
    retentionDays: 30,
    workOrders: [
      {
        id: "wo-stale",
        dispatchStatus: "completed",
        technicianFollowUp: "done",
        closedAt: "2026-07-01T00:00:00.000Z",
        photoKeys: ["orders/wo-stale/arrival.jpg", "orders/wo-stale/repair.jpg"],
      },
      {
        id: "wo-awaiting-follow-up",
        dispatchStatus: "completed",
        technicianFollowUp: "pending",
        closedAt: "2026-07-01T00:00:00.000Z",
        photoKeys: ["orders/wo-awaiting-follow-up/repair.jpg"],
      },
      {
        id: "wo-active",
        dispatchStatus: "en_route",
        technicianFollowUp: "not_required",
        closedAt: "2026-07-01T00:00:00.000Z",
        photoKeys: ["orders/wo-active/arrival.jpg"],
      },
    ],
  });

  assert.deepEqual(decideStaleWorkOrders(input), {
    staleWorkOrderIds: ["wo-stale"],
    photoKeysToDelete: ["orders/wo-stale/arrival.jpg", "orders/wo-stale/repair.jpg"],
    retainedWorkOrderIds: ["wo-awaiting-follow-up", "wo-active"],
  });
});
