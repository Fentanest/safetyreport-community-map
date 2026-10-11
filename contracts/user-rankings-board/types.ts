// user-rankings-board-v1 (2026-10-11 사용자 결정): 기간·분류·상세 조건 한 번으로 세 테마 일곱 지표의 TOP K 를 한 응답에.
// 행(row)·순위 규칙·오류 코드는 user-rankings-v1 과 같다. 페이지형 '전체 보기'는 기존 계약(../user-rankings)을 그대로 쓴다.
import { z } from "zod";
import { METRICS, rowSchema } from "../user-rankings/types.ts";

export const BOARD_TOP_DEFAULT = 5;
export const BOARD_TOP_MAX = 10;
export const BOARD_THEMES = ["reporters", "fines", "unlucky"] as const;
/** Fixed board order. The server returns exactly these seven entries in this order. */
export const BOARD_METRICS = [
  { theme: "reporters", metric: "reports_count" },
  { theme: "fines", metric: "fine_count" },
  { theme: "fines", metric: "fine_rate" },
  { theme: "unlucky", metric: "rejected_count" },
  { theme: "unlucky", metric: "rejected_rate" },
  { theme: "unlucky", metric: "partial_count" },
  { theme: "unlucky", metric: "partial_rate" },
] as const satisfies ReadonlyArray<{ theme: typeof BOARD_THEMES[number]; metric: typeof METRICS[number] }>;

const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) =>
  !isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s
);
const period = z.enum(["all", "range", "month"]);
const basis = z.enum(["completed_date", "report_date"]);
// 5분류(observation-v5, 2026-10-11): traffic·parking·safety·living·other.
const category = z.enum(["all", "traffic", "parking", "safety", "living", "other"]);

export const boardQuerySchema = z.strictObject({
  period: period.default("all"),
  start: date.nullable().default(null),
  end: date.nullable().default(null),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).nullable().default(null),
  date_basis: basis.default("completed_date"),
  category: category.default("all"),
  min_reports: count.min(1).default(1),
  top: z.number().int().min(1).max(BOARD_TOP_MAX).default(BOARD_TOP_DEFAULT),
  consistency: z.literal("latest").optional(),
}).superRefine((q, c) => {
  if (q.period === "range" && (!q.start || !q.end || q.start > q.end)) {
    c.addIssue({ code: "custom", message: "range required" });
  }
  if (q.period !== "range" && (q.start || q.end)) {
    c.addIssue({ code: "custom", message: "range conflict" });
  }
  if (q.period !== "month" && q.month) {
    c.addIssue({ code: "custom", message: "month conflict" });
  }
});
export type BoardQuery = z.infer<typeof boardQuerySchema>;

export const boardEntrySchema = z.strictObject({
  theme: z.enum(BOARD_THEMES),
  metric: z.enum(METRICS),
  total_participants: count,
  rows: z.array(rowSchema).max(BOARD_TOP_MAX),
  me: rowSchema.nullable(),
});
export type BoardEntry = z.infer<typeof boardEntrySchema>;

export const boardResponseSchema = z.strictObject({
  schema_version: z.literal("user-rankings-board-v1"),
  cohort_policy_version: z.literal("single-date-v1"),
  dataset_version: z.string().regex(/^[a-f0-9]{32}$/),
  generated_at: z.iso.datetime(),
  scope: z.strictObject({
    period,
    start: date.nullable(),
    end: date.nullable(),
    month: z.string().nullable(),
    date_basis: basis,
    category,
    min_reports: count.min(1),
    top: z.number().int().min(1).max(BOARD_TOP_MAX),
    timezone: z.literal("Asia/Seoul"),
    in_progress: z.boolean(),
  }),
  total_participants: count,
  boards: z.array(boardEntrySchema).length(BOARD_METRICS.length),
  diagnostics: z.strictObject({
    selected_date_missing: count,
    completed_unknown: count,
    inconsistent_disposition: count,
  }),
}).superRefine((r, c) => {
  r.boards.forEach((b, i) => {
    const want = BOARD_METRICS[i];
    if (b.theme !== want.theme || b.metric !== want.metric) {
      c.addIssue({ code: "custom", message: "board order" });
    }
    if (b.rows.length > r.scope.top) {
      c.addIssue({ code: "custom", message: "board size" });
    }
  });
});
export type BoardResponse = z.infer<typeof boardResponseSchema>;
