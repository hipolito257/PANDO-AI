import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { irlQuestionnaireConfig } from "@/lib/schema";
import { IRL_QUESTIONNAIRE_ID, getIrlQuestions, IrlQuestion } from "@/lib/irlQuestionnaire";
import { dbErrorMessage } from "@/lib/utils";

// GET /api/admin/irl-questionnaire — any logged-in user can view the default questionnaire
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const questions = await getIrlQuestions();
  return NextResponse.json({ questions });
}

// PATCH /api/admin/irl-questionnaire — admin-only edit of the default questionnaire
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const questions = body?.questions;
  if (
    !Array.isArray(questions) || questions.length === 0 ||
    !questions.every((q): q is IrlQuestion =>
      q && typeof q.id === "string" && typeof q.category === "string" && q.category.trim() &&
      typeof q.question === "string" && q.question.trim())
  ) {
    return NextResponse.json({ error: "questions must be a non-empty array of { id, category, question }" }, { status: 400 });
  }

  try {
    await db
      .insert(irlQuestionnaireConfig)
      .values({ id: IRL_QUESTIONNAIRE_ID, questions: JSON.stringify(questions), updatedBy: session.user.id })
      .onConflictDoUpdate({
        target: irlQuestionnaireConfig.id,
        set: { questions: JSON.stringify(questions), updatedBy: session.user.id, updatedAt: new Date().toISOString() },
      });
  } catch (e) {
    console.error("[irl-questionnaire PATCH]", e);
    return NextResponse.json({ error: dbErrorMessage(e) }, { status: 500 });
  }

  return NextResponse.json({ questions });
}
