---
name: cm-browser-review
description: Perform real browser UI/UX review with interactions, screenshots, accessibility and network evidence.
---
# cm-browser-review

## 읽기
MUSE.md, acceptance-matrix.md, reviews/REPORT_TEMPLATE.md.
## 실행
fixed candidate commit과 local URL 확인. 실제 browser를 열고 1920/1440/2560/390 dark/light 검사.
기간apply, scope map, table sort, full name, masked collision, one sample, error fixtures, keyboard/Esc/briefing 수행.
screenshots를 실제로 열고 overflow·가독성·focus·chart legends·network/console를 확인한다.
## 출력
재현가능 issue table + screenshot paths + exact commit/tool/data-mode + PASS/FAIL/BLOCKED 범위.
## 금지
소스읽기를시각검수로대체, baseline생성=비교통과, 실지도가없는데지도연동PASS.
