"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { seedSampleData } from "@/app/actions/sample-data";
import { Button } from "@/components/ui/button";

/**
 * Boş ofiste "Önce örnek veriyle deneyin": tüm modüllerde "Örnek veri" rozetli kayıtlar yükler; hazır olunca
 * Ayarlar > Gerçek kullanıma geç ile tek tuşla silinir. Örnek kayıt "Verileri taşı" adımını tamamlamaz.
 */
export function SampleSeedButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] border border-line bg-canvas p-4">
      <Sparkles className="h-5 w-5 shrink-0 text-amber-500" aria-hidden />
      <p className="min-w-0 flex-1 text-sm text-text-muted">Önce denemek mi istersiniz? Örnek müşteri, portföy ve randevularla dolu bir ofis açın; sonra tek tuşla silin.</p>
      <Button
        type="button"
        variant="secondary"
        loading={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await seedSampleData();
            if (res.error) return setMessage({ tone: "error", text: res.error });
            setMessage({ tone: "ok", text: "Örnek veriler yüklendi." });
            router.refresh();
          })
        }
      >
        Örnek veriyle dene
      </Button>
      {message ? (
        <p role={message.tone === "error" ? "alert" : "status"} className={`w-full text-sm font-semibold ${message.tone === "error" ? "text-danger-600" : "text-mint-600"}`}>
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
