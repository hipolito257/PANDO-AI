"use client";
import { useState } from "react";
import Link from "next/link";
import { Logo } from "@/components/layout/Logo";

export default function SignupPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!email.trim().toLowerCase().endsWith("@pando.mx")) {
      setError("Only @pando.mx email addresses can join.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not create your account.");
        setLoading(false);
        return;
      }
      setSubmitted(true);
    } catch {
      setError("Connection error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-mist flex items-center justify-center p-4">
      <div className="w-full max-w-[360px]">
        <div className="flex justify-center mb-8">
          <Logo size="lg" />
        </div>

        <div className="bg-paper rounded-card shadow-float p-8">
          <h1 className="text-[20px] font-semibold text-carbon tracking-tight mb-1">
            {submitted ? "Request sent" : "Create your account"}
          </h1>
          <p className="text-[13px] text-slate mb-6">
            {submitted ? "An admin needs to approve you before you can sign in" : "Only @pando.mx emails can join"}
          </p>

          {submitted ? (
            <div className="text-[13px] text-carbon bg-green-50 border border-green-200 rounded-[8px] px-3 py-3">
              Your request to join has been sent. Once an admin approves it, you'll be able to sign in with the
              password you just chose.
            </div>
          ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-[12px] font-medium text-graphite mb-1.5">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Jane Doe"
                required
                className="w-full px-3 py-2.5 text-[13px] bg-fog border border-chalk rounded-[8px] text-carbon placeholder:text-slate focus:outline-none focus:border-orange focus:bg-paper transition-colors"
              />
            </div>
            <div>
              <label className="block text-[12px] font-medium text-graphite mb-1.5">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@pando.mx"
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
                placeholder="At least 8 characters"
                required
                className="w-full px-3 py-2.5 text-[13px] bg-fog border border-chalk rounded-[8px] text-carbon placeholder:text-slate focus:outline-none focus:border-orange focus:bg-paper transition-colors"
              />
            </div>
            <div>
              <label className="block text-[12px] font-medium text-graphite mb-1.5">Confirm password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
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
              {loading ? "Creating account..." : "Create Account"}
            </button>
          </form>
          )}

          <p className="text-center text-[12px] text-slate mt-6">
            Already have an account?{" "}
            <Link href="/login" className="text-carbon font-semibold hover:underline">Sign in</Link>
          </p>
        </div>

        <p className="text-center text-[11px] text-slate mt-6">
          PANDO — Restricted access for firm members
        </p>
      </div>
    </div>
  );
}
