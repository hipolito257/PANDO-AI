import { db } from "@/lib/db";
import { irlQuestionnaireConfig } from "@/lib/schema";
import { eq } from "drizzle-orm";

export const IRL_QUESTIONNAIRE_ID = "default";

export interface IrlQuestion {
  id: string;
  category: string;
  question: string;
}

export const DEFAULT_IRL_QUESTIONS: IrlQuestion[] = [
  { id: "q_market_1",   category: "Market",     question: "What is the total addressable market and its growth rate?" },
  { id: "q_market_2",   category: "Market",     question: "Who are the main competitors and how does the company differentiate?" },
  { id: "q_financial_1", category: "Financial", question: "Are revenue and margin trends supported by underlying documentation (not just management claims)?" },
  { id: "q_financial_2", category: "Financial", question: "Is there any customer, supplier, or channel concentration risk?" },
  { id: "q_management_1", category: "Management", question: "How strong and stable is the management team? Any key-person risk?" },
  { id: "q_management_2", category: "Management", question: "Does management have a track record of disciplined capital allocation?" },
  { id: "q_legal_1",    category: "Legal",      question: "Are there any pending or threatened legal, tax, labor, or regulatory issues?" },
  { id: "q_esg_1",      category: "ESG",        question: "Are there any material ESG concerns identified in diligence?" },
];

export async function getIrlQuestions(): Promise<IrlQuestion[]> {
  const row = await db.query.irlQuestionnaireConfig.findFirst({ where: eq(irlQuestionnaireConfig.id, IRL_QUESTIONNAIRE_ID) }).catch(() => null);
  if (!row?.questions) return DEFAULT_IRL_QUESTIONS;
  try {
    const parsed = JSON.parse(row.questions);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch { /* fall through to default */ }
  return DEFAULT_IRL_QUESTIONS;
}
