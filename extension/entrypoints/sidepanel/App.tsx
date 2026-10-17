import { CLAUDE } from '../../src/shared/providers';
import { CaptureCard } from './components/CaptureCard';
import { DebugCard } from './components/DebugCard';
import { ProjectsCard } from './components/ProjectsCard';
import { useProjects, useSettings } from './hooks';

export default function App() {
  const settings = useSettings();
  const projectsState = useProjects();

  if (!settings) return <p className="muted pad">Loading…</p>;

  return (
    <main>
      <header>
        <h1>Continuity</h1>
        <p className="muted">Persistent memory for AI work</p>
      </header>
      <CaptureCard provider={CLAUDE} settings={settings} />
      <ProjectsCard settings={settings} state={projectsState} />
      <DebugCard projectCount={projectsState.projects?.length ?? null} />
    </main>
  );
}