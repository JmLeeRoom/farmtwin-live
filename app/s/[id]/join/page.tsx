import { Suspense } from "react";
import JoinClient from "@/components/JoinClient";

export default function Page() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-sm text-slate-500">참가 화면을 여는 중…</div>}>
      <JoinClient />
    </Suspense>
  );
}
