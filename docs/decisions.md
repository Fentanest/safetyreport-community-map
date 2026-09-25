# ADR 인덱스
본 정본은 product-decisions.md와 함께 적용한다. 이전 결정은 installer 백업에 보존된다.

- ADR-101: Phone OTP → Google 일반 계정. UUID 관계 유지, 자동업로드용 실행 담당 세션 갱신.
- ADR-102: 정확좌표·담당자 실명·n=1 공개. 법적 익명성 보장 문구 없음.
- ADR-103 (2026-09-26 개정): 지역 prefix는 private vehicle identity에서 보존. 공개 표시에도 짧은 지역명을 그대로 두고, 그 뒤 번호의 2/4/6번째만 마스킹(경기76자3623 → 경기7*자*6*3).
- ADR-104: Pages static UI + safe initial snapshot + fixed public aggregation API.
- ADR-105: 임의 기간 TOP5는 private 전체 후보 재집계. 월별 TOP5 합산 금지.
- ADR-106: 신고일/처리완료일 axis를 metric별 분리. 없는 역사/금액/분모 추정 금지.
- ADR-107: family design board를 기준으로 cinematic UI 확장. Kakao baseline map을 가짜 dark tile로 왜곡하지 않음.
- ADR-108: Sol + Muse만 운영, Muse OpenCode 실제 모델 ID host discovery, browser evidence 필수.
- ADR-109: 타 레포 수정과 운영 배포는 별도 승인. 환경 미준비는 fixture 진행과 실제 연동 BLOCKED를 분리.

추가 변경은 문제/대안/선택/영향/검증을 새 ADR에 기록한다. 의사결정 문서만 새로 만들고 계약/테스트/UI를
과거 규칙으로 남기는 것은 허용하지 않는다.
