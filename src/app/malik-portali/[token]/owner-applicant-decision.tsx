"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormField, FormTextarea } from "@/components/ui/form-controls";
import { decideApplicantByOwner } from "@/app/actions/rental-applications-public";

/** Malik kararı: Onaylıyorum / Uygun değil (onay penceresiyle) + isteğe bağlı not. Sonuç sayfa içinde gösterilir. */
export function OwnerApplicantDecision({ token, applicationId, name }: { token: string; applicationId: string; name: string }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const send = async (fd: FormData) => {
    setMsg(null);
    const res = await decideApplicantByOwner(fd);
    setMsg({ ok: res.ok, text: res.message });
    if (res.ok) router.refresh();
  };

  return (
    <div className="space-y-3">
      <FormField label="Danışmanınıza notunuz (isteğe bağlı)" htmlFor={`owner-app-note-${applicationId}`}>
        <FormTextarea rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Örn. Kefil şartıyla uygun." />
      </FormField>
      <div className="grid grid-cols-2 gap-2">
        <ConfirmDialog
          trigger={<Button className="min-h-11 w-full bg-mint-600 hover:bg-mint-700" icon={Check}>Onaylıyorum</Button>}
          title={`${name} adayını onayla`}
          description="Danışmanınız kira sözleşmesi için sizinle ve adayla iletişime geçer. Bu karar geri alınamaz."
          confirmLabel="Onaylıyorum"
          cancelLabel="Vazgeç"
          tone="default"
          formAction={send}
          hiddenFields={{ token, application_id: applicationId, decision: "approved", note }}
        />
        <ConfirmDialog
          trigger={<Button variant="secondary" className="min-h-11 w-full" icon={X}>Uygun değil</Button>}
          title={`${name} adayını reddet`}
          description="Danışmanınız yeni adaylarla size dönecek."
          confirmLabel="Reddediyorum"
          cancelLabel="Vazgeç"
          tone="danger"
          formAction={send}
          hiddenFields={{ token, application_id: applicationId, decision: "rejected", note }}
        />
      </div>
      {msg ? (
        <p role={msg.ok ? "status" : "alert"} className={`text-xs font-semibold ${msg.ok ? "text-mint-700" : "text-danger-600"}`}>
          {msg.text}
        </p>
      ) : null}
    </div>
  );
}
