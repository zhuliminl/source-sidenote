import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { AppShell } from "@/components/layout/app-shell";
import { HomePage } from "@/features/home/home-page";
import { ProjectPage } from "@/features/project/project-page";
import { JobsPage } from "@/features/jobs/jobs-page";
import { PromptsPage } from "@/features/prompts/prompts-page";
import { SettingsPage } from "@/features/settings/settings-page";
import { queryClient } from "@/lib/queries";

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={300}>
        <BrowserRouter>
          <Routes>
            <Route element={<AppShell />}>
              <Route index element={<HomePage />} />
              <Route path="projects/:projectId" element={<ProjectPage />} />
              <Route path="jobs" element={<JobsPage />} />
              <Route path="prompts" element={<PromptsPage />} />
              <Route path="settings/:tab?" element={<SettingsPage />} />
              <Route
                path="models"
                element={<Navigate to="/settings/models" replace />}
              />
              <Route path="*" element={<HomePage />} />
            </Route>
          </Routes>
        </BrowserRouter>
        <Toaster position="bottom-center" />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
