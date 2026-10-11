import { BellRing } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { findStatementMatch, type StatementLineForMatch } from "@/lib/customer-portal/notice-match";
import { PortalRequestButtons } from "../../musteriler/[id]/portal-request-buttons";

const money = (n: number) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 2 }).format(n);
const day = (iso: string) => new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium" }).format(new Date(`${iso.slice(0, 10)}T00:00:00`));
const month = (iso: string) => new Intl.DateTimeFormat("tr-TR", { month: "long", year: "numeric" }).format(new Date(`${iso.slice(0, 10)}T00:00:00`));

/**
 * Kiracı "Ödedim" dedi, teyit bekliyor. Banka ekstresi içe aktarılmışsa aynı tutarlı bekleyen giriş satırı ARANIR
 * (tutar + tarih penceresi; dekont no varsa açıklamada) ve "ekstrede bulundu" önerisi çıkar. Öneri kendiliğinden kayıt açmaz:
 * "Teyit et" tahsilatı (makbuz no ile) kaydeder, ekstre satırı sonra Para hareketleri ekranında bu tahsilatla eşleşir.
 * Bekleyen bildirim yoksa kart hiç çizilmez; ekstre tabloları yoksa/erişilemezse öneri sessizce atlanır.
 */
export async function RentNoticesCard({ rentalId, tenantId, canEdit }: { rentalId: string; tenantId: string; canEdit: boolean }) {
  const supabase = await createClient();
  const { data: notices, error } = await supabase
    .from("rent_payment_notices")
    .select("id, amount, reference, note, created_at, receipt_status, charge:rent_charges!rent_payment_notices_charge_id_fkey(period)")
    .eq("tenant_id", tenantId)
    .eq("rental_id", rentalId)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(5);
  if (error || !notices || notices.length === 0) return null;

  const amounts = [...new Set(notices.map((n) => Number(n.amount)))];
  const { data: lineRows } = await supabase
    .from("finance_statement_lines")
    .select("id, line_date, amount, description")
    .eq("tenant_id", tenantId)
    .eq("direction", "in")
    .eq("status", "pending")
    .in("amount", amounts)
    .order("line_date", { ascending: false })
    .limit(100);
  const lines: StatementLineForMatch[] = ((lineRows ?? []) as { id: string; line_date: string; amount: number | string; description: string | null }[]).map((l) => ({
    id: l.id,
    date: String(l.line_date).slice(0, 10),
    amount: Number(l.amount),
    description: l.description ?? "",
  }));

  return (
    <Card id="odeme-bildirimi" className="scroll-mt-24 border-amber-400/40">
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <BellRing className="h-4 w-4 text-amber-600" aria-hidden="true" /> Kiracı ödediğini bildirdi — teyit bekliyor
          </CardTitle>
          <CardDescription>Hesabınıza geçtiyse &quot;Teyit et&quot; ile tahsilatı kaydedin. Geçmediyse bildirimi reddedin; tahakkuk değişmez.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {notices.map((n) => {
          const charge = Array.isArray(n.charge) ? n.charge[0] : n.charge;
          const match = findStatementMatch(
            { amount: Number(n.amount), createdDay: String(n.created_at).slice(0, 10), reference: (n.reference as string | null) ?? null },
            lines,
          );
          return (
            <div key={n.id as string} className="rounded-[var(--radius-card)] border border-line bg-canvas px-4 py-3">
              <p className="text-sm font-semibold text-ink-950">
                {charge?.period ? `${month(charge.period as string)} kirası` : "Kira"} · {money(Number(n.amount))}
              </p>
              <p className="mt-0.5 text-xs text-text-muted">
                Bildirim: {day(n.created_at as string)}
                {n.reference ? ` · Dekont/işlem no: ${n.reference}` : ""}
                {n.note ? ` · Not: ${n.note}` : ""}
              </p>
              {n.receipt_status === "verified" ? (
                <p className="mt-2 text-xs font-semibold">
                  <a href={`/api/rent-receipts/${n.id as string}`} target="_blank" rel="noopener noreferrer" className="focus-ring text-brand-600 hover:text-brand-700">
                    Kiracının yüklediği dekontu gör
                  </a>
                </p>
              ) : null}
              {match ? (
                <p className="mt-2 rounded-[var(--radius-control)] bg-mint-500/10 px-3 py-2 text-xs font-semibold text-mint-700">
                  Banka ekstresinde aynı tutarlı giriş bulundu ({day(match.line.date)}
                  {match.line.description ? ` · ${match.line.description.slice(0, 60)}` : ""}). {match.confidence === "high" ? "Eşleşme güçlü." : "Tarihi kontrol edin."}
                </p>
              ) : null}
              {canEdit ? <PortalRequestButtons kind="rent" id={n.id as string} paidOn={match?.line.date} /> : null}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
