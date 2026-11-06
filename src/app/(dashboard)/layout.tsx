import { Sidebar } from "@/components/layout/Sidebar";
import { SessionProvider } from "next-auth/react";
import { db } from "@/lib/db";
import { DocJobsProvider } from "./DocJobsContext";

const SPLASH_GATE = `try{if(!sessionStorage.getItem("pando:splash")){location.replace("/inicio?next="+encodeURIComponent(location.pathname+location.search))}}catch(e){}`;

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  let badges = { radar: 0, exit: 0 };
  try {
    const [radarSignals, exitSignals] = await Promise.all([
      db.query.signals.findMany({
        where: (s, { and, eq, ne }) => and(eq(s.isRead, false), ne(s.type, "exit_signal")),
      }),
      db.query.signals.findMany({
        where: (s, { and, eq }) => and(eq(s.isRead, false), eq(s.type, "exit_signal")),
      }),
    ]);
    badges = { radar: radarSignals.length, exit: exitSignals.length };
  } catch {}

  return (
    <SessionProvider>
      {/* Opening the app (first page of a browser session) shows the welcome
          screen at /inicio first; it runs before the page paints. */}
      <script dangerouslySetInnerHTML={{ __html: SPLASH_GATE }} />
      <DocJobsProvider>
        <div className="flex h-[100dvh] overflow-hidden bg-mist">
          <Sidebar badges={badges} />
          <main className="flex-1 min-w-0 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
            {children}
          </main>
        </div>
      </DocJobsProvider>
    </SessionProvider>
  );
}
