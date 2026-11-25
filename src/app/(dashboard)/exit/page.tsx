import { redirect } from "next/navigation";

// "Market exits" was retired: the Exit section is the exit pipeline of our own deals.
export default function MarketExitsPage() {
  redirect("/exits");
}
