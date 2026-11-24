"use client";
import { DealBoard } from "@/components/deals/DealBoard";

// Exit › Exit pipeline
export default function ExitPipelinePage() {
  return <DealBoard phase="exit" title="Exit pipeline" emptyTitle="No exits in progress"
    emptyText="Move a portfolio company here when Pando starts preparing its exit, to follow the process from preparation to realized." />;
}
