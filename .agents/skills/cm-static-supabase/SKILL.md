---
name: cm-static-supabase
description: Build Pages and safe initial snapshots while keeping exact filtered analytics on a restricted public API.
---
# cm-static-supabase

## 읽기
architecture.md, data-pipeline.md, database.md, deployment.md.
## 실행
read-only safe exporter와 production frontend env 분리. runtime API는 공개 DTO만 반환.
version 고정/refresh/withdraw invalidation을 구현하고 first-screen small cache+detail lazy query.
Actions cron UTC/KST/지연와 branch inactive 조건을 문서화. dist-only artifact를 검사.
## 출력
data adapters, safe export tests, actual workflow with pinned actions, secret/public matrix.
## 금지
service_role을read-only라고사용, VITE secret, raw source git commit, period TOP5 근사.
