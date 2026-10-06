"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { closeLowScoreFollowUp } from "@/app/actions/surveys";

const MIN = 10;

/**
 * Düşük puan takibini kapatma (satır içi; popup değil). Aksiyon notu ZORUNLU (en az 10 karakter): ne yapıldı,
 * müşteri ne dedi. Not kapanış raporunda görünür; takip görevi aynı anda tamamlanır.
 */
export function LowScoreCloseForm({ taskId }: { taskId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const ready = note.trim().length >= MIN;

  if (!open) {
    return (
      <Button size="sm" variant="secondary" icon={CheckCircle2} onClick={() => setOpen(true)}>
        Aksiyon notuyla kapat
      </Button>
    );
  }

  return (
    <div className="mt-2 w-full space-y-2">
      <textarea
        rows={2}
        maxLength={2000}
        value={note}
        onChange={(e) => {
          setNote(e.target.value);
          setMessage(null);
        }}
        aria-label="Aksiyon notu"
        placeholder="Ne yapıldı? Örn. Müşteri arandı, komisyon iadesi konuşuldu, randevu verildi."
        className="w-full resize-y rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand-400"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          loading={pending}
          disabled={!ready}
          onClick={() =>
            startTransition(async () => {
              const res = await closeLowScoreFollowUp(taskId, note);
              if (res.error) {
                setMessage({ tone: "err", text: res.error });
                return;
              }
              setMessage({ tone: "ok", text: res.message ?? "Kapatıldı." });
              router.refresh();
            })
          }
        >
          Kapat
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Vazgeç
        </Button>
        <span className="text-xs text-text-muted">{ready ? "Hazır" : `En az ${MIN} karakter (${note.trim().length}/${MIN})`}</span>
      </div>
      {message ? (
        <p role={message.tone === "err" ? "alert" : "status"} className={`text-xs font-semibold ${message.tone === "err" ? "text-danger-500" : "text-mint-700"}`}>
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
