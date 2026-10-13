import { hashOf } from "@/lib/publishing/schedule";
import type { PublishSurface } from "@/lib/publishing/surfaces";
import type { AfterPublishEvent, OptimizerSource } from "./types";

/**
 * TOPLU YAYIN çekirdeği ("Taslakları önizle ve tümünü yayınla" ve Otopilot `publish=true`): bekleyen taslağı olan
 * yüzeyleri SIRAYLA Yayın masası bağdaştırıcısıyla (`surface.publish`) yayınlar. Biri hata verirse diğerleri sürer;
 * her yüzeyin sonucu ayrı döner. Başarılı her yayından sonra `onPublished` (yayın sonrası zinciri) çağrılır ve onun
 * hatası yayın sonucunu ETKİLEMEZ. Yetki ve denetim izi çağıranın işidir.
 * `expected` verilirse (Kokpit "Farkı gördüm, tümünü yayınla") YALNIZ önizlenen yüzeyler ve yalnız taslak özeti önizlemedeki
 * özetle hâlâ aynıysa yayınlanır: önizlemeden sonra değişen ya da önizlemede olmayan taslak görülmeden canlıya çıkmaz.
 * `captureBefore` verilirse yüzeyin canlı yollarının yayın öncesi özeti yazımdan hemen önce alınır (doğrulama tabanı).
 */

export const DRAFT_CHANGED = "Taslak önizlemeden sonra değişti; yeniden önizleyin.";
export const NOT_PREVIEWED = "Önizlemede yoktu; yayınlanmadı.";

export type PublishAllItem = { surface: string; label: string; ok: boolean; skipped?: boolean; message: string };

/** Bekleyen taslak var mı: taslak canlıdan (yoksa kod varsayılanından) farklı. */
export function hasPendingDraft(state: { live: unknown | null; draft: unknown | null }, defaults: () => unknown): boolean {
  if (!state.draft) return false;
  return hashOf(state.draft) !== hashOf(state.live ?? defaults());
}

export async function publishDraftsSequential(
  surfaces: readonly Pick<PublishSurface, "id" | "label" | "livePaths" | "defaults" | "readState" | "publish">[],
  actor: { id: string; name: string; source: OptimizerSource },
  opts: {
    label?: string;
    onPublished?: (ev: AfterPublishEvent) => void | Promise<void>;
    /** Yüzey kimliği → önizlenen taslağın `hashOf` özeti. */
    expected?: Readonly<Record<string, string>>;
    captureBefore?: (paths: readonly string[]) => Promise<Record<string, string>>;
  } = {},
): Promise<PublishAllItem[]> {
  const out: PublishAllItem[] = [];
  const label = (opts.label ?? "Toplu yayın").slice(0, 80);
  for (const s of surfaces) {
    try {
      const state = await s.readState();
      if (!hasPendingDraft(state, s.defaults)) {
        out.push({ surface: s.id, label: s.label, ok: true, skipped: true, message: "Bekleyen taslak yok." });
        continue;
      }
      if (opts.expected) {
        const want = opts.expected[s.id];
        if (want === undefined) {
          out.push({ surface: s.id, label: s.label, ok: false, skipped: true, message: NOT_PREVIEWED });
          continue;
        }
        if (want !== hashOf(state.draft)) {
          out.push({ surface: s.id, label: s.label, ok: false, skipped: true, message: DRAFT_CHANGED });
          continue;
        }
      }
      const livePaths = s.livePaths.map((p) => p.path);
      const beforeDigests = opts.captureBefore ? await opts.captureBefore(livePaths).catch(() => undefined) : undefined;
      const res = await s.publish(state.draft, actor.id, label, actor.name);
      if (!res.ok) {
        out.push({ surface: s.id, label: s.label, ok: false, message: res.error || "Yayınlanamadı." });
        continue;
      }
      out.push({ surface: s.id, label: s.label, ok: true, message: "Yayınlandı." });
      // Yayın sonrası yollar yayından SONRA okunur: SEO yüzeyi etkilenen sayfaları ancak yayında bilir (diğerlerinde aynı).
      const publishedPaths = s.livePaths.map((p) => p.path);
      try {
        await opts.onPublished?.({
          surface: s.id,
          kind: "publish",
          publishRef: hashOf(state.draft).slice(0, 16),
          livePaths: publishedPaths,
          actorId: actor.id,
          source: actor.source,
          ...(beforeDigests ? { beforeDigests } : {}),
        });
      } catch {
        // Yayın sonrası zinciri yayının sonucunu değiştirmez.
      }
    } catch (e) {
      out.push({ surface: s.id, label: s.label, ok: false, message: e instanceof Error ? e.message.slice(0, 160) : "Beklenmeyen hata." });
    }
  }
  return out;
}
