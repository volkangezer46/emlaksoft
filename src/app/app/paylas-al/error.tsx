"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function PaylasAlError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Paylaşılan içerik" />;
}
