import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { ZodError } from "zod";
import { infrai, InfraiError } from "./infrai.js";
import { decideStaleWorkOrders, sweepRequestSchema } from "./stale_work_orders.js";

const bucket = process.env.PHOTO_BUCKET ?? "field-service-photos";

async function readJson(request: import("node:http").IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function runSweep(body: unknown) {
  const input = sweepRequestSchema.parse(body);
  const decision = decideStaleWorkOrders(input);

  await infrai.storage.bucket.create({ name: bucket });
  if (decision.photoKeysToDelete.length > 0) {
    const fingerprint = createHash("sha256")
      .update(`${input.asOf}:${decision.photoKeysToDelete.slice().sort().join("\n")}`)
      .digest("hex");
    await infrai.storage.object.delete_batch(bucket, {
      keys: decision.photoKeysToDelete,
      idempotency_key: `field-service-sweep-${fingerprint}`,
    });
  }

  return {
    outcome: "cleanup_complete",
    staleWorkOrderIds: decision.staleWorkOrderIds,
    retainedWorkOrderIds: decision.retainedWorkOrderIds,
    deletedPhotoKeys: decision.photoKeysToDelete,
  };
}

const server = createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/sweeps/field-service") {
    response.writeHead(404).end();
    return;
  }

  try {
    const result = await runSweep(await readJson(request));
    response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(result));
  } catch (error) {
    const status = error instanceof InfraiError
      ? error.status < 500 ? error.status : 502
      : error instanceof ZodError || error instanceof SyntaxError ? 400 : 500;
    const message = error instanceof Error ? error.message : "Invalid request";
    response.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify({ error: message }));
  }
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => console.log(`Field-service cleanup listening on http://localhost:${port}`));
