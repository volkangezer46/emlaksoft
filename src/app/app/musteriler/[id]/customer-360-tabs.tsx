import Link from "next/link";
import type { ReactNode } from "react";
import { defaultStageLabels, stageLabelMap } from "@/lib/deal-stage-labels";
import {
  ArrowUpRight,
  CalendarDays,
  FileText,
  Folder,
  Handshake,
  History,
  MessageSquare,
  Plus,
  ShieldCheck,
  Sparkles,
  Tag,
  Target,
} from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { DemandStatusButtons } from "./demand-status-buttons";
import { EditDemandDialog } from "./edit-demand-dialog";
import { DetailTabs, type DetailTabDef } from "@/components/app/detail-tabs";
import { EmptyStateV3 } from "@/components/ui/empty-state-v3";
import { CustomerFilesTab } from "./customer-files-tab";
import { CommunicationTimeline } from "@/components/app/communication-timeline";
import { formatLeadSource } from "@/lib/lead-sources";
import { ActivityTimeline, type TimelineCategory, type TimelineEvent } from "@/components/ui/activity-timeline";
import { APPT_STATUS_LABEL, APPT_TYPE_LABEL, CONTRACT_STATUS_LABEL, OFFER_STATUS_LABEL } from "@/lib/activity-timeline-sources";

type Province = { id: string; name: string };

type Demand = {
  id: string;
  transaction_type: string;
  property_type: string | null;
  budget_min: number | null;
  budget_max: number | null;
  rooms: string | null;
  min_sqm: number | null;
  urgency: string | null;
  status: string;
  province_id: string | null;
  district_id: string | null;
  neighborhood_id: string | null;
  created_at: string;
};

const demandStatus: Record<string, string> = {
  new: "Yeni",
  active: "Aktif",
  matched: "Eşleşti",
  closed: "Kapandı",
};

function money(value: number | null) {
  if (value === null) return null;
  return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(value) + " ₺";
}

function budgetLabel(min: number | null, max: number | null) {
  if (min && max) return `${money(min)} – ${money(max)}`;
  if (max) return `≤ ${money(max)}`;
  if (min) return `≥ ${money(min)}`;
  return "Bütçe belirtilmedi";
}

function dateTime(iso: string) {
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

/**
 * Sekme kimlikleri (URL: ?sekme=). Eski `?tab=` linkleri de çalışır:
 * Eski kimlikler (ozet/aktivite/gecmis/gorevler/dosyalar) takma adla yeni sekmelere gider.
 */
export const CUSTOMER_TAB_IDS = [
  "zaman",
  "talepler",
  "anlasmalar",
  "randevu",
  "belgeler",
  "izinler",
  "iletisim",
  "notlar",
] as const;
export const CUSTOMER_TAB_ALIASES: Record<string, string> = {
  aktivite: "zaman",
  ozet: "zaman",
  gecmis: "zaman",
  gorevler: "randevu",
  dosyalar: "belgeler",
};

/** Aktif olmayan sekmenin içeriği (ve onun async bölümleri) hiç çizilmez. */
function Pane({ id, active, children }: { id: string; active: string; children: ReactNode }) {
  return active === id ? <div className="space-y-4">{children}</div> : null;
}

type DealRow = {
  id: string;
  stage: string;
  deal_type: string;
  deal_value: number | null;
  updated_at: string;
};

type ConsentRow = {
  id: string;
  channel: string;
  status: string;
  granted_at: string | null;
};

type CommRow = {
  id: string;
  channel: string;
  direction: string;
  subject: string | null;
  body: string | null;
  outcome: string | null;
  duration_sec: number | null;
  scheduled_at: string | null;
  created_at: string;
  created_by: { full_name?: string } | { full_name?: string }[] | null;
};

type ApptRow = { id: string; appointment_type: string; scheduled_at: string; location: string | null; status: string };
type OfferRow = { id: string; amount: number | null; status: string; created_at: string };
type ContractRow = { id: string; title: string; status: string; signed_at: string | null; created_at: string };

type FileRow = {
  id: string;
  file_name: string;
  file_size: number;
  file_type: string;
  storage_path: string;
  label: string | null;
  created_at: string;
  uploader: { full_name?: string } | { full_name?: string }[] | null;
};

export function Customer360Tabs({
  customerId,
  provinces,
  demands,
  events = [],
  timelineCategories = [],
  activeCategory = "",
  timelineLimit = 40,
  timelineLoadMoreHref,
  appts = [],
  offers = [],
  contracts = [],
  tags,
  notes,
  source,
  sourceDetail = null,
  createdAt,
  deals = [],
  consents = [],
  files = [],
  communications = [],
  canCreateComm = false,
  active,
  counts,
  showTasks = true,
  ozetSlot,
  tasksSlot,
  stageNames,
}: {
  customerId: string;
  customerName: string;
  defaultProvinceId: string | null;
  provinces: Province[];
  transactionTypes?: string[];
  propertyTypes?: string[];
  urgencyOptions?: { value: string; label: string }[];
  demands: Demand[];
  /** Birleşik olay akışı (yalnız Zaman çizelgesi sekmesinde dolu); sunucuda kategoriye göre süzülmüş. */
  events?: TimelineEvent[];
  timelineCategories?: TimelineCategory[];
  activeCategory?: string;
  timelineLimit?: number;
  timelineLoadMoreHref?: string;
  appts?: ApptRow[];
  offers?: OfferRow[];
  contracts?: ContractRow[];
  tags: string[];
  notes: string | null;
  source: string | null;
  sourceDetail?: string | null;
  createdAt: string;
  deals?: DealRow[];
  consents?: ConsentRow[];
  files?: FileRow[];
  communications?: CommRow[];
  canCreateComm?: boolean;
  /** Seçili sekme (sunucuda çözülür); yalnız bu sekmenin içeriği çizilir. */
  active: string;
  counts: { demands: number; comms: number; tasks: number | null; deals: number; offers: number; appts: number; files: number; contracts: number; consents: number };
  showTasks?: boolean;
  /** Özet sekmesinin akan bölümleri (portföy önerileri + memnuniyet) — yalnız aktifken çizilir. */
  ozetSlot?: ReactNode;
  tasksSlot?: ReactNode;
  /** Ofisin görünen anlaşma aşaması adları (aşama anahtarı → ad); verilmezse varsayılan adlar. */
  stageNames?: Record<string, string>;
}) {
  const stageLabel: Record<string, string> = stageNames ?? stageLabelMap(defaultStageLabels());
  const channelLabel: Record<string, string> = {
    sms: "SMS",
    email: "E-posta",
    whatsapp: "WhatsApp",
    call: "Arama",
  };

  const tabDefs: DetailTabDef[] = [
    { id: "zaman", label: "Zaman çizelgesi", icon: History },
    { id: "talepler", label: "Talepler ve eşleşmeler", icon: Target, count: counts.demands },
    { id: "anlasmalar", label: "Teklifler ve anlaşmalar", icon: Handshake, count: counts.deals + counts.offers },
    { id: "randevu", label: "Randevu ve görevler", icon: CalendarDays, count: counts.appts + (showTasks ? counts.tasks ?? 0 : 0) },
    { id: "belgeler", label: "Belgeler ve imza", icon: Folder, count: counts.files + counts.contracts },
    { id: "izinler", label: "İletişim tercihleri", icon: ShieldCheck, count: counts.consents },
    { id: "iletisim", label: "İletişim kayıtları", icon: MessageSquare, count: counts.comms },
    { id: "notlar", label: "Notlar", icon: Sparkles },
  ];

  return (
    <div className="space-y-4">
      <DetailTabs basePath={`/app/musteriler/${customerId}`} tabs={tabDefs} active={active} label="Müşteri sekmeleri" />

      <Pane id="zaman" active={active}>
        <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
          <ActivityTimeline
            events={events}
            categories={timelineCategories}
            activeCategory={activeCategory}
            hrefForCategory={(k) => `/app/musteriler/${customerId}?sekme=zaman${k ? `&kategori=${k}` : ""}`}
            pageSize={timelineLimit}
            loadMoreHref={timelineLoadMoreHref}
            emptyTitle={activeCategory ? "Bu kategoride kayıt yok." : "Bu müşteri için henüz olay kaydı yok."}
            emptyHint="Görüşme, randevu, teklif ve portal hareketleri oluştukça burada günlere göre listelenir."
          />
        </section>
      </Pane>

      <Pane id="talepler" active={active}>
        <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
          <div className="flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
              <Target className="h-4 w-4 text-brand-600" /> Talepler
            </h2>
            <ButtonLink href={`/app/musteriler/${customerId}/talep/yeni`} size="sm" icon={Plus}>Talep ekle</ButtonLink>
          </div>
          {demands.length === 0 ? (
            <EmptyStateV3 variant="compact" className="mt-4" title="Bu müşteri için henüz talep tanımlanmadı." />
          ) : (
            <div className="mt-4 space-y-3">
              {demands.map((d) => (
                <div key={d.id} className="rounded-[var(--radius-card)] border border-line bg-canvas/60 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold uppercase tracking-[0.08em] text-brand-600">
                      {d.transaction_type}{d.property_type ? ` · ${d.property_type}` : ""}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-mint-500/10 px-2 py-0.5 text-xs font-bold text-mint-600">
                        {demandStatus[d.status] ?? d.status}
                      </span>
                      <EditDemandDialog demand={d} provinces={provinces} customerId={customerId} />
                      <DemandStatusButtons demandId={d.id} customerId={customerId} status={d.status} />
                    </div>
                  </div>
                  <p className="mt-2 font-display text-lg font-extrabold text-ink-950">{budgetLabel(d.budget_min, d.budget_max)}</p>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
                    {d.rooms ? <span>{d.rooms}</span> : null}
                    {d.min_sqm ? <span>≥ {d.min_sqm} m²</span> : null}
                    {d.urgency ? <span className="text-amber-500">{d.urgency}</span> : null}
                  </div>
                  <Link href={`/app/eslestirme?demand=${d.id}`} className="mt-3 inline-flex text-xs font-semibold text-brand-600 hover:underline">
                    Bu talebe portföy eşleştir →
                  </Link>
                </div>
              ))}
            </div>
          )}
        </section>
        {ozetSlot}
      </Pane>

      <Pane id="anlasmalar" active={active}>
        <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
          <div className="flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
              <Handshake className="h-4 w-4 text-amber-500" /> Anlaşmalar
            </h2>
            <Link href="/app/anlasmalar" className="text-xs font-semibold text-brand-600 hover:underline">
              Pipeline →
            </Link>
          </div>
          {deals.length === 0 ? (
            <EmptyStateV3 variant="compact" className="mt-4" title="Bu müşteriye bağlı anlaşma yok." />
          ) : (
            <div className="mt-4 space-y-2">
              {deals.map((d) => (
                <Link
                  key={d.id}
                  href={`/app/anlasmalar/${d.id}`}
                  className="focus-ring group flex items-center justify-between gap-3 rounded-[var(--radius-card)] border border-line bg-canvas/50 px-3 py-3 transition hover:border-brand-300"
                >
                  <div>
                    <p className="text-sm font-semibold text-ink-950">
                      {d.deal_type === "rent" ? "Kiralama" : "Satış"} · {stageLabel[d.stage] ?? d.stage}
                    </p>
                    <p className="text-xs text-text-muted">{dateTime(d.updated_at)}</p>
                  </div>
                  <span className="flex items-center gap-2">
                    <span className="font-display text-sm font-extrabold text-brand-600">
                      {d.deal_value != null ? money(d.deal_value) : "—"}
                    </span>
                    <ArrowUpRight className="hover-action h-4 w-4 text-text-faint opacity-0 transition group-hover:text-brand-600 group-hover:opacity-100" />
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>
        <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
          <div className="flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
              <Tag className="h-4 w-4 text-amber-500" /> Teklifler
            </h2>
            <Link href="/app/teklifler" className="text-xs font-semibold text-brand-600 hover:underline">Teklifler →</Link>
          </div>
          {offers.length === 0 ? (
            <EmptyStateV3 variant="compact" className="mt-4" title="Bu müşteriye bağlı teklif yok." />
          ) : (
            <div className="mt-4 space-y-2">
              {offers.map((o) => (
                <Link
                  key={o.id}
                  href={`/app/teklifler/${o.id}`}
                  className="focus-ring group flex items-center justify-between gap-3 rounded-[var(--radius-card)] border border-line bg-canvas/50 px-3 py-3 transition hover:border-brand-300"
                >
                  <div>
                    <p className="text-sm font-semibold text-ink-950">{OFFER_STATUS_LABEL[o.status] ?? o.status}</p>
                    <p className="text-xs text-text-muted">{dateTime(o.created_at)}</p>
                  </div>
                  <span className="font-display text-sm font-extrabold text-brand-600">{o.amount != null ? money(Number(o.amount)) : "—"}</span>
                </Link>
              ))}
            </div>
          )}
        </section>
      </Pane>

      <Pane id="iletisim" active={active}>
        <CommunicationTimeline
          customerId={customerId}
          initialItems={communications}
          canCreate={canCreateComm}
        />
      </Pane>

      <Pane id="belgeler" active={active}>
        <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
          <div className="flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
              <FileText className="h-4 w-4 text-danger-500" /> Sözleşmeler ve imza
            </h2>
            <Link href="/app/sozlesmeler" className="text-xs font-semibold text-brand-600 hover:underline">Sözleşmeler →</Link>
          </div>
          {contracts.length === 0 ? (
            <EmptyStateV3 variant="compact" className="mt-4" title="Bu müşteriye bağlı sözleşme yok." />
          ) : (
            <div className="mt-4 space-y-2">
              {contracts.map((c) => (
                <Link
                  key={c.id}
                  href={`/app/sozlesmeler/${c.id}`}
                  className="focus-ring group flex items-center justify-between gap-3 rounded-[var(--radius-card)] border border-line bg-canvas/50 px-3 py-3 transition hover:border-brand-300"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink-950">{c.title}</p>
                    <p className="text-xs text-text-muted">
                      {CONTRACT_STATUS_LABEL[c.status] ?? c.status} · {dateTime(c.signed_at ?? c.created_at)}
                    </p>
                  </div>
                  <ArrowUpRight className="hover-action h-4 w-4 shrink-0 text-text-faint opacity-0 transition group-hover:text-brand-600 group-hover:opacity-100" />
                </Link>
              ))}
            </div>
          )}
        </section>
        <CustomerFilesTab customerId={customerId} files={files ?? []} />
      </Pane>

      <Pane id="izinler" active={active}>
        <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
          <div className="flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
              <ShieldCheck className="h-4 w-4 text-mint-600" /> İYS izinleri
            </h2>
            <Link href="/app/uyum" className="text-xs font-semibold text-brand-600 hover:underline">
              Uyum merkezi →
            </Link>
          </div>
          {consents.length === 0 ? (
            <EmptyStateV3 variant="compact" className="mt-4" title="Kayıtlı ticari ileti izni yok." />
          ) : (
            <div className="mt-4 space-y-2">
              {consents.map((c) => (
                <Link
                  key={c.id}
                  href="/app/uyum"
                  className="focus-ring group flex items-center justify-between rounded-[var(--radius-card)] border border-line bg-canvas/50 px-3 py-2.5 text-sm transition hover:border-brand-300"
                >
                  <span className="font-semibold text-ink-950">{channelLabel[c.channel] ?? c.channel}</span>
                  <span className="flex items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                        c.status === "granted" ? "bg-mint-500/10 text-mint-600" : c.status === "denied" ? "bg-danger-500/10 text-danger-500" : "bg-amber-400/15 text-amber-600"
                      }`}
                    >
                      {c.status === "granted" ? "İzinli" : c.status === "denied" ? "Ret" : c.status}
                    </span>
                    <ArrowUpRight className="hover-action h-3.5 w-3.5 text-text-faint opacity-0 transition group-hover:text-brand-600 group-hover:opacity-100" />
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>
      </Pane>

      <Pane id="randevu" active={active}>
        <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
          <div className="flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
              <CalendarDays className="h-4 w-4 text-mint-600" /> Randevular
            </h2>
            <ButtonLink href={`/app/randevular?customer=${customerId}`} size="sm" icon={Plus}>Randevu ver</ButtonLink>
          </div>
          {appts.length === 0 ? (
            <EmptyStateV3 variant="compact" className="mt-4" title="Bu müşteriye bağlı randevu yok." />
          ) : (
            <div className="mt-4 space-y-2">
              {appts.map((a) => (
                <Link
                  key={a.id}
                  href={`/app/randevular?customer=${customerId}`}
                  className="focus-ring group flex items-center justify-between gap-3 rounded-[var(--radius-card)] border border-line bg-canvas/50 px-3 py-3 transition hover:border-brand-300"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink-950">
                      {APPT_TYPE_LABEL[a.appointment_type] ?? "Randevu"} · {APPT_STATUS_LABEL[a.status] ?? a.status}
                    </p>
                    <p className="truncate text-xs text-text-muted">{dateTime(a.scheduled_at)}{a.location ? ` · ${a.location}` : ""}</p>
                  </div>
                  <ArrowUpRight className="hover-action h-4 w-4 shrink-0 text-text-faint opacity-0 transition group-hover:text-brand-600 group-hover:opacity-100" />
                </Link>
              ))}
            </div>
          )}
        </section>
        {tasksSlot}
      </Pane>

      <Pane id="notlar" active={active}>
        <div className="space-y-4">
          {tags.length > 0 ? (
            <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
              <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
                <Tag className="h-4 w-4 text-cyan-500" /> Etiketler
              </h2>
              <div className="mt-3 flex flex-wrap gap-2">
                {tags.map((t) => (
                  <span key={t} className="rounded-full border border-line bg-canvas px-3 py-1 text-xs font-medium text-text-muted">{t}</span>
                ))}
              </div>
            </section>
          ) : null}
          <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
            <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
              <Sparkles className="h-4 w-4 text-amber-500" /> Notlar
            </h2>
            <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-text-muted">{notes || "Not eklenmedi."}</p>
            <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4 text-xs text-text-faint">
              <span>
                Kaynak: {formatLeadSource(source) ?? "belirtilmedi"}
                {sourceDetail ? (
                  <span className="ml-1 rounded-full bg-brand-600/10 px-1.5 py-0.5 font-semibold text-brand-700">
                    {sourceDetail}
                  </span>
                ) : null}
              </span>
              <span>·</span>
              <span>Kayıt: {dateTime(createdAt)}</span>
            </div>
          </section>
        </div>
      </Pane>

    </div>
  );
}
