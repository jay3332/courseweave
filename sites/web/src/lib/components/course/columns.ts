// The course list's columns (CourseList's header and CourseRow's cells), for sorting by a header.

/** A column the list can be sorted by. */
export type ListColumn = "number" | "title" | "meets" | "hours" | "rating" | "units";

export type SortDir = "asc" | "desc";

/** The column the list is sorted by, and which way. */
export interface SortedColumn {
  column: ListColumn;
  dir: SortDir;
}
