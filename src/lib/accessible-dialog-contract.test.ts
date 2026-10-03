import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(file: string): string {
  return readFileSync(file, "utf8");
}

const convertedDialogs = [
  { file: "src/app/app/anlasmalar/deal-board.tsx", count: 1 },
  { file: "src/app/app/anlasmalar/loss-reason-dialog.tsx", count: 1 },
  { file: "src/app/app/anlasmalar/win-celebration-dialog.tsx", count: 1 },
  { file: "src/app/app/portfoyler/[id]/property-media-manager.tsx", count: 1 },
] as const;

const sharedDialogSurfaces = [
  "src/app/admin/tenants/[id]/subscription-panel.tsx",
  "src/app/danisman/[slug]/agent-share-card.tsx",
] as const;

const fullscreenDialogSurfaces = [
  { file: "src/components/public/gallery-lightbox.tsx", count: 1 },
  { file: "src/components/public/compare-table.tsx", count: 1 },
  { file: "src/app/app/belgeler/document-list.tsx", count: 1 },
  { file: "src/app/app/product-tour.tsx", count: 2 },
] as const;

describe("accessible sales and operations dialog contract", () => {
  it.each(convertedDialogs)(
    "uses shared Dialog primitives for $file",
    ({ file, count }) => {
      const content = source(file);

      expect(content.match(/<Dialog\s/g), file).toHaveLength(count);
      expect(content.match(/<DialogContent\b/g), file).toHaveLength(count);
      expect(content.match(/<DialogTitle\b/g), file).toHaveLength(count);
      expect(content.match(/<DialogDescription\b/g), file).toHaveLength(count);
      expect(content.match(/onCloseAutoFocus=/g), file).toHaveLength(count);
      expect(content).toContain("<DialogClose asChild>");
    },
  );

  it.each(convertedDialogs)(
    "does not reintroduce a raw full-screen modal overlay in $file",
    ({ file }) => {
      expect(source(file)).not.toContain("fixed inset-0");
    },
  );

  it("keeps the established overlay appearance while delegating behavior to Radix", () => {
    for (const { file } of convertedDialogs) {
      expect(source(file)).toContain(
        'overlayClassName="bg-ink-950/40 backdrop-blur-sm"',
      );
    }
  });

  it("exposes reusable visible title and description primitives", () => {
    const dialog = source("src/components/ui/dialog.tsx");

    expect(dialog).toContain("export const DialogTitle = DialogPrimitive.Title");
    expect(dialog).toContain(
      "export const DialogDescription = DialogPrimitive.Description",
    );
  });

  it.each(sharedDialogSurfaces)(
    "uses the focus-managed shared Dialog instead of a raw overlay in %s",
    (file) => {
      const content = source(file);
      expect(content).toContain('from "@/components/ui/dialog"');
      expect(content).toContain("<DialogContent");
      expect(content).toContain("<DialogHeader");
      expect(content).not.toContain('role="dialog"');
      expect(content).not.toContain('className="fixed inset-0');
    },
  );

  it.each(fullscreenDialogSurfaces)(
    "keeps fullscreen UX inside the shared focus-managed Dialog in $file",
    ({ file, count }) => {
      const content = source(file);
      expect(content.match(/<Dialog\s/g), file).toHaveLength(count);
      expect(content.match(/<DialogFullscreenContent\b/g), file).toHaveLength(count);
      expect(content.match(/<DialogTitle\b/g), file).toHaveLength(count);
      expect(content.match(/<DialogDescription\b/g), file).toHaveLength(count);
      expect(content, file).not.toContain('role="dialog"');
      expect(content, file).not.toContain('aria-modal="true"');
      expect(content, file).not.toContain("createPortal");
    },
  );

  it("provides a reusable Radix fullscreen primitive", () => {
    const dialog = source("src/components/ui/dialog.tsx");
    expect(dialog).toContain("export function DialogFullscreenContent");
    expect(dialog).toContain("<DialogPrimitive.Portal>");
    expect(dialog).toContain("<DialogPrimitive.Overlay");
    expect(dialog).toContain("<DialogPrimitive.Content");
  });
});

const inlinePanelFlows = [
  "src/app/app/gorevler/task-edit-dialog.tsx",
  "src/app/app/randevular/appointment-edit-dialog.tsx",
  "src/app/app/musteriler/[id]/edit-customer-dialog.tsx",
  "src/app/app/musteriler/[id]/edit-demand-dialog.tsx",
  "src/app/app/portfoyler/[id]/edit-property-dialog.tsx",
  "src/app/app/giderler/expense-edit-dialog.tsx",
  "src/app/app/teklifler/[id]/offer-edit-dialog.tsx",
  "src/app/app/hedefler/target-form-dialog.tsx",
] as const;

describe("inline panel (popup yerine sayfa içi sekme alanı) sözleşmesi", () => {
  it.each(inlinePanelFlows)("%s popup değil InlineTabbedPanel kullanır", (file) => {
    const content = source(file);
    expect(content).toContain("<InlineTabbedPanel");
    expect(content).not.toContain("@/components/ui/dialog");
    expect(content).not.toContain("<DialogContent");
    expect(content).not.toContain("createPortal");
  });

  it("panel modal değildir ve layout'ta yuvası vardır", () => {
    const panel = source("src/components/ui/inline-tabbed-panel.tsx");
    expect(panel).not.toContain("@radix-ui/react-dialog");
    expect(panel).not.toContain("aria-modal");
    expect(panel).toContain("Ctrl/⌘+Enter");
    expect(source("src/app/app/layout.tsx")).toContain('id="inline-panel-host"');
  });
});
