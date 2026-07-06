import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { buildTwoPagerDocx, TwoPagerSectionContent } from "@/lib/twoPagerBuilder";
import { stripEmDashes } from "@/lib/utils";

export const maxDuration = 60;

interface ApprovedPlan {
  title?: string;
  subtitle?: string;
  sections: TwoPagerSectionContent[];
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const body = await req.json().catch(() => null);
    const approvedPlan = body?.approvedPlan as ApprovedPlan | undefined;
    const companyName = (body?.companyName as string | undefined)?.trim() || "Company";

    if (!approvedPlan?.sections?.length) {
      return NextResponse.json({ error: "An approved draft with at least one section is required" }, { status: 400 });
    }

    const clean = stripEmDashes(approvedPlan) as ApprovedPlan;
    const title = clean.title || companyName;
    const subtitle = clean.subtitle || "Investment Overview";

    const buffer = await buildTwoPagerDocx(title, subtitle, clean.sections);
    const filename = `${companyName.replace(/[^a-zA-Z0-9_-]/g, "_")}_2Pager_${new Date().toISOString().slice(0, 10)}.docx`;

    return NextResponse.json({
      file: buffer.toString("base64"),
      filename,
      ext: "docx",
    });
  } catch (err) {
    console.error("[twopager/build]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unexpected error" }, { status: 500 });
  }
}
