import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { cn } from "@/utils/cn";

type ToastTone = "success" | "error" | "info";
interface ToastItem {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
}

interface ToastApi {
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
}

const Ctx = createContext<ToastApi | null>(null);
let seq = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const push = useCallback(
    (tone: ToastTone, title: string, description?: string) => {
      const id = ++seq;
      setItems((xs) => [...xs.slice(-3), { id, tone, title, description }]);
      setTimeout(() => dismiss(id), tone === "error" ? 7000 : 4000);
    },
    [dismiss],
  );
  const api = useMemo<ToastApi>(
    () => ({
      success: (t, d) => push("success", t, d),
      error: (t, d) => push("error", t, d),
      info: (t, d) => push("info", t, d),
    }),
    [push],
  );
  const icons = { success: CheckCircle2, error: AlertCircle, info: Info };
  return (
    <Ctx.Provider value={api}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-[60] flex flex-col items-center gap-2 px-4 lg:bottom-6 lg:items-end lg:pr-6"
        aria-live="polite"
        aria-atomic="false"
      >
        {items.map((t) => {
          const Icon = icons[t.tone];
          return (
            <div
              key={t.id}
              role={t.tone === "error" ? "alert" : "status"}
              className="pointer-events-auto flex w-full max-w-sm animate-slide-up items-start gap-3 rounded-xl border border-zinc-200 bg-white p-3.5 shadow-pop dark:border-zinc-700 dark:bg-zinc-900"
            >
              <Icon className={cn("mt-0.5 h-5 w-5 shrink-0", t.tone === "success" && "text-emerald-600", t.tone === "error" && "text-red-600", t.tone === "info" && "text-sky-600")} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-zinc-900 dark:text-white">{t.title}</p>
                {t.description && <p className="mt-0.5 text-[13px] text-zinc-500 dark:text-zinc-400">{t.description}</p>}
              </div>
              <button type="button" onClick={() => dismiss(t.id)} className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200" aria-label="Dismiss">
                <X className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useToast outside ToastProvider");
  return ctx;
}
