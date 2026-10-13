import { hashOf } from "@/lib/publishing/schedule";
import type { PublishSurface } from "@/lib/publishing/surfaces";
import type { AfterPublishEvent, OptimizerSource } from "./types";

/**
 * TOPLU YAYIN çekirdeği ("Taslakları önizle ve tümünü yayınla" ve Otopilot `publish=true`): bekleyen taslağı olan
 * yüzeyleri SIRAYLA Yayın masası bağdaştırıcısıyla (`surface.publish`) yayınlar. Biri hata verirse diğerleri sürer;
 * her yüzeyin sonucu ayrı döner. Başarılı her yayından sonra `onPublished` (yayın sonrası zinciri) çağrılır ve onun
 * hatası yayın sonucunu ETKİLEMEZ. Yetki ve denetim izi çağıranın işidir.
 */

export type PublishAllItem = { surface: string; label: string; ok: boolean; skipped?: boolean; message: string };

/** Bekleyen taslak var mı: taslak canlıdan (yoksa kod varsayılanından) farklı. */
export function hasPendingDraft(state: { live: unknown | null; draft: unknown | null }, defaults: () => unknown): boolean {
  if (!state.draft) return false;
  return hashOf(state.draft) !== hashOf(state.live ?? defaults());
}

export async function publishDraftsSequential(
  surfaces: readonly Pick<PublishSurface, "id" | "label" | "livePaths" | "defaults" | "readState" | "publish">[],
  actor: { id: string; name: string; source: OptimizerSource },
  opts: { label?: string; onPublished?: (ev: AfterPublishEvent) => void | Promise<void> } = {},
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
      const res = await s.publish(state.draft, actor.id, label, actor.name);
      if (!res.ok) {
        out.push({ surface: s.id, label: s.label, ok: false, message: res.error || "Yayınlanamadı." });
        continue;
      }
      out.push({ surface: s.id, label: s.label, ok: true, message: "Yayınlandı." });
      try {
        await opts.onPublished?.({
          surface: s.id,
          kind: "publish",
          publishRef: hashOf(state.draft).slice(0, 16),
          livePaths: s.livePaths.map((p) => p.path),
          actorId: actor.id,
          source: actor.source,
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
