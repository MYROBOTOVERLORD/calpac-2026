// src/lib/michiganPoints.ts

export type ContestWinnerNote = { winner?: string | null; note?: string | null };

export type MichiganGroupDoc = {
  id?: string;
  day?: string;
  groupName?: string;
  groupLabel?: string;
  players?: string[];
  course?: string;
  courseName?: string;
  date?: string;
  pars?: number[];
  hcps?: number[];
  scores?: Record<string, (number | null)[]>;
  handicaps?: Record<string, number | null>;
  contest?: {
    closestToPinByHole?: Record<string, ContestWinnerNote>;
  };
};

export const HOLE_COUNT = 18;

export const DAY_KEYS = ["day1r1", "day1r2", "day2", "day3", "day4", "day5"] as const;
export type DayKey = (typeof DAY_KEYS)[number];

export const ALL_PLAYERS = [
  "Craig Lauderdale", "Jay Norwood", "Dave Laurance",
  "Aaron Schliefer", "Frank Moslander", "Rick Lund",
];

// Manual point overrides set by the admin, e.g. { day1r1: { "Craig Lauderdale": 6 } }.
// When present for a player+day, the override replaces the computed round points for that day.
export type PointOverrides = Partial<Record<DayKey, Record<string, number>>>;

export function arrSum(arr: (number | null)[]): number {
  return arr.reduce<number>((a, v) => (typeof v === "number" ? a + v : a), 0);
}

export function isCompleteRound(arr?: (number | null)[]): boolean {
  return !!arr && arr.length === HOLE_COUNT && arr.every((v) => typeof v === "number");
}

function strokesForHole(hcpIdx: number, total: number): number {
  const s = Math.floor(total);
  if (!Number.isFinite(hcpIdx) || hcpIdx < 1 || hcpIdx > 18 || s <= 0) return 0;
  if (s < hcpIdx) return 0;
  return 1 + Math.floor((s - hcpIdx) / 18);
}

export function calcNet(scores: (number | null)[], hcps: number[] | null, handicap: number): number {
  const gross = arrSum(scores);
  if (!hcps || hcps.length !== HOLE_COUNT) {
    return isCompleteRound(scores) ? gross - Math.floor(handicap) : gross;
  }
  const strokes = scores.reduce<number>(
    (acc, v, i) => (typeof v === "number" ? acc + strokesForHole(hcps[i], handicap) : acc),
    0
  );
  return gross - strokes;
}

export function grossToPar(scores: (number | null)[], pars: number[] | null): number | null {
  if (!pars || pars.length !== HOLE_COUNT) return null;
  let g = 0, p = 0, n = 0;
  scores.forEach((v, i) => { if (typeof v === "number") { g += v; p += pars[i] ?? 0; n++; } });
  return n === 0 ? null : g - p;
}

export function fmtToPar(v: number | null): string {
  if (v == null) return "—";
  return v === 0 ? "E" : v < 0 ? String(v) : `+${v}`;
}

// Computed round points (1st=6 ... 6th=1, ties share the higher rank) before any manual override.
export function computeDayPoints(groups: MichiganGroupDoc[], dayKey: DayKey): Record<string, number> {
  const dayGroups = groups.filter((g) => g.day === dayKey);
  const completeScores: { player: string; net: number }[] = [];

  for (const g of dayGroups) {
    const players = (g.players ?? []).filter(Boolean);
    const hcps = Array.isArray(g.hcps) && g.hcps.length === HOLE_COUNT ? g.hcps : null;
    for (const p of players) {
      const s: (number | null)[] = Array.isArray(g.scores?.[p])
        ? (g.scores![p] as (number | null)[])
        : Array.from({ length: HOLE_COUNT }, () => null);
      if (!isCompleteRound(s)) continue;
      const hcp = typeof g.handicaps?.[p] === "number" ? (g.handicaps![p] as number) : 0;
      completeScores.push({ player: p, net: calcNet(s, hcps, hcp) });
    }
  }

  completeScores.sort((a, b) => a.net - b.net);
  const result: Record<string, number> = {};
  let rank = 1;
  for (let i = 0; i < completeScores.length; i++) {
    if (i > 0 && completeScores[i].net !== completeScores[i - 1].net) rank = i + 1;
    result[completeScores[i].player] = Math.max(0, 7 - rank);
  }
  return result;
}

export type PointsRow = {
  player: string;
  totalPoints: number;
  roundPoints: number;
  ctpPoints: number;
  roundsComplete: number;
  roundsInProgress: number;
  pointsByDay: Partial<Record<DayKey, number>>;
};

export function computePointsStandings(
  groups: MichiganGroupDoc[],
  overrides: PointOverrides = {}
): PointsRow[] {
  const map = new Map<string, {
    roundPoints: number; ctpPoints: number; roundsComplete: number;
    roundsInProgress: number; pointsByDay: Partial<Record<DayKey, number>>;
  }>();
  for (const p of ALL_PLAYERS) {
    map.set(p, { roundPoints: 0, ctpPoints: 0, roundsComplete: 0, roundsInProgress: 0, pointsByDay: {} });
  }

  for (const dayKey of DAY_KEYS) {
    const dayOverrides = overrides[dayKey] ?? {};
    const computedPts = computeDayPoints(groups, dayKey);

    // Track in-progress rounds (incomplete scorecards with at least one hole entered).
    const dayGroups = groups.filter((g) => g.day === dayKey);
    for (const g of dayGroups) {
      const players = (g.players ?? []).filter(Boolean);
      for (const p of players) {
        const s = Array.isArray(g.scores?.[p]) ? (g.scores![p] as (number | null)[]) : [];
        const holesPlayed = s.filter((v) => typeof v === "number").length;
        if (holesPlayed > 0 && !isCompleteRound(s)) {
          const entry = map.get(p);
          if (entry) entry.roundsInProgress = Math.max(entry.roundsInProgress, 1);
        }
      }
    }

    const playersForDay = new Set<string>([...Object.keys(computedPts), ...Object.keys(dayOverrides)]);
    for (const player of playersForDay) {
      const entry = map.get(player);
      if (!entry) continue;
      const override = dayOverrides[player];
      const pts = typeof override === "number" ? override : computedPts[player];
      if (typeof pts === "number") {
        entry.roundPoints += pts;
        entry.roundsComplete++;
        entry.pointsByDay[dayKey] = pts;
      }
    }
  }

  // CTP bonus: +1 point per closest-to-pin hole won
  for (const g of groups) {
    const ctpMap = g.contest?.closestToPinByHole ?? {};
    for (const [, val] of Object.entries(ctpMap)) {
      if (val?.winner) {
        const entry = map.get(val.winner);
        if (entry) entry.ctpPoints++;
      }
    }
  }

  return [...map.entries()]
    .map(([player, data]) => ({
      player,
      totalPoints: data.roundPoints + data.ctpPoints,
      roundPoints: data.roundPoints,
      ctpPoints: data.ctpPoints,
      roundsComplete: data.roundsComplete,
      roundsInProgress: data.roundsInProgress,
      pointsByDay: data.pointsByDay,
    }))
    .sort((a, b) => b.totalPoints - a.totalPoints || b.roundsComplete - a.roundsComplete || a.player.localeCompare(b.player));
}
