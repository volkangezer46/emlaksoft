import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { intakeLead, type LeadInput } from "@/lib/lead-intake";
import { buildLeadConsentVersion } from "@/lib/legal-copy";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  PUBLIC_REQUEST_MAX_BYTES,
  clientIpFromHeaders,
  isAllowedCorsOrigin,
  leadCorsHeaders,
  opaqueRateLimitPart,
  parseOriginAllowlist,
  publicEvidenceHash,
  readRequestBodyLimited,
  requestBodyTooLarge,
} from "@/lib/public-request-security";

export const dynamic = "force-dynamic";

/** Metin sürümü ve pazarlama tercihi legal-copy.ts'ten gelir (v2: amaç düzeltmesi + ayrı pazarlama kutusu). */
export const PUBLIC_LEAD_CONSENT_VERSION = buildLeadConsentVersion(false);

function allowedOrigins(req: NextRequest): string[] {
  return [
    ...parseOriginAllowlist(process.env.LEAD_CORS_ORIGINS),
    req.nextUrl.origin,
    ...parseOriginAllowlist(process.env.NEXT_PUBLIC_APP_URL),
  ];
}

function response(
  req: NextRequest,
  body: Record<string, unknown>,
  status: number,
  extraHeaders?: Record<string, string>,
) {
  return NextResponse.json(body, {
    status,
    headers: {
      ...leadCorsHeaders(req.headers.get("origin"), allowedOrigins(req)),
      ...extraHeaders,
    },
  });
}

export async function OPTIONS(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (!isAllowedCorsOrigin(origin, allowedOrigins(req))) {
    return response(req, { error: "origin_not_allowed" }, 403);
  }
  return new NextResponse(null, {
    status: 204,
    headers: leadCorsHeaders(origin, allowedOrigins(req)),
  });
}

function toNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const number = Number(String(value).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(number) ? number : null;
}

function isConsentAccepted(value: unknown): boolean {
  if (value === true) return true;
  return ["1", "true", "on", "accepted"].includes(String(value ?? "").trim().toLowerCase());
}

async function readBody(req: NextRequest): Promise<Record<string, unknown> | null> {
  const bytes = await readRequestBodyLimited(req, PUBLIC_REQUEST_MAX_BYTES);
  if (bytes === null) return null;
  const text = new TextDecoder().decode(bytes);
  const contentType = (req.headers.get("content-type") ?? "").toLowerCase();

  if (contentType.includes("application/json")) {
    const value = JSON.parse(text) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_json_object");
    return value as Record<string, unknown>;
  }
  if (contentType.includes("application/x-www-form-urlencoded") || !contentType) {
    return Object.fromEntries(new URLSearchParams(text));
  }
  throw new Error("unsupported_content_type");
}

function bounded(value: unknown, max: number): string | undefined {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized.slice(0, max) : undefined;
}

export async function POST(
  req: NextRequest,
  // `RouteContext` global tipi yalnız `next dev/build` sonrası `.next/types`'ta bulunur;
  // temiz checkout'ta (CI) `tsc` daha build'den önce koşar. Açık tip bundan bağımsızdır.
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (token.length < 32 || token.length > 128 || !/^[A-Za-z0-9._~-]+$/.test(token)) {
    return response(req, { error: "Geçersiz bağlantı." }, 404);
  }

  const origin = req.headers.get("origin");
  if (!isAllowedCorsOrigin(origin, allowedOrigins(req))) {
    return response(req, { error: "origin_not_allowed" }, 403);
  }
  if (requestBodyTooLarge(req.headers, PUBLIC_REQUEST_MAX_BYTES)) {
    return response(req, { error: "İstek gövdesi çok büyük." }, 413);
  }

  const ip = clientIpFromHeaders(req.headers);
  const tokenKey = opaqueRateLimitPart(token);
  const ipKey = opaqueRateLimitPart(ip);
  const [perIp, perToken] = await Promise.all([
    checkRateLimit(`public-lead:ip:${tokenKey}:${ipKey}`, {
      limit: 8,
      windowSec: 10 * 60,
      failurePolicy: "deny",
    }),
    checkRateLimit(`public-lead:token:${tokenKey}`, {
      limit: 300,
      windowSec: 60 * 60,
      failurePolicy: "deny",
    }),
  ]);
  if (!perIp.allowed || !perToken.allowed) {
    const infrastructureFailure = perIp.degraded || perToken.degraded;
    return response(
      req,
      { error: infrastructureFailure ? "Güvenlik denetimi kullanılamıyor." : "Çok fazla istek gönderdiniz." },
      infrastructureFailure ? 503 : 429,
      { "Retry-After": infrastructureFailure ? "60" : "600" },
    );
  }

  let body: Record<string, unknown> | null;
  try {
    body = await readBody(req);
  } catch {
    return response(req, { error: "Geçersiz istek gövdesi." }, 400);
  }
  if (body === null) return response(req, { error: "İstek gövdesi çok büyük." }, 413);

  // Server-side honeypot: scripts and direct POSTs cannot bypass this gate.
  if (String(body.website ?? "").trim()) {
    return response(req, { ok: true }, 202);
  }
  if (!isConsentAccepted(body.kvkk)) {
    return response(req, { error: "Devam etmek için KVKK onayı gerekli." }, 400);
  }

  const fullName = bounded(body.full_name ?? body.fullName ?? body.name, 120) ?? "";
  const email = bounded(body.email, 254);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return response(req, { error: "Geçerli bir e-posta adresi girin." }, 400);
  }

  const requestIdCandidate = bounded(body.request_id ?? req.headers.get("x-idempotency-key"), 64);
  const requestId = requestIdCandidate && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestIdCandidate)
    ? requestIdCandidate
    : randomUUID();
  const acceptedAt = new Date().toISOString();
  const source = bounded(body.source, 80) ?? "web_form";
  const channel = bounded(body.channel, 40) ?? "webhook";

  const input: LeadInput = {
    fullName,
    phone: bounded(body.phone, 40),
    email,
    message: bounded(body.message, 2_000),
    source,
    channel,
    transactionType: bounded(body.transaction_type, 40),
    propertyType: bounded(body.property_type, 80),
    provinceId: bounded(body.province_id, 64),
    budgetMin: toNumber(body.budget_min),
    budgetMax: toNumber(body.budget_max),
    rooms: bounded(body.rooms, 40),
    consent: {
      requestId,
      scope: "lead_intake",
      version: buildLeadConsentVersion(isConsentAccepted(body.marketing_opt_in)),
      acceptedAt,
      ipHash: publicEvidenceHash(ip),
      userAgentHash: publicEvidenceHash(req.headers.get("user-agent")),
    },
  };

  const result = await intakeLead(token, input);
  if (!result.ok) return response(req, { error: result.error }, result.status);

  // Do not expose internal customer/profile identifiers to a public caller.
  return response(req, { ok: true, duplicate: result.duplicate, request_id: requestId }, 200);
}
