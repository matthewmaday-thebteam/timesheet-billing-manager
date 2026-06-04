import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

/**
 * A single release note record as stored in public.release_notes.
 * Mirrors the DB columns consumed by the UI (see migration 120).
 */
export type ReleaseNoteRecord = {
  id: string;
  version_label: string;
  note_date: string;
  title: string;
  highlights: string[];
  status: 'draft' | 'published';
  sort_order: number;
  published_at: string | null;
};

/** Input shape for creating / updating a release note. */
export interface ReleaseNoteInput {
  version_label: string;
  note_date: string;
  title: string;
  highlights: string[];
  sort_order?: number;
}

/** Columns selected for every release-note read. */
const RELEASE_NOTE_COLUMNS =
  'id, version_label, note_date, title, highlights, status, sort_order, published_at';

const NEW_NOTE_SORT_GAP = 10;

interface UseActiveReleaseNotesReturn {
  notes: ReleaseNoteRecord[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * Hook to fetch only published release notes (for public/changelog display),
 * ordered newest-first by sort_order.
 *
 * On error or empty result the consumer is expected to fall back to the static
 * file (src/data/releaseNotes.ts), so this surfaces error/empty cleanly and
 * fails quietly — mirroring useActiveLegalDocuments.
 */
export function useActiveReleaseNotes(): UseActiveReleaseNotesReturn {
  const [notes, setNotes] = useState<ReleaseNoteRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const { data, error: fetchError } = await supabase
        .from('release_notes')
        .select(RELEASE_NOTE_COLUMNS)
        .eq('status', 'published')
        .order('sort_order', { ascending: false });

      if (fetchError) throw fetchError;
      setNotes((data as ReleaseNoteRecord[]) || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch release notes');
      setNotes([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { notes, loading, error, refresh };
}

interface UseReleaseNotesReturn {
  notes: ReleaseNoteRecord[];
  loading: boolean;
  error: string | null;
  createNote: (input: ReleaseNoteInput) => Promise<ReleaseNoteRecord | null>;
  updateNote: (id: string, input: ReleaseNoteInput) => Promise<ReleaseNoteRecord | null>;
  deleteNote: (id: string) => Promise<boolean>;
  publishNote: (id: string) => Promise<boolean>;
  unpublishNote: (id: string) => Promise<boolean>;
  refresh: () => Promise<void>;
}

/**
 * Admin hook to manage release notes. Returns ALL notes (including drafts),
 * newest-first by sort_order. Writes go directly to the table; RLS (migration
 * 120) enforces admin-only INSERT/UPDATE/DELETE. Publish/unpublish go through
 * SECURITY DEFINER RPCs that re-assert admin.
 */
export function useReleaseNotes(): UseReleaseNotesReturn {
  const [notes, setNotes] = useState<ReleaseNoteRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const { data, error: fetchError } = await supabase
        .from('release_notes')
        .select(RELEASE_NOTE_COLUMNS)
        .order('sort_order', { ascending: false });

      if (fetchError) throw fetchError;
      setNotes((data as ReleaseNoteRecord[]) || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch release notes');
      setNotes([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Default sort_order for a new note: max existing + gap (newest on top). */
  const nextSortOrder = useCallback((): number => {
    if (notes.length === 0) return NEW_NOTE_SORT_GAP;
    const maxSortOrder = Math.max(...notes.map(n => n.sort_order));
    return maxSortOrder + NEW_NOTE_SORT_GAP;
  }, [notes]);

  const createNote = useCallback(
    async (input: ReleaseNoteInput): Promise<ReleaseNoteRecord | null> => {
      try {
        const { data, error: insertError } = await supabase
          .from('release_notes')
          .insert({
            version_label: input.version_label,
            note_date: input.note_date,
            title: input.title,
            highlights: input.highlights,
            sort_order: input.sort_order ?? nextSortOrder(),
          })
          .select(RELEASE_NOTE_COLUMNS)
          .single();

        if (insertError) throw insertError;

        await refresh();
        return data as ReleaseNoteRecord;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to create release note');
        return null;
      }
    },
    [nextSortOrder, refresh]
  );

  const updateNote = useCallback(
    async (id: string, input: ReleaseNoteInput): Promise<ReleaseNoteRecord | null> => {
      try {
        const updatePayload: Record<string, unknown> = {
          version_label: input.version_label,
          note_date: input.note_date,
          title: input.title,
          highlights: input.highlights,
        };
        if (input.sort_order !== undefined) {
          updatePayload.sort_order = input.sort_order;
        }

        const { data, error: updateError } = await supabase
          .from('release_notes')
          .update(updatePayload)
          .eq('id', id)
          .select(RELEASE_NOTE_COLUMNS)
          .single();

        if (updateError) throw updateError;

        await refresh();
        return data as ReleaseNoteRecord;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update release note');
        return null;
      }
    },
    [refresh]
  );

  const deleteNote = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        const { error: deleteError } = await supabase
          .from('release_notes')
          .delete()
          .eq('id', id);

        if (deleteError) throw deleteError;

        await refresh();
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to delete release note');
        return false;
      }
    },
    [refresh]
  );

  const publishNote = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        const { error: publishError } = await supabase
          .rpc('publish_release_note', { p_id: id });

        if (publishError) throw publishError;

        await refresh();
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to publish release note');
        return false;
      }
    },
    [refresh]
  );

  const unpublishNote = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        const { error: unpublishError } = await supabase
          .rpc('unpublish_release_note', { p_id: id });

        if (unpublishError) throw unpublishError;

        await refresh();
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to unpublish release note');
        return false;
      }
    },
    [refresh]
  );

  return {
    notes,
    loading,
    error,
    createNote,
    updateNote,
    deleteNote,
    publishNote,
    unpublishNote,
    refresh,
  };
}
