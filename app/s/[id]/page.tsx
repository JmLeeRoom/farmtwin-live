import { Suspense } from "react";
import SessionView from "@/components/SessionView";

export default function Page() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-sm text-slate-500">Opening the session…</div>}>
      <SessionView />
    </Suspense>
  );
}
