// lib/fallSeries.ts
// ─── Fall Series configuration ───────────────────────────────────────────────
// A 7-course series that runs on the same rich hole-by-hole scoring UI as the
// main Cal-Pac tournament (Old Greenwood / Gray's Crossing). Course data lives
// in lib/courses.ts; each round below points at a course id (or null for TBD).

export type FallRound = {
  roundKey: string; // stable key, e.g. "round1"
  label: string; // "Round 1"
  courseId: string | null; // id in COURSES (lib/courses.ts), or null if TBD
  courseName: string; // display name (used before a course id is wired up)
  date?: string; // optional date label
};

export const FALL_ROUNDS: FallRound[] = [
  { roundKey: "round1", label: "Round 1", courseId: "blue-rock-east", courseName: "Blue Rock Springs East" },
  { roundKey: "round2", label: "Round 2", courseId: "sunnyvale", courseName: "Sunnyvale Golf Course" },
  { roundKey: "round3", label: "Round 3", courseId: null, courseName: "Course TBD" },
  { roundKey: "round4", label: "Round 4", courseId: null, courseName: "Course TBD" },
  { roundKey: "round5", label: "Round 5", courseId: null, courseName: "Course TBD" },
  { roundKey: "round6", label: "Round 6", courseId: null, courseName: "Course TBD" },
  { roundKey: "round7", label: "Round 7", courseId: null, courseName: "Course TBD" },
];

export function getFallRound(roundKey: string): FallRound | undefined {
  return FALL_ROUNDS.find((r) => r.roundKey === roundKey);
}
