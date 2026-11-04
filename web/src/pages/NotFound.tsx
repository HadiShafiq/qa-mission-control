import { Link } from 'react-router-dom';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState, Panel } from '@/components/ui/misc';

export function NotFoundPage({ what = 'page' }: { what?: string }) {
  return (
    <Panel>
      <EmptyState
        title={`This ${what} doesn't exist`}
        body="It may have been typed incorrectly, or the link is from another installation."
        action={
          <Link to="/projects" className={buttonVariants({ variant: 'secondary' })}>
            Go to Projects & CRs
          </Link>
        }
      />
    </Panel>
  );
}
