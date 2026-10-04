"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  resetPlanDefinition,
  saveCampaignSettings,
  savePlanDefinition,
  type PlanOpResult,
} from "@/app/actions/platform-billing-plans";
import { planAmountOf, type PlanDef } from "@/lib/billing/plans";
import { opFieldClass } from "../inline-op";
import { useSeatDraft } from "./seat-draft";
import { SeatTierEditor } from "./seat-tier-editor";

const lbl = "block text-xs font-semibold text-text-muted";
const num = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));
const tl = (n: number) => `${n.toLocaleString("tr-TR")} ₺`;

function useOp() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  function run(fn: () => Promise<PlanOpResult>) {
    if (pending) return;
    setMsg(null);
    start(async () => {
      const r = await fn();
      setMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: r.notice ?? "Kaydedildi." });
      if (!r.error) router.refresh();
    });
  }
  return { pending, msg, run };
}

function Msg({ msg }: { msg: { ok: boolean; text: string } | null }) {
  if (!msg) return null;
  return (
    <p role={msg.ok ? "status" : "alert"} className={`text-xs font-semibold ${msg.ok ? "text-mint-700" : "text-danger-600"}`}>
      {msg.text}
    </p>
  );
}

export function PlanEditor({
  plan,
  customized,
  subscribers,
  businessReady,
  plans,
}: {
  plan: PlanDef;
  /** Katalogun tamamı: kademe doğrulaması ve çapraz nokta uyarıları için. */
  plans: PlanDef[];
  customized: boolean;
  subscribers: number;
  businessReady: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { pending, msg, run } = useOp();
  const yearly = planAmountOf(plan, "yearly");
  const draft = useSeatDraft(plan, plans);

  return (
    <section className="rounded-[var(--radius-panel)] border border-line bg-surface">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="focus-ring flex w-full flex-wrap items-center justify-between gap-3 px-5 py-4 text-left"
      >
        <span>
          <span className="font-display text-base font-bold text-ink-950">{plan.name}</span>
          <span className="ml-2 font-mono text-xs text-text-faint">{plan.id}</span>
          {plan.hidden ? <span className="ml-2 rounded-full bg-warn-500/10 px-2 py-0.5 text-xs font-bold text-warn-600">Gizli</span> : null}
          {plan.popular ? <span className="ml-2 rounded-full bg-brand-600/10 px-2 py-0.5 text-xs font-bold text-brand-600">Öne çıkan</span> : null}
          {customized ? <span className="ml-2 rounded-full bg-amber-400/15 px-2 py-0.5 text-xs font-bold text-amber-600">Düzenlenmiş</span> : null}
        </span>
        <span className="text-xs text-text-muted">
          {plan.customPricing ? "Özel teklif" : `${tl(plan.monthlyTry)} / ay · yıllık ${tl(yearly)}`} · {subscribers} abonelik
        </span>
      </button>

      {open ? (
        <form
          className="space-y-4 border-t border-line px-5 py-4"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            run(() => savePlanDefinition(fd));
          }}
        >
          <input type="hidden" name="plan_id" value={plan.id} />
          <div className="grid gap-3 sm:grid-cols-3">
            <label className={lbl}>Ad<input name="name" required maxLength={40} defaultValue={plan.name} className={`mt-1 w-full ${opFieldClass}`} /></label>
            <label className={lbl}>Üst etiket<input name="eyebrow" required maxLength={30} defaultValue={plan.eyebrow} className={`mt-1 w-full ${opFieldClass}`} /></label>
            <label className={lbl}>Kısa açıklama<input name="blurb" required maxLength={80} defaultValue={plan.blurb} className={`mt-1 w-full ${opFieldClass}`} /></label>
          </div>

          <fieldset className="grid gap-3 sm:grid-cols-4">
            <legend className="mb-2 text-xs font-bold uppercase tracking-wide text-text-faint">Fiyat (KDV hariç, TRY)</legend>
            <label className={lbl}>Aylık fiyat<input name="monthly_try" required inputMode="numeric" value={draft.price} onChange={(e) => draft.setPrice(e.target.value)} className={`mt-1 w-full ${opFieldClass}`} /></label>
            <label className={lbl}>Yıllıkta ödenen ay<input name="yearly_paid_months" required inputMode="numeric" defaultValue={plan.yearlyPaidMonths ?? 10} className={`mt-1 w-full ${opFieldClass}`} /></label>
            <label className={lbl}>Ek kullanıcı (tek fiyat, aylık)<input name="extra_seat_monthly_try" inputMode="numeric" value={draft.extraPrice} onChange={(e) => draft.setExtraPrice(e.target.value)} placeholder="yok" className={`mt-1 w-full ${opFieldClass}`} /></label>
            <label className={lbl}>Kampanya fiyatı (aylık)<input name="campaign_monthly_try" inputMode="numeric" defaultValue={num(plan.campaignMonthlyTry)} placeholder="yok" className={`mt-1 w-full ${opFieldClass}`} /></label>
          </fieldset>

          <input type="hidden" name="seat_tiers_json" value={draft.tiersJson} />
          <input type="hidden" name="max_seats" value={draft.maxSeats} />
          <input type="hidden" name="seat_rounding" value={draft.rounding} />
          <SeatTierEditor plan={plan} draft={draft} />

          <fieldset className="grid gap-3 sm:grid-cols-4">
            <legend className="mb-2 text-xs font-bold uppercase tracking-wide text-text-faint">Limitler (kota tablosuyla senkron)</legend>
            <label className={lbl}>Kullanıcı<input name="seats" required inputMode="numeric" defaultValue={plan.limits.seats} className={`mt-1 w-full ${opFieldClass}`} /></label>
            <label className={lbl}>Müşteri<input name="customers" inputMode="numeric" defaultValue={num(plan.limits.customers)} placeholder="sınırsız" className={`mt-1 w-full ${opFieldClass}`} /></label>
            <label className={lbl}>Aktif portföy<input name="active_properties" inputMode="numeric" defaultValue={num(plan.limits.activeProperties)} placeholder="sınırsız" className={`mt-1 w-full ${opFieldClass}`} /></label>
            <label className={lbl}>Şube<input name="branches" inputMode="numeric" defaultValue={num(plan.limits.branches)} placeholder="sınırsız" className={`mt-1 w-full ${opFieldClass}`} /></label>
          </fieldset>

          <fieldset className="grid gap-3 sm:grid-cols-3">
            <legend className="mb-2 text-xs font-bold uppercase tracking-wide text-text-faint">Aylık kotalar (ölçüm ayrı pakette gelir)</legend>
            <label className={lbl}>AI kredisi<input name="ai_credits_monthly" inputMode="numeric" defaultValue={num(plan.aiCreditsMonthly)} placeholder="tanımsız" className={`mt-1 w-full ${opFieldClass}`} /></label>
            <label className={lbl}>Değerleme raporu<input name="valuation_reports_monthly" inputMode="numeric" defaultValue={num(plan.valuationReportsMonthly)} placeholder="tanımsız" className={`mt-1 w-full ${opFieldClass}`} /></label>
            <label className={lbl}>Sıra<input name="order" inputMode="numeric" defaultValue={num(plan.order)} placeholder="otomatik" className={`mt-1 w-full ${opFieldClass}`} /></label>
          </fieldset>

          <label className={lbl}>
            Özellik listesi (her satır bir madde; yalnız bugün çalışan özellikler)
            <textarea name="features" required rows={6} defaultValue={plan.features.join("\n")} className={`mt-1 w-full ${opFieldClass}`} />
          </label>

          <div className="flex flex-wrap gap-4 text-xs font-semibold text-text-muted">
            <label className="inline-flex items-center gap-2"><input type="checkbox" name="popular" defaultChecked={Boolean(plan.popular)} /> Öne çıkan</label>
            <label className="inline-flex items-center gap-2"><input type="checkbox" name="custom_pricing" defaultChecked={Boolean(plan.customPricing)} /> Özel fiyat (&quot;Bize ulaşın&quot;)</label>
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" name="hidden" defaultChecked={Boolean(plan.hidden)} /> Gizli (kayıt ve fiyat sayfasında görünmez)
            </label>
          </div>
          {plan.id === "business" && !businessReady ? (
            <p className="text-xs text-warn-600">Business paketi, 20260817000210 migration&apos;ı ve ödeme RPC güncellemesi uygulanana kadar gizli kalır.</p>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={pending || draft.report.errors.length > 0} className="focus-ring press min-h-9 rounded-[var(--radius-control)] bg-ink-950 px-4 py-2 text-xs font-bold text-white disabled:opacity-60">
              {pending ? "Kaydediliyor…" : "Paketi kaydet"}
            </button>
            {customized ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  const fd = new FormData();
                  fd.set("plan_id", plan.id);
                  run(() => resetPlanDefinition(fd));
                }}
                className="focus-ring press min-h-9 rounded-[var(--radius-control)] border border-line px-3 py-2 text-xs font-semibold text-text-muted hover:text-ink-950 disabled:opacity-60"
              >
                Varsayılana dön
              </button>
            ) : null}
            <Msg msg={msg} />
          </div>
        </form>
      ) : msg ? (
        <div className="px-5 pb-4"><Msg msg={msg} /></div>
      ) : null}
    </section>
  );
}

export function CampaignForm({
  campaign,
  trialDays,
  founders,
  trialEffective,
  priceLockReady,
}: {
  campaign: { name: string; quota: number; active: boolean; lockPrice: boolean };
  trialDays: number;
  founders: { available: boolean; taken: number; remaining: number };
  trialEffective: boolean;
  priceLockReady: boolean;
}) {
  const { pending, msg, run } = useOp();
  return (
    <form
      className="space-y-3 rounded-[var(--radius-panel)] border border-line bg-surface p-5"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        run(() => saveCampaignSettings(fd));
      }}
    >
      <h2 className="font-display font-bold text-ink-950">Kampanya ve deneme süresi</h2>
      <div className="grid gap-3 sm:grid-cols-4">
        <label className={lbl}>Kampanya adı<input name="name" required maxLength={60} defaultValue={campaign.name} className={`mt-1 w-full ${opFieldClass}`} /></label>
        <label className={lbl}>Kota (ilk N müşteri)<input name="quota" required inputMode="numeric" defaultValue={campaign.quota} className={`mt-1 w-full ${opFieldClass}`} /></label>
        <label className={lbl}>Deneme süresi (gün)<input name="trial_days" required inputMode="numeric" defaultValue={trialDays} className={`mt-1 w-full ${opFieldClass}`} /></label>
        <div className="space-y-1 pt-5 text-xs font-semibold text-text-muted">
          <label className="flex items-center gap-2"><input type="checkbox" name="active" defaultChecked={campaign.active} disabled={!priceLockReady} /> Kampanya aktif</label>
          <label className="flex items-center gap-2"><input type="checkbox" name="lock_price" defaultChecked={campaign.lockPrice} /> Fiyat abonelik sürdükçe korunur</label>
        </div>
      </div>
      {founders.available ? (
        <p className="text-xs text-text-muted">
          Gerçek sayım: <strong className="text-ink-950">{founders.taken}</strong> abonelik kampanya fiyatıyla başladı, kalan hak <strong className="text-ink-950">{founders.remaining}</strong>.
        </p>
      ) : (
        <p className="text-xs text-warn-600">Kampanya gizli: kilitli fiyat şeması (20260817000220) henüz uygulanmadı; sayaç ve uygulama kapalı.</p>
      )}
      {!trialEffective ? (
        <p className="text-xs text-warn-600">Deneme günü, 20260816010100 migration&apos;ı uygulanana kadar fiilen 14 gündür; sitedeki metinler gerçekte verilen süreyi söyler.</p>
      ) : null}
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className="focus-ring press min-h-9 rounded-[var(--radius-control)] bg-ink-950 px-4 py-2 text-xs font-bold text-white disabled:opacity-60">
          {pending ? "Kaydediliyor…" : "Kaydet"}
        </button>
        <Msg msg={msg} />
      </div>
    </form>
  );
}
