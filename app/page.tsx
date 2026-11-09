export default function Page() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-3 px-4">
      <span className="text-sm font-bold tracking-wide text-emerald-700">FarmTwin Live</span>
      <h1 className="text-3xl font-bold text-slate-900">뼈대 배포 확인</h1>
      <p className="text-slate-600">구현은 live 브랜치에 있습니다. /ship → /land-and-deploy 뒤에 이 화면이 세션 만들기로 바뀝니다.</p>
    </main>
  );
}
