import { useState } from 'react';
import { useReleaseNotes, type ReleaseNoteRecord, type ReleaseNoteInput } from '../../hooks/useReleaseNotes';
import { ReleaseNoteTable } from '../ReleaseNoteTable';
import { ReleaseNoteEditorModal } from '../ReleaseNoteEditorModal';
import { MetricCard } from '../MetricCard';
import { Modal } from '../Modal';
import { Button } from '../Button';
import { Alert } from '../Alert';

export function ReleaseNotesAdminPage() {
  const {
    notes,
    loading,
    error,
    createNote,
    updateNote,
    deleteNote,
    publishNote,
    unpublishNote,
    refresh,
  } = useReleaseNotes();

  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [selectedNote, setSelectedNote] = useState<ReleaseNoteRecord | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [noteToDelete, setNoteToDelete] = useState<ReleaseNoteRecord | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const publishedCount = notes.filter((n) => n.status === 'published').length;
  const draftCount = notes.length - publishedCount;

  const handleAddClick = () => {
    setSelectedNote(null);
    setIsEditorOpen(true);
  };

  const handleEditClick = (note: ReleaseNoteRecord) => {
    setSelectedNote(note);
    setIsEditorOpen(true);
  };

  const handleCloseEditor = () => {
    setIsEditorOpen(false);
    setSelectedNote(null);
  };

  // Notes are created as drafts; publishing is a separate RPC. Reconcile the
  // editor's "Published" toggle after the create/update succeeds.
  const handleCreate = async (input: ReleaseNoteInput, published: boolean): Promise<boolean> => {
    setIsSaving(true);
    try {
      const created = await createNote(input);
      if (!created) return false;
      if (published) {
        return await publishNote(created.id);
      }
      return true;
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpdate = async (id: string, input: ReleaseNoteInput, published: boolean): Promise<boolean> => {
    setIsSaving(true);
    try {
      const updated = await updateNote(id, input);
      if (!updated) return false;
      // Only toggle publish state if the editor changed it.
      if (published && updated.status !== 'published') {
        return await publishNote(id);
      }
      if (!published && updated.status === 'published') {
        return await unpublishNote(id);
      }
      return true;
    } finally {
      setIsSaving(false);
    }
  };

  const handlePublishToggle = async (note: ReleaseNoteRecord) => {
    if (note.status === 'published') {
      await unpublishNote(note.id);
    } else {
      await publishNote(note.id);
    }
  };

  const handleDeleteClick = (note: ReleaseNoteRecord) => {
    setNoteToDelete(note);
    setIsDeleteConfirmOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!noteToDelete) return;
    setIsDeleting(true);
    try {
      await deleteNote(noteToDelete.id);
      setIsDeleteConfirmOpen(false);
      setNoteToDelete(null);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-vercel-gray-600">Manage Release Notes</h1>
          <p className="text-sm text-vercel-gray-400 mt-1">
            Create, edit, and publish the release notes shown on the public log
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="secondary" onClick={refresh}>
            Refresh
          </Button>
          <Button variant="primary" onClick={handleAddClick}>
            Add Release Note
          </Button>
        </div>
      </div>

      {/* Error State */}
      {error && <Alert message={error} variant="error" />}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <MetricCard title="Total Notes" value={notes.length.toLocaleString('en-US')} loading={loading} />
        <MetricCard title="Published" value={publishedCount.toLocaleString('en-US')} loading={loading} />
        <MetricCard title="Drafts" value={draftCount.toLocaleString('en-US')} loading={loading} />
      </div>

      {/* Table */}
      <ReleaseNoteTable
        notes={notes}
        loading={loading}
        onEdit={handleEditClick}
        onPublishToggle={handlePublishToggle}
        onDelete={handleDeleteClick}
      />

      {/* Editor Modal */}
      <ReleaseNoteEditorModal
        isOpen={isEditorOpen}
        onClose={handleCloseEditor}
        note={selectedNote}
        onSave={handleCreate}
        onUpdate={handleUpdate}
        isSaving={isSaving}
      />

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={isDeleteConfirmOpen}
        onClose={() => setIsDeleteConfirmOpen(false)}
        title="Delete Release Note"
        maxWidth="sm"
        centerTitle
        footer={
          <>
            <Button variant="secondary" onClick={() => setIsDeleteConfirmOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleConfirmDelete} disabled={isDeleting}>
              {isDeleting ? 'Deleting...' : 'Delete'}
            </Button>
          </>
        }
      >
        <div className="text-center py-4">
          <svg className="mx-auto h-12 w-12 text-error mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <p className="text-sm text-vercel-gray-600">
            Are you sure you want to delete{' '}
            <span className="font-semibold">{noteToDelete?.title}</span>?
          </p>
          <p className="text-xs text-vercel-gray-400 mt-2">This action cannot be undone.</p>
        </div>
      </Modal>
    </div>
  );
}
