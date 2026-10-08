"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { saveOfficeSettingAction } from "@/app/actions/office-settings";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { FormInput } from "@/components/ui/form-controls";

/**
 * "Liste kapsamını uygula" ofis bayrağı (tenant ayarı `office.access.scope_enforcement`, yüksek risk: gerekçe zorunlu).
 * Yazma mevcut Ofis Tanımları Merkezi eylemiyle yapılır (yeni action yok); geçmiş ve varsayılana dön orada.
 */
export function ScopeEnforcementToggle({ settingKey, enabled, canEdit }: { settingKey: string; enabled: boolean; canEdit: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [next, setNext] = useState(enabled);
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const dirty = next !== enabled;

  function save() {
    setMsg(null);
    startTransition(async () => {
      const res = await saveOfficeSettingAction(settingKey, next ? "on" : "off", reason);
      if (res.error) {
        setMsg({ tone: "danger", text: res.error });
        return;
      }
      setReason("");
      setMsg({ tone: "success", text: next ? "Kapsam uygulaması açıldı: listeler kullanıcı kapsamıyla daralır." : "Kapsam uygulaması kapatıldı: listeler eski görünüme döndü." });
      router.refresh();
    });
  }

  return (
    <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
            <ShieldCheck className="h-4 w-4 text-brand-600" /> Liste kapsamını uygula
          </h2>
          <p className="mt-1 max-w-2xl text-xs text-text-muted">
            Açıkken talep, müşteri, portföy, anlaşma ve görev listeleri ile raporları (Rapor merkezi) kullanıcının kapsamıyla (kendi kayıtları / takım / şube)
            sınırlanır. Ofis geneli kapsamdaki yöneticiler etkilenmez; kapsam yalnız daraltır, mevcut rol kuralını genişletmez. Kapatınca
            eski görünüm hemen geri gelir.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs font-semibold ${enabled ? "text-mint-600" : "text-text-muted"}`}>{enabled ? "Açık" : "Kapalı"}</span>
          <Switch checked={next} onCheckedChange={setNext} disabled={!canEdit || pending} aria-label="Liste kapsamını uygula" />
        </div>
      </div>
      {dirty && canEdit ? (
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <div className="min-w-64 flex-1">
            <label htmlFor="scope-enforcement-reason" className="mb-1 block text-xs font-semibold uppercase tracking-[0.08em] text-text-faint">
              Gerekçe (zorunlu, en az 5 karakter)
            </label>
            <FormInput id="scope-enforcement-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={next ? "Örn. Danışmanlar yalnız kendi müşterilerini görsün" : "Örn. Geçiş dönemi; ekip ortak portföy kullanıyor"} maxLength={300} />
          </div>
          <Button onClick={save} loading={pending} disabled={reason.trim().length < 5}>
            {next ? "Kapsamı aç" : "Kapsamı kapat"}
          </Button>
          <Button variant="secondary" onClick={() => { setNext(enabled); setReason(""); }} disabled={pending}>
            Vazgeç
          </Button>
        </div>
      ) : null}
      {msg ? <Alert tone={msg.tone} className="mt-3">{msg.text}</Alert> : null}
    </section>
  );
}
