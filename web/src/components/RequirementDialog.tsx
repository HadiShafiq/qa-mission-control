import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2, Copy, RotateCcw, ShieldAlert, XCircle } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { useInvalidateAll } from '@/components/forms';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { ErrorNotice, Skeleton, StatusBadge } from '@/components/ui/misc';
import { ApiError, api, isPictureSource, type Classification, type Requirement, type RequirementRevision, type RequirementType, type ReviewStatus, type Risk } from '@/lib/api';
import { cn, formatDateTime, humanize } from '@/lib/utils';

export function ReviewBadge({ status }: { status: ReviewStatus }) {
  return <StatusBadge status={status === 'APPROVED' ? 'REVIEW_APPROVED' : status} label={humanize(status)} />;
}

type Form = {
  description: string;
  module: string;
  feature: string;
  requirementType: RequirementType;
  classification: Classification;
  businessRule: string;
  userRole: string;
  sourceReference: string;
  risk: Risk;
};

const EMPTY: Form = { description: '', module: '', feature: '', requirementType: 'FUNCTIONAL', classification: 'EXPLICIT', businessRule: '', userRole: '', sourceReference: '', risk: 'MEDIUM' };

const toForm = (r: Requirement): Form => ({
  description: r.description,
  module: r.module ?? '',
  feature: r.feature ?? '',
  requirementType: r.requirementType,
  classification: r.classification,
  businessRule: r.businessRule ?? '',
  userRole: r.userRole ?? '',
  sourceReference: r.sourceReference ?? '',
  risk: r.risk,
});

function fieldErrors(err: unknown): Record<string, string> {
  if (!(err instanceof ApiError) || !err.details) return {};
  return Object.fromEntries(err.details.map((d) => [d.field, d.message]));
}

/** Edit / review an existing requirement (requirementId) or create one (crId). */
export function RequirementDialog({
  open,
  onOpenChange,
  requirementId,
  crId,
  readOnly,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  requirementId?: string | null;
  crId?: string;
  readOnly: boolean;
}) {
  const creating = !requirementId;
  const invalidate = useInvalidateAll();
  const [tab, setTab] = useState<'details' | 'revisions'>('details');
  const [form, setForm] = useState<Form>(EMPTY);
  const [comment, setComment] = useState('');

  const q = useQuery({
    queryKey: ['requirement', requirementId],
    queryFn: () => api.get<Requirement & { crNumber: string }>(`/api/requirements/${requirementId}`),
    enabled: open && !creating,
  });
  const r = q.data;

  useEffect(() => {
    if (!open) return;
    setTab('details');
    if (creating) setForm(EMPTY);
    save.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, requirementId]);
  useEffect(() => {
    if (r && open) {
      setForm(toForm(r));
      setComment(r.reviewComment ?? '');
    }
  }, [r, open]);

  const dirty = creating ? form.description.trim() !== '' : Boolean(r && JSON.stringify(toForm(r)) !== JSON.stringify(form));

  const save = useMutation({
    mutationFn: () => (creating ? api.post<Requirement>(`/api/crs/${crId}/requirements`, form) : api.patch<Requirement>(`/api/requirements/${requirementId}`, form)),
    onSuccess: (saved) => {
      invalidate();
      if (creating) {
        toast.success(`${saved.requirementCode} added`);
        onOpenChange(false);
      } else toast.success(r?.reviewStatus === 'APPROVED' ? `Saved revision ${saved.revision}. It needs approving again.` : `Saved revision ${saved.revision}`);
    },
  });
  const review = useMutation({
    mutationFn: (status: ReviewStatus) => api.post<Requirement>(`/api/requirements/${requirementId}/review`, { status, comment }),
    onSuccess: (saved) => {
      invalidate();
      toast.success(`${saved.requirementCode}: ${humanize(saved.reviewStatus).toLowerCase()}`);
    },
    onError: (e) => toast.error(e.message),
  });

  const errs = fieldErrors(save.error);
  const set = <K extends keyof Form>(k: K) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value as Form[K] }));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (dirty) save.mutate();
  };

  const copy = async () => {
    if (!r) return;
    const text = [
      `${r.requirementCode} — ${r.description}`,
      r.module || r.feature ? `Module / feature: ${[r.module, r.feature].filter(Boolean).join(' › ')}` : null,
      `Type: ${humanize(r.requirementType)} · Classification: ${humanize(r.classification)} · Risk: ${humanize(r.risk)} · Status: ${humanize(r.reviewStatus)}`,
      r.businessRule ? `Business rule: ${r.businessRule}` : null,
      r.userRole ? `User role: ${r.userRole}` : null,
      r.sourceReference ? `Source: ${r.sourceReference}${r.sourceVerified ? ' (quote verified)' : ''}` : null,
      r.sourceQuote ? `Quote: "${r.sourceQuote}"` : null,
    ]
      .filter(Boolean)
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`Copied ${r.requirementCode}`);
    } catch {
      toast.error('The browser blocked clipboard access.');
    }
  };

  const disabled = readOnly;
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={creating ? 'Add requirement' : r ? `${r.requirementCode}` : 'Requirement'}
      description={creating ? 'Add a requirement the analysis missed. It starts as Pending review.' : r ? `Revision ${r.revision} · ${r.origin === 'AI' ? 'Extracted by the CR Analyst' : 'Added manually'}` : undefined}
      footer={
        tab === 'details' && !disabled ? (
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              {dirty ? 'Cancel' : 'Close'}
            </Button>
            <Button variant="primary" type="submit" form="requirement-form" loading={save.isPending} disabled={!dirty}>
              {creating ? 'Add requirement' : 'Save changes'}
            </Button>
          </>
        ) : undefined
      }
    >
      {!creating && q.isError ? (
        <ErrorNotice error={q.error} />
      ) : !creating && !r ? (
        <Skeleton className="h-60" />
      ) : (
        <>
          {!creating && r && (
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
                    {t === 'details' ? 'Details' : `Revisions (${r.revision})`}
                  </button>
                ))}
              </div>
              <ReviewBadge status={r.reviewStatus} />
              <Button size="sm" variant="ghost" className="ml-auto" onClick={copy}>
                <Copy /> Copy
              </Button>
            </div>
          )}

          {tab === 'revisions' && r ? (
            <RevisionCompare requirementId={r.id} />
          ) : (
            <form id="requirement-form" onSubmit={submit} className="space-y-4">
              {save.error && !Object.keys(errs).length ? <ErrorNotice error={save.error} /> : null}

              {r && (r.sourceQuote || r.rationale || r.origin === 'AI') && (
                <div className="space-y-1.5 rounded-md border border-line bg-surface-2 px-3 py-2.5 text-[13px]">
                  {r.origin === 'AI' &&
                    (isPictureSource(r.sourceReference) ? (
                      <p className="font-medium text-attn">From a picture in the document ({r.sourceReference?.split('› ').pop()}). Pictures can't be checked automatically, so compare it with the screenshot before approving.</p>
                    ) : (
                      <p className={r.sourceVerified ? 'text-signal' : 'font-medium text-attn'}>
                        {r.sourceVerified ? 'Source verified: the quote was found at this location in the document.' : 'Source not verified: the quote was not found in the cited document. Check it before approving.'}
                      </p>
                    ))}
                  {r.sourceQuote && (
                    <blockquote className="border-l-2 border-line-strong pl-2 italic text-ink">“{r.sourceQuote}”</blockquote>
                  )}
                  {r.rationale && <p className="text-ink-2">Analyst's reasoning: {r.rationale}</p>}
                </div>
              )}

              <Field label="Requirement description" required error={errs.description}>
                {(p) => <Textarea {...p} value={form.description} onChange={set('description')} disabled={disabled} rows={3} autoFocus={creating} />}
              </Field>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Module" error={errs.module}>
                  {(p) => <Input {...p} value={form.module} onChange={set('module')} disabled={disabled} maxLength={200} />}
                </Field>
                <Field label="Feature" error={errs.feature}>
                  {(p) => <Input {...p} value={form.feature} onChange={set('feature')} disabled={disabled} maxLength={200} />}
                </Field>
                <Field label="Requirement type">
                  {(p) => (
                    <Select {...p} value={form.requirementType} onChange={set('requirementType')} disabled={disabled}>
                      <option value="FUNCTIONAL">Functional</option>
                      <option value="NON_FUNCTIONAL">Non-functional</option>
                    </Select>
                  )}
                </Field>
                <Field label="Classification">
                  {(p) => (
                    <Select {...p} value={form.classification} onChange={set('classification')} disabled={disabled}>
                      <option value="EXPLICIT">Explicit</option>
                      <option value="INFERRED">Inferred</option>
                      <option value="ASSUMPTION">Assumption</option>
                      <option value="CLARIFICATION_REQUIRED">Clarification required</option>
                    </Select>
                  )}
                </Field>
                <Field label="User role" error={errs.userRole}>
                  {(p) => <Input {...p} value={form.userRole} onChange={set('userRole')} disabled={disabled} maxLength={200} />}
                </Field>
                <Field label="Risk">
                  {(p) => (
                    <Select {...p} value={form.risk} onChange={set('risk')} disabled={disabled}>
                      <option value="LOW">Low</option>
                      <option value="MEDIUM">Medium</option>
                      <option value="HIGH">High</option>
                    </Select>
                  )}
                </Field>
              </div>
              <Field label="Business rule" error={errs.businessRule}>
                {(p) => <Textarea {...p} value={form.businessRule} onChange={set('businessRule')} disabled={disabled} rows={2} />}
              </Field>
              <Field label="Source reference" hint={r?.sourceVerified ? 'Editing the reference removes the "verified" mark.' : 'Document, page, section or cell.'} error={errs.sourceReference}>
                {(p) => <Input {...p} value={form.sourceReference} onChange={set('sourceReference')} disabled={disabled} maxLength={500} />}
              </Field>

              {r && !disabled && (
                <div className="space-y-2 rounded-md border border-line px-3 py-3">
                  <p className="text-[13px] font-medium">Review</p>
                  <Field label="Review comment" hint="Optional. Saved with the decision, e.g. the question to ask the business.">
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
                    {r.reviewStatus !== 'PENDING' && (
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
  module: 'Module',
  feature: 'Feature',
  requirementType: 'Type',
  classification: 'Classification',
  businessRule: 'Business rule',
  userRole: 'User role',
  sourceReference: 'Source reference',
  sourceQuote: 'Source quote',
  sourceVerified: 'Source verified',
  risk: 'Risk',
  reviewStatus: 'Review status',
  reviewComment: 'Review comment',
};

function show(v: unknown) {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  const s = String(v);
  return /^[A-Z_]+$/.test(s) ? humanize(s) : s;
}

function RevisionCompare({ requirementId }: { requirementId: string }) {
  const revs = useQuery({ queryKey: ['requirement-revisions', requirementId], queryFn: () => api.get<RequirementRevision[]>(`/api/requirements/${requirementId}/revisions`) });
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
