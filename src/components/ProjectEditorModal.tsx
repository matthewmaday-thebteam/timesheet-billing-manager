import { useState, useCallback, useEffect } from 'react';
import { Modal } from './Modal';
import { Button } from './Button';
import { Spinner } from './Spinner';
import { ProjectGroupSection } from './ProjectGroupSection';
import { useProjectGroup } from '../hooks/useProjectGroup';
import { useProjectGroupMutations } from '../hooks/useProjectGroupMutations';
import { useProjectUpdate } from '../hooks/useProjectUpdate';
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
  const [targetHours, setTargetHours] = useState<string>('0');

  // Fetch project group data
  const {
    role: projectRole,
    members: persistedMembers,
    loading: loadingGroup,
  } = useProjectGroup(project?.id ?? null);

  // Group mutation hook
  const { saveChanges: saveGroupChanges, isSaving: isSavingGroup, saveError: groupSaveError } = useProjectGroupMutations();

  // Project update hook
  const { updateProject, isUpdating: isUpdatingProject, error: projectUpdateError } = useProjectUpdate();

  // Reset form when project changes
  const currentProjectId = project?.id ?? null;
  if (currentProjectId !== lastProjectId) {
    setLastProjectId(currentProjectId);
    setStagedGroupChanges(EMPTY_STAGED_CHANGES);
    setTargetHours(project?.target_hours?.toString() ?? '0');
  }

  // Initialize target hours when project is first loaded
  useEffect(() => {
    if (project) {
      setTargetHours(project.target_hours?.toString() ?? '0');
    }
  }, [project]);

  const handleStagedChangesUpdate = useCallback((changes: StagedProjectGroupChanges) => {
    setStagedGroupChanges(changes);
  }, []);

  // Check if there are group changes to save
  const hasGroupChanges = stagedGroupChanges.additions.length > 0 || stagedGroupChanges.removals.size > 0;
  const hasExistingGroup = projectRole === 'primary';

  // Check if target hours has changed
  const parsedTargetHours = parseFloat(targetHours) || 0;
  const hasTargetHoursChanged = project && parsedTargetHours !== (project.target_hours ?? 0);
  const hasAnyChanges = hasGroupChanges || hasTargetHoursChanged;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!project) return;

    let allSuccessful = true;

    // Save target hours if changed
    if (hasTargetHoursChanged) {
      const projectResult = await updateProject(project.id, {
        target_hours: parsedTargetHours,
      });
      if (!projectResult.success) {
        allSuccessful = false;
      }
    }

    // If there are group changes, save them
    if (hasGroupChanges && allSuccessful) {
      const groupResult = await saveGroupChanges({
        primaryProjectId: project.id,
        hasExistingGroup,
        additions: stagedGroupChanges.additions,
        removals: Array.from(stagedGroupChanges.removals),
      });

      if (!groupResult.success) {
        allSuccessful = false;
      }
    }

    if (allSuccessful) {
      setStagedGroupChanges(EMPTY_STAGED_CHANGES);
      onGroupChange?.();
      onClose();
    }
  };

  const isLoading = isSavingGroup || isUpdatingProject;

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

          {/* Target Hours */}
          <div>
            <label className="block text-xs font-medium text-vercel-gray-400 uppercase tracking-wider mb-1">
              Target Hours
            </label>
            <input
              type="number"
              min="0"
              step="0.5"
              value={targetHours}
              onChange={(e) => setTargetHours(e.target.value)}
              disabled={isLoading}
              className="w-full px-3 py-2 border border-vercel-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-vercel-blue focus:border-transparent disabled:bg-vercel-gray-50 disabled:text-vercel-gray-400"
              placeholder="0"
            />
            <p className="mt-1 text-xs text-vercel-gray-400">
              Set to 0 for no target
            </p>
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
        {(groupSaveError || projectUpdateError) && (
          <div className="p-3 bg-error-light border border-error rounded-md">
            <p className="text-sm text-error">{groupSaveError || projectUpdateError}</p>
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
            {hasAnyChanges ? 'Cancel' : 'Close'}
          </Button>
          {hasAnyChanges && (
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
