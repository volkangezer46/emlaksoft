"use client";

import { useEffect, useRef, useState } from "react";
import { ImageDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { importPropertyPhotos } from "@/app/actions/import-photos";

const nf = new Intl.NumberFormat("tr-TR");

/**
 * Fotoğraf bağlantılarını galeriye indirir: portföy portföy `importPropertyPhotos` (çağrı başına birkaç bağlantı)
 * çağrılır; durdurulabilir, kaldığı yerden devam eder (bekleyen liste portföyde saklanır).
 */
export function PhotoImporter({ ids, totalUrls, autoStart, resume = false }: { ids: string[]; totalUrls?: number; autoStart: boolean; resume?: boolean }) {
  const [running, setRunning] = useState(false);
  const [doneProps, setDoneProps] = useState(0);
  const [added, setAdded] = useState(0);
  const [failed, setFailed] = useState(0);
  const [error, setError] = useState("");
  const [finished, setFinished] = useState(false);
  const stopRef = useRef(false);
  const cursor = useRef(0);
  const started = useRef(false);

  const run = async () => {
    stopRef.current = false;
    setRunning(true);
    setError("");
    while (cursor.current < ids.length && !stopRef.current) {
      const id = ids[cursor.current]!;
      let res;
      try {
        res = await importPropertyPhotos(id);
      } catch {
        setError("Bağlantı koptu; devam etmek için yeniden başlatın.");
        break;
      }
      setAdded((n) => n + (res.added ?? 0));
      setFailed((n) => n + (res.failed ?? 0));
      if (res.error) {
        setError(`${res.error} Birkaç dakika sonra "Devam et" ile kaldığı yerden sürdürebilirsiniz.`);
        break;
      }
      if ((res.remaining ?? 0) === 0) {
        cursor.current += 1;
        setDoneProps(cursor.current);
      }
    }
    if (cursor.current >= ids.length) setFinished(true);
    setRunning(false);
  };

  useEffect(() => {
    if (!autoStart || started.current) return;
    started.current = true;
    // Aktarma biter bitmez arka arkaya indirme başlar (kullanıcı durdurabilir).
    const t = setTimeout(() => void run(), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart]);

  const pct = ids.length ? Math.round((doneProps / ids.length) * 100) : 100;
  return (
    <div className="space-y-2 rounded-[var(--radius-card)] border border-line bg-surface p-4" role="status" aria-live="polite">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-control)] bg-brand-600/10 text-brand-600">
            <ImageDown className="h-4.5 w-4.5" aria-hidden="true" />
          </span>
          <div>
            <p className="text-sm font-semibold text-ink-950">
              {finished
                ? "Fotoğraflar galeriye aktarıldı"
                : resume
                  ? `${nf.format(ids.length)} portföyde bekleyen fotoğraf var${totalUrls ? ` (${nf.format(totalUrls)} bağlantı)` : ""}`
                  : `Fotoğraflar indiriliyor: ${nf.format(doneProps)}/${nf.format(ids.length)} portföy`}
            </p>
            <p className="text-xs text-text-muted">
              {nf.format(added)} fotoğraf eklendi
              {failed ? ` · ${nf.format(failed)} bağlantı indirilemedi (erişilemeyen ya da görsel olmayan)` : ""}
              {!finished && running ? " · sayfayı açık tutun" : ""}
            </p>
          </div>
        </div>
        {finished ? null : running ? (
          <Button variant="secondary" size="sm" onClick={() => (stopRef.current = true)}>
            Duraklat
          </Button>
        ) : (
          <Button size="sm" onClick={() => void run()}>
            <ImageDown className="h-3.5 w-3.5" /> {doneProps > 0 || error ? "Devam et" : "Fotoğrafları indir"}
          </Button>
        )}
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-canvas">
        <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${pct}%` }} />
      </div>
      {error ? (
        <p className="text-xs text-danger-600" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
