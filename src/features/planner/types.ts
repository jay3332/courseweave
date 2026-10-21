/** A course being considered but not yet chosen: specific section names, or every lecture/section when null. */
export interface Preview {
  courseId: string
  sections: string[] | null
}

/** A placed course clicked on the calendar; its alternatives at that level show as outlines. */
export interface CalendarSelection {
  courseId: string
  /** 'section': alternative lectures/sections. 'child': alternative recitations of the current lecture. */
  level: 'section' | 'child'
}
