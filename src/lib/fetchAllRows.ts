/**
 * Paginated Supabase fetch — guarantees all rows are returned.
 *
 * Supabase JS client defaults to 1000 rows per query. This function
 * pages through results in batches until all rows are fetched, so
 * callers never silently lose data.
 */

const PAGE_SIZE = 1000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type QueryBuilder = { range: (from: number, to: number) => PromiseLike<{ data: any[] | null; error: any }> };

export async function fetchAllRows<T>(
  queryBuilder: QueryBuilder,
): Promise<{ data: T[]; error: null } | { data: null; error: { message: string } }> {
  const allData: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await queryBuilder.range(from, from + PAGE_SIZE - 1);
    if (error) return { data: null, error };
    if (!data || data.length === 0) break;
    allData.push(...(data as T[]));
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return { data: allData, error: null };
}
