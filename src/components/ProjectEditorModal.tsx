import { useState, useCallback } from 'react';
import { Modal } from './Modal';
import { Button } from './Button';
import { Spinner } from './Spinner';
import { ProjectGroupSection } from './ProjectGroupSection';
import { useProjectGroup } from '../hooks/useProjectGroup';
import { useProjectGroupMutations } from '../hooks/useProjectGroupMutations';
import type {
  Project,
  StagedProjectGroupChanges,
} from '../types';

interface ProjectEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: Project | null;
  /** Callback when group changes are saved (to trigger refetch) */
  onGroupChange?: () => void;
}

// Initial empty staged changes
const EMPTY_STAGED_CHANGES: StagedProjectGroupChanges = {
  additions: [],
  removals: new Set<string>(),
};

export function ProjectEditorModal({
  isOpen,
  onClose,
  project,
  onGroupChange,
}: ProjectEditorModalProps) {
  const [lastProjectId, setLastProjectId] = useState<string | null>(project?.id ?? null);
  const [stagedGroupChanges, setStagedGroupChanges] = useState<StagedProjectGroupChanges>(EMPTY_STAGED_CHANGES);

  // Fetch project group data
  const {
    role: projectRole,
    members: persistedMembers,
    loading: loadingGroup,
  } = useProjectGroup(project?.id ?? null);

  // Group mutation hook
  const { saveChanges: saveGroupChanges, isSaving: isSavingGroup, saveError: groupSaveError } = useProjectGroupMutations();

  // Reset form when project changes
  const currentProjectId = project?.id ?? null;
  if (currentProjectId !== lastProjectId) {
    setLastProjectId(currentProjectId);
    setStagedGroupChanges(EMPTY_STAGED_CHANGES);
  }

  const handleStagedChangesUpdate = useCallback((changes: StagedProjectGroupChanges) => {
    setStagedGroupChanges(changes);
  }, []);

  // Check if there are group changes to save
  const hasGroupChanges = stagedGroupChanges.additions.length > 0 || stagedGroupChanges.removals.size > 0;
  const hasExistingGroup = projectRole === 'primary';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!project) return;

    // If there are group changes, save them
    if (hasGroupChanges) {
      const groupResult = await saveGroupChanges({
        primaryProjectId: project.id,
        hasExistingGroup,
        additions: stagedGroupChanges.additions,
        removals: Array.from(stagedGroupChanges.removals),
      });

      if (groupResult.success) {
        setStagedGroupChanges(EMPTY_STAGED_CHANGES);
        onGroupChange?.();
        onClose();
      }
    } else {
      onClose();
    }
  };

  const isLoading = isSavingGroup;

  if (!project) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Edit Project"
      maxWidth="md"
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Project Info Section */}
        <div className="space-y-4">
          {/* Read-only Project Name */}
          <div>
            <label className="block text-xs font-medium text-vercel-gray-400 uppercase tracking-wider mb-1">
              Project Name
            </label>
            <div className="px-3 py-2 bg-vercel-gray-50 border border-vercel-gray-100 rounded-md text-sm text-vercel-gray-600">
              {project.project_name}
            </div>
          </div>

          {/* Read-only External Project ID */}
          <div>
            <label className="block text-xs font-medium text-vercel-gray-400 uppercase tracking-wider mb-1">
              External ID (from time tracking)
            </label>
            <div className="px-3 py-2 bg-vercel-gray-50 border border-vercel-gray-100 rounded-md text-sm text-vercel-gray-400 font-mono">
              {project.project_id}
            </div>
          </div>
        </div>

        {/* Divider */}
        <div className="border-t border-vercel-gray-100" />

        {/* Project Associations Section */}
        {loadingGroup ? (
          <div className="flex items-center justify-center py-4">
            <Spinner size="sm" />
            <span className="ml-2 text-sm text-vercel-gray-400">Loading associations...</span>
          </div>
        ) : (
          <ProjectGroupSection
            projectId={project.id}
            persistedMembers={persistedMembers}
            stagedChanges={stagedGroupChanges}
            onStagedChangesUpdate={handleStagedChangesUpdate}
            disabled={isLoading}
          />
        )}

        {/* Error display */}
        {groupSaveError && (
          <div className="p-3 bg-error-light border border-error rounded-md">
            <p className="text-sm text-error">{groupSaveError}</p>
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-2">
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={isLoading}
          >
            {hasGroupChanges ? 'Cancel' : 'Close'}
          </Button>
          {hasGroupChanges && (
            <Button
              type="submit"
              variant="primary"
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <Spinner size="sm" className="mr-2" />
                  Saving...
                </>
              ) : (
                'Save Changes'
              )}
            </Button>
          )}
        </div>
      </form>
    </Modal>
  );
}
