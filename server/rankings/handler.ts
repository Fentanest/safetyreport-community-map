import {
  querySchema,
  responseSchema,
} from "../../contracts/user-rankings/types.ts";
import {
  authenticate,
  type ViewerAuthDeps,
  ViewerAuthError,
} from "../viewerAuth.ts";

export interface RankingDeps extends ViewerAuthDeps {
  allowedOrigins: string[];
  rpc(
    user: string,
    session: string,
    query: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<unknown>;
  allowRequest(user: string): Promise<boolean>;
}
const MESSAGES: Record<string, string> = {
  auth_required: "카카오 로그인이 필요합니다.",
  session_expired: "로그인 세션을 다시 확인해 주세요.",
  kakao_required: "카카오 로그인이 필요합니다.",
  contributor_required: "활성 신고 공유 동의가 필요합니다.",
  upload_required: "지도에 공유된 고유 신고 10건 이상이 필요합니다.",
  origin_forbidden: "허용되지 않은 요청입니다.",
  INVALID_QUERY: "랭킹 조회 조건을 확인해 주세요.",
  DATASET_CHANGED: "자료가 바뀌었습니다. 첫 페이지부터 다시 조회해 주세요.",
  rate_limited: "요청이 많습니다. 잠시 뒤 다시 시도해 주세요.",
  service_unavailable:
    "랭킹을 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요.",
  METHOD_NOT_ALLOWED: "지원하지 않는 요청 방식입니다.",
  NOT_FOUND: "지원하지 않는 경로입니다.",
};
const STATUS: Record<string, number> = {
  auth_required: 401,
  session_expired: 401,
  kakao_required: 403,
  contributor_required: 403,
  upload_required: 403,
  origin_forbidden: 403,
  INVALID_QUERY: 400,
  DATASET_CHANGED: 409,
  rate_limited: 429,
  service_unavailable: 503,
  METHOD_NOT_ALLOWED: 405,
  NOT_FOUND: 404,
};
export function createRankingHandler(deps: RankingDeps) {
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get("origin");
    const headers = new Headers({
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "private, no-store, max-age=0",
      Pragma: "no-cache",
      Vary: "Origin, Authorization",
      "X-Content-Type-Options": "nosniff",
      "Access-Control-Expose-Headers": "Retry-After",
    });
    if (origin && deps.allowedOrigins.includes(origin)) {
      headers.set("Access-Control-Allow-Origin", origin);
    }
    const error = (code: string, details?: unknown) => {
      if (code === "rate_limited") headers.set("Retry-After", "60");
      if (STATUS[code] === 401) headers.set("WWW-Authenticate", "Bearer");
      return new Response(
        JSON.stringify({
          error: {
            code,
            message: MESSAGES[code],
            ...(details ? { details } : {}),
          },
        }),
        { status: STATUS[code], headers },
      );
    };
    if (origin && !deps.allowedOrigins.includes(origin)) {
      return error("origin_forbidden");
    }
    if (request.method === "OPTIONS") {
      headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
      headers.set(
        "Access-Control-Allow-Headers",
        "authorization, apikey, content-type, x-client-info",
      );
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== "GET") return error("METHOD_NOT_ALLOWED");
    const url = new URL(request.url);
    if (!/\/user-rankings\/?$/.test(url.pathname)) return error("NOT_FOUND");
    try {
      const viewer = await authenticate(request, deps);
      if (url.search.length > 4096) return error("INVALID_QUERY");
      const raw: Record<string, unknown> = {};
      for (const [key, value] of url.searchParams) {
        if (key in raw) return error("INVALID_QUERY");
        raw[key] = ["min_reports", "page", "page_size"].includes(key)
          ? Number(value)
          : value;
      }
      const parsed = querySchema.safeParse(raw);
      if (!parsed.success) return error("INVALID_QUERY");
      if (!await deps.allowRequest(viewer.uid)) return error("rate_limited");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 25000);
      const abort = () => controller.abort();
      request.signal.addEventListener("abort", abort, { once: true });
      let data: unknown;
      try {
        data = await deps.rpc(
          viewer.uid,
          viewer.session,
          parsed.data,
          controller.signal,
        );
      } finally {
        clearTimeout(timer);
        request.signal.removeEventListener("abort", abort);
      }
      if (data && typeof data === "object" && "error" in data) {
        const e = data as { error: unknown; details?: unknown };
        const code = String(e.error);
        const allowed = [
          "session_expired",
          "kakao_required",
          "contributor_required",
          "upload_required",
          "DATASET_CHANGED",
        ];
        if (!allowed.includes(code)) return error("service_unavailable");
        let details: unknown;
        if (code === "upload_required") {
          const d = e.details as { current?: unknown } | undefined;
          details = {
            required: 10,
            current: typeof d?.current === "number" &&
                Number.isSafeInteger(d.current) && d.current >= 0
              ? d.current
              : null,
          };
        }
        return error(code, details);
      }
      // Strict nested allowlist. Private DB fields cause a closed failure, never an opaque pass-through.
      const safe = responseSchema.parse(data);
      if (
        safe.page !== parsed.data.page ||
        safe.page_size !== parsed.data.page_size || safe.rows.some((r) =>
          r.is_me !== (r.uuid === viewer.uid)
        ) || (safe.me && safe.me.uuid !== viewer.uid)
      ) return error("service_unavailable");
      return new Response(JSON.stringify(safe), { status: 200, headers });
    } catch (e) {
      if (e instanceof ViewerAuthError) return error(e.code);
      return error(
        e instanceof Error && e.message === "INVALID_QUERY"
          ? "INVALID_QUERY"
          : "service_unavailable",
      );
    }
  };
}
