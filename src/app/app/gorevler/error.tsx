"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function GorevlerError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Görevler" />;
}
