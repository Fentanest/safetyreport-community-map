# Private community parser (candidate)

PC `1a67d01101f52a649d5071c6997cee60c3dc7020` is the pinned source. The copied parser modules and six contract files are
listed in MANIFEST.sha256; the full capture/raw-detail sources under provenance are evidence, never imported by the runtime.
`community_adapter.py` is the mechanically extracted pure DTO builder. Client capture can change outside that builder.

## DTO equivalence with the PC

`parse_report.py` feeds the adapter exactly what PC `core/storage/reports_repo._community_capture_for` feeds it:
parser title fields, parser `entry_value` and the parser's `(ssnpc_cd, ssnpc_type)` pair, official-coordinate rule of
`geocode_service.official_geo_payload`, supplement photo times, and the client's enriched rating (`supplement.rating`;
the detail response's `STSFDG_SCORE` alone is never used). There are no server-only list fallbacks: an empty parser
`entry_value` stays `''`, a missing `C_DATE` gives `report_date: null`. The only fallback is the PC's own one:
report name = parser title or the client's stored title. Parsed columns store the same values that produced the fact.
Known residual: when the detail has no satisfaction score and no lookup ran, the PC DTO rating is `null` while the client
supplement may carry an older stored rating; the server follows the supplement (reviewer rule).

Timezone: the PC formats supplement epochs in local time (KST). The image sets `TZ=Asia/Seoul` and `worker.py` refuses
to start when the process offset is not +09:00.

## Offline checks (map repository root)

```sh
python3 scripts/raw-ingest/vendor_parser.py --offline
python3 scripts/raw-ingest/vendor_parser.py --upstream ../pc
python3 -m unittest discover -s server/parser-py/tests -v
node tests/sql/verify-raw-ingest.mjs                       # synthetic PGlite
PARSER_PYTHON=<python with psycopg 3> COMMUNITY_STACK=1 npx vitest run tests/integration/raw-ingest-stack.test.ts
```

The last command runs the real worker against the composed local Supabase stack (locks, triggers, concurrency, revoke).

## Transactions and lock order

Every database call is one autocommit statement (its own short transaction). No transaction is held while Python parses.

1. `private.claim_raw_parse_jobs(n, lease)` - queue rows only, `FOR UPDATE SKIP LOCKED`, sets `lease_token`,
   `leased_until` (and `next_attempt_at := leased_until`, so the `(priority, next_attempt_at)` index matches), counts the attempt.
2. Read the raw row without locks, parse.
3. `private.finish_raw_parse(..., lease, sha, ...)` - one transaction in the same order as ingest and auth revoke/deletion:
   contributor profile `FOR SHARE` -> active grant of the raw row's lineage `FOR SHARE` -> report advisory locks
   (`key:`/`number:`, sorted, same seed as ingest) -> raw `FOR UPDATE` -> fact (+ fact triggers) -> parsed/diff -> queue.
   It projects only when the lease is still ours and the raw/supplement hashes are unchanged, and always under the
   lineage's currently active grant (policy supersession). Outcomes: `accepted`/`no_change`/`stale_ignored`, `superseded`
   (new bytes arrived: the re-queued row stays), `revoked` (lineage closed: queue row dropped), `lease_lost`, `gone`.
   If the worker's agency registry version (`derived.agency_registry_version`) differs from
   `private.community_registry_state`, finish raises SQLSTATE `55P03` with message `registry_version_mismatch` and projects
   nothing (see Deployment order).
4. Failure: `private.fail_raw_parse` in its own transaction (its own errors are logged and swallowed). Backoff
   30 s x 2^n up to 1 h; at 8 attempts the raw row becomes `dead` and leaves the queue. Identical bytes stay dead
   (`no_change` on re-send); new bytes or a new parse key re-queue it. Failures that are not the report's
   fault - lock contention (`LockNotAvailable`, `DeadlockDetected`, `SerializationFailure`), `QueryCanceled` (statement
   timeout), `AdminShutdown`/`CrashShutdown`/`CannotConnectNow`, other `OperationalError`/`InterfaceError` and the registry
   mismatch above - release the lease without spending an attempt. A connection that is already gone cannot release;
   the lease simply expires after 300 s and is claimed again (that claim counts as one attempt). A job that always hits the
   statement timeout is therefore retried indefinitely without becoming `dead`; watch for repeating `transient_release kind=QueryCanceled`.
   `dead` rows are never revived by themselves; after fixing the cause an operator runs, as the DB owner (not the worker
   role, no API role may execute it):
   `select private.requeue_dead_raw();` (all), `select private.requeue_dead_raw('2026-10-21T00:00:00Z');` (received since)
   or `select private.requeue_dead_raw(null, 'ValueError');` (one `parse_error` class). It returns the number of rows moved
   back to `pending` and queued (priority `reparse`, attempts reset); rows locked by a concurrent ingest/revoke are skipped, run it again.

Session limits: `lock_timeout=5s`, `statement_timeout=30s`, `idle_in_transaction_session_timeout=60s` (set by the worker
per session and by `alter role community_parser`).

## Parse key and reparse

`parsed_parser_version` / `fact_parser_version` hold the parse key `"{PARSER_VERSION}+map{MAP_WORKER_VERSION}"`.

- PC parser copy changes (`vendor_parser.py`): `PARSER_VERSION` in `community_adapter.py` changes with it.
- Worker-side code that changes parsed columns, the DTO inputs or the derivation: bump `MAP_WORKER_VERSION` in `worker.py`.
  Rows are re-parsed. When the DTO payload hash is unchanged but the parse key differs, the raw path still rewrites the
  fact's derived columns (and `fact_parser_version`) - it is not a `no_change` - and keeps `answer_accepted_at`.
  A v1 (`dto`) fact never takes this path.
- The agency registry version (`shared/agency-region-registry`) is **not** part of the parse key. A registry change is applied
  to stored facts by `scripts/recompute-agency-keys.mjs` (all fact sources); the worker only has to carry the same registry
  as `private.community_registry_state`, otherwise `finish_raw_parse` refuses (below).

Deploy the new image with `--reparse` (the default CMD). At startup it calls `private.enqueue_raw_reparse` in batches of
200 until nothing is left; rows are queued with priority `reparse`, after ingest work. Reports whose lock is held at that
moment are skipped and caught by the next start. The enqueue uses `FOR KEY SHARE ... SKIP LOCKED`, so it never waits for a
row that a revoke/withdrawal purge is deleting.

### Deployment order when the agency registry changes

The registry is part of the image (`shared/agency-region-registry`) and of the database singleton
(`private.community_registry_state`); the two must be switched in this order, there is no automatic pickup:

1. Build and deploy the worker image with the new registry, and make sure no worker with the old registry is still running
   (SIGTERM and wait until it has drained). Until step 2 the new worker releases every job with `registry_version_mismatch`
   without spending an attempt and logs one WARNING per batch; nothing is parsed, nothing is lost.
2. Switch the singleton: apply the registry migration, then run `scripts/recompute-agency-keys.mjs` for the stored facts.
3. The released jobs are claimed again and project normally. Check the log for `registry_version_mismatch` going quiet.

Never switch the singleton first: the old worker would then be refused on every job (still harmless, but nothing projects).

## Deployment

The runtime uses Python 3.12 and pinned psycopg. Build context is the map root, Dockerfile is server/parser-py/Dockerfile;
`Dockerfile.dockerignore` (BuildKit) and the explicit `COPY` list keep tests, provenance, contract vectors and
`__pycache__` out of the image. `compose.example.yaml` uses `init: true` and SIGTERM: the worker finishes the current job,
releases the rest of its leases and exits.

`COMMUNITY_PARSER_DSN` must be a **direct PostgreSQL connection (port 5432)** for a login with membership in the NOLOGIN
`community_parser` role (or that role given LOGIN), never a transaction pooler, service_role or a superuser. The worker
uses `prepare_threshold=None`, `connect_timeout=10` and TCP keepalives, and refuses to start for a superuser, a
`BYPASSRLS` role or a member of `service_role`. The role has `SELECT` on raw rows and `EXECUTE` on the claim / release /
finish / fail / reparse functions only - no direct writes.

The 30-day ledger payload purge is a pg_cron job (`community-ingest-payload-prune`, daily 18:17 UTC = 03:17 KST), not the
worker. Logs contain the parse key, outcome counts, exception class and a hash-key prefix only. Never add exception text,
raw body, answer or SQL parameter logging. Parsed and diff tables contain private data and follow the raw row's
withdrawal/deletion cascade. Backup deletion remains an operations task.
