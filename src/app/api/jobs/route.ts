import { NextRequest, NextResponse, after } from "next/server";
import { auth } from "@/lib/auth";
import { createJob, executeJob, listJobs, publicJob } from "@/lib/jobs";
import { JOB_HANDLERS } from "@/lib/jobHandlers";

// The job runs after the response is sent, within this route's time limit.
export const maxDuration = 300;

// GET — the current user's recent jobs (for the jobs tray)
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json((await listJobs(session.user.id)).map(publicJob));
  } catch (err) {
    console.error("[jobs GET]", err);
    return NextResponse.json({ error: "Failed to load jobs" }, { status: 500 });
  }
}

// POST { type, input } — start a background job; returns it immediately
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { type, input } = await req.json().catch(() => ({}));
  const handler = JOB_HANDLERS[type as string];
  if (!handler) return NextResponse.json({ error: `Unknown job type: ${type}` }, { status: 400 });

  try {
    const job = await createJob({
      type,
      userId: session.user.id,
      input,
      title: await handler.title(input as never),
      companyId: handler.companyId(input as never),
    });
    after(() => executeJob(job.id, handler.run as (i: unknown, c: Parameters<typeof handler.run>[1]) => Promise<unknown>));
    return NextResponse.json(publicJob(job), { status: 202 });
  } catch (err) {
    console.error("[jobs POST]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not start the job" }, { status: 500 });
  }
}
