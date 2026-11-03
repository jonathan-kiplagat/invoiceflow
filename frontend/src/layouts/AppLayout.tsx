import {
  BarChart3,
  FileSpreadsheet,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu as MenuIcon,
  Moon,
  Plus,
  RefreshCcw,
  Settings,
  Sun,
  Users,
  Wallet,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { UpdatePrompt } from "@/components/Pwa";
import { OfflineBanner, SyncIndicator } from "@/components/Status";
import { IconButton, Modal } from "@/components/ui";
import { useApp, useSyncCounts } from "@/hooks/useApp";
import { cn } from "@/utils/cn";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/invoices/new", label: "Create Invoice", icon: Plus },
  { to: "/invoices", label: "Invoices", icon: FileText },
  { to: "/customers", label: "Customers", icon: Users },
  { to: "/payments", label: "Payments", icon: Wallet },
  { to: "/quotations", label: "Quotations", icon: FileSpreadsheet },
  { to: "/reports", label: "Reports", icon: BarChart3 },
  { to: "/settings", label: "Settings", icon: Settings },
];

function Logo({ className }: { className?: string }) {
  return (
    <Link to="/" className={cn("flex items-center gap-2.5", className)} aria-label="InvoiceFlow home">
      <img src="/icons/favicon.svg" alt="" className="h-8 w-8 rounded-lg" />
      <span className="text-[15px] font-semibold tracking-tight text-zinc-900 dark:text-white">InvoiceFlow</span>
    </Link>
  );
}

function ThemeToggle() {
  const { setTheme } = useApp();
  const dark = document.documentElement.classList.contains("dark");
  return (
    <IconButton label={dark ? "Switch to light mode" : "Switch to dark mode"} onClick={() => setTheme(dark ? "light" : "dark")}>
      {dark ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
    </IconButton>
  );
}

function Sidebar() {
  const { business, user, logout } = useApp();
  const counts = useSyncCounts();
  const navigate = useNavigate();
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-zinc-200/80 bg-white lg:flex dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex h-16 items-center px-5">
        <Logo />
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2" aria-label="Main">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end ?? to === "/invoices"}
            className={({ isActive }) =>
              cn(
                "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-brand-50 text-brand-800 dark:bg-brand-500/10 dark:text-brand-200"
                  : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-white",
                to === "/invoices/new" && !isActive && "text-brand-700 dark:text-brand-300",
              )
            }
          >
            <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
            {label}
          </NavLink>
        ))}
        <NavLink
          to="/sync"
          className={({ isActive }) =>
            cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              isActive ? "bg-brand-50 text-brand-800 dark:bg-brand-500/10 dark:text-brand-200" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900",
            )
          }
        >
          <RefreshCcw className="h-[18px] w-[18px]" aria-hidden />
          Offline & sync
          {counts.pending + counts.failed + counts.conflict + counts.local > 0 && (
            <span className="ml-auto rounded-full bg-amber-100 px-1.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-500/20 dark:text-amber-300">
              {counts.pending + counts.failed + counts.conflict + counts.local}
            </span>
          )}
        </NavLink>
      </nav>
      <div className="border-t border-zinc-200/80 p-3 dark:border-zinc-800">
        <div className="flex items-center gap-3 rounded-lg px-2 py-2">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-800 dark:bg-brand-500/20 dark:text-brand-200">
            {(user?.full_name ?? "?").slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-zinc-900 dark:text-white">{business?.profile.name ?? "Your business"}</p>
            <p className="truncate text-xs text-zinc-500">{user?.email}</p>
          </div>
          <IconButton
            label="Sign out"
            onClick={async () => {
              await logout();
              navigate("/login");
            }}
          >
            <LogOut className="h-4 w-4" />
          </IconButton>
        </div>
      </div>
    </aside>
  );
}

const MOBILE_TABS = [
  { to: "/", label: "Home", icon: LayoutDashboard, end: true },
  { to: "/invoices", label: "Invoices", icon: FileText },
  { to: "/invoices/new", label: "New", icon: Plus, primary: true },
  { to: "/customers", label: "Customers", icon: Users },
];

function BottomNav({ onMore }: { onMore: () => void }) {
  const { pathname } = useLocation();
  const moreActive = ["/payments", "/quotations", "/reports", "/settings", "/sync"].some((p) => pathname.startsWith(p));
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 border-t border-zinc-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden dark:border-zinc-800 dark:bg-zinc-950/95"
      aria-label="Main"
    >
      <div className="mx-auto grid h-16 max-w-lg grid-cols-5">
        {MOBILE_TABS.map(({ to, label, icon: Icon, end, primary }) =>
          primary ? (
            <NavLink key={to} to={to} className="flex items-center justify-center" aria-label="Create invoice">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-700 text-white shadow-lg shadow-brand-900/20 active:scale-95 dark:bg-brand-500 dark:text-zinc-950">
                <Icon className="h-6 w-6" />
              </span>
            </NavLink>
          ) : (
            <NavLink
              key={to}
              to={to}
              end={end ?? to === "/invoices"}
              className={({ isActive }) =>
                cn("flex flex-col items-center justify-center gap-1 text-[11px] font-medium", isActive ? "text-brand-700 dark:text-brand-300" : "text-zinc-500 dark:text-zinc-400")
              }
            >
              <Icon className="h-[22px] w-[22px]" aria-hidden />
              {label}
            </NavLink>
          ),
        )}
        <button
          type="button"
          onClick={onMore}
          className={cn("flex flex-col items-center justify-center gap-1 text-[11px] font-medium", moreActive ? "text-brand-700 dark:text-brand-300" : "text-zinc-500 dark:text-zinc-400")}
        >
          <MenuIcon className="h-[22px] w-[22px]" aria-hidden />
          More
        </button>
      </div>
    </nav>
  );
}

function MoreSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { logout, business, user } = useApp();
  const navigate = useNavigate();
  const items = [
    { to: "/quotations", label: "Quotations", icon: FileSpreadsheet },
    { to: "/payments", label: "Payments", icon: Wallet },
    { to: "/reports", label: "Reports", icon: BarChart3 },
    { to: "/sync", label: "Offline & sync", icon: RefreshCcw },
    { to: "/settings", label: "Settings", icon: Settings },
  ];
  return (
    <Modal open={open} onClose={onClose} title={business?.profile.name ?? "Menu"} description={user?.email}>
      <div className="grid grid-cols-3 gap-2">
        {items.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            onClick={onClose}
            className="flex flex-col items-center gap-2 rounded-xl border border-zinc-200 px-2 py-4 text-center text-[13px] font-medium text-zinc-700 active:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-200 dark:active:bg-zinc-800"
          >
            <Icon className="h-6 w-6 text-brand-700 dark:text-brand-300" aria-hidden />
            {label}
          </Link>
        ))}
        <button
          type="button"
          onClick={async () => {
            onClose();
            await logout();
            navigate("/login");
          }}
          className="flex flex-col items-center gap-2 rounded-xl border border-zinc-200 px-2 py-4 text-[13px] font-medium text-red-600 active:bg-red-50 dark:border-zinc-800"
        >
          <LogOut className="h-6 w-6" aria-hidden />
          Sign out
        </button>
      </div>
    </Modal>
  );
}

export default function AppLayout() {
  const [more, setMore] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [pathname]);
  return (
    <div className="min-h-[100dvh]">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:shadow-pop">
        Skip to content
      </a>
      <Sidebar />
      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 border-b border-zinc-200/80 bg-white/90 pt-[env(safe-area-inset-top)] backdrop-blur dark:border-zinc-800 dark:bg-[#0b0f14]/90">
          <div className="flex h-14 items-center justify-between gap-2 px-4 sm:px-6 lg:h-16 lg:px-8">
            <Logo className="lg:hidden" />
            <div className="hidden lg:block" />
            <div className="flex items-center gap-1.5">
              <SyncIndicator compact />
              <ThemeToggle />
            </div>
          </div>
        </header>
        <OfflineBanner />
        <main id="main" className="mx-auto w-full max-w-7xl px-4 pb-28 pt-5 sm:px-6 lg:px-8 lg:pb-12 lg:pt-8">
          <Outlet />
        </main>
      </div>
      <BottomNav onMore={() => setMore(true)} />
      <MoreSheet open={more} onClose={() => setMore(false)} />
      <UpdatePrompt />
    </div>
  );
}
