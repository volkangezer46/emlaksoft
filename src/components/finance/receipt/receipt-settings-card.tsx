"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Cpu, FileCode2, FileText, QrCode, ScanLine, Sparkles } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/app/toast-provider";
import { saveReceiptReadingSettings } from "@/app/actions/finance-receipt-settings";

/**
 * Fiş okuma ayar kartı. Ana anahtar (varsayılan KAPALI) yerel katmanları açar; yapay zekâ AYRI açık onaydır.
 * Katmanlar ve verinin nereye gittiği açıkça anlatılır (KVKK: yerel katmanlarda dosya sunucudan çıkmaz).
 */

const LAYERS = [
  { icon: QrCode, title: "e-Fatura / e-Arşiv karekodu", text: "GİB karekodundan tutar, tarih, fatura no, ETTN, VKN ve KDV kırılımı kesin olarak okunur." },
  { icon: FileCode2, title: "e-Fatura XML (UBL-TR)", text: "XML dosyasından tüm tutarlar, oran bazında KDV, tevkifat ve satıcı bilgisi kesin olarak okunur." },
  { icon: FileText, title: "PDF metni", text: "e-Arşiv, fatura ve dekont PDF'lerindeki Ödenecek Tutar, Hesaplanan KDV, Fatura No gibi satırlar kurallarla okunur." },
  { icon: ScanLine, title: "Görsel okuma (yerel)", text: "Fiş fotoğrafı sunucumuzdaki Türkçe metin tanıma ile okunur: TOPLAM, TOPKDV, KDV %, tarih, fiş/Z no, satıcı ve vergi dairesi." },
] as const;

export function ReceiptSettingsCard({ enabled, aiEnabled, aiConfigured, canEdit }: { enabled: boolean; aiEnabled: boolean; aiConfigured: boolean; canEdit: boolean }) {
  const router = useRouter();
  const { push } = useToast();
  const [on, setOn] = useState(enabled);
  const [ai, setAi] = useState(aiEnabled);
  const [pending, start] = useTransition();

  function save(nextOn: boolean, nextAi: boolean) {
    const prev = { on, ai };
    setOn(nextOn);
    setAi(nextOn && nextAi);
    start(async () => {
      const res = await saveReceiptReadingSettings({ enabled: nextOn, aiEnabled: nextOn && nextAi });
      if (!res.ok) {
        setOn(prev.on);
        setAi(prev.ai);
        push(res.error, "err");
        return;
      }
      push(nextOn ? "Fiş okuma ayarı kaydedildi" : "Fiş okuma kapatıldı", "ok");
      router.refresh();
    });
  }

  return (
    <div className="grid gap-3" aria-busy={pending}>
      <div className="flex items-start justify-between gap-4 rounded-[var(--radius-card)] border border-line bg-canvas p-3">
        <div className="min-w-0">
          <p id="rs-on-label" className="text-sm font-semibold text-text">
            Fiş okuma (isteğe bağlı)
          </p>
          <p id="rs-on-text" className="mt-0.5 text-xs text-text-muted">
            Yüklenen fiş ve faturadan tutar, tarih, KDV ve satıcı önerilir; siz onaylamadan kayıt açılmaz. Varsayılan kapalıdır.
          </p>
        </div>
        <Switch id="rs-on" checked={on} onCheckedChange={(v) => save(v, ai)} disabled={!canEdit || pending} aria-labelledby="rs-on-label" aria-describedby="rs-on-text" />
      </div>

      <ul className="grid gap-2 sm:grid-cols-2" aria-label="Okuma katmanları">
        {LAYERS.map(({ icon: Icon, title, text }) => (
          <li key={title} className="flex gap-2 rounded-[var(--radius-control)] border border-line p-2.5">
            <Icon className="mt-0.5 h-4 w-4 shrink-0 text-text-faint" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-text">{title}</p>
              <p className="text-xs text-text-muted">{text}</p>
            </div>
          </li>
        ))}
      </ul>
      <p className="flex items-start gap-1.5 text-xs text-text-muted">
        <Cpu className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        Bu dört katman tamamen sunucumuzda çalışır; belge hiçbir dış servise gönderilmez. Okunan alanlar yalnız belge kaydında saklanır, belge metni saklanmaz.
      </p>

      <div className="flex items-start justify-between gap-4 rounded-[var(--radius-card)] border border-line bg-canvas p-3">
        <div className="min-w-0">
          <p id="rs-ai-label" className="flex items-center gap-1.5 text-sm font-semibold text-text">
            <Sparkles className="h-4 w-4 text-text-faint" aria-hidden="true" />
            Yapay zekâ ile tamamlama (ayrıca onay gerekir)
          </p>
          <p id="rs-ai-text" className="mt-0.5 text-xs text-text-muted">
            Yerel okuma eksik kaldığında belge, kişisel veriler maskelenerek yapay zekâ servisine (OpenAI) gönderilir ve AI kredisi harcanır. Varsayılan kapalıdır.
            {!aiConfigured ? " Yapay zekâ anahtarı henüz tanımlı değil; açsanız da yalnız yerel okuma çalışır." : ""}
          </p>
        </div>
        <Switch id="rs-ai" checked={on && ai} onCheckedChange={(v) => save(on, v)} disabled={!canEdit || !on || pending} aria-labelledby="rs-ai-label" aria-describedby="rs-ai-text" />
      </div>
      {!canEdit ? <p className="text-xs text-text-muted">Ayarları değiştirmek için muhasebe düzenleme yetkisi gerekir.</p> : null}
    </div>
  );
}
