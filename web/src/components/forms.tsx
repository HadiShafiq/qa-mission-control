import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { ErrorNotice } from '@/components/ui/misc';
import { ApiError, api, type AnalysisStatus, type ChangeRequest, type Environment, type ProgressStatus, type Project } from '@/lib/api';

function fieldErrors(err: unknown): Record<string, string> {
  if (!(err instanceof ApiError) || !err.details) return {};
  return Object.fromEntries(err.details.map((d) => [d.field, d.message]));
}

/** Refresh everything that could show changed counts. */
export function useInvalidateAll() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries();
}

// ───────────────────────── Project ─────────────────────────

export function ProjectDialog({ open, onOpenChange, project }: { open: boolean; onOpenChange: (o: boolean) => void; project?: Project }) {
  const editing = Boolean(project);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const invalidate = useInvalidateAll();
  const navigate = useNavigate();

  useEffect(() => {
    if (open) {
      setCode(project?.code ?? '');
      setName(project?.name ?? '');
      setDescription(project?.description ?? '');
      m.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, project]);

  const m = useMutation({
    mutationFn: () =>
      editing ? api.patch<Project>(`/api/projects/${project!.id}`, { name, description }) : api.post<Project>('/api/projects', { code, name, description }),
    onSuccess: (p) => {
      invalidate();
      onOpenChange(false);
      toast.success(editing ? 'Project saved' : `Project ${p.code} created`);
      if (!editing) navigate(`/projects/${p.id}`);
    },
  });
  const errs = fieldErrors(m.error);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    m.mutate();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? 'Edit project' : 'New project'}
      description={editing ? undefined : 'A project groups the change requests, environments and documents for one system.'}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="project-form" loading={m.isPending}>
            {editing ? 'Save changes' : 'Create project'}
          </Button>
        </>
      }
    >
      <form id="project-form" onSubmit={submit} className="space-y-4">
        {m.error && !Object.keys(errs).length ? <ErrorNotice error={m.error} /> : null}
        <Field label="Project code" required hint={editing ? 'The code is permanent so IDs stay stable.' : 'Short and unique, e.g. EPERMIT. Used as a prefix in IDs.'} error={errs.code}>
          {(p) => <Input {...p} name="code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} disabled={editing} maxLength={30} autoFocus={!editing} />}
        </Field>
        <Field label="Project name" required error={errs.name}>
          {(p) => <Input {...p} name="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoFocus={editing} />}
        </Field>
        <Field label="Description" error={errs.description}>
          {(p) => <Textarea {...p} name="description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />}
        </Field>
      </form>
    </Dialog>
  );
}

// ───────────────────────── Change request ─────────────────────────

export const ANALYSIS_OPTIONS: { value: AnalysisStatus; label: string }[] = [
  { value: 'NOT_STARTED', label: 'Not started' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'ANALYSED', label: 'Analysed' },
  { value: 'APPROVED', label: 'Approved' },
];
const PROGRESS_OPTIONS: { value: ProgressStatus; label: string }[] = [
  { value: 'NOT_STARTED', label: 'Not started' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'COMPLETED', label: 'Completed' },
];

export function CrDialog({
  open,
  onOpenChange,
  projectId,
  cr,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  projectId?: string;
  cr?: ChangeRequest;
}) {
  const editing = Boolean(cr);
  const [form, setForm] = useState({
    projectId: projectId ?? '',
    crNumber: '',
    title: '',
    description: '',
    version: '1.0',
    analysisStatus: 'NOT_STARTED' as AnalysisStatus,
    automationStatus: 'NOT_STARTED' as ProgressStatus,
    evidenceStatus: 'NOT_STARTED' as ProgressStatus,
  });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const invalidate = useInvalidateAll();
  const navigate = useNavigate();

  const projects = useQuery({
    queryKey: ['projects', 'active', ''],
    queryFn: () => api.get<Project[]>('/api/projects'),
    enabled: open && !projectId && !editing,
  });

  useEffect(() => {
    if (!open) return;
    m.reset();
    setForm({
      projectId: projectId ?? '',
      crNumber: cr?.crNumber ?? '',
      title: cr?.title ?? '',
      description: cr?.description ?? '',
      version: cr?.version ?? '1.0',
      analysisStatus: cr?.analysisStatus ?? 'NOT_STARTED',
      automationStatus: cr?.automationStatus ?? 'NOT_STARTED',
      evidenceStatus: cr?.evidenceStatus ?? 'NOT_STARTED',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, cr, projectId]);

  const m = useMutation({
    mutationFn: () => {
      if (editing) {
        const { title, description, version, analysisStatus, automationStatus, evidenceStatus } = form;
        return api.patch<ChangeRequest>(`/api/crs/${cr!.id}`, { title, description, version, analysisStatus, automationStatus, evidenceStatus });
      }
      if (!form.projectId) throw new ApiError(400, 'BAD_REQUEST', 'Choose a project', [{ field: 'projectId', message: 'Choose a project' }]);
      return api.post<ChangeRequest>(`/api/projects/${form.projectId}/crs`, {
        crNumber: form.crNumber,
        title: form.title,
        description: form.description,
        version: form.version,
      });
    },
    onSuccess: (c) => {
      invalidate();
      onOpenChange(false);
      toast.success(editing ? 'CR saved' : `CR ${c.crNumber} created`);
      if (!editing) navigate(`/crs/${c.id}`);
    },
  });
  const errs = fieldErrors(m.error);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? `Edit ${cr!.crNumber}` : 'New change request'}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="cr-form" loading={m.isPending}>
            {editing ? 'Save changes' : 'Create CR'}
          </Button>
        </>
      }
    >
      <form
        id="cr-form"
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate();
        }}
        className="space-y-4"
      >
        {m.error && !Object.keys(errs).length ? <ErrorNotice error={m.error} /> : null}
        {!projectId && !editing && (
          <Field label="Project" required error={errs.projectId}>
            {(p) => (
              <Select {...p} name="projectId" value={form.projectId} onChange={set('projectId')}>
                <option value="">Choose a project…</option>
                {projects.data?.map((pr) => (
                  <option key={pr.id} value={pr.id}>
                    {pr.code} — {pr.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
          <Field label="CR number" required hint={editing ? 'Permanent once created.' : 'e.g. CR30045'} error={errs.crNumber}>
            {(p) => <Input {...p} name="crNumber" value={form.crNumber} onChange={(e) => setForm((f) => ({ ...f, crNumber: e.target.value.toUpperCase() }))} disabled={editing} autoFocus={!editing} />}
          </Field>
          <Field label="Version" required error={errs.version}>
            {(p) => <Input {...p} name="version" value={form.version} onChange={set('version')} maxLength={20} />}
          </Field>
        </div>
        <Field label="CR title" required error={errs.title}>
          {(p) => <Input {...p} name="title" value={form.title} onChange={set('title')} maxLength={200} />}
        </Field>
        <Field label="Description" error={errs.description}>
          {(p) => <Textarea {...p} name="description" value={form.description} onChange={set('description')} maxLength={5000} />}
        </Field>
        {editing && (
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Analysis status">
              {(p) => (
                <Select {...p} name="analysisStatus" value={form.analysisStatus} onChange={set('analysisStatus')}>
                  {ANALYSIS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Automation status">
              {(p) => (
                <Select {...p} name="automationStatus" value={form.automationStatus} onChange={set('automationStatus')}>
                  {PROGRESS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Evidence status">
              {(p) => (
                <Select {...p} name="evidenceStatus" value={form.evidenceStatus} onChange={set('evidenceStatus')}>
                  {PROGRESS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
        )}
      </form>
    </Dialog>
  );
}

// ───────────────────────── Environment ─────────────────────────

export function EnvironmentDialog({
  open,
  onOpenChange,
  projectId,
  env,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  projectId: string;
  env?: Environment;
}) {
  const [form, setForm] = useState({ name: '', type: 'SIT' as Environment['type'], baseUrl: '', description: '' });
  const invalidate = useInvalidateAll();
  useEffect(() => {
    if (!open) return;
    m.reset();
    setForm({ name: env?.name ?? '', type: env?.type ?? 'SIT', baseUrl: env?.baseUrl ?? '', description: env?.description ?? '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, env]);
  const m = useMutation({
    mutationFn: () => (env ? api.patch<Environment>(`/api/environments/${env.id}`, form) : api.post<Environment>(`/api/projects/${projectId}/environments`, form)),
    onSuccess: () => {
      invalidate();
      onOpenChange(false);
      toast.success(env ? 'Environment saved' : 'Environment added');
    },
  });
  const errs = fieldErrors(m.error);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={env ? `Edit ${env.name}` : 'Add environment'}
      description="Where tests will run. Login credentials are not stored here; a secure credential store comes with automation in phase 5."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="env-form" loading={m.isPending}>
            {env ? 'Save changes' : 'Add environment'}
          </Button>
        </>
      }
    >
      <form
        id="env-form"
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate();
        }}
      >
        {m.error && !Object.keys(errs).length ? <ErrorNotice error={m.error} /> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required error={errs.name}>
            {(p) => <Input {...p} name="name" value={form.name} onChange={set('name')} placeholder="SIT" autoFocus />}
          </Field>
          <Field label="Type" required error={errs.type}>
            {(p) => (
              <Select {...p} name="type" value={form.type} onChange={set('type')}>
                <option value="SIT">SIT</option>
                <option value="UAT">UAT</option>
                <option value="LOCAL">Local</option>
                <option value="CUSTOM">Custom URL</option>
              </Select>
            )}
          </Field>
        </div>
        <Field label="Base URL" required error={errs.baseUrl}>
          {(p) => <Input {...p} name="baseUrl" type="url" value={form.baseUrl} onChange={set('baseUrl')} placeholder="https://sit.example.gov.my" />}
        </Field>
        <Field label="Notes" error={errs.description}>
          {(p) => <Input {...p} name="description" value={form.description} onChange={set('description')} />}
        </Field>
      </form>
    </Dialog>
  );
}
