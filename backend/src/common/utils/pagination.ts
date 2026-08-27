export interface Page<T> {
  data: T[];
  pagination: { nextCursor: string | null; hasMore: boolean; limit: number };
}

/** Cursor pagination from an over-fetched (limit + 1) row set, without a non-null assertion on the last element. */
export function paginate<T extends { id: string }>(rows: T[], limit: number): Page<T> {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const last = data.length > 0 ? data[data.length - 1] : undefined;
  return { data, pagination: { nextCursor: hasMore && last ? last.id : null, hasMore, limit } };
}
