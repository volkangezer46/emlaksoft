import Link from "next/link";
import { AlertTriangle, Camera, CheckCircle2, CircleDashed } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { loadPhotoQuality } from "@/lib/photo-quality/load";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * İlan fotoğraf kalite kartı (F3). Kural tabanlı ve açıklanabilir: puan yok, her satır ölçülen değeri ve
 * eşiği söyler. Kayıtlı metadata dışında görüntü işlenmez; ölçülemeyen kontroller açıkça "ölçülemedi" denir.
 * Belge/tapu görüntüleri kapsam dışıdır. Tablo okunamazsa kart "etkin değil" der.
 */
export async function PhotoQualityCard({ propertyId }: { propertyId: string }) {
  const supabase = await createClient();
  const load = await loadPhotoQuality(supabase, propertyId);
  const mediaHref = `/app/portfoyler/${propertyId}?sekme=medya`;

  if (!load.enabled) {
    return (
      <Card>
        <CardHeader>
          <div>
            <CardTitle className="flex items-center gap-2">
              <Camera className="h-4 w-4 text-text-faint" /> Fotoğraf kalite kartı
            </CardTitle>
            <CardDescription>Etkin değil: medya kayıtları bu ortamda okunamadı.</CardDescription>
          </div>
        </CardHeader>
      </Card>
    );
  }

  const { report } = load;
  const verdict =
    report.warned === 0
      ? "Ölçülebilen tüm kontroller geçti."
      : `${report.warned} uyarı var, ${report.passed} kontrol geçti.`;

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <Camera className="h-4 w-4 text-brand-600" /> Fotoğraf kalite kartı
          </CardTitle>
          <CardDescription>
            {report.photoCount} fotoğraf · {verdict} Kural tabanlı; puan verilmez.
          </CardDescription>
        </div>
        <Link
          href={mediaHref}
          className="focus-ring press shrink-0 rounded-[var(--radius-control)] border border-line px-3 py-1.5 text-xs font-semibold text-brand-600 transition hover:border-brand-300"
        >
          Medyaya git
        </Link>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-line">
          {report.checks.map((c) => (
            <li key={c.id} className="flex gap-3 py-2.5 first:pt-0 last:pb-0">
              <span className="mt-0.5 shrink-0" aria-hidden>
                {c.status === "pass" ? (
                  <CheckCircle2 className="h-4 w-4 text-mint-600" />
                ) : c.status === "warn" ? (
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                ) : (
                  <CircleDashed className="h-4 w-4 text-text-faint" />
                )}
              </span>
              <div className="min-w-0 text-sm">
                <p className="font-semibold text-text">
                  {c.title}
                  <span className="sr-only"> — {c.status === "pass" ? "geçti" : c.status === "warn" ? "uyarı" : "ölçülemedi"}</span>
                </p>
                <p className="text-xs text-text-muted">{c.detail}</p>
                {c.suggestion ? (
                  <p className="mt-1 text-xs font-medium text-ink-950">
                    Öneri: {c.suggestion}{" "}
                    <Link href={mediaHref} className="text-brand-600 hover:underline">
                      Düzelt
                    </Link>
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
        {report.notMeasured > 0 ? (
          <p className="mt-3 rounded-[var(--radius-control)] bg-canvas px-3 py-2 text-xs text-text-muted">
            {report.notMeasured} kontrol ölçülemedi: yüklenen görsellerin piksel boyutu kayıtlı değil. Bu kontroller
            boyut kaydı eklenince otomatik çalışır; şimdilik tahmin yürütülmez.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
