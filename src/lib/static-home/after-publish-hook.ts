import { matchStaticIds, type StaticRouteId } from "@/lib/static-home/registry";

/**
 * K3 — YAYIN SONRASI KANCA (statik tazeleme, order 10; doğrulama kancası `verify` order 20'den ÖNCE çalışır).
 * Sözleşme tipleri SP1 `src/lib/site-issues/types.ts`'ten KOPYALANIR (import edilmez); kayıt `publishing/after-publish.ts` HOOKS.
 *
 * Davranış: `livePaths` ile eşleşen kimlikler (ya da "*" → tümü) bellek önbelleğinden düşer, `statik.rev` BİR kez artar
 * (diğer süreçler ≤5 sn'de tazelenir) ve AÇIK olanlar yeniden çizilir (ısıtma). Böylece yayından sonra eski statik sayfa
 * görünmez. Hata fırlatmaz; sonuç satırı döner (yayın sonucu kanca hatasından etkilenmez).
 */
export type AfterPublishEvent = {
  surfaceId: string;
  livePaths: readonly string[];
  actorId?: string | null;
  source?: string;
};
export type AfterPublishHookResult = { ok: boolean; message: string; detail?: Record<string, unknown> };
export type AfterPublishHook = {
  id: string;
  order: number;
  label: string;
  run(ev: AfterPublishEvent): Promise<AfterPublishHookResult>;
};

export type StaticHookDeps = {
  invalidate: (id: StaticRouteId) => void | Promise<void>;
  bumpRev: (actorId?: string) => Promise<number | null>;
  enabledIds: () => Promise<readonly StaticRouteId[]>;
  warm: (ids: readonly StaticRouteId[]) => Promise<Array<{ id: string; ok: boolean; isStatic: boolean | null }>>;
};

export function createStaticAfterPublishHook(deps: StaticHookDeps): AfterPublishHook {
  return {
    id: "static_refresh",
    order: 10,
    label: "Statik sayfa tazeleme",
    async run(ev) {
      const ids = matchStaticIds(ev.livePaths);
      if (ids.length === 0) return { ok: true, message: "Statik sayfa etkilenmedi", detail: { ids: [] } };
      try {
        for (const id of ids) await deps.invalidate(id);
        const rev = await deps.bumpRev(ev.actorId ?? undefined);
        const enabled = new Set(await deps.enabledIds().catch(() => [] as StaticRouteId[]));
        const toWarm = ids.filter((id) => enabled.has(id));
        const rows = toWarm.length ? await deps.warm(toWarm) : [];
        const failed = rows.filter((r) => !r.ok || r.isStatic === false);
        const ok = rev !== null && failed.length === 0;
        const message =
          rev === null
            ? "Önbellek bu sunucuda temizlendi; diğer süreçlere bildirim yazılamadı (en geç 60 sn'de tazelenir)"
            : failed.length
              ? `${toWarm.length - failed.length}/${toWarm.length} statik sayfa yenilendi; ${failed.map((r) => r.id).join(", ")} normal sürümle sunuluyor`
              : toWarm.length
                ? `${toWarm.length} statik sayfa yenilendi`
                : "Statik önbellek temizlendi (etkilenen sayfalar statik sunumda kapalı)";
        return { ok, message, detail: { ids, warmed: toWarm, rev, failed: failed.map((r) => r.id) } };
      } catch (e) {
        return { ok: false, message: `Statik tazeleme hatası: ${e instanceof Error ? e.message : "bilinmiyor"}`, detail: { ids } };
      }
    },
  };
}

/** Gerçek bağımlılıklarla kanca (render.ts tembel yüklenir: kanca listesi kaydı ağır modülü çekmez). */
export const staticAfterPublishHook: AfterPublishHook = createStaticAfterPublishHook({
  invalidate: async (id) => (await import("@/lib/static-home/render")).staticCache().invalidate(id),
  bumpRev: async (actorId) => (await import("@/lib/static-home/render")).bumpStaticRev(actorId),
  enabledIds: async () => (await import("@/lib/static-home/render")).enabledIdsNow(),
  warm: async (ids) => {
    const m = await import("@/lib/static-home/render");
    const { mapWithConcurrency } = await import("@/lib/static-home/cache");
    return mapWithConcurrency(ids, 2, m.warmStatic);
  },
});
