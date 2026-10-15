import { ButtonLink } from "@/components/ui/button";
import { Bell, Filter, History, Megaphone, PanelTop, Send, Smile, Sparkles } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformModule } from "@/lib/platform";
import { PageTabs } from "@/components/app/page-tabs";
import { Pagination, pageRange, parsePage } from "@/app/admin/_components/pagination";
import { RegistrySettings } from "@/components/settings/registry-settings";
import { planLabel } from "@/lib/billing/plans";
import { now, toTrLocalInput } from "@/lib/clock";
import { isSchemaMissing } from "@/lib/platform-announcements/queue";
import { describeSegment, parseSegment, SEGMENT_HEALTH_BANDS, SEGMENT_MODULE_OPTIONS, SEGMENT_PLANS, SEGMENT_STATUSES, segmentStatusLabel } from "@/lib/platform-announcements/segment";
import { BROADCAST_SETTING_KEYS } from "@/lib/settings/registry/broadcast";
import { BroadcastForm } from "./broadcast-form";
import { BroadcastRow, type BroadcastRowData } from "./broadcast-row";
import { KIND_OPTIONS } from "./broadcast-options";
import { DeliveryDetail } from "./delivery-detail";
import { BannerPanel } from "./banner-panel";
import { ChangelogPanel } from "./changelog-panel";
import { NpsPanel } from "./nps-panel";
import { SegmentExplorer } from "./segment-explorer";
import type { SegmentInit, SegmentOptions } from "./segment-builder";
import { segmentInitFromQuery as segmentInitFromQueryBase, segmentNames } from "./segment-init";
import { HEALTH_BAND_LABELS } from "@/lib/admin/health-score";
import { LIFECYCLE_LABELS, LIFECYCLE_STAGES, loadCrmCatalog } from "@/lib/admin/platform-crm";
import { AdminPageHeader } from "@/components/admin/admin-page-header";

export const metadata = { title: "Toplu duyuru" };

const audienceLabel: Record<string, string> = {
  all: "Tüm ofisler",
  active: "Aktif ofisler",
  trial: "Deneme ofisleri",
  specific: "Belirli ofis",
  segment: "Segment",
  user: "Doğrudan mesaj",
};

const TABS = [
  { id: "duyurular", label: "Duyurular", icon: Megaphone },
  { id: "segmentler", label: "Segmentler", icon: Filter },
  { id: "banner", label: "Banner", icon: PanelTop },
  { id: "yenilikler", label: "Yenilikler", icon: Sparkles },
  { id: "nps", label: "NPS anketi", icon: Smile },
] as const;

type AnnouncementRow = {
  id: string;
  title: string;
  body: string | null;
  kind: string;
  audience: string;
  tenant_id: string | null;
  sent_count: number;
  created_at: string;
  tenant: { name?: string } | { name?: string }[] | null;
  // AD8 sütunları (migration öncesi yok)
  status?: string;
  channels?: string[];
  segment_json?: unknown;
  scheduled_at?: string | null;
  expires_at?: string | null;
  recipient_count?: number;
  delivered_count?: number;
  failed_count?: number;
  read_count?: number;
  click_count?: number;
  stats?: { in_app_sent?: number; email_sent?: number; open?: number } | null;
  commercial?: boolean;
  href?: string | null;
};

type SP = {
  sekme?: string;
  yeni?: string;
  sayfa?: string;
  duyuru?: string;
  durum?: string;
  kanal?: string;
  ofis?: string;
  uye?: string;
  anket?: string;
  grup?: string;
  // Segment ön doldurması (segment-init.ts okur): Segmentler sekmesinin "Bu segmente duyuru / banner" bağlantıları.
  seg_plan?: string | string[];
  seg_status?: string | string[];
  seg_trial_days?: string;
  seg_login_mode?: string;
  seg_login_days?: string;
  seg_city?: string;
  seg_module?: string;
  seg_module_state?: string;
  seg_owners?: string;
  seg_tenant?: string;
  seg_user?: string;
  seg_tag?: string | string[];
  seg_health?: string | string[];
  seg_stage?: string | string[];
  seg_owner?: string | string[];
  seg_signup_days?: string;
} & Record<string, string | string[] | undefined>;

function tenantNameOf(v: AnnouncementRow["tenant"]) {
  if (!v) return null;
  return (Array.isArray(v) ? v[0]?.name : v.name) ?? null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** URL'deki `seg_*` (Segmentler sekmesinden) ve `ofis`/`uye` (Ofis 360 / Üye detayı) ön doldurması. */
function segmentInitFromQuery(sp: SP): SegmentInit {
  return {
    ...segmentInitFromQueryBase(sp),
    tenant: UUID_RE.test(sp.ofis ?? "") ? sp.ofis : one(sp.seg_tenant),
    user: UUID_RE.test(sp.uye ?? "") ? sp.uye : one(sp.seg_user),
  };
}

const ARCHIVE_COLS_V2 =
  "id, title, body, kind, audience, tenant_id, sent_count, created_at, status, channels, segment_json, scheduled_at, expires_at, recipient_count, delivered_count, failed_count, read_count, click_count, stats, commercial, href, tenant:tenants(name)";
const ARCHIVE_COLS_V1 = "id, title, body, kind, audience, tenant_id, sent_count, created_at, tenant:tenants(name)";

export default async function BroadcastPage({ searchParams }: { searchParams: Promise<SP> }) {
  const staff = await requirePlatformModule("broadcast");
  const canEdit = ["super_admin", "ops"].includes(staff.role);
  const isSuperAdmin = staff.role === "super_admin";
  const sp = await searchParams;
  const page = parsePage(sp.sayfa);
  const active = (TABS.find((t) => t.id === sp.sekme)?.id ?? "duyurular") as (typeof TABS)[number]["id"];
  const admin = createAdminClient();

  const fmt = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Istanbul" });

  // Teslim ayrıntısı (arşiv satırından): durum/kanal filtreli liste + yeniden dene.
  if (sp.duyuru && UUID_RE.test(sp.duyuru)) {
    return <DeliveryDetail id={sp.duyuru} status={sp.durum} channel={sp.kanal} page={page} canEdit={canEdit} />;
  }

  const needsOptions = sp.yeni === "1" || active === "segmentler" || active === "banner" || active === "nps";
  const [{ data: recentTenants }, crmCatalog] = needsOptions
    ? await Promise.all([
        admin.from("tenants").select("id, name, slug, status").neq("status", "cancelled").order("created_at", { ascending: false }).limit(20),
        loadCrmCatalog(admin),
      ])
    : [{ data: null }, null];
  const options: SegmentOptions = {
    plans: SEGMENT_PLANS.map((p) => ({ value: p, label: planLabel(p) })),
    statuses: SEGMENT_STATUSES.map((s) => ({ value: s, label: segmentStatusLabel(s) })),
    modules: [...SEGMENT_MODULE_OPTIONS],
    tenants: ((recentTenants ?? []) as { id: string; name: string; slug: string; status: string }[]).map((t) => ({ value: t.id, label: t.name, hint: `/${t.slug} · ${t.status}` })),
    // Ofis CRM ölçütleri (PA-11): CRM kurulu değilse seçenek verilmez, oluşturucu bu ölçütleri gizler.
    ...(crmCatalog?.ready
      ? {
          tags: crmCatalog.tags.map((t) => ({ value: t.id, label: t.name })),
          staff: crmCatalog.staff.map((st) => ({ value: st.id, label: st.name })),
          healthBands: SEGMENT_HEALTH_BANDS.map((b) => ({ value: b, label: HEALTH_BAND_LABELS[b] })),
          stages: LIFECYCLE_STAGES.map((st) => ({ value: st, label: LIFECYCLE_LABELS[st] })),
        }
      : {}),
  };

  // Yeni duyuru: tam sayfa sekmeli form. `ofis` / `uye` ile doğrudan mesaj olarak açılır.
  if (sp.yeni === "1") {
    const init = segmentInitFromQuery(sp);
    const [{ data: t }, { data: u }] = await Promise.all([
      init.tenant ? admin.from("tenants").select("name").eq("id", init.tenant).maybeSingle() : Promise.resolve({ data: null }),
      init.user && init.tenant ? admin.from("profiles").select("full_name").eq("id", init.user).eq("tenant_id", init.tenant).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    init.tenantLabel = (t as { name?: string } | null)?.name ?? undefined;
    init.userLabel = (u as { full_name?: string } | null)?.full_name ?? undefined;
    if (!u) init.user = "";
    return (
      <BroadcastForm
        options={options}
        init={init}
        title={init.user ? "Doğrudan mesaj" : init.tenant ? "Ofise mesaj" : "Yeni duyuru"}
        minLocal={toTrLocalInput(now())}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Satır içi düzenleme paneli burada açılır; popup yok. */}
      <div id="inline-panel-host" className="min-w-0 empty:hidden" />
      <AdminPageHeader
        art="megaphone"
        eyebrow="Toplu duyuru"
        icon={Megaphone}
        title="Duyuru, mesaj ve Yenilikler"
        description="Segmente zamanlanmış duyuru (uygulama içi, e-posta, push), ofis paneline banner, tek ofise/kullanıcıya mesaj, Yenilikler çekmecesi ve NPS anketi."
      />
      <PageTabs base="/admin/duyuru" label="Duyuru sekmeleri" tabs={TABS} active={active} />

      {active === "segmentler" ? (
        <SegmentExplorer options={options} />
      ) : active === "banner" ? (
        <BannerPanel options={options} canEdit={canEdit} minLocal={toTrLocalInput(now())} editId={UUID_RE.test(one(sp.duzenle)) ? one(sp.duzenle) : undefined} segInit={segmentInitFromQuery(sp)} />
      ) : active === "nps" ? (
        <NpsPanel
          options={options}
          canEdit={canEdit}
          isSuperAdmin={isSuperAdmin}
          editId={UUID_RE.test(one(sp.duzenle)) ? one(sp.duzenle) : undefined}
          surveyId={UUID_RE.test(sp.anket ?? "") ? sp.anket : undefined}
          band={sp.grup === "promoter" || sp.grup === "passive" || sp.grup === "detractor" ? sp.grup : null}
          page={page}
        />
      ) : active === "yenilikler" ? (
        <ChangelogPanel canEdit={canEdit} isSuperAdmin={isSuperAdmin} editId={UUID_RE.test(one(sp.duzenle)) ? one(sp.duzenle) : undefined} />
      ) : (
        <AnnouncementsTab page={page} canEdit={canEdit} isSuperAdmin={isSuperAdmin} fmt={fmt} />
      )}
    </div>
  );
}

async function AnnouncementsTab({ page, canEdit, isSuperAdmin, fmt }: { page: number; canEdit: boolean; isSuperAdmin: boolean; fmt: Intl.DateTimeFormat }) {
  const admin = createAdminClient();
  const archive = (cols: string) =>
    admin.from("platform_announcements").select(cols, { count: "exact" }).order("created_at", { ascending: false }).range(...pageRange(page));

  const [{ count: allCount }, { count: activeCount }, { count: trialCount }, v2, crmCatalog] = await Promise.all([
    admin.from("tenants").select("id", { count: "exact", head: true }).neq("status", "cancelled"),
    admin.from("tenants").select("id", { count: "exact", head: true }).eq("status", "active"),
    admin.from("tenants").select("id", { count: "exact", head: true }).eq("status", "trial"),
    archive(ARCHIVE_COLS_V2),
    loadCrmCatalog(admin),
  ]);
  const names = segmentNames(crmCatalog);
  // Migration 20261013004700 uygulanmadıysa eski sütunlarla oku (arşiv boş görünmesin).
  const schemaReady = !(v2.error && isSchemaMissing(v2.error));
  const { data: history, count: historyTotal } = schemaReady ? v2 : await archive(ARCHIVE_COLS_V1);
  const rows = (history ?? []) as unknown as AnnouncementRow[];

  const rowData = (a: AnnouncementRow): BroadcastRowData => {
    const seg = parseSegment(a.segment_json ?? {});
    const tenantName = tenantNameOf(a.tenant);
    const segLabel = a.audience === "segment" || a.audience === "user" ? (seg.ok ? describeSegment(seg.value, { tenant: tenantName, ...names }) : "Segment") : null;
    return {
      id: a.id,
      title: a.title,
      body: a.body,
      kind: a.kind,
      audienceLabel: segLabel ?? (seg.ok && seg.value.ownersOnly ? `${audienceLabel[a.audience] ?? a.audience} · yalnız sahipler` : (audienceLabel[a.audience] ?? a.audience)),
      tenantId: a.audience === "specific" || a.audience === "user" ? a.tenant_id : null,
      tenantName,
      sentCount: a.sent_count,
      createdLabel: fmt.format(new Date(a.created_at)),
      status: a.status ?? "sent",
      channels: a.channels ?? ["in_app"],
      scheduledLabel: a.scheduled_at ? fmt.format(new Date(a.scheduled_at)) : null,
      expiresLabel: a.expires_at ? fmt.format(new Date(a.expires_at)) : null,
      queued: Boolean(a.status && a.recipient_count !== undefined && (a.status !== "sent" || (a.recipient_count ?? 0) > 0)),
      recipients: a.recipient_count ?? 0,
      delivered: a.delivered_count ?? 0,
      failed: a.failed_count ?? 0,
      reads: a.read_count ?? 0,
      clicks: a.click_count ?? 0,
      inAppSent: a.stats?.in_app_sent ?? 0,
      emailSent: a.stats?.email_sent ?? 0,
      open: a.stats?.open ?? 0,
      hasHref: Boolean(a.href),
      commercial: Boolean(a.commercial),
    };
  };

  return (
    <>
      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <section className="dashboard-panel flex flex-col items-start gap-3 rounded-[var(--radius-panel)] border border-line bg-surface p-6">
          <h2 className="font-display font-bold text-ink-950">Duyuru oluştur</h2>
          <p className="text-sm text-text-muted">
            Hedef kitle: {allCount ?? 0} ofis (aktif {activeCount ?? 0}, deneme {trialCount ?? 0}). Segment, kanal ve zamanı sekmeli formda canlı sayımla seçin;
            gönderim kuyrukta yapılır, ofis sayısı ne olursa olsun istek beklemez.
          </p>
          <div className="flex flex-wrap gap-2">
            <ButtonLink variant="navy" size="md" href="/admin/duyuru?yeni=1" className="btn-shine">
              <Send className="h-4 w-4" /> Yeni duyuru
            </ButtonLink>
            <ButtonLink variant="outline" size="md" href="/admin/duyuru?yeni=1&seg_status=trial&seg_trial_days=3&seg_owners=on">
              Denemesi 3 gün içinde bitecek sahipler
            </ButtonLink>
          </div>
          {!schemaReady ? (
            <p className="rounded-[var(--radius-control)] border border-amber-400/30 bg-amber-400/8 px-3 py-2 text-xs text-amber-700">
              Kurulum bekliyor: duyuru merkezi veritabanı güncellemesi (20261013004700) uygulanana kadar duyurular eski yoldan anında ve yalnız uygulama içi gider; zamanlama, e-posta/push ve ölçüm kapalıdır.
            </p>
          ) : null}
        </section>

        <aside className="space-y-4">
          <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5">
            <div className="flex items-center gap-2">
              <Bell className="h-4 w-4 text-brand-600" />
              <h3 className="font-display font-bold text-ink-950">Nasıl çalışır?</h3>
            </div>
            <ul className="mt-4 space-y-3 text-sm text-text-muted">
              {[
                "Segment gönderim anında yeniden hesaplanır; zamanlanmış duyuru o saatte eşleşen ofislere gider.",
                "Teslim kuyrukta 2 dakikada bir ilerler; başarısız alıcılar arşivde görünür ve yeniden denenebilir.",
                "E-posta ve push, anahtarları girilene kadar kapalıdır; kapalı kanal 'kanal kapalı' olarak raporlanır.",
                "Okunma (zil) ve tıklama (bağlantı) oranları arşivde; sayıya tıklayınca alıcı listesi açılır.",
              ].map((t, i) => (
                <li key={i} className="flex gap-2">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-600/10 text-xs font-bold text-brand-600">{i + 1}</span>
                  {t}
                </li>
              ))}
            </ul>
          </section>
          <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5">
            <h3 className="font-display font-bold text-ink-950">Tür rehberi</h3>
            <div className="mt-3 space-y-2">
              {KIND_OPTIONS.map((k) => (
                <div key={k.value} className="flex items-center gap-3">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${k.cls}`}>{k.label}</span>
                  <span className="text-xs text-text-muted">
                    {k.value === "info" && "Yeni özellik, duyuru, genel bilgi"}
                    {k.value === "success" && "Başarılı güncelleme, plan yükseltme"}
                    {k.value === "warning" && "Bakım, geçici kısıtlama, dikkat"}
                    {k.value === "danger" && "Kritik kesinti, acil müdahale"}
                    {k.value === "system" && "Otomatik sistem mesajı"}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>

      <section className="overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
            <History className="h-4 w-4 text-brand-600" /> Duyuru arşivi
          </h2>
          <span className="text-xs text-text-faint">Toplam {historyTotal ?? 0} gönderim</span>
        </div>
        {rows.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-text-muted">Henüz duyuru gönderilmemiş. Gönderimler burada arşivlenir.</p>
        ) : (
          <div className="divide-y divide-line">
            {rows.map((a) => (
              <BroadcastRow key={a.id} canEdit={canEdit} isSuperAdmin={isSuperAdmin} row={rowData(a)} />
            ))}
          </div>
        )}
        <div className="px-5 pb-4">
          <Pagination page={page} total={historyTotal ?? 0} hrefFor={(p) => (p > 1 ? `/admin/duyuru?sayfa=${p}` : "/admin/duyuru")} />
        </div>
      </section>

      <RegistrySettings
        title="Kuyruk ayarları"
        description="Duyuru kuyruğunun parti boyutu ve bir çalıştırmadaki süre bütçesi."
        keys={[BROADCAST_SETTING_KEYS.batchSize, BROADCAST_SETTING_KEYS.budgetSeconds]}
        canEdit={isSuperAdmin}
      />
    </>
  );
}
