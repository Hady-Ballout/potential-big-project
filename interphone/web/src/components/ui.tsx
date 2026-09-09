import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { copy } from "../lib/copy";

export function Icon({ name }: { name: "door" | "bell" | "check" | "arrow" | "clock" | "info" }) {
  const paths = {
    door: <><path d="M5 21V3h14v18M3 21h18M9 21V6l7-1v16" /><path d="M13 13h.01" /></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6m0-10h.01" /></>,
  };
  return <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

export function Page({ children, wide = false, context }: { children: ReactNode; wide?: boolean; context?: string }) {
  return <div className={`page ${wide ? "page-wide" : ""}`}>
    <header className="brand-bar"><span className="brand"><Icon name="door" />{copy.brand}</span><span className="brand-context">{context ?? copy.entrance}</span></header>
    <main id="main-content">{children}</main>
    <footer className="page-footer"><span className="footer-rule" />{copy.tagline}</footer>
  </div>;
}

export function Button({ variant = "secondary", className = "", children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "quiet"; children: ReactNode }) {
  return <button type="button" className={`button button-${variant} ${className}`} {...props}>{children}</button>;
}

export function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }) {
  return <div className="field"><div className="field-heading"><label htmlFor={id}>{label}</label>{hint && <span className="subtle">{hint}</span>}</div>{children}</div>;
}

export function Feedback({ children, tone = "info", title }: { children?: ReactNode; tone?: "info" | "warn" | "error" | "success"; title?: string }) {
  return <div className={`feedback feedback-${tone}`} role={tone === "error" ? "alert" : "status"}>
    <Icon name={tone === "success" ? "check" : "info"} /><div>{title && <strong>{title}</strong>}{children && <div>{children}</div>}</div>
  </div>;
}

export function ConnectionStatus({ online }: { online: boolean | null }) {
  return <span className={`connection ${online === null ? "unknown" : online ? "online" : "offline"}`}><span className="connection-dot" />{online === null ? copy.status.unknown : online ? copy.status.online : copy.status.offline}</span>;
}

export function StatePanel({ title, detail, icon = "info", children, focus = false }: { title: string; detail: string; icon?: "bell" | "check" | "clock" | "info" | "door"; children?: ReactNode; focus?: boolean }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (focus) heading.current?.focus(); }, [focus, title]);
  return <section className="panel state-panel"><div className={`state-symbol state-symbol-${icon}`}><Icon name={icon} /></div><h2 ref={heading} tabIndex={focus ? -1 : undefined}>{title}</h2><p className="subtle">{detail}</p>{children}</section>;
}

export function Loading({ title = copy.loading, detail = copy.loadingDetail }: { title?: string; detail?: string }) {
  return <div role="status"><StatePanel title={title} detail={detail} icon="door" /></div>;
}
