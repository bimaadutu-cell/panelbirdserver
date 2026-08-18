"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Lock, User, ArrowRight, ShieldAlert, Activity } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [usernameOrEmail, setUsernameOrEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");


  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg("");

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usernameOrEmail, password }),
      });

      const data = await res.json();
      if (data.success) {
        router.push("/dashboard");
        router.refresh();
      } else {
        setErrorMsg(data.error?.message || "Invalid login credentials");
      }
    } catch {
      setErrorMsg("Network or server connection error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-transparent text-white flex flex-col items-center justify-center p-4 relative overflow-hidden font-sans login-stage">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[520px] h-[520px] bg-blue-500/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute top-[12%] right-[18%] w-2 h-2 rounded-full bg-red-400 shadow-[0_0_18px_6px_rgba(255,23,68,0.35)] animate-pulse pointer-events-none" />

      <div className="w-full max-w-md space-y-6 relative z-10">
        <div className="text-center space-y-2 login-brand">
          <div className="w-16 h-16 text-white rounded-2xl mx-auto flex items-center justify-center font-black text-2xl login-mark">
            B
          </div>
          <p className="spidey-kicker mt-5">Spider Network Control Plane</p>
          <h1 className="text-3xl font-extrabold tracking-wider text-white spidey-glow-text">
            BIRDSERVER <span className="text-xs px-2 py-0.5 rounded bg-zinc-800 border border-zinc-700 font-mono text-zinc-300 align-middle">V1</span>
          </h1>
          <p className="text-xs text-zinc-400 font-medium tracking-tight">
            Developer by <span className="text-white font-bold">BimzOfficial</span>
          </p>
        </div>

        <div className="bg-zinc-950 border border-zinc-800 rounded-3xl p-8 shadow-2xl space-y-6 relative backdrop-blur-xl spidey-card login-card">
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-xl font-bold text-white">System Login</h2>
              <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-cyan-300"><Activity className="w-3.5 h-3.5" /> Secure</span>
            </div>
            <p className="text-xs text-zinc-400">Access server management console & containers</p>
          </div>

          {errorMsg && (
            <div role="alert" aria-live="polite" className="p-3.5 rounded-xl bg-red-950/80 border border-red-800/80 text-red-400 text-xs flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 flex-shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div className="login-field">
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5">
                Username / Email
              </label>
              <div className="relative">
                <User className="w-4 h-4 absolute left-3.5 top-3 text-zinc-500" />
                <input
                  type="text"
                  value={usernameOrEmail}
                  onChange={(e) => setUsernameOrEmail(e.target.value)}
                  placeholder="admin@birdserver.local"
                  required
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-xl pl-10 pr-3 py-2.5 text-xs text-white focus:outline-none focus:border-white transition-colors"
                />
              </div>
            </div>

            <div className="login-field">
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5">
                Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 absolute left-3.5 top-3 text-zinc-500" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  required
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-xl pl-10 pr-3 py-2.5 text-xs text-white focus:outline-none focus:border-white transition-colors"
                />
              </div>
            </div>

            <div className="flex items-center justify-between text-xs login-field">
              <label className="flex items-center space-x-2 cursor-pointer text-zinc-400 select-none">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="rounded border-zinc-800 bg-zinc-900 text-white focus:ring-0"
                />
                <span>Remember Me</span>
              </label>
              <a href="#" onClick={(e) => { e.preventDefault(); alert("Hubungi administrator untuk reset password atau aktivasi akun."); }} className="text-zinc-400 hover:text-white transition-colors">
                Forgot Password?
              </a>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-xl font-bold text-xs bg-white text-black hover:bg-zinc-200 transition-all flex items-center justify-center space-x-2 shadow-[0_0_20px_rgba(255,23,68,0.3)] disabled:opacity-50 login-submit"
            >
              <span>{loading ? "Authenticating..." : "Login to Console"}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>


        </div>

        <div className="text-center text-xs text-zinc-400 space-y-2">
          <div className="spidey-divider" />
          <p>Birdserver V1 Production Server Management Panel &copy; 2026 BimzOfficial</p>
          <p className="text-[10px] uppercase tracking-[0.24em] text-cyan-400/70">Fast path · low overhead · server ready</p>
        </div>
      </div>
    </div>
  );
}
