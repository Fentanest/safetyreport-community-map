---
name: cm-public-privacy
description: Apply exact plate masking and verify the public/private data boundary without sample suppression.
---
# cm-public-privacy

## 읽기
privacy-security.md, public-api-contract.md, contracts/masking-vectors.json.
## 실행
private canonical에 지역prefix 보존 → 전체 후보 집계 → display는 짧은 지역명 유지·그 뒤 2/4/6문자 마스킹.
동일 masked label이 여러 행이어도 merge하지 않는다. 1건 공개·담당자명 전체·원좌표 유지.
strict DTO allowlist와 원번호/secret canary로 API·DOM·aria·URL·export·dist·source map 노출 검사를 한다.
## 출력
positive/negative tests, 공개 DTO, token/field matrix, scan 결과.
## 금지
client-only masking, 원번호 hash를 공개키로 제공, 실명/1건정책 임의축소, 완전익명이라고 보증.
