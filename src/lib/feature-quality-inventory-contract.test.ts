import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(process.cwd(), "src/app/app");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const productPages = walk(ROOT).filter((file) => file.endsWith("page.tsx"));

describe("product feature quality inventory", () => {
  it("keeps every signed-in product page behind an explicit module or session gate", () => {
    expect(productPages.length).toBeGreaterThanOrEqual(80);

    const unguarded = productPages.filter((file) => {
      const source = readFileSync(file, "utf8");
      // getRequestUser(): aynı oturum doğrulamasının istek-başı önbellekli sarmalayıcısı.
      return !source.includes("requireModulePage(") && !source.includes("auth.getUser(") && !source.includes("getRequestUser(");
    });

    expect(unguarded.map((file) => relative(process.cwd(), file))).toEqual([]);
  });

  it("gives every signed-in product route a loading boundary through its own or an ancestor segment", () => {
    const withoutLoadingBoundary = productPages.filter((file) => {
      let directory = resolve(file, "..");
      while (directory.startsWith(ROOT)) {
        try {
          statSync(join(directory, "loading.tsx"));
          return false;
        } catch {
          if (directory === ROOT) break;
          directory = resolve(directory, "..");
        }
      }
      return true;
    });

    expect(withoutLoadingBoundary.map((file) => relative(process.cwd(), file))).toEqual([]);
  });

  it("keeps accessible recovery focus in root, product and admin error boundaries", () => {
    // /app ve /admin sınırları kanonik `ui/route-error` görünümünü çizer (odak + kayıt orada).
    for (const file of [
      "src/app/error.tsx",
      "src/components/ui/route-error.tsx",
    ]) {
      const source = readFileSync(resolve(process.cwd(), file), "utf8");
      expect(source, file).toContain("headingRef.current?.focus()");
      expect(source, file).toContain("tabIndex={-1}");
      expect(source, file).toContain("reportClientError(");
    }
    for (const file of ["src/app/app/error.tsx", "src/app/admin/error.tsx"]) {
      expect(readFileSync(resolve(process.cwd(), file), "utf8"), file).toContain("<RouteError");
    }
  });

  it("validates expense property ownership and never reports a missing mutation as successful", () => {
    const source = readFileSync(resolve(process.cwd(), "src/app/actions/expenses.ts"), "utf8");
    const createForm = readFileSync(
      resolve(process.cwd(), "src/app/app/giderler/expense-create-form.tsx"),
      "utf8",
    );
    const table = readFileSync(
      resolve(process.cwd(), "src/app/app/giderler/expenses-table.tsx"),
      "utf8",
    );

    expect(source.match(/validateTenantReferences\(gate\.tenantId, \{ propertyId \}\)/g)).toHaveLength(2);
    expect(source).toContain('.eq("tenant_id", gate.tenantId)');
    expect(source.match(/\.select\("id"\)\s*\.maybeSingle\(\)/g)).toHaveLength(2);
    expect(source).toContain('if (!data) return { error: "Gider kaydı bulunamadı." };');
    expect(source).toContain('return { error: actionErrorMessage(error, "Gider silinemedi.") };');
    expect(source).toContain('throw new Error("Gider kayıtları güvenli şekilde yüklenemedi.")');
    expect(createForm).toContain("useActionState<ExpenseResult, FormData>");
    expect(createForm).toContain('role="alert"');
    expect(createForm).toContain("aria-busy={pending}");
    expect(table).toContain("const result = await deleteExpense(e.id)");
    expect(table).toContain('push(result.error, "err")');
  });
});
