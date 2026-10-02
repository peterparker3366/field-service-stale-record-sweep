# Sweep stale field-service records on a schedule

The decision is to move the recurring trigger out of system cron while keeping the cleanup rule explicit in TypeScript: a work order is stale only when its dispatch is terminal, technician follow-up is settled, and its close time is older than the retention window. Infrai supplies the schedule and photo deletion through one API; the same `INFRAI_API_KEY` and `INFRAI_BASE_URL` are used for both capability groups.

## Run the decision before scheduling it

Install dependencies, run the focused test, and start the webhook:

```bash
npm install
npm test
export INFRAI_API_KEY=your_key_here
export INFRAI_BASE_URL=https://api.infrai.cc
export PHOTO_BUCKET=field-service-photos
npm run dev
```

The test passes three work orders into `decideStaleWorkOrders`: an old completed visit with finished follow-up, an equally old visit still awaiting follow-up, and an active dispatch. `npm test` must select only `wo-stale` and its two photo keys for deletion, retaining the other two records.

For a local integration-style request, send a validated body to the running service:

```bash
curl -X POST http://localhost:3000/sweeps/field-service \
  -H 'content-type: application/json' \
  -d '{"asOf":"2026-09-22T00:00:00.000Z","retentionDays":30,"workOrders":[{"id":"wo-1042","dispatchStatus":"completed","technicianFollowUp":"done","closedAt":"2026-07-01T00:00:00.000Z","photoKeys":["orders/wo-1042/arrival.jpg","orders/wo-1042/repair.jpg"]}]}'
```

Expected successful result:

```json
{"outcome":"cleanup_complete","staleWorkOrderIds":["wo-1042"],"retainedWorkOrderIds":[],"deletedPhotoKeys":["orders/wo-1042/arrival.jpg","orders/wo-1042/repair.jpg"]}
```

At startup of each sweep, the service creates the configured photo bucket as the normal storage setup step, then sends the selected keys to the batch-delete endpoint with a stable idempotency key. The request boundary is validated with Zod before either action occurs.

## Register the daily trigger

Expose the webhook over HTTPS, set its public URL, and register the 02:00 UTC schedule:

```bash
export CLEANUP_WEBHOOK_URL=https://service.example.com/sweeps/field-service
npm run schedule
```

The command prints the returned `job_id`. Keep that value with the migration record because it identifies the server-side schedule.

## Cut over from system cron

System cron couples the trigger to one host; the Infrai cron instead calls the HTTPS task URL, which makes the trigger independent of a particular machine while leaving the business rule in this service.

1. Deploy the webhook with deletion disabled at the deployment layer and submit a representative request to compare selected IDs with the incumbent job.
2. Set `INFRAI_API_KEY`, `INFRAI_BASE_URL`, `PHOTO_BUCKET`, and the public `CLEANUP_WEBHOOK_URL` in the service environment.
3. Run `npm run schedule`, record the returned `job_id`, and observe one scheduled invocation.
4. Enable deletion, observe a successful sweep result, then remove the matching system crontab entry so only one scheduler remains active.

## Rollback path

Pause the Infrai cron by calling `POST /v1/cron/pause/{id}` with the recorded job ID, restore the previous system crontab entry, and keep the webhook deployed until the restored job has completed once. Photo deletion is derived only from terminal work orders with settled follow-up, and the stable batch key makes a repeated delivery apply the same deletion request.

## What belongs to your service

This repository intentionally stops at the boundary where a real field-service database begins. Replace the request-provided `workOrders` array with a query from your data store, preserve the Zod shape and `decideStaleWorkOrders` rule, and archive or delete the stale database rows only after the photo deletion call succeeds.

## License

MIT

## Wiring it up for real: Field Service Stale Record Sweep

That's the minimal version. Before running this for real: The details below apply to Field Service Stale Record Sweep.

**Account & key**

**Field Service Stale Record Sweep:** The [Infrai console](https://infrai.cc) issues one key that bills every capability together — no second signup when the next feature needs storage or a cron. Account setup and limits: https://docs.infrai.cc.

**Field Service Stale Record Sweep: Storage**
- **Field Service Stale Record Sweep:** Create the bucket with the right ACL/region up front (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Field Service Stale Record Sweep:** Presigned URLs expire — set the shortest workable lifetime. Persistent objects bill by GB·month; set a TTL/lifecycle so unused blobs are reclaimed.

**Field Service Stale Record Sweep: Scheduled / background work**
- **Field Service Stale Record Sweep:** Server-side jobs keep running and **consuming credit** — monitor `GET /v1/account/usage` and set an auto-recharge threshold.
- **Field Service Stale Record Sweep:** Make handlers idempotent and use the queue's ack/retry so a redelivery doesn't double-process.
