import {
  Building2,
  CalendarDays,
  CheckCircle2,
  MapPin,
  Search,
  Star,
  UserRound,
} from "lucide-react";
import { getCustomerPortalData } from "@/app/actions/customer-portal";

const DEMAND_TYPE_LABELS: Record<string, string> = {
  buy:    "Satın alma",
  rent:   "Kiralama",
  sell:   "Satış",
  invest: "Yatırım",
};

const APPT_TYPE_LABELS: Record<string, string> = {
  showing:   "Yer gösterme",
  office:    "Ofis görüşmesi",
  valuation: "Değerleme",
  contract:  "Sözleşme",
};

function money(n: number | null) {
  if (!n) return "—";
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(n);
}

function formatDate(iso: string) {
  return new Intl.DateTimeFormat("tr-TR", {
    day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(new Date(iso));
}

export default async function CustomerPortalPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const data = await getCustomerPortalData(token);

  if (!data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 p-4">
        <div className="max-w-sm text-center">
          <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-full bg-red-50">
            <UserRound className="h-8 w-8 text-red-400" />
          </div>
          <h1 className="font-bold text-lg text-zinc-900">Bağlantı geçersiz veya süresi dolmuş</h1>
          <p className="mt-2 text-sm text-zinc-500">
            Bu portal linki artık geçerli değil. Danışmanınızla iletişime geçin.
          </p>
        </div>
      </div>
    );
  }

  const { customer, tenant, demands, appointments, matches } = data;

  return (
    <div className="min-h-screen bg-zinc-50">
      {/* Header */}
      <header className="border-b border-zinc-200 bg-white px-4 py-4">
        <div className="mx-auto max-w-3xl flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">{tenant.name}</p>
            <h1 className="mt-0.5 font-bold text-zinc-900">Müşteri Paneli</h1>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-900 text-sm font-bold text-white">
            {customer.fullName.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase()}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-6 p-4 py-6">
        {/* Karşılama */}
        <section className="rounded-2xl bg-zinc-900 p-5 text-white">
          <p className="text-sm text-zinc-400">Hoş geldiniz,</p>
          <h2 className="mt-1 text-xl font-bold">{customer.fullName}</h2>
          <p className="mt-1 text-sm text-zinc-400">
            {tenant.name} danışmanınız arayışınızı sizin için takip ediyor.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            {customer.phone && (
              <a href={`tel:${customer.phone}`} className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-white/20">
                📞 {customer.phone}
              </a>
            )}
            {customer.email && (
              <a href={`mailto:${customer.email}`} className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-white/20">
                ✉️ {customer.email}
              </a>
            )}
          </div>
        </section>

        {/* Eşleşen portföyler */}
        {matches.length > 0 && (
          <section>
            <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-zinc-900">
              <Star className="h-4 w-4 text-amber-500" /> Size Özel Portföyler
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {matches.map((m) => (
                <div key={m.id} className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-blue-50 text-blue-600">
                        <Building2 className="h-4 w-4" />
                      </span>
                      <div>
                        <p className="text-sm font-semibold text-zinc-900">{m.property.title ?? m.property.code}</p>
                        {m.property.province && (
                          <p className="flex items-center gap-1 text-xs text-zinc-500">
                            <MapPin className="h-3 w-3" /> {m.property.province}
                          </p>
                        )}
                      </div>
                    </div>
                    {m.score && (
                      <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
                        %{m.score} eşleşme
                      </span>
                    )}
                  </div>
                  {m.property.price && (
                    <p className="mt-2 text-sm font-bold text-zinc-900">{money(m.property.price)}</p>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Aktif talepler */}
        {demands.length > 0 && (
          <section>
            <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-zinc-900">
              <Search className="h-4 w-4 text-blue-600" /> Arayışlarım
            </h3>
            <div className="space-y-2">
              {demands.map((d) => (
                <div key={d.id} className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm">
                  <div>
                    <p className="text-sm font-semibold text-zinc-900">
                      {DEMAND_TYPE_LABELS[d.type] ?? d.type}
                      {d.province ? ` — ${d.province}` : ""}
                    </p>
                    {(d.minPrice || d.maxPrice) && (
                      <p className="mt-0.5 text-xs text-zinc-500">
                        {d.minPrice ? money(d.minPrice) : "—"} – {d.maxPrice ? money(d.maxPrice) : "—"}
                      </p>
                    )}
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${
                    d.status === "active"
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-zinc-100 text-zinc-500"
                  }`}>
                    {d.status === "active" ? "Aktif" : d.status}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Yaklaşan randevular */}
        {appointments.length > 0 && (
          <section>
            <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-zinc-900">
              <CalendarDays className="h-4 w-4 text-purple-600" /> Yaklaşan Randevularım
            </h3>
            <div className="space-y-2">
              {appointments.map((a) => (
                <div key={a.id} className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-purple-50 text-purple-600">
                    <CalendarDays className="h-4 w-4" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-zinc-900">{APPT_TYPE_LABELS[a.type] ?? a.type}</p>
                    <p className="text-xs text-zinc-500">{formatDate(a.scheduledAt)}</p>
                    {a.location && (
                      <p className="flex items-center gap-1 text-xs text-zinc-400">
                        <MapPin className="h-3 w-3" /> {a.location}
                      </p>
                    )}
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold ${
                    a.status === "confirmed" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
                  }`}>
                    {a.status === "confirmed" ? "Onaylandı" : "Teyit Bekliyor"}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Boş durum */}
        {matches.length === 0 && demands.length === 0 && appointments.length === 0 && (
          <div className="rounded-2xl border border-dashed border-zinc-300 bg-white py-12 text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-zinc-300" />
            <p className="mt-3 font-semibold text-zinc-600">Henüz kayıt yok</p>
            <p className="mt-1 text-sm text-zinc-400">Danışmanınız bilgileri güncellediğinde burada görünecek.</p>
          </div>
        )}

        {/* Footer */}
        <p className="text-center text-xs text-zinc-400 pb-4">
          Bu sayfa {tenant.name} tarafından sizin için oluşturulmuştur.
          <br />EmlakSoft ile güçlendirilmiştir.
        </p>
      </main>
    </div>
  );
}
