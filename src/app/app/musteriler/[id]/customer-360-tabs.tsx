import Link from "next/link";
import type { ReactNode } from "react";
import {
  ArrowUpRight,
  CalendarDays,
  FileText,
  Folder,
  Handshake,
  History,
  LayoutDashboard,
  ListChecks,
  MessageSquare,
  PhoneCall,
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
import { CustomerTimelineTab, type TimelineItem } from "./customer-timeline-tab";

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

type ActivityItem = {
  key: string;
  title: string;
  sub: string;
  time: string;
  tone: string;
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
 * "aktivite" → özet (aktivite akışı artık Özet'te).
 */
export const CUSTOMER_TAB_IDS = [
  "ozet",
  "talepler",
  "zaman",
  "iletisim",
  "gorevler",
  "anlasmalar",
  "dosyalar",
  "izinler",
  "notlar",
  "gecmis",
] as const;
export const CUSTOMER_TAB_ALIASES: Record<string, string> = { aktivite: "ozet" };

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
  activity,
  timeline = [],
  tags,
  notes,
  source,
  sourceDetail = null,
  createdAt,
  audit,
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
}: {
  customerId: string;
  customerName: string;
  defaultProvinceId: string | null;
  provinces: Province[];
  transactionTypes?: string[];
  propertyTypes?: string[];
  urgencyOptions?: { value: string; label: string }[];
  demands: Demand[];
  activity: ActivityItem[];
  timeline?: TimelineItem[];
  tags: string[];
  notes: string | null;
  source: string | null;
  sourceDetail?: string | null;
  createdAt: string;
  audit: { id: string; action: string; created_at: string }[];
  deals?: DealRow[];
  consents?: ConsentRow[];
  files?: FileRow[];
  communications?: CommRow[];
  canCreateComm?: boolean;
  /** Seçili sekme (sunucuda çözülür); yalnız bu sekmenin içeriği çizilir. */
  active: string;
  counts: { demands: number; comms: number; tasks: number | null; deals: number; files: number; consents: number; audit: number };
  showTasks?: boolean;
  /** Özet sekmesinin akan bölümleri (portföy önerileri + memnuniyet) — yalnız aktifken çizilir. */
  ozetSlot?: ReactNode;
  tasksSlot?: ReactNode;
}) {
  const stageLabel: Record<string, string> = {
    new: "Yeni",
    qualified: "Nitelikli",
    negotiation: "Müzakere",
    won: "Kazanıldı",
    lost: "Kaybedildi",
  };
  const channelLabel: Record<string, string> = {
    sms: "SMS",
    email: "E-posta",
    whatsapp: "WhatsApp",
    call: "Arama",
  };

  const tabDefs: DetailTabDef[] = [
    { id: "ozet", label: "Özet", icon: LayoutDashboard, count: activity.length },
    { id: "talepler", label: "Talepler", icon: Target, count: counts.demands },
    { id: "zaman", label: "Zaman tüneli", icon: History },
    { id: "iletisim", label: "İletişim", icon: MessageSquare, count: counts.comms },
    { id: "gorevler", label: "Görevler", icon: ListChecks, count: counts.tasks, hidden: !showTasks },
    { id: "anlasmalar", label: "Anlaşmalar", icon: Handshake, count: counts.deals },
    { id: "dosyalar", label: "Dosyalar", icon: Folder, count: counts.files },
    { id: "izinler", label: "İYS", icon: ShieldCheck, count: counts.consents },
    { id: "notlar", label: "Notlar", icon: Sparkles },
    { id: "gecmis", label: "Geçmiş", icon: FileText, count: counts.audit },
  ];

  return (
    <div className="space-y-4">
      <DetailTabs basePath={`/app/musteriler/${customerId}`} tabs={tabDefs} active={active} label="Müşteri sekmeleri" />

      <Pane id="zaman" active={active}>
        <CustomerTimelineTab items={timeline} />
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
      </Pane>

      <Pane id="iletisim" active={active}>
        <CommunicationTimeline
          customerId={customerId}
          initialItems={communications}
          canCreate={canCreateComm}
        />
      </Pane>

      <Pane id="dosyalar" active={active}><CustomerFilesTab customerId={customerId} files={files ?? []} /></Pane>

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

      <Pane id="ozet" active={active}>
        <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
          <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
            <PhoneCall className="h-4 w-4 text-mint-600" /> Aktivite akışı
          </h2>
          {activity.length === 0 ? (
            <EmptyStateV3 variant="compact" className="mt-4" title="Henüz çağrı veya randevu kaydı yok." />
          ) : (
            <div className="mt-4 space-y-3">
              {activity.map((a) => (
                <div key={a.key} className="flex items-start gap-3 rounded-[var(--radius-card)] border border-line bg-canvas/50 px-3 py-3">
                  <span className={`mt-0.5 grid h-8 w-8 place-items-center rounded-[var(--radius-control)] ${a.tone}`}>
                    <CalendarDays className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-ink-950">{a.title}</p>
                    <p className="text-xs text-text-muted">{a.sub}</p>
                  </div>
                  <span className="shrink-0 text-xs text-text-faint">{dateTime(a.time)}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      {ozetSlot}
      </Pane>

      <Pane id="gorevler" active={active}>{tasksSlot}</Pane>

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
                Kaynak: {source || "belirtilmedi"}
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

      <Pane id="gecmis" active={active}>
        <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
          <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
            <FileText className="h-4 w-4 text-brand-600" /> İşlem geçmişi
          </h2>
          {audit.length === 0 ? (
            <EmptyStateV3 variant="compact" className="mt-4" title="Henüz denetim kaydı yok. Yeni düzenlemeler burada görünecek." />
          ) : (
            <div className="mt-4 space-y-2">
              {audit.map((a) => (
                <div key={a.id} className="flex items-center justify-between rounded-[var(--radius-card)] border border-line bg-canvas/50 px-3 py-2.5 text-sm">
                  <span className="font-medium text-ink-950">{a.action}</span>
                  <span className="text-xs text-text-faint">{dateTime(a.created_at)}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </Pane>
    </div>
  );
}
