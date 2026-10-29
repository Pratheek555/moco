import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import {
  LoaderCircle,
  X,
  Check,
  AlertCircle,
  ArrowUpRight,
  Film,
  Play,
} from "lucide-react";
import { Character, CHARACTER_DEFS, restRig } from "@moco/kit";
import { api, type JobSpec, type SeriesSummary } from "../lib/api.ts";
import { useApp } from "../lib/store.ts";
import { cx, timeAgo } from "../lib/format.ts";

export function Button({
  children,
  variant = "outline",
  busy,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "outline" | "secondary" | "danger" | "ghost";
  busy?: boolean;
}) {
  return (
    <button
      className={cx(
        "btn",
        variant !== "ghost" && `t-surface t-${variant}`,
        variant === "ghost" && "btn-ghost",
        className,
      )}
      {...props}
      disabled={props.disabled || busy}
    >
      {busy && <LoaderCircle size={15} className="spin" />}
      {children}
    </button>
  );
}
export function Tag({
  children,
  tone = "",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={`tag ${tone}`}>{children}</span>;
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="field" role="group" aria-labelledby={id}>
      <div className="field-label" id={id}>
        {label}
      </div>
      {children}
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}
export function Empty({
  title,
  detail,
  children,
}: {
  title: string;
  detail?: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Film size={25} />
      </div>
      <h3>{title}</h3>
      <p>{detail}</p>
      {children}
    </div>
  );
}
export function Loading() {
  return (
    <div className="loading">
      <LoaderCircle className="spin" size={22} />
      <span>Opening your workspace…</span>
    </div>
  );
}
export function Modal({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close(): void;
}) {
  const onClose = useRef(close);
  onClose.current = close;
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose.current();
    };
    document.addEventListener("keydown", f);
    const prev = document.activeElement as HTMLElement | null;
    const frame = requestAnimationFrame(() => {
      const dialog = document.querySelector('[role="dialog"]');
      const target =
        dialog?.querySelector<HTMLElement>("input, textarea") ??
        dialog?.querySelector<HTMLElement>("button");
      target?.focus();
    });
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", f);
      prev?.focus();
    };
  }, []);
  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="modal pop-in"
        onKeyDown={(e) => {
          if (e.key !== "Tab") return;
          const els = [
            ...e.currentTarget.querySelectorAll<HTMLElement>(
              'button:not(:disabled),input,textarea,select,[tabindex="0"]',
            ),
          ];
          const first = els[0],
            last = els.at(-1);
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last?.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first?.focus();
          }
        }}
      >
        <header>
          <h2>{title}</h2>
          <Button variant="ghost" aria-label="Close dialog" onClick={close}>
            <X size={18} />
          </Button>
        </header>
        {children}
      </section>
    </div>
  );
}
export function CastArt({
  characters = ["krishna", "arjuna"],
  className = "",
}: {
  characters?: string[];
  className?: string;
}) {
  const uid = useId().replaceAll(":", "");
  return (
    <svg className={className} viewBox="0 0 600 440" aria-hidden="true">
      <ellipse
        cx="300"
        cy="405"
        rx="210"
        ry="15"
        fill="#2e2446"
        opacity=".09"
      />
      {characters.slice(0, 3).map((id, i, all) => {
        const def = CHARACTER_DEFS[id];
        return (
          def && (
            <g
              key={`${id}${i}`}
              transform={`translate(${300 + (i - (all.length - 1) / 2) * 175} 410) scale(.34)`}
            >
              <Character
                def={def}
                rig={restRig(id === "krishna" ? "bless" : "stand", "smile", 1)}
                pose={id === "krishna" ? "bless" : "stand"}
                uid={`${uid}${i}`}
              />
            </g>
          )
        );
      })}
    </svg>
  );
}
export function SeriesCard({ series }: { series: SeriesSummary }) {
  const go = useApp((s) => s.go);
  const done = series.episodes.filter((e) => e.status === "rendered").length;
  return (
    <button
      className="series-card"
      onClick={() => go({ name: "series", id: series.id })}
    >
      <div className={`series-art art-${series.style}`}>
        <span className="art-label">
          {series.style} · {series.language.toUpperCase()}
        </span>
        <CastArt characters={series.cast.map((c) => c.character).slice(0, 3)} />
        <span className="art-play">
          <Play size={16} fill="currentColor" />
        </span>
      </div>
      <div className="series-info">
        <h3>
          {series.title}
          <ArrowUpRight size={16} />
        </h3>
        <p>{series.logline}</p>
        <footer>
          <span>
            {series.episodes.length} episodes{done > 0 && ` · ${done} exported`}
          </span>
          <span>{timeAgo(series.updatedAt)}</span>
        </footer>
      </div>
    </button>
  );
}
export async function startJob(spec: JobSpec) {
  try {
    const job = await api.jobs.start(spec);
    useApp.getState().toast("Added to your queue", "success", {
      label: "View queue",
      run: () => useApp.getState().go({ name: "renders" }),
    });
    return job;
  } catch (e) {
    report(e);
    return null;
  }
}
export function report(e: unknown) {
  useApp.getState().toast(e instanceof Error ? e.message : String(e), "error");
}
export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  const dismiss = useApp((s) => s.dismiss);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div className={`toast enter ${t.kind}`} key={t.id}>
          {t.kind === "error" ? <AlertCircle size={17} /> : <Check size={17} />}
          <span>{t.message}</span>
          {t.action && (
            <button
              onClick={() => {
                t.action!.run();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
          <button
            aria-label="Dismiss notification"
            onClick={() => dismiss(t.id)}
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
export function useAsync<T>(
  fn: () => Promise<T>,
  deps: unknown[],
): { data: T | null; error: string; reload: () => void } {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState(""),
    [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setError("");
    fn()
      .then((v) => {
        if (alive) setData(v);
      })
      .catch((e) => {
        if (alive) setError(String(e.message ?? e));
      });
    return () => {
      alive = false;
    };
  }, [...deps, tick]);
  return { data, error, reload: () => setTick((v) => v + 1) };
}
