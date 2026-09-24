# 출처·확인 범위
확인일 2026-09-24. 공식 API 설명의 근거이며 수치/시각적 제품 결정은 사용자 요구와 이 패키지의 설계다.

## S01. Supabase API keys
https://supabase.com/docs/guides/getting-started/api-keys
확인한 용도: publishable vs privileged secret; a secret key is not a SELECT-only credential.

## S02. Supabase Data API security
https://supabase.com/docs/guides/api/securing-your-api
확인한 용도: grants and RLS are distinct layers; audit views/RPC permissions.

## S03. Vite environment variables
https://vite.dev/guide/env-and-mode
확인한 용도: VITE_* values are in the frontend bundle, not hidden by GitHub Secrets.

## S04. Kakao Maps Web Guide
https://apis.map.kakao.com/web/guide/
확인한 용도: JavaScript key/domain, SDK libraries and LatLng order.

## S05. Kakao Local REST
https://developers.kakao.com/docs/ko/local/dev-guide
확인한 용도: coord2address/coord2regioncode, x=longitude y=latitude, REST authentication.

## S06. Kakao Maps Web Reference
https://apis.map.kakao.com/web/documentation/
확인한 용도: actual Map/CustomOverlay/MarkerClusterer APIs, relayout and events.

## S07. GitHub Pages custom workflows
https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages
확인한 용도: static artifact deployment, limited job permissions.

## S08. GitHub scheduled workflows
https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule
확인한 용도: delays, default branch, 60-day inactivity for public repositories.

## S09. OpenCode CLI
https://opencode.ai/docs/cli/
확인한 용도: models, run --dir/--model/-s/--fork, export; installed host help remains authoritative.

## S10. OpenCode skills
https://opencode.ai/docs/skills/
확인한 용도: SKILL.md discovery and required frontmatter.

## S11. OpenCode MCP
https://opencode.ai/docs/mcp-servers/
확인한 용도: local MCP config structure; merge rather than overwrite host config.

## S12. Playwright visual comparison
https://playwright.dev/docs/test-snapshots
확인한 용도: browser screenshots and baseline comparison are different from proof of correctness.

## 사용자 저장소
- https://github.com/Fentanest/safetyreport-community-map — tree ff63cfd0ac49da346d96bc22a39e7157254e336f
- https://github.com/Fentanest/WorklazyTools/blob/main/docs/agent-dispatch-runbook.md — blob 46253121e8db79c0a57897764b6bfc4cea39348d
- https://github.com/Fentanest/WorklazyTools/blob/main/docs/agent-ops-config.json — blob a3552a67f70a48f65ee00e84c6d36130b50c3434
- https://github.com/Fentanest/safetyreport-mobile/blob/main/lib/server_palette.dart — blob a3dee74729e9b57ddb4b08c6e3bb978dd5e0b410

## 사용자 제공 디자인 원본
Library의 design tokens.png / UI COMPONENT KIT.png / pc dark.png / pc light.png /
mobile dark.png / guide(1).png / board(1).png / LOGO.png.
패키지 design/references에 사본, asset-manifest에 파생 crop 이력. 폰트 binary 없음.
소스 이미지 내용의 모든 문구·예시 번호가 실제 제품 데이터라는 뜻은 아니다.

## 검증 한계
이 패키지는 운영 계정에 접속하거나 실제 Muse 구독 모델을 실행하지 않았다.
모델 runtime ID는 WorklazyTools에서도 미확정이라 host discovery를 필수로 둔다.
법률 검토·Kakao 데이터 보존/재배포 약관·실운영 배포승인은 별도다.
