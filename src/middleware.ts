import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth-config";

// Use Edge-safe auth config (no DB imports, pure JWT check)
export default NextAuth(authConfig).auth;

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.png$|api/seed|api/cron|api/pptx_build).*)"],
};
