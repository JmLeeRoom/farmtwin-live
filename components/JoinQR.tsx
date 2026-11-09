"use client";

import { QRCodeSVG } from "qrcode.react";
import { useSyncExternalStore } from "react";
import { ROLE_LABEL } from "@/lib/constants";
import type { Role } from "@/lib/types";

const subscribe = () => () => {};
const getOrigin = () => window.location.origin;
const getServerOrigin = () => "";

export default function JoinQR({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const origin = useSyncExternalStore(subscribe, getOrigin, getServerOrigin);
  const local = /\/\/(localhost|127\.0\.0\.1)(:|$)/.test(origin);
  const roles: Role[] = ["safety", "reviewer", "developer"];
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/60 p-4" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="w-full max-w-3xl rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900">폰으로 세션에 들어오기</h2>
          <button type="button" onClick={onClose} className="rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100">
            닫기
          </button>
        </div>
        {local ? (
          <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
            지금 주소가 localhost라 폰에서 열리지 않습니다. 노트북도 IP 주소(예: http://192.168.0.23:3000) 또는 배포 URL로 열어 주세요.
          </p>
        ) : null}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {roles.map((role) => {
            const url = `${origin}/s/${sessionId}/join?role=${role}`;
            return (
              <div key={role} className="flex flex-col items-center gap-2 rounded-xl border border-slate-200 p-3">
                <span className="text-sm font-semibold text-slate-800">{ROLE_LABEL[role]}으로 입장</span>
                {origin ? <QRCodeSVG value={url} size={176} marginSize={2} /> : null}
                <code className="w-full break-all rounded bg-slate-50 px-2 py-1 text-[11px] text-slate-600">{url}</code>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
