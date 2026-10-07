"use client";

import { useState, useTransition } from "react";
import Link from "@/components/ui/smart-link";
import { useRouter } from "next/navigation";
import { BellRing } from "lucide-react";
import { saveRentReminderSettings } from "@/app/actions/rent-reminders";
import { useToast } from "@/components/app/toast-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { FormField, FormInput } from "@/components/ui/form-controls";
import type { ReminderSettings } from "@/lib/rent-reminders/logic";

/**
 * Kiracı hatırlatma ofis ayarı (KAPALI doğar). Açılınca kira-tahakkuk cron'u vade yaklaşan/gelen/geciken kiralar için
 * ofise WhatsApp (wa.me) bildirimi üretir; SMS ayrıca açılır ve yalnız ofisin kendi SMS entegrasyonu hazırsa çalışır.
 */
export function ReminderSettingsCard({
  initial,
  smsAvailable,
  canEdit,
  schemaReady,
}: {
  initial: ReminderSettings;
  smsAvailable: boolean;
  canEdit: boolean;
  /** false = ayar tablosu okunamadı (migration uygulanmamış). */
  schemaReady: boolean;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [pending, start] = useTransition();
  const [s, setS] = useState(initial);
  const [open, setOpen] = useState(false);

  function save() {
    start(async () => {
      const res = await saveRentReminderSettings(s);
      if (res.error) push(res.error, "err");
      else {
        push("Hatırlatma ayarları kaydedildi", "ok");
        router.refresh();
      }
    });
  }

  const num = (v: string, fallback: number) => (v.trim() === "" || !Number.isFinite(Number(v)) ? fallback : Math.trunc(Number(v)));

  return (
    <section id="hatirlatma-ayarlari" className="rounded-[var(--radius-panel)] border border-line bg-surface p-4 shadow-[var(--shadow-xs)]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-bold text-ink-950">
          <BellRing className="h-4 w-4 text-brand-600" /> Kiracı hatırlatma ayarları
          <Badge variant={initial.enabled ? "success" : "outline"} size="sm">{initial.enabled ? "Açık" : "Kapalı"}</Badge>
        </h2>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="focus-ring rounded-[var(--radius-control)] text-xs font-semibold text-brand-600 hover:underline"
        >
          {open ? "Kapat" : canEdit ? "Düzenle" : "Görüntüle"}
        </button>
      </div>
      <p className="mt-1 text-xs text-text-muted">
        Vade yaklaşınca, vade gününde ve gecikmede kiracıya hatırlatma. Varsayılan KAPALIDIR; kiracı “hatırlatma istemiyor” işaretliyse hiçbir şey üretilmez.
      </p>

      {open ? (
        <div className="mt-4 space-y-4">
          {!schemaReady ? (
            <p className="rounded-[var(--radius-control)] bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
              Bu özellik için veritabanı güncellemesi henüz uygulanmamış; ayarlar şu an kaydedilemez.
            </p>
          ) : null}

          <label className="flex items-center justify-between gap-3">
            <span>
              <span className="block text-sm font-semibold text-ink-950">Otomatik hatırlatma</span>
              <span className="block text-xs text-text-muted">Ofise WhatsApp bildirimi hazırlanır; mesajı siz tek tıkla gönderirsiniz.</span>
            </span>
            <Switch checked={s.enabled} onCheckedChange={(v) => setS({ ...s, enabled: v, smsEnabled: v ? s.smsEnabled : false })} disabled={!canEdit || pending} aria-label="Otomatik hatırlatma" />
          </label>

          <label className="flex items-center justify-between gap-3">
            <span>
              <span className="block text-sm font-semibold text-ink-950">Kiracıya SMS gönder</span>
              <span className="block text-xs text-text-muted">
                {smsAvailable ? (
                  "Ofisinizin kendi SMS (Netgsm) hesabıyla gönderilir; yalnız TR cep numaralarına."
                ) : (
                  <>
                    SMS entegrasyonu bağlı değil. <Link href="/app/ayarlar/entegrasyonlar" className="font-semibold text-brand-600 hover:underline">Entegrasyonlar</Link>’dan Netgsm bağlayın.
                  </>
                )}
              </span>
            </span>
            <Switch
              checked={s.smsEnabled}
              onCheckedChange={(v) => setS({ ...s, smsEnabled: v })}
              disabled={!canEdit || pending || !s.enabled || !smsAvailable}
              aria-label="Kiracıya SMS gönder"
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <FormField label="Vadeden kaç gün önce" htmlFor="rr-before" hint="0 = vade öncesi hatırlatma yok">
              <FormInput id="rr-before" inputMode="numeric" value={String(s.daysBefore)} onChange={(e) => setS({ ...s, daysBefore: num(e.target.value, 0) })} disabled={!canEdit || pending} />
            </FormField>
            <FormField label="Gecikme hatırlatması (gün)" htmlFor="rr-late" hint="Vadeden kaç gün sonra">
              <FormInput id="rr-late" inputMode="numeric" value={String(s.lateAfterDays)} onChange={(e) => setS({ ...s, lateAfterDays: num(e.target.value, 1) })} disabled={!canEdit || pending} />
            </FormField>
            <FormField label="Sessiz saat başlangıcı" htmlFor="rr-qs" hint="SMS bu saatlerde gönderilmez">
              <FormInput id="rr-qs" inputMode="numeric" value={String(s.quietStartHour)} onChange={(e) => setS({ ...s, quietStartHour: num(e.target.value, 21) })} disabled={!canEdit || pending} />
            </FormField>
            <FormField label="Sessiz saat bitişi" htmlFor="rr-qe" hint="Cron günde bir kez 08:00’de çalışır">
              <FormInput id="rr-qe" inputMode="numeric" value={String(s.quietEndHour)} onChange={(e) => setS({ ...s, quietEndHour: num(e.target.value, 8) })} disabled={!canEdit || pending} />
            </FormField>
          </div>

          {canEdit ? (
            <div className="flex justify-end">
              <Button size="sm" onClick={save} loading={pending} disabled={!schemaReady}>Kaydet</Button>
            </div>
          ) : (
            <p className="text-xs text-text-muted">Ayarları değiştirmek için kiralama düzenleme yetkisi gerekir.</p>
          )}
        </div>
      ) : null}
    </section>
  );
}
