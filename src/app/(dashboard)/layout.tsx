import { Sidebar } from "@/components/layout/Sidebar";
import { SessionProvider } from "next-auth/react";
import { db } from "@/lib/db";

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
      <div className="flex h-screen overflow-hidden bg-mist">
        <Sidebar badges={badges} />
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </SessionProvider>
  );
}
