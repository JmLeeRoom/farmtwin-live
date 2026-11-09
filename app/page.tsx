import { Suspense } from "react";
import HomeClient from "@/components/HomeClient";

export default function Page() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-slate-500">불러오는 중…</div>}>
      <HomeClient />
    </Suspense>
  );
}
