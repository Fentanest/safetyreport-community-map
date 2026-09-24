"""Conservative public artifact leak guard; supplement with strict DTO/integration tests."""
from __future__ import annotations
import argparse, gzip, json, re
from pathlib import Path

PLATE = re.compile(r'(?:서울|부산|대구|인천|광주|대전|울산|경기|강원|충북|충남|전북|전남|경북|경남|제주|세종)?[0-9]{2,3}[가-힣][0-9]{4}')
FORBIDDEN = re.compile(r'sb_secret_[A-Za-z0-9_-]+|CM_SECRET_CANARY_NOT_PUBLIC|SUPABASE_SERVICE_ROLE_KEY|SUPABASE_EXPORT_DATABASE_URL|KAKAO_REST_API_KEY|vehicle_canonical|raw_vehicle|refresh_token',re.I)
PRIVATE_KEYS = {'contributor_id','snapshot_id','vehicle_hash','vehicle_canonical','raw_plate','raw_vehicle','email','phone','google_sub','access_token','refresh_token'}
TEXT_SUFFIXES={'.html','.js','.mjs','.css','.json','.map','.txt','.csv','.svg','.xml'}
BLOCK_DIRS={'references','fixtures','.agent-runtime','docs','tests','node_modules','.git'}

def private_keys(obj, path=''):
    bad=[]
    if isinstance(obj,dict):
        for k,v in obj.items():
            if k.lower() in PRIVATE_KEYS: bad.append(path+'/'+k)
            bad.extend(private_keys(v,path+'/'+k))
    elif isinstance(obj,list):
        for i,v in enumerate(obj): bad.extend(private_keys(v,path+f'/{i}'))
    return bad

def scan(root: Path) -> list[str]:
    if not root.is_dir(): raise ValueError('public artifact directory not found')
    failures=[]
    for file in sorted(root.rglob('*')):
        rel=file.relative_to(root)
        if file.is_symlink(): failures.append(f'{rel}: symlink not allowed');continue
        if not file.is_file():continue
        if any(part in BLOCK_DIRS for part in rel.parts):failures.append(f'{rel}: internal path in artifact')
        if file.suffix in {'.zip','.tar','.br'}:
            failures.append(f'{rel}: uninspected archive/compression; expand and validate before publishing');continue
        try:
            data=file.read_bytes()
            if file.suffix=='.gz':data=gzip.decompress(data)
            elif file.suffix.lower() not in TEXT_SUFFIXES:continue
            text=data.decode('utf-8')
        except (UnicodeError,OSError,EOFError) as e:
            failures.append(f'{rel}: unreadable public text ({type(e).__name__})');continue
        if PLATE.search(text):failures.append(f'{rel}: unmasked plate-like text found')
        if FORBIDDEN.search(text):failures.append(f'{rel}: private marker/secret-like field found')
        if file.suffix=='.json':
            try:
                for path in private_keys(json.loads(text)):failures.append(f'{rel}: private JSON field {path}')
            except json.JSONDecodeError:failures.append(f'{rel}: invalid JSON')
    return failures

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--dir',required=True,type=Path);args=ap.parse_args()
    try:issues=scan(args.dir)
    except ValueError as e:ap.error(str(e))
    print(json.dumps({'checked_directory':str(args.dir),'passed':not issues,'issues':issues},ensure_ascii=False,indent=2))
    return 1 if issues else 0
if __name__=='__main__':raise SystemExit(main())
