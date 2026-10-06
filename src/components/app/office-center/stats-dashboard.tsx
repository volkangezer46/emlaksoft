"use client";

import { OfficeStatistics } from "@/lib/office-center/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart3, TrendingUp, Users, Building2 } from "lucide-react";

interface StatsDashboardProps {
  stats: OfficeStatistics;
}

export function StatsDashboard({ stats }: StatsDashboardProps) {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Toplam Portföy</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{stats.totalProperties}</div>
          <p className="text-xs text-muted-foreground mt-1">Ofisteki tüm ilanlar</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Satış Oranı</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{Math.round(stats.salesRatio * 100)}%</div>
          <p className="text-xs text-muted-foreground mt-1">
            {stats.totalDeals} / {stats.totalProperties}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Kiralama Oranı</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{Math.round(stats.rentalRatio * 100)}%</div>
          <p className="text-xs text-muted-foreground mt-1">
            {stats.totalRentals} / {stats.totalProperties}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Ortalama İşlem Süresi</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{Math.round(stats.averageProcessTime)}</div>
          <p className="text-xs text-muted-foreground mt-1">gün</p>
        </CardContent>
      </Card>
    </div>
  );
}
