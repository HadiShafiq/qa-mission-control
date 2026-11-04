import { useMutation, useQuery } from '@tanstack/react-query';
import { Archive, ArchiveRestore, Globe, Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { HistoryList } from '@/components/HistoryList';
import { CrDialog, EnvironmentDialog, ProjectDialog, useInvalidateAll } from '@/components/forms';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorNotice, PageHeader, Panel, Skeleton, StatusBadge } from '@/components/ui/misc';
import { ApiError, api, type AuditEntry, type Environment, type Project } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { NotFoundPage } from './NotFound';
import { CrsTable } from './Projects';

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const invalidate = useInvalidateAll();
  const [editOpen, setEditOpen] = useState(false);
  const [crOpen, setCrOpen] = useState(false);
  const [envOpen, setEnvOpen] = useState(false);
  const [envEditing, setEnvEditing] = useState<Environment | undefined>();
  const [confirm, setConfirm] = useState<null | 'archive' | { env: Environment }>(null);

  const q = useQuery({ queryKey: ['project', id], queryFn: () => api.get<Project>(`/api/projects/${id}`) });
  const history = useQuery({ queryKey: ['project-history', id], queryFn: () => api.get<AuditEntry[]>(`/api/projects/${id}/history`) });

  const archive = useMutation({
    mutationFn: (action: 'archive' | 'restore') => api.post<Project>(`/api/projects/${id}/${action}`),
    onSuccess: (p) => {
      invalidate();
      setConfirm(null);
      toast.success(p.archivedAt ? 'Project archived' : 'Project restored');
    },
    onError: (e) => toast.error(e.message),
  });
  const archiveEnv = useMutation({
    mutationFn: (envId: string) => api.post(`/api/environments/${envId}/archive`),
    onSuccess: () => {
      invalidate();
      setConfirm(null);
      toast.success('Environment archived');
    },
    onError: (e) => toast.error(e.message),
  });

  if (q.isError && q.error instanceof ApiError && q.error.status === 404) return <NotFoundPage what="project" />;
  if (q.isError) return <ErrorNotice error={q.error} onRetry={() => q.refetch()} />;
  if (q.isPending) return <Skeleton className="h-48" />;

  const p = q.data;
  const archived = Boolean(p.archivedAt);

  return (
    <>
      <PageHeader
        meta={
          <Link to="/projects" className="hover:text-ink">
            Projects
          </Link>
        }
        title={
          <span className="flex flex-wrap items-center gap-2">
            {p.name} <span className="text-ink-3">({p.code})</span>
            {archived && <StatusBadge status="ARCHIVED" label={`Archived ${formatDate(p.archivedAt!)}`} />}
          </span>
        }
        description={p.description ?? undefined}
        actions={
          archived ? (
            <Button onClick={() => archive.mutate('restore')} loading={archive.isPending}>
              <ArchiveRestore /> Restore project
            </Button>
          ) : (
            <>
              <Button onClick={() => setEditOpen(true)}>
                <Pencil /> Edit
              </Button>
              <Button variant="danger" onClick={() => setConfirm('archive')}>
                <Archive /> Archive
              </Button>
            </>
          )
        }
      />

      {archived && (
        <div className="mb-6 rounded-lg border border-blocked/30 bg-blocked-soft px-4 py-3 text-[13.5px]">
          This project is archived and read-only. Its data is kept. Restore it to make changes.
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <CrsTable projectId={p.id} onCreate={() => setCrOpen(true)} readOnly={archived} />
          <Panel
            title="Environments"
            id="envs"
            actions={
              !archived && (
                <Button
                  size="sm"
                  onClick={() => {
                    setEnvEditing(undefined);
                    setEnvOpen(true);
                  }}
                >
                  <Plus /> Add environment
                </Button>
              )
            }
          >
            {p.environments?.length ? (
              <ul className="divide-y divide-line" data-testid="env-list">
                {p.environments.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <Globe className="size-4 text-ink-3" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">
                        {e.name} <span className="text-[12.5px] font-normal text-ink-3">{e.type === 'CUSTOM' ? 'Custom URL' : e.type === 'LOCAL' ? 'Local' : e.type}</span>
                      </p>
                      <p className="truncate text-[13px] text-ink-2">{e.baseUrl}</p>
                    </div>
                    {!archived && (
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setEnvEditing(e);
                            setEnvOpen(true);
                          }}
                        >
                          Edit
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setConfirm({ env: e })}>
                          Archive
                        </Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No environments yet" body="Add SIT, UAT, Local or a custom URL so automation knows where to run (phase 5)." />
            )}
          </Panel>
        </div>

        <Panel title="History" id="project-history">
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

      <ProjectDialog open={editOpen} onOpenChange={setEditOpen} project={p} />
      <CrDialog open={crOpen} onOpenChange={setCrOpen} projectId={p.id} />
      <EnvironmentDialog open={envOpen} onOpenChange={setEnvOpen} projectId={p.id} env={envEditing} />
      <ConfirmDialog
        open={confirm === 'archive'}
        onOpenChange={() => setConfirm(null)}
        title={`Archive ${p.code}?`}
        body="The project and its CRs become read-only and are hidden from the default lists and the dashboard. Nothing is deleted, and you can restore it at any time."
        confirmLabel="Archive project"
        loading={archive.isPending}
        onConfirm={() => archive.mutate('archive')}
      />
      <ConfirmDialog
        open={typeof confirm === 'object' && confirm !== null}
        onOpenChange={() => setConfirm(null)}
        title={`Archive environment ${typeof confirm === 'object' && confirm ? confirm.env.name : ''}?`}
        body="It will no longer be offered for test runs. Its history is kept."
        confirmLabel="Archive environment"
        loading={archiveEnv.isPending}
        onConfirm={() => typeof confirm === 'object' && confirm && archiveEnv.mutate(confirm.env.id)}
      />
    </>
  );
}
