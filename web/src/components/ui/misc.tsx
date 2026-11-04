import { AlertTriangle } from 'lucide-react';
import type { ReactNode } from 'react';
import { ApiError } from '@/lib/api';
import { cn, humanize } from '@/lib/utils';

export function Panel({ title, actions, children, className, id }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section className={cn('rounded-lg border border-line bg-surface', className)} aria-labelledby={id}>
      {(title || actions) && (
        <header className="flex min-h-12 flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2">
          {title && (
            <h2 id={id} className="text-[15px] font-semibold text-ink">
              {title}
            </h2>
          )}
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      {icon && <div className="mb-3 text-ink-3 [&_svg]:size-6">{icon}</div>}
      <p className="font-medium text-ink">{title}</p>
      {body && <p className="mt-1 max-w-sm text-[13px] text-ink-2">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorNotice({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : 'Something went wrong.';
  return (
    <div role="alert" className="flex items-start gap-3 rounded-lg border border-fail/30 bg-fail-soft px-4 py-3 text-[13px] text-ink">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-fail" />
      <div className="flex-1">
        <p>{message}</p>
        {error instanceof ApiError && error.details?.length ? (
          <ul className="mt-1 list-disc pl-4">
            {error.details.map((d) => (
              <li key={d.field + d.message}>{d.message}</li>
            ))}
          </ul>
        ) : null}
      </div>
      {onRetry && (
        <button className="font-medium text-signal underline-offset-2 hover:underline" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded bg-line/70', className)} />;
}

const STATUS_STYLE: Record<string, string> = {
  NOT_STARTED: 'bg-surface-2 text-ink-2 border-line',
  IN_PROGRESS: 'bg-signal-soft text-signal border-signal/25',
  ANALYSED: 'bg-signal-soft text-signal border-signal/25',
  APPROVED: 'bg-pass-soft text-pass border-pass/25',
  COMPLETED: 'bg-pass-soft text-pass border-pass/25',
  PASSED: 'bg-pass-soft text-pass border-pass/25',
  FAILED: 'bg-fail-soft text-fail border-fail/25',
  BLOCKED: 'bg-blocked-soft text-blocked border-blocked/25',
  ARCHIVED: 'bg-surface-2 text-ink-3 border-line',
  // agent tasks
  QUEUED: 'bg-surface-2 text-ink-2 border-line',
  RUNNING: 'bg-signal-soft text-signal border-signal/25',
  CANCELLED: 'bg-surface-2 text-ink-3 border-line',
  // scenario review (pass/fail colours stay reserved for test outcomes)
  PENDING: 'bg-surface-2 text-ink-2 border-line',
  CLARIFICATION_REQUIRED: 'bg-attn-soft text-attn border-attn/25',
  REJECTED: 'bg-surface-2 text-ink-3 border-line line-through',
  REVIEW_APPROVED: 'bg-signal text-signal-ink border-signal',
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return (
    <span className={cn('inline-flex items-center rounded border px-1.5 py-px text-[12px] font-medium', STATUS_STYLE[status] ?? STATUS_STYLE.NOT_STARTED)}>
      {label ?? humanize(status)}
    </span>
  );
}

export function PageHeader({ title, description, actions, meta }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; meta?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {meta && <div className="mb-1 text-[13px] text-ink-3">{meta}</div>}
        <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.01em] text-ink">{title}</h1>
        {description && <p className="mt-1 max-w-[70ch] text-ink-2">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Small segmented control used for Active / Archived / All filters. */
export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-md border border-line-strong bg-surface p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'h-7 rounded px-2.5 text-[13px] font-medium text-ink-2 hover:text-ink',
            value === o.value && 'bg-signal-soft text-signal hover:text-signal',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
