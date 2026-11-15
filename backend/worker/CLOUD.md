# Cloud task processor

Production uses the existing Node.js API on Vercel and the existing Supabase task queue, private storage and Cron. No local process or open browser is required.

`POST /api/platform` schedules a bounded cloud batch after an authenticated user commits a task. Supabase Cron also wakes `/api/v1/worker` every minute, so queued tasks continue after the browser closes. A database advisory lock limits all overlapping invocations to two tasks in progress. Empty wakes only update availability.

Vercel production needs `QMX_CLOUD_WORKER_TOKEN` as a server-only secret, in addition to the existing Supabase and model configuration. The same token is kept in Supabase Vault as `qmx_cloud_worker_token`; only its SHA-256 digest is registered in the existing processor authorization table. Never commit either token. Local administrator credentials and the processor credential are separate.

Apply `supabase/platform-v2-cloud-worker.sql`, initially disabled. Verify deployment and `POST /api/v1/worker?probe=1` with the dedicated Authorization header. The probe checks database access and an encrypted storage round trip, without claiming tasks or calling AI. Confirm there are no active tasks before rotating the processor digest, stopping the local processor and enabling the private scheduler configuration.

Provider responses are AES-GCM encrypted, bound to the task and input digest, and stored in the private `qmx-worker-receipts` bucket before finalization. Explicit retries can recover these across instances. Failed tasks are never automatically retried. A process terminated before a provider response is durably saved may have consumed API usage; verify usage before manually retrying. Historical receipts encrypted with the old local credential remain local and cannot be silently reused under the new cloud credential.

Vercel has a 300-second invocation limit on the current free plan. The cloud runner gives model network requests a 250-second total deadline to reserve time for persistence. Very large source images, slow providers or exhausted free hosting quotas can still fail or delay tasks. A stale task is marked failed by the existing lease recovery check rather than resubmitted to the provider.

To pause: set `qmx_private.cloud_processor.enabled=false` and remove the production `QMX_CLOUD_WORKER_TOKEN`, then redeploy. Setting only the scheduler flag pauses periodic wakes; it does not disable immediate user-submission processing. To restore local processing, first wait for active cloud tasks to finish, restore the old processor credential digest, remove the cloud environment secret, redeploy, then start the local worker. Do not enable both credential paths simultaneously.
