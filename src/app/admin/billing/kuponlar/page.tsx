import { notFound } from "next/navigation";
import { requirePlatformModule } from "@/lib/platform";
import { createAdminClient } from "@/lib/supabase/admin";
import { TicketPercent } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { getPlanDefinitions } from "@/lib/billing/plan-definitions";
import { getPlanSupport } from "@/lib/billing/plan-support";
import { BillingNav } from "../billing-nav";
import { CouponRowView, NewCoupon, type CouponRow } from "./coupon-forms";

export const metadata = { title: "Kuponlar" };

export default async function CouponsPage() {
  const staff = await requirePlatformModule("billing");
  const support = await getPlanSupport();
  // Şema yokken özellik gizli: sekme görünmez, adres 404 verir.
  if (!support.coupons) notFound();

  const admin = createAdminClient();
  const [{ data }, defs] = await Promise.all([
    admin
      .from("coupons")
      .select("id, code, description, kind, value, max_redemptions, redeemed_count, valid_from, valid_until, plan_ids, is_active")
      .order("created_at", { ascending: false })
      .limit(200),
    getPlanDefinitions(),
  ]);
  const rows = (data ?? []) as CouponRow[];
  const plans = defs.filter((p) => !p.hidden || p.id !== "business").map((p) => ({ id: p.id, name: p.name }));

  return (
    <div className="space-y-6">
      <AdminPageHeader
        art="coupon"
        icon={TicketPercent}
        eyebrow="Faturalama · indirim"
        title="Kuponlar"
        description="Kupon ve indirim kodları. Kod ödeme sırasında tek seferlik, kota ve geçerlilik tek kilitle doğrulanarak uygulanır."
      />
      <BillingNav active="kuponlar" />
      <NewCoupon plans={plans} />
      <section className="overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface">
        <div className="border-b border-line px-5 py-4">
          <h2 className="font-display font-bold text-ink-950">Tanımlı kuponlar <span className="ml-1 rounded-full bg-brand-600/10 px-2.5 py-0.5 text-xs font-bold text-brand-600">{rows.length}</span></h2>
        </div>
        {rows.length === 0 ? (
          <p className="px-5 py-6 text-sm text-text-muted">Henüz kupon yok. Yukarıdan ilk kuponu oluşturun.</p>
        ) : (
          <div className="divide-y divide-line">
            {rows.map((c) => (
              <CouponRowView key={c.id} coupon={c} plans={plans} isSuperAdmin={staff.role === "super_admin"} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
