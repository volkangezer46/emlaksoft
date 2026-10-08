/**
 * Ekip ligi, rozetler ve seriler — SAF hesap katmanı.
 *
 * NEDEN AYRI MODÜL: Lig tablosu üç ayrı yerden okunuyor — `/app/lig` sayfası,
 * ay sonu snapshot cron'u (`/api/cron/lig-snapshot`) ve ileride kişisel özet.
 * Puan tablosu ya da rozet eşiği bu üç yerde ayrı ayrı yazılsaydı, ilk
 * ayarlamada danışmana gösterilen skor ile arşivlenen skor sessizce
 * ayrışırdı. Tek kaynak burası; sayfa ve cron yalnızca satır toplayıp
 * buraya verir.
 *
 * SAFLIK SÖZÜ: Bu dosya Supabase, React ve `Date.now()` bilmez. Bugünün
 * tarihi bile parametre (`computeStreak(dates, todayIso)`) — böylece hem
 * test edilebilir hem de React Compiler saflık kuralına (bkz. `src/lib/clock.ts`)
 * takılmaz.
 */

// ============================================================
// 1) PUAN TABLOSU
// ============================================================

/**
 * Puan kazandıran aktivite türleri.
 *
 * Yeni tür eklerken: (a) buraya, (b) SCORE_RULES'a, (c) SCORE_RULE_LABELS'a
 * ve (d) lig sayfasının kırılım sütunlarına ekle. Dördü de eksiksiz olmalı,
 * yoksa satır puana sayılır ama tabloda görünmez.
 */
export type ScoreRuleKey =
  | "deal_won"
  | "property_new"
  | "appointment_done"
  | "task_done"
  | "nps_promoter"
  | "leak_sla_response"
  // Lig 2.0
  | "customer_new"
  | "showing_done"
  | "offer_made"
  | "listing_authorized"
  | "fast_response"
  | "listing_confirmed";

/**
 * PUAN TABLOSU — ofis motivasyonunun tek doğruluk kaynağı.
 *
 * Oranların gerekçesi (ofis sahibinin "neyi ödüllendiriyorum" sorusu):
 *  - Kazanılan anlaşma 100: ciroyu tek başına üreten olay. Diğer her şey
 *    buna giden yolun adımı; 100 puan o adımların hiçbiriyle kıyaslanamaz.
 *  - Yeni portföy 20: portföy stoku ofisin sermayesi. 5 portföy ≈ 1 anlaşma
 *    değerinde bilinçli bir denge — portföysüz danışman anlaşma da yapamaz.
 *  - Yapılan randevu 10: gerçekleşmiş (tamamlanmış) görüşme. Randevu AÇMAK
 *    değil, TAMAMLAMAK puan getirir — sahte takvim doldurmanın önü kapalı.
 *  - Tamamlanan görev 5: disiplin puanı. Bilinçli olarak düşük; görev
 *    açıp kapatmak istismara en açık kalem.
 *  - NPS 9-10 (destekleyen) 30: müşteri memnuniyeti gecikmeli gelir ama
 *    tavsiye üretir. Anlaşmanın üçte biri kadar değerli sayıldı.
 *  - Kayıp-kaçak SLA içinde yanıt 15: ilana zamanında müdahale kaçan
 *    komisyonu önler — "yapılmayan hata" da ödüllendirilir.
 */
export const SCORE_RULES: Readonly<Record<ScoreRuleKey, number>> = {
  /** Kazanılan (stage='won') anlaşma */
  deal_won: 100,
  /** Yeni eklenen portföy kaydı */
  property_new: 20,
  /** Tamamlanmış randevu (status='completed') */
  appointment_done: 10,
  /** Tamamlanmış görev (status='done') */
  task_done: 5,
  /** NPS 9-10 veren müşteri anketi (destekleyen) */
  nps_promoter: 30,
  /** Kayıp-kaçak kapanışına SLA penceresi içinde verilen yanıt */
  leak_sla_response: 15,
  /** Yeni müşteri kaydı (silinmemiş) */
  customer_new: 5,
  /** Tamamlanmış yer gösterme randevusu (appointment_type='showing'); `appointment_done` gösterimi SAYMAZ */
  showing_done: 15,
  /** Müşteriye iletilmiş teklif (taslak sayılmaz) */
  offer_made: 15,
  /** Tek yetkili (authorization_type='exclusive') portföy alma — `property_new` puanının ÜSTÜNE bonus */
  listing_authorized: 25,
  /** Yeni müşteriye çalışma saati SLA'sı içinde ilk dönüş (Aday Hızı ile aynı ölçüm) */
  fast_response: 8,
  /** Yayındaki ilanın bu dönemde teyit edilmesi (ilan başına dönemde en çok 1) */
  listing_confirmed: 3,
};

/** Kırılım sütunlarının Türkçe başlıkları (UI tek yerden okur). */
export const SCORE_RULE_LABELS: Readonly<Record<ScoreRuleKey, string>> = {
  deal_won: "Anlaşma",
  property_new: "Portföy",
  appointment_done: "Randevu",
  task_done: "Görev",
  nps_promoter: "NPS 9-10",
  leak_sla_response: "SLA yanıtı",
  customer_new: "Yeni müşteri",
  showing_done: "Gösterim",
  offer_made: "Teklif",
  listing_authorized: "Yetkili portföy",
  fast_response: "Hızlı dönüş",
  listing_confirmed: "İlan teyidi",
};

/** Kuralın ne zaman puan getirdiği — ayar ekranı ve kural kartı tek yerden okur. */
export const SCORE_RULE_HINTS: Readonly<Record<ScoreRuleKey, string>> = {
  deal_won: "Kazanılan anlaşma",
  property_new: "Yeni portföy kaydı",
  appointment_done: "Tamamlanan randevu (gösterim hariç)",
  task_done: "Tamamlanan görev",
  nps_promoter: "Müşteriden 9-10 anket puanı",
  leak_sla_response: "Kayıp-kaçak SLA içinde yanıt",
  customer_new: "Yeni müşteri kaydı",
  showing_done: "Tamamlanan yer gösterme",
  offer_made: "İletilen teklif",
  listing_authorized: "Tek yetkili portföy alma (bonus)",
  fast_response: "Yeni müşteriye SLA içinde ilk dönüş",
  listing_confirmed: "Yayındaki ilanı teyit etme",
};

/** Puan tablosu türü — cron/test farklı bir ruleset geçirebilsin diye ayrı. */
export type ScoreRuleset = Readonly<Record<ScoreRuleKey, number>>;

/** Tüm kural anahtarları, sabit sırayla (UI sütun sırası buradan gelir). */
export const SCORE_RULE_KEYS: readonly ScoreRuleKey[] = [
  "deal_won",
  "property_new",
  "appointment_done",
  "task_done",
  "nps_promoter",
  "leak_sla_response",
  "customer_new",
  "showing_done",
  "offer_made",
  "listing_authorized",
  "fast_response",
  "listing_confirmed",
];

// ============================================================
// 2) SKOR HESABI
// ============================================================

/**
 * Normalize edilmiş aktivite satırı. Çağıran taraf (sayfa/cron) her tablodan
 * kendi dar select'ini yapıp bu şekle çevirir — böylece bu modül hiçbir
 * tablo şemasına bağlı kalmaz.
 */
export type ActivityRow = {
  /** `profiles.id` — satırın sahibi danışman */
  staffId: string;
  kind: ScoreRuleKey;
  /** ISO zaman damgası veya YYYY-MM-DD — seri hesabında gün olarak kullanılır */
  at: string;
  /**
   * Kaynak kaydın kimliği. Verilirse AYNI (kind, ref) ikinci kez SAYILMAZ (tekrar eden satır/çift sorgu puan şişirmez).
   * Verilmezse tekilleştirme yapılmaz (eski çağıranlar).
   */
  ref?: string;
  /** Örnek (demo) kayıt: `includeSample` açık değilse puana ve seriye girmez. */
  isSample?: boolean;
};

export type ScoreBreakdown = Record<ScoreRuleKey, { count: number; points: number }>;

export type AgentScore = {
  staffId: string;
  /** Toplam puan */
  total: number;
  /** Kural bazlı adet + puan kırılımı (her anahtar HER ZAMAN dolu) */
  breakdown: ScoreBreakdown;
  /** Puan üreten toplam aktivite adedi */
  activityCount: number;
};

function emptyBreakdown(): ScoreBreakdown {
  const out = {} as ScoreBreakdown;
  for (const k of SCORE_RULE_KEYS) out[k] = { count: 0, points: 0 };
  return out;
}

/**
 * Sıfır puanlı satır — hiç aktivitesi olmayan danışman lig tablosunda
 * kaybolmasın diye çağıran taraf listeyi bununla tamamlar.
 */
export function emptyAgentScore(staffId: string): AgentScore {
  return { staffId, total: 0, breakdown: emptyBreakdown(), activityCount: 0 };
}

/**
 * Danışman bazlı toplam puan + kırılım.
 *
 * Sıralama: puan azalan. EŞİTLİKTE `staffId` artan — deterministik olması
 * şart, çünkü aynı veri hem ekranda hem snapshot'ta aynı sırayı üretmeli
 * (aksi halde "dün 2.'ydim bugün 3. oldum, veri değişmedi" şikâyeti gelir).
 *
 * Sıfır puanlı danışman da listede kalır (girdide satırı varsa) — "hiç
 * aktivitesi yok" bilgisi lig tablosunda anlamlıdır. Hiç satırı olmayan
 * danışmanı çağıran taraf kendi profil listesinden tamamlar.
 */
export function computeAgentScores(
  rows: readonly ActivityRow[],
  ruleset: ScoreRuleset = SCORE_RULES,
  opts: { includeSample?: boolean } = {},
): AgentScore[] {
  const byStaff = new Map<string, AgentScore>();
  const seenRefs = new Set<string>();

  for (const row of rows ?? []) {
    if (!row || !row.staffId) continue;
    // Hile koruması: örnek (demo) veri sayılmaz — yalnız ofis açıkça "örnek dahil" demişse.
    if (row.isSample && !opts.includeSample) continue;
    const points = ruleset[row.kind];
    // Bilinmeyen kural anahtarı sessizce atlanır: ruleset daraltılmış
    // olabilir (ör. bir kalem geçici kapatıldı) ve bu bir hata değil.
    // 0 puan = ofis kuralı kapattı: kayıt adet olarak da sayılmaz.
    if (typeof points !== "number" || points <= 0) continue;
    // Aynı kaydın tekrarı (aynı kind+kişi+ref) tek sayılır.
    if (row.ref) {
      const dedupeKey = `${row.kind}|${row.staffId}|${row.ref}`;
      if (seenRefs.has(dedupeKey)) continue;
      seenRefs.add(dedupeKey);
    }

    let agent = byStaff.get(row.staffId);
    if (!agent) {
      agent = { staffId: row.staffId, total: 0, breakdown: emptyBreakdown(), activityCount: 0 };
      byStaff.set(row.staffId, agent);
    }
    const cell = agent.breakdown[row.kind];
    cell.count += 1;
    cell.points += points;
    agent.total += points;
    agent.activityCount += 1;
  }

  return [...byStaff.values()].sort((a, b) =>
    b.total !== a.total ? b.total - a.total : a.staffId.localeCompare(b.staffId),
  );
}

/**
 * Sıra numarası ataması — EŞİT PUAN AYNI SIRAYI ALIR ("standart rekabet"
 * sıralaması: 1, 2, 2, 4). Podyumda iki kişi 900 puanla berabereyse ikisi de
 * 2. olur; 3. sıra boş kalır. Alternatif (sıralı 1,2,3) beraberliği gizler
 * ve haksız görünür.
 */
export function rankAgentScores(scores: readonly AgentScore[]): Array<AgentScore & { rank: number }> {
  const out: Array<AgentScore & { rank: number }> = [];
  let lastTotal: number | null = null;
  let lastRank = 0;
  scores.forEach((s, i) => {
    const rank = lastTotal !== null && s.total === lastTotal ? lastRank : i + 1;
    lastTotal = s.total;
    lastRank = rank;
    out.push({ ...s, rank });
  });
  return out;
}

// ============================================================
// 3) GÜN SERİSİ (STREAK)
// ============================================================

/** ISO zaman damgasını YYYY-MM-DD gününe indirger. */
function dayOf(value: string): string {
  return String(value ?? "").slice(0, 10);
}

/** YYYY-MM-DD → bir gün öncesi (UTC aritmetiği; gün etiketi ile çalışır). */
function prevDay(iso: string): string {
  const t = Date.parse(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(t)) return iso;
  return new Date(t - 86_400_000).toISOString().slice(0, 10);
}

/**
 * Kesintisiz aktivite serisi (gün).
 *
 * KURAL: Seri BUGÜN ya da DÜN aktivite varsa canlıdır. Dün de sayılır çünkü
 * danışman sabah 09:00'da paneli açtığında "serin koptu" demek haksız olur —
 * gün henüz bitmedi. İki gün önceki son aktivite ise seriyi 0'a düşürür.
 *
 * Aynı güne düşen birden çok aktivite tek gün sayılır (Set ile tekilleştirme).
 * Gelecek tarihli satırlar yok sayılır — sisteme ileri tarihli randevu
 * girilebiliyor, o henüz "yapılmış" bir aktivite değil.
 */
export function computeStreak(activityDates: readonly string[], todayIso: string): number {
  const today = dayOf(todayIso);
  if (!today) return 0;

  const days = new Set<string>();
  for (const d of activityDates ?? []) {
    const day = dayOf(d);
    if (!day || day > today) continue; // gelecek tarih sayılmaz
    days.add(day);
  }
  if (days.size === 0) return 0;

  const yesterday = prevDay(today);
  // Başlangıç noktası: bugün varsa bugünden, yoksa dünden. İkisi de yoksa seri kopmuş.
  let cursor = days.has(today) ? today : days.has(yesterday) ? yesterday : null;
  if (!cursor) return 0;

  let streak = 0;
  while (days.has(cursor)) {
    streak += 1;
    cursor = prevDay(cursor);
  }
  return streak;
}

// ============================================================
// 4) ROZETLER
// ============================================================

/**
 * Rozet değerlendirmesine giren istatistikler.
 *
 * DÖNEMSEL vs ÖMÜR BOYU ayrımı bilinçli: "Kapanış Makinesi" (ayda 5 anlaşma)
 * her ay yeniden kazanılabilir; "İlk Anlaşma" bir kez kazanılır ve kaybedilmez.
 * `agent_badges.period` kolonu bu ayrımı taşır (aylık rozette "2026-07",
 * ömür boyu rozette null).
 */
export type AgentStats = {
  /** Dönem içi (seçili ay) sayılar */
  dealCount: number;
  propertyCount: number;
  appointmentCount: number;
  taskCount: number;
  npsPromoterCount: number;
  /** Lig 2.0 dönem sayaçları */
  showingCount: number;
  authorizedCount: number;
  customerCount: number;
  offerCount: number;
  fastResponseCount: number;
  /** Ömür boyu (tüm zamanlar) sayılar */
  dealCountAllTime: number;
  propertyCountAllTime: number;
  /** Ağa paylaşılan portföy adedi (ömür boyu) */
  networkShareCount: number;
  /** Ortalama ilk yanıt süresi (dakika); veri yoksa null */
  avgFirstResponseMin: number | null;
  /** Kesintisiz aktivite serisi (gün) */
  streakDays: number;
  /** Dönem sıralaması (1 = lider); hesaplanamıyorsa null */
  rank: number | null;
  /** Dönem toplam puanı */
  score: number;
};

/** Eksik alanları 0/null ile dolduran kurucu — çağıran her alanı bilmek zorunda kalmasın. */
export function emptyAgentStats(over: Partial<AgentStats> = {}): AgentStats {
  return {
    dealCount: 0,
    propertyCount: 0,
    appointmentCount: 0,
    taskCount: 0,
    npsPromoterCount: 0,
    showingCount: 0,
    authorizedCount: 0,
    customerCount: 0,
    offerCount: 0,
    fastResponseCount: 0,
    dealCountAllTime: 0,
    propertyCountAllTime: 0,
    networkShareCount: 0,
    avgFirstResponseMin: null,
    streakDays: 0,
    rank: null,
    score: 0,
    ...over,
  };
}

export type BadgeDefinition = {
  /** DB'ye yazılan sabit kod — DEĞİŞTİRİLEMEZ (kazanılmış rozetler buna bağlı) */
  code: string;
  name: string;
  /** Kısa tanım — kazanılmış rozetin altında görünür */
  description: string;
  /** lucide-react ikon adı — UI kendi haritasından çözer (lib'e React sızmaz) */
  icon: string;
  /** Kazanılmamış rozet galerisinde gösterilen "nasıl kazanılır" metni */
  howTo: string;
  /**
   * "monthly": her dönem yeniden kazanılır, `period` = YYYY-MM.
   * "lifetime": bir kez kazanılır, `period` = null.
   */
  scope: "monthly" | "lifetime";
  /** Kazanma koşulu — saf fonksiyon */
  earned: (s: AgentStats) => boolean;
};

/**
 * ROZET KATALOĞU (15 rozet).
 *
 * Eşikler ofis ölçeğine göre seçildi: bir danışman ayda ~1-3 anlaşma, ~8-15
 * portföy, ~20-40 randevu üretir. Eşikler "çalışkanın ulaşabileceği ama
 * ortalamanın otomatik almayacağı" bantta tutuldu — herkesin aldığı rozet
 * motivasyon üretmez.
 *
 * `code` alanı DB'de saklanır; ad/açıklama değişebilir ama kod ASLA.
 */
export const BADGES: readonly BadgeDefinition[] = [
  {
    code: "ilk_anlasma",
    name: "İlk Anlaşma",
    description: "İlk anlaşmanı kazandın — en zor olan ilkidir.",
    icon: "Handshake",
    howTo: "İlk anlaşmanı kazandığında otomatik açılır.",
    scope: "lifetime",
    earned: (s) => s.dealCountAllTime >= 1,
  },
  {
    code: "portfoy_10",
    name: "10 Portföy",
    description: "Toplam 10 portföy kaydettin.",
    icon: "Building2",
    howTo: "Toplam 10 portföy kaydet (tüm zamanlar).",
    scope: "lifetime",
    earned: (s) => s.propertyCountAllTime >= 10,
  },
  {
    code: "portfoy_50",
    name: "Portföy Avcısı",
    description: "Toplam 50 portföyle stoğun bel kemiğisin.",
    icon: "Target",
    howTo: "Toplam 50 portföy kaydet (tüm zamanlar).",
    scope: "lifetime",
    earned: (s) => s.propertyCountAllTime >= 50,
  },
  {
    code: "ayin_sampiyonu",
    name: "Ayın Şampiyonu",
    description: "Bu dönemin lig birincisisin.",
    icon: "Crown",
    howTo: "Dönemi puan sıralamasında 1. bitir (puanın 0'dan büyük olmalı).",
    scope: "monthly",
    earned: (s) => s.rank === 1 && s.score > 0,
  },
  {
    code: "podyum",
    name: "Podyumda",
    description: "Bu dönem ilk üçe girdin.",
    icon: "Medal",
    howTo: "Dönemi ilk üçte bitir.",
    scope: "monthly",
    earned: (s) => s.rank !== null && s.rank <= 3 && s.score > 0,
  },
  {
    code: "bes_yildiz",
    name: "5 Yıldız Hizmet",
    description: "Bu dönem 3+ müşteri sana 9-10 puan verdi.",
    icon: "Star",
    howTo: "Dönem içinde en az 3 müşteriden NPS 9-10 al.",
    scope: "monthly",
    earned: (s) => s.npsPromoterCount >= 3,
  },
  {
    code: "hiz_ustasi",
    name: "Hız Ustası",
    description: "Ortalama ilk yanıt süren 15 dakikanın altında.",
    icon: "Zap",
    howTo: "Dönem ortalama ilk yanıt süreni 15 dakikanın altına indir.",
    scope: "monthly",
    earned: (s) => s.avgFirstResponseMin !== null && s.avgFirstResponseMin < 15,
  },
  {
    code: "maratoncu",
    name: "Maratoncu",
    description: "30 gün kesintisiz aktivite.",
    icon: "Flame",
    howTo: "30 gün üst üste en az bir puanlı aktivite yap.",
    scope: "lifetime",
    earned: (s) => s.streakDays >= 30,
  },
  {
    code: "haftalik_seri",
    name: "İstikrar",
    description: "7 gün kesintisiz aktivite.",
    icon: "CalendarClock",
    howTo: "7 gün üst üste en az bir puanlı aktivite yap.",
    scope: "lifetime",
    earned: (s) => s.streakDays >= 7,
  },
  {
    code: "kapanis_makinesi",
    name: "Kapanış Makinesi",
    description: "Bu dönem 5 anlaşma kazandın.",
    icon: "Rocket",
    howTo: "Bir dönemde 5 anlaşma kazan.",
    scope: "monthly",
    earned: (s) => s.dealCount >= 5,
  },
  {
    code: "randevu_krali",
    name: "Randevu Kralı",
    description: "Bu dönem 20 randevu tamamladın.",
    icon: "CalendarCheck2",
    howTo: "Bir dönemde 20 randevu tamamla.",
    scope: "monthly",
    earned: (s) => s.appointmentCount >= 20,
  },
  {
    code: "gosterim_10",
    name: "Gösterim Ustası",
    description: "Bu dönem 10 yer gösterme tamamladın.",
    icon: "CalendarCheck2",
    howTo: "Bir dönemde 10 yer gösterme randevusunu tamamla.",
    scope: "monthly",
    earned: (s) => s.showingCount >= 10,
  },
  {
    code: "yetki_avcisi",
    name: "Yetki Avcısı",
    description: "Bu dönem 3 tek yetkili portföy aldın.",
    icon: "Target",
    howTo: "Bir dönemde 3 tek yetkili portföy al.",
    scope: "monthly",
    earned: (s) => s.authorizedCount >= 3,
  },
  {
    code: "seri_5",
    name: "Beş Gün Seri",
    description: "5 gün üst üste aktivite.",
    icon: "Flame",
    howTo: "5 gün üst üste en az bir puanlı aktivite yap.",
    scope: "lifetime",
    earned: (s) => s.streakDays >= 5,
  },
  {
    code: "takim_oyuncusu",
    name: "Takım Oyuncusu",
    description: "Ağa 3 portföy açtın — iş birliği kazandırır.",
    icon: "Users",
    howTo: "Ofisler arası ağa en az 3 portföy aç.",
    scope: "lifetime",
    earned: (s) => s.networkShareCount >= 3,
  },
];

/** Koda göre hızlı erişim — UI ve cron kazanılmış kodu tanıma çevirir. */
export const BADGE_BY_CODE: ReadonlyMap<string, BadgeDefinition> = new Map(
  BADGES.map((b) => [b.code, b]),
);

/**
 * İstatistiklere göre kazanılan rozet kodları.
 *
 * `scope` filtresi opsiyonel: cron ay sonunda yalnız "monthly" rozetleri
 * `period` ile yazar; ömür boyu rozetler sayfada anlık değerlendirilir.
 * Dönüş sırası BADGES katalog sırası — galeri her yerde aynı sırada dizilsin.
 */
export function evaluateBadges(
  stats: AgentStats,
  opts: { scope?: "monthly" | "lifetime" } = {},
): string[] {
  return BADGES.filter((b) => (opts.scope ? b.scope === opts.scope : true))
    .filter((b) => {
      try {
        return b.earned(stats);
      } catch {
        // Tek bir rozet koşulu patlarsa tüm lig tablosu çökmesin.
        return false;
      }
    })
    .map((b) => b.code);
}
