"use client";

import { Button } from "@/components/ui/button";
import { startTransition, useActionState, useState, useTransition } from "react";
import type { ReactNode } from "react";
import { StepUpCodeField } from "@/components/admin/step-up";
import { statusChangeNeedsStepUp } from "@/lib/platform-security/step-up-policy";
import { useRouter } from "next/navigation";
import {
  Ban,
  CalendarClock,
  CreditCard,
  Gauge,
  Handshake,
  Loader2,
  Pause,
  Play,
  PowerOff,
  Plus,
  RefreshCcw,
  Repeat,
  Undo2,
  Users2,
} from "lucide-react";
import {
  adminCancelPendingPlan,
  adminCancelSubscription,
  adminChangeBillingCycle,
  adminDisableAutoRenew,
  adminPauseSubscription,
  adminResumeSubscription,
  adminSetPlanStatus,
  adminUndoCancel,
  applyAdminPlanChange,
  applyAdminSeatChange,
  grantEntitlementOverride,
  previewAdminPlanChangeAction,
  previewAdminSeatChange,
  revokeEntitlementOverride,
  saveSubscriptionDeal,
  type PlanPreviewResult,
  type SeatPreviewResult,
  type SubOpsResult,
} from "@/app/actions/platform-subscription-ops";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTrigger,
} from "@/components/ui/dialog";
import { FormField, FormInput, FormSelect, FormTextarea } from "@/components/ui/form-controls";
import { formatDateTr } from "@/lib/format";
import { CANCEL_REASONS } from "@/lib/billing/subscription-ops-core";
import { ENTITLEMENT_KEYS, ENTITLEMENT_LABELS, describeOverride } from "@/lib/billing/entitlements/overrides";
import type { OverrideView, SubscriptionOpsData } from "@/lib/billing/subscription-ops";
import { cn } from "@/lib/utils";

type PlanOption = { id: string; name: string; monthlyTry: number };
type Action = (prev: SubOpsResult, formData: FormData) => Promise<SubOpsResult>;

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "trial", label: "Deneme" },
  { value: "active", label: "Aktif" },
  { value: "past_due", label: "Ödeme gecikti" },
  { value: "suspended", label: "Askıya alındı" },
  { value: "cancelled", label: "İptal edildi" },
];

const SUB_STATUS_LABEL: Record<string, string> = {
  trialing: "Deneme",
  active: "Aktif",
  past_due: "Ödeme gecikti",
  cancelled: "İptal edildi",
  paused: "Askıda",
};

const initial: SubOpsResult = {};

function money(amount: number, suffix = "") {
  return `${new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 }).format(amount)} ₺${suffix}`;
}
const day = (iso: string | null) => (iso ? formatDateTr(iso) : "—");

/** Gerekçe alanı (her işlemde zorunlu; denetim kaydına yazılır). */
function ReasonField({ id, name = "reason", label = "Gerekçe" }: { id: string; name?: string; label?: string }) {
  return (
    <FormField label={label} htmlFor={id} required hint="En az 10 karakter; /admin/aktivite denetim kaydına önce/sonra değeriyle yazılır.">
      <FormTextarea id={id} name={name} rows={2} required minLength={10} maxLength={500} />
    </FormField>
  );
}

function Feedback({ state }: { state: SubOpsResult }) {
  if (state.error) {
    return (
      <p role="alert" className="rounded-[var(--radius-control)] bg-danger-500/8 px-3 py-2 text-xs font-semibold text-danger-600">
        {state.error}
      </p>
    );
  }
  return null;
}

/**
 * Gerekçe diyaloğu: tetik düğmesi + başlık + alanlar + zorunlu gerekçe. Başarıda kapanır, sayfa tazelenir ve sonuç
 * metni konsolun üstündeki bilgi bandına düşer (`onDone`).
 */
function OpDialog({
  tenantId,
  action,
  trigger,
  title,
  description,
  icon,
  tone = "default",
  submitLabel,
  reasonName,
  reasonLabel,
  hidden,
  children,
  onDone,
  submitDisabled,
  size = "sm",
}: {
  tenantId: string;
  action: Action;
  trigger: ReactNode;
  title: string;
  description?: string;
  icon: ReactNode;
  tone?: "default" | "danger";
  submitLabel: string;
  reasonName?: string;
  reasonLabel?: string;
  hidden?: Record<string, string>;
  children?: ReactNode;
  onDone?: (message: string) => void;
  submitDisabled?: boolean;
  size?: "sm" | "md" | "lg";
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const [state, run, pending] = useActionState(async (prev: SubOpsResult, formData: FormData) => {
    const result = await action(prev, formData);
    if (result.ok) {
      startTransition(() => {
        setOpen(false);
        onDone?.(result.message ?? "Kaydedildi.");
        router.refresh();
      });
    }
    return result;
  }, initial);
  const idBase = title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent size={size}>
        <DialogHeader title={title} description={description} icon={icon} tone={tone} />
        <form action={run}>
          <DialogBody className="grid gap-4">
            <input type="hidden" name="tenant_id" value={tenantId} />
            {Object.entries(hidden ?? {}).map(([k, v]) => (
              <input key={k} type="hidden" name={k} value={v} />
            ))}
            {children}
            <ReasonField id={`${idBase}-reason`} name={reasonName} label={reasonLabel} />
            <Feedback state={state} />
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" size="md" type="button">
                Vazgeç
              </Button>
            </DialogClose>
            <Button variant={tone === "danger" ? "danger" : "primary"} size="md" type="submit" disabled={pending || submitDisabled}>
              {pending ? "Kaydediliyor…" : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Sayfa başı: hızlı paket/durum düzeltmesi (gerekçeli)
// ---------------------------------------------------------------------------

export function SubscriptionPanel({
  tenantId,
  currentPlan,
  currentStatus,
  plans,
}: {
  tenantId: string;
  currentPlan: string;
  currentStatus: string;
  plans: PlanOption[];
}) {
  const [plan, setPlan] = useState(currentPlan);
  const [status, setStatus] = useState(currentStatus);
  const selectedPlan = plans.find((option) => option.id === plan);
  return (
    <OpDialog
      tenantId={tenantId}
      action={adminSetPlanStatus}
      trigger={
        <Button variant="outline" size="md" type="button">
          <CreditCard className="h-4 w-4" /> Abonelik değiştir
        </Button>
      }
      title="Aboneliği değiştir"
      description="Paket ve durumu doğrudan düzeltir (kıst hesap yok). Kıst hesaplı değişiklik: Abonelik sekmesi."
      icon={<CreditCard />}
      submitLabel="Kaydet"
    >
      <FormField label="Paket" htmlFor="sub-plan">
        <FormSelect id="sub-plan" name="plan" value={plan} onChange={(event) => setPlan(event.target.value)}>
          {plans.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name} — {money(option.monthlyTry, "/ay")}
            </option>
          ))}
        </FormSelect>
      </FormField>
      {selectedPlan ? (
        <p className="-mt-2 text-xs text-text-muted">
          Yeni tutar: <span className="font-semibold text-ink-950">{money(selectedPlan.monthlyTry, "/ay")}</span> olarak güncellenecek.
        </p>
      ) : null}
      <FormField label="Durum" htmlFor="sub-status">
        <FormSelect id="sub-status" name="status" value={status} onChange={(event) => setStatus(event.target.value)}>
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </FormSelect>
      </FormField>
      {/* AD11: askıya alma / iptal ofis kapatmadır; sunucu doğrulayıcı kodu ister. */}
      {statusChangeNeedsStepUp(status, currentStatus) ? <StepUpCodeField id="sub-step-up" /> : null}
    </OpDialog>
  );
}

// ---------------------------------------------------------------------------
// Abonelik operasyon konsolu (Ofis 360 > Abonelik)
// ---------------------------------------------------------------------------

export type LimitView = { key: (typeof ENTITLEMENT_KEYS)[number]; plan: number | null; effective: number | null; used: number };

function Card({ title, icon: Icon, children, actions }: { title: string; icon: typeof Gauge; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="dashboard-panel rounded-[var(--radius-panel)] border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3.5">
        <h3 className="flex items-center gap-2 font-display text-base font-bold text-ink-950">
          <Icon className="h-4 w-4 text-brand-600" /> {title}
        </h3>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      <div className="space-y-3 p-5">{children}</div>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-bold uppercase tracking-wide text-text-faint">{label}</dt>
      <dd className="mt-0.5 break-words text-sm font-semibold text-ink-950">{value}</dd>
    </div>
  );
}

const smallBtn = (label: string, Icon: typeof Gauge, variant: "outline" | "danger" = "outline") => (
  <Button variant={variant} size="sm" type="button">
    <Icon className="h-3.5 w-3.5" /> {label}
  </Button>
);

export function SubscriptionOpsConsole({
  tenantId,
  data,
  plans,
  limits,
  todayKey,
}: {
  tenantId: string;
  data: SubscriptionOpsData;
  plans: PlanOption[];
  limits: LimitView[];
  /** "YYYY-AA-GG" (TR bugün): tarih alanlarının alt sınırı. */
  todayKey: string;
}) {
  const [notice, setNotice] = useState<string | null>(null);
  const { sub, schema } = data;
  const planName = (id: string | null) => plans.find((p) => p.id === id)?.name ?? id ?? "—";
  const paused = Boolean(sub.pauseStartedIso);
  const cancelled = sub.status === "cancelled";

  if (!sub.exists) {
    return (
      <Card title="Abonelik operasyonları" icon={Gauge}>
        <p className="text-sm text-text-muted">Bu ofisin abonelik kaydı yok; işlemler abonelik oluşunca açılır.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {notice ? (
        <p role="status" className="rounded-[var(--radius-control)] bg-mint-500/10 px-3 py-2 text-sm font-semibold text-mint-700">
          {notice}
        </p>
      ) : null}
      {!schema.opsColumns || !schema.overrides ? (
        <p className="rounded-[var(--radius-control)] border border-amber-400/40 bg-amber-400/8 px-3 py-2 text-xs font-semibold text-amber-700">
          Veritabanı hazırlığı (20261013004000) bekleniyor: taahhüt bitişi, iptal neden kodu ve limit istisnası bu ortamda henüz kaydedilemez.
          İptal, duraklatma, paket, dönem ve ek koltuk işlemleri çalışır.
        </p>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <LifecycleCard tenantId={tenantId} data={data} paused={paused} cancelled={cancelled} onDone={setNotice} />
        <PlanCard tenantId={tenantId} data={data} plans={plans} planName={planName} paused={paused} cancelled={cancelled} onDone={setNotice} />
        <DealCard tenantId={tenantId} data={data} todayKey={todayKey} onDone={setNotice} />
        <OverridesCard tenantId={tenantId} data={data} limits={limits} todayKey={todayKey} onDone={setNotice} />
      </div>
    </div>
  );
}

type CardProps = { tenantId: string; data: SubscriptionOpsData; onDone: (m: string) => void };

function LifecycleCard({ tenantId, data, paused, cancelled, onDone }: CardProps & { paused: boolean; cancelled: boolean }) {
  const { sub } = data;
  const [mode, setMode] = useState<"period_end" | "now">("period_end");
  return (
    <Card
      title="Durum, iptal ve duraklatma"
      icon={CalendarClock}
      actions={
        cancelled ? null : (
          <>
            {paused ? (
              <OpDialog
                tenantId={tenantId}
                action={adminResumeSubscription}
                trigger={smallBtn("Devam ettir", Play)}
                title="Aboneliği devam ettir"
                description="Dönem sonu gerçek duraklatma süresi kadar uzar."
                icon={<Play />}
                submitLabel="Devam ettir"
                onDone={onDone}
              />
            ) : sub.status === "active" && !sub.cancelAtPeriodEnd ? (
              <OpDialog
                tenantId={tenantId}
                action={adminPauseSubscription}
                trigger={smallBtn("Duraklat", Pause)}
                title="Aboneliği duraklat"
                description="Ofis bu sürede salt-okunur olur; süre bitince kendiliğinden devam eder ve dönem sonu uzar."
                icon={<Pause />}
                submitLabel="Duraklat"
                onDone={onDone}
              >
                <FormField label="Süre (gün)" htmlFor="ops-pause-days" required hint="1-90 gün. Yönetici işlemi yıllık 1 kez sınırından muaftır ve ofisin kendi yıllık duraklatma hakkını tüketmez.">
                  <FormInput id="ops-pause-days" name="days" type="number" min={1} max={90} defaultValue={30} required />
                </FormField>
              </OpDialog>
            ) : null}
            {sub.cancelAtPeriodEnd ? (
              <OpDialog
                tenantId={tenantId}
                action={adminUndoCancel}
                trigger={smallBtn("İptali geri al", Undo2)}
                title="Dönem sonu iptalini geri al"
                description="Abonelik dönem sonunda yenilenmeye devam eder."
                icon={<Undo2 />}
                submitLabel="Geri al"
                onDone={onDone}
              />
            ) : null}
            <OpDialog
              tenantId={tenantId}
              action={adminCancelSubscription}
              trigger={smallBtn("İptal et", Ban, "danger")}
              title="Aboneliği iptal et"
              description="Neden kodu raporlarda (abonelik raporu, kayıp nedenleri) görünür."
              icon={<Ban />}
              tone="danger"
              submitLabel={mode === "now" ? "Hemen iptal et" : "Dönem sonunda iptal et"}
              reasonName="note"
              reasonLabel="Not / gerekçe"
              onDone={onDone}
            >
              <fieldset className="grid gap-2">
                <legend className="mb-1.5 text-sm font-medium text-ink-950">Ne zaman?</legend>
                {(
                  [
                    ["period_end", `Dönem sonunda (${day(sub.periodEndIso)}) — erişim o güne kadar sürer, gece kontrolü "iptal" yapar`],
                    ["now", "Hemen — abonelik ve ofis şimdi iptal olur"],
                  ] as const
                ).map(([value, label]) => (
                  <label key={value} className="flex items-start gap-2 text-sm text-ink-950">
                    <input type="radio" name="mode" value={value} checked={mode === value} onChange={() => setMode(value)} className="mt-1" />
                    <span>{label}</span>
                  </label>
                ))}
              </fieldset>
              <FormField label="İptal nedeni" htmlFor="ops-cancel-code" required>
                <FormSelect id="ops-cancel-code" name="reason_code" required defaultValue="">
                  <option value="" disabled>
                    Seçin
                  </option>
                  {CANCEL_REASONS.map((r) => (
                    <option key={r.code} value={r.code}>
                      {r.label}
                    </option>
                  ))}
                </FormSelect>
              </FormField>
              {/* AD11: hemen iptal ofisi kapatır; sunucu doğrulayıcı kodu ister. */}
              {mode === "now" ? <StepUpCodeField id="ops-cancel-step-up" /> : null}
            </OpDialog>
          </>
        )
      }
    >
      <dl className="grid gap-4 sm:grid-cols-3">
        <Fact label="Abonelik" value={SUB_STATUS_LABEL[sub.status] ?? sub.status} />
        <Fact label="Dönem" value={`${day(sub.periodStartIso)} – ${day(sub.periodEndIso)}`} />
        <Fact label="Deneme sonu" value={day(sub.trialEndsIso)} />
      </dl>
      {paused ? (
        <p className="rounded-[var(--radius-control)] bg-amber-400/10 px-3 py-2 text-xs font-semibold text-amber-700">
          Duraklatıldı: {day(sub.pauseStartedIso)} → {day(sub.pauseEndsIso)} (ofis salt-okunur).
        </p>
      ) : null}
      {sub.cancelAtPeriodEnd ? (
        <p className="rounded-[var(--radius-control)] bg-danger-500/8 px-3 py-2 text-xs font-semibold text-danger-600">
          Dönem sonunda ({day(sub.periodEndIso)}) iptal olacak · Neden: {sub.cancelReasonLabel ?? sub.cancelReason ?? "belirtilmedi"}
          {sub.cancelNote ? ` · ${sub.cancelNote}` : ""}
        </p>
      ) : null}
      {cancelled ? (
        <p className="text-xs text-text-muted">
          Abonelik iptal edilmiş{sub.cancelReason ? ` · Neden: ${sub.cancelReasonLabel ?? sub.cancelReason}` : ""}. Yeniden açmak için sayfa başındaki «Abonelik değiştir» ile durumu düzeltin.
        </p>
      ) : null}
    </Card>
  );
}

function PlanCard({
  tenantId,
  data,
  plans,
  planName,
  paused,
  cancelled,
  onDone,
}: CardProps & { plans: PlanOption[]; planName: (id: string | null) => string; paused: boolean; cancelled: boolean }) {
  const { sub } = data;
  return (
    <Card
      title="Paket ve dönem"
      icon={Repeat}
      actions={
        cancelled ? null : (
          <>
            {!paused ? <PlanChangeDialog tenantId={tenantId} plans={plans} currentPlan={sub.plan} onDone={onDone} /> : null}
            <OpDialog
              tenantId={tenantId}
              action={adminChangeBillingCycle}
              trigger={smallBtn("Dönem tipi", RefreshCcw)}
              title="Dönem tipini değiştir"
              description="Bir sonraki yenilemeden itibaren geçerli; mevcut dönem ve tutar değişmez."
              icon={<RefreshCcw />}
              submitLabel="Kaydet"
              onDone={onDone}
            >
              <FormField label="Dönem tipi" htmlFor="ops-cycle">
                <FormSelect id="ops-cycle" name="cycle" defaultValue={sub.cycle}>
                  <option value="monthly">Aylık</option>
                  <option value="yearly">Yıllık</option>
                </FormSelect>
              </FormField>
            </OpDialog>
          </>
        )
      }
    >
      <dl className="grid gap-4 sm:grid-cols-3">
        <Fact label="Paket" value={planName(sub.plan)} />
        <Fact label="Dönem tipi" value={sub.cycle === "yearly" ? "Yıllık" : "Aylık"} />
        <Fact label="Kayıtlı aylık tutar" value={sub.amountTry != null ? money(sub.amountTry) : "—"} />
      </dl>
      {sub.pendingPlan ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-control)] bg-brand-600/[0.06] px-3 py-2 text-xs font-semibold text-brand-700">
          <span>
            Bekleyen paket: {planName(sub.pendingPlan)} · {day(sub.pendingPlanIso)} tarihinde uygulanır
          </span>
          <OpDialog
            tenantId={tenantId}
            action={adminCancelPendingPlan}
            trigger={
              <Button variant="ghost" size="xs" type="button">
                <Undo2 className="h-3.5 w-3.5" /> Geri al
              </Button>
            }
            title="Bekleyen paketi geri al"
            description="Dönem sonu paket değişikliği iptal edilir; mevcut paket sürer."
            icon={<Undo2 />}
            submitLabel="Geri al"
            onDone={onDone}
          />
        </div>
      ) : null}
      {paused ? <p className="text-xs text-text-muted">Duraklatılmış abonelikte paket değiştirilemez; önce devam ettirin.</p> : null}
    </Card>
  );
}

function PreviewBox({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warn" }) {
  return (
    <div
      className={cn(
        "space-y-1 rounded-[var(--radius-card)] border px-3 py-2.5 text-xs",
        tone === "warn" ? "border-amber-400/40 bg-amber-400/8 text-amber-800" : "border-brand-300/50 bg-brand-600/[0.04] text-ink-950",
      )}
    >
      {children}
    </div>
  );
}

function PlanChangeDialog({ tenantId, plans, currentPlan, onDone }: { tenantId: string; plans: PlanOption[]; currentPlan: string; onDone: (m: string) => void }) {
  const others = plans.filter((p) => p.id !== currentPlan);
  const [plan, setPlan] = useState(others[0]?.id ?? currentPlan);
  const [timing, setTiming] = useState<"now" | "period_end">("now");
  const [proration, setProration] = useState<"prorate" | "none">("prorate");
  const [preview, setPreview] = useState<PlanPreviewResult | null>(null);
  const [loading, startPreview] = useTransition();
  const reset = () => setPreview(null);
  function runPreview() {
    const fd = new FormData();
    fd.set("tenant_id", tenantId);
    fd.set("plan", plan);
    fd.set("timing", timing);
    fd.set("proration", proration);
    startPreview(async () => {
      try {
        setPreview(await previewAdminPlanChangeAction(fd));
      } catch {
        setPreview({ error: "Önizleme alınamadı; bağlantıyı kontrol edip tekrar deneyin." });
      }
    });
  }
  const p = preview?.preview;
  return (
    <OpDialog
      tenantId={tenantId}
      action={applyAdminPlanChange}
      trigger={smallBtn("Paket değiştir", Repeat)}
      title="Paket değiştir"
      description="Önce önizleyin: kıst tutar ve fatura satırı onaydan önce görünür."
      icon={<Repeat />}
      submitLabel={p?.kind === "schedule" ? "Dönem sonuna planla" : p && p.invoiceNetTry > 0 ? "Onayla ve faturalandır" : "Onayla"}
      hidden={{ plan, timing, proration, confirm_net_try: p ? String(p.invoiceNetTry) : "", quoted_at_ms: p ? String(p.quotedAtMs) : "" }}
      submitDisabled={!p}
      onDone={onDone}
      size="md"
    >
      <FormField label="Yeni paket" htmlFor="ops-plan">
        <FormSelect
          id="ops-plan"
          value={plan}
          onChange={(e) => {
            setPlan(e.target.value);
            reset();
          }}
        >
          {others.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name} — {money(o.monthlyTry, "/ay")}
            </option>
          ))}
        </FormSelect>
      </FormField>
      <div className="grid gap-3 sm:grid-cols-2">
        <fieldset className="grid gap-1.5">
          <legend className="mb-1 text-sm font-medium text-ink-950">Ne zaman?</legend>
          {(
            [
              ["now", "Hemen"],
              ["period_end", "Dönem sonunda"],
            ] as const
          ).map(([v, l]) => (
            <label key={v} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                checked={timing === v}
                onChange={() => {
                  setTiming(v);
                  reset();
                }}
              />
              {l}
            </label>
          ))}
        </fieldset>
        <fieldset className="grid gap-1.5" disabled={timing === "period_end"}>
          <legend className="mb-1 text-sm font-medium text-ink-950">Kıst fark</legend>
          {(
            [
              ["prorate", "Kıst hesapla"],
              ["none", "Hesaplama (faturasız)"],
            ] as const
          ).map(([v, l]) => (
            <label key={v} className={cn("flex items-center gap-2 text-sm", timing === "period_end" && "opacity-50")}>
              <input
                type="radio"
                checked={proration === v}
                onChange={() => {
                  setProration(v);
                  reset();
                }}
              />
              {l}
            </label>
          ))}
        </fieldset>
      </div>
      <div>
        <Button variant="outline" size="sm" type="button" onClick={runPreview} disabled={loading}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Gauge className="h-3.5 w-3.5" />} Önizle
        </Button>
      </div>
      {preview?.error ? <PreviewBox tone="warn">{preview.error}</PreviewBox> : null}
      {p ? (
        <PreviewBox>
          <p className="font-semibold">{p.message}</p>
          {p.evaluation && p.evaluation.ratio > 0 ? (
            <p className="text-text-muted">
              Kalan dönem %{Math.round(p.evaluation.ratio * 100)} · mevcut dönem tutarı {money(p.evaluation.fromPeriodTry)} · yeni{" "}
              {money(p.evaluation.toPeriodTry)}
            </p>
          ) : null}
          {p.invoiceNetTry > 0 ? (
            <p>
              Fatura satırı: <span className="font-bold">{money(p.invoiceNetTry)}</span> + KDV {money(p.taxTry)} ={" "}
              <span className="font-bold">{money(p.totalTry)}</span> (açık fatura; Faturalama ekranından tahsil edilir)
            </p>
          ) : (
            <p className="text-text-muted">Fatura kesilmez.</p>
          )}
          {p.priceLockNote ? <p className="font-semibold text-amber-700">{p.priceLockNote}</p> : null}
        </PreviewBox>
      ) : null}
    </OpDialog>
  );
}

function DealCard({ tenantId, data, todayKey, onDone }: CardProps & { todayKey: string }) {
  const { sub, schema } = data;
  return (
    <Card
      title="Özel anlaşma"
      icon={Handshake}
      actions={
        <OpDialog
          tenantId={tenantId}
          action={saveSubscriptionDeal}
          trigger={smallBtn("Düzenle", Handshake)}
          title="Özel anlaşma"
          description="Boş bırakılan alan kilidi/taahhüdü kaldırır. Fiyat kilidi liste fiyatını aşamaz."
          icon={<Handshake />}
          submitLabel="Kaydet"
          onDone={onDone}
        >
          <FormField label="Paket fiyat kilidi (₺/ay, KDV hariç)" htmlFor="ops-deal-lock" hint="Kayıtlı aylık tutar da buna göre güncellenir.">
            <FormInput id="ops-deal-lock" name="price_lock_try" inputMode="decimal" defaultValue={sub.priceLockTry ?? ""} placeholder="ör. 1990" />
          </FormField>
          <FormField label="Ek koltuk taban fiyat kilidi (₺/ay)" htmlFor="ops-deal-seat">
            <FormInput id="ops-deal-seat" name="seat_base_try" inputMode="decimal" defaultValue={sub.seatBaseLockTry ?? ""} placeholder="liste fiyatı" />
          </FormField>
          <FormField
            label="Taahhüt bitişi"
            htmlFor="ops-deal-commit"
            hint={schema.opsColumns ? "Bilgi amaçlıdır; otomatik işlem yapılmaz." : "Veritabanı hazırlığı bekleniyor; şimdilik kaydedilemez."}
          >
            <FormInput
              id="ops-deal-commit"
              name="commitment_end"
              type="date"
              min={todayKey}
              defaultValue={sub.commitmentEndIso ? sub.commitmentEndIso.slice(0, 10) : ""}
              disabled={!schema.opsColumns}
            />
          </FormField>
        </OpDialog>
      }
    >
      <dl className="grid gap-4 sm:grid-cols-3">
        <Fact
          label="Fiyat kilidi"
          value={sub.priceLockTry ? `${money(sub.priceLockTry, "/ay")}${sub.priceLockCampaign ? ` · ${sub.priceLockCampaign}` : ""}` : "Yok (liste fiyatı)"}
        />
        <Fact label="Koltuk taban kilidi" value={sub.seatBaseLockTry ? money(sub.seatBaseLockTry, "/ay") : "Yok"} />
        <Fact label="Taahhüt bitişi" value={day(sub.commitmentEndIso)} />
      </dl>
    </Card>
  );
}

function overrideState(o: OverrideView): { label: string; tone: string } {
  if (o.revokedAtMs != null) return { label: "Geri alındı", tone: "text-text-faint" };
  if (!o.active) return { label: "Süresi doldu", tone: "text-text-faint" };
  return { label: o.expiresAtMs != null ? `${formatDateTr(o.expiresAtMs)} tarihine kadar` : "Süresiz", tone: "text-mint-700" };
}

function OverridesCard({ tenantId, data, limits, todayKey, onDone }: CardProps & { limits: LimitView[]; todayKey: string }) {
  const { schema, overrides } = data;
  const [kind, setKind] = useState<"delta" | "value">("delta");
  return (
    <Card
      title="Limit istisnaları"
      icon={Users2}
      actions={
        schema.overrides ? (
          <OpDialog
            tenantId={tenantId}
            action={grantEntitlementOverride}
            trigger={smallBtn("İstisna ver", Plus)}
            title="Limit istisnası ver"
            description="Ofise özel +N ya da sabit limit; bitiş tarihinde kendiliğinden eski hâline döner."
            icon={<Plus />}
            submitLabel="İstisnayı ver"
            onDone={onDone}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="Limit" htmlFor="ops-ovr-key">
                <FormSelect id="ops-ovr-key" name="key" defaultValue="seats">
                  {ENTITLEMENT_KEYS.map((k) => (
                    <option key={k} value={k}>
                      {ENTITLEMENT_LABELS[k]}
                    </option>
                  ))}
                </FormSelect>
              </FormField>
              <FormField label="Biçim" htmlFor="ops-ovr-kind">
                <FormSelect id="ops-ovr-kind" name="kind" value={kind} onChange={(e) => setKind(e.target.value === "value" ? "value" : "delta")}>
                  <option value="delta">Plan limitine ekle (+N)</option>
                  <option value="value">Sabit değer (plan limiti yerine)</option>
                </FormSelect>
              </FormField>
              <FormField label={kind === "delta" ? "Artış (+N)" : "Yeni limit"} htmlFor="ops-ovr-amount" required>
                <FormInput id="ops-ovr-amount" name="amount" type="number" min={1} required defaultValue={kind === "delta" ? 5 : undefined} />
              </FormField>
              <FormField label="Bitiş tarihi" htmlFor="ops-ovr-exp" hint="Boş = süresiz">
                <FormInput id="ops-ovr-exp" name="expires" type="date" min={todayKey} />
              </FormField>
            </div>
          </OpDialog>
        ) : null
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[360px] text-sm">
          <thead>
            <tr className="text-left text-xs font-bold uppercase tracking-wide text-text-faint">
              <th className="pb-2">Limit</th>
              <th className="pb-2 text-right">Kullanım</th>
              <th className="pb-2 text-right">Plan</th>
              <th className="pb-2 text-right">Etkin</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {limits.map((l) => (
              <tr key={l.key}>
                <td className="py-1.5 font-semibold text-ink-950">{ENTITLEMENT_LABELS[l.key]}</td>
                <td className="py-1.5 text-right tabular-nums">{l.used}</td>
                <td className="py-1.5 text-right tabular-nums text-text-muted">{l.plan ?? "Sınırsız"}</td>
                <td className={cn("py-1.5 text-right font-bold tabular-nums", l.effective !== l.plan ? "text-brand-700" : "text-ink-950")}>
                  {l.effective ?? "Sınırsız"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!schema.overrides ? (
        <p className="text-xs text-text-muted">Limit istisnası tablosu bu ortamda henüz kurulmadı (20261013004000).</p>
      ) : overrides.length === 0 ? (
        <p className="text-xs text-text-muted">Bu ofise verilmiş istisna yok; limitler pakettekiyle aynı.</p>
      ) : (
        <ul className="divide-y divide-line rounded-[var(--radius-card)] border border-line">
          {overrides.map((o) => {
            const st = overrideState(o);
            const active = o.active;
            return (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <div className="min-w-0">
                  <p className={cn("text-sm font-semibold", active ? "text-ink-950" : "text-text-faint line-through")}>{describeOverride(o)}</p>
                  <p className="text-xs text-text-muted">
                    <span className={st.tone}>{st.label}</span> · {o.reason}
                    {o.createdBy ? ` · ${o.createdBy}` : ""}
                    {o.revokeReason ? ` · geri alma: ${o.revokeReason}` : ""}
                  </p>
                </div>
                {active ? (
                  <OpDialog
                    tenantId={tenantId}
                    action={revokeEntitlementOverride}
                    trigger={
                      <Button variant="ghost" size="xs" type="button">
                        <Undo2 className="h-3.5 w-3.5" /> Geri al
                      </Button>
                    }
                    title="İstisnayı geri al"
                    description={`${describeOverride(o)} — limit hemen plan değerine döner (mevcut kayıtlar silinmez).`}
                    icon={<Undo2 />}
                    tone="danger"
                    submitLabel="Geri al"
                    hidden={{ override_id: o.id }}
                    onDone={onDone}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Ek koltuk (Koltuk bilgisi kartından açılır)
// ---------------------------------------------------------------------------

export function SeatChangeDialog({ tenantId, currentExtra }: { tenantId: string; currentExtra: number }) {
  const router = useRouter();
  const [target, setTarget] = useState(String(currentExtra));
  const [billing, setBilling] = useState<"invoice" | "free">("invoice");
  const [preview, setPreview] = useState<SeatPreviewResult | null>(null);
  const [loading, startPreview] = useTransition();
  function runPreview() {
    const fd = new FormData();
    fd.set("tenant_id", tenantId);
    fd.set("extra_seats", target);
    startPreview(async () => {
      try {
        setPreview(await previewAdminSeatChange(fd));
      } catch {
        setPreview({ error: "Önizleme alınamadı; tekrar deneyin." });
      }
    });
  }
  const p = preview?.preview;
  const net = p && billing === "invoice" ? p.chargeNetTry : 0;
  return (
    <OpDialog
      tenantId={tenantId}
      action={applyAdminSeatChange}
      trigger={smallBtn("Ek koltuk", Users2)}
      title="Ek koltuk (extra_seats)"
      description="Satın alınmış ek kullanıcı sayısını değiştirir; artışta kıst fark faturalandırılabilir."
      icon={<Users2 />}
      submitLabel={net > 0 ? "Onayla ve faturalandır" : "Onayla"}
      hidden={{ extra_seats: target, billing, confirm_net_try: String(net), quoted_at_ms: p ? String(p.quotedAtMs) : "" }}
      submitDisabled={!p}
      onDone={() => router.refresh()}
    >
      <FormField label="Ek koltuk (toplam)" htmlFor="ops-seat-target" hint={`Şu an ${currentExtra}. 0-500.`}>
        <FormInput
          id="ops-seat-target"
          type="number"
          min={0}
          max={500}
          value={target}
          onChange={(e) => {
            setTarget(e.target.value);
            setPreview(null);
          }}
        />
      </FormField>
      <fieldset className="grid gap-1.5">
        <legend className="mb-1 text-sm font-medium text-ink-950">Artışta ücretlendirme</legend>
        {(
          [
            ["invoice", "Kıst fark faturası kes"],
            ["free", "Ücretsiz ver (fatura yok)"],
          ] as const
        ).map(([v, l]) => (
          <label key={v} className="flex items-center gap-2 text-sm">
            <input type="radio" checked={billing === v} onChange={() => setBilling(v)} /> {l}
          </label>
        ))}
      </fieldset>
      <div>
        <Button variant="outline" size="sm" type="button" onClick={runPreview} disabled={loading}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Gauge className="h-3.5 w-3.5" />} Önizle
        </Button>
      </div>
      {preview?.error ? <PreviewBox tone="warn">{preview.error}</PreviewBox> : null}
      {p ? (
        <PreviewBox tone={p.status === "increase" || p.status === "decrease" ? "info" : "warn"}>
          <p className="font-semibold">
            Toplam koltuk {p.fromTotal} → {p.toTotal}
          </p>
          <p>{p.message}</p>
          {net > 0 ? (
            <p>
              Fatura satırı: <span className="font-bold">{money(net)}</span> + KDV = <span className="font-bold">{money(p.totalTry)}</span>
            </p>
          ) : (
            <p className="text-text-muted">Fatura kesilmez.</p>
          )}
        </PreviewBox>
      ) : null}
    </OpDialog>
  );
}

// ---------------------------------------------------------------------------
// Otomatik yenilemeyi kapat (Ödeme profili panelinden). Açmak ofis sahibinin rızasını ister.
// ---------------------------------------------------------------------------

export function AutoRenewOffButton({ tenantId }: { tenantId: string }) {
  const router = useRouter();
  return (
    <OpDialog
      tenantId={tenantId}
      action={adminDisableAutoRenew}
      trigger={smallBtn("Otomatik yenilemeyi kapat", PowerOff)}
      title="Otomatik yenilemeyi kapat"
      description="Kayıtlı kartla otomatik tahsilat durur; kart silinmez. Yeniden açmak için ofis sahibinin rızası gerekir."
      icon={<PowerOff />}
      tone="danger"
      submitLabel="Kapat"
      onDone={() => router.refresh()}
    />
  );
}
