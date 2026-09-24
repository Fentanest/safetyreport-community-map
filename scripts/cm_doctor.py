"""Read-only local readiness report. Never prints secret values."""
import json, os, platform, shutil, subprocess
from pathlib import Path

def command(args):
    try:
        p=subprocess.run(args,capture_output=True,text=True,timeout=10,stdin=subprocess.DEVNULL)
        return {'code':p.returncode,'output':p.stdout.strip()[:300]}
    except (OSError,subprocess.TimeoutExpired) as e:return {'error':type(e).__name__}

def main():
    root=Path(__file__).resolve().parents[1]
    report={'python':platform.python_version(),'platform':platform.system(),
            'tools':{t:bool(shutil.which(t)) for t in ['git','node','npm','opencode','chromium','google-chrome']},
            'git_head':command(['git','-C',str(root),'rev-parse','HEAD']),
            'config_present':{k:bool(os.environ.get(k)) for k in ['VITE_KAKAO_MAP_JS_KEY','VITE_PUBLIC_ANALYTICS_URL','SUPABASE_EXPORT_DATABASE_URL','KAKAO_REST_API_KEY']},
            'notes':['No model was invoked and no cloud settings were changed.',
                     'Missing keys do not block fixture-based UI implementation.',
                     'Muse actual provider/model ID must be discovered on the user host.']}
    print(json.dumps(report,ensure_ascii=False,indent=2));return 0
if __name__=='__main__':raise SystemExit(main())
