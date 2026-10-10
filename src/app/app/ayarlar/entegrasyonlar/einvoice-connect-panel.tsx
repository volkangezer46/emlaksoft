"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, PlugZap, Unplug } from "lucide-react";
import {
  removeEInvoiceConnection,
  saveEInvoiceConnection,
  testEInvoiceConnection,
  type EInvoiceActionResult,
} from "@/app/actions/einvoice";
import { useToast } from "@/components/app/toast-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormField, Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import {
  EINVOICE_PROVIDER_LIST,
  EINVOICE_PROVIDER_META,
  MODE_LABEL,
} from "@/lib/integrations/einvoice/providers";
import type { EInvoiceMode, EInvoiceProviderId } from "@/lib/integrations/einvoice/types";

export type EInvoiceConnectionView = {
  provider: EInvoiceProviderId;
  mode: EInvoiceMode;
  status: "active" | "error";
  fingerprint: string | null;
  companyName: string | null;
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  lastError: string | null;
};

function fmt(iso: string | null): string {
  if (!iso) return "henüz denenmedi";
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Istanbul" }).format(new Date(iso));
}

export function EInvoiceConnectPanel({ connection, canEdit }: { connection: EInvoiceConnectionView | null; canEdit: boolean }) {
  const router = useRouter();
  const { push } = useToast();
  const [replacing, setReplacing] = useState(false);
  const [provider, setProvider] = useState<EInvoiceProviderId>(connection?.provider ?? "nilvera");
  const [mode, setMode] = useState<EInvoiceMode>(connection?.mode ?? "sandbox");
  const [testing, startTest] = useTransition();
  const [removing, startRemove] = useTransition();
  const meta = EINVOICE_PROVIDER_META[provider];
  const effectiveMode: EInvoiceMode = meta.modes.includes(mode) ? mode : "live";

  const [state, action, pending] = useActionState<EInvoiceActionResult, FormData>(async (prev, formData) => {
    const result = await saveEInvoiceConnection(prev, formData);
    if (result.ok) {
      push(result.message ?? "Bağlandı", "ok");
      setReplacing(false);
      router.refresh();
    }
    return result;
  }, {});

  const showForm = canEdit && (!connection || replacing);

  return (
    <div className="space-y-4">
      {connection ? (
        <div className="flex flex-wrap items-start justify-between gap-3 rounded-[var(--radius-card)] border border-line bg-canvas/60 p-3">
          <div className="space-y-1 text-sm">
            <p className="flex flex-wrap items-center gap-2 font-semibold text-ink-950">
              {EINVOICE_PROVIDER_META[connection.provider].name}
              <Badge variant={connection.mode === "sandbox" ? "warning" : "info"} size="sm">{MODE_LABEL[connection.mode]}</Badge>
              <Badge variant={connection.status === "active" ? "success" : "danger"} size="sm" dot>
                {connection.status === "active" ? "Bağlı" : "Hata var"}
              </Badge>
            </p>
            {connection.companyName ? <p className="text-xs text-text-muted">{connection.companyName}</p> : null}
            <p className="text-xs text-text-faint">
              Son deneme: {fmt(connection.lastTestAt)}
              {connection.fingerprint ? ` · anahtar izi ${connection.fingerprint}` : ""}
            </p>
            {connection.lastError ? <p className="text-xs font-semibold text-danger-600" role="alert">{connection.lastError}</p> : null}
            {connection.mode === "sandbox" ? (
              <p className="text-xs text-text-muted">Test kipinde kesilen faturalar gerçek değildir.</p>
            ) : null}
          </div>
          {canEdit ? (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                icon={PlugZap}
                loading={testing}
                onClick={() =>
                  startTest(async () => {
                    const res = await testEInvoiceConnection();
                    if (res.error) push(res.error, "err");
                    else push(res.message ?? "Bağlantı çalışıyor", "ok");
                    router.refresh();
                  })
                }
              >
                Bağlantıyı test et
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setReplacing((v) => !v)}>
                {replacing ? "Vazgeç" : "Bilgileri değiştir"}
              </Button>
              <ConfirmDialog
                trigger={<Button type="button" variant="ghost" size="sm" icon={Unplug} loading={removing}>Bağlantıyı kaldır</Button>}
                title="e-Fatura bağlantısı kaldırılsın mı?"
                description="Kesilmiş faturalar sağlayıcıda ve listede kalır. Yeni fatura kesmek için yeniden bağlamanız gerekir."
                confirmLabel="Kaldır"
                onConfirm={() =>
                  startRemove(async () => {
                    const res = await removeEInvoiceConnection();
                    if (res.error) push(res.error, "err");
                    else push(res.message ?? "Kaldırıldı", "ok");
                    router.refresh();
                  })
                }
              />
            </div>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-text-muted">
          Henüz bağlı değil. Bir sağlayıcı seçip bilgilerinizi girin; kaydetmeden önce bağlantı sınanır.
        </p>
      )}

      {!canEdit && !connection ? <p className="text-xs text-text-faint">Bağlantıyı yalnız ofis yöneticisi kurabilir.</p> : null}

      {showForm ? (
        <form action={action} aria-busy={pending} className="space-y-3 rounded-[var(--radius-card)] border border-line bg-surface p-4">
          <input type="hidden" name="provider" value={provider} />
          <input type="hidden" name="mode" value={effectiveMode} />
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Sağlayıcı" htmlFor="einvoice-provider">
              <Select value={provider} onValueChange={(v) => setProvider(v as EInvoiceProviderId)}>
                <SelectTrigger id="einvoice-provider" aria-label="e-Fatura sağlayıcısı" placeholder="Sağlayıcı seçin" />
                <SelectContent>
                  {EINVOICE_PROVIDER_LIST.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            {meta.modes.length > 1 ? (
              <FormField label="Ortam" htmlFor="einvoice-mode" hint="Önce Test ile deneyin; gerçek fatura için Canlı seçin.">
                <Select value={effectiveMode} onValueChange={(v) => setMode(v as EInvoiceMode)}>
                  <SelectTrigger id="einvoice-mode" aria-label="Ortam" placeholder="Ortam seçin" />
                  <SelectContent>
                    {meta.modes.map((m) => (
                      <SelectItem key={m} value={m}>{MODE_LABEL[m]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            ) : null}
          </div>
          <p className="text-xs text-text-muted">{meta.summary} Belge türleri: {meta.docTypes}.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {meta.fields.map((f) => (
              <FormField key={`${provider}-${f.name}`} label={f.label} htmlFor={`einvoice-${f.name}`} hint={f.hint}>
                <Input id={`einvoice-${f.name}`} name={f.name} type={f.type} autoComplete={f.autoComplete ?? "off"} required spellCheck={false} />
              </FormField>
            ))}
          </div>
          {state.error ? <p className="text-sm font-semibold text-danger-600" role="alert">{state.error}</p> : null}
          <div className="flex items-center gap-3">
            <Button type="submit" loading={pending} icon={CheckCircle2}>Bağla ve test et</Button>
            <p className="text-xs text-text-faint">Anahtarlar şifreli saklanır ve bir daha gösterilmez.</p>
          </div>
        </form>
      ) : null}
    </div>
  );
}
