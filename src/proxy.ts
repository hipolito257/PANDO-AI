import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth-config";

// Use Edge-safe auth config (no DB imports, pure JWT check)
export default NextAuth(authConfig).auth;

// Only /api/cron stays exempt: Vercel's scheduler cannot carry a session, so
// that route authenticates itself with CRON_SECRET instead. api/seed was
// exempted too and had no check of its own, leaving it open to the internet;
// api/pptx_build no longer exists.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.png$|api/cron).*)"],
};
