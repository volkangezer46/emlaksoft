"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Handshake, Link2, Loader2, Share2, ShieldCheck } from "lucide-react";
import { convertWorkflow } from "@/app/actions/workflow";
import { createPropertyShareLink } from "@/app/actions/shares";
import { useToast } from "@/components/app/toast-provider";

export function PropertyWorkflow({
  propertyId,
  listPrice,
  transactionType,
}: {
  propertyId: string;
  listPrice: number | null;
  transactionType: string;
}) {
  const { push } = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState<"deal" | "share" | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [advisorShare, setAdvisorShare] = useState(50);
  const [dealValue, setDealValue] = useState(listPrice != null ? String(listPrice) : "");
  const [hasAuthority, setHasAuthority] = useState(false);

  async function createDeal() {
    if (!hasAuthority) {
      push("Önce yazılı yetki / EİDS onayını işaretleyin", "err");
      return;
    }
    setBusy("deal");
    const fd = new FormData();
    fd.set("action", "create_deal_from_property");
    fd.set("property_id", propertyId);
    fd.set("deal_type", transactionType === "rent" || transactionType === "Kiralık" ? "rent" : "sale");
    fd.set("deal_value", dealValue);
    fd.set("advisor_share", String(advisorShare));
    fd.set("has_authority", "1");
    const res = await convertWorkflow(fd);
    setBusy(null);
    if (res.error) push(res.error, "err");
    else {
      push("Anlaşma + komisyon oluşturuldu", "ok");
      router.refresh();
    }
  }

  async function share() {
    setBusy("share");
    const fd = new FormData();
    fd.set("property_id", propertyId);
    const res = await createPropertyShareLink(fd);
    setBusy(null);
    if (res.error || !res.url) {
      push(res.error ?? "Paylaşım linki oluşturulamadı", "err");
      return;
    }
    setShareUrl(res.url);
    try {
      await navigator.clipboard.writeText(res.url);
      push("Paylaşım linki kopyalandı", "ok");
    } catch {
      push("Paylaşım linki hazır", "ok");
    }
  }

  return (
    <section className="dashboard-panel rounded-[20px] border border-line bg-surface p-5">
      <p className="flex items-center gap-2 text-xs font-semibold text-amber-600">
        <Handshake className="h-4 w-4" /> İş akışı
      </p>
      <h2 className="mt-1 font-display font-bold text-ink-950">Anlaşma · komisyon · paylaşım</h2>
      <p className="mt-1 text-xs text-text-muted">
        Satış/kiralama kapandığında tek tıkla anlaşma + hakediş üretin; müşteriye güvenli paylaşım linki gönderin.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-medium text-text-muted">
          Anlaşma tutarı (₺)
          <input
            value={dealValue}
            onChange={(e) => setDealValue(e.target.value)}
            className="mt-1.5 w-full rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm font-semibold outline-none focus:border-brand-400"
            inputMode="decimal"
          />
        </label>
        <label className="text-xs font-medium text-text-muted">
          Danışman payı %{advisorShare}
          <input
            type="range"
            min={0}
            max={100}
            value={advisorShare}
            onChange={(e) => setAdvisorShare(Number(e.target.value))}
            className="mt-3 w-full accent-brand-600"
          />
        </label>
      </div>

      <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-[12px] border border-mint-500/25 bg-mint-500/5 px-3 py-3">
        <input
          type="checkbox"
          checked={hasAuthority}
          onChange={(e) => setHasAuthority(e.target.checked)}
          className="mt-0.5 accent-mint-600"
        />
        <span className="text-xs leading-relaxed text-ink-950">
          <span className="inline-flex items-center gap-1 font-bold text-mint-700">
            <ShieldCheck className="h-3.5 w-3.5" /> EİDS / yazılı yetki onaylı
          </span>
          <span className="mt-0.5 block text-text-muted">
            Pazarlık ve kaparo öncesi yetki belgesi alındı. Onaysız anlaşma oluşturulamaz.
          </span>
        </span>
      </label>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={createDeal}
          disabled={busy !== null}
          className="btn-shine inline-flex items-center gap-1.5 rounded-[10px] bg-ink-950 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy === "deal" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Handshake className="h-4 w-4" />}
          Anlaşma + komisyon oluştur
        </button>
        <button
          type="button"
          onClick={share}
          disabled={busy !== null}
          className="inline-flex items-center gap-1.5 rounded-[10px] border border-line px-4 py-2.5 text-sm font-semibold text-brand-600 hover:border-brand-300 disabled:opacity-50"
        >
          {busy === "share" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />}
          Paylaşım linki
        </button>
      </div>

      {shareUrl ? (
        <p className="mt-3 flex items-start gap-2 rounded-[12px] border border-brand-300/40 bg-brand-600/5 px-3 py-2 text-xs text-brand-700">
          <Link2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <a href={shareUrl} target="_blank" rel="noreferrer" className="break-all font-semibold hover:underline">
            {shareUrl}
          </a>
        </p>
      ) : null}
    </section>
  );
}
