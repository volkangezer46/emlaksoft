import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

function authorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return process.env.NODE_ENV !== "production";
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

function leakSeverity(dealAmount: number | null, daysOpen: number): "low" | "medium" | "high" | "critical" {
  const amount = dealAmount ?? 0;
  if (daysOpen >= 30 && amount > 500_000) return "critical";
  if (daysOpen >= 14 && amount > 300_000) return "high";
  if (daysOpen >= 7 && amount > 100_000) return "medium";
  return "low";
}

type ClosureRow = {
  id: string;
  tenant_id: string;
  reason: string;
  deal_amount: number | null;
  estimated_lost_commission: number | null;
  created_at: string;
  portal_listing:
    | { property: { property_code?: string; title?: string | null } | { property_code?: string; title?: string | null }[] | null }
    | { property: { property_code?: string; title?: string | null } | { property_code?: string; title?: string | null }[] | null }[]
    | null;
};

/** Proaktif kayıp-kaçak: deal olmadan kapanmış + uyarısı gitmemiş + SLA aşımı → bildir */
export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const now = Date.now();
  const sla7 = new Date(now - 7 * 86_400_000).toISOString();

  const { data: closures, error } = await admin
    .from("listing_closures")
    .select(
      "id, tenant_id, reason, deal_amount, estimated_lost_commission, created_at, portal_listing:portal_listings(property:properties(property_code,title))",
    )
    .is("sla_warning_sent_at", null)
    .not("deal_happened", "is", true)
    .lt("created_at", sla7)
    .limit(500);

  if (error) {
    console.error("leak-sla cron", error);
    return NextResponse.json({ error: "query_failed" }, { status: 500 });
  }

  let sent = 0;
  for (const c of (closures ?? []) as ClosureRow[]) {
    const daysOpen = Math.floor((now - new Date(c.created_at).getTime()) / 86_400_000);
    const amount = c.estimated_lost_commission != null ? Number(c.estimated_lost_commission) : c.deal_amount != null ? Number(c.deal_amount) : null;
    const severity = leakSeverity(amount, daysOpen);

    const listing = Array.isArray(c.portal_listing) ? c.portal_listing[0] : c.portal_listing;
    const prop = listing?.property;
    const property = Array.isArray(prop) ? prop[0] : prop;
    const propCode = property?.property_code ?? "—";
    const title = property?.title ?? "";

    const body = `${propCode}${title ? ` · ${title}` : ""} · ${daysOpen} gün sonuçsuz · ${severity}`;

    await admin.from("notifications").insert({
      tenant_id: c.tenant_id,
      title: "Kayıp-kaçak SLA uyarısı",
      body,
      href: "/app/kayip-kacak",
      kind: severity === "critical" ? "danger" : severity === "high" ? "warning" : "info",
    });

    await admin
      .from("listing_closures")
      .update({ sla_warning_sent_at: new Date().toISOString(), leak_severity: severity })
      .eq("id", c.id);

    sent += 1;
  }

  return NextResponse.json({ ok: true, sent });
}
