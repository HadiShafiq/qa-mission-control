import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2, Copy, RotateCcw, ShieldAlert, XCircle } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { useInvalidateAll } from '@/components/forms';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { ErrorNotice, Skeleton, StatusBadge } from '@/components/ui/misc';
import { ApiError, SCENARIO_TYPES, api, isPictureSource, type Priority, type ReviewStatus, type ScenarioRevision, type ScenarioType, type TestScenario } from '@/lib/api';
import { cn, formatDateTime, humanize } from '@/lib/utils';

export function ReviewBadge({ status }: { status: ReviewStatus }) {
  return <StatusBadge status={status === 'APPROVED' ? 'REVIEW_APPROVED' : status} label={humanize(status)} />;
}

const TEXT_FIELDS = [
  ['requirementRef', 'Requirement / CR Reference'],
  ['module', 'Module'],
  ['functionScreen', 'Function / Screen'],
  ['enhancementState', 'Enhancement State'],
  ['transactionState', 'Transaction / Workflow State'],
  ['workflowStatus', 'Status'],
  ['userRole', 'Role'],
  ['confirmation', 'Confirmation / Decision'],
] as const;
const LONG_FIELDS = [
  ['businessCondition', 'Business Condition'],
  ['existingValue', 'Existing Value / Condition'],
  ['actionChange', 'Action / Change'],
  ['testData', 'Test Data / Precondition'],
  ['expectedResult', 'Expected Result'],
  ['remarks', 'Remarks'],
] as const;
type TextKey = (typeof TEXT_FIELDS)[number][0] | (typeof LONG_FIELDS)[number][0] | 'description' | 'sourceReference';
type Form = Record<TextKey, string> & { priority: Priority; regression: boolean; testType: ScenarioType[] };

const TYPE_SET = new Set<string>(SCENARIO_TYPES);
const typesOf = (s: string | null) =>
  (s ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter((t): t is ScenarioType => TYPE_SET.has(t));

const EMPTY: Form = {
  description: '',
  requirementRef: '',
  module: '',
  functionScreen: '',
  enhancementState: '',
  transactionState: '',
  workflowStatus: '',
  userRole: '',
  confirmation: '',
  businessCondition: '',
  existingValue: '',
  actionChange: '',
  testData: '',
  expectedResult: '',
  remarks: '',
  sourceReference: '',
  priority: 'MEDIUM',
  regression: false,
  testType: [],
};
const toForm = (s: TestScenario): Form => ({
  ...(Object.fromEntries(Object.keys(EMPTY).map((k) => [k, (s as unknown as Record<string, unknown>)[k] ?? ''])) as unknown as Form),
  description: s.description ?? s.title,
  priority: s.priority,
  regression: s.regression,
  testType: typesOf(s.testType),
});

function fieldErrors(err: unknown): Record<string, string> {
  if (!(err instanceof ApiError) || !err.details) return {};
  return Object.fromEntries(err.details.map((d) => [d.field, d.message]));
}

/** Edit / review one scenario (scenarioId), or add one to a workbook (workbookId). */
export function ScenarioDialog({
  open,
  onOpenChange,
  scenarioId,
  workbookId,
  readOnly,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  scenarioId?: string | null;
  workbookId?: string;
  readOnly: boolean;
}) {
  const creating = !scenarioId;
  const invalidate = useInvalidateAll();
  const [tab, setTab] = useState<'details' | 'revisions'>('details');
  const [form, setForm] = useState<Form>(EMPTY);
  const [comment, setComment] = useState('');

  const q = useQuery({ queryKey: ['scenario', scenarioId], queryFn: () => api.get<TestScenario>(`/api/scenarios/${scenarioId}`), enabled: open && !creating });
  const s = q.data;

  const save = useMutation({
    mutationFn: () => (creating ? api.post<TestScenario>(`/api/scenario-workbooks/${workbookId}/scenarios`, form) : api.patch<TestScenario>(`/api/scenarios/${scenarioId}`, form)),
    onSuccess: (saved) => {
      invalidate();
      if (creating) {
        toast.success(`${saved.scenarioCode} added`);
        onOpenChange(false);
      } else toast.success(s?.reviewStatus === 'APPROVED' ? `Saved revision ${saved.revision}. It needs approving again.` : `Saved revision ${saved.revision}`);
    },
  });
  const review = useMutation({
    mutationFn: (status: ReviewStatus) => api.post<TestScenario>(`/api/scenarios/${scenarioId}/review`, { status, comment }),
    onSuccess: (saved) => {
      invalidate();
      toast.success(`${saved.scenarioCode}: ${humanize(saved.reviewStatus).toLowerCase()}`);
    },
    onError: (e) => toast.error(e.message),
  });

  useEffect(() => {
    if (!open) return;
    setTab('details');
    if (creating) setForm(EMPTY);
    save.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, scenarioId]);
  useEffect(() => {
    if (s && open) {
      setForm(toForm(s));
      setComment(s.reviewComment ?? '');
    }
  }, [s, open]);

  const dirty = creating ? form.description.trim() !== '' : Boolean(s && JSON.stringify(toForm(s)) !== JSON.stringify(form));
  const errs = fieldErrors(save.error);
  const set = (k: TextKey) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const toggleType = (t: ScenarioType) => setForm((f) => ({ ...f, testType: f.testType.includes(t) ? f.testType.filter((x) => x !== t) : [...f.testType, t] }));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (dirty) save.mutate();
  };

  const copy = async () => {
    if (!s) return;
    const lines = [
      `${s.scenarioCode} — ${s.description ?? s.title}`,
      s.requirementRef && `Requirement: ${s.requirementRef}`,
      [s.module, s.functionScreen].filter(Boolean).length ? `Module / screen: ${[s.module, s.functionScreen].filter(Boolean).join(' › ')}` : null,
      s.testType && `Type: ${s.testType}`,
      s.testData && `Test data / precondition: ${s.testData}`,
      s.actionChange && `Action: ${s.actionChange}`,
      s.expectedResult && `Expected result: ${s.expectedResult}`,
      `Priority: ${humanize(s.priority)} · Status: ${humanize(s.reviewStatus)}`,
      s.sourceReference && `Source: ${s.sourceReference}${s.sourceVerified ? ' (quote verified)' : ''}`,
    ].filter(Boolean);
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      toast.success(`Copied ${s.scenarioCode}`);
    } catch {
      toast.error('The browser blocked clipboard access.');
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={creating ? 'Add test scenario' : s ? s.scenarioCode : 'Test scenario'}
      description={creating ? 'Add a scenario the analysis missed. It starts as Pending review.' : s ? `Revision ${s.revision} · ${s.origin === 'AI' ? 'Generated by the scenario analyst' : 'Added manually'}` : undefined}
      footer={
        tab === 'details' && !readOnly ? (
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              {dirty ? 'Cancel' : 'Close'}
            </Button>
            <Button variant="primary" type="submit" form="scenario-form" loading={save.isPending} disabled={!dirty}>
              {creating ? 'Add scenario' : 'Save changes'}
            </Button>
          </>
        ) : undefined
      }
    >
      {!creating && q.isError ? (
        <ErrorNotice error={q.error} />
      ) : !creating && !s ? (
        <Skeleton className="h-60" />
      ) : (
        <>
          {s && (
            <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-line pb-3">
              <div role="tablist" className="flex gap-1">
                {(['details', 'revisions'] as const).map((t) => (
                  <button
                    key={t}
                    role="tab"
                    aria-selected={tab === t}
                    onClick={() => setTab(t)}
                    className={cn('h-8 rounded-md px-3 text-[13px] font-medium text-ink-2 hover:bg-surface-2', tab === t && 'bg-signal-soft text-signal')}
                  >
                    {t === 'details' ? 'Details' : `Revisions (${s.revision})`}
                  </button>
                ))}
              </div>
              <ReviewBadge status={s.reviewStatus} />
              <Button size="sm" variant="ghost" className="ml-auto" onClick={copy}>
                <Copy /> Copy
              </Button>
            </div>
          )}

          {tab === 'revisions' && s ? (
            <RevisionCompare scenarioId={s.id} />
          ) : (
            <form id="scenario-form" onSubmit={submit} className="space-y-4">
              {save.error && !Object.keys(errs).length ? <ErrorNotice error={save.error} /> : null}

              {s?.origin === 'AI' && (
                <div className="space-y-1.5 rounded-md border border-line bg-surface-2 px-3 py-2.5 text-[13px]">
                  {isPictureSource(s.sourceReference) ? (
                    <p className="font-medium text-attn">From a picture in the document. Pictures can't be checked automatically, so compare it with the screenshot before approving.</p>
                  ) : (
                    <p className={s.sourceVerified ? 'text-signal' : 'font-medium text-attn'}>
                      {s.sourceVerified ? 'Source verified: the quote was found at this location in the document.' : 'Source not verified: the quote was not found in the cited document. Check it before approving.'}
                    </p>
                  )}
                  {s.sourceQuote && <blockquote className="border-l-2 border-line-strong pl-2 italic text-ink">“{s.sourceQuote}”</blockquote>}
                </div>
              )}

              <Field label="Test Scenario Description" required error={errs.description}>
                {(p) => <Textarea {...p} value={form.description} onChange={set('description')} disabled={readOnly} rows={2} autoFocus={creating} />}
              </Field>
              <Field label="Expected Result" error={errs.expectedResult}>
                {(p) => <Textarea {...p} value={form.expectedResult} onChange={set('expectedResult')} disabled={readOnly} rows={3} />}
              </Field>

              <fieldset>
                <legend className="mb-1.5 text-[13px] font-medium">Test Scenario Type</legend>
                <div className="flex flex-wrap gap-1.5">
                  {SCENARIO_TYPES.map((t) => (
                    <label key={t} className={cn('flex cursor-pointer items-center gap-1.5 rounded border px-2 py-1 text-[12.5px]', form.testType.includes(t) ? 'border-signal bg-signal-soft text-signal' : 'border-line text-ink-2')}>
                      <input type="checkbox" className="sr-only" checked={form.testType.includes(t)} onChange={() => toggleType(t)} disabled={readOnly} />
                      {t}
                    </label>
                  ))}
                </div>
              </fieldset>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {TEXT_FIELDS.map(([k, label]) => (
                  <Field key={k} label={label} error={errs[k]}>
                    {(p) => <Input {...p} value={form[k]} onChange={set(k)} disabled={readOnly} maxLength={300} />}
                  </Field>
                ))}
                <Field label="Priority">
                  {(p) => (
                    <Select {...p} value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value as Priority }))} disabled={readOnly}>
                      <option value="HIGH">High</option>
                      <option value="MEDIUM">Medium</option>
                      <option value="LOW">Low</option>
                    </Select>
                  )}
                </Field>
                <label className="flex items-center gap-2 self-end pb-2 text-[13.5px]">
                  <input type="checkbox" className="accent-[var(--signal)]" checked={form.regression} onChange={(e) => setForm((f) => ({ ...f, regression: e.target.checked }))} disabled={readOnly} />
                  Regression
                </label>
              </div>
              {LONG_FIELDS.filter(([k]) => k !== 'expectedResult').map(([k, label]) => (
                <Field key={k} label={label} error={errs[k]}>
                  {(p) => <Textarea {...p} value={form[k]} onChange={set(k)} disabled={readOnly} rows={2} />}
                </Field>
              ))}
              <Field label="Source reference" hint={s?.sourceVerified ? 'Editing the reference removes the "verified" mark.' : 'Document, section, table row or picture.'} error={errs.sourceReference}>
                {(p) => <Input {...p} value={form.sourceReference} onChange={set('sourceReference')} disabled={readOnly} maxLength={500} />}
              </Field>

              {s && !readOnly && (
                <div className="space-y-2 rounded-md border border-line px-3 py-3">
                  <p className="text-[13px] font-medium">Review</p>
                  <Field label="Review comment" hint="Optional. Saved with the decision, e.g. the question to ask the BA.">
                    {(p) => <Input {...p} value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} />}
                  </Field>
                  {dirty && <p className="text-[12.5px] text-ink-3">Save or cancel your edits before recording a decision.</p>}
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="primary" type="button" onClick={() => review.mutate('APPROVED')} disabled={dirty} loading={review.isPending && review.variables === 'APPROVED'}>
                      <CheckCircle2 /> Approve
                    </Button>
                    <Button size="sm" type="button" onClick={() => review.mutate('CLARIFICATION_REQUIRED')} disabled={dirty} loading={review.isPending && review.variables === 'CLARIFICATION_REQUIRED'}>
                      <ShieldAlert /> Needs clarification
                    </Button>
                    <Button size="sm" type="button" onClick={() => review.mutate('REJECTED')} disabled={dirty} loading={review.isPending && review.variables === 'REJECTED'}>
                      <XCircle /> Reject
                    </Button>
                    {s.reviewStatus !== 'PENDING' && (
                      <Button size="sm" variant="ghost" type="button" onClick={() => review.mutate('PENDING')} disabled={dirty} loading={review.isPending && review.variables === 'PENDING'}>
                        <RotateCcw /> Back to pending
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </form>
          )}
        </>
      )}
    </Dialog>
  );
}

const FIELD_LABELS: Record<string, string> = {
  description: 'Description',
  expectedResult: 'Expected Result',
  requirementRef: 'Requirement / CR Reference',
  module: 'Module',
  functionScreen: 'Function / Screen',
  testType: 'Type',
  enhancementState: 'Enhancement State',
  transactionState: 'Transaction / Workflow State',
  workflowStatus: 'Status',
  userRole: 'Role',
  businessCondition: 'Business Condition',
  existingValue: 'Existing Value / Condition',
  actionChange: 'Action / Change',
  confirmation: 'Confirmation / Decision',
  testData: 'Test Data / Precondition',
  priority: 'Priority',
  regression: 'Regression',
  remarks: 'Remarks',
  sourceReference: 'Source reference',
  reviewStatus: 'Review status',
  reviewComment: 'Review comment',
};

function show(v: unknown) {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  const s = String(v);
  return /^[A-Z_]+$/.test(s) ? humanize(s) : s;
}

function RevisionCompare({ scenarioId }: { scenarioId: string }) {
  const revs = useQuery({ queryKey: ['scenario-revisions', scenarioId], queryFn: () => api.get<ScenarioRevision[]>(`/api/scenarios/${scenarioId}/revisions`) });
  const [a, setA] = useState<number | null>(null);
  const [b, setB] = useState<number | null>(null);
  useEffect(() => {
    if (revs.data?.length) {
      setB(revs.data[0].revision);
      setA(revs.data[Math.min(1, revs.data.length - 1)].revision);
    }
  }, [revs.data]);
  const left = revs.data?.find((r) => r.revision === a);
  const right = revs.data?.find((r) => r.revision === b);
  const fields = useMemo(() => Object.keys(FIELD_LABELS), []);

  if (revs.isError) return <ErrorNotice error={revs.error} />;
  if (!revs.data) return <Skeleton className="h-40" />;
  return (
    <div className="space-y-4">
      <ol className="divide-y divide-line rounded-md border border-line text-[13px]" data-testid="revision-list">
        {revs.data.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
            <span className="font-medium">Rev {r.revision}</span>
            <span className="text-ink-2">{r.changeNote ?? 'Changed'}</span>
            <span className="ml-auto text-ink-3">
              {r.createdBy}, {formatDateTime(r.createdAt)}
            </span>
          </li>
        ))}
      </ol>
      {revs.data.length > 1 ? (
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2 text-[13px]">
            <span>Compare</span>
            <Select aria-label="Older revision" className="w-auto" value={a ?? ''} onChange={(e) => setA(Number(e.target.value))}>
              {revs.data.map((r) => (
                <option key={r.id} value={r.revision}>
                  Rev {r.revision}
                </option>
              ))}
            </Select>
            <span>with</span>
            <Select aria-label="Newer revision" className="w-auto" value={b ?? ''} onChange={(e) => setB(Number(e.target.value))}>
              {revs.data.map((r) => (
                <option key={r.id} value={r.revision}>
                  Rev {r.revision}
                </option>
              ))}
            </Select>
          </div>
          {left && right && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px]" data-testid="revision-compare">
                <thead>
                  <tr className="border-b border-line bg-surface-2 text-ink-2">
                    <th className="px-2 py-1.5 font-medium">Field</th>
                    <th className="px-2 py-1.5 font-medium">Rev {left.revision}</th>
                    <th className="px-2 py-1.5 font-medium">Rev {right.revision}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {fields.map((f) => {
                    const changed = show(left.snapshot[f]) !== show(right.snapshot[f]);
                    return (
                      <tr key={f} className={cn(changed && 'bg-signal-soft')} data-changed={changed || undefined}>
                        <td className="whitespace-nowrap px-2 py-1.5 align-top text-ink-2">{FIELD_LABELS[f]}</td>
                        <td className={cn('px-2 py-1.5 align-top', changed && 'text-ink-2 line-through decoration-ink-3')}>{show(left.snapshot[f])}</td>
                        <td className={cn('px-2 py-1.5 align-top', changed && 'font-medium')}>{show(right.snapshot[f])}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <p className="text-[13px] text-ink-2">Only one revision so far. Edits and review decisions each add a revision you can compare here.</p>
      )}
    </div>
  );
}
