"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function YabanciSatisError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Yabancıya satış" />;
}
