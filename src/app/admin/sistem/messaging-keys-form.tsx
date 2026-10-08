"use client";

import { Button } from "@/components/ui/button";
import { useState, useTransition } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MessageSquare, Save, Trash2 } from "lucide-react";
import {
  clearNetgsmKeys,
  clearWhatsappKeys,
  saveNetgsmKeys,
  saveWhatsappKeys,
  type MessagingKeyResult,
} from "@/app/actions/platform-messaging-keys";

const field =
  "focus-ring h-10 w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 font-mono text-sm text-ink-950 outline-none focus:border-brand-300";

function Badge({ configured }: { configured: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${
        configured ? "bg-mint-500/12 text-mint-600" : "bg-amber-400/15 text-amber-600"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${configured ? "bg-mint-500" : "bg-amber-500"}`} />
      {configured ? "Tanımlı" : "Bekliyor"}
    </span>
  );
}

function Card({
  title,
  description,
  configured,
  summary,
  canEdit,
  saveAction,
  clearAction,
  children,
}: {
  title: string;
  description: string;
  configured: boolean;
  /** Maskeli özet (parola/anahtar içermez). */
  summary: string | null;
  canEdit: boolean;
  saveAction: (fd: FormData) => Promise<MessagingKeyResult>;
  clearAction: () => Promise<MessagingKeyResult>;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    setError(null);
    setSaved(false);
    start(async () => {
      const res = await saveAction(fd);
      if (res.error) {
        setError(res.error);
        return;
      }
      form.reset();
      setSaved(true);
      router.refresh();
    });
  }

  function clear() {
    setConfirmClear(false);
    setError(null);
    start(async () => {
      const res = await clearAction();
      if (res.error) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-xs font-semibold text-brand-600">
          <MessageSquare className="h-4 w-4" /> İletişim sağlayıcısı
        </p>
        <Badge configured={configured} />
      </div>
      <h2 className="mt-1 font-display font-bold text-ink-950">{title}</h2>
      <p className="mt-1 text-xs text-text-muted">{description}</p>
      {configured && summary ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-card)] border border-line bg-canvas/60 px-3 py-2.5">
          <span className="font-mono text-sm text-ink-950">{summary}</span>
          {canEdit ? (
            confirmClear ? (
              <span className="inline-flex flex-wrap items-center gap-2 text-xs font-semibold text-amber-800">
                Bilgiler silinsin mi?
                <Button variant="navy" size="xs" type="button" onClick={clear}>Evet, sil</Button>
                <Button variant="outline" size="xs" type="button" onClick={() => setConfirmClear(false)}>Vazgeç</Button>
              </span>
            ) : (
              <Button
                variant="outline"
                size="xs"
                type="button"
                onClick={() => setConfirmClear(true)}
                disabled={pending}
                className="text-danger-500"
              >
                <Trash2 className="h-3 w-3" /> Kaldır
              </Button>
            )
          ) : null}
        </div>
      ) : null}
      {canEdit ? (
        <form onSubmit={onSubmit} className="mt-3 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-text-faint">
            {configured ? "Bilgileri güncelle" : "Yeni bilgi"}
          </p>
          {children}
          {error ? <p role="alert" className="text-xs font-medium text-danger-600">{error}</p> : null}
          {saved ? <p role="status" className="text-xs font-medium text-mint-700">Kaydedildi.</p> : null}
          <Button variant="navy" size="sm" type="submit" disabled={pending}>
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Kaydet
          </Button>
        </form>
      ) : (
        <p className="mt-3 text-xs text-text-faint">Bu bilgiler yalnız süper admin tarafından düzenlenir.</p>
      )}
    </section>
  );
}

/** Platform SMS (Netgsm) ve WhatsApp sağlayıcı formları. Kayıtlı değerler asla geri gösterilmez (yalnız maskeli özet). */
export function MessagingKeysSection({
  canEdit,
  netgsmConfigured,
  netgsmSummary,
  whatsappConfigured,
  whatsappSummary,
}: {
  canEdit: boolean;
  netgsmConfigured: boolean;
  netgsmSummary: string | null;
  whatsappConfigured: boolean;
  whatsappSummary: string | null;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card
        title="Netgsm SMS"
        description="Ofislerin kendi hesabı yoksa platformun yedek SMS hesabı. Parola kaydedildikten sonra bir daha gösterilmez."
        configured={netgsmConfigured}
        summary={netgsmSummary}
        canEdit={canEdit}
        saveAction={saveNetgsmKeys}
        clearAction={clearNetgsmKeys}
      >
        <input name="usercode" type="text" required maxLength={64} autoComplete="off" placeholder="Kullanıcı kodu" aria-label="Netgsm kullanıcı kodu" className={field} />
        <input name="password" type="password" required maxLength={256} autoComplete="new-password" placeholder="Parola" aria-label="Netgsm parolası" className={field} />
        <input name="msgheader" type="text" required maxLength={11} autoComplete="off" placeholder="Onaylı başlık (en çok 11 karakter)" aria-label="Netgsm mesaj başlığı" className={field} />
      </Card>
      <Card
        title="WhatsApp API"
        description="Platform WhatsApp gönderim sağlayıcısı. Adres HTTPS olmalı ve izinli sağlayıcı alan adlarından biri olmalıdır."
        configured={whatsappConfigured}
        summary={whatsappSummary}
        canEdit={canEdit}
        saveAction={saveWhatsappKeys}
        clearAction={clearWhatsappKeys}
      >
        <input name="api_url" type="url" required maxLength={300} autoComplete="off" placeholder="https://…" aria-label="WhatsApp API adresi" className={field} />
        <input name="api_token" type="password" required maxLength={4096} autoComplete="new-password" placeholder="API anahtarı" aria-label="WhatsApp API anahtarı" className={field} />
      </Card>
    </div>
  );
}
