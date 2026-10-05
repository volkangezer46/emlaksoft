"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import {
  createPartner,
  createPartnerPayout,
  createRewardRule,
  decideClaim,
  saveGrowthFlags,
  saveReferralSettings,
  setPartnerStatus,
  setRewardRuleActive,
  updatePartnerDetails,
  type GrowthResult,
} from "@/app/actions/growth";
import type { SettingsKey } from "@/lib/growth/engine";

const FIELD =
  "w-full rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2 text-sm text-ink-950 outline-none transition focus:border-brand-400 focus:ring-4 focus:ring-brand-600/10";
const LABEL = "block text-xs font-semibold text-text-muted";
const PRIMARY =
  "focus-ring press inline-flex min-h-[40px] items-center gap-2 rounded-[var(--radius-control)] bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60";
const SMALL =
  "focus-ring press inline-flex min-h-[32px] items-center rounded-[var(--radius-control)] border border-hairline bg-surface px-2.5 py-1 text-xs font-semibold text-ink-950 transition hover:bg-canvas disabled:opacity-60";

function useFormAction(action: (fd: FormData) => Promise<GrowthResult>, resetOnOk = false) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    start(async () => {
      const r = await action(fd);
      if (r.error) setMsg({ ok: false, text: r.error });
      else {
        setMsg({ ok: true, text: "Kaydedildi." });
        if (resetOnOk) form.reset();
        router.refresh();
      }
    });
  }
  return { pending, msg, onSubmit };
}

function Msg({ msg }: { msg: { ok: boolean; text: string } | null }) {
  if (!msg) return null;
  return (
    <p role={msg.ok ? "status" : "alert"} className={`text-xs font-semibold ${msg.ok ? "text-mint-600" : "text-danger-500"}`}>
      {msg.text}
    </p>
  );
}

export function FlagsForm({ referral, partner, cash }: { referral: boolean; partner: boolean; cash: boolean }) {
  const f = useFormAction(saveGrowthFlags);
  return (
    <form onSubmit={f.onSubmit} className="space-y-3">
      <label className="flex items-center gap-2 text-sm text-ink-950">
        <input type="checkbox" name="referral_enabled" defaultChecked={referral} className="h-4 w-4" />
        Müşteri-getir-müşteri (ofis davet programı) açık
      </label>
      <label className="flex items-center gap-2 text-sm text-ink-950">
        <input type="checkbox" name="partner_enabled" defaultChecked={partner} className="h-4 w-4" />
        Profesyonel ortak programı açık (komisyon üretimi)
      </label>
      <label className="flex items-center gap-2 text-sm text-ink-950">
        <input type="checkbox" name="cash_payout_enabled" defaultChecked={cash} className="h-4 w-4" />
        Nakit ortak ödemesi açık (ayrı bayrak; yalnız vergi mükellefine, fatura karşılığı dış ödeme kaydı)
      </label>
      <p className="text-xs text-text-muted">
        Hepsi varsayılan kapalıdır. Kapalıdan açığa geçişte yukarıdaki hazırlık kontrolü zorunludur; engelleyici madde varsa program açılmaz.
        Kapalıyken davet/ortak atfı yazılmaz, talep/komisyon üretilmez, ödeme yapılmaz.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={f.pending} className={PRIMARY}>
          {f.pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          Kaydet
        </button>
        <Msg msg={f.msg} />
      </div>
    </form>
  );
}

export function RuleForm() {
  const f = useFormAction(createRewardRule, true);
  return (
    <form onSubmit={f.onSubmit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <label className={LABEL}>
        Kural adı
        <input name="name" required maxLength={80} className={`${FIELD} mt-1`} />
      </label>
      <label className={LABEL}>
        Tür
        <select name="kind" required className={`${FIELD} mt-1`} defaultValue="referral">
          <option value="referral">Ofis daveti</option>
          <option value="partner">Ortak</option>
        </select>
      </label>
      <label className={LABEL}>
        Ödül tipi
        <select name="reward_type" required className={`${FIELD} mt-1`} defaultValue="monthly_multiple">
          <option value="monthly_multiple">Paket aylık bedelinin katı (davet için önerilen)</option>
          <option value="fixed_try">Sabit tutar (TL kredi)</option>
          <option value="percent_of_payment">Ödemenin yüzdesi</option>
        </select>
      </label>
      <label className={LABEL}>
        Değer (kat sayısı, TL veya %)
        <input name="reward_value" required inputMode="decimal" className={`${FIELD} mt-1`} />
      </label>
      <label className={LABEL}>
        Süre (ay, boş = tek sefer)
        <input name="duration_months" inputMode="numeric" className={`${FIELD} mt-1`} />
      </label>
      <label className={LABEL}>
        Bekleme günü (0-180; iade/iptal bekleme süresi)
        <input name="hold_days" required inputMode="numeric" className={`${FIELD} mt-1`} />
      </label>
      <label className={LABEL}>
        Aylık tavan (TL, boş = yok)
        <input name="monthly_cap_try" inputMode="decimal" className={`${FIELD} mt-1`} />
      </label>
      <label className={LABEL}>
        Kredi vadesi (gün, boş = vadesiz)
        <input name="credit_expires_days" inputMode="numeric" className={`${FIELD} mt-1`} />
      </label>
      <label className="flex items-center gap-2 self-end pb-2 text-sm text-ink-950">
        <input type="checkbox" name="is_active" className="h-4 w-4" />
        Hemen aktif
      </label>
      <div className="flex items-end gap-3">
        <button type="submit" disabled={f.pending} className={PRIMARY}>
          {f.pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          Kural ekle
        </button>
        <Msg msg={f.msg} />
      </div>
    </form>
  );
}

export function RuleToggle({ id, active }: { id: string; active: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        className={SMALL}
        onClick={() =>
          start(async () => {
            const r = await setRewardRuleActive(id, !active);
            if (r.error) setErr(r.error);
            else router.refresh();
          })
        }
      >
        {active ? "Kapat" : "Aç"}
      </button>
      {err ? <span className="text-xs text-danger-500">{err}</span> : null}
    </span>
  );
}

export function PartnerForm() {
  const f = useFormAction(createPartner, true);
  return (
    <form onSubmit={f.onSubmit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <label className={LABEL}>
        Ortak adı
        <input name="name" required maxLength={80} className={`${FIELD} mt-1`} />
      </label>
      <label className={LABEL}>
        Tür
        <select name="partner_type" required className={`${FIELD} mt-1`} defaultValue="trainer">
          <option value="trainer">Eğitmen</option>
          <option value="agency">Ajans</option>
          <option value="accountant">Mali müşavir</option>
          <option value="creator">İçerik üreticisi</option>
          <option value="institution">Kurum</option>
          <option value="other">Diğer</option>
        </select>
      </label>
      <label className={LABEL}>
        Kod (/p/kod)
        <input name="code" required maxLength={40} pattern="[a-z0-9][a-z0-9\-]{2,39}" className={`${FIELD} mt-1`} />
      </label>
      <div className="flex items-end gap-3">
        <button type="submit" disabled={f.pending} className={PRIMARY}>
          {f.pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          Ortak ekle
        </button>
        <Msg msg={f.msg} />
      </div>
    </form>
  );
}

const STATUS_LABEL: Record<string, string> = { draft: "Taslak", active: "Aktif", suspended: "Askıda", ended: "Bitti" };

export function PartnerStatus({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <select
        aria-label="Ortak durumu"
        defaultValue={status}
        disabled={pending}
        className={`${FIELD} !w-auto !py-1 text-xs`}
        onChange={(e) =>
          start(async () => {
            const r = await setPartnerStatus(id, e.target.value);
            if (r.error) setErr(r.error);
            else router.refresh();
          })
        }
      >
        {Object.entries(STATUS_LABEL).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </select>
      {err ? <span className="text-xs text-danger-500">{err}</span> : null}
    </span>
  );
}

/* ------------------------------------------------------------------ inceleme kuyruğu ------------------------------------------------------------------ */

/** Talep kararı: neden zorunlu (en az 3 karakter); yalnız uygun durumdaki düğmeler görünür. */
export function ClaimActions({ id, status, flags }: { id: string; status: string; flags: string[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const canApprove = status === "pending" && !flags.includes("same_tenant");
  const canReject = status === "pending" || status === "held" || status === "approved";
  const canReverse = status === "paid" || status === "approved";
  if (!canApprove && !canReject && !canReverse) return <span className="text-xs text-text-muted">-</span>;

  function decide(decision: "approve" | "reject" | "reverse") {
    start(async () => {
      const r = await decideClaim(id, decision, reason);
      if (r.error) setMsg({ ok: false, text: r.error });
      else {
        setMsg({ ok: true, text: "Karar kaydedildi." });
        setReason("");
        router.refresh();
      }
    });
  }

  return (
    <div className="flex min-w-[200px] flex-col gap-1.5">
      <input
        aria-label="Karar nedeni"
        placeholder="Neden (zorunlu)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={300}
        className={`${FIELD} !py-1 text-xs`}
      />
      <div className="flex flex-wrap gap-1.5">
        {canApprove ? (
          <button type="button" disabled={pending} className={SMALL} onClick={() => decide("approve")}>
            Onayla
          </button>
        ) : null}
        {canReject ? (
          <button type="button" disabled={pending} className={SMALL} onClick={() => decide("reject")}>
            Reddet
          </button>
        ) : null}
        {canReverse ? (
          <button type="button" disabled={pending} className={SMALL} onClick={() => decide("reverse")}>
            Geri al
          </button>
        ) : null}
      </div>
      <Msg msg={msg} />
    </div>
  );
}

/* ------------------------------------------------------------------ ayarlar ------------------------------------------------------------------ */

type SettingField = { key: SettingsKey; label: string; hint?: string; text?: boolean };
const SETTING_GROUPS: { title: string; fields: SettingField[] }[] = [
  {
    title: "Davet edilen (hoş geldin)",
    fields: [
      { key: "welcome_credit_try", label: "Hoş geldin kredisi (TL, 0 = kapalı)" },
      { key: "welcome_expires_days", label: "Hoş geldin kredisi vadesi (gün)" },
    ],
  },
  {
    title: "Davetçi kademeleri ve tavan",
    fields: [
      { key: "tier1_at", label: "1. kademe: başarılı davet sayısı" },
      { key: "tier1_bonus_months", label: "1. kademe bonusu (aylık bedel katı)" },
      { key: "tier1_badge", label: "1. kademe rozet adı", text: true },
      { key: "tier2_at", label: "2. kademe: başarılı davet sayısı" },
      { key: "tier2_bonus_months", label: "2. kademe bonusu (aylık bedel katı)" },
      { key: "tier2_badge", label: "2. kademe rozet adı", text: true },
      { key: "annual_cap_months", label: "Yıllık tavan (aylık bedel katı)" },
      { key: "velocity_max_per_day", label: "Hız sınırı: davetçi başına günlük talep" },
    ],
  },
  {
    title: "Ortak komisyon kademeleri (Faz 2)",
    fields: [
      { key: "partner_tier1_max", label: "1. kademe üst sınır (aktif müşteri)" },
      { key: "partner_tier1_pct", label: "1. kademe komisyon %" },
      { key: "partner_tier2_max", label: "2. kademe üst sınır (aktif müşteri)" },
      { key: "partner_tier2_pct", label: "2. kademe komisyon %" },
      { key: "partner_tier3_pct", label: "3. kademe komisyon %" },
      { key: "partner_duration_months", label: "Yinelenen komisyon süresi (ay)" },
      { key: "partner_min_payout_try", label: "Minimum ödeme eşiği (TL)" },
    ],
  },
];

export function SettingsForm({ values }: { values: Record<string, string | number> }) {
  const f = useFormAction(saveReferralSettings);
  return (
    <form onSubmit={f.onSubmit} className="space-y-4">
      {SETTING_GROUPS.map((g) => (
        <fieldset key={g.title} className="space-y-2">
          <legend className="text-xs font-bold text-ink-950">{g.title}</legend>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {g.fields.map((fld) => (
              <label key={fld.key} className={LABEL}>
                {fld.label}
                <input
                  name={fld.key}
                  defaultValue={String(values[fld.key] ?? "")}
                  inputMode={fld.text ? "text" : "decimal"}
                  maxLength={fld.text ? 40 : 12}
                  className={`${FIELD} mt-1`}
                />
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      <div className="flex items-center gap-3">
        <button type="submit" disabled={f.pending} className={PRIMARY}>
          {f.pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          Ayarları kaydet
        </button>
        <Msg msg={f.msg} />
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ ortak: vergi/ofis/kural + ödeme ------------------------------------------------------------------ */

export function PartnerDetailsForm({
  partnerId,
  isTaxPayer,
  ownerTenantId,
  ruleId,
  partnerRules,
}: {
  partnerId: string;
  isTaxPayer: boolean;
  ownerTenantId: string | null;
  ruleId: string | null;
  partnerRules: { id: string; name: string }[];
}) {
  const f = useFormAction((fd) => updatePartnerDetails(partnerId, fd));
  return (
    <form onSubmit={f.onSubmit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <label className="flex items-center gap-2 self-end pb-2 text-sm text-ink-950">
        <input type="checkbox" name="is_tax_payer" defaultChecked={isTaxPayer} className="h-4 w-4" />
        Vergi mükellefi
      </label>
      <label className={LABEL}>
        Vergi/TC no (10-11 hane; kayıtta saklanır, günlüğe yazılmaz)
        <input name="tax_no" inputMode="numeric" maxLength={11} placeholder="değiştirmek için girin" className={`${FIELD} mt-1`} />
      </label>
      <label className={LABEL}>
        Bağlı ofis kimliği (panel/hesap kredisi)
        <input name="owner_tenant_id" defaultValue={ownerTenantId ?? ""} maxLength={36} className={`${FIELD} mt-1 font-mono text-xs`} />
      </label>
      <label className={LABEL}>
        Komisyon kuralı
        <select name="rule_id" defaultValue={ruleId ?? ""} className={`${FIELD} mt-1`}>
          <option value="">Seçilmedi</option>
          {partnerRules.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </label>
      <label className={LABEL}>
        Sözleşme tarihi
        <input type="date" name="contract_signed_at" className={`${FIELD} mt-1`} />
      </label>
      <div className="flex items-end gap-3 sm:col-span-2 lg:col-span-5">
        <button type="submit" disabled={f.pending} className={SMALL}>
          {f.pending ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : null}
          Ortak bilgilerini kaydet
        </button>
        <Msg msg={f.msg} />
      </div>
    </form>
  );
}

export function PayoutForm({ partnerId, cashEnabled }: { partnerId: string; cashEnabled: boolean }) {
  const f = useFormAction((fd) => createPartnerPayout(partnerId, fd), true);
  return (
    <form onSubmit={f.onSubmit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <label className={LABEL}>
        Yöntem
        <select name="method" defaultValue="account_credit" className={`${FIELD} mt-1`}>
          <option value="account_credit">Hesap kredisi</option>
          <option value="bank_transfer_external" disabled={!cashEnabled}>
            Dış ödeme (fatura karşılığı){cashEnabled ? "" : " — nakit bayrağı kapalı"}
          </option>
        </select>
      </label>
      <label className={LABEL}>
        Fatura/belge no (dış ödemede zorunlu)
        <input name="document_no" maxLength={80} className={`${FIELD} mt-1`} />
      </label>
      <label className={LABEL}>
        Ödeme tarihi (dış ödemede zorunlu)
        <input type="date" name="paid_at" className={`${FIELD} mt-1`} />
      </label>
      <label className={LABEL}>
        Not
        <input name="note" maxLength={300} className={`${FIELD} mt-1`} />
      </label>
      <div className="flex items-end gap-3">
        <button type="submit" disabled={f.pending} className={SMALL}>
          {f.pending ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : null}
          Ödeme oluştur
        </button>
        <Msg msg={f.msg} />
      </div>
    </form>
  );
}
