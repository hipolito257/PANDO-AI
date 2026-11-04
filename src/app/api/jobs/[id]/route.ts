import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, jobs } from "@/lib/db";
import { markStaleJobs, publicJob } from "@/lib/jobs";

// GET — one of the current user's jobs (polled while it runs)
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  await markStaleJobs(session.user.id).catch(() => {});
  const job = await db.query.jobs.findFirst({ where: and(eq(jobs.id, id), eq(jobs.userId, session.user.id)) });
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(publicJob(job));
}
