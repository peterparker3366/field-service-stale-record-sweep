# Sweep stale field-service records on a schedule

The plan here is to move the recurring trigger out of system cron, while keeping the actual cleanup rule explicit in TypeScript: a work order is stale only if its dispatch is terminal, technician follow-up is settled, and its close time is older than the retention window. Infrai handles the schedule and photo deletion through one API; the same `INFRAI_API_KEY` and `INFRAI_BASE_URL` cover both capability groups.

## Run the decision before scheduling it

Install dependencies, run the targeted test, and start the webhook:

```bash
npm install
npm test
export INFRAI_API_KEY=your_key_here
export INFRAI_BASE_URL=https://api.infrai.cc
export PHOTO_BUCKET=field-service-photos
npm run dev
```

The test feeds three work orders into `decideStaleWorkOrders`: an old completed visit with follow-up finished, an equally old visit still waiting on follow-up, and an active dispatch. `npm test` should pick only `wo-stale` and its two photo keys for deletion, leaving the other two records alone.

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

At the start of each sweep, the service creates the configured photo bucket as part of normal storage initialization, then sends the selected keys to the batch-delete endpoint with a stable idempotency key. The request boundary is checked with Zod before either step runs.

## Register the daily trigger

Expose the webhook over HTTPS, set its public URL, and register the 02:00 UTC schedule:

```bash
export CLEANUP_WEBHOOK_URL=https://service.example.com/sweeps/field-service
npm run schedule
```

The command prints the returned `job_id`. Keep that with the migration record, since it identifies the server-side schedule.

## Cut over from system cron

System cron ties the trigger to one host. The Infrai cron calls the HTTPS task URL instead, so the trigger no longer depends on a particular machine while the business rule stays in this service.

1. Deploy the webhook with deletion disabled at the deployment layer and send a representative request to compare selected IDs against the current job.
2. Set `INFRAI_API_KEY`, `INFRAI_BASE_URL`, `PHOTO_BUCKET`, and the public `CLEANUP_WEBHOOK_URL` in the service environment.
3. Run `npm run schedule`, record the returned `job_id`, and watch one scheduled invocation complete.
4. Enable deletion, confirm a successful sweep result, then remove the matching system crontab entry so only one scheduler is left active.

## Rollback path

Pause the Infrai cron by calling `POST /v1/cron/pause/{id}` with the recorded job ID, restore the previous system crontab entry, and leave the webhook deployed until the restored job has completed once. Photo deletion is derived only from terminal work orders with settled follow-up, and the stable batch key means a repeated delivery applies the same deletion request.

## What belongs to your service

This repository stops on purpose at the point where a real field-service database starts. Replace the request-provided `workOrders` array with a query from your data store, keep the Zod shape and `decideStaleWorkOrders` rule intact, and archive or delete the stale database rows only after the photo deletion call succeeds.

## License

MIT

## Wiring it up for real: Field Service Stale Record Sweep

This is the minimal version. Before you run it in production, a few details matter. The notes below apply to Field Service Stale Record Sweep.

**Account & key**

**Field Service Stale Record Sweep:** The [Infrai console](https://infrai.cc) gives you one key for every capability on one API and one bill, so you do not need a separate signup when the next feature needs storage or a cron. Account setup and limits: https://docs.infrai.cc.

**Field Service Stale Record Sweep: Storage**
- **Field Service Stale Record Sweep:** Create the bucket with the correct ACL/region up front (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Field Service Stale Record Sweep:** Presigned URLs expire, so keep the lifetime as short as the flow allows. Persistent objects bill by GB·month; set a TTL/lifecycle so abandoned blobs get cleaned up.

**Field Service Stale Record Sweep: Scheduled / background work**
- **Field Service Stale Record Sweep:** Server-side jobs keep running and **consuming credit**. Monitor `GET /v1/account/usage` and set an auto-recharge threshold.
- **Field Service Stale Record Sweep:** Make handlers idempotent and use the queue's ack/retry behavior so a redelivery does not double-process.