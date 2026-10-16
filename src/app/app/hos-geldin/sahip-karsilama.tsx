"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Building2, FileSpreadsheet, LayoutGrid, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { IconChip, type IconChipTone } from "@/components/ui/icons/icon-chip";
import { HeroArt } from "@/components/ui/illustrations/hero-art";
import { useToast } from "@/components/app/toast-provider";
import { completeWelcomeFlow } from "@/app/actions/onboarding-setup";

/** Kurulum sihirbazının 4 adımı (plan C27): yalnız tanıtım; adımların kendisi /app/baslangic'tedir. */
const ADIMLAR: readonly { title: string; hint: string; Icon: typeof Building2; tone: IconChipTone }[] = [
  { title: "Ofisiniz", hint: "Ad, telefon ve logo", Icon: Building2, tone: "brand" },
  { title: "Ne iş yapıyorsunuz", hint: "Satış, kiralama, proje: menü buna göre sadeleşir", Icon: LayoutGrid, tone: "gold" },
  { title: "Verilerinizi taşıyın", hint: "Excel'deki müşteri ve portföy listeniz", Icon: FileSpreadsheet, tone: "success" },
  { title: "Ekibinizi davet edin", hint: "Danışmanlarınız kendi telefonlarından girer", Icon: Users, tone: "warn" },
];

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
    <Card className="overflow-hidden">
      <div className="relative border-b border-line bg-[linear-gradient(135deg,color-mix(in_srgb,var(--accent)_9%,var(--surface-raised)),var(--surface-raised)_65%)] px-6 pb-5 pt-6 sm:px-8">
        <HeroArt kind="rocket" className="pointer-events-none absolute -right-2 bottom-0 hidden h-32 w-52 sm:block" />
        <p className="text-xs font-bold uppercase tracking-[0.12em] text-accent-text">Kurulum · yaklaşık 5 dakika</p>
        <h1 className="mt-1.5 font-display text-2xl font-bold text-text sm:max-w-[60%]">Hoş geldiniz{firstName ? `, ${firstName}` : ""}</h1>
        <p className="mt-2 text-[15px] text-text-muted sm:max-w-[62%]">
          {officeName ? `${officeName} için ` : ""}müşteri, portföy, randevu ve paranız tek ekranda. Başlamak için 4 kısa adım yeterli; her adımı sonra da yapabilirsiniz.
        </p>
      </div>
      <CardContent className="flex flex-col gap-6 py-6 sm:px-8">
        <ol className="flex flex-col gap-2" aria-label="Kurulum adımları">
          {ADIMLAR.map((a, i) => (
            <li key={a.title} className="flex items-center gap-3 rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3 transition-colors hover:border-[color-mix(in_srgb,var(--accent)_30%,var(--line))]">
              <IconChip icon={a.Icon} tone={a.tone} />
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold text-ink-950">{a.title}</span>
                <span className="block text-sm text-text-muted">{a.hint}</span>
              </span>
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-line text-xs font-bold tabular-nums text-text-muted" aria-hidden="true">
                {i + 1}
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
