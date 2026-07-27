import { cloneElement, useId, type ReactElement, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { initials } from "./format.js";

export function ScreenHead({
  title,
  back,
  right,
  steps,
}: {
  title: string;
  back?: boolean | (() => void);
  right?: ReactNode;
  steps?: { total: number; current: number };
}) {
  const navigate = useNavigate();
  return (
    <header className="screen-head">
      <div className="screen-head-row">
        {back ? (
          <button
            type="button"
            className="btn-back"
            onClick={() => (typeof back === "function" ? back() : navigate(-1))}
          >
            ← Tilbage
          </button>
        ) : (
          <span />
        )}
        <span className="screen-title">{title}</span>
        <span className="kicker">{right}</span>
      </div>
      {steps && (
        <div
          className="steps"
          style={{ gridTemplateColumns: `repeat(${steps.total}, 1fr)` }}
          role="progressbar"
          aria-valuenow={steps.current}
          aria-valuemin={1}
          aria-valuemax={steps.total}
          aria-label={`Trin ${steps.current} af ${steps.total}`}
        >
          {Array.from({ length: steps.total }, (_, index) => (
            <span
              key={index}
              className={index < steps.current ? "step step-done" : "step"}
            />
          ))}
        </div>
      )}
    </header>
  );
}

export function Avatar({
  name,
  guest,
  onAccent,
}: {
  name: string;
  guest?: boolean;
  onAccent?: boolean;
}) {
  const className = ["avatar", guest ? "avatar-guest" : "", onAccent ? "avatar-on-accent" : ""]
    .filter(Boolean)
    .join(" ");
  return (
    <span className={className} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

/**
 * Etiket, kontrol og fejl hører sammen.
 *
 * Id'et laves her og sættes på kontrollen med cloneElement, så label htmlFor og
 * aria-describedby altid passer. Uden koblingen læser en skærmlæser feltet op
 * uden navn — og så kan man heller ikke ramme det med getByLabel i en test.
 */
export function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: ReactElement<Record<string, unknown>>;
}) {
  const id = useId();
  const errorId = error ? `${id}-fejl` : undefined;
  const hintId = hint ? `${id}-hjaelp` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {cloneElement(children, { id, "aria-describedby": describedBy })}
      {error && (
        <span className="field-error" id={errorId}>
          {error}
        </span>
      )}
      {hint && (
        <span className="lede" id={hintId}>
          {hint}
        </span>
      )}
    </div>
  );
}

export function Empty({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      <p className="lede">{body}</p>
      {action}
    </div>
  );
}

export function Loading({ rows = 3 }: { rows?: number }) {
  return (
    <div className="stack-tight" aria-busy="true" aria-label="Henter">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="skeleton" />
      ))}
    </div>
  );
}

/** Vises på rækker der endnu ikke er nået frem til serveren. Ikke en advarsel. */
export function PendingMark() {
  return <span className="tag tag-outline">Gemmes senere</span>;
}
