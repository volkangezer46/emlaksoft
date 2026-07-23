"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { PLANS, planAmountTry, type BillingCycle, type PlanId } from "@/lib/billing/plans";
import { initializeCheckoutForm, isIyzicoConfigured } from "@/lib/billing/iyzico";
import { createCheckoutInvoice, fulfillSuccessfulPayment } from "@/lib/billing/fulfillment";
import { toE164TurkishPhone } from "@/lib/phone";

export type CheckoutResult = {
  error?: string;
  checkoutUrl?: string;
  demo?: boolean;
};

const PLAN_IDS = new Set(PLANS.map((p) => p.id));

function appUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

function splitName(full: string) {
  const parts = full.trim().split(/\s+/);
  const name = parts[0] || "Ofis";
  const surname = parts.slice(1).join(" ") || "Yönetici";
  return { name, surname };
}

export async function startPlanCheckout(formData: FormData): Promise<CheckoutResult> {
  const gate = await requirePermission("billing", "edit");
  if (!gate.ok) return { error: gate.error };

  const plan = String(formData.get("plan") ?? "").trim() as PlanId;
  const cycle = (String(formData.get("cycle") ?? "monthly").trim() || "monthly") as BillingCycle;
  if (!PLAN_IDS.has(plan)) return { error: "Geçersiz paket." };
  if (cycle !== "monthly" && cycle !== "yearly") return { error: "Geçersiz dönem." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Oturum bulunamadı." };

  const [{ data: tenant }, { data: profile }, { data: sub }] = await Promise.all([
    supabase.from("tenants").select("id, name, plan, tax_number").eq("id", gate.tenantId).maybeSingle(),
    supabase.from("profiles").select("full_name, phone").eq("id", user.id).maybeSingle(),
    supabase.from("subscriptions").select("id").eq("tenant_id", gate.tenantId).maybeSingle(),
  ]);

  if (!tenant) return { error: "Ofis bulunamadı." };

  const amountTry = planAmountTry(plan, cycle);
  const conversationId = `es-${gate.tenantId.slice(0, 8)}-${Date.now()}`;

  await createCheckoutInvoice({
    tenantId: gate.tenantId,
    subscriptionId: sub?.id ?? null,
    plan,
    cycle,
    conversationId,
    amountTry,
  });

  // Sandbox anahtarı yoksa: demo ödeme akışı (yerel geliştirme)
  if (!isIyzicoConfigured()) {
    await fulfillSuccessfulPayment({
      tenantId: gate.tenantId,
      plan,
      cycle,
      conversationId,
      paymentId: `demo-${conversationId}`,
      amountTry,
      source: "demo",
    });
    revalidatePath("/app/abonelik");
    revalidatePath("/app/ayarlar");
    revalidatePath("/admin/billing");
    return {
      checkoutUrl: `${appUrl()}/app/abonelik?paid=1&demo=1&plan=${plan}`,
      demo: true,
    };
  }

  const fullName = profile?.full_name || tenant.name || "Ofis Yöneticisi";
  const { name, surname } = splitName(fullName);
  const gsmNumber = toE164TurkishPhone(profile?.phone) || "+905555555555";
  const email = user.email || "billing@emlaksoft.test";

  try {
    const init = await initializeCheckoutForm({
      conversationId,
      price: amountTry,
      paidPrice: amountTry,
      basketId: conversationId,
      callbackUrl: `${appUrl()}/api/iyzico/callback`,
      buyer: {
        id: user.id.slice(0, 32),
        name,
        surname,
        email,
        gsmNumber,
        identityNumber: "11111111111",
        registrationAddress: tenant.name || "Türkiye",
        city: "Istanbul",
        country: "Turkey",
      },
      billingAddress: {
        contactName: fullName,
        city: "Istanbul",
        country: "Turkey",
        address: tenant.name || "Türkiye",
      },
      basketItemName: `EmlakSoft ${plan} (${cycle === "yearly" ? "yıllık" : "aylık"})`,
    });

    if (init.status !== "success" || !init.paymentPageUrl) {
      return { error: init.errorMessage || "Ödeme oturumu açılamadı." };
    }

    return { checkoutUrl: init.paymentPageUrl };
  } catch (e) {
    console.error("startPlanCheckout", e);
    return { error: e instanceof Error ? e.message : "iyzico bağlantı hatası." };
  }
}
