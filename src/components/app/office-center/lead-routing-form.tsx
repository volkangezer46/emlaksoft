"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { saveOfficeSettings } from "@/app/actions/office-center";
import { useToast } from "@/components/app/toast-provider";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormField, FormInput, FormSelect } from "@/components/ui/form-controls";
import { Switch } from "@/components/ui/switch";
import { LEAD_ROUTING_STRATEGIES, type LeadRoutingConfig, type LeadRoutingStrategy } from "@/lib/lead-routing/logic";
import { SLA_OPTIONS_MIN } from "@/lib/response-time/core";

/** Anahtarlar `settings/registry/tenant.ts` LEAD_ROUTING_KEYS ile aynıdır (istemci dosyası sunucu modülü içe aktarmaz). */
const K = {
  strategy: "office.lead_routing.strategy",
  hoursOnly: "office.lead_routing.hours_only",
  reassign: "office.lead_routing.reassign_on_breach",
  maxReassign: "office.lead_routing.max_reassign",
  slaMin: "office.sla.lead_first_response_min",
} as const;

export function LeadRoutingForm({ initial, canEdit }: { initial: LeadRoutingConfig; canEdit: boolean }) {
  const [strategy, setStrategy] = useState<LeadRoutingStrategy>(initial.strategy);
  const [hoursOnly, setHoursOnly] = useState(initial.hoursOnly);
  const [reassign, setReassign] = useState(initial.reassignOnBreach);
  const [maxReassign, setMaxReassign] = useState(initial.maxReassign);
  const [sla, setSla] = useState(initial.slaMinutes);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const { push } = useToast();

  function save() {
    setError(null);
    start(async () => {
      const res = await saveOfficeSettings(
        [
          { key: K.strategy, value: strategy },
          { key: K.hoursOnly, value: hoursOnly ? "on" : "off" },
          { key: K.reassign, value: reassign ? "on" : "off" },
          { key: K.maxReassign, value: String(maxReassign) },
          { key: K.slaMin, value: String(sla) },
        ],
        "Ofis Merkezi > Talep dağıtımı",
      );
      if (res.error) {
        setError(res.error);
        push(res.error, "err");
        return;
      }
      push(res.message ?? "Kaydedildi.", "ok");
      router.refresh();
    });
  }

  const current = LEAD_ROUTING_STRATEGIES.find((s) => s.value === strategy);

  return (
    <fieldset disabled={!canEdit} className="space-y-4 disabled:opacity-80">
      {!canEdit ? (
        <Alert tone="info" title="Görüntüleme modu">
          Dağıtım kurallarını değiştirmek için ayar düzenleme yetkisi (ofis sahibi / genel müdür) gerekir.
        </Alert>
      ) : null}
      {error ? (
        <Alert tone="danger" title="Kaydedilemedi">
          {error}
        </Alert>
      ) : null}
      <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="font-display font-bold text-ink-950">Yeni talep dağıtımı</h3>
            <p className="text-xs text-text-muted">Vitrin, müşteri portalı ve başvuru formundan gelen talepler bu kurala göre atanır.</p>
          </div>
          <Button type="button" size="sm" icon={Save} loading={pending} onClick={save}>
            Kaydet
          </Button>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Dağıtım yöntemi" htmlFor="lr-strategy" hint={current?.description}>
            <FormSelect id="lr-strategy" value={strategy} onChange={(e) => setStrategy(e.target.value as LeadRoutingStrategy)}>
              {LEAD_ROUTING_STRATEGIES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </FormSelect>
          </FormField>
          <FormField label="İlk dönüş süresi (SLA)" htmlFor="lr-sla" hint="Aday hızı raporu ve yeniden atama aynı süreyi kullanır (çalışma saati: Pzt-Cmt 09:00-19:00).">
            <FormSelect id="lr-sla" value={String(sla)} onChange={(e) => setSla(Number(e.target.value))}>
              {SLA_OPTIONS_MIN.map((m) => (
                <option key={m} value={m}>
                  {m >= 60 ? `${m / 60} saat` : `${m} dakika`}
                </option>
              ))}
            </FormSelect>
          </FormField>
          <label className="flex items-start justify-between gap-3 rounded-[var(--radius-card)] border border-line p-3 text-sm sm:col-span-2">
            <span>
              <span className="block font-semibold text-ink-950">Mesai dışı talebi mesai başında dağıt</span>
              <span className="block text-xs text-text-muted">Açıkken Pazar ve 09:00-19:00 dışında gelen talep atanmadan bekler; mesai başlayınca dağıtılır.</span>
            </span>
            <Switch checked={hoursOnly} onCheckedChange={setHoursOnly} aria-label="Mesai dışı talebi mesai başında dağıt" />
          </label>
          <label className="flex items-start justify-between gap-3 rounded-[var(--radius-card)] border border-line p-3 text-sm sm:col-span-2">
            <span>
              <span className="block font-semibold text-ink-950">İlk dönüş süresi dolunca yeniden ata</span>
              <span className="block text-xs text-text-muted">
                Talebe SLA süresi içinde dönülmezse başka uygun danışmana devredilir; eski ve yeni sorumluya bildirim gider. Üst sınır dolunca yöneticiler uyarılır.
              </span>
            </span>
            <Switch checked={reassign} onCheckedChange={setReassign} aria-label="İlk dönüş süresi dolunca yeniden ata" />
          </label>
          {reassign ? (
            <FormField label="En çok yeniden atama" htmlFor="lr-max" hint="1–5 kez">
              <FormInput id="lr-max" type="number" min={1} max={5} value={Number.isFinite(maxReassign) ? maxReassign : ""} onChange={(e) => setMaxReassign(Number(e.target.value))} />
            </FormField>
          ) : null}
        </div>
      </section>
    </fieldset>
  );
}
