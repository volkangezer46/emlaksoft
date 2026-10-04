"use client";

import Link from "next/link";
import { useActionState } from "react";
import { CheckCircle2 } from "lucide-react";
import { saveOversightSettings, type OversightResult } from "@/app/actions/oversight";
import { Switch } from "@/components/ui/switch";
import {
  ALERT_RULE_IDS,
  ALERT_RULE_META,
  APPROVAL_ACTION_META,
  APPROVAL_ACTION_TYPES,
  THRESHOLD_LIMITS,
  type AlertRuleId,
  type ApprovalRules,
  type OversightThresholds,
  type ThresholdNumField,
} from "@/lib/oversight/settings";

/** Kural basina duzenlenebilir esik alanlari (etiket + birim). */
const RULE_FIELDS: Partial<Record<AlertRuleId, { field: ThresholdNumField; label: string }[]>> = {
  price_drop: [{ field: "priceDropPct", label: "Düşüş eşiği (%)" }],
  bulk_delete: [{ field: "bulkDeleteCount", label: "Günlük silme sayısı" }],
  bulk_export: [
    { field: "bulkExportRows", label: "Tek indirmede satır" },
    { field: "exportPerDay", label: "Günlük indirme sayısı" },
  ],
  reassign: [{ field: "reassignPerDay", label: "Günlük devir sayısı" }],
  after_hours: [
    { field: "afterHoursEvents", label: "Günlük işlem sayısı" },
    { field: "workStartHour", label: "Mesai başlangıcı (saat)" },
    { field: "workEndHour", label: "Mesai bitişi (saat)" },
  ],
  stale_listing: [{ field: "staleListingDays", label: "Hareketsiz gün" }],
  stale_customer: [{ field: "staleCustomerDays", label: "Hareketsiz gün" }],
  commission_cut: [{ field: "commissionCutPoints", label: "İndirim eşiği (puan)" }],
};

const INPUT =
  "w-28 rounded-[var(--radius-control)] border border-line bg-canvas px-2.5 py-1.5 text-sm tabular-nums outline-none focus:border-brand-400 disabled:opacity-60";

export function OversightSettingsForm({
  thresholds,
  approvalRules,
  canEdit,
  storeAvailable,
}: {
  thresholds: OversightThresholds;
  approvalRules: ApprovalRules;
  canEdit: boolean;
  storeAvailable: boolean;
}) {
  const [state, action, pending] = useActionState<OversightResult, FormData>(saveOversightSettings, {});
  const locked = !canEdit || pending;

  return (
    <form action={action} className="space-y-8">
      <section aria-labelledby="alert-rules" className="space-y-3">
        <div>
          <h2 id="alert-rules" className="font-display text-lg font-bold text-ink-950">
            Uyarı kuralları
          </h2>
          <p className="text-sm text-text-muted">Kapalı kural uyarı üretmez. Eşikler ofisinizin çalışma düzenine göre ayarlanır.</p>
        </div>
        <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface">
          {ALERT_RULE_IDS.map((id) => {
            const meta = ALERT_RULE_META[id];
            const fields = RULE_FIELDS[id] ?? [];
            return (
              <li key={id} className="flex flex-wrap items-start justify-between gap-4 px-5 py-4">
                <div className="min-w-0 max-w-xl">
                  <p className="text-sm font-semibold text-ink-950">
                    {meta.label}
                    {!meta.sourceAvailable ? (
                      <span className="ml-2 rounded-full bg-ink-950/[0.06] px-2 py-0.5 text-xs font-semibold text-text-muted">veri kaynağı yok</span>
                    ) : null}
                  </p>
                  <p className="mt-0.5 text-xs text-text-muted">{meta.description}</p>
                </div>
                <div className="flex flex-wrap items-end gap-3">
                  {fields.map((f) => (
                    <label key={f.field} className="flex flex-col gap-1 text-xs font-medium text-text-muted">
                      {f.label}
                      <input
                        name={`t_${f.field}`}
                        type="number"
                        inputMode="decimal"
                        step={f.field === "commissionCutPoints" ? "0.1" : "1"}
                        min={THRESHOLD_LIMITS[f.field][0]}
                        max={THRESHOLD_LIMITS[f.field][1]}
                        defaultValue={thresholds[f.field]}
                        disabled={locked}
                        className={INPUT}
                      />
                    </label>
                  ))}
                  <Switch
                    name={`en_${id}`}
                    defaultChecked={thresholds.enabled[id]}
                    disabled={locked}
                    aria-label={`${meta.label} kuralı`}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="approval-rules" className="space-y-3">
        <div>
          <h2 id="approval-rules" className="font-display text-lg font-bold text-ink-950">
            Onay zorunluluğu
          </h2>
          <p className="text-sm text-text-muted">
            Varsayılan olarak hepsi kapalıdır; danışman hiçbir işlemde beklemez. Açtığınız kural için danışmanın işlemi
            &quot;onay bekliyor&quot; olur, size bildirim düşer ve karar{" "}
            <Link href="/app/onaylar?durum=bekliyor" className="font-semibold text-brand-600 hover:underline">
              Onaylar
            </Link>{" "}
            ekranında nedenli verilir. Ofis sahibi ve yöneticilerin kendi işlemleri beklemez.
          </p>
        </div>
        <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface">
          {APPROVAL_ACTION_TYPES.map((t) => {
            const meta = APPROVAL_ACTION_META[t];
            return (
              <li key={t} className="flex flex-wrap items-start justify-between gap-4 px-5 py-4">
                <div className="min-w-0 max-w-xl">
                  <p className="text-sm font-semibold text-ink-950">{meta.label}</p>
                  <p className="mt-0.5 text-xs text-text-muted">{meta.description}</p>
                </div>
                <div className="flex flex-wrap items-end gap-3">
                  {meta.thresholdLabel ? (
                    <label className="flex flex-col gap-1 text-xs font-medium text-text-muted">
                      {meta.thresholdLabel}
                      <input
                        name={`ar_${t}_threshold`}
                        type="number"
                        inputMode="decimal"
                        step={t === "commission_discount" ? "0.1" : "1"}
                        min={meta.limits[0]}
                        max={meta.limits[1]}
                        defaultValue={approvalRules[t].threshold}
                        disabled={locked}
                        className={INPUT}
                      />
                    </label>
                  ) : null}
                  <Switch
                    name={`ar_${t}_enabled`}
                    defaultChecked={approvalRules[t].enabled}
                    disabled={locked}
                    aria-label={`${meta.label} için onay zorunlu`}
                  />
                </div>
              </li>
            );
          })}
        </ul>
        <p className="text-xs text-text-muted">
          Not: Onay kuralları, ilgili işlem ekranları kapıyı çağırdığında uygulanır (fiyat güncelleme, ilan silme, komisyon ve
          dışa aktarma akışları). Kural açık olsa da bağlantısı yapılmamış bir ekranda işlem beklemez.
        </p>
      </section>

      {canEdit ? (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={pending || !storeAvailable}
            className="focus-ring press rounded-[var(--radius-control)] bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? "Kaydediliyor…" : "Ayarları kaydet"}
          </button>
          {!storeAvailable ? <span className="text-xs text-amber-700">Kayıt için veritabanı güncellemesi bekleniyor.</span> : null}
          {state.ok ? (
            <span role="status" className="inline-flex items-center gap-1 text-sm font-semibold text-mint-700">
              <CheckCircle2 className="h-4 w-4" aria-hidden /> Kaydedildi
            </span>
          ) : null}
          {state.error ? (
            <span role="alert" className="text-sm font-semibold text-danger-600">
              {state.error}
            </span>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-text-muted">Bu ayarları yalnızca ofis sahibi ve genel müdür değiştirebilir.</p>
      )}
    </form>
  );
}
