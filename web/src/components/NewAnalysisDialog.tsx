import { useMutation, useQuery } from '@tanstack/react-query';
import { Play, Upload } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useInvalidateAll } from '@/components/forms';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/form';
import { ErrorNotice } from '@/components/ui/misc';
import { ApiError, api, type AgentTask, type ChangeRequest, type Project, type SourceDocument, type UploadRules } from '@/lib/api';
import { formatBytes } from '@/lib/utils';

const NEW_PROJECT = '__new__';

type Suggestion = { value: string; source: string } | null;
type Inspection = { crNumber: Suggestion; title: Suggestion; version: Suggestion; projectName: Suggestion; matchedProjectId: string | null; warnings: string[] };
type Key = 'crNumber' | 'title' | 'version' | 'project';

/**
 * Suggest CR number, title and version from a CR/FRS filename, e.g.
 * "Change Request-FL30753 - Checking PR Threshold_V1.8.docx" → FL30753, "Checking PR Threshold", 1.8.
 * Only a suggestion: every field stays editable.
 */
export function suggestFromFileName(fileName: string) {
  const base = fileName.replace(/\.[^.]+$/, '');
  const version = /[_\s-]v(\d+(?:\.\d+)*)$/i.exec(base)?.[1];
  const noVersion = base.replace(/[_\s-]v\d+(?:\.\d+)*$/i, '');
  const rest = noVersion.replace(/^\s*(change\s*request|CRF?)\b[\s_-]*/i, '');
  const num = /\b([A-Z]{1,5})[\s#_-]?(\d{3,7})\b/i.exec(rest) ?? /\b(\d{3,7})\b/.exec(rest);
  const crNumber = num ? (num.length === 3 ? `${num[1]}${num[2]}` : `CR${num[1]}`).toUpperCase() : '';
  const dash = noVersion.indexOf(' - ');
  const title = (dash >= 0 ? noVersion.slice(dash + 3) : '').replace(/[_]+/g, ' ').trim();
  return { crNumber, title, version: version ?? '' };
}

export function NewAnalysisDialog({ open, onOpenChange, aiConnected }: { open: boolean; onOpenChange: (o: boolean) => void; aiConnected: boolean }) {
  const navigate = useNavigate();
  const invalidate = useInvalidateAll();
  const fileRef = useRef<HTMLInputElement>(null);
  const projects = useQuery({ queryKey: ['projects', 'active'], queryFn: () => api.get<Project[]>('/api/projects'), enabled: open });
  const rules = useQuery({ queryKey: ['upload-rules'], queryFn: () => api.get<UploadRules>('/api/upload-rules'), staleTime: Infinity });

  const [projectId, setProjectId] = useState('');
  const [projectCode, setProjectCode] = useState('');
  const [projectName, setProjectName] = useState('');
  const [crNumber, setCrNumber] = useState('');
  const [title, setTitle] = useState('');
  const [version, setVersion] = useState('1.0');
  const [files, setFiles] = useState<File[]>([]);
  const [analyse, setAnalyse] = useState(true);
  const [step, setStep] = useState('');
  const [reading, setReading] = useState(false);
  const [sources, setSources] = useState<Partial<Record<Key, string>>>({});
  // Fields the user typed in are never overwritten by suggestions.
  const touched = useRef<Set<Key>>(new Set());
  const touch = (k: Key) => touched.current.add(k);

  useEffect(() => {
    if (!open) return;
    setCrNumber('');
    setTitle('');
    setVersion('1.0');
    setFiles([]);
    setAnalyse(aiConnected);
    setProjectCode('');
    setProjectName('');
    setSources({});
    touched.current = new Set();
    run.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => {
    if (open && !projectId && projects.data) setProjectId(projects.data[0]?.id ?? NEW_PROJECT);
  }, [open, projectId, projects.data]);

  async function pickFiles(list: FileList | null) {
    if (!list?.length) return;
    const picked = Array.from(list);
    setFiles(picked);
    // 1. Instant guess from the filename.
    const s = suggestFromFileName(picked[0].name);
    const next: Partial<Record<Key, string>> = {};
    const fileSrc = 'from the filename';
    if (!touched.current.has('crNumber') && s.crNumber) (setCrNumber(s.crNumber), (next.crNumber = fileSrc));
    if (!touched.current.has('title') && s.title) (setTitle(s.title), (next.title = fileSrc));
    if (!touched.current.has('version') && s.version) (setVersion(s.version), (next.version = fileSrc));
    setSources(next);
    // 2. Read the document itself (not stored) and prefer what it says.
    setReading(true);
    try {
      const info = await api.upload<Inspection>('/api/documents/inspect', [picked[0]]);
      const apply = (k: Key, sug: Suggestion, set: (v: string) => void) => {
        if (!sug || touched.current.has(k)) return;
        set(k === 'crNumber' ? sug.value.toUpperCase() : sug.value);
        next[k] = sug.source.startsWith('document') ? `from the ${sug.source}` : fileSrc;
      };
      apply('crNumber', info.crNumber, setCrNumber);
      apply('title', info.title, setTitle);
      apply('version', info.version, setVersion);
      if (!touched.current.has('project')) {
        if (info.matchedProjectId) {
          setProjectId(info.matchedProjectId);
          next.project = `matched "${info.projectName?.value}" from the document`;
        } else if (info.projectName) {
          setProjectId(NEW_PROJECT);
          setProjectName(info.projectName.value);
          setProjectCode(info.projectName.value.toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 30));
          next.project = `"${info.projectName.value}" from the document is not a project yet`;
        }
      }
      setSources({ ...next });
    } catch {
      // Reading is only a convenience: the filename guess stays and every field is editable.
    } finally {
      setReading(false);
    }
  }

  const run = useMutation({
    mutationFn: async () => {
      let pid = projectId;
      if (pid === NEW_PROJECT) {
        setStep('Creating project');
        pid = (await api.post<Project>('/api/projects', { code: projectCode, name: projectName })).id;
      }
      setStep('Creating CR');
      const cr = await api.post<ChangeRequest>(`/api/projects/${pid}/crs`, { crNumber, title, version: version || '1.0' });
      // From here the CR exists: on any later failure, still open it so the user can retry there.
      try {
        setStep(`Uploading ${files.length} document(s)`);
        const docs = await api.upload<SourceDocument[]>(`/api/crs/${cr.id}/documents`, files);
        if (analyse) {
          setStep('Starting analysis');
          await api.post<AgentTask>(`/api/crs/${cr.id}/analyse`, { documentIds: docs.map((d) => d.id) });
        }
        return { cr, warning: null as string | null };
      } catch (e) {
        return { cr, warning: e instanceof Error ? e.message : 'Something went wrong after the CR was created.' };
      }
    },
    onSuccess: ({ cr, warning }) => {
      invalidate();
      onOpenChange(false);
      if (warning) toast.error(`${cr.crNumber} was created, but: ${warning}`);
      else toast.success(analyse ? `${cr.crNumber} created and analysis started` : `${cr.crNumber} created`);
      navigate(`/cr-analysis/${cr.id}`);
    },
    onSettled: () => setStep(''),
  });

  const errs: Record<string, string> = run.error instanceof ApiError && run.error.details ? Object.fromEntries(run.error.details.map((d) => [d.field, d.message])) : {};
  const ready = crNumber.trim() && title.trim() && files.length > 0 && (projectId !== NEW_PROJECT || (projectCode.trim() && projectName.trim()));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (ready) run.mutate();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="New analysis"
      description="Create a CR for this FRS, upload it and start the analysis. Requirement IDs use the CR number you enter here (e.g. CR3657-REQ-001)."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="new-analysis-form" loading={run.isPending} disabled={!ready || reading} data-testid="create-analysis">
            <Play /> {analyse ? 'Create and analyse' : 'Create CR'}
          </Button>
        </>
      }
    >
      <form id="new-analysis-form" onSubmit={submit} className="space-y-4">
        {run.error && !Object.keys(errs).length ? <ErrorNotice error={run.error} /> : null}

        <Field label="FRS / CR document(s)" required hint={rules.data ? `PDF, DOCX, XLSX, PNG or JPG, up to ${formatBytes(rules.data.maxUploadBytes)} each.` : undefined}>
          {() => (
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" size="sm" onClick={() => fileRef.current?.click()}>
                <Upload /> {files.length ? 'Change files' : 'Choose files'}
              </Button>
              <span className="min-w-0 flex-1 truncate text-[13px] text-ink-2" data-testid="new-analysis-files">
                {files.length ? files.map((f) => f.name).join(', ') : 'No file chosen'}
              </span>
              <input
                ref={fileRef}
                type="file"
                multiple
                className="sr-only"
                tabIndex={-1}
                data-testid="new-analysis-file-input"
                accept={rules.data?.allowedExtensions.map((e) => `.${e}`).join(',')}
                onChange={(e) => pickFiles(e.target.files)}
              />
            </div>
          )}
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_120px]">
          <Field label="CR number" required hint={sources.crNumber ? `Filled in ${sources.crNumber}. Check it.` : 'Filled in from the document or filename when possible.'} error={errs.crNumber}>
            {(p) => <Input {...p} value={crNumber} onChange={(e) => (touch('crNumber'), setCrNumber(e.target.value.toUpperCase()))} maxLength={40} placeholder="e.g. CR3657" />}
          </Field>
          <Field label="Version" error={errs.version}>
            {(p) => <Input {...p} value={version} onChange={(e) => (touch('version'), setVersion(e.target.value))} maxLength={20} />}
          </Field>
        </div>
        <Field label="CR title" required hint={sources.title ? `Filled in ${sources.title}.` : undefined} error={errs.title}>
          {(p) => <Input {...p} value={title} onChange={(e) => (touch('title'), setTitle(e.target.value))} maxLength={200} />}
        </Field>

        <Field label="Project" hint={sources.project ? `Project ${sources.project}.` : undefined}>
          {(p) => (
            <Select {...p} value={projectId} onChange={(e) => (touch('project'), setProjectId(e.target.value))}>
              {projects.data?.map((pr) => (
                <option key={pr.id} value={pr.id}>
                  {pr.code} — {pr.name}
                </option>
              ))}
              <option value={NEW_PROJECT}>+ New project…</option>
            </Select>
          )}
        </Field>
        {projectId === NEW_PROJECT && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[160px_1fr]">
            <Field label="Project code" required error={errs.code}>
              {(p) => <Input {...p} value={projectCode} onChange={(e) => setProjectCode(e.target.value.toUpperCase())} maxLength={30} placeholder="e.g. EPFL" />}
            </Field>
            <Field label="Project name" required error={errs.name}>
              {(p) => <Input {...p} value={projectName} onChange={(e) => setProjectName(e.target.value)} maxLength={200} />}
            </Field>
          </div>
        )}

        <label className="flex items-start gap-2 text-[13.5px]">
          <input type="checkbox" className="mt-0.5 accent-[var(--signal)]" checked={analyse} onChange={(e) => setAnalyse(e.target.checked)} disabled={!aiConnected} />
          <span>
            Start the analysis straight away
            <span className="block text-[12.5px] text-ink-3">
              {aiConnected ? 'All uploaded documents are analysed. Untick to choose documents later on the CR page.' : 'AI is not connected, so the CR is only created and the documents uploaded.'}
            </span>
          </span>
        </label>
        {reading && (
          <p className="text-[13px] text-ink-2" role="status" data-testid="reading-document">
            Reading the document for the CR number and title…
          </p>
        )}
        {step && (
          <p className="text-[13px] text-ink-2" role="status">
            {step}…
          </p>
        )}
      </form>
    </Dialog>
  );
}
