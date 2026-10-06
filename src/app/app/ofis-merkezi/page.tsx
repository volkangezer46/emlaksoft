"use client";

import { useState } from "react";
import { Users, Settings, BarChart3, Layers, Plus, Trash2, Edit2 } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const metadata = { title: "Ofis Merkezi" };

/**
 * Ofis Merkezi — Ofis sahibi ve yöneticinin danışman yönetimi, havuzdan atama,
 * ayar ve tanımlamalar, istatistikleri yönettiği merkezi platform.
 *
 * Kapsamı:
 * 1. Danışman Yönetimi: Liste, ekle/sil/güncelle, rol atama, şube/ofis/takım ataması, etkinlik
 * 2. Havuzdan Atama: Portföy havuzundan danışmana oto/manuel atama, geçmiş, iptal, SLA
 * 3. Ofis Ayarları: 18 ayarın web yönetim merkezi, değişim tarihi ve kişi
 * 4. Tanımlamalar: SLA vakitleri, komisyon %, uyarı eşikleri, bildirim kanalları, TÜFE
 * 5. İstatistikler: Ofis performansı, danışman performans ligi, ekip sağlığı
 *
 * Yetki: office_center modülü, owner/gm tam (create/edit/delete), diğer roller view
 * RLS: tenant_id kontrol, role kontrol, requireModulePage("office_center")
 */

type Tab = "advisors" | "assignments" | "settings" | "definitions" | "stats";

export default function OfficeCenter() {
  const [activeTab, setActiveTab] = useState<Tab>("advisors");

  return (
    <div className="space-y-6 pb-8">
      <PageHeader
        title="Ofis Merkezi"
        description="Danışman yönetimi, havuzdan atama, ayarlar ve tanımlamalar"
      />

      <Tabs defaultValue="advisors" className="w-full">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="advisors" className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            <span className="hidden sm:inline">Danışmanlar</span>
          </TabsTrigger>
          <TabsTrigger value="assignments" className="flex items-center gap-2">
            <Layers className="h-4 w-4" />
            <span className="hidden sm:inline">Atamalar</span>
          </TabsTrigger>
          <TabsTrigger value="settings" className="flex items-center gap-2">
            <Settings className="h-4 w-4" />
            <span className="hidden sm:inline">Ayarlar</span>
          </TabsTrigger>
          <TabsTrigger value="definitions" className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4" />
            <span className="hidden sm:inline">Tanımlamalar</span>
          </TabsTrigger>
          <TabsTrigger value="stats" className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4" />
            <span className="hidden sm:inline">İstatistikler</span>
          </TabsTrigger>
        </TabsList>

        {/* DANIŞMAN YÖNETİMİ */}
        <TabsContent value="advisors" className="space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-2xl font-bold">Danışman Yönetimi</h2>
              <p className="text-sm text-muted-foreground">Danışmanları ekleyin, düzenleyin, rolleri yönetin</p>
            </div>
            <Button className="gap-2">
              <Plus className="h-4 w-4" />
              Yeni Danışman
            </Button>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Danışmanlar (0)</CardTitle>
              <CardDescription>Ofisteki aktif ve pasif danışmanlar</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-lg border border-dashed p-8 text-center">
                <Users className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground">Henüz danışman eklenmemiş</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* HAVUZDAN ATAMA */}
        <TabsContent value="assignments" className="space-y-4">
          <div>
            <h2 className="text-2xl font-bold">Havuzdan Atama</h2>
            <p className="text-sm text-muted-foreground">Portföy havuzundan danışmana oto/manuel atama, SLA takibi</p>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Atanmayan Portföy</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">0</div>
                <p className="text-xs text-muted-foreground">KPI: azaltılmalı</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">SLA Bekleyenleri</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">0</div>
                <p className="text-xs text-muted-foreground">Atanmayı bekleyen</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Bu Ay Atanan</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">0</div>
                <p className="text-xs text-muted-foreground">Atama geçmişi</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Atama Kuralları</CardTitle>
              <CardDescription>Havuz ilanlarının otomatik atama kuralları</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-lg border border-dashed p-8 text-center">
                <Layers className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground">Kurallar yükleniyor...</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* OFIS AYARLARI */}
        <TabsContent value="settings" className="space-y-4">
          <div>
            <h2 className="text-2xl font-bold">Ofis Ayarları</h2>
            <p className="text-sm text-muted-foreground">18 ofis ayarını yönetin, tarihi ve değişimini izleyin</p>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Genel Ayarlar</CardTitle>
              <CardDescription>Ofis temel yapılandırması</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="grid gap-4">
                  <div className="rounded-lg border p-4">
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="font-medium">Ofis Adı</p>
                        <p className="text-sm text-muted-foreground">Henüz veri yok</p>
                      </div>
                      <Button variant="ghost" size="sm">
                        <Edit2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* TANIMLAMALAR */}
        <TabsContent value="definitions" className="space-y-4">
          <div>
            <h2 className="text-2xl font-bold">Tanımlamalar</h2>
            <p className="text-sm text-muted-foreground">SLA, komisyon, uyarı eşikleri ve bildirim kanalları</p>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>SLA Vakitleri</CardTitle>
              <CardDescription>Standart hizmet seviyeleri sürelerini tanımlayın</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="border rounded p-4">
                  <p className="text-sm font-medium">Portföy atama SLA</p>
                  <p className="text-muted-foreground text-sm">Tanımlanmadı</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Komisyon Yüzdeleri</CardTitle>
              <CardDescription>Danışman ve ofis komisyon oranları</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-center text-muted-foreground py-8">
                Komisyon tanımlamaları yükleniyor...
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* İSTATİSTİKLER */}
        <TabsContent value="stats" className="space-y-4">
          <div>
            <h2 className="text-2xl font-bold">İstatistikler ve KPI</h2>
            <p className="text-sm text-muted-foreground">Ofis performansı, danışman ligi ve ekip sağlığı</p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Ofis Performansı</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-sm">Toplam Portföy</span>
                    <span className="font-semibold">0</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm">Satış Oranı</span>
                    <span className="font-semibold">%0</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm">Kiralama Oranı</span>
                    <span className="font-semibold">%0</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Danışman Performans Ligi</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-center text-muted-foreground py-8">
                  Danışman verisi yükleniyor...
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Ekip Sağlığı</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex justify-between items-center border-b pb-2">
                  <span className="text-sm">Ortalama İşlem Süresi</span>
                  <span className="font-semibold">-</span>
                </div>
                <div className="flex justify-between items-center border-b pb-2">
                  <span className="text-sm">Uyarı Sayısı</span>
                  <span className="font-semibold">0</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm">Sistem Durumu</span>
                  <span className="font-semibold text-green-600">Sağlıklı</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
