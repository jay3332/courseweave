// How many evaluations a course's recent FCE numbers average, for the tooltips on its hours and rating.

/**
 * "Averaged from 21 responses over 4 semesters"; without a response count (older FCE exports lack one), only the
 * semesters.
 */
export function fceSample(responses: number, terms: number): string {
  const over = `over ${terms} ${terms === 1 ? "semester" : "semesters"}`;
  if (responses <= 0) return `Averaged ${over}`;
  const count = responses.toLocaleString("en-US");
  return `Averaged from ${count} ${responses === 1 ? "response" : "responses"} ${over}`;
}
