"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Star } from "lucide-react";
import { saveOfficeSettingAction } from "@/app/actions/office-settings";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormInput } from "@/components/ui/form-controls";

const GOOGLE_HELP_URL = "https://support.google.com/business/answer/3474122?hl=tr";

/**
 * Ofis profili > Google yorum bağlantısı (ofis ayarı `office.reviews.google_review_url`). Yazma mevcut Ofis Tanımları
 * Merkezi eylemiyle yapılır (yeni action yok; doğrulama kayıt defterinde: yalnız g.page/r veya writereview?placeid).
 * Okuyucu: memnuniyet anketi 9-10 puan teşekkür ekranı.
 */
export function GoogleReviewField({ settingKey, value, canEdit }: { settingKey: string; value: string; canEdit: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [next, setNext] = useState(value);
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const dirty = next.trim() !== value;

  function save() {
    setMsg(null);
    startTransition(async () => {
      const res = await saveOfficeSettingAction(settingKey, next.trim(), "Ofis profili: Google yorum bağlantısı");
      if (res.error) {
        setMsg({ tone: "danger", text: res.error });
        return;
      }
      setMsg({ tone: "success", text: next.trim() ? "Kaydedildi. Ankette 9-10 puan veren müşteri bu bağlantıyı görür." : "Bağlantı kaldırıldı; ankette düğme görünmez." });
      router.refresh();
    });
  }

  return (
    <div className="mt-5 border-t border-line pt-5">
      <label htmlFor="google-review-url" className="flex items-center gap-2 text-sm font-bold text-ink-950">
        <Star className="h-4 w-4 text-brand-600" aria-hidden="true" /> Google yorum bağlantısı
      </label>
      <p className="mt-1 max-w-2xl text-xs text-text-muted">
        Memnuniyet anketinde 9-10 puan veren müşteriye &quot;Google&apos;da yorum bırakın&quot; düğmesi gösterilir. Boş bırakırsanız düğme
        görünmez. Bağlantıyı Google İşletme Profilinizdeki &quot;Yorum isteyin&quot; bölümünden kopyalayın.{" "}
        <a href={GOOGLE_HELP_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-brand-600 hover:underline">
          Google yardımı <ExternalLink className="h-3 w-3" aria-hidden="true" />
        </a>
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <div className="min-w-64 flex-1">
          <FormInput
            id="google-review-url"
            type="url"
            inputMode="url"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            placeholder="https://g.page/r/..."
            maxLength={300}
            disabled={!canEdit || pending}
          />
        </div>
        {canEdit ? (
          <Button onClick={save} loading={pending} disabled={!dirty}>
            Kaydet
          </Button>
        ) : null}
      </div>
      {msg ? <Alert tone={msg.tone} className="mt-3">{msg.text}</Alert> : null}
    </div>
  );
}
