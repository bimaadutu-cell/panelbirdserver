"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Server,
  LayoutDashboard,
  Users,
  Shield,
  Key,
  HardDrive,
  Package,
  ShoppingCart,
  Wallet,
  FileText,
  Activity,
  LogOut,
  Menu,
  X,
  Settings,
  Globe,
  Radio,
  Clock,
  Layers,
} from "lucide-react";

interface SidebarProps {
  user: {
    id: string;
    username: string;
    email: string;
    role: "admin" | "reseller" | "user";
  } | null;
}

export function Sidebar({ user }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.push("/");
      router.refresh();
    } catch (err) {
      console.error(err);
    }
  };

  const role = user?.role || "user";

  // Build navigation items based on exact prompt specifications
  let navItems: { label: string; href: string; icon: React.ReactNode }[] = [];

  if (role === "admin") {
    navItems = [
      { label: "Dashboard", href: "/dashboard", icon: <LayoutDashboard className="w-5 h-5" /> },
      { label: "Users", href: "/admin/users", icon: <Users className="w-5 h-5" /> },
      { label: "Provision", href: "/admin/provision", icon: <Package className="w-5 h-5" /> },
      { label: "Resellers", href: "/admin/resellers", icon: <Shield className="w-5 h-5" /> },
      { label: "Servers", href: "/servers", icon: <Server className="w-5 h-5" /> },
      { label: "Nodes", href: "/admin/nodes", icon: <HardDrive className="w-5 h-5" /> },
      { label: "Allocations", href: "/admin/allocations", icon: <Globe className="w-5 h-5" /> },
      { label: "Templates (Eggs)", href: "/admin/templates", icon: <Layers className="w-5 h-5" /> },
      { label: "API Keys", href: "/api-keys", icon: <Key className="w-5 h-5" /> },
      { label: "Webhooks", href: "/admin/webhooks", icon: <Radio className="w-5 h-5" /> },
      { label: "Audit Logs", href: "/admin/audit-logs", icon: <FileText className="w-5 h-5" /> },
      { label: "System Settings", href: "/admin/system", icon: <Settings className="w-5 h-5" /> },
    ];
  } else if (role === "reseller") {
    // ⚠️ STRICT PROHIBITION: RESELLERS MUST NOT HAVE API KEYS MENU
    navItems = [
      { label: "Dashboard", href: "/dashboard", icon: <LayoutDashboard className="w-5 h-5" /> },
      { label: "Customers", href: "/reseller/customers", icon: <Users className="w-5 h-5" /> },
      { label: "Servers", href: "/servers", icon: <Server className="w-5 h-5" /> },
      { label: "Packages", href: "/reseller/packages", icon: <Package className="w-5 h-5" /> },
      { label: "Orders", href: "/reseller/orders", icon: <ShoppingCart className="w-5 h-5" /> },
      { label: "Balance & Topup", href: "/reseller/balance", icon: <Wallet className="w-5 h-5" /> },
      { label: "Transactions", href: "/reseller/transactions", icon: <Activity className="w-5 h-5" /> },
      { label: "Account", href: "/account", icon: <Settings className="w-5 h-5" /> },
    ];
  } else {
    // USER
    navItems = [
      { label: "Dashboard", href: "/dashboard", icon: <LayoutDashboard className="w-5 h-5" /> },
      { label: "Servers", href: "/servers", icon: <Server className="w-5 h-5" /> },
      { label: "Account", href: "/account", icon: <Settings className="w-5 h-5" /> },
      { label: "Activity", href: "/activity", icon: <Activity className="w-5 h-5" /> },
    ];
  }

  const content = (
    <div className="flex flex-col h-full bg-zinc-950 border-r border-zinc-800 text-zinc-100 p-4">
      {/* Brand Header */}
      <div className="flex items-center justify-between px-2 py-3 border-b border-zinc-800/80 mb-4">
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9 rounded-xl bg-white text-black flex items-center justify-center font-black shadow-[0_0_15px_rgba(255,255,255,0.4)]">
            B
          </div>
          <div>
            <h1 className="font-bold text-lg tracking-wider text-white flex items-center gap-1.5">
              BIRDSERVER <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700 font-mono text-zinc-300">V1</span>
            </h1>
            <p className="text-[10px] text-zinc-400 font-medium tracking-tight">
              Developer by BimzOfficial
            </p>
          </div>
        </div>
        <button
          onClick={() => setMobileOpen(false)}
          className="md:hidden p-1 text-zinc-400 hover:text-white"
        >
          <X className="w-6 h-6" />
        </button>
      </div>

      {/* Role Badge */}
      <div className="px-2 mb-4">
        <div className="px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-between text-xs">
          <span className="text-zinc-400 font-medium">Role</span>
          <span className="font-semibold uppercase tracking-wider text-white text-[11px] px-2 py-0.5 rounded bg-zinc-800 border border-zinc-700">
            {role}
          </span>
        </div>
      </div>

      {/* Navigation Items */}
      <nav className="flex-1 space-y-1 overflow-y-auto px-1">
        {navItems.map((item) => {
          const isActive = pathname === item.href || pathname?.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMobileOpen(false)}
              className={`flex items-center space-x-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
                isActive
                  ? "bg-white text-black font-semibold shadow-[0_0_12px_rgba(255,255,255,0.3)]"
                  : "text-zinc-400 hover:text-white hover:bg-zinc-900/80"
              }`}
            >
              <div className={isActive ? "text-black" : "text-zinc-400"}>
                {item.icon}
              </div>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Bottom Profile & Logout */}
      <div className="pt-4 border-t border-zinc-800/80 mt-auto px-1 space-y-2">
        <div className="flex items-center space-x-3 px-3 py-2 rounded-xl bg-zinc-900/50 border border-zinc-800/50">
          <div className="w-8 h-8 rounded-full bg-zinc-800 border border-zinc-700 text-white flex items-center justify-center text-xs font-bold uppercase">
            {user?.username?.[0] || "U"}
          </div>
          <div className="flex-1 overflow-hidden">
            <p className="text-xs font-bold text-white truncate">{user?.username}</p>
            <p className="text-[11px] text-zinc-400 truncate">{user?.email}</p>
          </div>
        </div>

        <button
          onClick={handleLogout}
          className="w-full flex items-center space-x-3 px-3 py-2.5 rounded-xl text-sm font-medium text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors"
        >
          <LogOut className="w-5 h-5" />
          <span>Logout</span>
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile Top Bar Header */}
      <div className="md:hidden flex items-center justify-between p-4 bg-zinc-950 border-b border-zinc-800 text-white sticky top-0 z-40">
        <div className="flex items-center space-x-2">
          <div className="w-7 h-7 rounded-lg bg-white text-black flex items-center justify-center font-black text-xs">
            B
          </div>
          <span className="font-bold text-sm tracking-wider">BIRDSERVER V1</span>
        </div>
        <button
          onClick={() => setMobileOpen(true)}
          className="p-1 text-zinc-300 hover:text-white"
        >
          <Menu className="w-6 h-6" />
        </button>
      </div>

      {/* Desktop Sidebar */}
      <div className="hidden md:block w-64 h-screen sticky top-0 flex-shrink-0 z-30">
        {content}
      </div>

      {/* Mobile Drawer Overlay */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div
            className="fixed inset-0 bg-black/80 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <div className="relative w-72 max-w-full h-full z-10">
            {content}
          </div>
        </div>
      )}
    </>
  );
}
