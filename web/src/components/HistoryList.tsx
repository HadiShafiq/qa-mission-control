import type { AuditEntry } from '@/lib/api';
import { cn, formatDateTime, timeAgo } from '@/lib/utils';

const ACTION_DOT: Record<string, string> = {
  CREATED: 'bg-signal',
  UPLOADED: 'bg-signal',
  UPDATED: 'bg-ink-3',
  ARCHIVED: 'bg-blocked',
  RESTORED: 'bg-pass',
};

function show(v: unknown) {
  if (v === null || v === undefined || v === '') return 'empty';
  return String(v);
}

export function HistoryList({ entries, compact, showProject }: { entries: AuditEntry[]; compact?: boolean; showProject?: boolean }) {
  return (
    <ol className="divide-y divide-line" data-testid="history-list">
      {entries.map((e) => (
        <li key={e.id} className={cn('flex gap-3 px-4', compact ? 'py-2.5' : 'py-3')}>
          <span className={cn('mt-[7px] size-2 shrink-0 rounded-full', ACTION_DOT[e.action] ?? 'bg-ink-3')} aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-[13.5px] text-ink">{e.summary}</p>
            {!compact && e.changes && (
              <ul className="mt-1 space-y-0.5 text-[12.5px] text-ink-2">
                {Object.entries(e.changes).map(([field, ch]) => (
                  <li key={field}>
                    <span className="font-medium text-ink">{field}</span>: <span className="line-through decoration-ink-3">{show(ch.from)}</span> to {show(ch.to)}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-0.5 text-[12px] text-ink-3" title={formatDateTime(e.createdAt)}>
              {showProject && e.project?.code ? `${e.project.code}, ` : ''}
              {timeAgo(e.createdAt)} by {e.actor}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
