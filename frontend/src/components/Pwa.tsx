import { Download, RefreshCw, Share, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, IconButton } from "@/components/ui";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
const subs = new Set<() => void>();
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    subs.forEach((s) => s());
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    subs.forEach((s) => s());
  });
}

export function isStandalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
}

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

export function useInstall() {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    subs.add(fn);
    return () => {
      subs.delete(fn);
    };
  }, []);
  return {
    canPrompt: !!deferred,
    installed: isStandalone(),
    ios: isIos(),
    async install() {
      if (!deferred) return false;
      await deferred.prompt();
      const { outcome } = await deferred.userChoice;
      deferred = null;
      subs.forEach((s) => s());
      return outcome === "accepted";
    },
  };
}

/** Small dismissible banner inviting installation (Android/desktop prompt, iOS instructions). */
export function InstallBanner() {
  const inst = useInstall();
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem("if-install-dismissed") === "1";
    } catch {
      return false;
    }
  });
  if (hidden || inst.installed || (!inst.canPrompt && !inst.ios)) return null;
  const dismiss = () => {
    setHidden(true);
    try {
      localStorage.setItem("if-install-dismissed", "1");
    } catch {
      /* ignore */
    }
  };
  return (
    <div className="mb-5 flex items-start gap-3 rounded-xl border border-brand-200 bg-brand-50 p-3.5 dark:border-brand-900 dark:bg-brand-950/40">
      <img src="/icons/icon-192.png" alt="" className="h-10 w-10 shrink-0 rounded-lg" />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-medium text-brand-950 dark:text-brand-100">Install InvoiceFlow</p>
        {inst.canPrompt ? (
          <p className="mt-0.5 text-[13px] text-brand-900/80 dark:text-brand-200/80">Open it like an app and keep working when the network drops.</p>
        ) : (
          <p className="mt-0.5 text-[13px] text-brand-900/80 dark:text-brand-200/80">
            In Safari, tap <Share className="inline h-3.5 w-3.5 -translate-y-px" aria-label="Share" /> then <b>Add to Home Screen</b>.
          </p>
        )}
        {inst.canPrompt && (
          <Button size="sm" className="mt-2.5" icon={<Download className="h-4 w-4" />} onClick={() => void inst.install()}>
            Install app
          </Button>
        )}
      </div>
      <IconButton label="Dismiss" onClick={dismiss} className="-mr-1 -mt-1 h-8 w-8">
        <X className="h-4 w-4" />
      </IconButton>
    </div>
  );
}

/** Shows when a new version of the app has been downloaded and is ready. */
export function UpdatePrompt() {
  const [needRefresh, setNeedRefresh] = useState(false);
  const [update, setUpdate] = useState<((reload?: boolean) => Promise<void>) | null>(null);
  useEffect(() => {
    if (!("serviceWorker" in navigator) || import.meta.env.DEV) return;
    let cancelled = false;
    import("virtual:pwa-register").then(({ registerSW }) => {
      if (cancelled) return;
      const fn = registerSW({
        immediate: true,
        onNeedRefresh: () => setNeedRefresh(true),
        onRegisteredSW: (_url, reg) => {
          if (reg) setInterval(() => void reg.update(), 60 * 60 * 1000);
        },
      });
      setUpdate(() => fn);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  if (!needRefresh || !update) return null;
  return (
    <div className="fixed inset-x-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-[55] mx-auto flex max-w-md items-center gap-3 rounded-xl border border-zinc-200 bg-white p-3 shadow-pop lg:bottom-6 dark:border-zinc-700 dark:bg-zinc-900" role="status">
      <RefreshCw className="h-5 w-5 shrink-0 text-brand-600" />
      <p className="flex-1 text-sm">A new version of InvoiceFlow is ready.</p>
      <Button size="sm" onClick={() => void update(true)}>Update</Button>
    </div>
  );
}
