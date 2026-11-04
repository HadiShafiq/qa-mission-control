import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { FilePlus2, FolderPlus, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { DataTable } from '@/components/DataTable';
import { ANALYSIS_OPTIONS, CrDialog, ProjectDialog } from '@/components/forms';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/form';
import { EmptyState, ErrorNotice, PageHeader, Panel, Segmented, Skeleton, StatusBadge } from '@/components/ui/misc';
import { api, qs, type ChangeRequest, type Project } from '@/lib/api';
import { cn, formatDate } from '@/lib/utils';

type ArchiveFilter = 'active' | 'archived' | 'all';

function useDebounced(value: string, ms = 250) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function ProjectsPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'crs' ? 'crs' : 'projects';
  const [projectOpen, setProjectOpen] = useState(params.get('new') === 'project');
  const [crOpen, setCrOpen] = useState(false);

  const setTab = (t: 'projects' | 'crs') => setParams(t === 'crs' ? { tab: 'crs' } : {}, { replace: true });

  return (
    <>
      <PageHeader
        title="Projects & change requests"
        description="Create projects, register CRs and upload their source documents. Archiving hides a record but never deletes it."
        actions={
          <>
            <Button onClick={() => setCrOpen(true)}>
              <FilePlus2 /> New CR
            </Button>
            <Button variant="primary" onClick={() => setProjectOpen(true)}>
              <FolderPlus /> New project
            </Button>
          </>
        }
      />

      <div role="tablist" aria-label="View" className="mb-4 flex gap-1 border-b border-line">
        {(
          [
            ['projects', 'Projects'],
            ['crs', 'All change requests'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={cn(
              '-mb-px border-b-2 px-3 pb-2 text-[14px] font-medium',
              tab === key ? 'border-signal text-ink' : 'border-transparent text-ink-2 hover:text-ink',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'projects' ? <ProjectsTable onCreate={() => setProjectOpen(true)} /> : <CrsTable onCreate={() => setCrOpen(true)} />}

      <ProjectDialog
        open={projectOpen}
        onOpenChange={(o) => {
          setProjectOpen(o);
          if (!o && params.get('new')) setParams({}, { replace: true });
        }}
      />
      <CrDialog open={crOpen} onOpenChange={setCrOpen} />
    </>
  );
}

function ProjectsTable({ onCreate }: { onCreate: () => void }) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<ArchiveFilter>('active');
  const s = useDebounced(search);
  const q = useQuery({
    queryKey: ['projects', status, s],
    queryFn: () => api.get<Project[]>(`/api/projects${qs({ status, search: s })}`),
    placeholderData: (prev) => prev,
  });

  const columns = useMemo<ColumnDef<Project, unknown>[]>(
    () => [
      { accessorKey: 'code', header: 'Code', cell: (c) => <span className="font-semibold">{c.getValue<string>()}</span> },
      {
        accessorKey: 'name',
        header: 'Name',
        cell: (c) => (
          <div className="min-w-0">
            <Link to={`/projects/${c.row.original.id}`} className="font-medium text-ink hover:text-signal" onClick={(e) => e.stopPropagation()}>
              {c.getValue<string>()}
            </Link>
            {c.row.original.description && <p className="max-w-[48ch] truncate text-[12.5px] text-ink-3">{c.row.original.description}</p>}
          </div>
        ),
      },
      { accessorKey: 'crCount', header: 'CRs' },
      { accessorKey: 'environmentCount', header: 'Environments' },
      {
        accessorKey: 'updatedAt',
        header: 'Updated',
        cell: (c) => <span className="text-ink-2">{formatDate(c.getValue<string>())}</span>,
      },
      {
        id: 'state',
        header: '',
        enableSorting: false,
        cell: (c) => (c.row.original.archivedAt ? <StatusBadge status="ARCHIVED" label="Archived" /> : null),
      },
    ],
    [],
  );

  return (
    <Panel
      actions={
        <>
          <SearchBox value={search} onChange={setSearch} label="Search projects" placeholder="Search by name or code" />
          <Segmented
            label="Show"
            value={status}
            onChange={setStatus}
            options={[
              { value: 'active', label: 'Active' },
              { value: 'archived', label: 'Archived' },
              { value: 'all', label: 'All' },
            ]}
          />
        </>
      }
    >
      {q.isError ? (
        <div className="p-4">
          <ErrorNotice error={q.error} onRetry={() => q.refetch()} />
        </div>
      ) : q.isPending ? (
        <div className="space-y-2 p-4">
          <Skeleton className="h-8" />
          <Skeleton className="h-8" />
        </div>
      ) : (
        <DataTable
          testId="projects-table"
          data={q.data}
          columns={columns}
          rowHref={(p) => `/projects/${p.id}`}
          initialSort={[{ id: 'updatedAt', desc: true }]}
          empty={
            s || status !== 'active' ? (
              <EmptyState title="No projects match" body="Try a different search or filter." />
            ) : (
              <EmptyState
                icon={<FolderPlus />}
                title="No projects yet"
                body="Create a project for each system you test."
                action={
                  <Button variant="primary" onClick={onCreate}>
                    Create project
                  </Button>
                }
              />
            )
          }
        />
      )}
    </Panel>
  );
}

export function CrsTable({ onCreate, projectId, readOnly }: { onCreate: () => void; projectId?: string; readOnly?: boolean }) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<ArchiveFilter>('active');
  const [analysis, setAnalysis] = useState('');
  const s = useDebounced(search);
  const q = useQuery({
    queryKey: ['crs', projectId ?? 'all', status, analysis, s],
    queryFn: () => api.get<ChangeRequest[]>(`/api/crs${qs({ projectId, status, search: s, analysisStatus: analysis })}`),
    placeholderData: (prev) => prev,
  });

  const columns = useMemo<ColumnDef<ChangeRequest, unknown>[]>(
    () => [
      { accessorKey: 'crNumber', header: 'CR number', cell: (c) => <span className="font-semibold">{c.getValue<string>()}</span> },
      {
        accessorKey: 'title',
        header: 'Title',
        cell: (c) => (
          <Link to={`/crs/${c.row.original.id}`} className="font-medium text-ink hover:text-signal" onClick={(e) => e.stopPropagation()}>
            {c.getValue<string>()}
          </Link>
        ),
      },
      ...(projectId ? [] : [{ id: 'project', accessorFn: (r: ChangeRequest) => r.project.code, header: 'Project' } as ColumnDef<ChangeRequest, unknown>]),
      { accessorKey: 'version', header: 'Version' },
      { accessorKey: 'documentCount', header: 'Docs' },
      {
        accessorKey: 'analysisStatus',
        header: 'Analysis',
        cell: (c) => (
          <span className="inline-flex items-center gap-1.5">
            <StatusBadge status={c.getValue<string>()} />
            {c.row.original.archivedAt && <StatusBadge status="ARCHIVED" label="Archived" />}
          </span>
        ),
      },
      { accessorKey: 'updatedAt', header: 'Updated', cell: (c) => <span className="text-ink-2">{formatDate(c.getValue<string>())}</span> },
    ],
    [projectId],
  );

  return (
    <Panel
      title={projectId ? 'Change requests' : undefined}
      actions={
        <>
          <SearchBox value={search} onChange={setSearch} label="Search CRs" placeholder="CR number or title" />
          <Select aria-label="Analysis status" value={analysis} onChange={(e) => setAnalysis(e.target.value)} className="h-8 w-auto text-[13px]">
            <option value="">Any analysis status</option>
            {ANALYSIS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          <Segmented
            label="Show"
            value={status}
            onChange={setStatus}
            options={[
              { value: 'active', label: 'Active' },
              { value: 'archived', label: 'Archived' },
              { value: 'all', label: 'All' },
            ]}
          />
          {projectId && !readOnly && (
            <Button size="sm" variant="primary" onClick={onCreate}>
              <FilePlus2 /> New CR
            </Button>
          )}
        </>
      }
    >
      {q.isError ? (
        <div className="p-4">
          <ErrorNotice error={q.error} onRetry={() => q.refetch()} />
        </div>
      ) : q.isPending ? (
        <div className="space-y-2 p-4">
          <Skeleton className="h-8" />
        </div>
      ) : (
        <DataTable
          testId="crs-table"
          data={q.data}
          columns={columns}
          rowHref={(c) => `/crs/${c.id}`}
          initialSort={[{ id: 'updatedAt', desc: true }]}
          empty={
            s || analysis || status !== 'active' ? (
              <EmptyState title="No change requests match" body="Try a different search or filter." />
            ) : (
              <EmptyState
                icon={<FilePlus2 />}
                title="No change requests yet"
                body="Register a CR, then upload its PDF, DOCX or XLSX documents."
                action={
                  !readOnly && (
                    <Button variant="primary" onClick={onCreate}>
                      Create CR
                    </Button>
                  )
                }
              />
            )
          }
        />
      )}
    </Panel>
  );
}

function SearchBox({ value, onChange, label, placeholder }: { value: string; onChange: (v: string) => void; label: string; placeholder: string }) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-3" aria-hidden />
      <Input type="search" aria-label={label} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} className="h-8 w-56 pl-8 text-[13px]" />
    </div>
  );
}
