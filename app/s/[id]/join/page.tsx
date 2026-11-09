import { Suspense } from "react";
import JoinClient from "@/components/JoinClient";

export default function Page() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-sm text-slate-500">Opening the join screen…</div>}>
      <JoinClient />
    </Suspense>
  );
}
