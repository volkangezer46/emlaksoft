import { NextRequest, NextResponse } from "next/server";
import { intakeLead, type LeadInput } from "@/lib/lead-intake";

export const dynamic = "force-dynamic";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

function toNumber(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  let body: Record<string, unknown> = {};
  const ct = req.headers.get("content-type") ?? "";
  try {
    if (ct.includes("application/json")) {
      body = (await req.json()) as Record<string, unknown>;
    } else {
      const fd = await req.formData();
      body = Object.fromEntries(fd.entries());
    }
  } catch {
    return NextResponse.json({ error: "Geçersiz gövde." }, { status: 400, headers: corsHeaders() });
  }

  const input: LeadInput = {
    fullName: String(body.full_name ?? body.fullName ?? body.name ?? "").trim(),
    phone: body.phone ? String(body.phone) : undefined,
    email: body.email ? String(body.email) : undefined,
    message: body.message ? String(body.message) : undefined,
    source: body.source ? String(body.source) : undefined,
    channel: body.channel ? String(body.channel) : "webhook",
    transactionType: body.transaction_type ? String(body.transaction_type) : undefined,
    propertyType: body.property_type ? String(body.property_type) : undefined,
    provinceId: body.province_id ? String(body.province_id) : undefined,
    budgetMin: toNumber(body.budget_min),
    budgetMax: toNumber(body.budget_max),
    rooms: body.rooms ? String(body.rooms) : undefined,
  };

  const result = await intakeLead(token, input);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status, headers: corsHeaders() });
  }

  return NextResponse.json(
    { ok: true, customer_id: result.customerId, duplicate: result.duplicate },
    { status: 200, headers: corsHeaders() },
  );
}
