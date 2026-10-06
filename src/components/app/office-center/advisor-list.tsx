"use client";

import { OfficeAdvisor } from "@/lib/office-center/types";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Edit2, Trash2, Phone, Mail } from "lucide-react";

interface AdvisorListProps {
  advisors: OfficeAdvisor[];
  onEdit?: (advisor: OfficeAdvisor) => void;
  onDelete?: (advisorId: string) => void;
  canEdit?: boolean;
}

export function AdvisorList({ advisors, onEdit, onDelete, canEdit = false }: AdvisorListProps) {
  if (advisors.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center">
        <p className="text-muted-foreground">Danışman bulunamadı</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {advisors.map((advisor) => (
        <Card key={advisor.id} className="p-4">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="font-medium">{advisor.fullName}</div>
              <div className="text-sm text-muted-foreground space-y-1 mt-2">
                {advisor.phone && (
                  <div className="flex items-center gap-2">
                    <Phone className="h-4 w-4" />
                    {advisor.phone}
                  </div>
                )}
                {advisor.email && (
                  <div className="flex items-center gap-2">
                    <Mail className="h-4 w-4" />
                    {advisor.email}
                  </div>
                )}
              </div>
              <div className="flex gap-2 mt-3">
                <Badge variant={advisor.isActive ? "default" : "outline"}>
                  {advisor.isActive ? "Aktif" : "Pasif"}
                </Badge>
                <Badge variant="outline" className="capitalize">
                  {advisor.role}
                </Badge>
              </div>
            </div>
            {canEdit && (
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onEdit?.(advisor)}
                >
                  <Edit2 className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onDelete?.(advisor.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        </Card>
      ))}
    </div>
  );
}
