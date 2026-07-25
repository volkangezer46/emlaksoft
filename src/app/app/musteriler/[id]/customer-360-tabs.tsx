"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Activity,
  CalendarDays,
  FileText,
  Folder,
  Handshake,
  MessageSquare,
  PhoneCall,
  ShieldCheck,
  Sparkles,
  Tag,
  Target,
} from "lucide-react";
import { NewDemandDialog } from "./new-demand-dialog";
import { DemandStatusButtons } from "./demand-status-buttons";
import { EditDemandDialog } from "./edit-demand-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CustomerFilesTab } from "./customer-files-tab";
import { CommunicationTimeline } from "@/components/app/communication-timeline";

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

const tabs = [
  { id: "talepler",  label: "Talepler",   icon: Target },
  { id: "anlasmalar", label: "Anlaşmalar", icon: Handshake },
  { id: "iletisim", label: "İletişim",   icon: MessageSquare },
  { id: "dosyalar", label: "Dosyalar",   icon: Folder },
  { id: "izinler",  label: "İYS",        icon: ShieldCheck },
  { id: "aktivite", label: "Aktivite",   icon: Activity },
  { id: "notlar",   label: "Notlar",     icon: Sparkles },
  { id: "gecmis",   label: "Geçmiş",     icon: FileText },
] as const;

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

type TabId = (typeof tabs)[number]["id"];

export function Customer360Tabs({
  customerId,
  customerName,
  defaultProvinceId,
  provinces,
  transactionTypes,
  propertyTypes,
  urgencyOptions,
  demands,
  activity,
  tags,
  notes,
  source,
  createdAt,
  audit,
  deals = [],
  consents = [],
  files = [],
  communications = [],
  canCreateComm = false,
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
  tags: string[];
  notes: string | null;
  source: string | null;
  createdAt: string;
  audit: { id: string; action: string; created_at: string }[];
  deals?: DealRow[];
  consents?: ConsentRow[];
  files?: FileRow[];
  communications?: CommRow[];
  canCreateComm?: boolean;
}) {
  const [tab, setTab] = useState<TabId>("talepler");

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

  return (
    <Tabs
      value={tab}
      onValueChange={(v) => setTab(v as TabId)}
      className="space-y-4"
    >
      {/*
        Elle yazilmis butonlardan Radix Tabs'e gecildi. Onceki halde EKSIK OLANLAR:
          - role="tablist" / role="tab" / role="tabpanel" ve aria-selected
          - ok tuslariyla sekmeler arasi gezinme (WAI-ARIA sekme deseninin
            temel gereksinimi; Tab tusu sekme cubugundan CIKAR, icerige gecer)
          - aria-controls / aria-labelledby baglantisi
        Gorunum korundu: hap seklindeki sekmeler, sayaclar ve ikonlar ayni.
      */}
      <TabsList className="flex-wrap border-0 bg-transparent p-0">
        {tabs.map((t) => {
          const count =
            t.id === "talepler"   ? demands.length
            : t.id === "anlasmalar" ? deals.length
            : t.id === "iletisim" ? communications.length
            : t.id === "dosyalar" ? (files ?? []).length
            : t.id === "izinler"  ? consents.length
            : t.id === "aktivite" ? activity.length
            : t.id === "gecmis"   ? audit.length
            : null;
          return (
            <TabsTrigger
              key={t.id}
              value={t.id}
              className="group focus-ring rounded-full border border-line bg-surface px-3.5 py-1.5 text-xs font-semibold text-text-muted transition hover:border-brand-400 data-[state=active]:border-brand-600 data-[state=active]:bg-brand-600 data-[state=active]:text-white data-[state=active]:shadow-none [&_svg]:h-3.5 [&_svg]:w-3.5"
            >
              <t.icon />
              {t.label}
              {count != null ? (
                <span className="text-text-faint transition-colors group-data-[state=active]:text-white/70">{count}</span>
              ) : null}
            </TabsTrigger>
          );
        })}
      </TabsList>

      <TabsContent value="talepler">
        <section className="rounded-[20px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
          <div className="flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
              <Target className="h-4 w-4 text-brand-600" /> Talepler
            </h2>
            <NewDemandDialog
              customerId={customerId}
              customerName={customerName}
              provinces={provinces}
              defaultProvinceId={defaultProvinceId}
              transactionTypes={transactionTypes}
              propertyTypes={propertyTypes}
              urgencyOptions={urgencyOptions}
            />
          </div>
          {demands.length === 0 ? (
            <p className="mt-4 rounded-[12px] border border-dashed border-line-strong px-4 py-8 text-center text-sm text-text-muted">
              Bu müşteri için henüz talep tanımlanmadı.
            </p>
          ) : (
            <div className="mt-4 space-y-3">
              {demands.map((d) => (
                <div key={d.id} className="rounded-[14px] border border-line bg-canvas/60 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-brand-600">
                      {d.transaction_type}{d.property_type ? ` · ${d.property_type}` : ""}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-mint-500/10 px-2 py-0.5 text-[10px] font-bold text-mint-600">
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
      </TabsContent>

      <TabsContent value="anlasmalar">
        <section className="rounded-[20px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
          <div className="flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
              <Handshake className="h-4 w-4 text-amber-500" /> Anlaşmalar
            </h2>
            <Link href="/app/anlasmalar" className="text-xs font-semibold text-brand-600 hover:underline">
              Pipeline →
            </Link>
          </div>
          {deals.length === 0 ? (
            <p className="mt-4 rounded-[12px] border border-dashed border-line-strong px-4 py-8 text-center text-sm text-text-muted">
              Bu müşteriye bağlı anlaşma yok.
            </p>
          ) : (
            <div className="mt-4 space-y-2">
              {deals.map((d) => (
                <div key={d.id} className="flex items-center justify-between gap-3 rounded-[12px] border border-line bg-canvas/50 px-3 py-3">
                  <div>
                    <p className="text-sm font-semibold text-ink-950">
                      {d.deal_type === "rent" ? "Kiralama" : "Satış"} · {stageLabel[d.stage] ?? d.stage}
                    </p>
                    <p className="text-[11px] text-text-muted">{dateTime(d.updated_at)}</p>
                  </div>
                  <p className="font-display text-sm font-extrabold text-brand-600">
                    {d.deal_value != null ? money(d.deal_value) : "—"}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>
      </TabsContent>

      <TabsContent value="iletisim">
        <CommunicationTimeline
          customerId={customerId}
          initialItems={communications}
          canCreate={canCreateComm}
        />
      </TabsContent>

      <TabsContent value="dosyalar"><CustomerFilesTab customerId={customerId} files={files ?? []} /></TabsContent>

      <TabsContent value="izinler">
        <section className="rounded-[20px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
          <div className="flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
              <ShieldCheck className="h-4 w-4 text-mint-600" /> İYS izinleri
            </h2>
            <Link href="/app/uyum" className="text-xs font-semibold text-brand-600 hover:underline">
              Uyum merkezi →
            </Link>
          </div>
          {consents.length === 0 ? (
            <p className="mt-4 rounded-[12px] border border-dashed border-line-strong px-4 py-8 text-center text-sm text-text-muted">
              Kayıtlı ticari ileti izni yok.
            </p>
          ) : (
            <div className="mt-4 space-y-2">
              {consents.map((c) => (
                <div key={c.id} className="flex items-center justify-between rounded-[12px] border border-line bg-canvas/50 px-3 py-2.5 text-sm">
                  <span className="font-semibold text-ink-950">{channelLabel[c.channel] ?? c.channel}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                      c.status === "granted" ? "bg-mint-500/10 text-mint-600" : c.status === "denied" ? "bg-danger-500/10 text-danger-500" : "bg-amber-400/15 text-amber-600"
                    }`}
                  >
                    {c.status === "granted" ? "İzinli" : c.status === "denied" ? "Ret" : c.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </TabsContent>

      <TabsContent value="aktivite">
        <section className="rounded-[20px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
          <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
            <PhoneCall className="h-4 w-4 text-mint-600" /> Aktivite akışı
          </h2>
          {activity.length === 0 ? (
            <p className="mt-4 rounded-[12px] border border-dashed border-line-strong px-4 py-8 text-center text-sm text-text-muted">
              Henüz çağrı veya randevu kaydı yok.
            </p>
          ) : (
            <div className="mt-4 space-y-3">
              {activity.map((a) => (
                <div key={a.key} className="flex items-start gap-3 rounded-[12px] border border-line bg-canvas/50 px-3 py-3">
                  <span className={`mt-0.5 grid h-8 w-8 place-items-center rounded-[9px] ${a.tone}`}>
                    <CalendarDays className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-ink-950">{a.title}</p>
                    <p className="text-xs text-text-muted">{a.sub}</p>
                  </div>
                  <span className="shrink-0 text-[10px] text-text-faint">{dateTime(a.time)}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </TabsContent>

      <TabsContent value="notlar">
        <div className="space-y-4">
          {tags.length > 0 ? (
            <section className="rounded-[20px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
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
          <section className="rounded-[20px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
            <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
              <Sparkles className="h-4 w-4 text-amber-500" /> Notlar
            </h2>
            <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-text-muted">{notes || "Not eklenmedi."}</p>
            <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4 text-xs text-text-faint">
              <span>Kaynak: {source || "belirtilmedi"}</span>
              <span>·</span>
              <span>Kayıt: {dateTime(createdAt)}</span>
            </div>
          </section>
        </div>
      </TabsContent>

      <TabsContent value="gecmis">
        <section className="rounded-[20px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
          <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
            <FileText className="h-4 w-4 text-brand-600" /> İşlem geçmişi
          </h2>
          {audit.length === 0 ? (
            <p className="mt-4 rounded-[12px] border border-dashed border-line-strong px-4 py-8 text-center text-sm text-text-muted">
              Henüz denetim kaydı yok. Yeni düzenlemeler burada görünecek.
            </p>
          ) : (
            <div className="mt-4 space-y-2">
              {audit.map((a) => (
                <div key={a.id} className="flex items-center justify-between rounded-[12px] border border-line bg-canvas/50 px-3 py-2.5 text-sm">
                  <span className="font-medium text-ink-950">{a.action}</span>
                  <span className="text-[11px] text-text-faint">{dateTime(a.created_at)}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </TabsContent>
    </Tabs>
  );
}
