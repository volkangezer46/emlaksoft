"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

/** Ticket ayrıntısı: konuşma/SLA/işlem geçmişini eksik göstermemek için ekran durur. */
export default function AdminTicketDetailError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Destek talebi ayrıntıları" homeHref="/admin/tickets" homeLabel="Kuyruğa dön" />;
}
