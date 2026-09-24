import { z } from "zod";
import { infrai } from "./infrai.js";

const environmentSchema = z.object({
  CLEANUP_WEBHOOK_URL: z.string().url(),
});

const { CLEANUP_WEBHOOK_URL } = environmentSchema.parse(process.env);
const schedule = await infrai.cron.create({
  cron_expr: "0 2 * * *",
  task: CLEANUP_WEBHOOK_URL,
});

console.log(JSON.stringify({ outcome: "scheduled", jobId: schedule.job_id }, null, 2));
