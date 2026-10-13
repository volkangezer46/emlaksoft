"use client";

import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ShellShortcut } from "@/lib/nav-shell";

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

// Radix Dialog + gövde yalnız ilk "?" basışında indirilir (layout'ta her sayfaya yüklenmesin).
const KisayolDialog = lazy(() =>
  import("./keyboard-shortcuts-dialog").then((m) => ({ default: m.KeyboardShortcutsDialog })),
);

/**
 * Kısayol listeleri SUNUCUDAN gelir (app/layout.tsx → nav-shell-server `buildShortcuts`; menü kataloğu istemci
 * paketine girmesin diye): `g` önekinden sonraki harf → gidilecek yol (TEK kaynak: nav-config `shortcut` alanı →
 * NAV_SHORTCUTS); `n` önekinden sonraki harf → "Yeni ..." sayfası (palette-core APP_ACTIONS.shortcut ile birebir).
 */
const harfYol = (list: readonly ShellShortcut[]) => new Map(list.map((k) => [k.tuslar.split(" ")[1], k.hedef]));

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

export function KeyboardShortcuts({ go: GIT, create: YENI }: { go: ShellShortcut[]; create: ShellShortcut[] }) {
  const router = useRouter();
  const [yardimAcik, setYardimAcik] = useState(false);
  const [yardimYuklendi, setYardimYuklendi] = useState(false);
  // Harf → yol tabloları ref'te: sunucu tazelemesi (yeni prop dizisi) dinleyiciyi yeniden kurup bekleyen öneki silmez.
  const yollar = useRef<{ g: Map<string | undefined, string>; n: Map<string | undefined, string> } | null>(null);
  useEffect(() => {
    yollar.current = { g: harfYol(GIT), n: harfYol(YENI) };
  }, [GIT, YENI]);

  useEffect(() => {
    // `g` basıldıktan sonra ikinci tuşu bekleyen durum. Zaman aşımı var:
    // kullanıcı `g` basıp vazgeçerse sonraki harf kısayola dönüşmemeli.
    let bekleyen = false;
    let onek: "g" | "n" = "g";
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
        setYardimYuklendi(true);
        setYardimAcik((v) => !v);
        return;
      }

      if (bekleyen) {
        const yol = yollar.current?.[onek].get(k);
        iptal();
        if (yol) {
          e.preventDefault();
          router.push(yol);
        }
        return;
      }

      if (k === "g" || k === "n") {
        onek = k;
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

  if (!yardimYuklendi) return null;
  return (
    <Suspense fallback={null}>
      <KisayolDialog
        open={yardimAcik}
        onOpenChange={setYardimAcik}
        satirlar={[
          { tuslar: "Ctrl K", etiket: "Komut paleti / arama" },
          { tuslar: "?", etiket: "Bu pencere" },
          ...GIT,
          ...YENI,
        ]}
      />
    </Suspense>
  );
}
