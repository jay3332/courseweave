// What the requirement tree needs to know about courses and the plan, passed down every level.
import type { CatalogIndex } from "$lib/core/catalog-types";
import type { ReqNode } from "$lib/core/degree-types";
import { DRAG_NEW_COURSE } from "$lib/core/degree/hooks";
import { codeOf } from "$lib/core/requisite-format";

export interface TreeContext {
  /** The semester being browsed, for "offered" hints: "Spring 2027". */
  termName: string;
  offered(courseId: string): boolean;
  /** The newest built semester offering a course ("S27"), or null when none does. */
  lastOffered(courseId: string): string | null;
  title(courseId: string): string | undefined;
  units(courseId: string): number | null;
  /** FCE hours a week, or null without evaluations. */
  hours(courseId: string): number | null;
  /** The program version whose tree this is. */
  auditId: number;
  node(nodeId: number): ReqNode | null;
  catalog: CatalogIndex | null;
  /** Courses already in the plan or on the record (not suggested again). */
  inPlan: Set<string>;
  /** Adds a suggested course to the plan; omitted where adding isn't possible. */
  onAddCourse?: (courseId: string, nodeId: number) => void;
  href(courseId: string, term?: string | null): string;
  /** The Courses page listing what counts toward a requirement. */
  requirementHref(auditId: number, nodeId: number): string;
  /** Beside the semesters: unplanned courses can be dragged onto one. */
  dragCourses: boolean;
  onDragStart?: (courseId: string) => void;
  onDragEnd?: () => void;
}

/** Drag attributes for a course that isn't in the plan yet: dropping it on a semester adds it there. */
export function dragNew(
  courseId: string,
  ctx: TreeContext,
): {
  draggable?: true;
  title?: string;
  ondragstart?: (event: DragEvent) => void;
  ondragend?: () => void;
} {
  if (!ctx.dragCourses) return {};
  return {
    draggable: true,
    title: `Drag ${codeOf(courseId)} onto a semester to add it`,
    ondragstart: (event) => {
      event.dataTransfer?.setData(DRAG_NEW_COURSE, courseId);
      event.dataTransfer?.setData("text/plain", codeOf(courseId));
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
      ctx.onDragStart?.(courseId);
    },
    ondragend: () => ctx.onDragEnd?.(),
  };
}
