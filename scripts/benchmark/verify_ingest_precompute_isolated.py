"""Run rollback integration suites in this task's owned disposable PostgreSQL."""
import argparse, os, subprocess
import ingest_precompute as b

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--test-name-pattern')
    args=parser.parse_args()
    owned=[]
    try:
        b.start(owned)
        # Each test applies the recent migrations inside BEGIN/ROLLBACK itself.
        b.baseline(apply_recent=False)
        env=dict(os.environ,COMMUNITY_STACK='1',PRECOMPUTE_DISPOSABLE='1')
        command=['node_modules/.bin/vitest','run',
            'tests/integration/ingest-precompute.test.ts',
            'tests/integration/cohort-timeout.test.ts',
            'tests/integration/screen-transport.test.ts',
            'tests/integration/screen-server-aggregate.test.ts',
            '--configLoader','runner','--no-cache','--no-file-parallelism','--maxWorkers=1']
        if args.test_name_pattern:command+=['--testNamePattern',args.test_name_pattern]
        subprocess.run(command,cwd=b.ROOT,env=env,check=True)
    finally:
        if owned:b.command(['docker','rm','-f','-v',owned[0]])

if __name__=='__main__':main()
