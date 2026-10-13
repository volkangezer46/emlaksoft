"use client";

import { useState, useTransition } from "react";
import { Loader2, PlugZap, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { sendSelfTestEmailAction, sendTemplateSampleAction, testEmailConnectionAction } from "@/app/actions/platform-email";
import type { ConnectionTestResult } from "@/lib/email/test-send";

function statusTr(status: string): string {
  const s = status.toLowerCase();
  if (s === "verified") return "doğrulandı";
  if (s === "failed" || s === "temporary_failure") return "başarısız";
  return "bekliyor";
}

function Pill({ status }: { status: string }) {
  const ok = status.toLowerCase() === "verified";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${ok ? "bg-mint-500/12 text-mint-700" : "bg-amber-400/15 text-amber-700"}`}>
      {statusTr(status)}
    </span>
  );
}

/** "Bağlantıyı test et" + "Kendime test e-postası gönder" (alıcı daima oturumdaki personel). */
export function EmailChannelTools({ canEdit, staffEmail, keyConfigured }: { canEdit: boolean; staffEmail: string; keyConfigured: boolean }) {
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<"test" | "send" | null>(null);
  const [conn, setConn] = useState<ConnectionTestResult | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  if (!canEdit) return <p className="text-xs text-text-muted">Bağlantı testi ve test gönderimi yalnız süper admin içindir.</p>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          type="button"
          disabled={pending || !keyConfigured}
          onClick={() => {
            setBusy("test");
            setMsg(null);
            start(async () => setConn(await testEmailConnectionAction()));
          }}
        >
          {pending && busy === "test" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlugZap className="h-3.5 w-3.5" />}
          Bağlantıyı test et
        </Button>
        <Button
          variant="outline"
          size="sm"
          type="button"
          disabled={pending || !keyConfigured}
          onClick={() => {
            setBusy("send");
            start(async () => {
              const r = await sendSelfTestEmailAction();
              setMsg(r.ok ? { ok: true, text: `Test e-postası ${r.sentTo} adresine gönderildi.` } : { ok: false, text: r.error ?? "Gönderilemedi." });
            });
          }}
        >
          {pending && busy === "send" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          Kendime test e-postası gönder
        </Button>
      </div>
      <p className="text-xs text-text-faint">Test e-postası yalnız sizin adresinize ({staffEmail}) gider. Dakikada en çok 3 test.</p>
      {!keyConfigured ? <p className="text-xs text-text-muted">Test için önce Resend anahtarı tanımlanmalı.</p> : null}
      {msg ? (
        <p role="status" className={`text-sm font-medium ${msg.ok ? "text-mint-700" : "text-danger-600"}`}>
          {msg.text}
        </p>
      ) : null}
      {conn ? (
        conn.ok ? (
          <div role="status" className="space-y-2 rounded-[var(--radius-control)] border border-line bg-canvas p-3 text-sm">
            <p className="font-semibold text-mint-700">Bağlantı başarılı.</p>
            {conn.domains.length === 0 ? (
              <p className="text-xs text-text-muted">Resend hesabında alan adı yok; gönderim için alan adı eklenip doğrulanmalı.</p>
            ) : (
              <ul className="space-y-1">
                {conn.domains.map((d) => (
                  <li key={d.name} className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-semibold text-ink-950">{d.name}</span>
                    <Pill status={d.status} />
                    {d.records.map((r, i) => (
                      <span key={`${r.record}-${i}`} className="inline-flex items-center gap-1 text-text-muted">
                        {r.record}: <Pill status={r.status} />
                      </span>
                    ))}
                  </li>
                ))}
              </ul>
            )}
            {conn.fromDomain && conn.fromDomainVerified === false ? (
              <p className="text-xs font-medium text-amber-700">
                Gönderen alan adı ({conn.fromDomain}) Resend&apos;de doğrulanmış değil; gönderimler reddedilebilir.
              </p>
            ) : null}
          </div>
        ) : (
          <p role="status" className="text-sm font-medium text-danger-600">
            {conn.error}
          </p>
        )
      ) : null}
    </div>
  );
}

/** Şablon kartındaki "Kendime örnek gönder" (örnek veriyle; alıcı oturumdaki personel). */
export function TemplateSampleButton({ templateKey, disabled }: { templateKey: string; disabled: boolean }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        type="button"
        disabled={pending || disabled}
        onClick={() =>
          start(async () => {
            const r = await sendTemplateSampleAction(templateKey);
            setMsg(r.ok ? { ok: true, text: `Örnek ${r.sentTo} adresine gönderildi.` } : { ok: false, text: r.error ?? "Gönderilemedi." });
          })
        }
      >
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
        Kendime örnek gönder
      </Button>
      {msg ? (
        <span role="status" className={`text-xs font-medium ${msg.ok ? "text-mint-700" : "text-danger-600"}`}>
          {msg.text}
        </span>
      ) : null}
    </span>
  );
}
