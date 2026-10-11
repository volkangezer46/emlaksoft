"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, MessageSquarePlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormField, FormTextarea } from "@/components/ui/form-controls";
import { decideOwnerPriceProposal } from "@/app/actions/owner-price-proposal";

/**
 * Malik portalı fiyat önerisi kararı: Onaylıyorum / Reddediyorum (geri alınamaz -> onay penceresi) / Not ekle.
 * Not alanı üç eylemde de danışmana iletilir (onay ve redde isteğe bağlı, "Not ekle"de zorunlu).
 */
export function OwnerPriceProposalForm({ token, proposalId, newPriceLabel }: { token: string; proposalId: string; newPriceLabel: string }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const send = async (fd: FormData) => {
    setMsg(null);
    const res = await decideOwnerPriceProposal(fd);
    setMsg({ ok: res.ok, text: res.message });
    if (res.ok) {
      if (String(fd.get("decision")) === "note") setNote("");
      router.refresh();
    }
  };

  const sendNote = () => {
    const fd = new FormData();
    fd.set("token", token);
    fd.set("proposal_id", proposalId);
    fd.set("decision", "note");
    fd.set("note", note);
    start(() => send(fd));
  };

  return (
    <div className="space-y-3">
      <FormField label="Danışmanınıza notunuz (isteğe bağlı)" htmlFor="owner-price-note">
        <FormTextarea
          id="owner-price-note"
          rows={2}
          maxLength={500}
          placeholder="Örn. Bu fiyata razıyım ama pazarlık payı bırakalım."
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </FormField>
      <div className="grid gap-2 sm:grid-cols-3">
        <ConfirmDialog
          trigger={
            <Button className="min-h-11 w-full bg-mint-600 hover:bg-mint-700" icon={Check}>
              Onaylıyorum
            </Button>
          }
          title="Yeni fiyatı onayla"
          description={`İlanınızın fiyatı ${newPriceLabel} olarak güncellenecek. Bu işlem geri alınamaz.`}
          confirmLabel="Onaylıyorum"
          cancelLabel="Vazgeç"
          tone="default"
          formAction={send}
          hiddenFields={{ token, proposal_id: proposalId, decision: "approved", note }}
        />
        <ConfirmDialog
          trigger={
            <Button variant="secondary" className="min-h-11 w-full" icon={X}>
              Reddediyorum
            </Button>
          }
          title="Fiyat önerisini reddet"
          description="Fiyat şimdiki haliyle kalacak ve danışmanınız sizinle görüşmek üzere bilgilendirilecek."
          confirmLabel="Reddediyorum"
          cancelLabel="Vazgeç"
          tone="danger"
          formAction={send}
          hiddenFields={{ token, proposal_id: proposalId, decision: "rejected", note }}
        />
        <Button
          variant="secondary"
          className="min-h-11 w-full"
          icon={MessageSquarePlus}
          loading={pending}
          disabled={note.trim().length === 0}
          onClick={sendNote}
        >
          Not ekle
        </Button>
      </div>
      {msg ? (
        <p role={msg.ok ? "status" : "alert"} className={`text-xs font-semibold ${msg.ok ? "text-mint-700" : "text-danger-600"}`}>
          {msg.text}
        </p>
      ) : null}
    </div>
  );
}
