"""Private parser worker. Credentials are read only from the process environment.

Every database call is one autocommit statement, i.e. its own short transaction:
  claim (queue rows only, SKIP LOCKED, sets a lease) -> read raw (no locks) -> parse in Python (no transaction)
  -> private.finish_raw_parse (profile -> grant -> report lock -> raw -> fact -> parsed/diff -> queue; same order as
  ingest and revoke) or private.fail_raw_parse (own transaction, its own errors swallowed).
No transaction is ever held across Python parsing, so ingest/revoke never wait on the worker for more than one job.
"""
import argparse
import logging
import os
import signal
import threading
import time
from community_adapter import PARSER_VERSION, payload_sha256
from parse_report import parse_report, registry_version

LOG = logging.getLogger('community_parser')
KEY = ('contributor_id', 'dataset_key', 'source_report_key')
WHERE = 'contributor_id=%s and dataset_key=%s and source_report_key=%s'
# Bump when worker-side code that shapes parsed/fact values changes (README: "parse key").
MAP_WORKER_VERSION = '1'
MAX_ATTEMPTS = 8           # private.fail_raw_parse marks the row dead at this many claims
LEASE_SECONDS = 300
TRANSIENT = ('LockNotAvailable', 'DeadlockDetected', 'SerializationFailure')
SESSION_OPTIONS = '-c lock_timeout=5s -c statement_timeout=30s -c idle_in_transaction_session_timeout=60s'


def parse_key() -> str:
    """Stored in parsed_parser_version / fact_parser_version; any change re-queues rows with --reparse."""
    return f'{PARSER_VERSION}+map{MAP_WORKER_VERSION}+reg{registry_version()}'


def check_timezone() -> None:
    """PC formats supplement epochs (parser._format_epoch_millis_to_datetime) in local time and runs in KST."""
    if time.localtime(1760000000).tm_gmtoff != 9 * 3600:
        raise SystemExit('refusing to start: process timezone is not Asia/Seoul (set TZ=Asia/Seoul, tzdata required)')


def check_role(conn) -> None:
    row = conn.execute(
        "select current_user as name, r.rolsuper, r.rolbypassrls,"
        " exists(select 1 from pg_roles s where s.rolname='service_role' and pg_has_role(current_user, s.oid, 'MEMBER')) as service"
        " from pg_roles r where r.rolname=current_user").fetchone()
    if row is None or row['rolsuper'] or row['rolbypassrls'] or row['service'] or row['name'] in ('postgres', 'supabase_admin', 'service_role'):
        raise SystemExit('refusing to start: worker login must be the restricted community_parser role, not superuser/bypassrls/service_role')


def connect(dsn: str):
    import psycopg
    from psycopg.rows import dict_row
    # Direct PostgreSQL (5432), not a transaction pooler: prepare_threshold=None also keeps poolers safe.
    return psycopg.connect(dsn, row_factory=dict_row, autocommit=True, prepare_threshold=None, connect_timeout=10,
                           keepalives=1, keepalives_idle=30, keepalives_interval=10, keepalives_count=3,
                           application_name='community-parser', options=SESSION_OPTIONS)


def _short(key) -> str:
    return key[2][:12]  # source_report_key is already a hash; never log report contents


def record_failure(conn, key, lease, sha, pkey, kind) -> str:
    """Own statement/transaction. Swallows its own errors unless the connection itself is gone."""
    try:
        return conn.execute('select private.fail_raw_parse(%s,%s,%s,%s,%s,%s,%s) as r', (*key, lease, sha, pkey, kind)).fetchone()['r']
    except Exception as exc:  # noqa: BLE001 - failure recording must not stop the batch
        if getattr(conn, 'broken', False):
            raise
        LOG.warning('fail_record_failed kind=%s key=%s', type(exc).__name__, _short(key))
        return 'unrecorded'


def release(conn, key, lease) -> None:
    try:
        conn.execute('select private.release_raw_parse_job(%s,%s,%s,%s)', (*key, lease))
    except Exception as exc:  # noqa: BLE001
        if getattr(conn, 'broken', False):
            raise
        LOG.warning('release_failed kind=%s key=%s', type(exc).__name__, _short(key))


def process_job(conn, job, pkey) -> str:
    from psycopg.types.json import Jsonb
    key = tuple(job[k] for k in KEY)
    lease = job['lease_token']
    row = conn.execute('select raw_text,raw_sha256,supplement,supplement_sha256,client_observation,client_parser_version '
                       'from private.community_report_raw where ' + WHERE, key).fetchone()
    if row is None:
        return 'gone'  # withdrawn/deleted: the queue row went with it (FK cascade)
    if job['attempts'] > MAX_ATTEMPTS:
        return record_failure(conn, key, lease, row['raw_sha256'], pkey, 'attempts_exhausted')
    try:
        parsed, payload, derived, diff = parse_report(row)
    except Exception as exc:  # noqa: BLE001 - parser defects are recorded per job
        # No exception text: it can contain private report content.
        return record_failure(conn, key, lease, row['raw_sha256'], pkey, type(exc).__name__)
    try:
        return conn.execute('select private.finish_raw_parse(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) as r',
            (*key, lease, row['raw_sha256'], row['supplement_sha256'], pkey, Jsonb(payload), payload_sha256(payload),
             Jsonb(derived), Jsonb(parsed), None if diff is None else Jsonb(diff))).fetchone()['r']
    except Exception as exc:  # noqa: BLE001
        if getattr(conn, 'broken', False):
            raise
        kind = type(exc).__name__
        if kind in TRANSIENT:
            LOG.warning('transient_release kind=%s key=%s', kind, _short(key))
            release(conn, key, lease)  # lock contention is not the report's fault; do not spend an attempt
            return 'released'
        return record_failure(conn, key, lease, row['raw_sha256'], pkey, kind)


def process_batch(conn, limit=50, pkey=None, stop=None) -> int:
    """Returns the number of claimed jobs (0 = queue idle)."""
    if not 1 <= limit <= 200:
        raise ValueError('batch_limit')
    pkey = pkey or parse_key()
    jobs = conn.execute('select * from private.claim_raw_parse_jobs(%s,%s)', (limit, LEASE_SECONDS)).fetchall()
    claimed = time.monotonic()
    outcomes: dict[str, int] = {}
    for i, job in enumerate(jobs):
        if (stop is not None and stop.is_set()) or time.monotonic() - claimed > LEASE_SECONDS - 60:
            for rest in jobs[i:]:
                release(conn, tuple(rest[k] for k in KEY), rest['lease_token'])
            outcomes['released_unstarted'] = len(jobs) - i
            break
        outcome = process_job(conn, job, pkey)
        outcomes[outcome] = outcomes.get(outcome, 0) + 1
        if outcome in ('retry', 'dead', 'unrecorded'):
            LOG.warning('parse_failed parse_key=%s outcome=%s key=%s', pkey, outcome, _short(tuple(job[k] for k in KEY)))
    LOG.info('batch_complete claimed=%d outcomes=%s parse_key=%s', len(jobs), ','.join(f'{k}:{v}' for k, v in sorted(outcomes.items())), pkey)
    return len(jobs)


def enqueue_reparse(conn, pkey, stop=None) -> int:
    total = 0
    while stop is None or not stop.is_set():
        n = conn.execute('select private.enqueue_raw_reparse(%s,%s) as n', (pkey, 200)).fetchone()['n']
        total += n
        if n == 0:
            break
    return total


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--once', action='store_true', help='claim and process one batch, then exit')
    ap.add_argument('--reparse', action='store_true', help='enqueue rows whose parse key differs, at startup')
    ap.add_argument('--pause', type=float, default=2.0)
    ap.add_argument('--batch', type=int, default=50)
    args = ap.parse_args()
    if args.pause < 0 or not 1 <= args.batch <= 200:
        ap.error('invalid batch/pause')
    logging.basicConfig(level=logging.INFO)
    check_timezone()
    dsn = os.environ['COMMUNITY_PARSER_DSN']
    stop = threading.Event()
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, lambda *_: stop.set())  # finish the current job, release the rest, exit
    pkey = parse_key()
    while not stop.is_set():
        try:
            with connect(dsn) as conn:
                check_role(conn)
                if args.reparse:
                    LOG.info('reparse_enqueued count=%d parse_key=%s', enqueue_reparse(conn, pkey, stop), pkey)
                    args.reparse = False
                while not stop.is_set():
                    jobs = process_batch(conn, args.batch, pkey, stop)
                    if args.once:
                        return
                    stop.wait(args.pause if jobs else max(5.0, args.pause))
        except SystemExit:
            raise
        except Exception as exc:  # noqa: BLE001 - reconnect loop
            LOG.error('worker_failed kind=%s', type(exc).__name__)
            if args.once:
                raise SystemExit(1)
            stop.wait(10)
    LOG.info('worker_stopped')


if __name__ == '__main__':
    main()
