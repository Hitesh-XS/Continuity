import { CLAUDE } from '../../src/shared/providers';
import { CaptureCard } from './components/CaptureCard';
import { CheckpointsCard } from './components/CheckpointsCard';
import { ConversationsCard } from './components/ConversationsCard';
import { DebugCard } from './components/DebugCard';
import { ProjectsCard } from './components/ProjectsCard';
import { useConversations, useProjects, useSettings } from './hooks';

export default function App() {
  const settings = useSettings();
  const projectsState = useProjects();
  const conversationsState = useConversations();

  if (!settings) return <p className="muted pad">Loading…</p>;

  const activeProject = projectsState.projects?.find(
    (project) => project.id === settings.activeProjectId,
  );

  return (
    <main>
      <header>
        <h1>Continuity</h1>
        <p className="muted">Persistent memory for AI work</p>
      </header>
      <CaptureCard provider={CLAUDE} settings={settings} />
      <ProjectsCard settings={settings} state={projectsState} />
      <CheckpointsCard
        projectId={activeProject?.id ?? null}
        project={activeProject}
        conversations={conversationsState.conversations}
      />
      <ConversationsCard state={conversationsState} projects={projectsState.projects} />
      <DebugCard
        projectCount={projectsState.projects?.length ?? null}
        conversationCount={conversationsState.conversations?.length ?? null}
      />
    </main>
  );
}