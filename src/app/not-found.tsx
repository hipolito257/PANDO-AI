import Link from "next/link";
import { Logo } from "@/components/layout/Logo";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-mist flex flex-col items-center justify-center">
      <Logo size="md" className="mb-8" />
      <h1 className="text-[48px] font-semibold text-carbon font-poly tracking-tight">404</h1>
      <p className="text-[16px] text-graphite mb-8">Página no encontrada</p>
      <Link href="/" className="px-4 py-2 bg-carbon text-white rounded-btn text-[13px] font-medium hover:opacity-85 transition-opacity">
        Volver al dashboard
      </Link>
    </div>
  );
}
