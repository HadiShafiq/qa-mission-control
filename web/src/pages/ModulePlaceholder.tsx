import { Construction } from 'lucide-react';
import { Link } from 'react-router-dom';
import { buttonVariants } from '@/components/ui/button';
import { PageHeader, Panel } from '@/components/ui/misc';
import type { NavItem } from '@/nav';

/**
 * Honest placeholder for modules that are not built yet. It states which
 * phase builds the module and does not show any controls that do nothing.
 */
export function ModulePlaceholder({ item }: { item: NavItem }) {
  return (
    <>
      <PageHeader title={item.label} meta={`Planned for phase ${item.phase}`} />
      <Panel>
        <div className="flex flex-col gap-4 p-6 sm:flex-row sm:items-start">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-surface-2 text-ink-3">
            <Construction className="size-5" aria-hidden />
          </div>
          <div className="max-w-[64ch]">
            <p className="font-medium">This module isn't built yet.</p>
            <p className="mt-1 text-ink-2">{item.summary}</p>
            <p className="mt-3 text-[13px] text-ink-3">
              It will be built and tested in phase {item.phase}. Until then this page has no controls, so nothing here can look like it worked when it didn't.
            </p>
            <Link to="/projects" className={buttonVariants({ variant: 'secondary', size: 'sm', className: 'mt-4' })}>
              Go to Projects & CRs
            </Link>
          </div>
        </div>
      </Panel>
    </>
  );
}
