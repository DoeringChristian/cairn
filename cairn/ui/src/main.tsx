import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import App from "./App";
import ProjectsPage from "./pages/ProjectsPage";
import ProjectLayout from "./pages/ProjectLayout";
import RunsTablePage from "./pages/RunsTablePage";
import ComparePage from "./pages/ComparePage";
import RunDetailPage from "./pages/RunDetailPage";
import RunOverviewTab from "./pages/RunOverviewTab";
import RunMetricsTab from "./pages/RunMetricsTab";
import RunLogsTab from "./pages/RunLogsTab";
import RunSourceTab from "./pages/RunSourceTab";
import RunEnvTab from "./pages/RunEnvTab";
import ArtifactsPage from "./pages/ArtifactsPage";
import ArtifactDetailPage from "./pages/ArtifactDetailPage";
import LineagePage from "./pages/LineagePage";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 2_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

const router = createBrowserRouter([
  {
    path: "/",
    element: <App />,
    children: [
      { index: true, element: <ProjectsPage /> },
      {
        path: "p/:projectId",
        element: <ProjectLayout />,
        children: [
          { index: true, element: <RunsTablePage /> },
          { path: "compare", element: <ComparePage /> },
          { path: "artifacts", element: <ArtifactsPage /> },
          { path: "artifacts/:familyId", element: <ArtifactDetailPage /> },
          { path: "lineage", element: <LineagePage /> },
          {
            path: "r/:runId",
            element: <RunDetailPage />,
            children: [
              { index: true, element: <RunOverviewTab /> },
              { path: "overview", element: <RunOverviewTab /> },
              { path: "metrics", element: <RunMetricsTab /> },
              { path: "logs", element: <RunLogsTab /> },
              { path: "source", element: <RunSourceTab /> },
              { path: "env", element: <RunEnvTab /> },
            ],
          },
        ],
      },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>,
);
