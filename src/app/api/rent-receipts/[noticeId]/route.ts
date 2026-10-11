import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/require-permission";
import { RENT_RECEIPT_BUCKET, isRentReceiptUuid } from "@/lib/rent-receipt";

/**
 * Kiracı dekontunu danışmana KISA ÖMÜRLÜ imzalı adresle gösterir (kova özel; kalıcı adres yok).
 * Bildirim oturumlu istemciyle (RLS + rentals.view + ofis eşleşmesi) okunur; yalnız sunucu doğrulaması
 * geçmiş ('verified') dekont için imza üretilir.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIGNED_TTL_SECONDS = 60;

function notFound() {
  return NextResponse.json({ error: "Dekont bulunamadı" }, { status: 404 });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ noticeId: string }> }) {
  const gate = await requirePermission("rentals", "view");
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: 403 });
  const { noticeId } = await params;
  if (!isRentReceiptUuid(noticeId)) return notFound();

  const supabase = await createClient();
  const { data } = await supabase
    .from("rent_payment_notices")
    .select("receipt_path, receipt_status")
    .eq("id", noticeId)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  const path = data?.receipt_path as string | null | undefined;
  if (!path || data?.receipt_status !== "verified" || !path.startsWith(`${gate.tenantId}/`)) return notFound();

  const admin = createAdminClient();
  const { data: signed, error } = await admin.storage.from(RENT_RECEIPT_BUCKET).createSignedUrl(path, SIGNED_TTL_SECONDS);
  if (error || !signed?.signedUrl) return notFound();
  const res = NextResponse.redirect(signed.signedUrl, 302);
  res.headers.set("Cache-Control", "private, no-store, max-age=0");
  res.headers.set("Referrer-Policy", "no-referrer");
  return res;
}
