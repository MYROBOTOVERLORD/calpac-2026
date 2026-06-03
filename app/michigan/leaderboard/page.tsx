"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";

// ─── Types ───────────────────────────────────────────────────────────────────

type ContestWinnerNote = { winner?: string | null; note?: string | null };

type MichiganGroupDoc = {
  id: string;
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

const HOLE_COUNT = 18;
const DAY_KEYS = ["day1r1", "day1r2", "day2", "day3", "day4", "day5"] as const;
type DayKey = (typeof DAY_KEYS)[number];

const DAY_INFO: Record<DayKey, { label: string; date: string; course: string }> = {
  day1r1: { label: "Day 1 · R1", date: "June 15", course: "Spruce Run" },
  day1r2: { label: "Day 1 · R2", date: "June 15", course: "The Bear" },
  day2: { label: "Day 2", date: "June 16", course: "Arcadia Bluffs South" },
  day3: { label: "Day 3", date: "June 17", course: "Bay Harbor Links/Quarry" },
  day4: { label: "Day 4", date: "June 18", course: "Forest Dunes" },
  day5: { label: "Day 5", date: "June 19", course: "Arcadia Bluffs" },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function arrSum(arr: (number | null)[]): number {
  return arr.reduce<number>((a, v) => (typeof v === "number" ? a + v : a), 0);
}

function isCompleteRound(arr?: (number | null)[]): boolean {
  return !!arr && arr.length === HOLE_COUNT && arr.every((v) => typeof v === "number");
}

function strokesForHole(hcpIdx: number, total: number): number {
  const s = Math.floor(total);
  if (!Number.isFinite(hcpIdx) || hcpIdx < 1 || hcpIdx > 18 || s <= 0) return 0;
  if (s < hcpIdx) return 0;
  return 1 + Math.floor((s - hcpIdx) / 18);
}

function calcNet(
  scores: (number | null)[],
  hcps: number[] | null,
  handicap: number
): number {
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

function grossToPar(scores: (number | null)[], pars: number[] | null): number | null {
  if (!pars || pars.length !== HOLE_COUNT) return null;
  let g = 0, p = 0, n = 0;
  scores.forEach((v, i) => { if (typeof v === "number") { g += v; p += pars[i] ?? 0; n++; } });
  return n === 0 ? null : g - p;
}

function fmtToPar(v: number | null): string {
  if (v == null) return "—";
  return v === 0 ? "E" : v < 0 ? String(v) : `+${v}`;
}

// ─── Row types ────────────────────────────────────────────────────────────────

type PlayerDayRow = {
  player: string;
  gross: number;
  net: number;
  toPar: number | null;
  holesPlayed: number;
  handicap: number;
  groupName: string;
};

type OverallRow = {
  player: string;
  daysPlayed: number;
  totalGross: number;
  totalNet: number;
  handicap: number;
};

type CtpEntry = { hole: string; winner: string; note: string; groupName: string; course: string };

// ─── Compute functions ────────────────────────────────────────────────────────

function computeDayRows(groups: MichiganGroupDoc[], dayKey: DayKey): PlayerDayRow[] {
  const dayGroups = groups.filter((g) => g.day === dayKey);
  const rows: PlayerDayRow[] = [];
  for (const g of dayGroups) {
    const players = (g.players ?? []).filter(Boolean);
    const pars = Array.isArray(g.pars) && g.pars.length === HOLE_COUNT ? g.pars : null;
    const hcps = Array.isArray(g.hcps) && g.hcps.length === HOLE_COUNT ? g.hcps : null;
    const groupName = g.groupName ?? g.id;
    for (const p of players) {
      const s: (number | null)[] = Array.isArray(g.scores?.[p])
        ? (g.scores![p] as (number | null)[])
        : Array.from({ length: HOLE_COUNT }, () => null);
      const hcp = typeof g.handicaps?.[p] === "number" ? (g.handicaps![p] as number) : 0;
      const gross = arrSum(s);
      const net = calcNet(s, hcps, hcp);
      const toPar = grossToPar(s, pars);
      const holesPlayed = s.filter((v) => typeof v === "number").length;
      rows.push({ player: p, gross, net, toPar, holesPlayed, handicap: hcp, groupName });
    }
  }
  return rows;
}

function computeOverall(groups: MichiganGroupDoc[]): OverallRow[] {
  const playerMap = new Map<string, { daysPlayed: number; totalGross: number; totalNet: number; handicap: number }>();

  for (const g of groups) {
    const players = (g.players ?? []).filter(Boolean);
    const hcps = Array.isArray(g.hcps) && g.hcps.length === HOLE_COUNT ? g.hcps : null;
    for (const p of players) {
      const s: (number | null)[] = Array.isArray(g.scores?.[p])
        ? (g.scores![p] as (number | null)[])
        : Array.from({ length: HOLE_COUNT }, () => null);
      const hcp = typeof g.handicaps?.[p] === "number" ? (g.handicaps![p] as number) : 0;
      if (!isCompleteRound(s)) continue; // Only count complete rounds
      const gross = arrSum(s);
      const net = calcNet(s, hcps, hcp);
      const existing = playerMap.get(p) ?? { daysPlayed: 0, totalGross: 0, totalNet: 0, handicap: hcp };
      playerMap.set(p, {
        daysPlayed: existing.daysPlayed + 1,
        totalGross: existing.totalGross + gross,
        totalNet: existing.totalNet + net,
        handicap: hcp,
      });
    }
  }

  return [...playerMap.entries()]
    .map(([player, data]) => ({ player, ...data }))
    .sort((a, b) => {
      if (a.daysPlayed === 0 && b.daysPlayed > 0) return 1;
      if (b.daysPlayed === 0 && a.daysPlayed > 0) return -1;
      return a.totalNet - b.totalNet || a.totalGross - b.totalGross;
    });
}

function computeCtpEntries(groups: MichiganGroupDoc[], dayKey: DayKey): CtpEntry[] {
  const dayGroups = groups.filter((g) => g.day === dayKey);
  const entries: CtpEntry[] = [];
  for (const g of dayGroups) {
    const ctpMap = g.contest?.closestToPinByHole ?? {};
    for (const [hole, val] of Object.entries(ctpMap)) {
      if (val?.winner) {
        entries.push({
          hole,
          winner: val.winner,
          note: val.note ?? "",
          groupName: g.groupName ?? g.id,
          course: g.courseName ?? g.course ?? "",
        });
      }
    }
  }
  return entries.sort((a, b) => Number(a.hole) - Number(b.hole));
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function MichiganLeaderboardPage() {
  const router = useRouter();
  const [groups, setGroups] = useState<MichiganGroupDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState<DayKey | "overall">("overall");
  const [boardType, setBoardType] = useState<"net" | "gross">("net");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "michigan"),
      (snap) => {
        setGroups(snap.docs.map((d) => ({ id: d.id, ...d.data() } as MichiganGroupDoc)));
        setLastUpdated(new Date());
        setLoading(false);
      },
      () => setLoading(false)
    );
    return () => unsub();
  }, []);

  const dayRows = useMemo(() => {
    if (selectedDay === "overall") return [];
    return computeDayRows(groups, selectedDay as DayKey);
  }, [groups, selectedDay]);

  const overallRows = useMemo(() => computeOverall(groups), [groups]);

  const sortedDayRows = useMemo(() => {
    const rows = [...dayRows];
    if (boardType === "gross") {
      return rows.sort((a, b) => {
        if (a.holesPlayed === 0 && b.holesPlayed > 0) return 1;
        if (b.holesPlayed === 0 && a.holesPlayed > 0) return -1;
        if (a.toPar !== null && b.toPar !== null) return a.toPar - b.toPar || a.gross - b.gross;
        return a.gross - b.gross;
      });
    }
    return rows.sort((a, b) => {
      if (a.holesPlayed === 0 && b.holesPlayed > 0) return 1;
      if (b.holesPlayed === 0 && a.holesPlayed > 0) return -1;
      return a.net - b.net || a.gross - b.gross;
    });
  }, [dayRows, boardType]);

  const ctpEntries = useMemo(() => {
    if (selectedDay === "overall") return [];
    return computeCtpEntries(groups, selectedDay as DayKey);
  }, [groups, selectedDay]);

  // Aggregate CTP across all days for overall view
  const allCtpEntries = useMemo(() => {
    const all: (CtpEntry & { day: string })[] = [];
    for (const dayKey of DAY_KEYS) {
      const entries = computeCtpEntries(groups, dayKey);
      const info = DAY_INFO[dayKey];
      for (const e of entries) {
        all.push({ ...e, day: `${info.label} · ${info.course}` });
      }
    }
    return all;
  }, [groups]);

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
          <p className="text-slate-400 text-sm">Loading leaderboard…</p>
        </div>
      </main>
    );
  }

  const currentDayInfo = selectedDay !== "overall" ? DAY_INFO[selectedDay as DayKey] : null;

  return (
    <main className="min-h-screen bg-slate-900 text-white">
      <div className="max-w-lg mx-auto px-4 py-6">

        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-[10px] font-bold tracking-widest text-blue-400 uppercase">Michigan 2026</p>
            <h1 className="text-xl font-bold text-white">Leaderboard</h1>
            {lastUpdated && (
              <p className="text-xs text-slate-500 mt-0.5">
                Updated {lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </p>
            )}
          </div>
          <button
            onClick={() => router.push("/michigan")}
            className="bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 rounded-xl px-3 py-2 text-sm transition-colors"
          >
            ← Back
          </button>
        </div>

        {/* Day selector */}
        <div className="flex gap-1.5 mb-3 flex-wrap">
          <button
            onClick={() => setSelectedDay("overall")}
            className={`px-3 py-2 rounded-xl text-sm font-semibold transition-colors ${
              selectedDay === "overall" ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700"
            }`}
          >
            Overall
          </button>
          {DAY_KEYS.map((d) => (
            <button
              key={d}
              onClick={() => setSelectedDay(d)}
              className={`px-3 py-2 rounded-xl text-sm font-semibold transition-colors ${
                selectedDay === d ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700"
              }`}
            >
              {DAY_INFO[d].label}
            </button>
          ))}
        </div>

        {/* Board type — only for daily view */}
        {selectedDay !== "overall" && (
          <div className="flex gap-2 mb-4">
            {(["net", "gross"] as const).map((b) => (
              <button
                key={b}
                onClick={() => setBoardType(b)}
                className={`flex-1 py-2 rounded-xl text-sm font-semibold transition-colors ${
                  boardType === b ? "bg-slate-200 text-slate-900" : "bg-slate-800 text-slate-400 hover:bg-slate-700"
                }`}
              >
                {b === "net" ? "Net" : "Gross"}
              </button>
            ))}
          </div>
        )}

        {/* Course label */}
        {currentDayInfo && (
          <p className="text-xs text-slate-500 uppercase tracking-wide font-semibold mb-3">
            {currentDayInfo.date} · {currentDayInfo.course} · {boardType === "net" ? "Net" : "Gross"} Leaderboard
          </p>
        )}
        {selectedDay === "overall" && (
          <p className="text-xs text-slate-500 uppercase tracking-wide font-semibold mb-3">
            Cumulative · Net Total (complete rounds only)
          </p>
        )}

        {/* Overall Leaderboard */}
        {selectedDay === "overall" && (
          <>
            {/* Column headers */}
            <div className="flex items-center px-3 mb-1 gap-2">
              <span className="w-6 shrink-0" />
              <span className="flex-1" />
              <span className="text-[10px] text-slate-600 w-14 text-right shrink-0">Rounds</span>
              <span className="text-[10px] text-slate-600 w-14 text-right shrink-0">Gross</span>
              <span className="text-[10px] text-slate-600 w-14 text-right shrink-0">Net</span>
            </div>
            <div className="space-y-1.5 mb-6">
              {overallRows.map((r, i) => (
                <div
                  key={r.player}
                  className={`flex items-center gap-2 rounded-xl px-3 py-3 ${
                    i === 0 && r.daysPlayed > 0 ? "bg-blue-900/40 border border-blue-800/50" : "bg-slate-800"
                  }`}
                >
                  <span className={`text-sm font-bold w-6 shrink-0 ${i === 0 && r.daysPlayed > 0 ? "text-blue-400" : "text-slate-600"}`}>
                    {r.daysPlayed > 0 ? i + 1 : "—"}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white truncate">{r.player}</p>
                    <p className="text-[11px] text-slate-500">Hcp {r.handicap}</p>
                  </div>
                  <span className="text-xs text-slate-500 w-14 text-right shrink-0">
                    {r.daysPlayed > 0 ? `${r.daysPlayed}/5` : "—"}
                  </span>
                  <span className="text-sm font-bold text-slate-400 w-14 text-right shrink-0">
                    {r.daysPlayed > 0 ? r.totalGross : "—"}
                  </span>
                  <span className={`text-sm font-bold w-14 text-right shrink-0 ${r.daysPlayed > 0 ? "text-white" : "text-slate-600"}`}>
                    {r.daysPlayed > 0 ? r.totalNet : "—"}
                  </span>
                </div>
              ))}
              {overallRows.length === 0 && (
                <p className="text-center text-slate-600 text-sm mt-6">No complete rounds yet.</p>
              )}
            </div>

            {/* All CTP entries */}
            {allCtpEntries.length > 0 && (
              <div>
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">📍 Closest to Pin — All Days</p>
                <div className="space-y-2">
                  {allCtpEntries.map((e, i) => (
                    <div key={i} className="bg-slate-800 rounded-xl px-4 py-2.5 flex items-center justify-between">
                      <div>
                        <p className="text-xs text-slate-500">{e.day} · Hole {e.hole}</p>
                        <p className="text-sm font-semibold text-emerald-400">🏆 {e.winner}</p>
                      </div>
                      {e.note && <span className="text-xs text-slate-400 italic">{e.note}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* Daily Leaderboard */}
        {selectedDay !== "overall" && (
          <>
            {/* Column headers */}
            <div className="flex items-center px-3 mb-1 gap-2">
              <span className="w-6 shrink-0" />
              <span className="flex-1" />
              <span className="text-[10px] text-slate-600 w-8 text-right shrink-0">Thru</span>
              <span className="text-[10px] text-slate-600 w-12 text-right shrink-0">{boardType === "net" ? "Net" : "Gross"}</span>
              <span className="text-[10px] text-slate-600 w-10 text-right shrink-0">To Par</span>
            </div>

            <div className="space-y-1.5 mb-6">
              {sortedDayRows.map((r, i) => {
                const active = r.holesPlayed > 0;
                const finished = r.holesPlayed === HOLE_COUNT;
                const thru = finished ? "F" : active ? String(r.holesPlayed) : "—";
                const score = boardType === "net" ? r.net : r.gross;
                const toPar = r.toPar;
                return (
                  <div
                    key={`${r.player}-${r.groupName}`}
                    className={`flex items-center gap-2 rounded-xl px-3 py-3 ${
                      i === 0 && active ? "bg-blue-900/40 border border-blue-800/50" : "bg-slate-800"
                    }`}
                  >
                    <span className={`text-sm font-bold w-6 shrink-0 ${i === 0 && active ? "text-blue-400" : "text-slate-600"}`}>
                      {active ? i + 1 : "—"}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-white truncate">{r.player}</p>
                      <p className="text-[11px] text-slate-500 truncate">{r.groupName} · Hcp {r.handicap}</p>
                    </div>
                    <span className={`text-xs w-8 text-right shrink-0 font-semibold ${finished ? "text-emerald-400" : "text-slate-500"}`}>
                      {thru}
                    </span>
                    <span className="text-sm font-bold text-white w-12 text-right shrink-0">
                      {active ? score : "—"}
                    </span>
                    <span
                      className={`text-sm font-semibold w-10 text-right shrink-0 ${
                        active && toPar !== null && toPar < 0
                          ? "text-red-400"
                          : active && toPar === 0
                          ? "text-emerald-400"
                          : "text-slate-500"
                      }`}
                    >
                      {active && toPar !== null ? fmtToPar(toPar) : "—"}
                    </span>
                  </div>
                );
              })}
              {sortedDayRows.length === 0 && (
                <p className="text-center text-slate-600 text-sm mt-6">
                  No scores recorded yet for {currentDayInfo?.label}.
                </p>
              )}
            </div>

            {/* CTP for the day */}
            {ctpEntries.length > 0 && (
              <div>
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">📍 Closest to Pin</p>
                <div className="space-y-2">
                  {ctpEntries.map((e, i) => (
                    <div key={i} className="bg-slate-800 rounded-xl px-4 py-2.5 flex items-center justify-between">
                      <div>
                        <p className="text-xs text-slate-500">Hole {e.hole}</p>
                        <p className="text-sm font-semibold text-emerald-400">🏆 {e.winner}</p>
                      </div>
                      {e.note && <span className="text-xs text-slate-400 italic">{e.note}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        <p className="text-xs text-slate-700 text-center mt-6">Michigan Golf Trip 2026 · Live scoring</p>
      </div>
    </main>
  );
}
