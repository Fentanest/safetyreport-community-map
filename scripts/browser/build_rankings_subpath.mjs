// LOCAL test build only. Pulls public key without logging credentials; no cloud/deploy calls.
import { execFileSync } from 'node:child_process';
const keys = JSON.parse(execFileSync('npx', ['supabase', 'status', '-o', 'json', '--workdir', '.integration-stack'], { encoding:'utf8' }));
execFileSync('npm', ['run', 'build'], { stdio:'inherit', env:{ ...process.env,
  VITE_BASE_PATH:'/safetyreport-community-map/', VITE_DATA_MODE:'live', VITE_PUBLIC_ANALYTICS_URL:'http://127.0.0.1:5192/functions/v1',
  VITE_SUPABASE_URL:'http://127.0.0.1:56321',
  VITE_SUPABASE_PUBLISHABLE_KEY:keys.PUBLISHABLE_KEY ?? keys.ANON_KEY,
} });
