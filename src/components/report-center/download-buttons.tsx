"use client";

import { useState } from "react";
import { FileSpreadsheet, FileText, FileType2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Biçim seçimi + indirme. Dosya GET uç noktasından `fetch` ile alınır (hata JSON'u dosya diye inmesin: 403/429/500
 * mesajı düğmenin altında satır içi gösterilir). Büyük çıktıda sunucu satır tavanı uygular; kesilirse uyarı çıkar.
 * Bu bileşen yalnız düz dizeler alır — katalog / biçim yazıcıları istemci paketine GİRMEZ.
 */
type Fmt = "xlsx" | "pdf" | "csv";

const FORMATS: { id: Fmt; label: string; icon: typeof FileText; variant: "primary" | "outline" }[] = [
  { id: "xlsx", label: "Excel (.xlsx)", icon: FileSpreadsheet, variant: "primary" },
  { id: "pdf", label: "PDF", icon: FileText, variant: "outline" },
  { id: "csv", label: "CSV", icon: FileType2, variant: "outline" },
];

export function ReportDownloadButtons({
  hrefs,
  disabled,
  disabledReason,
  limits,
  total,
}: {
  /** Biçim → indirme adresi (uygulanmış filtrelerle). */
  hrefs: Record<Fmt, string>;
  disabled?: boolean;
  disabledReason?: string;
  /** Biçim başına satır tavanı (uyarı için). */
  limits: Record<Fmt, number>;
  /** Filtreye uyan toplam satır. */
  total: number;
}) {
  const [busy, setBusy] = useState<Fmt | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "warn" | "err"; text: string } | null>(null);

  async function download(fmt: Fmt) {
    setBusy(fmt);
    setMessage(null);
    try {
      const res = await fetch(hrefs[fmt], { credentials: "same-origin" });
      if (!res.ok) {
        let text = "Rapor hazırlanamadı. Lütfen tekrar deneyin.";
        try {
          const body = (await res.json()) as { error?: string };
          if (body.error) text = body.error;
        } catch {
          /* gövde JSON değil */
        }
        setMessage({ tone: "err", text });
        return;
      }
      const blob = await res.blob();
      const cd = res.headers.get("content-disposition") ?? "";
      const star = /filename\*=UTF-8''([^;]+)/i.exec(cd);
      const plain = /filename="([^"]+)"/i.exec(cd);
      const filename = star ? decodeURIComponent(star[1]!) : (plain?.[1] ?? `rapor.${fmt}`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      const rows = Number(res.headers.get("x-report-rows") ?? 0);
      if (res.headers.get("x-report-truncated") === "1") {
        setMessage({ tone: "warn", text: `Dosya ilk ${rows.toLocaleString("tr-TR")} satırla sınırlandı (üst sınır). Tamamı için filtreyi daraltın.` });
      } else {
        setMessage({ tone: "ok", text: `${filename} indirildi (${rows.toLocaleString("tr-TR")} satır).` });
      }
    } catch {
      setMessage({ tone: "err", text: "Bağlantı sorunu: dosya indirilemedi. Lütfen tekrar deneyin." });
    } finally {
      setBusy(null);
    }
  }

  const overLimit = FORMATS.filter((f) => total > limits[f.id]).map((f) => `${f.label.split(" ")[0]} (en çok ${limits[f.id].toLocaleString("tr-TR")} satır)`);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {FORMATS.map((f) => (
          <Button
            key={f.id}
            variant={f.variant}
            size="lg"
            icon={f.icon}
            loading={busy === f.id}
            disabled={disabled || busy !== null}
            onClick={() => void download(f.id)}
            className="min-h-11"
          >
            {f.label}
          </Button>
        ))}
      </div>
      {disabled && disabledReason ? <p className="text-xs text-text-muted">{disabledReason}</p> : null}
      {!disabled && overLimit.length > 0 ? (
        <p className="text-xs text-text-muted">
          Kayıt sayısı şu biçimlerde üst sınırı aşıyor: {overLimit.join(", ")}. Bu biçimlerde dosya sınır kadar satırla kesilir ve dosyada uyarı yazar; tamamı için filtreyi daraltın.
        </p>
      ) : null}
      {message ? (
        <p
          role={message.tone === "err" ? "alert" : "status"}
          className={`text-sm font-medium ${message.tone === "err" ? "text-danger-600" : message.tone === "warn" ? "text-warning-700" : "text-success-600"}`}
        >
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
