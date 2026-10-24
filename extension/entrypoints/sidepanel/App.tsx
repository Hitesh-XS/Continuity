import { useEffect, useState } from 'react';
import { CLAUDE } from '../../src/shared/providers';
import { CaptureCard } from './components/CaptureCard';
import { CheckpointsCard } from './components/CheckpointsCard';
import { ConversationsCard } from './components/ConversationsCard';
import { DebugCard } from './components/DebugCard';
import { HandoffCard } from './components/HandoffCard'; // <-- ADD THIS IMPORT
import { MemoryCard, type LinkTarget } from './components/MemoryCard';
import { ProjectsCard } from './components/ProjectsCard';
import { SyncCard } from './components/SyncCard';
import { useConversations, useProjects, useSettings } from './hooks';
import { describeMemoryError } from './memory-hooks';
import { memoryRepo } from './services';
import { useAutoSync } from './sync-hooks';

export default function App() {
  const settings = useSettings();
  const projectsState = useProjects();
  const conversationsState = useConversations();
  const [linkTarget, setLinkTarget] = useState<LinkTarget | null>(null);
  useAutoSync();

  const activeId = settings?.activeProjectId ?? null;
  // Switching project cancels a pending "link evidence" request.
  useEffect(() => {
    setLinkTarget(null);
  }, [activeId]);

  if (!settings) return <p className="muted pad">Loading…</p>;

  const activeProject = projectsState.projects?.find((project) => project.id === activeId);

  const useAsEvidence = async (messageId: string): Promise<string> => {
    if (!linkTarget) return 'Choose a memory item first.';
    try {
      await memoryRepo.addEvidence(linkTarget.itemId, messageId);
      return 'Linked as evidence.';
    } catch (e) {
      return describeMemoryError(e);
    }
  };

  return (
    <main>
      <header>
        <h1>Continuity</h1>
        <p className="muted">Persistent memory for AI work</p>
      </header>
      <CaptureCard provider={CLAUDE} settings={settings} />
      <ProjectsCard settings={settings} state={projectsState} />
      <MemoryCard
        projectId={activeProject?.id ?? null}
        project={activeProject}
        linkTarget={linkTarget}
        onLinkTarget={setLinkTarget}
      />
      <CheckpointsCard
        projectId={activeProject?.id ?? null}
        project={activeProject}
        conversations={conversationsState.conversations}
      />
      {/* ADD HANDOFF CARD HERE */}
      <HandoffCard
        projectId={activeProject?.id ?? null}
        project={activeProject}
      />
      <SyncCard />
      <ConversationsCard
        state={conversationsState}
        projects={projectsState.projects}
        linkTarget={linkTarget}
        onUseAsEvidence={useAsEvidence}
      />
      <DebugCard
        projectCount={projectsState.projects?.length ?? null}
        conversationCount={conversationsState.conversations?.length ?? null}
      />
    </main>
  );
}