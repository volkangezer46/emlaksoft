"use client";

import { useActionState, useEffect, useRef } from "react";
import { ExternalLink, RefreshCw, Save } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { FormField, FormInput, FormTextarea } from "@/components/ui/form-controls";
import { Switch } from "@/components/ui/switch";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CopyTextButton } from "@/components/app/copy-text-button";
import { useToast } from "@/components/app/toast-provider";
import { rotateRecruitFormToken, saveRecruitSettings, type RecruitResult } from "@/app/actions/recruiting";

const init: RecruitResult = {};

function useResultToast(state: RecruitResult) {
  const { push } = useToast();
  useEffect(() => {
    if (state.ok && state.info) push(state.info, "ok");
    else if (state.error) push(state.error, "err");
  }, [state, push]);
}

/**
 * Kariyer formu ayarı: yayında/kapalı, giriş metni, KVKK saklama süresi + paylaşılabilir bağlantı (kopyala, WhatsApp,
 * önizle, yenile). Bağlantı yenilenince eskisi hemen geçersiz olur.
 */
export function RecruitFormSettings({
  url,
  enabled,
  intro,
  retentionDays,
}: {
  url: string | null;
  enabled: boolean;
  intro: string | null;
  retentionDays: number;
}) {
  const [state, action, pending] = useActionState(saveRecruitSettings, init);
  const [rotState, rotate, rotating] = useActionState(rotateRecruitFormToken, init);
  const rotForm = useRef<HTMLFormElement>(null);
  useResultToast(state);
  useResultToast(rotState);
  const waText = url ? `Ekibimize katılmak ister misiniz? Danışman başvuru formumuz: ${url}` : "";

  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-[var(--radius-panel)] border border-line bg-surface p-4 sm:p-5">
        <div>
          <h2 className="font-display text-base font-bold text-ink-950">Başvuru bağlantısı</h2>
          <p className="text-xs text-text-muted">
            Sosyal medyada, iş ilanında ya da WhatsApp&apos;ta paylaşın. Başvurular &quot;Başvuru&quot; aşamasına düşer ve ofis sahibi ile genel müdüre bildirim gider.
          </p>
        </div>
        {url ? (
          <>
            <p className="break-all rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2.5 font-mono text-xs text-ink-950">{url}</p>
            <div className="flex flex-wrap gap-2">
              <CopyTextButton text={url} label="Bağlantıyı kopyala" doneMessage="Bağlantı kopyalandı" />
              <ButtonLink href={`https://wa.me/?text=${encodeURIComponent(waText)}`} target="_blank" rel="noopener noreferrer" variant="secondary" size="sm">
                WhatsApp&apos;ta paylaş
              </ButtonLink>
              <ButtonLink href={url} target="_blank" rel="noopener noreferrer" variant="ghost" size="sm" icon={ExternalLink}>
                Önizle
              </ButtonLink>
              <form ref={rotForm} action={rotate}>
                <ConfirmDialog
                  title="Bağlantı yenilensin mi?"
                  description="Eski bağlantı hemen çalışmaz olur; paylaştığınız yerlerde yeni bağlantıyı kullanmanız gerekir."
                  confirmLabel="Yenile"
                  onConfirm={() => rotForm.current?.requestSubmit()}
                  trigger={
                    <Button type="button" variant="ghost" size="sm" icon={RefreshCw} loading={rotating}>
                      Bağlantıyı yenile
                    </Button>
                  }
                />
              </form>
            </div>
            {!enabled ? <p className="text-xs font-semibold text-amber-700">Form şu an kapalı: bağlantıyı açan kişi &quot;başvuru alınmıyor&quot; mesajı görür.</p> : null}
          </>
        ) : (
          <p className="text-sm text-text-muted">Formu yayına aldığınızda ofisinize özel bağlantı oluşur.</p>
        )}
      </section>

      <form action={action} className="space-y-4 rounded-[var(--radius-panel)] border border-line bg-surface p-4 sm:p-5">
        <div className="flex min-h-11 items-center justify-between gap-3">
          <label htmlFor="recruit-enabled" className="min-w-0">
            <span className="block text-sm font-semibold text-ink-950">Başvuru formu yayında</span>
            <span className="block text-xs text-text-muted">Kapalıyken bağlantı başvuru kabul etmez.</span>
          </label>
          <Switch id="recruit-enabled" name="form_enabled" defaultChecked={enabled} aria-label="Başvuru formu yayında" />
        </div>
        <FormField label="Giriş metni" htmlFor="recruit-intro" hint="Formun üstünde görünür (en çok 600 karakter).">
          <FormTextarea
            id="recruit-intro"
            name="intro"
            rows={4}
            maxLength={600}
            defaultValue={intro ?? ""}
            placeholder="Örn. Büyüyen ekibimize deneyimli ve yeni başlayan danışmanlar arıyoruz. Eğitim, portföy desteği ve esnek çalışma sunuyoruz."
          />
        </FormField>
        <FormField
          label="Aday verisi saklama süresi (gün)"
          htmlFor="recruit-retention"
          hint="KVKK: sonuçlanan ya da bu süre boyunca hareketsiz kalan aday kaydı otomatik silinir (30-730 gün)."
        >
          <FormInput id="recruit-retention" name="retention_days" type="number" inputMode="numeric" min={30} max={730} defaultValue={retentionDays} className="max-w-[10rem]" />
        </FormField>
        <div className="flex sm:justify-end">
          <Button type="submit" icon={Save} loading={pending} className="w-full sm:w-auto">
            Kaydet
          </Button>
        </div>
      </form>
    </div>
  );
}
