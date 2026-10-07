"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function UyumError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Uyum (KVKK ve İYS)" />;
}
