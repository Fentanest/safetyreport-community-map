# AGENTS · safetyreport-community-map
정본 버전: cm-2026-09-24 / 사용자: Fentanest / 대상 레포 하나만 수정.

## 시작 순서
PROJECT_RULES.md, 본인 역할 문서(SOL.md/MUSE.md), docs/implementation/MASTER_PROMPT.md,
docs/product-decisions.md, docs/repository-audit.md를 읽는다. UI 담당은 docs/ui-spec.md,
docs/screen-by-screen.md, design/reference-ui/index.html을 실제로 연다(원본 참고 보드 이미지는 저장소에서 삭제됨).
이 문서 파일을 생성했다는 사실은 제품 구현·브라우저 검수 완료 증거가 아니다.

## 역할
- **6-Sol (`gpt-6-sol`)**: 총괄, 계약·데이터·보안·CI·통합, 실행 결과 확인. 현재 사용 중인 Sol 세션을 유지한다.
- **Muse Spark contributor**: UI 공동 구현자 + 실제 브라우저 UI/UX 검수. OpenCode 구독 경로,
  provider/model ID는 호스트에서 확인. 정확한 contributor variant 제공 여부도 확인·기록한다.
- 이번 프로젝트에 Claude/Gemini/Jev/Astra 호출 체계를 통째로 복사하지 않는다. Sol과 Muse 두 역할로 운영한다.

## 권한·협업
계획/구현/검수 request_mode를 구분한다. 제품 파일 변경은 승인된 자기 worktree와 파일 소유 범위에서만 허용한다.
Sol과 Muse가 같은 파일 또는 같은 worktree에 동시에 쓰지 않는다. 디자인 토큰·package/lock·공통 계약은 single writer다.
Sol이 통합하며 Muse는 UI 작업 커밋 또는 diff와 실제 브라우저 증거를 제출한다. 검수 worktree는 고정 commit에서 생성한다.
호스트 설정·global permissions·구독 credentials·운영 DB·다른 프로젝트는 변경하지 않는다.
Git reset --hard/clean, force push, 비밀키 출력, broad pkill, 무단 배포 금지.

## 스킬
표준 위치는 `.agents/skills/`다. 관련 작업 전에 해당 SKILL.md를 읽는다.
cm-contract-metrics / cm-public-privacy / cm-kakao-map / cm-cinematic-ui /
cm-static-supabase / cm-browser-review / cm-sol-muse / cm-release-verification.
에이전트가 자동 발견하지 못하면 정확한 파일 경로를 명시해 읽게 한다. 도구가 없는데 호출했다고 주장하지 않는다.

## 완료 정의
코드 + 재현 가능한 검사 + 문서 동기화 + 실제 UI 브라우저 증거가 필요하다.
Missing API/키/실제 upstream 필드는 BLOCKED로 기록한다. fixture와 production은 명시적으로 구분한다.
Muse 텍스트 소감만으로 UI 승인하지 않는다. screenshot/행동/console/network 검증과 문제 재현이 필요하다.
