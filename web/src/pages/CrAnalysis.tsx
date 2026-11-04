import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2, ChevronRight, Download, FileSpreadsheet, FileText, ListChecks, Play, Plus, Search, ShieldAlert, Square, XCircle } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ReviewBadge, ScenarioDialog } from '@/components/ScenarioDialog';
import { useInvalidateAll } from '@/components/forms';
import { Button, buttonVariants } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input, Select } from '@/components/ui/form';
import { EmptyState, ErrorNotice, PageHeader, Panel, Skeleton, StatusBadge } from '@/components/ui/misc';
import {
  ApiError,
  SCENARIO_TYPES,
  api,
  isPictureSource,
  type AgentTask,
  type Artifact,
  type ChangeRequest,
  type DocumentExtraction,
  type ReviewStatus,
  type ScenarioType,
  type Settings,
  type SourceDocument,
  type TestScenario,
  type WorkbookVersion,
} from '@/lib/api';
import { cn, formatBytes, formatDateTime, humanize, timeAgo } from '@/lib/utils';
import { AiNotConnected } from './AnalysisStudio';
import { Documents } from './CrDetail';
import { NotFoundPage } from './NotFound';

export function CrAnalysisPage() {
  const { id } = useParams<{ id: string }>();
  const cr = useQuery({ queryKey: ['cr', id], queryFn: () => api.get<ChangeRequest>(`/api/crs/${id}`) });
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api.get<Settings>('/api/settings') });

  if (cr.isError && cr.error instanceof ApiError && cr.error.status === 404) return <NotFoundPage what="change request" />;
  if (cr.isError) return <ErrorNotice error={cr.error} onRetry={() => cr.refetch()} />;
  if (cr.isPending) return <Skeleton className="h-48" />;

  const c = cr.data;
  const readOnly = Boolean(c.archivedAt || c.project.archivedAt);
  const aiConnected = Boolean(settings.data?.ai.configured);

  return (
    <>
      <PageHeader
        meta={
          <span>
            <Link to="/cr-analysis" className="hover:text-ink">
              CR Analysis Studio
            </Link>
            {' / '}
            {c.project.code}
          </span>
        }
        title={
          <span className="flex flex-wrap items-center gap-2">
            {c.crNumber}
            <span className="font-normal text-ink-2">{c.title}</span>
          </span>
        }
        actions={
          <Link to={`/crs/${c.id}`} className={buttonVariants({ variant: 'secondary' })}>
            <FileText /> CR details & history
          </Link>
        }
      />
      {settings.data && !aiConnected && <AiNotConnected />}
      {readOnly && <div className="mb-6 rounded-lg border border-blocked/30 bg-blocked-soft px-4 py-3 text-[13.5px]">This CR is archived, so its scenarios are read-only. Exports still work.</div>}

      <Documents crId={c.id} readOnly={readOnly} />
      <ScenarioPanel cr={c} aiConnected={aiConnected} readOnly={readOnly} />
      <ScenarioReview cr={c} readOnly={readOnly} />
      <ExtractionPanel crId={c.id} />
    </>
  );
}

// ───────────────────────── QA test scenario workbook ─────────────────────────

type ScenarioOutput = {
  artifactId: string;
  fileName: string;
  scenarioCount: number;
  clarificationCount: number;
  decisionTableCount: number;
  unverifiedCount: number;
  wipApplicable: boolean;
  enhancementApplicable: boolean;
  totals: [string, number][];
  checks: string[];
};

function ScenarioPanel({ cr, aiConnected, readOnly }: { cr: ChangeRequest; aiConnected: boolean; readOnly: boolean }) {
  const invalidate = useInvalidateAll();
  const [picking, setPicking] = useState(false);
  const docs = useQuery({ queryKey: ['documents', cr.id, false], queryFn: () => api.get<SourceDocument[]>(`/api/crs/${cr.id}/documents`) });
  const tasks = useQuery({
    queryKey: ['tasks', cr.id],
    queryFn: () => api.get<AgentTask[]>(`/api/crs/${cr.id}/tasks`),
    refetchInterval: (q) => (q.state.data?.some((t) => t.status === 'QUEUED' || t.status === 'RUNNING') ? 2000 : false),
  });
  const artifacts = useQuery({ queryKey: ['artifacts', cr.id], queryFn: () => api.get<Artifact[]>(`/api/crs/${cr.id}/artifacts`) });
  const latest = tasks.data?.find((t) => t.agent === 'SCENARIO_ANALYST');
  const active = latest && (latest.status === 'QUEUED' || latest.status === 'RUNNING');
  const out = latest?.output as unknown as ScenarioOutput | null;

  // When a run finishes, refresh artifacts and history everywhere.
  const prev = useRef<string | undefined>(undefined);
  useEffect(() => {
    const key = latest ? `${latest.id}:${latest.status}` : undefined;
    if (prev.current && key !== prev.current && latest && !active) {
      invalidate();
      if (latest.status === 'COMPLETED') toast.success(`Test scenarios ready: ${(latest.output as unknown as ScenarioOutput)?.fileName}`);
      if (latest.status === 'FAILED') toast.error('Test scenario generation failed. See the details in the panel.');
    }
    prev.current = key;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latest?.id, latest?.status]);

  const run = useMutation({
    mutationFn: (documentIds: string[]) => api.post<AgentTask>(`/api/crs/${cr.id}/generate-scenarios`, { documentIds }),
    onSuccess: () => {
      setPicking(false);
      invalidate();
      toast.success('Test scenario generation started');
    },
  });
  const cancel = useMutation({ mutationFn: (id: string) => api.post<AgentTask>(`/api/tasks/${id}/cancel`), onSuccess: () => invalidate(), onError: (e) => toast.error(e.message) });

  const blocked = !aiConnected ? 'AI is not connected.' : readOnly ? 'The CR is archived.' : !docs.data?.length ? 'Upload at least one document first.' : active ? 'Generation is already running.' : null;
  const versions = artifacts.data?.filter((a) => a.artifactType === 'SCENARIOS_XLSX') ?? [];
  const total = (label: string) => out?.totals.find(([k]) => k === label)?.[1] ?? 0;

  return (
    <Panel
      title="QA test scenarios (Excel)"
      id="scenarios"
      className="mt-6"
      actions={
        <Button variant="primary" onClick={() => setPicking(true)} disabled={Boolean(blocked)} title={blocked ?? undefined} data-testid="generate-scenarios">
          <FileSpreadsheet /> Generate test scenarios
        </Button>
      }
    >
      <div className="space-y-4 p-4">
        <p className="text-[13.5px] text-ink-2">
          Analyses the CR / FRS with your QA prompt (test dimensions, decision tables, status / role / WIP / before–after coverage) and builds an execution-ready workbook: Test Scenarios, Decision Table, Requirement Coverage, Clarification Required, Scenario Summary, WIP and Enhancement coverage. Scenario IDs, cross-references and summary counts are checked by the app.
        </p>
        {blocked && !active && (
          <p className="text-[13px] text-ink-3" data-testid="scenarios-blocked">
            {blocked}
          </p>
        )}
        {latest && (
          <div className="rounded-md border border-line" data-testid="scenario-task">
            <div className="flex flex-wrap items-center gap-3 border-b border-line px-3 py-2 text-[13px]">
              <StatusBadge status={latest.status} />
              <span className="text-ink-2">Started {timeAgo(latest.createdAt)}</span>
              {latest.model && <span className="text-ink-3">{latest.model}</span>}
              {active && (
                <Button size="sm" variant="ghost" className="ml-auto" onClick={() => cancel.mutate(latest.id)} loading={cancel.isPending}>
                  <Square /> Cancel
                </Button>
              )}
              {latest.status === 'COMPLETED' && out && (
                <a href={`/api/artifacts/${out.artifactId}/download`} download className={cn(buttonVariants({ variant: 'primary', size: 'sm' }), 'ml-auto')} data-testid="download-scenarios">
                  <Download /> Download {out.fileName}
                </a>
              )}
            </div>
            <div className="space-y-3 px-3 py-3 text-[13.5px]">
              {active && (
                <div>
                  <div className="h-1.5 overflow-hidden rounded bg-line" role="progressbar" aria-valuenow={latest.progress} aria-valuemin={0} aria-valuemax={100} aria-label="Scenario generation progress">
                    <div className="h-full bg-signal transition-all" style={{ width: `${Math.max(latest.progress, 3)}%` }} />
                  </div>
                  <p className="mt-1.5 text-[13px] text-ink-2">{latest.progressMessage}</p>
                </div>
              )}
              {latest.status === 'FAILED' && latest.error && <ErrorNotice error={new Error(latest.error)} />}
              {latest.status === 'CANCELLED' && <p className="text-ink-2">{latest.error ?? 'Cancelled. Nothing was saved.'}</p>}
              {latest.status === 'COMPLETED' && out && (
                <>
                  <p>
                    <strong>{out.scenarioCount}</strong> scenarios · {total('Total Decision Table combinations')} decision-table combinations ({total('TBD combinations')} TBD) · <strong>{out.clarificationCount}</strong> clarifications · WIP {out.wipApplicable ? 'applicable' : 'N/A'} · Before/after {out.enhancementApplicable ? 'applicable' : 'N/A'}
                  </p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-ink-2">
                    {out.totals
                      .slice(1, 14)
                      .filter(([, n]) => n > 0)
                      .map(([k, n]) => (
                        <span key={k}>
                          {k.replace(' scenarios', '')}: {n}
                        </span>
                      ))}
                  </div>
                  {out.checks.length > 0 && (
                    <details>
                      <summary className="cursor-pointer text-[13px] font-medium text-attn">{out.checks.length} point(s) for you to review (also in the QA Self-Review sheet)</summary>
                      <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px] text-ink-2">
                        {out.checks.map((c) => (
                          <li key={c}>{c}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </>
              )}
            </div>
          </div>
        )}
        {versions.length > 1 && (
          <details className="text-[13px]">
            <summary className="cursor-pointer text-ink-2 hover:text-ink">All versions ({versions.length})</summary>
            <ul className="mt-2 divide-y divide-line rounded-md border border-line">
              {versions.map((a) => (
                <li key={a.id} className="flex items-center gap-3 px-3 py-2">
                  <span className="flex-1 truncate">{a.fileName}</span>
                  <span className="text-ink-3">{formatDateTime(a.createdAt)}</span>
                  <a href={`/api/artifacts/${a.id}/download`} download className={buttonVariants({ size: 'sm' })} aria-label={`Download ${a.fileName}`}>
                    <Download />
                  </a>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
      <PickDocumentsDialog
        open={picking}
        onOpenChange={setPicking}
        title="Generate test scenarios from which documents?"
        note="A full FRS can take 5–15 minutes. Each run saves a new workbook version."
        documents={docs.data ?? []}
        textOnly={false}
        loading={run.isPending}
        error={run.error}
        onRun={(ids) => run.mutate(ids)}
      />
    </Panel>
  );
}

// ───────────────────────── Scenario review ─────────────────────────

const REVIEW_FILTERS: { value: '' | ReviewStatus; label: string }[] = [
  { value: '', label: 'All statuses' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'CLARIFICATION_REQUIRED', label: 'Clarification required' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
];

function ScenarioReview({ cr, readOnly }: { cr: ChangeRequest; readOnly: boolean }) {
  const invalidate = useInvalidateAll();
  const [workbookId, setWorkbookId] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'' | ReviewStatus>('');
  const [type, setType] = useState<'' | ScenarioType>('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const versions = useQuery({ queryKey: ['scenario-workbooks', cr.id], queryFn: () => api.get<WorkbookVersion[]>(`/api/crs/${cr.id}/scenario-workbooks`) });
  const current = versions.data?.find((v) => v.id === workbookId) ?? versions.data?.[0];
  useEffect(() => setSelected(new Set()), [current?.id]);

  const qs = new URLSearchParams({ ...(current ? { workbookId: current.id } : {}), ...(status ? { reviewStatus: status } : {}), ...(type ? { type } : {}), ...(search ? { search } : {}) }).toString();
  const list = useQuery({
    queryKey: ['scenarios', cr.id, current?.id, status, type, search],
    queryFn: () => api.get<{ workbook: WorkbookVersion | null; scenarios: TestScenario[] }>(`/api/crs/${cr.id}/scenarios?${qs}`),
    enabled: Boolean(current),
    placeholderData: (prev) => prev,
  });
  const all = useQuery({
    queryKey: ['scenarios', cr.id, current?.id, 'all'],
    queryFn: () => api.get<{ scenarios: TestScenario[] }>(`/api/crs/${cr.id}/scenarios?workbookId=${current!.id}`),
    enabled: Boolean(current),
  });
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const s of all.data?.scenarios ?? []) c[s.reviewStatus] = (c[s.reviewStatus] ?? 0) + 1;
    return c;
  }, [all.data]);

  const bulk = useMutation({
    mutationFn: (s: ReviewStatus) => api.post<{ updated: number }>(`/api/scenario-workbooks/${current!.id}/review`, { ids: [...selected], status: s }),
    onSuccess: (r, s) => {
      invalidate();
      setSelected(new Set());
      toast.success(`${r.updated} scenario(s) ${humanize(s).toLowerCase()}`);
    },
    onError: (e) => toast.error(e.message),
  });
  const exp = useMutation({
    mutationFn: (scope: 'all' | 'approved') => api.post<Artifact>(`/api/scenario-workbooks/${current!.id}/export`, { scope }),
    onSuccess: (a) => {
      invalidate();
      toast.success(`${a.fileName} is ready`);
      const link = document.createElement('a');
      link.href = `/api/artifacts/${a.id}/download`;
      link.download = a.fileName;
      document.body.append(link);
      link.click();
      link.remove();
    },
    onError: (e) => toast.error(e.message),
  });

  if (versions.isPending) return null;
  if (!current) {
    return (
      <Panel title="Test scenarios" id="scenario-review" className="mt-6">
        <EmptyState icon={<ListChecks />} title="No test scenarios yet" body="Click Generate test scenarios above. The scenarios appear here to review, edit and approve." />
      </Panel>
    );
  }

  const rows = list.data?.scenarios ?? [];
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggle = (id: string) => setSelected((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : new Set([...s, id])));
  const latest = versions.data?.[0]?.id === current.id;

  return (
    <Panel
      title={`Test scenarios (${current.scenarioCount})`}
      id="scenario-review"
      className="mt-6"
      actions={
        <>
          {(versions.data?.length ?? 0) > 1 && (
            <Select aria-label="Workbook version" className="w-auto" value={current.id} onChange={(e) => setWorkbookId(e.target.value)}>
              {versions.data!.map((v, i) => (
                <option key={v.id} value={v.id}>
                  Run v{v.version} · {formatDateTime(v.createdAt)}
                  {i === 0 ? ' (latest)' : ''}
                </option>
              ))}
            </Select>
          )}
          {!readOnly && (
            <Button onClick={() => setCreating(true)}>
              <Plus /> Add scenario
            </Button>
          )}
          <Button variant="primary" onClick={() => exp.mutate('all')} loading={exp.isPending && exp.variables === 'all'} data-testid="export-scenarios">
            <FileSpreadsheet /> Export Excel
          </Button>
          <Button onClick={() => exp.mutate('approved')} loading={exp.isPending && exp.variables === 'approved'} disabled={!counts.APPROVED}>
            Export approved only
          </Button>
        </>
      }
    >
      {!latest && <p className="border-b border-line bg-surface-2 px-4 py-2 text-[13px] text-ink-2">You are looking at an older run. The latest run is used for counts on the dashboard.</p>}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line px-4 py-2 text-[13px] text-ink-2" data-testid="scenario-counts">
        <span>{counts.APPROVED ?? 0} approved</span>
        <span>{counts.PENDING ?? 0} pending</span>
        <span>{counts.CLARIFICATION_REQUIRED ?? 0} need clarification</span>
        <span>{counts.REJECTED ?? 0} rejected</span>
        <span className="text-ink-3">Exports include every edit and review decision (Review Status column).</span>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-ink-3" aria-hidden />
          <Input aria-label="Search scenarios" placeholder="Search ID, description, screen" value={search} onChange={(e) => setSearch(e.target.value)} className="w-60 pl-8" />
        </div>
        <Select aria-label="Filter by review status" value={status} onChange={(e) => setStatus(e.target.value as '' | ReviewStatus)} className="w-auto">
          {REVIEW_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </Select>
        <Select aria-label="Filter by scenario type" value={type} onChange={(e) => setType(e.target.value as '' | ScenarioType)} className="w-auto">
          <option value="">All types</option>
          {SCENARIO_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </Select>
        {!readOnly && selected.size > 0 && (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <span className="text-[13px] text-ink-2">{selected.size} selected</span>
            <Button size="sm" variant="primary" onClick={() => bulk.mutate('APPROVED')} loading={bulk.isPending && bulk.variables === 'APPROVED'}>
              <CheckCircle2 /> Approve
            </Button>
            <Button size="sm" onClick={() => bulk.mutate('CLARIFICATION_REQUIRED')} loading={bulk.isPending && bulk.variables === 'CLARIFICATION_REQUIRED'}>
              <ShieldAlert /> Needs clarification
            </Button>
            <Button size="sm" onClick={() => bulk.mutate('REJECTED')} loading={bulk.isPending && bulk.variables === 'REJECTED'}>
              <XCircle /> Reject
            </Button>
          </div>
        )}
      </div>

      {list.isError ? (
        <div className="p-4">
          <ErrorNotice error={list.error} onRetry={() => list.refetch()} />
        </div>
      ) : list.isPending ? (
        <div className="p-4">
          <Skeleton className="h-24" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState icon={<ListChecks />} title="No scenarios match these filters" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-[13.5px]" data-testid="scenarios-table">
            <thead>
              <tr className="border-b border-line bg-surface-2 text-[12.5px] text-ink-2">
                <th scope="col" className="h-9 w-10 px-4">
                  {!readOnly && <input type="checkbox" aria-label="Select all shown" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))} className="accent-[var(--signal)]" />}
                </th>
                <th scope="col" className="px-2 font-medium">ID</th>
                <th scope="col" className="px-2 font-medium">Scenario & expected result</th>
                <th scope="col" className="px-2 font-medium">Type</th>
                <th scope="col" className="px-2 font-medium">Screen / role</th>
                <th scope="col" className="px-2 font-medium">Priority</th>
                <th scope="col" className="px-2 font-medium">Source</th>
                <th scope="col" className="px-2 font-medium">Status</th>
                <th scope="col" className="w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.id} className="cursor-pointer align-top hover:bg-surface-2" onClick={() => setOpenId(r.id)}>
                  <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                    {!readOnly && <input type="checkbox" aria-label={`Select ${r.scenarioCode}`} checked={selected.has(r.id)} onChange={() => toggle(r.id)} className="accent-[var(--signal)]" />}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2.5 font-medium">
                    <button className="hover:underline" onClick={() => setOpenId(r.id)}>
                      {r.scenarioCode}
                    </button>
                  </td>
                  <td className="max-w-[420px] px-2 py-2.5">
                    <p className="line-clamp-2">{r.description ?? r.title}</p>
                    {r.expectedResult && <p className="mt-0.5 line-clamp-2 text-[12.5px] text-ink-3">→ {r.expectedResult}</p>}
                  </td>
                  <td className="max-w-[160px] px-2 py-2.5 text-[12.5px] text-ink-2">{r.testType || '—'}</td>
                  <td className="max-w-[180px] px-2 py-2.5 text-[12.5px] text-ink-2">{[r.functionScreen, r.userRole].filter(Boolean).join(' · ') || '—'}</td>
                  <td className="px-2 py-2.5 text-ink-2">{humanize(r.priority)}</td>
                  <td className="max-w-[200px] px-2 py-2.5">
                    {r.sourceReference ? (
                      <>
                        <span className="line-clamp-2 text-[12.5px]">{r.sourceReference.replace(/^.*› /, '')}</span>
                        {r.origin === 'AI' &&
                          (isPictureSource(r.sourceReference) ? (
                            <span className="text-[12px] font-medium text-attn">from a picture</span>
                          ) : r.sourceVerified ? (
                            <span className="text-[12px] text-signal">quote verified</span>
                          ) : (
                            <span className="text-[12px] font-medium text-attn">not verified</span>
                          ))}
                      </>
                    ) : (
                      <span className="text-ink-3">—</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2.5">
                    <ReviewBadge status={r.reviewStatus} />
                  </td>
                  <td className="pr-3 pt-3 text-ink-3">
                    <ChevronRight className="size-4" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ScenarioDialog open={Boolean(openId)} onOpenChange={(o) => !o && setOpenId(null)} scenarioId={openId} readOnly={readOnly} />
      <ScenarioDialog open={creating} onOpenChange={setCreating} workbookId={current.id} readOnly={false} />
    </Panel>
  );
}

// ───────────────────────── Document picker ─────────────────────────

function PickDocumentsDialog({
  open,
  onOpenChange,
  documents,
  textOnly,
  loading,
  error,
  onRun,
  title = 'Which documents should be analysed?',
  note,
}: {
  title?: string;
  note?: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  documents: SourceDocument[];
  textOnly: boolean;
  loading: boolean;
  error: unknown;
  onRun: (ids: string[]) => void;
}) {
  // Pictures go to Claude with both engines now; kept as a hook in case an engine can't take them.
  const usable = (_d: SourceDocument) => true;
  void textOnly;
  const [picked, setPicked] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (open) setPicked(new Set(documents.filter(usable).map((d) => d.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, documents]);
  const toggle = (id: string) => setPicked((p) => (p.has(id) ? new Set([...p].filter((x) => x !== id)) : new Set([...p, id])));

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description="Tick the documents to send to Claude. Pictures inside them (e.g. before/after screens) are sent too."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => onRun([...picked])} disabled={picked.size === 0} loading={loading} data-testid="start-analysis">
            <Play /> Analyse {picked.size} document{picked.size === 1 ? '' : 's'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {error ? <ErrorNotice error={error} /> : null}
        <ul className="divide-y divide-line rounded-md border border-line" data-testid="pick-documents">
          {documents.map((d) => (
            <li key={d.id}>
              <label className={cn('flex cursor-pointer items-center gap-3 px-3 py-2.5', !usable(d) && 'cursor-not-allowed opacity-60')}>
                <input type="checkbox" className="accent-[var(--signal)]" checked={picked.has(d.id)} onChange={() => toggle(d.id)} disabled={!usable(d)} aria-label={`Analyse ${d.originalName}`} />
                <span className="flex h-7 w-10 shrink-0 items-center justify-center rounded border border-line bg-surface-2 text-[11px] font-semibold text-ink-2">{d.fileType}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {d.originalName} <span className="font-normal text-ink-3">v{d.version}</span>
                  </span>
                  <span className="block text-[12px] text-ink-3">
                    {formatBytes(d.sizeBytes)}, uploaded {formatDateTime(d.createdAt)}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
        {note && <p className="text-[13px] text-ink-2">{note}</p>}
      </div>
    </Dialog>
  );
}

// ───────────────────────── Extracted text preview ─────────────────────────

function ExtractionPanel({ crId }: { crId: string }) {
  const [show, setShow] = useState(false);
  const x = useQuery({ queryKey: ['extraction', crId], queryFn: () => api.get<DocumentExtraction[]>(`/api/crs/${crId}/extraction`), enabled: show });
  return (
    <Panel
      title="Extracted document text"
      id="extraction"
      className="mt-6"
      actions={
        <Button size="sm" onClick={() => setShow((s) => !s)} aria-expanded={show}>
          {show ? 'Hide' : 'Show what the analyst reads'}
        </Button>
      }
    >
      {!show ? (
        <p className="px-4 py-3 text-[13px] text-ink-2">The exact text and reference labels (page, section, cell) sent to the analyst. Use it to check a source or spot a document that didn't extract well.</p>
      ) : x.isError ? (
        <div className="p-4">
          <ErrorNotice error={x.error} onRetry={() => x.refetch()} />
        </div>
      ) : x.isPending ? (
        <div className="p-4">
          <Skeleton className="h-16" />
        </div>
      ) : x.data.length === 0 ? (
        <EmptyState icon={<FileText />} title="No active documents" body="Upload documents on the CR page." />
      ) : (
        <div className="divide-y divide-line" data-testid="extraction-list">
          {x.data.map((d) => (
            <details key={d.documentId} className="group px-4 py-3">
              <summary className="flex cursor-pointer flex-wrap items-center gap-2">
                <ChevronRight className="size-4 text-ink-3 transition-transform group-open:rotate-90" aria-hidden />
                <span className="font-medium">
                  {d.name} <span className="font-normal text-ink-3">v{d.version}</span>
                </span>
                <span className="text-[12.5px] text-ink-3">
                  {d.image ? 'image' : `${d.segments.length} segment(s), ${d.charCount.toLocaleString()} characters${d.images.length ? `, ${d.images.length} picture(s)` : ''}`}
                </span>
                {d.warnings.length > 0 && <span className="text-[12.5px] text-attn">{d.warnings.length} warning(s)</span>}
              </summary>
              {d.notes.length > 0 && (
                <ul className="mt-2 pl-10 text-[13px] text-ink-2" data-testid="extraction-notes">
                  {d.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              )}
              {d.warnings.length > 0 && (
                <ul className="mt-2 list-disc pl-10 text-[13px] text-attn" data-testid="extraction-warnings">
                  {d.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              )}
              {d.images.length > 0 && (
                <div className="mt-2 pl-6" data-testid="extraction-pictures">
                  <p className="mb-1.5 text-[12.5px] text-ink-2">Pictures sent to the AI with the text ({d.images.length})</p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                    {d.images.map((p) => (
                      <a key={p.n} href={`/api/documents/${d.documentId}/images/${p.n}`} target="_blank" rel="noreferrer" className="block rounded border border-line hover:border-signal">
                        <img src={`/api/documents/${d.documentId}/images/${p.n}`} alt={`${p.ref} in ${p.context}`} loading="lazy" className="h-28 w-full rounded-t object-cover object-top" />
                        <span className="block px-2 py-1 text-[12px] text-ink-2">
                          <span className="font-medium text-ink">{p.ref}</span> · {formatBytes(p.sizeBytes)}
                        </span>
                      </a>
                    ))}
                  </div>
                </div>
              )}
              <div className="mt-2 max-h-[420px] space-y-2 overflow-y-auto pl-6">
                {d.segments.map((s, i) => (
                  <div key={i} className="rounded border border-line">
                    <p className="border-b border-line bg-surface-2 px-2 py-1 font-mono text-[12px] text-ink-2">{s.ref}</p>
                    <p className={cn('whitespace-pre-wrap px-2 py-1.5 text-[13px]')}>{s.text}</p>
                  </div>
                ))}
              </div>
            </details>
          ))}
        </div>
      )}
    </Panel>
  );
}
