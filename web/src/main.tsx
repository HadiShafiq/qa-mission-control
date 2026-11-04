import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createBrowserRouter } from 'react-router-dom';
import { Toaster } from 'sonner';
import { AppShell } from '@/components/layout/AppShell';
import { ApiError } from '@/lib/api';
import { ALL_NAV, BUILT_PHASE } from '@/nav';
import { AnalysisStudioPage } from '@/pages/AnalysisStudio';
import { CrAnalysisPage } from '@/pages/CrAnalysis';
import { CrDetailPage } from '@/pages/CrDetail';
import { ModulePlaceholder } from '@/pages/ModulePlaceholder';
import { NotFoundPage } from '@/pages/NotFound';
import { OverviewPage } from '@/pages/Overview';
import { ProjectDetailPage } from '@/pages/ProjectDetail';
import { ProjectsPage } from '@/pages/Projects';
import { SettingsPage } from '@/pages/Settings';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      refetchOnWindowFocus: true,
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
  },
});

const placeholders = ALL_NAV.filter((n) => n.phase > BUILT_PHASE).map((n) => ({ path: n.path, element: <ModulePlaceholder item={n} /> }));

const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <OverviewPage /> },
      { path: 'projects', element: <ProjectsPage /> },
      { path: 'projects/:id', element: <ProjectDetailPage /> },
      { path: 'crs/:id', element: <CrDetailPage /> },
      { path: 'cr-analysis', element: <AnalysisStudioPage /> },
      { path: 'cr-analysis/:id', element: <CrAnalysisPage /> },
      { path: 'settings', element: <SettingsPage /> },
      ...placeholders,
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster position="bottom-right" richColors closeButton />
    </QueryClientProvider>
  </StrictMode>,
);
