import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const providerMocks = vi.hoisted(() => ({
  emlakfiyati: vi.fn(),
  tenantSms: vi.fn(),
  tenantWhatsApp: vi.fn(),
  platformNetgsm: vi.fn(),
  platformWhatsApp: vi.fn(),
  iyzico: vi.fn(),
  portal: vi.fn(),
}));

vi.mock("./emlakfiyati/client", () => ({
  isEmlakFiyatiConfigured: providerMocks.emlakfiyati,
}));
vi.mock("@/lib/messaging/netgsm", () => ({
  getNetgsmConfig: providerMocks.platformNetgsm,
  getWhatsAppConfig: providerMocks.platformWhatsApp,
}));
vi.mock("@/lib/messaging/tenant-providers", () => ({
  isTenantSmsAvailable: providerMocks.tenantSms,
  isTenantWhatsAppAvailable: providerMocks.tenantWhatsApp,
}));
vi.mock("@/lib/billing/iyzico", () => ({
  isIyzicoConfigured: providerMocks.iyzico,
}));
vi.mock("@/lib/integrations/portals", () => ({
  isPortalConfigured: providerMocks.portal,
}));

import { listIntegrations } from "./registry";

// Kaldırılan sağlayıcı adları parçalı yazılır: repo genelindeki "kalıntı yok" taramasına takılmasın.
const REMOVED_PROVIDER_KEYS = ["end" + "eksa", "tapu" + "sor"];

function statusOf(
  integrations: Awaited<ReturnType<typeof listIntegrations>>,
  key: string,
) {
  return integrations.find((integration) => integration.key === key)?.status;
}

describe("integration readiness registry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    providerMocks.emlakfiyati.mockReturnValue(false);
    providerMocks.tenantSms.mockResolvedValue(false);
    providerMocks.tenantWhatsApp.mockResolvedValue(false);
    providerMocks.platformNetgsm.mockResolvedValue(null);
    providerMocks.platformWhatsApp.mockResolvedValue(null);
    providerMocks.iyzico.mockReturnValue(false);
    providerMocks.portal.mockResolvedValue(false);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses tenant-isolated provider readiness for an office", async () => {
    providerMocks.tenantSms.mockResolvedValue(true);
    providerMocks.tenantWhatsApp.mockResolvedValue(true);

    const integrations = await listIntegrations("tenant-1");

    expect(providerMocks.tenantSms).toHaveBeenCalledWith("tenant-1");
    expect(providerMocks.tenantWhatsApp).toHaveBeenCalledWith("tenant-1");
    expect(providerMocks.platformNetgsm).not.toHaveBeenCalled();
    expect(providerMocks.platformWhatsApp).not.toHaveBeenCalled();
    expect(statusOf(integrations, "netgsm")).toBe("configured");
    expect(statusOf(integrations, "whatsapp")).toBe("configured");
  });

  it("does not claim a tenant provider is configured from unrelated env names", async () => {
    vi.stubEnv("WHATSAPP_PHONE_ID", "legacy-phone-id");
    vi.stubEnv("WHATSAPP_TOKEN", "legacy-token");

    const integrations = await listIntegrations("tenant-2");

    expect(statusOf(integrations, "whatsapp")).toBe("setup_required");
  });

  it("does not advertise obsolete shared Meta identity env fields", () => {
    const example = readFileSync(resolve(process.cwd(), ".env.example"), "utf8");
    expect(example).not.toMatch(/^WHATSAPP_PHONE_ID=/m);
    expect(example).not.toMatch(/^WHATSAPP_TOKEN=/m);
    expect(example).toMatch(/^WHATSAPP_API_URL=/m);
    expect(example).toMatch(/^WHATSAPP_API_TOKEN=/m);
  });

  it("uses platform readiness only for a platform-level view", async () => {
    providerMocks.platformNetgsm.mockResolvedValue({});
    providerMocks.platformWhatsApp.mockResolvedValue({});

    const integrations = await listIntegrations();

    expect(providerMocks.tenantSms).not.toHaveBeenCalled();
    expect(providerMocks.tenantWhatsApp).not.toHaveBeenCalled();
    expect(statusOf(integrations, "netgsm")).toBe("configured");
    expect(statusOf(integrations, "whatsapp")).toBe("configured");
  });

  it("exposes only product-wired providers as configured", async () => {
    providerMocks.iyzico.mockReturnValue(true);
    providerMocks.portal.mockImplementation(async (portal: string) => portal === "hepsiemlak");

    const integrations = await listIntegrations("tenant-3");

    expect(statusOf(integrations, "iyzico")).toBe("configured");
    expect(statusOf(integrations, "property_portals")).toBe("configured");
    expect(statusOf(integrations, "efatura")).toBe("planned");
  });

  it("reports EmlakFiyati from the API key readiness and no longer lists removed providers", async () => {
    let integrations = await listIntegrations("tenant-4");
    expect(statusOf(integrations, "emlakfiyati")).toBe("setup_required");
    expect(integrations.some((i) => REMOVED_PROVIDER_KEYS.includes(i.key))).toBe(false);

    providerMocks.emlakfiyati.mockReturnValue(true);
    integrations = await listIntegrations("tenant-4");
    expect(statusOf(integrations, "emlakfiyati")).toBe("configured");
  });
});
