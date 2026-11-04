import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';

/** Sortable table. Rows are keyboard-reachable when `rowHref` is given. */
export function DataTable<T>({
  data,
  columns,
  rowHref,
  initialSort = [],
  empty,
  testId,
}: {
  data: T[];
  columns: ColumnDef<T, unknown>[];
  rowHref?: (row: T) => string;
  initialSort?: SortingState;
  empty: ReactNode;
  testId?: string;
}) {
  const [sorting, setSorting] = useState<SortingState>(initialSort);
  const navigate = useNavigate();
  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  if (!data.length) return <>{empty}</>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-[13.5px]" data-testid={testId}>
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id} className="border-b border-line bg-surface-2">
              {hg.headers.map((h) => {
                const sorted = h.column.getIsSorted();
                const sortable = h.column.getCanSort();
                return (
                  <th
                    key={h.id}
                    scope="col"
                    aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined}
                    className="h-9 px-4 text-[12.5px] font-medium text-ink-2"
                  >
                    {sortable ? (
                      <button className="inline-flex items-center gap-1 hover:text-ink" onClick={h.column.getToggleSortingHandler()}>
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {sorted === 'asc' ? <ArrowUp className="size-3" /> : sorted === 'desc' ? <ArrowDown className="size-3" /> : <ArrowUpDown className="size-3 opacity-40" />}
                      </button>
                    ) : (
                      flexRender(h.column.columnDef.header, h.getContext())
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody className="divide-y divide-line">
          {table.getRowModel().rows.map((row) => {
            const href = rowHref?.(row.original);
            return (
              <tr
                key={row.id}
                className={cn(href && 'cursor-pointer hover:bg-surface-2 focus-visible:bg-surface-2')}
                tabIndex={href ? 0 : undefined}
                onClick={href ? () => navigate(href) : undefined}
                onKeyDown={href ? (e) => e.key === 'Enter' && navigate(href) : undefined}
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-4 py-2.5 align-middle">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
