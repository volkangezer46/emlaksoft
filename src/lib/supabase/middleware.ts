import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isTwoFactorCookieValid, TWO_FACTOR_COOKIE } from "@/lib/two-factor";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    return supabaseResponse;
  }

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options),
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isApp = path.startsWith("/app");
  const isAdmin = path.startsWith("/admin");
  const isAuthPage = path === "/giris" || path === "/kayit";

  if ((isApp || isAdmin) && !user) {
    const redirect = request.nextUrl.clone();
    redirect.pathname = "/giris";
    redirect.searchParams.set("next", path);
    return NextResponse.redirect(redirect);
  }

  // Suspended / cancelled tenants cannot use the office app (except status page).
  // Platform staff may still enter /app for ops; mutations are also guarded in actions.
  if (isApp && user && !path.startsWith("/app/askida")) {
    const tenantId = user.app_metadata?.tenant_id as string | undefined;
    if (tenantId) {
      const [{ data: tenant }, { data: staff }] = await Promise.all([
        supabase.from("tenants").select("status").eq("id", tenantId).maybeSingle(),
        supabase
          .from("platform_staff")
          .select("id")
          .eq("id", user.id)
          .eq("is_active", true)
          .maybeSingle(),
      ]);
      if (
        !staff &&
        (tenant?.status === "suspended" || tenant?.status === "cancelled")
      ) {
        const redirect = request.nextUrl.clone();
        redirect.pathname = "/app/askida";
        return NextResponse.redirect(redirect);
      }
    }
  }

  // SMS 2FA: şifre doğru ama kod henüz doğrulanmadıysa panel kullanılamaz.
  // Çerez geçerliyse (HMAC, kullanıcıya özel) ek sorgu YOK; değilse tek
  // profil sorgusuyla 2FA'nın açık olup olmadığına bakılır.
  // /giris/dogrulama matcher dışında olduğundan yönlendirme döngüsü oluşmaz.
  if ((isApp || isAdmin) && user) {
    const verified = await isTwoFactorCookieValid(
      request.cookies.get(TWO_FACTOR_COOKIE)?.value,
      user.id,
    );
    if (!verified) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("two_factor_sms, phone")
        .eq("id", user.id)
        .maybeSingle();
      if (profile?.two_factor_sms && profile.phone) {
        const redirect = request.nextUrl.clone();
        redirect.pathname = "/giris/dogrulama";
        redirect.search = "";
        redirect.searchParams.set("next", path);
        return NextResponse.redirect(redirect);
      }
    }
  }

  if (isAuthPage && user) {
    const next = request.nextUrl.searchParams.get("next");
    const redirect = request.nextUrl.clone();
    redirect.search = "";
    if (next?.startsWith("/") && next !== "/app") {
      redirect.pathname = next;
    } else {
      // Belirli hedef yoksa: EmlakSoft personeli → /admin, ofis kullanıcısı → /app
      const { data: staff } = await supabase
        .from("platform_staff")
        .select("id")
        .eq("id", user.id)
        .eq("is_active", true)
        .maybeSingle();
      redirect.pathname = staff ? "/admin" : "/app";
    }
    return NextResponse.redirect(redirect);
  }

  return supabaseResponse;
}
