// GEÇİCİ doğrulama düzeneği (commit EDİLMEZ): Kapanış sihirbazının `sonuc` ön seçimi.
import { KapanisSihirbazi } from "../../app/anlasmalar/[id]/kapanis-sihirbazi";
import { parseOutcomeParam } from "../../app/anlasmalar/[id]/kapanis-model";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ sonuc?: string; stage?: string; tur?: string }>;
}) {
  const sp = await searchParams;
  const requested = parseOutcomeParam(sp.sonuc);
  return (
    <div className="mx-auto max-w-3xl p-4">
      <KapanisSihirbazi
        key={requested ?? "secim"}
        dealId="deal-n-1"
        stage={sp.stage ?? "negotiation"}
        dealType={sp.tur === "kira" ? "rent" : "sale"}
        dealValue={12_000_000}
        propertyId="p1"
        propertyTitle="Çengelköy Villa"
        customerId="c1"
        customerName="Ali Vural"
        lossOptions={[
          { value: "fiyat", label: "Fiyat" },
          { value: "diger", label: "Diğer" },
        ]}
        lossReasonText={null}
        canEdit
        canCreate
        canCreateTask
        canSurvey={false}
        showMoney
        survey={null}
        requestedOutcome={requested}
        commissionRate={2}
        commission={null}
        checklist={{ done: 0, total: 0 }}
        hasCollectionTask={false}
        defaultDue="2026-10-11T10:00"
      />
    </div>
  );
}
