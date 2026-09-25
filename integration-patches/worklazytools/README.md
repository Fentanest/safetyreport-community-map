# WorklazyTools 연결 패치

`0001-compose-pinned-safeauth.patch` — WorklazyTools `main` (`d819ec3`, `deploy-pages.yml` blob
`362345248c75021d1af433097443751251907283`) 기준. `git apply --check` 통과, actionlint 통과.
이 저장소에서 만든 패치일 뿐이며 WorklazyTools에는 적용·커밋·push하지 않았다.

변경:
- `.github/safeauth-pin.json` 추가 (`enabled: false`, `commit` 0으로 채움 → 적용해도 동작 변화 없음).
- `.github/workflows/deploy-pages.yml`: 기존 build·단위·광고·정적·동영상 검사 **뒤**, `upload-pages-artifact` **앞**에
  3단계 추가 — 핀 읽기 → 고정 커밋 checkout(읽기 전용 토큰, `persist-credentials: false`) → `npm ci` + `npm run build:safeauth` +
  `compose-into-site.mjs` + `verify-composed-site.mjs`.

인증 소스·UI는 WorklazyTools에 복사하지 않는다. 기존 검사를 끄거나 예외를 추가하지 않는다(합성이 검사 뒤에 있어서
`test:static`의 HTML 계약에 `/safeauth/`가 걸리지 않는다). 대신 합성 스크립트가 기존 파일 전부의 해시가 그대로인지 증명한다.

적용·설정 순서는 `docs/safeauth/deployment.md` §5.
