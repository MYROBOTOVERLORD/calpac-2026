"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";

// ─── Types ───────────────────────────────────────────────────────────────────

type DayKey = "day1" | "day2";

type GroupDoc = {
  id: string;
  groupName?: string;
  groupname?: string;
  playerNames?: string[];
  playerNamesByDay?: { day1?: string[]; day2?: string[] };
  scores?: Record<string, Array<number | null>> | { day1?: Record<string, Array<number | null>>; day2?: Record<string, Array<number | null>> };
  handicaps?: Record<string, number | null>;
  day2HandicapAdjustments?: Record<string, number | null>;
  teeChoices?: { day1?: Record<string, string | null>; day2?: Record<string, string | null> };
  charityStrokes?: Record<string, number | null>;
  treeStrokes?: Record<string, number | null>;
  tournament?: {
    day1Course?: string;
    day2Course?: string;
    day1Pars?: number[];
    day2Pars?: number[];
    day1Hcps?: number[];
    day2Hcps?: number[];
  };
};

type PlayerRow = {
  player: string;
  group: string;
  gross: number;
  grossToPar: number | null;
  net: number;
  netToPar: number | null;
  holesPlayed: number;
  teeKey: string | null;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const HOLE_COUNT = 18;

function arrSum(arr: Array<number | null>): number {
  return arr.reduce<number>((a, v) => (typeof v === "number" ? a + v : a), 0);
}

function isCompleteRound(arr?: Array<number | null>): boolean {
  return !!arr && arr.length === HOLE_COUNT && arr.every((v) => typeof v === "number");
}

function strokesForHole(idx: number, total: number): number {
  const s = Math.floor(total);
  if (!Number.isFinite(idx) || idx < 1 || idx > 18 || s <= 0) return 0;
  if (s < idx) return 0;
  return 1 + Math.floor((s - idx) / 18);
}

function netRunning(scores: Array<number | null>, hcps: number[] | null, total: number): number {
  const gross = arrSum(scores);
  if (!hcps || hcps.length !== HOLE_COUNT) return isCompleteRound(scores) ? gross - Math.floor(total) : gross;
  return gross - scores.reduce<number>((acc, v, i) => (typeof v === "number" ? acc + strokesForHole(hcps[i], total) : acc), 0);
}

function toParSoFar(scores: Array<number | null>, pars: number[] | null): number | null {
  if (!pars || pars.length !== HOLE_COUNT) return null;
  let g = 0, p = 0, n = 0;
  scores.forEach((v, i) => { if (typeof v === "number") { g += v; p += pars[i] ?? 0; n++; } });
  return n === 0 ? null : g - p;
}

function applyCharity(net: number, scores: Array<number | null>, charity: number): number {
  const c = Math.floor(charity);
  return c > 0 && isCompleteRound(scores) ? net - c : net;
}

function teeBonusForDay(day: DayKey, tee?: string | null): number {
  return day === "day1" && tee === "three" ? -1 : 0;
}

function fmtToPar(v: number | null): string {
  if (v == null) return "—";
  return v === 0 ? "E" : v < 0 ? String(v) : `+${v}`;
}

function getScoresForDay(data: GroupDoc, day: DayKey): Record<string, Array<number | null>> {
  const raw = data.scores as Record<string, unknown>;
  if (!raw) return {};
  const isOld = !("day1" in raw) && !("day2" in raw);
  if (isOld) return day === "day1" ? (raw as Record<string, Array<number | null>>) : {};
  return (raw[day] as Record<string, Array<number | null>>) ?? {};
}

function grossToParSoFar(scores: Array<number | null>, pars: number[] | null): number | null {
  if (!pars || pars.length !== HOLE_COUNT) return null;
  let g = 0, p = 0, n = 0;
  scores.forEach((v, i) => { if (typeof v === "number") { g += v; p += pars[i] ?? 0; n++; } });
  return n === 0 ? null : g - p;
}

function computeLeaderboard(groups: GroupDoc[], day: DayKey): PlayerRow[] {
  const rows: PlayerRow[] = [];
  for (const g of groups) {
    const groupName = g.groupName ?? g.groupname ?? "Group";
    const legacy = (g.playerNames ?? []).filter(Boolean) as string[];
    const players = ((day === "day1" ? g.playerNamesByDay?.day1 : g.playerNamesByDay?.day2) ?? legacy).filter(Boolean) as string[];
    const dayScores = getScoresForDay(g, day);
    const pars = day === "day1" ? g.tournament?.day1Pars : g.tournament?.day2Pars;
    const hcps = day === "day1" ? g.tournament?.day1Hcps : g.tournament?.day2Hcps;
    const parsValid = Array.isArray(pars) && pars.length === HOLE_COUNT ? pars : null;
    const hcpsValid = Array.isArray(hcps) && hcps.length === HOLE_COUNT ? hcps : null;
    for (const p of players) {
      const s: Array<number | null> = Array.isArray(dayScores[p])
        ? (dayScores[p] as Array<number | null>)
        : Array.from({ length: HOLE_COUNT }, () => null);
      const hcp = ((g.handicaps?.[p] ?? 0) as number);
      const adj = day === "day2" ? ((g.day2HandicapAdjustments?.[p] ?? 0) as number) : 0;
      const teeKey = day === "day1" ? g.teeChoices?.day1?.[p] : g.teeChoices?.day2?.[p];
      const teeBonus = teeBonusForDay(day, teeKey);
      const charity = ((g.charityStrokes?.[p] ?? 0) as number) + ((g.treeStrokes?.[p] ?? 0) as number);
      const baseNet = applyCharity(netRunning(s, hcpsValid, hcp + adj), s, charity);
      const net = isCompleteRound(s) ? baseNet + teeBonus : baseNet;
      const holesPlayed = s.filter((v) => typeof v === "number").length;
      rows.push({
        player: p,
        group: groupName,
        gross: arrSum(s),
        grossToPar: grossToParSoFar(s, parsValid),
        net,
        netToPar: toParSoFar(s, parsValid),
        holesPlayed,
        teeKey: teeKey ?? null,
      });
    }
  }
  return rows;
}

function sortedGross(rows: PlayerRow[]): PlayerRow[] {
  return [...rows].sort((a, b) => {
    if (a.holesPlayed === 0 && b.holesPlayed > 0) return 1;
    if (b.holesPlayed === 0 && a.holesPlayed > 0) return -1;
    if (a.grossToPar !== null && b.grossToPar !== null) return a.grossToPar - b.grossToPar || a.gross - b.gross;
    return a.gross - b.gross;
  });
}

function sortedNet(rows: PlayerRow[]): PlayerRow[] {
  return [...rows].sort((a, b) => {
    if (a.holesPlayed === 0 && b.holesPlayed > 0) return 1;
    if (b.holesPlayed === 0 && a.holesPlayed > 0) return -1;
    if (a.netToPar !== null && b.netToPar !== null) return a.netToPar - b.netToPar || a.net - b.net || a.gross - b.gross;
    return a.net - b.net || a.gross - b.gross;
  });
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function LeaderboardPage() {
  const router = useRouter();
  const [groups, setGroups] = useState<GroupDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState<DayKey>("day1");
  const [boardType, setBoardType] = useState<"net" | "gross">("net");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "groups"),
      (snap) => {
        setGroups(snap.docs.map((d) => ({ id: d.id, ...d.data() } as GroupDoc)));
        setLastUpdated(new Date());
        setLoading(false);
      },
      () => setLoading(false)
    );
    return () => unsub();
  }, []);

  const allRows = useMemo(() => computeLeaderboard(groups, selectedDay), [groups, selectedDay]);
  const leaderboard = useMemo(() => boardType === "gross" ? sortedGross(allRows) : sortedNet(allRows), [allRows, boardType]);

  const courseName = useMemo(() => {
    const names = new Set(
      groups
        .map((g) => (selectedDay === "day1" ? g.tournament?.day1Course : g.tournament?.day2Course))
        .filter(Boolean)
    );
    return [...names].join(" / ") || (selectedDay === "day1" ? "Old Greenwood" : "Grays Crossing");
  }, [groups, selectedDay]);

  if (loading) {
    return (
      <main className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-zinc-400 text-sm">Loading leaderboard…</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      <div className="max-w-lg mx-auto px-4 py-6">

        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl font-bold">Cal-Pac Classic 2026</h1>
            <p className="text-xs text-zinc-500 mt-0.5">
              {lastUpdated
                ? `Updated ${lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                : "Live"}
            </p>
          </div>
          <button
            onClick={() => router.back()}
            className="bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 rounded-xl px-3 py-2 text-sm transition-colors"
          >
            ← Back to scoring
          </button>
        </div>

        {/* Day selector */}
        <div className="flex gap-2 mb-3">
          {(["day1", "day2"] as DayKey[]).map((d) => (
            <button
              key={d}
              onClick={() => setSelectedDay(d)}
              className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-colors ${
                selectedDay === d ? "bg-emerald-600 text-white" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
              }`}
            >
              {d === "day1" ? "Day 1" : "Day 2"}
            </button>
          ))}
        </div>

        {/* Board type selector */}
        <div className="flex gap-2 mb-4">
          {(["net", "gross"] as const).map((b) => (
            <button
              key={b}
              onClick={() => setBoardType(b)}
              className={`flex-1 py-2 rounded-xl text-sm font-semibold transition-colors ${
                boardType === b ? "bg-zinc-200 text-zinc-900" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
              }`}
            >
              {b === "net" ? "Net" : "Gross"}
            </button>
          ))}
        </div>

        <p className="text-xs text-zinc-500 uppercase tracking-wide font-semibold mb-3">
          {courseName} · {boardType === "net" ? "Net" : "Gross"} leaderboard
        </p>

        {/* Column headers */}
        <div className="flex items-center px-3 mb-1 gap-2">
          <span className="w-6 shrink-0" />
          <span className="flex-1" />
          <span className="text-[10px] text-zinc-600 w-8 text-right shrink-0">Thru</span>
          <span className="text-[10px] text-zinc-600 w-10 text-right shrink-0">{boardType === "net" ? "Net" : "Gross"}</span>
          <span className="text-[10px] text-zinc-600 w-10 text-right shrink-0">To Par</span>
        </div>

        {/* Rows */}
        <div className="space-y-1.5">
          {leaderboard.map((r, i) => {
            const active = r.holesPlayed > 0;
            const finished = r.holesPlayed === HOLE_COUNT;
            const thru = finished ? "F" : active ? String(r.holesPlayed) : "—";
            const score = boardType === "net" ? r.net : r.gross;
            const toPar = boardType === "net" ? r.netToPar : r.grossToPar;
            return (
              <div
                key={`${r.player}-${r.group}`}
                className={`flex items-center gap-2 rounded-xl px-3 py-3 ${
                  i === 0 && active
                    ? "bg-emerald-900/40 border border-emerald-800/50"
                    : "bg-zinc-900"
                }`}
              >
                <span className={`text-sm font-bold w-6 shrink-0 ${i === 0 && active ? "text-emerald-400" : "text-zinc-600"}`}>
                  {active ? i + 1 : "—"}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white truncate">{r.player}</p>
                  <p className="text-[11px] text-zinc-500 truncate">{r.group}</p>
                  {finished && r.teeKey === "three" && (
                    <span className="inline-block mt-0.5 text-[10px] font-bold text-yellow-400 bg-yellow-400/10 border border-yellow-400/30 rounded px-1.5 py-0.5">
                      3 Trees −1
                    </span>
                  )}
                </div>
                <span className={`text-xs w-8 text-right shrink-0 font-semibold ${finished ? "text-emerald-400" : "text-zinc-500"}`}>
                  {thru}
                </span>
                <span className="text-sm font-bold text-white w-10 text-right shrink-0">
                  {active ? score : "—"}
                </span>
                <span
                  className={`text-sm font-semibold w-10 text-right shrink-0 ${
                    active && toPar != null && toPar < 0
                      ? "text-red-400"
                      : active && toPar === 0
                      ? "text-emerald-400"
                      : "text-zinc-500"
                  }`}
                >
                  {active ? fmtToPar(toPar) : "—"}
                </span>
              </div>
            );
          })}
          {leaderboard.length === 0 && (
            <p className="text-center text-zinc-600 text-sm mt-10">No scores recorded yet.</p>
          )}
        </div>

        <p className="text-xs text-zinc-700 text-center mt-6">Updates automatically · low score wins</p>
      </div>
    </main>
  );
}
