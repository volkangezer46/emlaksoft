import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * "Popup yok" sözleşmesi (modül derinliği turu, 2026-10-07): bu akışlar sayfa içi panele
 * (`@/components/ui/inline-dialog`, `#inline-panel-host` yuvası) taşındı. Radix modal
 * (`@/components/ui/dialog`) geri gelmesin. Kısa evet/hayır onayı `ConfirmDialog` ile kalabilir.
 */
const INLINE_FLOWS = [
  "src/app/app/portallar/portal-dialogs.tsx",
  "src/components/app/portal-link-dialog.tsx",
  "src/app/app/ag/demand-response-dialog.tsx",
  "src/app/app/ag/collab-request-dialog.tsx",
  "src/app/app/teklifler/[id]/offer-round-dialog.tsx",
  "src/app/app/sozlesmeler/[id]/fill-fields-dialog.tsx",
  "src/app/app/onaylar/approval-actions.tsx",
  "src/app/app/komisyon/commission-split-editor.tsx",
  "src/app/app/gelen-kutusu/sms-dialog.tsx",
  "src/components/listing-control/anomaly-actions.tsx",
  "src/components/app/wa-template-menu.tsx",
] as const;

describe("sayfa içi panel akışları (popup yok)", () => {
  it.each(INLINE_FLOWS)("%s Radix modal kullanmaz", (file) => {
    const src = readFileSync(file, "utf8");
    expect(src).not.toContain('from "@/components/ui/dialog"');
    expect(src).not.toMatch(/fixed inset-0/);
  });

  it("inline-dialog overlay/portal-modal içermez, panel yuvasını kullanır", () => {
    const src = readFileSync("src/components/ui/inline-dialog.tsx", "utf8");
    expect(src).not.toContain("@radix-ui/react-dialog");
    expect(src).not.toContain("fixed inset-0");
    expect(src).toContain("INLINE_PANEL_HOST_ID");
  });
});
