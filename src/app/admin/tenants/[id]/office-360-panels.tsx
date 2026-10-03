import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowUpRight, Download, ShieldAlert } from "lucide-react";
import { EmptyStateV3 } from "@/components/ui/empty-state-v3";
import { getPlan } from "@/lib/billing/plans";
import { relativeTimeTR } from "@/lib/admin-format";
import {
  CAPTURE_STATUS_LABEL,
  INVOICE_STATUS_LABEL,
  TICKET_STATUS_LABEL,
  limitPercent,
  limitText,
  tl,
  type CaptureRow,
  type ConsentRow,
  type InvoiceRow,
  type IysEventRow,
  type LimitRow,
  type OfficeAccess,
  type SubRow,
  type TeamMember,
  type TicketRow,
} from "@/lib/admin/office-360";

const fmt = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)) : "—";
const fmtDay = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium" }).format(new Date(iso)) : "—";

const ROLE_LABEL: Record<string, string> = {
  owner: "Ofis sahibi",
  gm: "Genel müdür",
  branch_manager: "Şube müdürü",
  team_lead: "Takım lideri",
  advisor: "Danışman",
  call_center: "Çağrı merkezi",
  accounting: "Muhasebe",
  readonly: "Salt okunur",
};
const SUB_STATUS_LABEL: Record<string, string> = {
  trialing: "Deneme",
  active: "Aktif",
  past_due: "Gecikmiş",
  cancelled: "İptal",
  paused: "Duraklatıldı",
};
const PRIORITY_LABEL: Record<string, string> = { low: "Düşük", normal: "Normal", high: "Yüksek", urgent: "Acil" };

function Panel({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="dashboard-panel overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3.5">
        <h2 className="font-display font-bold text-ink-950">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function MoreLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline">
      {children} <ArrowUpRight className="h-3 w-3" />
    </Link>
  );
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-bold uppercase tracking-wide text-text-faint">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold text-ink-950">{value}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Abonelik ve ödemeler
// ---------------------------------------------------------------------------
export function SubscriptionTab({
  sub,
  tenantStatus,
  invoices,
  captures,
  billingHref,
}: {
  sub: SubRow | null;
  tenantStatus: string;
  invoices: InvoiceRow[];
  captures: CaptureRow[];
  billingHref: string;
}) {
  const problem = captures.filter((c) => c.status === "refund_required" || c.status === "manual_review" || c.status === "refunded");
  return (
    <div className="space-y-4">
      <Panel title="Abonelik" action={<MoreLink href={billingHref}>Faturalama ekranı</MoreLink>}>
        {sub ? (
          <dl className="grid gap-4 p-5 sm:grid-cols-3">
            <Field label="Paket" value={getPlan(sub.plan).name} />
            <Field label="Durum" value={SUB_STATUS_LABEL[sub.status] ?? sub.status} />
            <Field label="Ofis durumu" value={tenantStatus} />
            <Field label="Dönem başı" value={fmtDay(sub.current_period_start)} />
            <Field label="Dönem sonu" value={fmtDay(sub.current_period_end)} />
            <Field label="Deneme sonu" value={fmtDay(sub.trial_ends_at)} />
            {sub.cancelled_at ? <Field label="İptal tarihi" value={fmtDay(sub.cancelled_at)} /> : null}
          </dl>
        ) : (
          <EmptyStateV3 variant="compact" title="Abonelik kaydı yok" description="Bu ofis için abonelik satırı oluşturulmamış." />
        )}
        <p className="border-t border-line px-5 py-3 text-xs text-text-muted">
          Paket ve durum değişikliği için sayfa başındaki «Abonelik» düğmesini kullanın (manuel işlem, denetim kaydına yazılır).
        </p>
      </Panel>

      <Panel title={`Faturalar (${invoices.length})`} action={<MoreLink href={billingHref}>Tüm faturalar</MoreLink>}>
        {invoices.length === 0 ? (
          <EmptyStateV3 variant="compact" title="Fatura yok" />
        ) : (
          <div className="divide-y divide-line">
            {invoices.slice(0, 20).map((inv) => (
              <div key={inv.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                <div>
                  <p className="font-semibold text-ink-950">{inv.invoice_no}</p>
                  <p className="text-xs text-text-faint">
                    {INVOICE_STATUS_LABEL[inv.status] ?? inv.status} · vade {fmtDay(inv.due_at)}
                    {inv.paid_at ? ` · ödeme ${fmtDay(inv.paid_at)}` : ""}
                  </p>
                </div>
                <span className="numeric font-bold text-ink-950">{tl(inv.total_try)}</span>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title={`Sorunlu / iade ödemeler (${problem.length})`}>
        {problem.length === 0 ? (
          <EmptyStateV3 variant="compact" title="Sorunlu ödeme yok" description="İade gerektiren veya elle inceleme bekleyen yakalama kaydı bulunmuyor." />
        ) : (
          <div className="divide-y divide-line">
            {problem.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-2 px-5 py-3 text-sm">
                <div>
                  <p className="font-semibold text-ink-950">{CAPTURE_STATUS_LABEL[c.status] ?? c.status}</p>
                  <p className="text-xs text-text-faint">{fmt(c.refunded_at ?? c.captured_at)}</p>
                </div>
                <span className="numeric font-bold text-ink-950">{tl(c.amount_try)}</span>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Destek
// ---------------------------------------------------------------------------
export function SupportTab({ tickets, tenantId }: { tickets: TicketRow[]; tenantId: string }) {
  return (
    <Panel title={`Destek talepleri (${tickets.length})`} action={<MoreLink href={`/admin/tickets?tenant=${tenantId}`}>Destek ekranında aç</MoreLink>}>
      {tickets.length === 0 ? (
        <EmptyStateV3 variant="compact" title="Bu ofisin destek talebi yok" />
      ) : (
        <div className="divide-y divide-line">
          {tickets.map((t) => (
            <div key={t.id} className="group relative flex items-center gap-3 px-5 py-3 transition hover:bg-brand-600/[0.02]">
              <Link href={`/admin/tickets/${t.id}`} className="absolute inset-0" aria-label={`${t.subject} talebini aç`} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink-950 group-hover:text-brand-600">{t.subject}</p>
                <p className="mt-0.5 text-xs text-text-faint">
                  {TICKET_STATUS_LABEL[t.status] ?? t.status} · {PRIORITY_LABEL[t.priority] ?? t.priority} · {fmt(t.created_at)}
                </p>
              </div>
              <ArrowUpRight className="h-4 w-4 shrink-0 text-text-faint opacity-0 transition group-hover:opacity-100" />
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Kullanım ve limitler
// ---------------------------------------------------------------------------
export function LimitsPanel({ rows, planName }: { rows: LimitRow[]; planName: string }) {
  return (
    <Panel title={`Plan limitleri · ${planName}`}>
      <div className="space-y-4 p-5">
        {rows.map((r) => {
          const pct = limitPercent(r);
          const body = (
            <>
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="font-semibold text-ink-950">{r.label}</span>
                <span className="numeric font-bold text-text-muted">{limitText(r)}</span>
              </div>
              <div
                className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-canvas"
                role="progressbar"
                aria-label={`${r.label} kullanımı`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={pct ?? 0}
              >
                {pct != null ? (
                  <div
                    className={`h-full rounded-full ${pct >= 90 ? "bg-danger-500" : pct >= 70 ? "bg-amber-500" : "bg-brand-600"}`}
                    style={{ width: `${Math.max(pct, 2)}%` }}
                  />
                ) : null}
              </div>
              <p className="mt-1 text-xs text-text-faint">{pct == null ? "Pakette sınır yok" : `Limitin %${pct}'i kullanılıyor`}</p>
            </>
          );
          return r.href ? (
            <Link key={r.key} href={r.href} className="focus-ring block rounded-[var(--radius-control)] transition hover:bg-brand-600/[0.03]">
              {body}
            </Link>
          ) : (
            <div key={r.key}>{body}</div>
          );
        })}
      </div>
    </Panel>
  );
}

export function ExportVault({ tenantId }: { tenantId: string }) {
  return (
    <section className="rounded-[var(--radius-panel)] border border-warn-500/30 bg-warn-500/5 p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-card)] bg-warn-500/15 text-warn-600">
            <ShieldAlert className="h-5 w-5" />
          </span>
          <div>
            <h2 className="font-display font-bold text-ink-950">Ayrılış & arşiv kasası</h2>
            <p className="mt-0.5 max-w-md text-xs text-text-muted">
              Sözleşme sonu / iptal durumunda tüm ofis verisini (müşteri, portföy, anlaşma, komisyon, dosya listesi) tek veri paketi olarak
              indirin — müşteriye teslim veya arşivleme için.
            </p>
          </div>
        </div>
        <a
          href={`/api/admin/tenants/${tenantId}/export`}
          className="inline-flex shrink-0 items-center gap-2 rounded-[var(--radius-control)] bg-ink-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-ink-800"
        >
          <Download className="h-4 w-4" /> Veri paketini indir
        </a>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Ekip ve oturumlar
// ---------------------------------------------------------------------------
export function TeamTab({ members, failed30d, tenantId }: { members: TeamMember[]; failed30d: number; tenantId: string }) {
  const active = members.filter((m) => m.is_active).length;
  const with2fa = members.filter((m) => m.two_factor_sms).length;
  const stats: { label: string; value: number; href?: string }[] = [
    { label: "Aktif kullanıcı", value: active },
    { label: "Pasif kullanıcı", value: members.length - active },
    { label: "SMS 2FA açık", value: with2fa },
    { label: "Başarısız giriş · 30 gün", value: failed30d, href: `/admin/tenants/${tenantId}?sekme=zaman&kategori=oturum` },
  ];
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        {stats.map((s) => {
          const inner = (
            <>
              <p className="numeric font-display text-2xl font-extrabold text-ink-950">{s.value}</p>
              <p className="text-xs text-text-muted">{s.label}</p>
            </>
          );
          return s.href ? (
            <Link key={s.label} href={s.href} className="focus-ring press rounded-[var(--radius-card)] border border-line bg-surface p-4 transition hover:border-brand-600/40">
              {inner}
            </Link>
          ) : (
            <div key={s.label} className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
              {inner}
            </div>
          );
        })}
      </div>
      <Panel title={`Ofis kullanıcıları (${members.length})`}>
        {members.length === 0 ? (
          <EmptyStateV3 variant="compact" title="Kullanıcı yok" />
        ) : (
          <div className="divide-y divide-line">
            {members.map((m) => (
              <div key={m.id} className="group relative flex flex-wrap items-center gap-3 px-5 py-3 transition hover:bg-brand-600/[0.02]">
                <Link href={`/admin/members/${m.id}`} className="absolute inset-0" aria-label={`${m.full_name ?? "Kullanıcı"} detayını aç`} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink-950 group-hover:text-brand-600">{m.full_name ?? "İsimsiz kullanıcı"}</p>
                  <p className="text-xs text-text-faint">
                    {ROLE_LABEL[m.role] ?? m.role} · {m.is_active ? "Aktif" : "Pasif"} · SMS 2FA {m.two_factor_sms ? "açık" : "kapalı"}
                  </p>
                </div>
                <span className="text-xs text-text-muted">{m.lastLogin ? `Son giriş ${relativeTimeTR(m.lastLogin)}` : "Giriş kaydı yok"}</span>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Yasal ve onaylar
// ---------------------------------------------------------------------------
const CHANNEL_LABEL: Record<string, string> = { sms: "SMS", email: "E-posta", whatsapp: "WhatsApp", call: "Arama" };

export function LegalTab({
  consents,
  iys,
  erasureCount,
  names,
  access,
}: {
  consents: ConsentRow[];
  iys: IysEventRow[];
  erasureCount: number;
  names: Map<string, string>;
  access: OfficeAccess;
}) {
  const byChannel = new Map<string, number>();
  for (const e of iys) byChannel.set(e.channel, (byChannel.get(e.channel) ?? 0) + 1);
  return (
    <div className="space-y-4">
      <Panel title={`Koşul ve KVKK kabulleri (${consents.length})`}>
        {consents.length === 0 ? (
          <EmptyStateV3 variant="compact" title="Kabul kaydı yok" description="Bu ofis için kayıt sırasında alınmış kabul kaydı bulunmuyor." />
        ) : (
          <div className="divide-y divide-line">
            {consents.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                <div>
                  <p className="font-semibold text-ink-950">{names.get(c.user_id) ?? "Kullanıcı"}</p>
                  <p className="text-xs text-text-faint">
                    Koşullar {c.terms_version} · KVKK {c.kvkk_version}
                    {access.showIp && c.ip_address ? ` · ${c.ip_address}` : ""}
                  </p>
                </div>
                <span className="text-xs text-text-muted">{fmt(c.accepted_at)}</span>
              </div>
            ))}
          </div>
        )}
      </Panel>
      <Panel title={`İYS izin olayları (${iys.length})`}>
        {iys.length === 0 ? (
          <EmptyStateV3 variant="compact" title="İYS olayı yok" />
        ) : (
          <>
            <div className="flex flex-wrap gap-2 border-b border-line px-5 py-3">
              {[...byChannel.entries()].map(([ch, n]) => (
                <span key={ch} className="rounded-full bg-brand-600/8 px-2.5 py-1 text-xs font-semibold text-brand-700">
                  {CHANNEL_LABEL[ch] ?? ch}: {n}
                </span>
              ))}
            </div>
            <p className="px-5 py-3 text-xs text-text-muted">
              Yalnız olay sayıları gösterilir; hangi müşteriye ait olduğu süper admine açılmaz (KVKK).
            </p>
          </>
        )}
      </Panel>
      <Panel title="KVKK silme/anonimleştirme">
        <p className="px-5 py-4 text-sm text-ink-950">
          Bu ofiste uygulanan silme/anonimleştirme talebi: <strong className="numeric">{erasureCount}</strong>
        </p>
      </Panel>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fatura profili
// ---------------------------------------------------------------------------
export type BillingProfile = {
  name: string;
  tax_office: string | null;
  tax_number: string | null;
  license_no: string | null;
  address_line: string | null;
  city: string | null;
  phone: string | null;
};

export function BillingProfileTab({ profile }: { profile: BillingProfile }) {
  const rows: [string, string | null][] = [
    ["Unvan", profile.name],
    ["Vergi dairesi", profile.tax_office],
    ["Vergi no", profile.tax_number],
    ["Yetki belgesi no", profile.license_no],
    ["Adres", profile.address_line],
    ["Şehir", profile.city],
    ["Telefon", profile.phone],
  ];
  const filled = rows.filter(([, v]) => v && v.trim());
  return (
    <Panel title="Fatura profili">
      {filled.length <= 1 ? (
        <EmptyStateV3 variant="compact" title="Fatura bilgisi girilmemiş" description="Ofis henüz vergi ve adres bilgisini girmedi." />
      ) : (
        <dl className="grid gap-4 p-5 sm:grid-cols-2">
          {rows.map(([k, v]) => (
            <Field key={k} label={k} value={v && v.trim() ? v : "—"} />
          ))}
        </dl>
      )}
    </Panel>
  );
}
