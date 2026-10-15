import type { SupabaseClient } from "@supabase/supabase-js";
import { DAY_MS } from "@/lib/clock";
import { getSettings } from "@/lib/settings/read";
import { CRM_SETTING_KEYS } from "@/lib/settings/registry/crm";
import { loadDemoTenantIds } from "@/lib/demo-sandbox";
import { insertNotifications, type NotificationRow } from "@/lib/notify-batch";
import { composeTemplateEmail, loadTemplateText, sendTemplateEmail } from "@/lib/email/send";
import type { EmailTemplateKey } from "@/lib/email/templates";
import { ONBOARDING_STEP_DEFS } from "@/lib/onboarding-steps";
import { loadOnboardingContent } from "@/lib/onboarding-content-read";
import { buildOfficeProgress, loadOnboardingFactsRows } from "./onboarding-progress";

/**
 * AKTİVASYON DÜRTMELERİ (PA-12 + araştırma 6) — `abonelik-kontrol` (günlük) cron'unun ayrık adımı (yeni cron yok).
 *
 * Ofis başına en çok bir dürtme/gün, haftada en çok `WEEKLY_CAP`; her anahtar ofis başına BİR kez (defter
 * `tenant_lifecycle_nudges`, UNIQUE (tenant_id, nudge_key); satır gönderimden ÖNCE sahiplenilir → eşzamanlı koşuda çift
 * gönderim yok). Anahtarlar:
 *   d1 (kaydın 1-2. günü) · d3 (3-6. gün) · d7 (7-13. gün) → eksik adıma göre TEK sonraki adım:
 *     ilk portföy (hiç portföy yoksa) · ekip daveti (tek kullanıcı, paket çok kullanıcılıysa) · kurulumda takılan adım
 *   trial_recap → deneme bitişine 4-6 gün kala değer özeti "X portföy, Y müşteri, Z eşleşme" (veri varsa)
 *   win_back    → deneme bitişinden 7-13 gün sonra hâlâ ödeme yoksa geri kazanım (veri varsa)
 * Kanal: uygulama içi bildirim (ofis sahibine; başlık = şablon konusu) + e-posta (`sendTemplateEmail`: bastırma listesi,
 * demo kiracı ve kanal kapalı kuralları orada). Sahip "Önemli öneriler" (insight) bildirimini kapattıysa hiçbir kanal
 * gitmez. Ayar `crm.lifecycle_nudges_enabled` kapalıysa adım boş döner. Demo ofis hariç.
 * Değerlendirme SAF (`decideNudge`); okuma/yazma `runLifecycleNudges`. Defter yoksa (migration bekliyor) adım `skipped`.
 */

export const NUDGE_KEYS = ["d1", "d3", "d7", "trial_recap", "win_back"] as const;
export type NudgeKey = (typeof NUDGE_KEYS)[number];
export type NudgeKind = "first_property" | "team_invite" | "next_step" | "trial_recap" | "win_back";

export const NUDGE_KEY_LABELS: Record<NudgeKey, string> = {
  d1: "1. gün",
  d3: "3. gün",
  d7: "7. gün",
  trial_recap: "Deneme değer özeti",
  win_back: "Geri kazanım",
};
export const NUDGE_KIND_LABELS: Record<NudgeKind, string> = {
  first_property: "İlk portföy",
  team_invite: "Ekip daveti",
  next_step: "Sıradaki kurulum adımı",
  trial_recap: "Değer özeti",
  win_back: "Geri kazanım",
};

export const WEEKLY_CAP = 2;
export const RUN_TENANT_CAP = 100;

export type NudgeFacts = {
  tenantId: string;
  name: string;
  status: string;
  createdAt: string;
  trialEndsAt: string | null;
  properties: number;
  customers: number;
  matches: number;
  members: number;
  /** Paketin dahil kullanıcı sayısı (tek kullanıcılık pakette ekip daveti önerilmez); bilinmiyorsa null. */
  planSeats: number | null;
  /** Kurulumda takılan zorunlu adım (yoksa null). */
  stuck: { id: string; title: string; description: string } | null;
};

export type NudgeHistory = { keys: ReadonlySet<string>; kinds: ReadonlySet<string>; recent7d: number };

export type NudgeDecision = {
  key: NudgeKey;
  kind: NudgeKind;
  stepId: string | null;
  template: EmailTemplateKey;
  href: string;
  vars: Record<string, string | number>;
};

const FIRST_PROPERTY_HREF = "/app/portfoyler/yeni";
const TEAM_HREF = "/app/baslangic?adim=team";
const BILLING_HREF = "/app/abonelik";
const stepHref = (id: string) => `/app/baslangic?adim=${encodeURIComponent(id)}`;

function slotOf(ageDays: number): "d1" | "d3" | "d7" | null {
  if (ageDays < 1) return null;
  if (ageDays < 3) return "d1";
  if (ageDays < 7) return "d3";
  if (ageDays < 14) return "d7";
  return null;
}

/** Defterdeki tür izi: "first_property", "team_invite", "next_step:<adım>". */
export function kindTrace(kind: NudgeKind, stepId: string | null): string {
  return kind === "next_step" && stepId ? `next_step:${stepId}` : kind;
}

/** SAF: bu ofis için bugün gidecek tek dürtme (yoksa null). */
export function decideNudge(f: NudgeFacts, h: NudgeHistory, nowMs: number): NudgeDecision | null {
  if (h.recent7d >= WEEKLY_CAP) return null;
  const created = Date.parse(f.createdAt);
  const trialEnd = f.trialEndsAt ? Date.parse(f.trialEndsAt) : NaN;
  const hasData = f.properties + f.customers > 0;

  // Geri kazanım: deneme bitti, ödeme yok (ofis gecikmiş/askıda), bitişten 7-13 gün geçti.
  if ((f.status === "past_due" || f.status === "suspended") && Number.isFinite(trialEnd)) {
    const since = (nowMs - trialEnd) / DAY_MS;
    if (since >= 7 && since < 14 && hasData && !h.keys.has("win_back")) {
      return { key: "win_back", kind: "win_back", stepId: null, template: "trial_win_back", href: BILLING_HREF, vars: { portfoy_sayisi: f.properties, musteri_sayisi: f.customers } };
    }
    return null;
  }
  if (f.status !== "trial" && f.status !== "active") return null;

  // Deneme değer özeti: bitişe 4-6 gün kala (3 ve 1 gün kala hatırlatmaları ayrıca gider).
  if (f.status === "trial" && Number.isFinite(trialEnd)) {
    const left = (trialEnd - nowMs) / DAY_MS;
    if (left >= 4 && left < 7 && hasData && !h.keys.has("trial_recap")) {
      return {
        key: "trial_recap",
        kind: "trial_recap",
        stepId: null,
        template: "trial_value_recap",
        href: BILLING_HREF,
        vars: { gun: Math.ceil(left), portfoy_sayisi: f.properties, musteri_sayisi: f.customers, eslesme_sayisi: f.matches },
      };
    }
  }

  if (!Number.isFinite(created)) return null;
  const slot = slotOf((nowMs - created) / DAY_MS);
  if (!slot || h.keys.has(slot)) return null;

  const firstProperty = (): NudgeDecision | null =>
    f.properties === 0 && !h.kinds.has("first_property")
      ? { key: slot, kind: "first_property", stepId: null, template: "nudge_first_property", href: FIRST_PROPERTY_HREF, vars: {} }
      : null;
  const team = (): NudgeDecision | null =>
    f.members <= 1 && (f.planSeats == null || f.planSeats > 1) && !h.kinds.has("team_invite")
      ? { key: slot, kind: "team_invite", stepId: "team", template: "nudge_team_invite", href: TEAM_HREF, vars: {} }
      : null;
  const next = (): NudgeDecision | null => {
    if (!f.stuck) return null;
    if (f.stuck.id === "team") return team();
    if (h.kinds.has(kindTrace("next_step", f.stuck.id))) return null;
    return {
      key: slot,
      kind: "next_step",
      stepId: f.stuck.id,
      template: "nudge_next_step",
      href: stepHref(f.stuck.id),
      vars: { adim: f.stuck.title, aciklama: f.stuck.description },
    };
  };
  const order = slot === "d1" ? [firstProperty, next] : slot === "d3" ? [team, firstProperty, next] : [next, firstProperty, team];
  for (const pick of order) {
    const d = pick();
    if (d) return d;
  }
  return null;
}

// ---- Çalıştırıcı ---------------------------------------------------------------------------------------------------

export type NudgeRunSummary = {
  skipped: boolean;
  /** Anahtar başına sahiplenilen (gönderilen) dürtme. */
  sent: Partial<Record<NudgeKey, number>>;
  inApp: number;
  emails: number;
  error: string | null;
};

const MISSING = /42P01|PGRST205|tenant_lifecycle_nudges|does not exist|schema cache/i;

type TenantRow = { id: string; name: string; status: string; plan: string | null; created_at: string; trial_ends_at: string | null };

export async function runLifecycleNudges(admin: SupabaseClient, nowMs: number, opts: { baseUrl: string }): Promise<NudgeRunSummary> {
  const summary: NudgeRunSummary = { skipped: false, sent: {}, inApp: 0, emails: 0, error: null };
  try {
    const s = await getSettings([CRM_SETTING_KEYS.nudgesEnabled]);
    if (s[CRM_SETTING_KEYS.nudgesEnabled] === false) return { ...summary, skipped: true };
  } catch {
    // ayar okunamadı: varsayılan (açık)
  }
  const probe = await admin.from("tenant_lifecycle_nudges").select("id").limit(1);
  if (probe.error) {
    if (MISSING.test(`${probe.error.code ?? ""} ${probe.error.message ?? ""}`)) return { ...summary, skipped: true };
    return { ...summary, error: probe.error.message };
  }

  const iso = (ms: number) => new Date(ms).toISOString();
  const cols = "id, name, status, plan, created_at, trial_ends_at";
  const [young, recap, lapsed, demo] = await Promise.all([
    admin.from("tenants").select(cols).in("status", ["trial", "active"]).gte("created_at", iso(nowMs - 14 * DAY_MS)).lte("created_at", iso(nowMs - DAY_MS)).limit(300),
    admin.from("tenants").select(cols).eq("status", "trial").gte("trial_ends_at", iso(nowMs + 4 * DAY_MS)).lt("trial_ends_at", iso(nowMs + 7 * DAY_MS)).limit(300),
    admin.from("tenants").select(cols).in("status", ["past_due", "suspended"]).gt("trial_ends_at", iso(nowMs - 14 * DAY_MS)).lte("trial_ends_at", iso(nowMs - 7 * DAY_MS)).limit(300),
    loadDemoTenantIds(admin).catch(() => new Set<string>()),
  ]);
  const firstError = young.error ?? recap.error ?? lapsed.error;
  if (firstError) return { ...summary, error: firstError.message };
  const byId = new Map<string, TenantRow>();
  for (const t of [...(young.data ?? []), ...(recap.data ?? []), ...(lapsed.data ?? [])] as TenantRow[]) if (!demo.has(t.id)) byId.set(t.id, t);
  const tenants = [...byId.values()].slice(0, RUN_TENANT_CAP);
  if (tenants.length === 0) return summary;
  const ids = tenants.map((t) => t.id);

  // Deneme bitişinden sonra ödeme yapılmış ofis geri kazanım almaz (aktif abonelik).
  const [history, counts, subs, factsRes, content, seats] = await Promise.all([
    admin.from("tenant_lifecycle_nudges").select("tenant_id, nudge_key, kind, step_id, created_at").in("tenant_id", ids),
    admin.rpc("platform_tenant_value_counts", { p_tenant_ids: ids }),
    admin.from("subscriptions").select("tenant_id, status").in("tenant_id", ids).eq("status", "active"),
    young.data?.length ? loadOnboardingFactsRows(admin) : Promise.resolve({ ready: false, rows: [], error: null }),
    loadOnboardingContent().catch(() => null),
    admin.from("plan_entitlements").select("plan, seat_limit"),
  ]);
  if (history.error) return { ...summary, error: history.error.message };
  // Değer sayımı yoksa (migration bekliyor) sayı UYDURULMAZ: özet/geri kazanım atlanır, aktivasyon kurulum olgusuyla sürer.
  const countMap = new Map<string, { properties: number; customers: number; matches: number; members: number }>();
  if (!counts.error) for (const r of (counts.data ?? []) as { tenant_id: string; properties: number; customers: number; matches: number; members: number }[]) countMap.set(r.tenant_id, { properties: Number(r.properties) || 0, customers: Number(r.customers) || 0, matches: Number(r.matches) || 0, members: Number(r.members) || 0 });
  const paid = new Set(((subs.data ?? []) as { tenant_id: string }[]).map((r) => r.tenant_id));
  const factsById = new Map(factsRes.rows.map((r) => [r.tenant_id, r]));
  const seatByPlan = new Map(((seats.data ?? []) as { plan: string; seat_limit: number | null }[]).map((p) => [p.plan, p.seat_limit]));
  const stepText = new Map(ONBOARDING_STEP_DEFS.map((d) => [d.id as string, d.description]));

  const hist = new Map<string, { keys: Set<string>; kinds: Set<string>; recent7d: number }>();
  for (const r of (history.data ?? []) as { tenant_id: string; nudge_key: string; kind: string; step_id: string | null; created_at: string }[]) {
    const h = hist.get(r.tenant_id) ?? { keys: new Set<string>(), kinds: new Set<string>(), recent7d: 0 };
    h.keys.add(r.nudge_key);
    h.kinds.add(r.kind === "next_step" && r.step_id ? `next_step:${r.step_id}` : r.kind);
    if (Date.parse(r.created_at) >= nowMs - 7 * DAY_MS) h.recent7d += 1;
    hist.set(r.tenant_id, h);
  }

  const decisions: { t: TenantRow; d: NudgeDecision }[] = [];
  for (const t of tenants) {
    const c = countMap.get(t.id);
    const factsRow = factsById.get(t.id);
    const isActivation = t.status === "trial" || t.status === "active";
    if (!c && !isActivation) continue;
    if (!c && !factsRow) continue;
    if ((t.status === "past_due" || t.status === "suspended") && paid.has(t.id)) continue;
    const progress = factsRow && content ? buildOfficeProgress(factsRow, content) : null;
    const stuckStep = progress?.stuckId ? progress.steps.find((s) => s.id === progress.stuckId) : null;
    const facts: NudgeFacts = {
      tenantId: t.id,
      name: t.name,
      status: t.status,
      createdAt: t.created_at,
      trialEndsAt: t.trial_ends_at,
      properties: c?.properties ?? Number(factsRow?.published_properties ?? 0),
      customers: c?.customers ?? 0,
      matches: c?.matches ?? 0,
      members: c?.members ?? Number(factsRow?.members ?? 1),
      planSeats: t.plan ? (seatByPlan.get(t.plan) ?? null) : null,
      stuck: stuckStep ? { id: stuckStep.id, title: stuckStep.title, description: stepText.get(stuckStep.id) ?? "" } : null,
    };
    // Sayım yoksa yalnız aktivasyon değerlendirilir (özet/geri kazanımda sayı uydurulmaz).
    const d = decideNudge(facts, hist.get(t.id) ?? { keys: new Set(), kinds: new Set(), recent7d: 0 }, nowMs);
    if (!d) continue;
    if (!c && (d.kind === "trial_recap" || d.kind === "win_back")) continue;
    decisions.push({ t, d });
  }
  if (decisions.length === 0) return summary;

  // Sahipler (uygulama içi + e-posta alıcısı). "Önemli öneriler" kapalı sahip atlanır.
  const { data: owners, error: ownersError } = await admin
    .from("profiles")
    .select("id, tenant_id, full_name, notification_prefs")
    .in("tenant_id", decisions.map((x) => x.t.id))
    .eq("role", "owner")
    .eq("is_active", true);
  if (ownersError) return { ...summary, error: ownersError.message };
  const ownersBy = new Map<string, { id: string; full_name: string | null }[]>();
  for (const o of (owners ?? []) as { id: string; tenant_id: string; full_name: string | null; notification_prefs: Record<string, unknown> | null }[]) {
    if (o.notification_prefs && o.notification_prefs.insight === false) continue;
    const list = ownersBy.get(o.tenant_id) ?? [];
    list.push(o);
    ownersBy.set(o.tenant_id, list);
  }

  const texts = new Map<EmailTemplateKey, Awaited<ReturnType<typeof loadTemplateText>>>();
  for (const { t, d } of decisions) {
    const recipients = ownersBy.get(t.id) ?? [];
    if (recipients.length === 0) continue;
    // Sahiplen: aynı anahtar ikinci kez yazılamaz (UNIQUE) → eşzamanlı koşuda tek gönderim.
    const claim = await admin
      .from("tenant_lifecycle_nudges")
      .upsert({ tenant_id: t.id, nudge_key: d.key, kind: d.kind, step_id: d.stepId }, { onConflict: "tenant_id,nudge_key", ignoreDuplicates: true })
      .select("id");
    if (claim.error) {
      summary.error = claim.error.message;
      break;
    }
    const claimId = ((claim.data ?? []) as { id: string }[])[0]?.id;
    if (!claimId) continue;

    if (!texts.has(d.template)) texts.set(d.template, await loadTemplateText(d.template));
    const text = texts.get(d.template)!;
    const link = `${opts.baseUrl}${d.href}`;
    const rows: NotificationRow[] = [];
    let emailed = 0;
    let emailSkipped = 0;
    for (const o of recipients) {
      const vars = { ofis: t.name, ad: o.full_name?.trim() || "değerli kullanıcımız", baglanti: link, ...d.vars };
      const subject = composeTemplateEmail(d.template, text, vars).subject;
      rows.push({ tenant_id: t.id, user_id: o.id, title: subject.slice(0, 160), body: inAppBody(d), href: d.href, kind: "info" });
      const { data: u } = await admin.auth.admin.getUserById(o.id).catch(() => ({ data: null }));
      const email = u?.user?.email;
      if (!email) {
        emailSkipped += 1;
        continue;
      }
      const res = await sendTemplateEmail({ key: d.template, to: email, vars, source: "abonelik-kontrol", tenantId: t.id });
      if (res.ok) emailed += 1;
      else emailSkipped += 1;
    }
    const written = await insertNotifications(admin, rows);
    summary.inApp += written;
    summary.emails += emailed;
    summary.sent[d.key] = (summary.sent[d.key] ?? 0) + 1;
    await admin.from("tenant_lifecycle_nudges").update({ in_app_count: written, email_sent: emailed, email_skipped: emailSkipped }).eq("id", claimId);
  }
  return summary;
}

function inAppBody(d: NudgeDecision): string {
  if (d.kind === "first_property") return "İlk portföyünüzü ekleyin; eşleşen talepler ve vitrin yayını kendiliğinden başlasın.";
  if (d.kind === "team_invite") return "Danışmanlarınızı davet edin; müşteri, görev ve randevular ekipçe paylaşılsın.";
  if (d.kind === "next_step") return `Kurulumda sıradaki adım: ${String(d.vars.adim ?? "")}.`;
  if (d.kind === "trial_recap") return `Denemeniz ${String(d.vars.gun ?? "")} gün sonra bitiyor. Paketinizi seçerek kesintisiz devam edin.`;
  return "Verileriniz silinmedi; paketinizi seçtiğiniz anda kaldığınız yerden devam edersiniz.";
}

/** Heartbeat özeti. */
export function nudgeNote(s: NudgeRunSummary | undefined): string {
  if (!s) return "hata verdi";
  if (s.skipped) return "atlandı";
  const total = Object.values(s.sent).reduce((a, b) => a + (b ?? 0), 0);
  return `${total} ofis (${s.inApp} bildirim, ${s.emails} e-posta)${s.error ? ` (hata: ${s.error.slice(0, 80)})` : ""}`;
}
