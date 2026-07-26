"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Keyboard, X } from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
} from "@/components/ui/dialog";

/**
 * Klavye kısayolları (X12).
 *
 * NEDEN VAR: Komut paleti (Ctrl+K) zaten vardı ama tek kısayol oydu. Panelde
 * gün içinde onlarca kez girilen ekranlar var (portföy, müşteri, görev) ve her
 * seferinde kenar çubuğundan tıklamak gerekiyordu. Güç kullanıcı için bu
 * ölçülebilir bir zaman kaybı.
 *
 * ============================================================================
 * TASARIM: NEDEN "G" ÖNEKİ (chord) — TEK HARF DEĞİL
 * ============================================================================
 * Tek harfli kısayol (ör. "p" → portföyler) bir CRM'de tehlikelidir: kullanıcı
 * bir arama kutusuna ya da not alanına yazarken odak kaybolursa harf kısayola
 * dönüşür ve sayfa aniden değişir — yazılan metin kaybolur.
 *
 * `g` sonra `p` ("go to properties") deseni bu riski ortadan kaldırıyor:
 *   · iki tuşluk dizi kazara oluşmaz
 *   · tarayıcı/işletim sistemi kısayollarıyla çakışmaz (Ctrl/Alt gerekmez)
 *   · Gmail, GitHub, Linear aynı deseni kullanıyor — öğrenilmiş bir dil
 *
 * ============================================================================
 * GİRDİ ALANLARINDA DEVRE DIŞI
 * ============================================================================
 * Kullanıcı bir input/textarea/contenteditable içinde yazıyorsa hiçbir kısayol
 * çalışmaz. Bu, "sayfa aniden değişti" hatasının tek gerçek sebebi ve
 * kısayolların en sık şikâyet konusu.
 */

type Kisayol = { tuslar: string; hedef: string; etiket: string };

/** `g` önekinden sonraki harf → gidilecek yol. */
const GIT: Kisayol[] = [
  { tuslar: "g p", hedef: "/app/portfoyler", etiket: "Portföyler" },
  { tuslar: "g m", hedef: "/app/musteriler", etiket: "Müşteriler" },
  { tuslar: "g t", hedef: "/app/talepler", etiket: "Talepler" },
  { tuslar: "g a", hedef: "/app/anlasmalar", etiket: "Anlaşmalar" },
  { tuslar: "g g", hedef: "/app/gorevler", etiket: "Görevler" },
  { tuslar: "g r", hedef: "/app/randevular", etiket: "Randevular" },
  { tuslar: "g k", hedef: "/app/komisyon", etiket: "Komisyon" },
  { tuslar: "g e", hedef: "/app/eslestirme", etiket: "Eşleştirme" },
  { tuslar: "g d", hedef: "/app/degerleme", etiket: "Değerleme" },
  { tuslar: "g h", hedef: "/app", etiket: "Ana panel" },
];

const HARF_YOL = new Map(GIT.map((k) => [k.tuslar.split(" ")[1], k.hedef]));

/** Yazma alanında mıyız? Kısayolların en sık şikâyet sebebi bu kontrol. */
function yaziyorMu(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    el.isContentEditable === true ||
    // Radix combobox/listbox içinde de yazma sayılır.
    el.getAttribute?.("role") === "combobox" ||
    el.closest?.("[role='dialog'] input, [role='listbox']") != null
  );
}

export function KeyboardShortcuts() {
  const router = useRouter();
  const [yardimAcik, setYardimAcik] = useState(false);

  useEffect(() => {
    // `g` basıldıktan sonra ikinci tuşu bekleyen durum. Zaman aşımı var:
    // kullanıcı `g` basıp vazgeçerse sonraki harf kısayola dönüşmemeli.
    let bekleyen = false;
    let zamanlayici: ReturnType<typeof setTimeout> | null = null;

    function iptal() {
      bekleyen = false;
      if (zamanlayici) clearTimeout(zamanlayici);
      zamanlayici = null;
    }

    function onKey(e: KeyboardEvent) {
      // Değiştirici tuşlarla gelen her şey tarayıcının/paletin işi.
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (yaziyorMu(e.target)) return;

      const k = e.key.toLowerCase();

      if (k === "escape") {
        iptal();
        return;
      }

      // `?` → yardım. Shift gerektiği için `e.key` doğrudan "?" gelir.
      if (e.key === "?") {
        e.preventDefault();
        setYardimAcik((v) => !v);
        return;
      }

      if (bekleyen) {
        const yol = HARF_YOL.get(k);
        iptal();
        if (yol) {
          e.preventDefault();
          router.push(yol);
        }
        return;
      }

      if (k === "g") {
        bekleyen = true;
        // 1,2 sn: iki tuşu ayrı ayrı basan kullanıcı için rahat, kazara
        // birleşme için kısa.
        zamanlayici = setTimeout(iptal, 1200);
      }
    }

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      iptal();
    };
  }, [router]);

  return (
    <Dialog open={yardimAcik} onOpenChange={setYardimAcik}>
      <DialogContent size="sm">
        <DialogHeader
          icon={<Keyboard />}
          title="Klavye kısayolları"
          description="Yazma alanında değilken çalışır."
        />
        <div className="p-6">
          <dl className="space-y-1.5">
            {[
              { tuslar: "Ctrl K", etiket: "Komut paleti / arama" },
              { tuslar: "?", etiket: "Bu pencere" },
              ...GIT,
            ].map((k) => (
              <div
                key={k.tuslar}
                className="flex items-center justify-between gap-4 rounded-[10px] px-3 py-2 odd:bg-canvas"
              >
                <dt className="text-sm text-ink-950">{k.etiket}</dt>
                <dd className="flex shrink-0 gap-1">
                  {k.tuslar.split(" ").map((t, i) => (
                    <kbd
                      key={`${k.tuslar}-${i}`}
                      className="numeric min-w-[22px] rounded-[6px] border border-line bg-surface px-1.5 py-0.5 text-center text-[11px] font-semibold text-text-muted shadow-[var(--shadow-xs)]"
                    >
                      {t}
                    </kbd>
                  ))}
                </dd>
              </div>
            ))}
          </dl>

          <p className="mt-4 text-[11px] leading-relaxed text-text-faint">
            <strong>g</strong> önekli iki tuşluk dizi bilinçli: tek harfli kısayol, bir nota ya da
            arama kutusuna yazarken odak kaybolduğunda sayfayı aniden değiştirip yazılanı
            kaybettirebilir.
          </p>

          <div className="hairline-t mt-4 flex justify-end pt-4">
            <DialogClose asChild>
              <button
                type="button"
                className="focus-ring press inline-flex items-center gap-1.5 rounded-[10px] border border-hairline px-4 py-2.5 text-sm font-medium text-ink-950 transition hover:bg-canvas"
              >
                <X className="h-4 w-4" /> Kapat
              </button>
            </DialogClose>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
