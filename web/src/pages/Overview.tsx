import { useQuery } from '@tanstack/react-query';
import { Bot, ChevronRight, FilePlus2, FolderPlus, History, Inbox } from 'lucide-react';
import { Link } from 'react-router-dom';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState, ErrorNotice, PageHeader, Panel, Skeleton, StatusBadge } from '@/components/ui/misc';
import { HistoryList } from '@/components/HistoryList';
import { api, type DashboardSummary } from '@/lib/api';
import { cn, timeAgo } from '@/lib/utils';
import { BUILT_PHASE } from '@/nav';

export function OverviewPage() {
  const q = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get<DashboardSummary>('/api/dashboard/summary'),
    refetchInterval: 15_000,
  });

  return (
    <>
      <PageHeader
        title="Overview"
        description="Every number on this page is counted from saved records. Nothing is estimated."
        actions={
          <>
            <Link to="/projects?new=project" className={buttonVariants({ variant: 'secondary' })}>
              <FolderPlus /> New project
            </Link>
          </>
        }
      />
      {q.isError && <ErrorNotice error={q.error} onRetry={() => q.refetch()} />}
      {q.isPending && <Skeleton className="h-40 w-full" />}
      {q.data && <Dashboard d={q.data} />}
    </>
  );
}

function Dashboard({ d }: { d: DashboardSummary }) {
  const c = d.counts;
  const p = d.percentages;
  return (
    <div className="space-y-6">
      <TraceChain d={d} />

      {c.totalProjects === 0 && (
        <Panel>
          <EmptyState
            icon={<FolderPlus />}
            title="Start by creating a project"
            body="A project holds your change requests, environments and source documents. Everything on this page fills in as you work."
            action={
              <Link to="/projects?new=project" className={buttonVariants({ variant: 'primary' })}>
                Create project
              </Link>
            }
          />
        </Panel>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Panel title="Execution status" id="exec-status">
            {c.testCases === 0 ? (
              <EmptyState
                title="No test cases yet"
                body="Pass, fail and blocked counts appear here once test cases exist (phase 4) and are executed (phases 5 and 8)."
              />
            ) : (
              <ExecutionBar d={d} />
            )}
          </Panel>

          <Panel
            title="Active change requests"
            id="active-crs"
            actions={
              <Link to="/projects?tab=crs" className="text-[13px] font-medium text-signal hover:underline">
                All CRs
              </Link>
            }
          >
            {d.activeCrs.length === 0 ? (
              <EmptyState title="No change requests yet" body="Open a project and add a CR to start tracking it here." />
            ) : (
              <ul className="divide-y divide-line">
                {d.activeCrs.map((cr) => (
                  <li key={cr.id}>
                    <Link to={`/crs/${cr.id}`} className="flex items-center gap-4 px-4 py-3 hover:bg-surface-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">
                          <span className="text-ink">{cr.crNumber}</span>
                          <span className="text-ink-2"> — {cr.title}</span>
                        </p>
                        <p className="text-[12.5px] text-ink-3">
                          {cr.project.code}, v{cr.version}, {cr.documentCount} document{cr.documentCount === 1 ? '' : 's'}, updated {timeAgo(cr.updatedAt)}
                        </p>
                      </div>
                      <StatusBadge status={cr.analysisStatus} />
                      <ChevronRight className="size-4 text-ink-3" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <Ratio label="Automation coverage" value={p.automationCoverage} note="Test cases with a script" />
            <Ratio label="Execution progress" value={p.executionProgress} note="Test cases with a final result" />
            <Ratio label="Evidence completion" value={p.evidenceCompletion} note="Test cases with evidence" />
          </div>
        </div>

        <div className="space-y-6">
          <Panel title="Quick actions" id="quick">
            <div className="grid gap-2 p-4">
              <Link to="/projects?new=project" className={buttonVariants({ variant: 'secondary', className: 'justify-start' })}>
                <FolderPlus /> Create a project
              </Link>
              <Link to="/projects?tab=crs" className={buttonVariants({ variant: 'secondary', className: 'justify-start' })}>
                <FilePlus2 /> Upload a CR document
              </Link>
            </div>
          </Panel>

          <Panel title="Pending approvals" id="approvals">
            {c.pendingApprovals === 0 ? (
              <EmptyState icon={<Inbox />} title="Nothing waiting for you" body="Generated test scenarios waiting for review are counted here." />
            ) : (
              <p className="px-4 py-3">{c.pendingApprovals} test scenario(s) need review. Open a CR in the CR Analysis Studio to approve them.</p>
            )}
          </Panel>

          <Panel title="Recent activity" id="activity">
            {d.recentActivity.length === 0 ? (
              <EmptyState icon={<History />} title="No activity yet" />
            ) : (
              <HistoryList entries={d.recentActivity} compact showProject />
            )}
          </Panel>

          <Panel title="Agent activity" id="agents">
            {d.agentActivity.length === 0 ? (
              <EmptyState
                icon={<Bot />}
                title="No agent runs yet"
                body={d.ai.configured ? 'Generate test scenarios from a CR in the CR Analysis Studio.' : 'AI is not connected. Sign in to Claude Code or set ANTHROPIC_API_KEY in server/.env.'}
              />
            ) : (
              <ul className="divide-y divide-line">
                {d.agentActivity.map((a) => (
                  <li key={a.id} className="flex justify-between px-4 py-2.5 text-[13px]">
                    <span>{a.agent}</span>
                    <StatusBadge status={a.status} />
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
      <p className="text-[12px] text-ink-3">Refreshes every 15 seconds. Last updated {timeAgo(d.generatedAt)}.</p>
    </div>
  );
}

/**
 * The signature element: the traceability chain from CR to defect, with the
 * real count at each link. Links whose module isn't built yet are shown faded
 * with the phase that builds them.
 */
function TraceChain({ d }: { d: DashboardSummary }) {
  const c = d.counts;
  const stages: { label: string; value: string; sub: string; phase: number; to?: string }[] = [
    { label: 'Projects', value: String(c.totalProjects), sub: 'active', phase: 1, to: '/projects' },
    { label: 'Change requests', value: String(c.totalCrs), sub: `${c.sourceDocuments} source document${c.sourceDocuments === 1 ? '' : 's'}`, phase: 1, to: '/projects?tab=crs' },
    {
      label: 'Test scenarios',
      value: String(c.scenarios),
      sub: `${c.approvedScenarios} approved${c.clarificationScenarios ? `, ${c.clarificationScenarios} need clarification` : ''}`,
      phase: 2,
      to: '/cr-analysis',
    },
    { label: 'Test cases', value: String(c.testCases), sub: c.testCases ? `${c.notRun} not run` : 'generated', phase: 4 },
    { label: 'Executed', value: String(c.passed + c.failed + c.blocked), sub: `${c.passed} passed, ${c.failed} failed, ${c.blocked} blocked`, phase: 5 },
    { label: 'Open defects', value: String(c.openDefects), sub: 'open, in progress or retest', phase: 8 },
  ];
  return (
    <section aria-label="Traceability chain" className="overflow-x-auto rounded-lg border border-line bg-surface">
      <ol className="flex min-w-[860px]" data-testid="trace-chain">
        {stages.map((s, i) => {
          const built = s.phase <= BUILT_PHASE;
          const body = (
            <>
              <span className="text-[12.5px] text-ink-2">{s.label}</span>
              <span className={cn('mt-0.5 text-[28px] font-semibold leading-none tracking-tight', built ? 'text-ink' : 'text-ink-3')} data-testid={`stat-${s.label}`}>
                {s.value}
              </span>
              <span className="mt-1.5 truncate text-[12px] text-ink-3">{built ? s.sub : `Phase ${s.phase}`}</span>
            </>
          );
          return (
            <li key={s.label} className="relative flex flex-1">
              {i > 0 && <span aria-hidden className="absolute left-0 top-1/2 h-px w-3 -translate-x-1/2 bg-signal/50" />}
              {s.to ? (
                <Link to={s.to} className="flex flex-1 flex-col border-l-2 border-transparent px-4 py-4 hover:bg-surface-2" style={{ borderLeftColor: built ? 'var(--signal)' : undefined }}>
                  {body}
                </Link>
              ) : (
                <div className={cn('flex flex-1 flex-col px-4 py-4', i > 0 && 'border-l border-line')}>{body}</div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function ExecutionBar({ d }: { d: DashboardSummary }) {
  const c = d.counts;
  const segs = [
    { k: 'Passed', n: c.passed, cls: 'bg-pass' },
    { k: 'Failed', n: c.failed, cls: 'bg-fail' },
    { k: 'Blocked', n: c.blocked, cls: 'bg-blocked' },
    { k: 'Not run', n: c.notRun, cls: 'bg-line-strong' },
  ];
  return (
    <div className="p-4">
      <div className="flex h-3 overflow-hidden rounded-full bg-surface-2" role="img" aria-label={segs.map((s) => `${s.k} ${s.n}`).join(', ')}>
        {segs.map((s) => s.n > 0 && <div key={s.k} className={s.cls} style={{ width: `${(s.n / c.testCases) * 100}%` }} />)}
      </div>
      <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-[13px]">
        {segs.map((s) => (
          <div key={s.k} className="flex items-center gap-2">
            <span className={cn('size-2.5 rounded-sm', s.cls)} aria-hidden />
            <dt className="text-ink-2">{s.k}</dt>
            <dd className="font-semibold">{s.n}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Ratio({ label, value, note }: { label: string; value: number | null; note: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <p className="text-[13px] text-ink-2">{label}</p>
      {value === null ? (
        <p className="mt-1 text-[15px] text-ink-3">No test cases yet</p>
      ) : (
        <>
          <p className="mt-1 text-[24px] font-semibold leading-none">{value}%</p>
          <div className="mt-2 h-1.5 rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-signal" style={{ width: `${value}%` }} />
          </div>
        </>
      )}
      <p className="mt-2 text-[12px] text-ink-3">{note}</p>
    </div>
  );
}
