import { canAutoOptimize } from "./fingerprint";
import { executorFor } from "./executors";
import type { PublishAllItem } from "./publish-all";
import type { IssueExecutor, IssueStatus, OptimizerSource, SiteIssue } from "./types";

/**
 * OTOPİLOT: gece, izin listesindeki ve risk düzeyi "guvenli" olan düzeltmeleri kendisi hazırlar; `publish` açıksa
 * oluşan taslakları Yayın masası üzerinden yayınlar. Her işlem `site_optimizer_actions`'a `source=otopilot` ile yazılır.
 * KAPALIYKEN HİÇBİR YAZMA YAPILMAZ. Ayar `growth.autopilot` doğrudan platform_settings'te (registry dışı; bkz.
 * settings-contract LEGACY_WRITERS gerekçesi). Bu modül SAF çekirdektir; DB/ayar erişimi `deps` ile verilir (testli).
 */

export const AUTOPILOT_KEY = "growth.autopilot";

export const AUTOPILOT_KINDS = [
  "indexnow",
  "static_refresh",
  "seo_meta_draft:long-description",
  "seo_meta_draft:missing-og-title",
  "seo_meta_draft:long-title",
  "seo_meta_draft:missing-description",
  "redirect_404_draft",
] as const;

export type AutopilotSettings = {
  enabled: boolean;
  kinds: string[];
  publish: boolean;
  /** Açan personel: Otopilot yayınları onun adına Yayın masası geçmişine düşer. */
  enabledBy?: string | null;
  enabledByName?: string | null;
};

export const DEFAULT_AUTOPILOT: AutopilotSettings = { enabled: false, kinds: [...AUTOPILOT_KINDS], publish: false };

/** Kaydı okur; bozuk/eksik değer güvenli varsayılana (KAPALI) düşer; bilinmeyen tür izin listesine giremez. */
export function parseAutopilot(raw: string | null | undefined): AutopilotSettings {
  if (!raw) return { ...DEFAULT_AUTOPILOT, kinds: [...DEFAULT_AUTOPILOT.kinds] };
  try {
    const v = JSON.parse(raw) as Partial<AutopilotSettings>;
    const allowed = new Set<string>(AUTOPILOT_KINDS);
    const kinds = Array.isArray(v.kinds) ? v.kinds.filter((k): k is string => typeof k === "string" && allowed.has(k)) : [...AUTOPILOT_KINDS];
    return {
      enabled: v.enabled === true,
      kinds,
      publish: v.publish === true,
      enabledBy: typeof v.enabledBy === "string" ? v.enabledBy : null,
      enabledByName: typeof v.enabledByName === "string" ? v.enabledByName.slice(0, 80) : null,
    };
  } catch {
    return { ...DEFAULT_AUTOPILOT, kinds: [...DEFAULT_AUTOPILOT.kinds] };
  }
}

/** Açma onayında listelenecek, teknik olmayan açıklamalar. */
export const AUTOPILOT_KIND_LABEL: Record<(typeof AUTOPILOT_KINDS)[number], string> = {
  indexnow: "Değişen sayfaları arama motorlarına bildirir (IndexNow)",
  static_refresh: "Hızlı (statik) sayfa kopyalarını tazeler",
  "seo_meta_draft:long-description": "Kesilen arama açıklamalarını kısaltıp taslağa alır",
  "seo_meta_draft:missing-og-title": "Eksik paylaşım başlıklarını taslağa ekler",
  "seo_meta_draft:long-title": "Arama sonucunda kesilen başlıkları piksel sınırına kısaltıp taslağa alır",
  "seo_meta_draft:missing-description": "Eksik arama açıklamalarını sayfanın kayıtlı tanımından taslağa ekler",
  redirect_404_draft: "Sık 404 alan adresler için yönlendirme taslağı hazırlar",
};

export type AutopilotDeps = {
  readSettings(): Promise<AutopilotSettings>;
  listIssues(): Promise<SiteIssue[]>;
  executors: readonly IssueExecutor[];
  record(input: { kind: string; source: OptimizerSource; target: string; status: string; before?: unknown; after?: unknown; actor?: string | null }): Promise<unknown>;
  patchIssue(id: string, patch: { status: IssueStatus; publish_ref?: string | null }): Promise<unknown>;
  publishSurfaces(surfaceIds: readonly string[], actor: { id: string; name: string }): Promise<PublishAllItem[]>;
};

export type AutopilotRun = {
  ran: boolean;
  considered: number;
  prepared: number;
  failed: number;
  published: PublishAllItem[];
  reason?: string;
};

const OPEN: readonly IssueStatus[] = ["acik", "yeniden_acildi", "onerildi"];

export async function runAutopilot(deps: AutopilotDeps): Promise<AutopilotRun> {
  const settings = await deps.readSettings();
  if (!settings.enabled) return { ran: false, considered: 0, prepared: 0, failed: 0, published: [], reason: "Otopilot kapalı." };

  const allowed = new Set(settings.kinds);
  const issues = (await deps.listIssues()).filter(
    (i) => OPEN.includes(i.status) && !i.manual_only && canAutoOptimize(i.url) && i.proposal && allowed.has(i.proposal.kind),
  );
  const drafted = new Set<string>();
  let prepared = 0;
  let failed = 0;
  let considered = 0;

  for (const issue of issues) {
    const ex = executorFor(issue.proposal!.kind, deps.executors);
    // Yalnız "guvenli" ve gerçekten uygulayan yürütücü; bağlantı türü ve kaydı olmayan tür atlanır.
    if (!ex || ex.risk !== "guvenli" || ex.mode === "link" || !ex.plan || !ex.apply) continue;
    considered++;
    try {
      const plan = await ex.plan(issue);
      if (!plan || plan.risk !== "guvenli") continue;
      const res = await ex.apply(plan, { actorId: settings.enabledBy ?? null, source: "otopilot" });
      await deps.record({
        kind: plan.kind,
        source: "otopilot",
        target: plan.target,
        status: res.ok ? "hazirlandi" : "hata",
        before: { value: res.before ?? plan.before, issueId: issue.id },
        after: { value: res.after ?? plan.after, message: res.message, draftSurface: res.draftSurface ?? null },
        actor: settings.enabledBy ?? null,
      });
      if (!res.ok) {
        failed++;
        continue;
      }
      prepared++;
      if (res.status) await deps.patchIssue(issue.id, { status: res.status, publish_ref: res.publishRef ?? null });
      if (res.draftSurface) drafted.add(res.draftSurface);
    } catch (e) {
      failed++;
      await deps.record({ kind: issue.proposal!.kind, source: "otopilot", target: issue.url, status: "hata", after: { message: e instanceof Error ? e.message.slice(0, 160) : "hata" } });
    }
  }

  let published: PublishAllItem[] = [];
  if (settings.publish && drafted.size > 0 && settings.enabledBy) {
    published = await deps.publishSurfaces([...drafted], { id: settings.enabledBy, name: settings.enabledByName || "Otopilot" });
    for (const p of published) {
      await deps.record({ kind: "publish", source: "otopilot", target: p.surface, status: p.ok ? (p.skipped ? "atlandi" : "yayinlandi") : "hata", after: { message: p.message } });
    }
  }
  await deps.record({ kind: "autopilot_run", source: "otopilot", target: "", status: failed ? "kismi" : "ok", after: { considered, prepared, failed, published: published.filter((p) => p.ok && !p.skipped).length } });
  return { ran: true, considered, prepared, failed, published };
}
