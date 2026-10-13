"use client";

import { useRef, useState, useTransition } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmailInput } from "@/components/ui/email-input";
import { addEmailSuppressionAction, removeEmailSuppressionAction } from "@/app/actions/platform-email-log";

/** Elle bastırma: adres + gerekçe (adres sunucuda özetlenir, düz saklanmaz). */
export function AddSuppressionForm() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={formRef}
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        setMsg(null);
        start(async () => {
          const r = await addEmailSuppressionAction(fd);
          if (r.ok) formRef.current?.reset();
          setMsg(r.ok ? { ok: true, text: "Adres bastırma listesine eklendi." } : { ok: false, text: r.error ?? "Eklenemedi." });
        });
      }}
    >
      <label className="grid min-w-[220px] flex-1 gap-1 text-xs font-semibold text-text-muted">
        E-posta adresi
        <EmailInput name="email" required placeholder="ornek@alanadi.com" />
      </label>
      <label className="grid min-w-[220px] flex-1 gap-1 text-xs font-semibold text-text-muted">
        Gerekçe
        <input
          name="note"
          required
          minLength={3}
          maxLength={300}
          placeholder="Ör. KVKK itirazı, kullanıcı talebi"
          className="rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2 text-sm text-ink-950"
        />
      </label>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
        Bastır
      </Button>
      {msg ? (
        <p role="status" className={`w-full text-sm font-medium ${msg.ok ? "text-mint-700" : "text-danger-600"}`}>
          {msg.text}
        </p>
      ) : null}
    </form>
  );
}

/** Bastırmayı kaldır (adres yeniden e-posta alabilir). */
export function RemoveSuppressionButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <ConfirmDialog
        title="Bastırma kaldırılsın mı?"
        description="Bu adres yeniden işlemsel e-posta alabilecek. Bounce sürüyorsa adres bir sonraki geri dönüşte listeye tekrar girer."
        confirmLabel="Kaldır"
        onConfirm={() =>
          new Promise<void>((resolve) =>
            start(async () => {
              const r = await removeEmailSuppressionAction(id);
              setError(r.ok ? null : (r.error ?? "Kaldırılamadı."));
              resolve();
            }),
          )
        }
        trigger={
          <Button variant="outline" size="sm" type="button" disabled={pending}>
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            Kaldır
          </Button>
        }
      />
      {error ? <span className="text-xs text-danger-600">{error}</span> : null}
    </span>
  );
}
