"use client";

import { useActionState, useState, useTransition } from "react";
import { KeyRound, Plus, RotateCw, Send, Trash2 } from "lucide-react";
import {
  createApiKey,
  createWebhookEndpoint,
  deleteWebhookEndpoint,
  revealWebhookSecret,
  revokeApiKey,
  sendTestWebhook,
  setWebhookActive,
  type IntegrationResult,
} from "@/app/actions/integrations-api";
import { useToast } from "@/components/app/toast-provider";
import { CopyTextButton } from "@/components/app/copy-text-button";
import { Button } from "@/components/ui/button";
import { FormInput } from "@/components/ui/form-controls";
import { API_RESOURCES, API_RESOURCE_LABELS, WEBHOOK_EVENTS, WEBHOOK_EVENT_LABELS } from "@/lib/integrations-api/labels";

export function ApiKeyCreateForm() {
  const [state, action, pending] = useActionState<IntegrationResult, FormData>(createApiKey, {});
  return (
    <form action={action} className="mt-3 space-y-3 rounded-[var(--radius-card)] border border-line bg-canvas p-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <label className="space-y-1.5">
          <span className="block text-xs font-semibold text-ink-950">Anahtar adı</span>
          <FormInput name="name" maxLength={80} required placeholder="Ör. Web sitesi ilan senkronu" />
        </label>
        <Button type="submit" icon={KeyRound} loading={pending}>
          Anahtar oluştur
        </Button>
      </div>
      <fieldset className="flex flex-wrap gap-3">
        <legend className="mb-1 text-xs font-semibold text-ink-950">Okuma kapsamı</legend>
        {API_RESOURCES.map((r) => (
          <label key={r} className="inline-flex items-center gap-1.5 text-sm text-ink-950">
            <input type="checkbox" name="scopes" value={r} defaultChecked={r === "properties"} className="h-4 w-4" /> {API_RESOURCE_LABELS[r]}
          </label>
        ))}
      </fieldset>
      {state.error ? <p role="alert" className="text-sm text-danger-600">{state.error}</p> : null}
      {state.key ? (
        <div className="rounded-[var(--radius-card)] border border-amber-400/50 bg-amber-400/[0.08] p-3">
          <p className="text-xs font-semibold text-amber-800">Anahtar yalnız şimdi gösteriliyor — kopyalayıp güvenli bir yerde saklayın.</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="break-all rounded bg-surface px-2 py-1 text-xs text-ink-950">{state.key}</code>
            <CopyTextButton text={state.key} label="Kopyala" doneMessage="Anahtar kopyalandı" />
          </div>
        </div>
      ) : null}
    </form>
  );
}

export function ApiKeyRevokeButton({ id }: { id: string }) {
  const [busy, start] = useTransition();
  const { push } = useToast();
  return (
    <Button
      variant="ghost"
      size="sm"
      icon={Trash2}
      loading={busy}
      onClick={() => {
        const fd = new FormData();
        fd.set("id", id);
        start(async () => {
          const res = await revokeApiKey(fd);
          if (res.error) push(res.error, "err");
          else push("Anahtar iptal edildi");
        });
      }}
    >
      İptal et
    </Button>
  );
}

export function WebhookCreateForm() {
  const [state, action, pending] = useActionState<IntegrationResult, FormData>(createWebhookEndpoint, {});
  return (
    <form action={action} className="mt-3 space-y-3 rounded-[var(--radius-card)] border border-line bg-canvas p-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <label className="space-y-1.5">
          <span className="block text-xs font-semibold text-ink-950">Webhook adresi (https)</span>
          <FormInput name="url" type="url" inputMode="url" maxLength={500} required placeholder="https://ornek.com/emlaksoft-webhook" />
        </label>
        <Button type="submit" icon={Plus} loading={pending}>
          Ekle
        </Button>
      </div>
      <fieldset className="flex flex-wrap gap-3">
        <legend className="mb-1 text-xs font-semibold text-ink-950">Olaylar</legend>
        {WEBHOOK_EVENTS.map((e) => (
          <label key={e} className="inline-flex items-center gap-1.5 text-sm text-ink-950">
            <input type="checkbox" name="events" value={e} defaultChecked className="h-4 w-4" /> {WEBHOOK_EVENT_LABELS[e]}
          </label>
        ))}
      </fieldset>
      {state.error ? <p role="alert" className="text-sm text-danger-600">{state.error}</p> : null}
      {state.ok ? <p className="text-sm text-mint-700">Webhook eklendi. İmza anahtarını aşağıdan görüntüleyin.</p> : null}
    </form>
  );
}

export function WebhookRowActions({ id, active }: { id: string; active: boolean }) {
  const [busy, start] = useTransition();
  const [secret, setSecret] = useState<string | null>(null);
  const { push } = useToast();
  const run = (fn: (fd: FormData) => Promise<IntegrationResult>, extra: Record<string, string>, done: (r: IntegrationResult) => void) => {
    const fd = new FormData();
    fd.set("id", id);
    for (const [k, v] of Object.entries(extra)) fd.set(k, v);
    start(async () => {
      const res = await fn(fd);
      if (res.error) push(res.error, "err");
      else done(res);
    });
  };
  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap items-center gap-1">
        <Button variant="ghost" size="sm" icon={Send} loading={busy} onClick={() => run(sendTestWebhook, {}, (r) => push(`Test gönderildi (HTTP ${r.status ?? "?"})`))}>
          Test
        </Button>
        <Button variant="ghost" size="sm" icon={KeyRound} onClick={() => run(revealWebhookSecret, {}, (r) => setSecret(r.secret ?? null))}>
          İmza anahtarı
        </Button>
        <Button variant="ghost" size="sm" icon={RotateCw} onClick={() => run(revealWebhookSecret, { rotate: "1" }, (r) => { setSecret(r.secret ?? null); push("İmza anahtarı yenilendi; eskisi artık geçersiz"); })}>
          Yenile
        </Button>
        <Button variant="ghost" size="sm" onClick={() => run(setWebhookActive, { active: active ? "0" : "1" }, () => push(active ? "Webhook kapatıldı" : "Webhook açıldı"))}>
          {active ? "Kapat" : "Aç"}
        </Button>
        <Button variant="ghost" size="sm" icon={Trash2} onClick={() => run(deleteWebhookEndpoint, {}, () => push("Webhook silindi"))}>
          Sil
        </Button>
      </div>
      {secret ? (
        <div className="flex flex-wrap items-center gap-2">
          <code className="break-all rounded bg-canvas px-2 py-1 text-xs text-ink-950">{secret}</code>
          <CopyTextButton text={secret} label="Kopyala" doneMessage="İmza anahtarı kopyalandı" />
        </div>
      ) : null}
    </div>
  );
}
