"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import {
  createPartner,
  createRewardRule,
  saveGrowthFlags,
  setPartnerStatus,
  setRewardRuleActive,
  type GrowthResult,
} from "@/app/actions/growth";

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

export function FlagsForm({ referral, partner }: { referral: boolean; partner: boolean }) {
  const f = useFormAction(saveGrowthFlags);
  return (
    <form onSubmit={f.onSubmit} className="space-y-3">
      <label className="flex items-center gap-2 text-sm text-ink-950">
        <input type="checkbox" name="referral_enabled" defaultChecked={referral} className="h-4 w-4" />
        Ofis davet programı açık (ofislerde davet bağlantısı üretilebilir)
      </label>
      <label className="flex items-center gap-2 text-sm text-ink-950">
        <input type="checkbox" name="partner_enabled" defaultChecked={partner} className="h-4 w-4" />
        Ortak (partner) bağlantıları açık
      </label>
      <p className="text-xs text-text-muted">Varsayılan kapalıdır. Kapalıyken davet/ortak atfı yazılmaz; yalnız kaynak etiketi (UTM) saklanır.</p>
      <div className="flex items-center gap-3">
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
        <select name="reward_type" required className={`${FIELD} mt-1`} defaultValue="fixed_try">
          <option value="fixed_try">Sabit tutar (TL kredi)</option>
          <option value="percent_of_payment">Ödemenin yüzdesi</option>
        </select>
      </label>
      <label className={LABEL}>
        Değer (TL veya %)
        <input name="reward_value" required inputMode="decimal" className={`${FIELD} mt-1`} />
      </label>
      <label className={LABEL}>
        Süre (ay, boş = tek sefer)
        <input name="duration_months" inputMode="numeric" className={`${FIELD} mt-1`} />
      </label>
      <label className={LABEL}>
        Bekleme günü (0-180)
        <input name="hold_days" required inputMode="numeric" className={`${FIELD} mt-1`} />
      </label>
      <label className={LABEL}>
        Aylık tavan (TL, boş = yok)
        <input name="monthly_cap_try" inputMode="decimal" className={`${FIELD} mt-1`} />
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
