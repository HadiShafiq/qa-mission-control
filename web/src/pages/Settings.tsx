import { useMutation, useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import type { ReactNode } from 'react';
import { ErrorNotice, PageHeader, Panel, Skeleton } from '@/components/ui/misc';
import { ApiError } from '@/lib/api';
import { api, type Settings } from '@/lib/api';
import { useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';

type Health = { status: string; version: string; checks: { database: boolean; storage: boolean } };

export function SettingsPage() {
  const s = useQuery({ queryKey: ['settings'], queryFn: () => api.get<Settings>('/api/settings') });
  const h = useQuery({
    queryKey: ['health'],
    queryFn: async () => {
      const res = await fetch('/api/health');
      return (await res.json()) as Health;
    },
    refetchInterval: 30_000,
  });
  const { theme, toggle } = useTheme();
  const test = useMutation({ mutationFn: () => api.post<{ ok: true; model: string; displayName: string; checkedAt: string }>('/api/settings/ai/test') });

  return (
    <>
      <PageHeader title="Settings" description="Configuration is read from server/.env. Secrets are never shown here." />
      {s.isError && <ErrorNotice error={s.error} onRetry={() => s.refetch()} />}
      {s.isPending && <Skeleton className="h-40" />}
      {s.data && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Panel title="System">
            <dl className="divide-y divide-line">
              <Row label="Version">{s.data.version}</Row>
              <Row label="Mode">{s.data.environment}</Row>
              <Row label="Database">
                {s.data.database} <Check ok={h.data?.checks.database} />
              </Row>
              <Row label="File storage">
                <span className="break-all">{s.data.storageDir}</span> <Check ok={h.data?.checks.storage} />
              </Row>
              <Row label="Upload limit">{s.data.maxUploadMb} MB per file</Row>
              <Row label="QA skill builder">
                <span className={cn(s.data.workbookBuilder.available ? 'text-pass' : 'text-fail')} data-testid="builder-status">
                  {s.data.workbookBuilder.available ? `${s.data.workbookBuilder.skill} · ${s.data.workbookBuilder.detail}` : s.data.workbookBuilder.detail}
                </span>
              </Row>
            </dl>
          </Panel>
          <Panel title="AI provider">
            <dl className="divide-y divide-line">
              <Row label="Provider">{s.data.ai.provider}</Row>
              <Row label="Model">{s.data.ai.model}</Row>
              <Row label="Effort">{s.data.ai.effort}</Row>
              <Row label="Token budget">
                {s.data.ai.maxInputTokens.toLocaleString()} input / {s.data.ai.maxOutputTokens.toLocaleString()} output per request
              </Row>
              <Row label="Status">
                <span className={cn(s.data.ai.configured ? 'text-pass' : 'text-ink-2')} data-testid="ai-status">
                  {s.data.ai.status}
                </span>
              </Row>
            </dl>
            <div className="space-y-2 border-t border-line px-4 py-3 text-[13px]">
              {s.data.ai.configured ? (
                <>
                  <Button size="sm" onClick={() => test.mutate()} loading={test.isPending}>
                    Test connection
                  </Button>
                  {test.data && (
                    <p className="text-pass" data-testid="ai-test-result">
                      Connected: {test.data.displayName} ({test.data.model})
                    </p>
                  )}
                  {test.error && <ErrorNotice error={test.error instanceof ApiError ? test.error : new Error('Connection test failed')} />}
                </>
              ) : (
                <p className="text-ink-3">The CR Analyst needs Anthropic credentials: run `ant auth login`, or set ANTHROPIC_API_KEY in server/.env, then restart. Model, effort and budgets can be changed in server/.env (ANTHROPIC_MODEL, AI_EFFORT, AI_MAX_INPUT_TOKENS, AI_MAX_OUTPUT_TOKENS).</p>
              )}
            </div>
          </Panel>
          <Panel title="Appearance">
            <div className="flex items-center justify-between px-4 py-3">
              <span>Theme</span>
              <button onClick={toggle} className="rounded-md border border-line-strong px-3 py-1.5 text-[13px] font-medium hover:bg-surface-2">
                {theme === 'dark' ? 'Dark — switch to light' : 'Light — switch to dark'}
              </button>
            </div>
          </Panel>
        </div>
      )}
    </>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-4 px-4 py-2.5 text-[13.5px]">
      <dt className="text-ink-2">{label}</dt>
      <dd className="flex flex-wrap items-center gap-2">{children}</dd>
    </div>
  );
}

function Check({ ok }: { ok?: boolean }) {
  if (ok === undefined) return null;
  return <span className={cn('text-[12.5px] font-medium', ok ? 'text-pass' : 'text-fail')}>{ok ? 'healthy' : 'not reachable'}</span>;
}
