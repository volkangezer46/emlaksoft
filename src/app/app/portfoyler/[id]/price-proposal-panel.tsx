"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BadgeCheck, Clock, Handshake, Send, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { Alert } from "@/components/ui/alert";
import { FormField, FormInput, FormTextarea } from "@/components/ui/form-controls";
import { formatTry, formatDateTr } from "@/lib/format";
import {
  PROPOSAL_STATUS_LABEL,
  PROPOSAL_TTL_DAYS,
  changePct,
  parsePriceInput,
  positionInRange,
  type ProposalSnapshot,
  type ProposalStatus,
} from "@/lib/price-proposals/model";
import {
  cancelPriceProposal,
  createPriceProposal,
  getPriceProposalDraft,
  type PriceProposalDraft,
} from "@/app/actions/price-proposals";

export type ProposalView = {
  id: string;
  status: ProposalStatus;
  oldPrice: number;
  newPrice: number;
  reason: string;
  ownerNote: string | null;
  snapshot: ProposalSnapshot | null;
  expiresAt: string;
  decidedAt: string | null;
  createdAt: string;
};

const TONE: Record<ProposalStatus, "neutral" | "attention" | "success"> = {
  pending: "attention",
  approved: "success",
  rejected: "neutral",
  expired: "neutral",
};

function SnapshotLine({ snap }: { snap: ProposalSnapshot }) {
  return (
    <p className="text-xs text-text-muted">
      Emsal aralığı {formatTry(snap.low)} – {formatTry(snap.high)} (orta {formatTry(snap.median)}) · {snap.compCount} emsal · güven: {snap.confidence}.
      Karşılaştırma gerçekleşen satış ve aktif ilan fiyatlarına dayanır.
    </p>
  );
}

export function PriceProposalPanel({ propertyId, canEdit, items }: { propertyId: string; canEdit: boolean; items: ProposalView[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<PriceProposalDraft | null>(null);
  const [loading, setLoading] = useState(false);
  const [price, setPrice] = useState("");
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const pendingItem = items.find((i) => i.status === "pending") ?? null;
  const parsed = parsePriceInput(price);
  const pos = parsed && draft ? positionInRange(parsed, draft.snapshot) : null;
  const pct = parsed && draft?.currentPrice ? changePct(draft.currentPrice, parsed) : null;

  const openForm = async () => {
    setOpen(true);
    setMsg(null);
    if (draft) return;
    setLoading(true);
    setDraft(await getPriceProposalDraft(propertyId));
    setLoading(false);
  };

  const submit = (fd: FormData) => {
    setMsg(null);
    start(async () => {
      const res = await createPriceProposal(fd);
      setMsg({ ok: res.ok, text: res.message });
      if (res.ok) {
        setOpen(false);
        setPrice("");
        setReason("");
        router.refresh();
      }
    });
  };

  const cancel = (id: string) => {
    const fd = new FormData();
    fd.set("proposal_id", id);
    fd.set("property_id", propertyId);
    start(async () => {
      const res = await cancelPriceProposal(fd);
      setMsg({ ok: res.ok, text: res.message });
      if (res.ok) router.refresh();
    });
  };

  if (items.length === 0 && !canEdit) return null;

  return (
    <Card id="fiyat-onerisi" className="scroll-mt-24">
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <Handshake className="h-4 w-4 text-brand-600" aria-hidden /> Fiyat revizyonu önerisi
          </CardTitle>
          <CardDescription>
            Yeni fiyatı gerekçesiyle mülk sahibine portalından gönderin. Onaylarsa portföy fiyatı kendiliğinden güncellenir.
          </CardDescription>
        </div>
        {canEdit && !pendingItem && !open ? (
          <Button size="sm" icon={Send} onClick={openForm}>
            Fiyat revizyonu öner
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3">
        {msg ? <Alert tone={msg.ok ? "success" : "danger"}>{msg.text}</Alert> : null}

        {open ? (
          <form action={submit} className="space-y-3 rounded-[var(--radius-card)] border border-line bg-canvas p-4">
            <input type="hidden" name="property_id" value={propertyId} />
            {loading ? (
              <p className="text-xs text-text-muted" role="status">Emsal bilgisi hazırlanıyor…</p>
            ) : draft?.snapshot ? (
              <div className="rounded-[var(--radius-control)] bg-surface px-3 py-2">
                <p className="text-sm font-semibold text-ink-950">
                  Benzer ilanlara göre aralık: {formatTry(draft.snapshot.low)} – {formatTry(draft.snapshot.high)}
                </p>
                <SnapshotLine snap={draft.snapshot} />
              </div>
            ) : (
              <p className="rounded-[var(--radius-control)] bg-surface px-3 py-2 text-xs text-text-muted">
                Bu portföy için yeterli emsal yok; öneri aralığı gösterilmiyor. Yine de gerekçenizle bir fiyat önerebilirsiniz.
              </p>
            )}
            <FormField label="Yeni fiyat (₺)" htmlFor="pp-new-price" required hint={draft?.currentPrice ? `Güncel fiyat ${formatTry(draft.currentPrice)}` : undefined}>
              <FormInput
                id="pp-new-price"
                name="new_price"
                inputMode="numeric"
                autoComplete="off"
                placeholder="Örn. 8.250.000"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </FormField>
            {parsed && pct !== null ? (
              <p className="text-xs text-text-muted">
                Değişim: {pct > 0 ? "+" : ""}%{String(pct).replace(".", ",")}
                {pos === "alt" ? " · emsal aralığının altında" : pos === "ust" ? " · emsal aralığının üstünde" : pos === "icinde" ? " · emsal aralığında" : ""}
              </p>
            ) : null}
            <FormField label="Gerekçe (mülk sahibi görecek)" htmlFor="pp-reason" required hint="Örn. “Son 60 günde 3 gösterim, benzer Kadıköy 3+1 ilanlar bu aralıkta satıldı.”">
              <FormTextarea id="pp-reason" name="reason" rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
            </FormField>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" loading={pending} disabled={!parsed || reason.trim().length < 3} icon={Send}>
                Mülk sahibine gönder
              </Button>
              <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
                Vazgeç
              </Button>
            </div>
          </form>
        ) : null}

        {items.length === 0 ? (
          <p className="text-sm text-text-muted">Henüz bir fiyat önerisi gönderilmedi.</p>
        ) : (
          <ul className="space-y-2">
            {items.map((p) => {
              const pc = changePct(p.oldPrice, p.newPrice);
              return (
                <li key={p.id} className="rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-ink-950">
                      {formatTry(p.oldPrice)} → {formatTry(p.newPrice)}
                      {pc !== null ? <span className="ml-2 text-xs font-medium text-text-muted">({pc > 0 ? "+" : ""}%{String(pc).replace(".", ",")})</span> : null}
                    </p>
                    <StatusBadge
                      tone={TONE[p.status]}
                      icon={p.status === "approved" ? <BadgeCheck /> : p.status === "pending" ? <Clock /> : <XCircle />}
                    >
                      {PROPOSAL_STATUS_LABEL[p.status]}
                    </StatusBadge>
                  </div>
                  <p className="mt-1 text-xs text-text-muted">Gerekçe: {p.reason}</p>
                  {p.snapshot ? <SnapshotLine snap={p.snapshot} /> : <p className="text-xs text-text-muted">Emsal bilgisi eklenmedi.</p>}
                  {p.ownerNote ? <p className="mt-1 text-xs font-medium text-ink-950">Mülk sahibinin notu: {p.ownerNote}</p> : null}
                  <p className="mt-1 text-xs text-text-faint">
                    {formatDateTr(p.createdAt, { day: "2-digit", month: "long", year: "numeric" })} tarihinde gönderildi
                    {p.status === "pending" ? ` · ${formatDateTr(p.expiresAt, { day: "2-digit", month: "long" })} tarihine kadar geçerli (${PROPOSAL_TTL_DAYS} gün)` : ""}
                  </p>
                  {canEdit && p.status === "pending" ? (
                    <div className="mt-2">
                      <Button size="sm" variant="secondary" loading={pending} onClick={() => cancel(p.id)}>
                        Öneriyi iptal et
                      </Button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
