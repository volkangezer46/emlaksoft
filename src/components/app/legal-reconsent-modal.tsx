"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, FileText } from "lucide-react";
import { acceptLegalUpdates } from "@/app/actions/legal-consent";
import { signOut } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";

/**
 * Yeniden onay penceresi: kapatılamaz (Esc/dış tık yok); kullanıcı metinleri yeni sekmede okuyup onaylar ya da çıkış
 * yapar. Onay sunucuda IP ve zamanla kaydedilir (acceptLegalUpdates). Tıklama anında düğme "Kaydediliyor" olur.
 */
export function LegalReconsentModal({ docs }: { docs: readonly { slug: string; title: string; version: number }[] }) {
  const router = useRouter();
  const [checked, setChecked] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (done) return null;

  function accept() {
    setError(null);
    start(async () => {
      const r = await acceptLegalUpdates().catch(() => ({ ok: false, error: "Bağlantı hatası; tekrar deneyin." }));
      if (!r.ok) {
        setError(r.error ?? "Onay kaydedilemedi; tekrar deneyin.");
        return;
      }
      setDone(true);
      router.refresh();
    });
  }

  return (
    <div className="fixed inset-0 z-[90] grid place-items-center bg-ink-950/60 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="yasal-onay-baslik"
        aria-describedby="yasal-onay-aciklama"
        className="w-full max-w-lg rounded-[var(--radius-panel)] border border-line bg-surface p-6 shadow-[var(--shadow-lg)]"
      >
        <h2 id="yasal-onay-baslik" className="flex items-center gap-2 font-display text-lg font-bold text-ink-950">
          <FileText className="h-5 w-5 text-brand-600" aria-hidden /> Yasal metinlerimiz güncellendi
        </h2>
        <p id="yasal-onay-aciklama" className="mt-2 text-sm text-text-muted">
          Devam etmeden önce güncellenen metinleri okuyup onaylamanız gerekiyor. Onayınız tarih ve bağlantı bilgisiyle kayıt altına alınır.
        </p>
        <ul className="mt-4 space-y-2">
          {docs.map((d) => (
            <li key={d.slug}>
              <a
                href={`/${d.slug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="focus-ring flex min-h-11 items-center justify-between gap-3 rounded-[var(--radius-control)] border border-line px-3 py-2 text-sm font-semibold text-ink-950 transition hover:border-brand-300"
              >
                <span>
                  {d.title} <span className="font-normal text-text-muted">(sürüm {d.version})</span>
                </span>
                <ExternalLink className="h-4 w-4 shrink-0 text-text-faint" aria-hidden />
                <span className="sr-only"> (yeni sekmede açılır)</span>
              </a>
            </li>
          ))}
        </ul>
        <label className="mt-4 flex min-h-11 cursor-pointer items-start gap-3 text-sm text-text">
          <input type="checkbox" className="mt-1 h-4 w-4" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
          <span>Güncellenen metinleri okudum ve kabul ediyorum.</span>
        </label>
        {error ? (
          <p className="mt-2 text-sm text-danger-600" role="alert">
            {error}
          </p>
        ) : null}
        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          <form action={signOut}>
            <Button type="submit" variant="ghost">
              Çıkış yap
            </Button>
          </form>
          <Button type="button" onClick={accept} disabled={!checked || pending} loading={pending}>
            {pending ? "Kaydediliyor…" : "Onayla ve devam et"}
          </Button>
        </div>
      </div>
    </div>
  );
}
