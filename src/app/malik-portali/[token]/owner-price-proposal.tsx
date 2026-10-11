import type { SupabaseClient } from "@supabase/supabase-js";
import { Handshake } from "lucide-react";
import { PortalSection } from "@/components/public/portal-kit";
import { formatDateTr, formatTry } from "@/lib/format";
import { now } from "@/lib/clock";
import { changePct, effectiveStatus, parseSnapshot, type ProposalStatus } from "@/lib/price-proposals/model";
import { OwnerPriceProposalForm } from "./owner-price-proposal-form";

type Row = {
  id: string;
  status: ProposalStatus;
  old_price: number | string;
  new_price: number | string;
  reason: string;
  owner_note: string | null;
  comparables_snapshot: unknown;
  expires_at: string;
  decided_at: string | null;
};

const RECENT_DECISION_MS = 30 * 86_400_000;

/**
 * Malik portalı "Fiyat önerisi" kartı. Token sayfada zaten doğrulandı; sorgu o tokenin portföyüne VE ofisine sabittir
 * (KVKK: yalnız kendi mülkü). Emsal özeti anonimdir (başka portföy kodu/başlığı/adresi yok). Tablo yoksa bölüm gizlenir.
 */
export async function OwnerPriceProposalSection({ db, tenantId, propertyId, token }: { db: SupabaseClient; tenantId: string; propertyId: string; token: string }) {
  const { data, error } = await db
    .from("property_price_proposals")
    .select("id, status, old_price, new_price, reason, owner_note, comparables_snapshot, expires_at, decided_at")
    .eq("tenant_id", tenantId)
    .eq("property_id", propertyId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;

  const row = data as Row;
  const nowMs = now();
  const status = effectiveStatus(row.status, Date.parse(row.expires_at), nowMs);
  const oldPrice = Number(row.old_price);
  const newPrice = Number(row.new_price);
  const pct = changePct(oldPrice, newPrice);
  const pctText = pct === null ? "" : ` (${pct > 0 ? "+" : ""}%${String(pct).replace(".", ",")})`;

  if (status === "approved" || status === "rejected") {
    // Karar bir süre görünür; eskiyince kart kaybolur (sayfayı şişirmesin).
    if (!row.decided_at || nowMs - Date.parse(row.decided_at) > RECENT_DECISION_MS) return null;
    return (
      <PortalSection id="fiyat-onerisi" icon={Handshake} title="Fiyat önerisi">
        <div className="rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3 text-sm shadow-[var(--shadow-xs)]">
          <p className="font-semibold text-ink-950">
            {status === "approved" ? "Yeni fiyatı onayladınız." : "Önerilen fiyatı reddettiniz."}
          </p>
          <p className="mt-1 text-text-muted">
            {formatTry(oldPrice)} → {formatTry(newPrice)}
            {pctText} · {formatDateTr(row.decided_at, { day: "2-digit", month: "long", year: "numeric" })}
          </p>
          {row.owner_note ? <p className="mt-1 text-xs text-text-muted">Notunuz: {row.owner_note}</p> : null}
        </div>
      </PortalSection>
    );
  }
  if (status !== "pending") return null;

  const snap = parseSnapshot(row.comparables_snapshot);
  return (
    <PortalSection id="fiyat-onerisi" icon={Handshake} title="Fiyat önerisi" iconClassName="text-amber-600">
      <div className="space-y-3 rounded-[var(--radius-card)] border border-amber-300/60 bg-surface p-4 shadow-[var(--shadow-xs)]">
        <p className="text-sm text-text-muted">Danışmanınız ilanınız için yeni bir fiyat öneriyor. Siz onaylamadan fiyat değişmez.</p>
        <div className="grid grid-cols-2 gap-3 text-center">
          <div className="rounded-[var(--radius-control)] bg-canvas px-3 py-3">
            <p className="text-xs text-text-muted">Şimdiki fiyat</p>
            <p className="mt-0.5 text-base font-bold text-ink-950">{formatTry(oldPrice)}</p>
          </div>
          <div className="rounded-[var(--radius-control)] bg-brand-50 px-3 py-3">
            <p className="text-xs text-text-muted">Önerilen fiyat</p>
            <p className="mt-0.5 text-base font-bold text-ink-950">{formatTry(newPrice)}</p>
            {pct !== null ? <p className="text-xs font-semibold text-text-muted">{pctText.trim().replace(/[()]/g, "")}</p> : null}
          </div>
        </div>
        <div>
          <p className="text-xs font-semibold text-ink-950">Danışmanınızın gerekçesi</p>
          <p className="mt-0.5 whitespace-pre-line text-sm text-text-muted">{row.reason}</p>
        </div>
        {snap ? (
          <div className="rounded-[var(--radius-control)] bg-canvas px-3 py-3">
            <p className="text-xs font-semibold text-ink-950">Benzer ilanlar ne durumda?</p>
            <p className="mt-0.5 text-sm text-text-muted">
              {snap.compCount} benzer kayda göre aralık {formatTry(snap.low)} – {formatTry(snap.high)} (orta değer {formatTry(snap.median)}).
            </p>
            {snap.rows.length > 0 ? (
              <ul className="mt-2 space-y-1 text-xs text-text-muted">
                {snap.rows.map((r, i) => (
                  <li key={i} className="flex justify-between gap-2">
                    <span>
                      {r.source === "won_deal" ? "Satışı gerçekleşmiş" : "Yayındaki ilan"}
                      {r.rooms ? ` · ${r.rooms}` : ""}
                      {r.sqm ? ` · ${r.sqm} m²` : ""}
                    </span>
                    <span className="font-semibold text-ink-950">{formatTry(r.price)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="mt-2 text-xs text-text-faint">
              Yayındaki ilanlar istenen fiyattır; gerçekleşen satış fiyatı değildir. Güven düzeyi: {snap.confidence}.
            </p>
          </div>
        ) : null}
        {row.owner_note ? <p className="text-xs text-text-muted">Danışmanınıza ilettiğiniz not: {row.owner_note}</p> : null}
        <OwnerPriceProposalForm token={token} proposalId={row.id} newPriceLabel={formatTry(newPrice)} />
        <p className="text-xs text-text-faint">
          Bu öneri {formatDateTr(row.expires_at, { day: "2-digit", month: "long" })} tarihine kadar geçerlidir.
        </p>
      </div>
    </PortalSection>
  );
}
