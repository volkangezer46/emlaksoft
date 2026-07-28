import { Skeleton, SkeletonList } from "@/components/app/skeleton";

export default function Loading() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-9 w-56" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[104px] rounded-[18px]" />
        ))}
      </div>
      <SkeletonList rows={6} />
    </div>
  );
}
