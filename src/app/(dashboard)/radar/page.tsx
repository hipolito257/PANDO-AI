import { redirect } from "next/navigation";

// Radar was retired: companies are now added from "New deal" and followed in the pipeline.
export default function RadarPage() {
  redirect("/deals");
}
