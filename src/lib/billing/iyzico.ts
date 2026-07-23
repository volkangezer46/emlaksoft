import { createHmac, randomBytes, timingSafeEqual } from "crypto";

export type IyzicoConfig = {
  apiKey: string;
  secretKey: string;
  baseUrl: string;
};

export function getIyzicoConfig(): IyzicoConfig | null {
  const apiKey = process.env.IYZICO_API_KEY?.trim();
  const secretKey = process.env.IYZICO_SECRET_KEY?.trim();
  const baseUrl = (process.env.IYZICO_BASE_URL?.trim() || "https://sandbox-api.iyzipay.com").replace(/\/$/, "");
  if (!apiKey || !secretKey) return null;
  return { apiKey, secretKey, baseUrl };
}

export function isIyzicoConfigured() {
  return getIyzicoConfig() != null;
}

/** IYZWSv2 Authorization header */
function authHeaders(config: IyzicoConfig, body: string) {
  const randomKey = randomBytes(8).toString("hex") + Date.now().toString();
  const signature = createHmac("sha256", config.secretKey)
    .update(randomKey + body)
    .digest("hex");
  const authorizationString = `apiKey:${config.apiKey}&randomKey:${randomKey}&signature:${signature}`;
  const authorization = `IYZWSv2 ${Buffer.from(authorizationString).toString("base64")}`;
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
  const res = await fetch(`${config.baseUrl}${path}`, {
    method: "POST",
    headers: authHeaders(config, body),
    body,
    cache: "no-store",
  });
  const data = (await res.json()) as T & { status?: string; errorMessage?: string };
  if (!res.ok) {
    throw new Error((data as { errorMessage?: string }).errorMessage || `iyzico HTTP ${res.status}`);
  }
  return data;
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
  conversationId?: string;
  basketId?: string;
  errorMessage?: string;
};

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
  };
  billingAddress: {
    contactName: string;
    city: string;
    country: string;
    address: string;
  };
  basketItemName: string;
}): Promise<CheckoutInitResult> {
  const price = input.price.toFixed(2);
  const paidPrice = input.paidPrice.toFixed(2);
  return iyzicoPost<CheckoutInitResult>("/payment/iyzipos/checkoutform/initialize/auth/ecom", {
    locale: "tr",
    conversationId: input.conversationId,
    price,
    paidPrice,
    currency: "TRY",
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
      ip: "85.34.78.112",
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
  return iyzicoPost<CheckoutRetrieveResult>("/payment/iyzipos/checkoutform/auth/ecom/detail", {
    locale: "tr",
    token,
  });
}

/**
 * Webhook X-IYZ-SIGNATURE-V3 doğrulama.
 * message = merchantId + secretKey + iyziEventType + paymentConversationId + status
 * (token varsa eklenir — portal sürümüne göre değişebilir)
 */
export function verifyWebhookSignatureV3(params: {
  headerSignature: string | null;
  merchantId?: string;
  iyziEventType?: string;
  token?: string;
  paymentConversationId?: string;
  status?: string;
}): boolean {
  const config = getIyzicoConfig();
  if (!config || !params.headerSignature) return false;

  const merchantId = params.merchantId ?? process.env.IYZICO_MERCHANT_ID?.trim() ?? "";
  const parts = [
    merchantId,
    config.secretKey,
    params.iyziEventType ?? "",
    params.token ?? "",
    params.paymentConversationId ?? "",
    params.status ?? "",
  ];
  const message = parts.join("");
  const digest = createHmac("sha256", config.secretKey).update(message).digest("hex");

  // bazı hesaplarda merchantId olmadan da üretilir
  const alt = createHmac("sha256", config.secretKey)
    .update(
      [
        config.secretKey,
        params.iyziEventType ?? "",
        params.token ?? "",
        params.paymentConversationId ?? "",
        params.status ?? "",
      ].join(""),
    )
    .digest("hex");

  return timingSafeEqualHex(digest, params.headerSignature) || timingSafeEqualHex(alt, params.headerSignature);
}

function timingSafeEqualHex(a: string, b: string) {
  try {
    const ba = Buffer.from(a.toLowerCase());
    const bb = Buffer.from(b.toLowerCase());
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}
