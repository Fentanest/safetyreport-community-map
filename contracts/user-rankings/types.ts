import { z } from "zod";
export const METRICS = [
  "reports_count",
  "fine_count",
  "fine_rate",
  "rejected_count",
  "rejected_rate",
  "partial_count",
  "partial_rate",
] as const;
export const METRIC_LABELS: Record<typeof METRICS[number], string> = {
  reports_count: "신고 건수",
  fine_count: "과태료 처분 건수",
  fine_rate: "과태료 처분율",
  rejected_count: "불수용 건수",
  rejected_rate: "불수용 비율",
  partial_count: "일부수용 건수",
  partial_rate: "일부수용 비율",
};
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) =>
  !isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s
);
export const querySchema = z.strictObject({
  theme: z.enum(["reporters", "fines", "unlucky"]).default("reporters"),
  metric: z.enum(METRICS).default("reports_count"),
  period: z.enum(["all", "range", "month"]).default("all"),
  start: date.nullable().default(null),
  end: date.nullable().default(null),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).nullable().default(null),
  date_basis: z.enum(["completed_date", "report_date"]).default(
    "completed_date",
  ),
  category: z.enum(["all", "traffic", "parking", "other"]).default("all"),
  min_reports: count.min(1).default(1),
  page: count.min(1).default(1),
  page_size: count.min(1).max(50).default(20),
  consistency: z.literal("latest").optional(),
  expected_version: z.string().regex(/^[a-f0-9]{32}$/).nullable().default(null),
}).superRefine((q, c) => {
  const allowed = q.theme === "reporters"
    ? ["reports_count"]
    : q.theme === "fines"
    ? ["fine_count", "fine_rate"]
    : ["rejected_count", "rejected_rate", "partial_count", "partial_rate"];
  if (!allowed.includes(q.metric)) {
    c.addIssue({ code: "custom", message: "theme metric mismatch" });
  }
  if (q.period === "range" && (!q.start || !q.end || q.start > q.end)) {
    c.addIssue({ code: "custom", message: "range required" });
  }
  if (q.period !== "range" && (q.start || q.end)) {
    c.addIssue({ code: "custom", message: "range conflict" });
  }
  if (q.period !== "month" && q.month) {
    c.addIssue({ code: "custom", message: "month conflict" });
  }
  if (q.page > 1 && !q.expected_version && q.consistency !== "latest") {
    c.addIssue({ code: "custom", message: "version required" });
  }
});
export type RankingQuery = z.infer<typeof querySchema>;
export const rowSchema = z.strictObject({
  uuid: z.uuid(),
  rank: count.min(1),
  tie_count: count.min(1),
  reports: count.min(1),
  fine: count,
  rejected: count,
  partial: count,
  completed_unknown: count,
  numerator: count,
  denominator: count.min(1),
  value: z.number().min(0),
  is_me: z.boolean(),
});
export const responseSchema = z.strictObject({
  schema_version: z.literal("user-rankings-v1"),
  cohort_policy_version: z.literal("single-date-v1"),
  dataset_version: z.string().regex(/^[a-f0-9]{32}$/),
  generated_at: z.iso.datetime(),
  scope: z.strictObject({
    theme: z.enum(["reporters", "fines", "unlucky"]),
    metric: z.enum(METRICS),
    period: z.enum(["all", "range", "month"]),
    start: date.nullable(),
    end: date.nullable(),
    month: z.string().nullable(),
    date_basis: z.enum(["report_date", "completed_date"]),
    category: z.enum(["all", "traffic", "parking", "other"]),
    min_reports: count.min(1),
    timezone: z.literal("Asia/Seoul"),
    in_progress: z.boolean(),
  }),
  total_participants: count,
  rows: z.array(rowSchema).max(50),
  me: rowSchema.nullable(),
  page: count.min(1),
  page_size: count.min(1).max(50),
  next_page: count.min(1).nullable(),
  diagnostics: z.strictObject({
    selected_date_missing: count,
    completed_unknown: count,
    inconsistent_disposition: count,
  }),
});
export type RankingResponse = z.infer<typeof responseSchema>;
export type RankingRow = z.infer<typeof rowSchema>;
export function kstMonth(now = new Date()): string {
  return new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 7);
}
export function monthBounds(month: string): { start: string; end: string } {
  const [year, m] = month.split("-").map(Number);
  const end = new Date(0);
  end.setUTCFullYear(year, m, 0);
  return { start: `${month}-01`, end: end.toISOString().slice(0, 10) };
}
