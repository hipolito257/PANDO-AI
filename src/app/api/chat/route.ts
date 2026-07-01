import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { userSettings, companies, compSets, publicComps, signals, notes } from "@/lib/schema";
import { eq, desc } from "drizzle-orm";

function fmtB(n: unknown): string {
  if (n == null) return "N/D";
  const v = Number(n);
  if (isNaN(v)) return "N/D";
  if (Math.abs(v) >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
  if (Math.abs(v) >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}
function fmtPct(n: unknown): string {
  if (n == null) return "N/D";
  const v = Number(n);
  return isNaN(v) ? "N/D" : `${(v * 100).toFixed(1)}%`;
}

// Build rich system context from DB
async function buildContext(): Promise<string> {
  const allCompanies = await db.query.companies.findMany({
    with: { signals: { limit: 3, orderBy: (s, { desc }) => [desc(s.date)] }, notes: { limit: 2 } },
    orderBy: [desc(companies.score)],
    limit: 50,
  });

  const companySummaries = allCompanies.map(c => {
    const lines = [
      `• ${c.name} (${c.sector ?? "N/A"} | ${c.country} | ${c.stage ?? "N/A"} | Score: ${c.score?.toFixed(1) ?? "N/A"})`,
      `  Revenue: ${fmtB(c.revenueUsd)} | Growth: ${fmtPct(c.revenueGrowth)} | EBITDA: ${fmtB(c.ebitdaUsd)} | Margin: ${fmtPct(c.ebitdaMargin)}`,
      `  Employees: ${c.employees ?? "N/A"} | Total funding: ${fmtB(c.totalFunding)} | Last round: ${fmtB(c.lastFundingAmt)} | Funding stage: ${c.fundingStage ?? "N/A"}`,
      c.description ? `  Description: ${c.description.slice(0, 150)}` : "",
      c.signals?.length ? `  Recent signals: ${c.signals.map((s: any) => s.title).join("; ")}` : "",
    ].filter(Boolean);
    return lines.join("\n");
  }).join("\n\n");

  const sectorCounts = allCompanies.reduce((acc, c) => {
    acc[c.sector ?? "No sector"] = (acc[c.sector ?? "No sector"] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const stageCounts = allCompanies.reduce((acc, c) => {
    acc[c.stage ?? "No stage"] = (acc[c.stage ?? "No stage"] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return `You are PANDO AI, the intelligent assistant of a Private Equity platform.
You have full access to the fund's company radar and its metrics.

CURRENT DATE: ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}

RADAR SUMMARY:
- Total companies monitored: ${allCompanies.length}
- By sector: ${Object.entries(sectorCounts).map(([k, v]) => `${k}(${v})`).join(", ")}
- By stage: ${Object.entries(stageCounts).map(([k, v]) => `${k}(${v})`).join(", ")}

COMPANIES IN THE RADAR:
${companySummaries}

INSTRUCTIONS:
- Respond in English, concisely and directly like a senior PE analyst would
- You can compare companies, calculate metrics, identify opportunities, analyze trends
- If asked about a specific company, use all available data
- If you lack data on something, say so clearly
- Use bullet points and clean formatting when useful
- Keep responses focused — no more than 300 words unless more detail is requested`;
}

// POST /api/chat
// Body: { message: string, history: { role: "user"|"assistant", content: string }[] }
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { message, history = [] } = await req.json() as {
    message: string;
    history: { role: "user" | "assistant"; content: string }[];
  };

  if (!message?.trim()) return NextResponse.json({ error: "message required" }, { status: 400 });

  // Get user's API key
  const userId = session.user.id;
  const userSetting = await db.query.userSettings.findFirst({
    where: eq(userSettings.userId, userId),
  });
  const apiKey = userSetting?.anthropicApiKey ?? null;

  if (!apiKey) {
    return NextResponse.json({
      error: "no_key",
      message: "Configure your Anthropic API key in Settings to use the chat.",
    }, { status: 400 });
  }

  // Build context
  const systemPrompt = await buildContext();

  // Build message history
  const messages = [
    ...history.slice(-10), // Keep last 10 turns for context
    { role: "user" as const, content: message },
  ];

  // Stream response from Claude Haiku
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5",
      max_tokens: 1024,
      system: systemPrompt,
      messages,
      stream: true,
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    const err = await response.text();
    return NextResponse.json({ error: "Anthropic API error", detail: err }, { status: 500 });
  }

  // Stream back to client
  const stream = new ReadableStream({
    async start(controller) {
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n").filter(l => l.startsWith("data: "));

          for (const line of lines) {
            const data = line.slice(6);
            if (data === "[DONE]") continue;
            try {
              const parsed = JSON.parse(data);
              if (parsed.type === "content_block_delta" && parsed.delta?.type === "text_delta") {
                controller.enqueue(new TextEncoder().encode(parsed.delta.text));
              }
            } catch { /* skip malformed */ }
          }
        }
      } finally {
        controller.close();
        reader.releaseLock();
      }
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Transfer-Encoding": "chunked",
      "Cache-Control": "no-cache",
    },
  });
}
