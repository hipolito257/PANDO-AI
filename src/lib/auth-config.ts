// Edge Runtime-safe auth config (no DB imports)
import type { NextAuthConfig } from "next-auth";

export const authConfig: NextAuthConfig = {
  pages: { signIn: "/login" },
  session: { strategy: "jwt" },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const isAuthPage =
        nextUrl.pathname.startsWith("/login") ||
        nextUrl.pathname.startsWith("/signup") ||
        nextUrl.pathname.startsWith("/forgot-password") ||
        nextUrl.pathname.startsWith("/reset-password");
      const isApiAuth = nextUrl.pathname.startsWith("/api/auth");

      if (isApiAuth) return true;
      if (isAuthPage) {
        if (isLoggedIn) return Response.redirect(new URL("/", nextUrl));
        return true;
      }
      return isLoggedIn;
    },
    async jwt({ token, user, trigger, session }) {
      if (user) { token.id = user.id; token.role = user.role; }
      if (trigger === "update" && session?.email) { token.email = session.email; }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id   = token.id ?? "";
        session.user.role = token.role as string | undefined;
      }
      return session;
    },
  },
  providers: [], // Credentials provider added in auth.ts (Node.js only)
};
