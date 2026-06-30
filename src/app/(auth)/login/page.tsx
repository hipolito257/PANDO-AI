"use client";
import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Logo } from "@/components/layout/Logo";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });
      if (res?.error) {
        setError("Incorrect credentials. Please check your email and password.");
      } else {
        router.push("/");
        router.refresh();
      }
    } catch {
      setError("Connection error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-mist flex items-center justify-center p-4">
      <div className="w-full max-w-[360px]">
        {/* Logo */}
        <div className="flex justify-center mb-8">
          <Logo size="lg" />
        </div>

        {/* Card */}
        <div className="bg-paper rounded-card shadow-float p-8">
          <h1 className="text-[20px] font-semibold text-carbon tracking-tight mb-1">Team Access</h1>
          <p className="text-[13px] text-slate mb-6">Private intelligence platform</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-[12px] font-medium text-graphite mb-1.5">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@firm.com"
                required
                className="w-full px-3 py-2.5 text-[13px] bg-fog border border-chalk rounded-[8px] text-carbon placeholder:text-slate focus:outline-none focus:border-orange focus:bg-paper transition-colors"
              />
            </div>
            <div>
              <label className="block text-[12px] font-medium text-graphite mb-1.5">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="w-full px-3 py-2.5 text-[13px] bg-fog border border-chalk rounded-[8px] text-carbon placeholder:text-slate focus:outline-none focus:border-orange focus:bg-paper transition-colors"
              />
            </div>

            {error && (
              <div className="text-[12px] text-red-600 bg-red-50 border border-red-200 rounded-[8px] px-3 py-2">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-orange text-white text-[14px] font-medium rounded-btn hover:opacity-85 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Signing in..." : "Sign In"}
            </button>
          </form>
        </div>

        <p className="text-center text-[11px] text-slate mt-6">
          PANDO — Restricted access for firm members
        </p>
      </div>
    </div>
  );
}
