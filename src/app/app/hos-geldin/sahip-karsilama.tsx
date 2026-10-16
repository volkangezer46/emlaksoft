"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Building2, FileSpreadsheet, LayoutGrid, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/components/app/toast-provider";
import { completeWelcomeFlow } from "@/app/actions/onboarding-setup";

/** Kurulum sihirbazının 4 adımı (plan C27): yalnız tanıtım; adımların kendisi /app/baslangic'tedir. */
const ADIMLAR = [
  { title: "Ofisiniz", hint: "Ad, telefon ve logo", Icon: Building2 },
  { title: "Ne iş yapıyorsunuz", hint: "Satış, kiralama, proje: menü buna göre sadeleşir", Icon: LayoutGrid },
  { title: "Verilerinizi taşıyın", hint: "Excel'deki müşteri ve portföy listeniz", Icon: FileSpreadsheet },
  { title: "Ekibinizi davet edin", hint: "Danışmanlarınız kendi telefonlarından girer", Icon: Users },
] as const;

/**
 * OFİS SAHİBİ KARŞILAMA EKRANI (sadeleştirme planı C27, karşılama kısmı): yeni ofisin sahibi ilk girişte bir kez görür.
 * Tek birincil düğme ("Kuruluma başla" → 4 adımlı sihirbaz) + "Şimdilik ana ekrana geç". İkisi de karşılamayı profilde
 * "tamamlandı" işaretler (cihazlar arası, `completeWelcomeFlow`); kayıt düşerse yönlendirme yapılmaz (döngü olmasın).
 */
export function SahipKarsilama({ firstName, officeName }: { firstName: string; officeName: string | null }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [target, setTarget] = useState<string | null>(null);

  function finish(to: string) {
    setTarget(to);
    start(async () => {
      const res = await completeWelcomeFlow();
      if (res.error) {
        toast.push(res.error, "err");
        setTarget(null);
        return;
      }
      router.push(to);
    });
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-6 py-8">
        <div className="flex flex-col gap-2">
          <h1 className="font-display text-2xl font-bold text-text">Hoş geldiniz{firstName ? `, ${firstName}` : ""}</h1>
          <p className="text-[15px] text-text-muted">
            {officeName ? `${officeName} için ` : ""}müşteri, portföy, randevu ve paranız tek ekranda. Başlamak için 4 kısa adım yeterli; her adımı sonra da yapabilirsiniz.
          </p>
        </div>
        <ol className="flex flex-col gap-2" aria-label="Kurulum adımları">
          {ADIMLAR.map((a, i) => (
            <li key={a.title} className="flex items-center gap-3 rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-600/10 text-sm font-bold text-brand-600" aria-hidden="true">
                {i + 1}
              </span>
              <a.Icon className="h-5 w-5 shrink-0 text-text-muted" aria-hidden="true" />
              <span className="min-w-0">
                <span className="block text-[15px] font-semibold text-ink-950">{a.title}</span>
                <span className="block text-sm text-text-muted">{a.hint}</span>
              </span>
            </li>
          ))}
        </ol>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Button size="lg" iconRight={ArrowRight} loading={pending && target === "/app/baslangic"} disabled={pending} onClick={() => finish("/app/baslangic")} className="h-11">
            Kuruluma başla
          </Button>
          <Button size="lg" variant="ghost" loading={pending && target === "/app"} disabled={pending} onClick={() => finish("/app")} className="h-11">
            Şimdilik ana ekrana geç
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
