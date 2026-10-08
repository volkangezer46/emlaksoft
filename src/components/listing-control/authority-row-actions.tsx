"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BadgeCheck, MessageCircle, MessageSquareText, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/app/toast-provider";
import { sendAuthorityReminder, updateAuthorityStatus, type AuthorityActionResult } from "@/app/actions/authority-queue";

/**
 * Yetki kuyruğu satır eylemleri (istemci). Sunucu eylemleri kendi yetki ve İYS kapısını uygular; burada yalnız akış var:
 * hatırlatma (SMS / WhatsApp bağlantısı), onay işaretleme, reddedildi işaretleme ve yetki belgesi no kaydı.
 */
export type AuthorityRowModel = {
  propertyId: string;
  docNo: string;
  status: "pending" | "approved" | "rejected" | "expired";
  hasOwnerPhone: boolean;
  canRemind: boolean;
  remindBlockedReason: string | null;
};

export function AuthorityRowActions({ row, canEdit }: { row: AuthorityRowModel; canEdit: boolean }) {
  const router = useRouter();
  const { push } = useToast();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [docNo, setDocNo] = useState(row.docNo);

  if (!canEdit) return <span className="text-xs text-text-muted">Yalnız görüntüleme</span>;

  const run = (fn: () => Promise<AuthorityActionResult>, onOk?: (r: AuthorityActionResult) => void) => {
    setError(null);
    start(async () => {
      const r = await fn();
      if (r.error) {
        setError(r.error);
        return;
      }
      if (r.info) push(r.info, "ok");
      onOk?.(r);
      router.refresh();
    });
  };

  const remindDisabled = !row.hasOwnerPhone || !row.canRemind || row.status === "approved";
  const remindTitle = !row.hasOwnerPhone
    ? "Mal sahibinin cep telefonu kayıtlı değil"
    : (row.remindBlockedReason ?? "Mal sahibine e-Devlet EİDS onay hatırlatması gönder (İYS izni aranır)");

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          size="sm"
          variant="primary"
          icon={MessageSquareText}
          loading={pending}
          disabled={remindDisabled}
          title={remindTitle}
          onClick={() => run(() => sendAuthorityReminder(row.propertyId, "sms"))}
        >
          SMS hatırlat
        </Button>
        <Button
          size="sm"
          variant="secondary"
          icon={MessageCircle}
          disabled={remindDisabled || pending}
          title={remindTitle}
          onClick={() =>
            run(
              () => sendAuthorityReminder(row.propertyId, "whatsapp"),
              (r) => {
                if (r.waUrl) window.open(r.waUrl, "_blank", "noopener,noreferrer");
              },
            )
          }
        >
          WhatsApp
        </Button>
        {row.status !== "approved" ? (
          <Button
            size="sm"
            variant="ghost"
            icon={BadgeCheck}
            disabled={pending}
            onClick={() => run(() => updateAuthorityStatus(row.propertyId, { eidsStatus: "approved" }))}
          >
            Onay alındı
          </Button>
        ) : null}
        {row.status !== "rejected" && row.status !== "approved" ? (
          <Button
            size="sm"
            variant="ghost"
            icon={XCircle}
            disabled={pending}
            onClick={() => run(() => updateAuthorityStatus(row.propertyId, { eidsStatus: "rejected" }))}
          >
            Reddedildi
          </Button>
        ) : null}
      </div>
      <form
        className="flex items-center gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => updateAuthorityStatus(row.propertyId, { docNo }));
        }}
      >
        <label className="sr-only" htmlFor={`yetki-no-${row.propertyId}`}>Yetki belgesi no</label>
        <input
          id={`yetki-no-${row.propertyId}`}
          value={docNo}
          onChange={(e) => setDocNo(e.target.value)}
          maxLength={60}
          placeholder="Yetki belgesi no"
          className="min-h-9 w-44 rounded-[var(--radius-control)] border border-line bg-canvas px-2.5 text-sm outline-none transition focus:border-brand-400 focus:bg-surface"
        />
        <Button type="submit" size="sm" variant="ghost" disabled={pending || docNo.trim() === row.docNo.trim()}>
          Kaydet
        </Button>
      </form>
      {error ? <p role="alert" className="text-xs text-danger-600">{error}</p> : null}
    </div>
  );
}
