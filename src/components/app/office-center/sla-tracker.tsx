"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, CheckCircle2, Clock } from "lucide-react";

interface SLAItem {
  id: string;
  propertyAddress: string;
  assignedTo: string;
  assignedAt: string;
  slaDeadline: string;
  status: "ok" | "warning" | "breached";
  hoursElapsed: number;
  percentageUsed: number;
}

interface SLATrackerProps {
  items: SLAItem[];
}

export function SLATracker({ items }: SLATrackerProps) {
  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center">
        <CheckCircle2 className="h-12 w-12 mx-auto text-green-600 mb-4" />
        <p className="text-muted-foreground">SLA ihlali yok</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <Card
          key={item.id}
          className={`p-4 ${
            item.status === "breached"
              ? "border-red-500 bg-red-50 dark:bg-red-950"
              : item.status === "warning"
                ? "border-yellow-500 bg-yellow-50 dark:bg-yellow-950"
                : ""
          }`}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="font-medium">{item.propertyAddress}</div>
              <div className="text-sm text-muted-foreground mt-1">
                {item.assignedTo} tarafından atandı
              </div>
              <div className="flex gap-2 mt-2">
                <Badge
                  variant={
                    item.status === "breached"
                      ? "danger"
                      : item.status === "warning"
                        ? "warning"
                        : "success"
                  }
                >
                  {item.status === "breached"
                    ? "İHLAL"
                    : item.status === "warning"
                      ? "UYARI"
                      : "OK"}
                </Badge>
                <Badge variant="outline" className="font-mono">
                  {item.hoursElapsed}s / {item.percentageUsed}%
                </Badge>
              </div>
            </div>
            <div className="text-right">
              {item.status === "breached" ? (
                <AlertCircle className="h-6 w-6 text-red-600" />
              ) : item.status === "warning" ? (
                <Clock className="h-6 w-6 text-yellow-600" />
              ) : (
                <CheckCircle2 className="h-6 w-6 text-green-600" />
              )}
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
