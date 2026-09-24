"""OpenCode Muse launcher, derived from the user's WorklazyTools calling contract.
No API billing fallback, no guessed model ID, no global configuration changes.
"""
from __future__ import annotations
import argparse, datetime as dt, json, os, re, shutil, signal, subprocess, sys, time, uuid
from pathlib import Path

ANSI=re.compile(r'\x1b\[[0-?]*[ -/]*[@-~]')

def probe(argv,worktree,timeout=30):
    p=subprocess.run(argv,cwd=worktree,stdin=subprocess.DEVNULL,capture_output=True,text=True,timeout=timeout)
    return {'code':p.returncode,'stdout':p.stdout,'stderr':p.stderr}

def get_model_ids(text):
    ids=set()
    for line in ANSI.sub('',text).splitlines():
        parts=line.strip().split()
        if parts and re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_./:-]+',parts[0]):ids.add(parts[0])
    return ids

def make_command(exe,worktree,model,prompt,session=None,fork=False,variant=None):
    if fork and not session:raise ValueError('--fork needs a verified --session')
    cmd=[exe,'run','--dir',str(worktree),'--model',model,'--format','json']
    if session:cmd+=['-s',session]
    if fork:cmd+=['--fork']
    if variant:cmd+=['--variant',variant]
    cmd.append(prompt) # a single argv element, never evaluated by a shell
    return cmd

def terminate_owned(p):
    if p.poll() is not None:return
    try:
        if os.name=='posix':os.killpg(p.pid,signal.SIGTERM)
        else:p.terminate()
        p.wait(timeout=5)
    except (ProcessLookupError,subprocess.TimeoutExpired):
        if p.poll() is None:
            if os.name=='posix':os.killpg(p.pid,signal.SIGKILL)
            else:p.kill()
            p.wait()

def session_ids(text):
    ids=set()
    for match in re.finditer(r'"session(?:ID|Id|_id)"\s*:\s*"([^"\s]+)"',text):ids.add(match.group(1))
    return sorted(ids)

def main():
    ap=argparse.ArgumentParser();sub=ap.add_subparsers(dest='action',required=True)
    d=sub.add_parser('doctor');d.add_argument('--worktree',type=Path,required=True)
    r=sub.add_parser('dispatch');r.add_argument('--worktree',type=Path,required=True)
    r.add_argument('--model',required=True);r.add_argument('--prompt',type=Path,required=True)
    r.add_argument('--session');r.add_argument('--fork',action='store_true');r.add_argument('--variant')
    r.add_argument('--timeout',type=int,default=1800);r.add_argument('--dry-run',action='store_true')
    args=ap.parse_args();wt=args.worktree.expanduser().resolve()
    if not wt.is_dir():ap.error('worktree not found')
    exe=shutil.which('opencode')
    if not exe:ap.error('opencode not installed on this host; no substitute will be launched')
    runtime=wt/'.agent-runtime';runtime.mkdir(exist_ok=True)
    results={}
    try:
        for key,cmd in [('version',[exe,'--version']),('run_help',[exe,'run','--help']),('models',[exe,'models'])]:
            results[key]=probe(cmd,wt)
        if args.action=='doctor':
            results['mcp']=probe([exe,'mcp','list'],wt)
            (runtime/'doctor.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
            print(json.dumps({'report':str(runtime/'doctor.json'),'models':sorted(get_model_ids(results['models']['stdout'])),
                              'note':'Choose the actual Muse contributor ID from the subscription provider; do not guess.'},ensure_ascii=False,indent=2));return 0
        if results['models']['code']!=0:ap.error('opencode models failed; run doctor')
        if args.model not in get_model_ids(results['models']['stdout']):ap.error('exact model ID was not found in opencode models')
        helptext=results['run_help']['stdout']+results['run_help']['stderr']
        for flag in ['--dir','--model','--format']+(['--variant'] if args.variant else []):
            if flag not in helptext:ap.error(f'installed run help does not confirm {flag}')
        promptpath=args.prompt if args.prompt.is_absolute() else wt/args.prompt
        promptpath=promptpath.resolve()
        if not promptpath.is_relative_to(wt):ap.error('prompt must be inside the assigned worktree')
        prompt=promptpath.read_text(encoding='utf-8')
        if not prompt.strip():ap.error('empty prompt')
        if '__FILL__' in prompt:ap.error('task template still contains __FILL__; fill ownership/URL before dispatch')
        cmd=make_command(exe,wt,args.model,prompt,args.session,args.fork,args.variant)
        if args.dry_run:
            print(json.dumps({'argv_without_prompt':cmd[:-1],'prompt_file':str(promptpath),'prompt_chars':len(prompt),'stdin':'DEVNULL'},ensure_ascii=False,indent=2));return 0
        if args.timeout<1:ap.error('timeout must be positive')
        lock=runtime/'muse.lock';job=runtime/'jobs'/(dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'-'+uuid.uuid4().hex[:8])
        try:fd=os.open(lock,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        except FileExistsError:ap.error('this worktree has a Muse lock; inspect its PID/job before clearing it')
        os.write(fd,json.dumps({'pid':os.getpid(),'job':str(job)}).encode());os.close(fd)
        p=None
        try:
            job.mkdir(parents=True)
            (job/'request.json').write_text(json.dumps({'model_requested':args.model,'variant_requested':args.variant,'worktree':str(wt),'prompt_file':str(promptpath),'resume_session':args.session,'fork':args.fork},ensure_ascii=False,indent=2),encoding='utf-8')
            status='process_exited'
            with (job/'stdout.jsonl').open('w',encoding='utf-8') as out,(job/'stderr.log').open('w',encoding='utf-8') as err:
                p=subprocess.Popen(cmd,cwd=wt,stdin=subprocess.DEVNULL,stdout=out,stderr=err,start_new_session=(os.name=='posix'))
                try:code=p.wait(timeout=args.timeout)
                except subprocess.TimeoutExpired:terminate_owned(p);code=124;status='timeout'
            ids=session_ids((job/'stdout.jsonl').read_text(encoding='utf-8',errors='replace'))
            report={'state':status,'exit_code':code,'session_ids':ids,'job':str(job),
                    'actual_model_verification':'PENDING: inspect exact session export and result artifacts',
                    'ui_review':'PENDING: process exit is not review approval'}
            (job/'result.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
            print(json.dumps(report,ensure_ascii=False,indent=2));return code
        finally:
            if p is not None:terminate_owned(p)
            lock.unlink(missing_ok=True)
    except (OSError,ValueError,subprocess.TimeoutExpired) as e:
        print(f'ERROR: {type(e).__name__}: {e}',file=sys.stderr);return 2
if __name__=='__main__':raise SystemExit(main())
