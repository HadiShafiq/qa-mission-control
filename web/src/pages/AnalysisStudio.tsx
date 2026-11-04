import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { FileSearch, Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { DataTable } from '@/components/DataTable';
import { NewAnalysisDialog } from '@/components/NewAnalysisDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/form';
import { EmptyState, ErrorNotice, PageHeader, Panel, Skeleton, StatusBadge } from '@/components/ui/misc';
import { api, qs, type ChangeRequest, type Settings } from '@/lib/api';
import { timeAgo } from '@/lib/utils';

const columns: ColumnDef<ChangeRequest, unknown>[] = [
  { accessorKey: 'crNumber', header: 'CR', cell: ({ row }) => <span className="font-medium">{row.original.crNumber}</span> },
  { accessorKey: 'title', header: 'Title', cell: ({ row }) => <span className="line-clamp-1">{row.original.title}</span> },
  { id: 'project', accessorFn: (c) => c.project.code, header: 'Project' },
  { accessorKey: 'documentCount', header: 'Documents' },
  { accessorKey: 'requirementCount', header: 'Requirements' },
  { accessorKey: 'analysisStatus', header: 'Analysis', cell: ({ row }) => <StatusBadge status={row.original.analysisStatus} /> },
  { accessorKey: 'updatedAt', header: 'Updated', cell: ({ row }) => <span className="text-ink-2">{timeAgo(row.original.updatedAt)}</span> },
];

export function AnalysisStudioPage() {
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const crs = useQuery({ queryKey: ['crs', 'analysis', search], queryFn: () => api.get<ChangeRequest[]>(`/api/crs${qs({ search: search || undefined })}`) });
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api.get<Settings>('/api/settings') });

  return (
    <>
      <PageHeader
        title="CR Analysis Studio"
        description="Start a new analysis for a CR document, or open an existing CR to review, edit and approve its requirements."
        actions={
          <Button variant="primary" onClick={() => setCreating(true)} data-testid="new-analysis">
            <Plus /> New analysis
          </Button>
        }
      />
      <NewAnalysisDialog open={creating} onOpenChange={setCreating} aiConnected={Boolean(settings.data?.ai.configured)} />
      {settings.data && !settings.data.ai.configured && <AiNotConnected />}
      <Panel
        title="Change requests"
        actions={
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-ink-3" aria-hidden />
            <Input aria-label="Search change requests" placeholder="Search CR number or title" value={search} onChange={(e) => setSearch(e.target.value)} className="w-64 pl-8" />
          </div>
        }
      >
        {crs.isError ? (
          <div className="p-4">
            <ErrorNotice error={crs.error} onRetry={() => crs.refetch()} />
          </div>
        ) : crs.isPending ? (
          <div className="p-4">
            <Skeleton className="h-24" />
          </div>
        ) : (
          <DataTable
            data={crs.data}
            columns={columns}
            rowHref={(c) => `/cr-analysis/${c.id}`}
            testId="analysis-cr-table"
            empty={
              <EmptyState
                icon={<FileSearch />}
                title={search ? 'No matching change requests' : 'No change requests yet'}
                body={search ? undefined : 'Click New analysis to create a CR from your FRS and analyse it.'}
                action={
                  search ? undefined : (
                    <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
                      <Plus /> New analysis
                    </Button>
                  )
                }
              />
            }
          />
        )}
      </Panel>
    </>
  );
}

export function AiNotConnected() {
  return (
    <div className="mb-6 rounded-lg border border-line-strong bg-surface-2 px-4 py-3 text-[13.5px]" data-testid="ai-not-connected" role="status">
      <p className="font-medium text-ink">AI is not connected</p>
      <p className="mt-0.5 text-ink-2">
        Automatic requirement extraction needs Anthropic credentials. Sign in with <code className="rounded bg-surface px-1">ant auth login</code>, or add{' '}
        <code className="rounded bg-surface px-1">ANTHROPIC_API_KEY=…</code> to <code className="rounded bg-surface px-1">server/.env</code>, then restart the server. Until then you can preview the extracted text and add, review and export requirements by hand.
      </p>
    </div>
  );
}
