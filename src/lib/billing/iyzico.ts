import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { isIP } from "node:net";
import {
  fetchExternal,
  readExternalJson,
  requireExternalSuccess,
} from "@/lib/external-fetch";

export const IYZICO_CURRENCY = "TRY" as const;
const IYZICO_DEFAULT_BASE_URL = "https://sandbox-api.iyzipay.com";
const IYZICO_ALLOWED_BASE_URLS = new Set([
  IYZICO_DEFAULT_BASE_URL,
  "https://api.iyzipay.com",
]);
const IYZICO_TIMEOUT_MS = 20_000;
const IYZICO_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export function normalizeIyzicoBuyerIp(value: string): string | null {
  const candidate = value.trim();
  if (!candidate || candidate.length > 128) return null;

  const mappedIpv4 = candidate.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i)?.[1];
  if (mappedIpv4 && isIP(mappedIpv4) === 4) return mappedIpv4;

  return isIP(candidate) === 0 ? null : candidate.toLowerCase();
}

export type IyzicoConfig = {
  apiKey: string;
  secretKey: string;
  baseUrl: string;
};

/** Accepts only iyzico's two exact HTTPS API origins. */
export function normalizeIyzicoBaseUrl(value?: string | null): string | null {
  const raw = value?.trim() || IYZICO_DEFAULT_BASE_URL;
  try {
    const url = new URL(raw);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    const origin = url.origin.toLowerCase();
    return IYZICO_ALLOWED_BASE_URLS.has(origin) ? origin : null;
  } catch {
    return null;
  }
}

export function getIyzicoConfig(): IyzicoConfig | null {
  const apiKey = process.env.IYZICO_API_KEY?.trim();
  const secretKey = process.env.IYZICO_SECRET_KEY?.trim();
  const baseUrl = normalizeIyzicoBaseUrl(process.env.IYZICO_BASE_URL);
  if (!apiKey || !secretKey || !baseUrl) return null;
  return { apiKey, secretKey, baseUrl };
}

export function isIyzicoConfigured() {
  return getIyzicoConfig() != null;
}

/**
 * Official IYZWSv2 canonical request authorization.
 *
 * The signed value is exactly `randomKey + requestPath + requestBody`. Keeping
 * this helper deterministic lets us lock the provider contract with a fixture.
 */
export function createIyzicoAuthorization(
  config: Pick<IyzicoConfig, "apiKey" | "secretKey">,
  path: string,
  body: string,
  randomKey: string,
) {
  if (!path.startsWith("/")) throw new Error("iyzico istek yolu gecersiz.");
  if (!randomKey.trim()) throw new Error("iyzico randomKey gecersiz.");
  const signature = createHmac("sha256", config.secretKey)
    .update(randomKey + path + body, "utf8")
    .digest("hex");
  const authorizationString = `apiKey:${config.apiKey}&randomKey:${randomKey}&signature:${signature}`;
  return {
    signature,
    authorizationString,
    authorization: `IYZWSv2 ${Buffer.from(authorizationString, "utf8").toString("base64")}`,
  };
}

/** IYZWSv2 Authorization headers for one exact path/body pair. */
function authHeaders(config: IyzicoConfig, path: string, body: string) {
  const randomKey = randomBytes(16).toString("hex");
  const { authorization } = createIyzicoAuthorization(config, path, body, randomKey);
  return {
    Authorization: authorization,
    "x-iyzi-rnd": randomKey,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

async function iyzicoPost<T>(path: string, payload: Record<string, unknown>): Promise<T> {
  const config = getIyzicoConfig();
  if (!config) throw new Error("iyzico yapılandırılmamış.");
  const body = JSON.stringify(payload);
  const endpoint = new URL(path, `${config.baseUrl}/`);
  if (endpoint.origin !== config.baseUrl || endpoint.pathname !== path) {
    throw new Error("iyzico istek yolu geçersiz.");
  }
  const res = await fetchExternal(endpoint, {
    method: "POST",
    headers: authHeaders(config, path, body),
    body,
    cache: "no-store",
  }, { timeoutMs: IYZICO_TIMEOUT_MS });
  await requireExternalSuccess(res);
  return readExternalJson<T>(res, IYZICO_MAX_RESPONSE_BYTES);
}

export type CheckoutInitResult = {
  status: string;
  token?: string;
  paymentPageUrl?: string;
  checkoutFormContent?: string;
  errorMessage?: string;
  conversationId?: string;
};

export type CheckoutRetrieveResult = {
  status: string;
  paymentStatus?: string;
  paymentId?: string | number;
  price?: string | number;
  paidPrice?: string | number;
  currency?: string;
  conversationId?: string;
  basketId?: string;
  token?: string;
  signature?: string;
  fraudStatus?: number | string;
  errorMessage?: string;
};

export type VerifiedCheckoutPayment = {
  conversationId: string;
  paymentId: string;
  basketId: string;
  amountTry: number;
  currency: typeof IYZICO_CURRENCY;
};

function parseProviderAmount(value: string | number | undefined): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const parsed = typeof value === "number" ? value : Number(value.trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function sameMoney(left: number, right: number): boolean {
  return Math.abs(left - right) <= 0.01;
}

/** Reconcile the provider result before allowing a service-role write. */
export function verifyCheckoutPayment(
  result: CheckoutRetrieveResult,
  expected: {
    conversationId: string;
    basketId: string;
    amountTry: number;
    paymentId?: string | null;
    currency?: typeof IYZICO_CURRENCY;
  },
): VerifiedCheckoutPayment {
  if (!verifyCheckoutRetrieveResponseSignature(result)) {
    throw new Error("Sağlayıcı yanıt imzası doğrulanamadı.");
  }

  const status = String(result.status ?? "").trim().toLowerCase();
  const paymentStatus = String(result.paymentStatus ?? "").trim().toLowerCase();
  const conversationId = String(result.conversationId ?? "").trim();
  const paymentId = String(result.paymentId ?? "").trim();
  const basketId = String(result.basketId ?? "").trim();
  const currency = String(result.currency ?? "").trim().toUpperCase();
  const price = parseProviderAmount(result.price);
  const paidPrice = parseProviderAmount(result.paidPrice);
  const expectedCurrency = expected.currency ?? IYZICO_CURRENCY;
  const fraudStatus = typeof result.fraudStatus === "number"
    ? result.fraudStatus
    : Number(String(result.fraudStatus ?? "").trim());

  if (status !== "success" || paymentStatus !== "success") {
    throw new Error("Sağlayıcı ödeme durumunu başarılı olarak doğrulamadı.");
  }
  // iyzico: 1=approved, 0=review, -1=rejected. Missing/unknown values are not
  // eligible for fulfillment; this is intentionally fail-closed.
  if (fraudStatus !== 1) {
    throw new Error("Sağlayıcı sahtecilik kontrolü ödemeyi onaylamadı.");
  }
  if (!paymentId || (expected.paymentId && paymentId !== expected.paymentId)) {
    throw new Error("Sağlayıcı ödeme kimliği eşleşmedi.");
  }
  if (!conversationId || conversationId !== expected.conversationId) {
    throw new Error("Sağlayıcı işlem kimliği eşleşmedi.");
  }
  if (!basketId || basketId !== expected.basketId) {
    throw new Error("Sağlayıcı sepet kimliği eşleşmedi.");
  }
  if (currency !== expectedCurrency) {
    throw new Error("Sağlayıcı para birimi eşleşmedi.");
  }
  if (
    !Number.isFinite(expected.amountTry) ||
    expected.amountTry <= 0 ||
    price === null ||
    paidPrice === null ||
    !sameMoney(price, expected.amountTry) ||
    !sameMoney(paidPrice, expected.amountTry)
  ) {
    throw new Error("Sağlayıcı tahsilat tutarı eşleşmedi.");
  }

  return {
    conversationId,
    paymentId,
    basketId,
    amountTry: paidPrice,
    currency: IYZICO_CURRENCY,
  };
}

function responseSignatureAmount(value: string | number | undefined): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const raw = String(value).trim();
  const match = raw.match(/^(\d+)(?:\.(\d+))?$/);
  if (!match) return null;
  const integer = match[1]!.replace(/^0+(?=\d)/, "");
  const fraction = (match[2] ?? "").replace(/0+$/, "");
  return fraction ? `${integer}.${fraction}` : integer;
}

/** Official Checkout Form retrieve response HMAC (colon-separated field order). */
export function createCheckoutRetrieveResponseSignature(
  secretKey: string,
  result: CheckoutRetrieveResult,
): string | null {
  const fields = [
    String(result.paymentStatus ?? "").trim(),
    String(result.paymentId ?? "").trim(),
    String(result.currency ?? "").trim(),
    String(result.basketId ?? "").trim(),
    String(result.conversationId ?? "").trim(),
    responseSignatureAmount(result.paidPrice) ?? "",
    responseSignatureAmount(result.price) ?? "",
    String(result.token ?? "").trim(),
  ];
  const secret = secretKey.trim();
  if (!secret || fields.some((field) => !field)) return null;
  return createHmac("sha256", secret).update(fields.join(":"), "utf8").digest("hex");
}

export function verifyCheckoutRetrieveResponseSignature(
  result: CheckoutRetrieveResult,
  secretKey = getIyzicoConfig()?.secretKey ?? "",
): boolean {
  const actual = result.signature?.trim().toLowerCase() ?? "";
  if (!/^[0-9a-f]{64}$/.test(actual)) return false;
  const expected = createCheckoutRetrieveResponseSignature(secretKey, result);
  return Boolean(
    expected && timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(actual, "hex")),
  );
}

export async function initializeCheckoutForm(input: {
  conversationId: string;
  price: number;
  paidPrice: number;
  basketId: string;
  callbackUrl: string;
  paymentGroup?: "SUBSCRIPTION" | "PRODUCT";
  basketCategory?: string;
  buyer: {
    id: string;
    name: string;
    surname: string;
    email: string;
    gsmNumber: string;
    identityNumber: string;
    registrationAddress: string;
    city: string;
    country: string;
    ip: string;
  };
  billingAddress: {
    contactName: string;
    city: string;
    country: string;
    address: string;
  };
  basketItemName: string;
}): Promise<CheckoutInitResult> {
  const buyerIp = normalizeIyzicoBuyerIp(input.buyer.ip);
  if (!buyerIp) throw new Error("Ödeme için geçerli istemci IP adresi bulunamadı.");

  const price = input.price.toFixed(2);
  const paidPrice = input.paidPrice.toFixed(2);
  return iyzicoPost<CheckoutInitResult>("/payment/iyzipos/checkoutform/initialize/auth/ecom", {
    locale: "tr",
    conversationId: input.conversationId,
    price,
    paidPrice,
    currency: IYZICO_CURRENCY,
    basketId: input.basketId,
    paymentGroup: input.paymentGroup ?? "SUBSCRIPTION",
    callbackUrl: input.callbackUrl,
    enabledInstallments: [1],
    buyer: {
      id: input.buyer.id,
      name: input.buyer.name,
      surname: input.buyer.surname,
      gsmNumber: input.buyer.gsmNumber,
      email: input.buyer.email,
      identityNumber: input.buyer.identityNumber,
      registrationAddress: input.buyer.registrationAddress,
      ip: buyerIp,
      city: input.buyer.city,
      country: input.buyer.country,
    },
    shippingAddress: {
      contactName: input.billingAddress.contactName,
      city: input.billingAddress.city,
      country: input.billingAddress.country,
      address: input.billingAddress.address,
    },
    billingAddress: {
      contactName: input.billingAddress.contactName,
      city: input.billingAddress.city,
      country: input.billingAddress.country,
      address: input.billingAddress.address,
    },
    basketItems: [
      {
        id: input.basketId,
        name: input.basketItemName,
        category1: input.basketCategory ?? "Abonelik",
        itemType: "VIRTUAL",
        price,
      },
    ],
  });
}

export async function retrieveCheckoutForm(token: string): Promise<CheckoutRetrieveResult> {
  const result = await iyzicoPost<CheckoutRetrieveResult>("/payment/iyzipos/checkoutform/auth/ecom/detail", {
    locale: "tr",
    token,
  });
  const successful = String(result.status ?? "").toLowerCase() === "success"
    && String(result.paymentStatus ?? "").toLowerCase() === "success";
  if (successful && String(result.token ?? "").trim() !== token.trim()) {
    throw new Error("iyzico yanıt tokenı eşleşmedi.");
  }
  if (successful && !verifyCheckoutRetrieveResponseSignature(result)) {
    throw new Error("iyzico yanıt imzası doğrulanamadı.");
  }
  return result;
}

export type IyzicoWebhookSignatureV3Input =
  | {
      format: "direct";
      iyziEventType: string;
      paymentId: string;
      paymentConversationId: string;
      status: string;
    }
  | {
      format: "hpp";
      iyziEventType: string;
      iyziPaymentId: string;
      token: string;
      paymentConversationId: string;
      status: string;
    };

/**
 * Official X-IYZ-SIGNATURE-V3 canonicalization.
 *
 * Direct: secretKey + iyziEventType + paymentId + paymentConversationId + status
 * HPP:    secretKey + iyziEventType + iyziPaymentId + token +
 *         paymentConversationId + status
 */
export function createWebhookSignatureV3(
  secretKey: string,
  input: IyzicoWebhookSignatureV3Input,
): string | null {
  const secret = secretKey.trim();
  const parts = input.format === "direct"
    ? [input.iyziEventType, input.paymentId, input.paymentConversationId, input.status]
    : [input.iyziEventType, input.iyziPaymentId, input.token, input.paymentConversationId, input.status];

  if (!secret || parts.some((part) => typeof part !== "string" || !part.trim())) return null;
  const canonical = [secret, ...parts].join("");
  return createHmac("sha256", secret).update(canonical, "utf8").digest("hex");
}

export function verifyWebhookSignatureV3(
  headerSignature: string | null,
  input: IyzicoWebhookSignatureV3Input,
): boolean {
  const config = getIyzicoConfig();
  const actual = headerSignature?.trim().toLowerCase() ?? "";
  if (!config || !/^[0-9a-f]{64}$/.test(actual)) return false;

  const expected = createWebhookSignatureV3(config.secretKey, input);
  if (!expected) return false;
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(actual, "hex"));
}
