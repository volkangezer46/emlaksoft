import Link from "@/components/ui/smart-link";
import { ArrowUpRight, Settings2, Workflow } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { requirePlatformModule } from "@/lib/platform";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/settings/read";
import { isMissingSchema } from "@/lib/listing-control/server/db";
import { TRANSFER_PORTALS, type TransferPortal } from "@/lib/portal-transfer/rules";
import {
  PORTAL_LABELS,
  fieldLabel,
  fieldOverviewFromProposals,
  parsePortal,
  parseView,
  portalRulesHref,
  toFormAlert,
  type FormAlert,
} from "@/lib/portal-rules/admin-model";
import { cn } from "@/lib/utils";
import { FormAlertsStrip, FormEvidence, type CatalogField } from "./form-alerts-strip";
import { FieldConfidenceTable, type SetField } from "./field-confidence-table";
import { ProposalsPanel, type ProposalRow, type EvidenceView } from "./proposals-panel";
import { VersionsPanel, type VersionRow } from "./versions-panel";
import { TrustPanel, type TrustTenant } from "./trust-panel";
import { AiSuggestButton } from "./ai-suggest-button";

const THRESHOLD_KEYS = [
  "portal_rules.min_tenants",
  "portal_rules.min_sessions",
  "portal_rules.auto_publish",
  "portal_rules.auto_degrade",
  "portal_rules.ai_min_tenants",
] as const;
const THRESHOLD_DEFAULTS: Record<(typeof THRESHOLD_KEYS)[number], number | boolean> = {
  "portal_rules.min_tenants": 3,
  "portal_rules.min_sessions": 6,
  "portal_rules.auto_publish": false,
  "portal_rules.auto_degrade": true,
  "portal_rules.ai_min_tenants": 2,
};

type Row = Record<string, unknown>;

function rows(data: unknown): Row[] {
  return Array.isArray(data) ? (data as Row[]) : [];
}

function str(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}

function n(v: unknown): number {
  const x = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(x) ? x : 0;
}

/**
 * Yönetim > Sistem > Portal kuralları (sunucu bileşeni). Oturumlu istemci + personel RLS/RPC; `createAdminClient` YOK.
 * Bağımsız okumalar tek `Promise.all` turunda. Tablolar yoksa (P1 migration'ları uygulanmamış) sayfa çökmez,
 * "Sistem güncellemesi bekleniyor" durumuna düşer. Kiracı adı YALNIZ uygunluk panelinde görünür.
 */
export async function PortalRulesView({ portal: portalRaw, view: viewRaw }: { portal?: string; view?: string }) {
  const staff = await requirePlatformModule("sistem");
  const portal = parsePortal(portalRaw);
  const view = parseView(viewRaw);
  const db = await createClient();
  const canPublish = staff.role === "super_admin";

  const [published, versions, proposals, alerts, trust, trustList, settings, evidence, catalog] = await Promise.all([
    db.from("portal_rule_sets").select("id, version, content").eq("portal", portal).eq("status", "published").maybeSingle(),
    db
      .from("portal_rule_sets")
      .select("id, version, status, kind, change_summary, created_by, created_at, published_at, rolls_back_to")
      .eq("portal", portal)
      .order("version", { ascending: false })
      .limit(30),
    db
      .from("portal_rule_proposals")
      .select("id, kind, field_key, proposal, source, support_tenants, contradict_tenants, support_sessions, weeks_n, confidence, state, ai_unverified, first_seen, last_evaluated")
      .eq("portal", portal)
      .in("state", ["ready", "collecting"])
      .order("state", { ascending: false })
      .order("confidence", { ascending: false })
      .limit(60),
    db
      .from("portal_form_versions")
      .select("fingerprint, field_count, tenants_n, first_seen, last_seen, status, jaccard_prev, alert_state")
      .eq("portal", portal)
      .in("alert_state", ["warning", "info"])
      .order("last_seen", { ascending: false })
      .limit(12),
    db.from("portal_rule_tenant_trust").select("tenant_id, eligible, reason, set_at"),
    // Uygunluk paneli P1'in RPC'sinden: varsayılan kural sonucu + son 60 gün doğrulanmış oturum (yalnız bu görünümde).
    view.kind === "uygunluk" ? db.rpc("pt_rules_admin_trust_list") : Promise.resolve({ data: null, error: null }),
    getSettings([...THRESHOLD_KEYS]).catch(() => ({}) as Record<string, unknown>),
    view.kind === "kanit" ? db.rpc("pt_rules_admin_evidence", { p_proposal_id: view.id }) : Promise.resolve({ data: null, error: null }),
    view.kind === "form"
      ? db
          .from("portal_form_fields")
          .select("field_sig, control, label_folded, options_folded, distinct_tenants, first_seen, last_seen, mapped_key")
          .eq("portal", portal)
          .order("last_seen", { ascending: false })
          .limit(120)
      : Promise.resolve({ data: null, error: null }),
  ]);

  const missing = [published.error, versions.error, proposals.error, alerts.error].some((e) => isMissingSchema(e));
  if (missing) {
    return (
      <div className="space-y-6">
        <Header portal={portal} />
        <section role="status" className="rounded-[var(--radius-panel)] border border-line bg-surface p-6">
          <h2 className="font-display text-lg font-bold text-ink-950">Sistem güncellemesi bekleniyor</h2>
          <p className="mt-2 max-w-2xl text-sm text-text-muted">
            Portal kuralları tabloları bu ortamda henüz kurulmadı. Veritabanı güncellemesi uygulanınca alan güveni, öneriler ve
            sürüm geçmişi burada görünür. Eklenti bu sürede paket içindeki varsayılan kurallarla çalışır.
          </p>
        </section>
      </div>
    );
  }

  const content = (published.data as { content?: { fields?: unknown } } | null)?.content;
  const setFields: SetField[] = rows(content?.fields).map((f) => ({
    key: String(f.key ?? ""),
    state: f.state,
    confidence: n(f.confidence),
    labels: Array.isArray(f.labels) ? (f.labels as unknown[]).filter((x): x is string => typeof x === "string") : [],
  }));
  const publishedVersion = (published.data as { version?: number } | null)?.version ?? null;

  const proposalRows: ProposalRow[] = rows(proposals.data).map((r) => ({
    id: String(r.id),
    kind: String(r.kind ?? ""),
    fieldKey: str(r.field_key),
    proposal: r.proposal ?? null,
    source: str(r.source),
    aiUnverified: r.ai_unverified === true,
    supportTenants: n(r.support_tenants),
    contradictTenants: n(r.contradict_tenants),
    supportSessions: n(r.support_sessions),
    weeksN: n(r.weeks_n),
    confidence: n(r.confidence),
    state: String(r.state ?? ""),
    lastEvaluated: str(r.last_evaluated) ?? str(r.first_seen),
  }));
  const visibleProposals = view.kind === "alan" ? proposalRows.filter((p) => p.fieldKey === view.key) : proposalRows;
  const readyCount = proposalRows.filter((p) => p.state === "ready").length;
  const overview = fieldOverviewFromProposals(proposalRows);

  const formAlerts = rows(alerts.data)
    .map(toFormAlert)
    .filter((a): a is FormAlert => !!a);

  const versionRows: VersionRow[] = rows(versions.data).map((r) => ({
    id: String(r.id),
    version: n(r.version),
    status: String(r.status ?? ""),
    kind: String(r.kind ?? ""),
    changeSummary: r.change_summary ?? null,
    by: r.created_by ? (r.created_by === staff.id ? "Siz" : "Personel") : "Sistem",
    at: str(r.published_at) ?? str(r.created_at),
    rollsBackTo: typeof r.rolls_back_to === "number" ? r.rolls_back_to : null,
  }));

  const trustRows = rows(trust.data);
  const trustByTenant = new Map(trustRows.map((t) => [String(t.tenant_id), t] as const));
  const excludedCount = trustRows.filter((t) => t.eligible === false).length;
  const trustListData = trustList.error ? null : (trustList.data as { outcome?: string; tenants?: unknown } | null);
  const trustListOk = trustListData?.outcome === "ok";
  const trustTenants: TrustTenant[] = rows(trustListOk ? trustListData?.tenants : null).map((t) => {
    const tr = trustByTenant.get(String(t.tenant_id));
    return {
      id: String(t.tenant_id),
      name: String(t.name ?? "Adsız ofis"),
      slug: null,
      status: str(t.status),
      samplePack: t.sample === true,
      eligible: tr ? tr.eligible === true : null,
      reason: tr ? str(tr.reason) : null,
      defaultEligible: t.default_eligible === true,
      sessions60d: n(t.verified_sessions_60d),
    };
  });

  const s = settings as Record<string, unknown>;
  const thr = (k: (typeof THRESHOLD_KEYS)[number]) => (s[k] ?? THRESHOLD_DEFAULTS[k]) as number | boolean;
  const aiMin = Number(thr("portal_rules.ai_min_tenants")) || 2;

  let evidenceView: EvidenceView | null = null;
  if (view.kind === "kanit") {
    const p = proposalRows.find((x) => x.id === view.id) ?? null;
    evidenceView = { proposalId: view.id, proposal: p, data: evidence.error ? null : (evidence.data ?? null), unavailable: !!evidence.error };
  }

  let formEvidence: { alert: FormAlert | null; fields: CatalogField[] } | null = null;
  if (view.kind === "form") {
    const alert = formAlerts.find((a) => a.fingerprint === view.fingerprint) ?? null;
    const since = alert?.firstSeen ?? null;
    const fields = rows(catalog.data)
      .filter((f) => !since || (str(f.last_seen) ?? "") >= since)
      .map<CatalogField>((f) => ({
        sig: String(f.field_sig ?? ""),
        control: str(f.control),
        label: str(f.label_folded),
        optionsN: Array.isArray(f.options_folded) ? f.options_folded.length : 0,
        tenants: n(f.distinct_tenants),
        mappedKey: str(f.mapped_key),
        lastSeen: str(f.last_seen),
      }));
    formEvidence = { alert, fields };
  }

  const show = (k: string) => view.kind === "genel" || view.kind === k;

  return (
    <div className="space-y-6">
      <Header portal={portal} />

      <nav aria-label="Portal seçimi" className="flex flex-wrap items-center gap-2">
        {TRANSFER_PORTALS.map((p) => (
          <Link
            key={p}
            href={portalRulesHref(p)}
            aria-current={p === portal ? "page" : undefined}
            className={cn(
              "focus-ring inline-flex items-center rounded-full border px-3.5 py-1.5 text-sm font-semibold transition touch:min-h-11",
              p === portal ? "border-brand-600 bg-brand-600 text-white" : "border-line bg-surface text-text-muted hover:text-ink-950",
            )}
          >
            {PORTAL_LABELS[p]}
          </Link>
        ))}
        <span className="ml-auto flex flex-wrap items-center gap-2 text-xs text-text-muted">
          {publishedVersion != null ? (
            <Link href={portalRulesHref(portal, "surumler")} className="font-semibold hover:underline">
              Yayında: sürüm {publishedVersion}
            </Link>
          ) : (
            <span>Yayında set yok (eklenti tohumla çalışır)</span>
          )}
          {view.kind !== "genel" ? (
            <Link href={portalRulesHref(portal)} className="font-semibold text-brand-600 hover:underline">
              Tüm görünüm
            </Link>
          ) : null}
        </span>
      </nav>

      {show("uyarilar") || view.kind === "form" ? <FormAlertsStrip portal={portal} alerts={formAlerts} showEmpty={view.kind === "uyarilar"} /> : null}
      {formEvidence ? <FormEvidence portal={portal} fingerprint={view.kind === "form" ? view.fingerprint : ""} alert={formEvidence.alert} fields={formEvidence.fields} /> : null}

      {show("alan") || view.kind === "alan" ? (
        <FieldConfidenceTable
          portal={portal}
          fields={view.kind === "alan" ? setFields.filter((f) => f.key === view.key) : setFields}
          overview={overview}
          focusKey={view.kind === "alan" ? view.key : null}
          focusLabel={view.kind === "alan" ? fieldLabel(view.key) : null}
          hasSet={publishedVersion != null}
        />
      ) : null}

      {show("oneriler") || view.kind === "alan" || view.kind === "kanit" ? (
        <ProposalsPanel
          portal={portal}
          proposals={view.kind === "kanit" ? proposalRows.filter((p) => p.id === view.id) : visibleProposals}
          readyCount={readyCount}
          canPublish={canPublish}
          hasSet={publishedVersion != null}
          evidence={evidenceView}
          aiSlot={<AiSuggestButton portal={portal} minTenants={aiMin} />}
        />
      ) : null}

      {show("surumler") ? <VersionsPanel portal={portal} versions={versionRows} canPublish={canPublish} /> : null}

      {view.kind === "uygunluk" ? (
        <TrustPanel tenants={trustTenants} unavailable={!trustListOk} />
      ) : view.kind === "genel" ? (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-panel)] border border-line bg-surface p-5">
          <div>
            <h2 className="font-display font-bold text-ink-950">Ofis uygunluğu</h2>
            <p className="mt-1 text-sm text-text-muted">
              Öğrenmeye hangi ofislerin oy verebileceği. Ofis adları yalnız bu panelde görünür.{" "}
              <Link href={portalRulesHref(portal, "uygunluk")} className="font-semibold text-brand-600 hover:underline">
                {excludedCount} ofis dışlanmış
              </Link>
            </p>
          </div>
          <Link href={portalRulesHref(portal, "uygunluk")} className="inline-flex items-center gap-1 text-sm font-semibold text-brand-600 hover:underline">
            Uygunluğu yönet <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </section>
      ) : null}

      <section aria-label="Öğrenme eşikleri" className="rounded-[var(--radius-panel)] border border-line bg-surface p-5">
        <p className="flex items-center gap-2 text-xs font-semibold text-text-muted">
          <Settings2 className="h-4 w-4" /> Eşikler (salt okunur)
        </p>
        <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-5">
          <Threshold label="Otomatik doğrulama için ofis" value={String(thr("portal_rules.min_tenants"))} />
          <Threshold label="En az yayınlanmış oturum" value={String(thr("portal_rules.min_sessions"))} />
          <Threshold label="Otomatik yayın" value={thr("portal_rules.auto_publish") ? "Açık" : "Kapalı"} />
          <Threshold label="Otomatik geriletme" value={thr("portal_rules.auto_degrade") ? "Açık" : "Kapalı"} />
          <Threshold label="AI girdisi için ofis" value={String(aiMin)} />
        </dl>
        <Link href="/admin/ayarlar/merkez?ara=portal_rules" className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-brand-600 hover:underline">
          Platform ayarlarında değiştir <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      </section>
    </div>
  );
}

function Threshold({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd className="m-0 font-semibold tabular-nums text-ink-950">
        <Link href="/admin/ayarlar/merkez?ara=portal_rules" className="hover:underline">
          {value}
        </Link>
      </dd>
    </div>
  );
}

function Header({ portal }: { portal: TransferPortal }) {
  return (
    <AdminPageHeader
      eyebrow="Portal aktarımı"
      icon={Workflow}
      title="Portal kuralları"
      description={`${PORTAL_LABELS[portal]} ilan formu eşleştirme kuralları: alan güveni, ofislerden gelen öneriler, sürüm geçmişi ve geri alma. Kurallar düz veridir; eklenti yalnız imzalı ve doğrulanmış seti kabul eder.`}
    />
  );
}
