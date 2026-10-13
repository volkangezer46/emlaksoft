import { matchStaticIds, staticRouteById, type StaticRouteId } from "@/lib/static-home/registry";

/**
 * K2 — DÜZELTME YÜRÜTÜCÜSÜ `static_refresh` (risk: güvenli). Sözleşme tipleri SP1 `src/lib/site-issues/types.ts`'ten
 * KOPYALANIR (import edilmez); kayıt S4 dikişinde yapılır. Otopilot izin listesinde varsayılan olarak yer alır.
 *  - `plan()` kuru çalışmadır: hiçbir şey yazmaz; hangi statik sayfanın önbelleğinin temizlenip yeniden çizileceğini söyler.
 *  - `apply()` önbelleği düşürür, `statik.rev` artırır, sayfayı yeniden çizer; önce/sonra ETag ve gzip boyutunu döner.
 * İçerik DEĞİŞTİRMEZ (yalnız sunum önbelleği); bu yüzden geri alma gerektirmez.
 */
export type ExecutorRisk = "guvenli" | "orta" | "riskli";
export type ExecutorTarget = { url: string; issueId?: string | null; payload?: unknown };
export type ExecutorPlan = {
  kind: string;
  target: ExecutorTarget;
  canApply: boolean;
  summary: string;
  before?: unknown;
  after?: unknown;
  reason?: string;
};
export type ExecutorResult = { ok: boolean; message: string; before?: unknown; after?: unknown };
export type IssueExecutor = {
  kind: string;
  label: string;
  risk: ExecutorRisk;
  plan(target: ExecutorTarget): Promise<ExecutorPlan>;
  apply(target: ExecutorTarget, ctx?: { actorId?: string | null }): Promise<ExecutorResult>;
};

type PageState = { etag: string | null; at: number | null; isStatic: boolean | null; gzipBytes: number | null };

export type StaticExecutorDeps = {
  state: (id: StaticRouteId) => Promise<PageState>;
  enabledIds: () => Promise<readonly StaticRouteId[]>;
  refresh: (id: StaticRouteId, actorId?: string) => Promise<{ ok: boolean; error?: string }>;
};

function targetId(target: ExecutorTarget): StaticRouteId | null {
  let path = target.url;
  try {
    if (/^https?:/i.test(path)) path = new URL(path).pathname;
  } catch {
    return null;
  }
  return matchStaticIds([path])[0] ?? null;
}

export function createStaticRefreshExecutor(deps: StaticExecutorDeps): IssueExecutor {
  const plan = async (target: ExecutorTarget): Promise<ExecutorPlan> => {
    const id = targetId(target);
    const route = id ? staticRouteById(id) : null;
    if (!id || !route) return { kind: "static_refresh", target, canApply: false, summary: "Bu adres statik sayfa kayıt defterinde yok", reason: "kayitta_yok" };
    const enabled = new Set(await deps.enabledIds());
    if (!enabled.has(id)) {
      return { kind: "static_refresh", target, canApply: false, summary: `${route.path} statik sunumda kapalı; tazelenecek önbellek yok`, reason: "kapali" };
    }
    return {
      kind: "static_refresh",
      target,
      canApply: true,
      summary: `${route.path} statik önbelleği temizlenip yeniden çizilir (içerik değişmez)`,
      before: await deps.state(id),
    };
  };
  return {
    kind: "static_refresh",
    label: "Statik sayfayı tazele",
    risk: "guvenli",
    plan,
    async apply(target, ctx) {
      const p = await plan(target);
      if (!p.canApply) return { ok: false, message: p.summary };
      const id = targetId(target)!;
      const before = await deps.state(id);
      const r = await deps.refresh(id, ctx?.actorId ?? undefined);
      const after = await deps.state(id);
      if (!r.ok) return { ok: false, message: `Yeniden çizim başarısız: ${r.error ?? "bilinmeyen hata"}`, before, after };
      return {
        ok: after.isStatic !== false,
        message: after.isStatic === false ? "Önbellek tazelendi ama sayfa normal sürüme düştü (Hız ekranında nedeni görünür)" : "Statik sayfa tazelendi",
        before,
        after,
      };
    },
  };
}

export const staticRefreshExecutor: IssueExecutor = createStaticRefreshExecutor({
  state: async (id) => {
    const c = (await import("@/lib/static-home/render")).staticCache().snapshot(id).cached;
    return { etag: c?.etag ?? null, at: c?.at ?? null, isStatic: c?.isStatic ?? null, gzipBytes: c?.gzipBytes ?? null };
  },
  enabledIds: async () => (await import("@/lib/static-home/render")).enabledIdsNow(),
  refresh: async (id, actorId) => {
    const m = await import("@/lib/static-home/render");
    const { rows } = await m.purgeAndWarm([id], actorId);
    const row = rows[0];
    return row?.ok ? { ok: true } : { ok: false, error: row?.error };
  },
});
