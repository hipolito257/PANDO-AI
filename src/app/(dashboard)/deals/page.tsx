"use client";
import { DealBoard } from "@/components/deals/DealBoard";

// Deal Sourcing › Pipeline
export default function PipelinePage() {
  return <DealBoard phase="sourcing" title="Pipeline" emptyTitle="No deals in the pipeline yet"
    emptyText="Create one for a company you're working on to track its team, stage, tasks and milestones." />;
}
