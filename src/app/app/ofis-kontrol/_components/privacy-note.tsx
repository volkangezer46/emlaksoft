import { ShieldCheck } from "lucide-react";

/**
 * Saygili sinir bildirimi + KVKK aydinlatma YER TUTUCUSU.
 * Hukuki iddia icermez: izleme politikasi metni ofis sahibinin / hukuk danismaninin kararidir.
 */
export function PrivacyNote({ audience }: { audience: "office" | "advisor" }) {
  return (
    <aside className="flex items-start gap-3 rounded-[var(--radius-card)] border border-line bg-canvas/60 p-4 text-sm text-text-muted">
      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-mint-600" aria-hidden />
      <div className="space-y-1.5">
        <p className="font-semibold text-ink-950">Bu ekran kişi izleme değil, iş süreçlerinin kontrolüdür</p>
        {audience === "office" ? (
          <p>
            Yalnızca ofis sistemi içindeki iş kayıtları (ilan, müşteri, randevu, anlaşma, dışa aktarma) gösterilir. Konum, ekran
            ya da özel yazışma izlenmez. Her danışman kendi akışını &quot;Benim akışım&quot; sayfasında görebilir.
          </p>
        ) : (
          <p>
            Ofis yönetimi, iş süreçlerinin düzenli yürümesi için bu kayıtları görebilir. Burada yalnızca sizin kendi işlem
            kayıtlarınız listelenir.
          </p>
        )}
        <p className="rounded-[var(--radius-control)] border border-dashed border-line bg-surface px-3 py-2 text-xs">
          <span className="font-semibold text-ink-950">İzleme politikası aydınlatma metni (yer tutucu):</span> Bu alanda ofisinizin
          KVKK aydınlatma metni yayımlanacaktır. Metin ofis sahibi tarafından hazırlanır; bu sayfa hukuki bir
          taahhüt içermez.
        </p>
      </div>
    </aside>
  );
}
