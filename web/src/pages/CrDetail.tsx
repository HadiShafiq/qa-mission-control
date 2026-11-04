import { useMutation, useQuery } from '@tanstack/react-query';
import { Archive, ArchiveRestore, Download, FileSearch, FileText, Pencil, Upload } from 'lucide-react';
import { useRef, useState, type DragEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { HistoryList } from '@/components/HistoryList';
import { CrDialog, useInvalidateAll } from '@/components/forms';
import { Button, buttonVariants } from '@/components/ui/button';
import { EmptyState, ErrorNotice, PageHeader, Panel, Skeleton, StatusBadge } from '@/components/ui/misc';
import { ApiError, api, qs, type AuditEntry, type ChangeRequest, type SourceDocument, type UploadRules } from '@/lib/api';
import { cn, formatBytes, formatDateTime } from '@/lib/utils';
import { NotFoundPage } from './NotFound';

export function CrDetailPage() {
  const { id } = useParams<{ id: string }>();
  const invalidate = useInvalidateAll();
  const [editOpen, setEditOpen] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);

  const q = useQuery({ queryKey: ['cr', id], queryFn: () => api.get<ChangeRequest>(`/api/crs/${id}`) });
  const history = useQuery({ queryKey: ['cr-history', id], queryFn: () => api.get<AuditEntry[]>(`/api/crs/${id}/history`) });

  const archive = useMutation({
    mutationFn: (action: 'archive' | 'restore') => api.post<ChangeRequest>(`/api/crs/${id}/${action}`),
    onSuccess: (c) => {
      invalidate();
      setConfirmArchive(false);
      toast.success(c.archivedAt ? 'CR archived' : 'CR restored');
    },
    onError: (e) => toast.error(e.message),
  });

  if (q.isError && q.error instanceof ApiError && q.error.status === 404) return <NotFoundPage what="change request" />;
  if (q.isError) return <ErrorNotice error={q.error} onRetry={() => q.refetch()} />;
  if (q.isPending) return <Skeleton className="h-48" />;

  const cr = q.data;
  const archived = Boolean(cr.archivedAt);
  const projectArchived = Boolean(cr.project.archivedAt);
  const readOnly = archived || projectArchived;

  return (
    <>
      <PageHeader
        meta={
          <span>
            <Link to="/projects" className="hover:text-ink">
              Projects
            </Link>
            {' / '}
            <Link to={`/projects/${cr.project.id}`} className="hover:text-ink">
              {cr.project.code}
            </Link>
          </span>
        }
        title={
          <span className="flex flex-wrap items-center gap-2">
            {cr.crNumber}
            <span className="font-normal text-ink-2">{cr.title}</span>
            {archived && <StatusBadge status="ARCHIVED" label="Archived" />}
          </span>
        }
        actions={
          archived ? (
            <Button onClick={() => archive.mutate('restore')} loading={archive.isPending} disabled={projectArchived} title={projectArchived ? 'Restore the project first' : undefined}>
              <ArchiveRestore /> Restore CR
            </Button>
          ) : (
            !projectArchived && (
              <>
                <Link to={`/cr-analysis/${cr.id}`} className={buttonVariants({ variant: 'primary' })}>
                  <FileSearch /> Analyse requirements
                </Link>
                <Button onClick={() => setEditOpen(true)}>
                  <Pencil /> Edit
                </Button>
                <Button variant="danger" onClick={() => setConfirmArchive(true)}>
                  <Archive /> Archive
                </Button>
              </>
            )
          )
        }
      />

      {readOnly && (
        <div className="mb-6 rounded-lg border border-blocked/30 bg-blocked-soft px-4 py-3 text-[13.5px]">
          {projectArchived ? 'The project is archived, so this CR is read-only.' : 'This CR is archived and read-only. Its documents remain downloadable.'}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Panel title="Details" id="cr-details">
            <dl className="grid gap-x-6 gap-y-4 p-4 sm:grid-cols-3">
              <Detail label="Version">{cr.version}</Detail>
              <Detail label="Analysis">
                <StatusBadge status={cr.analysisStatus} />
              </Detail>
              <Detail label="Automation">
                <StatusBadge status={cr.automationStatus} />
              </Detail>
              <Detail label="Evidence">
                <StatusBadge status={cr.evidenceStatus} />
              </Detail>
              <Detail label="Requirements">
                {cr.requirementCount}{' '}
                <Link to={`/cr-analysis/${cr.id}`} className="text-[13px] font-medium text-signal hover:underline">
                  Open in CR Analysis Studio
                </Link>
              </Detail>
              <Detail label="Scenarios">
                {cr.scenarioCount} <span className="text-[12px] text-ink-3">(generated from phase 3)</span>
              </Detail>
              <div className="sm:col-span-3">
                <dt className="text-[12.5px] text-ink-3">Description</dt>
                <dd className="mt-0.5 max-w-[75ch] whitespace-pre-wrap text-ink">{cr.description || <span className="text-ink-3">No description</span>}</dd>
              </div>
            </dl>
          </Panel>

          <Documents crId={cr.id} readOnly={readOnly} />
        </div>

        <Panel title="Review history" id="cr-history">
          {history.isError ? (
            <div className="p-4">
              <ErrorNotice error={history.error} />
            </div>
          ) : history.data?.length ? (
            <HistoryList entries={history.data} />
          ) : (
            <EmptyState title="No history yet" />
          )}
        </Panel>
      </div>

      <CrDialog open={editOpen} onOpenChange={setEditOpen} cr={cr} />
      <ConfirmDialog
        open={confirmArchive}
        onOpenChange={setConfirmArchive}
        title={`Archive ${cr.crNumber}?`}
        body="The CR becomes read-only and is hidden from default lists and the dashboard. Its documents and history are kept, and you can restore it at any time."
        confirmLabel="Archive CR"
        loading={archive.isPending}
        onConfirm={() => archive.mutate('archive')}
      />
    </>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[12.5px] text-ink-3">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

/** Source document upload/list. Also shown on the CR Analysis Studio page. */
export function Documents({ crId, readOnly }: { crId: string; readOnly: boolean }) {
  const [showArchived, setShowArchived] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [pending, setPending] = useState<SourceDocument | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const invalidate = useInvalidateAll();

  const rules = useQuery({ queryKey: ['upload-rules'], queryFn: () => api.get<UploadRules>('/api/upload-rules'), staleTime: Infinity });
  const docs = useQuery({
    queryKey: ['documents', crId, showArchived],
    queryFn: () => api.get<SourceDocument[]>(`/api/crs/${crId}/documents${qs({ includeArchived: showArchived ? 'true' : undefined })}`),
  });

  const upload = useMutation({
    mutationFn: (files: File[]) => api.upload<SourceDocument[]>(`/api/crs/${crId}/documents`, files),
    onSuccess: (saved) => {
      invalidate();
      toast.success(saved.length === 1 ? `Uploaded ${saved[0].originalName}` : `Uploaded ${saved.length} files`);
    },
    onError: (e) => {
      invalidate(); // some files in a batch may have been saved before the failing one
      toast.error(`Upload failed: ${e.message}`);
    },
  });

  const toggleArchive = useMutation({
    mutationFn: (d: SourceDocument) => api.post<SourceDocument>(`/api/documents/${d.id}/${d.archivedAt ? 'restore' : 'archive'}`),
    onSuccess: (d) => {
      invalidate();
      setPending(null);
      toast.success(d.archivedAt ? `Archived ${d.originalName}` : `Restored ${d.originalName}`);
    },
    onError: (e) => toast.error(e.message),
  });

  function accept(list: FileList | null) {
    if (!list?.length || !rules.data) return;
    const files = Array.from(list);
    const bad: string[] = [];
    const ok = files.filter((f) => {
      const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
      if (!rules.data.allowedExtensions.includes(ext)) return bad.push(`${f.name}: .${ext} files are not accepted`), false;
      if (f.size > rules.data.maxUploadBytes) return bad.push(`${f.name}: larger than ${formatBytes(rules.data.maxUploadBytes)}`), false;
      if (f.size === 0) return bad.push(`${f.name}: file is empty`), false;
      return true;
    });
    bad.forEach((b) => toast.error(b));
    if (ok.length) upload.mutate(ok);
    if (inputRef.current) inputRef.current.value = '';
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (!readOnly) accept(e.dataTransfer.files);
  };

  const exts = rules.data?.allowedExtensions.filter((e) => e !== 'jpeg').map((e) => e.toUpperCase()).join(', ');

  return (
    <Panel
      title="Source documents"
      id="docs"
      actions={
        <label className="flex items-center gap-2 text-[13px] text-ink-2">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="accent-[var(--signal)]" />
          Show archived
        </label>
      }
    >
      {!readOnly && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn('m-4 rounded-lg border border-dashed border-line-strong px-4 py-6 text-center', dragging && 'border-signal bg-signal-soft')}
        >
          <Upload className="mx-auto size-5 text-ink-3" aria-hidden />
          <p className="mt-2 text-ink">Drop CR documents here, or</p>
          <Button className="mt-2" size="sm" variant="primary" onClick={() => inputRef.current?.click()} loading={upload.isPending} disabled={!rules.data}>
            Choose files
          </Button>
          <input
            ref={inputRef}
            type="file"
            multiple
            className="sr-only"
            data-testid="file-input"
            accept={rules.data?.allowedExtensions.map((e) => `.${e}`).join(',')}
            onChange={(e) => accept(e.target.files)}
            tabIndex={-1}
          />
          {rules.data && (
            <p className="mt-2 text-[12.5px] text-ink-3">
              {exts}, up to {formatBytes(rules.data.maxUploadBytes)} each. Uploading a file with the same name saves a new version.
            </p>
          )}
        </div>
      )}

      {docs.isError ? (
        <div className="p-4">
          <ErrorNotice error={docs.error} onRetry={() => docs.refetch()} />
        </div>
      ) : docs.isPending ? (
        <div className="p-4">
          <Skeleton className="h-10" />
        </div>
      ) : docs.data.length === 0 ? (
        <EmptyState icon={<FileText />} title={showArchived ? 'No documents' : 'No documents uploaded'} body={readOnly ? undefined : 'Upload the CR specification (FRS, BRS or URS), then analyse it in the CR Analysis Studio.'} />
      ) : (
        <ul className="divide-y divide-line border-t border-line" data-testid="document-list">
          {docs.data.map((d) => (
            <li key={d.id} className={cn('flex flex-wrap items-center gap-3 px-4 py-3', d.archivedAt && 'opacity-60')}>
              <span className="flex h-8 w-11 shrink-0 items-center justify-center rounded border border-line bg-surface-2 text-[11px] font-semibold text-ink-2">{d.fileType}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">
                  {d.originalName} <span className="font-normal text-ink-3">v{d.version}</span>
                  {d.archivedAt && <span className="ml-2 text-[12px] text-ink-3">archived</span>}
                </p>
                <p className="text-[12.5px] text-ink-3">
                  {formatBytes(d.sizeBytes)}, uploaded {formatDateTime(d.createdAt)}
                </p>
              </div>
              <a href={`/api/documents/${d.id}/download`} download className={buttonVariants({ size: 'sm', variant: 'secondary' })} aria-label={`Download ${d.originalName} version ${d.version}`}>
                <Download /> Download
              </a>
              {!readOnly &&
                (d.archivedAt ? (
                  <Button size="sm" variant="ghost" onClick={() => toggleArchive.mutate(d)}>
                    Restore
                  </Button>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => setPending(d)}>
                    Archive
                  </Button>
                ))}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={Boolean(pending)}
        onOpenChange={() => setPending(null)}
        title={`Archive ${pending?.originalName ?? ''} v${pending?.version ?? ''}?`}
        body="It will be hidden from the list but stays on disk and can still be downloaded or restored."
        confirmLabel="Archive document"
        loading={toggleArchive.isPending}
        onConfirm={() => pending && toggleArchive.mutate(pending)}
      />
    </Panel>
  );
}
