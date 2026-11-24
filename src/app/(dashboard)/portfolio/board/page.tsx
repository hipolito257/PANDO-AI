"use client";
import { DealBoard } from "@/components/deals/DealBoard";

// Portfolio Management › Board
export default function PortfolioBoardPage() {
  return <DealBoard phase="portfolio" title="Portfolio board" emptyTitle="No portfolio companies yet"
    emptyText="When a deal closes, drag it here from the pipeline (or use “Move to” on the deal) to follow the investment: 100-day plan, value creation and monitoring." />;
}
