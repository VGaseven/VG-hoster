import { lazy, Suspense } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { Layout } from './Layout';
import { OverviewPage } from '@/components/projects/OverviewPage';
import { MapPage } from '@/components/map/MapPage';
import { RegisterPage } from '@/components/projects/RegisterPage';
import { ConflictsPage } from '@/components/conflicts/ConflictsPage';
import { OptimizePage } from '@/components/optimization/OptimizePage';
import { ComparePage } from '@/components/optimization/ComparePage';
import { CitizenPage } from '@/components/citizen/CitizenPage';
import { SettingsPage } from '@/components/layout/SettingsPage';
import { OperatorsPage } from '@/components/citizen/OperatorsPage';

const AnalyticsPage = lazy(() => import('@/components/analytics/AnalyticsPage'));
const StudioPage = lazy(() => import('@/components/video/StudioPage'));

const Loading = () => <div className="grid h-full place-items-center text-sm text-slate-400">جارٍ التحميل…</div>;

const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <OverviewPage /> },
      { path: 'map', element: <MapPage /> },
      { path: 'register', element: <RegisterPage /> },
      { path: 'conflicts', element: <ConflictsPage /> },
      { path: 'optimize', element: <OptimizePage /> },
      { path: 'compare', element: <ComparePage /> },
      { path: 'citizen', element: <CitizenPage /> },
      { path: 'analytics', element: <Suspense fallback={<Loading />}><AnalyticsPage /></Suspense> },
      { path: 'studio', element: <Suspense fallback={<Loading />}><StudioPage /></Suspense> },
      { path: 'settings', element: <SettingsPage /> },
      { path: 'operators', element: <OperatorsPage /> },
      { path: '*', element: <OverviewPage /> },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
