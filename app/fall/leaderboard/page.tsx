"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { FALL_ROUNDS } from "@/lib/fallSeries";
import { COURSES } from "@/lib/courses";

const HOLE_COUNT = 18;

type FallGroupDoc = {
  id: string;
  round?: string;
  groupName?: string;
  players?: string[];
  courseId?: string | null;
  courseName?: string;
  scores?: Record<string, (number | null)[]>;
  handicaps?: Record<string, number | null>;
};

// ─── Scoring helpers ──────────────────────────────────────────────────────────

function arrSum(arr: (number | null)[]): number {
  return arr.reduce<number>((a, v) => (typeof v === "number" ? a + v : a), 0);
}

function strokesForHole(hcpIdx: number, total: number): number {
  const s = Math.floor(total);
  if (!Number.isFinite(hcpIdx) || hcpIdx < 1 || hcpIdx > 18 || s <= 0) return 0;
  if (s < hcpIdx) return 0;
  return 1 + Math.floor((s - hcpIdx) / 18);
}

function isCompleteRound(arr?: (number | null)[]): boolean {
  return !!arr && arr.length === HOLE_COUNT && arr.every((v) => typeof v === "number");
}

function calcNet(scores: (number | null)[], hcps: number[] | null, handicap: number): number {
  const gross = arrSum(scores);
  if (!hcps || hcps.length !== HOLE_COUNT) return isCompleteRound(scores) ? gross - Math.floor(handicap) : gross;
  return gross - scores.reduce<number>((acc, v, i) => (typeof v === "number" ? acc + strokesForHole(hcps[i], handicap) : acc), 0);
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

function parsHcpsFor(courseId: string | null | undefined): { pars: number[] | null; hcps: number[] | null } {
  const c = courseId ? COURSES[courseId] : null;
  if (!c) return { pars: null, hcps: null };
  return { pars: c.holes.map((h) => h.par), hcps: c.holes.map((h) => h.handicap) };
}

// ─── Row types ────────────────────────────────────────────────────────────────

type DayRow = { player: string; gross: number; net: number; toPar: number | null; holesPlayed: number; handicap: number; groupName: string };
type OverallRow = { player: string; totalNet: number; totalGross: number; roundsPlayed: number; roundsComplete: number };

// ─── Page ────────────────────────────────────────────────────────────────────

export default function FallLeaderboardPage() {
  const router = useRouter();
  const [groups, setGroups] = useState<FallGroupDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string>("overall"); // "overall" | roundKey
  const [boardType, setBoardType] = useState<"net" | "gross">("net");

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "fall"),
      (snap) => {
        setGroups(snap.docs.map((d) => ({ id: d.id, ...d.data() } as FallGroupDoc)));
        setLoading(false);
      },
      () => setLoading(false)
    );
    return () => unsub();
  }, []);

  const dayRows = useMemo((): DayRow[] => {
    if (selected === "overall") return [];
    const roundGroups = groups.filter((g) => g.round === selected);
    const rows: DayRow[] = [];
    for (const g of roundGroups) {
      const { pars, hcps } = parsHcpsFor(g.courseId);
      const players = (g.players ?? []).filter(Boolean);
      for (const p of players) {
        const s = Array.isArray(g.scores?.[p]) ? (g.scores![p] as (number | null)[]) : Array.from({ length: HOLE_COUNT }, () => null);
        const hcp = typeof g.handicaps?.[p] === "number" ? (g.handicaps![p] as number) : 0;
        rows.push({
          player: p,
          gross: arrSum(s),
          net: calcNet(s, hcps, hcp),
          toPar: grossToPar(s, pars),
          holesPlayed: s.filter((v) => typeof v === "number").length,
          handicap: hcp,
          groupName: g.groupName ?? g.id,
        });
      }
    }
    return rows;
  }, [groups, selected]);

  const sortedDayRows = useMemo(() => {
    const rows = [...dayRows];
    return rows.sort((a, b) => {
      if (a.holesPlayed === 0 && b.holesPlayed > 0) return 1;
      if (b.holesPlayed === 0 && a.holesPlayed > 0) return -1;
      if (boardType === "gross") return a.gross - b.gross;
      return a.net - b.net || a.gross - b.gross;
    });
  }, [dayRows, boardType]);

  const overallRows = useMemo((): OverallRow[] => {
    const map = new Map<string, OverallRow>();
    for (const g of groups) {
      const { hcps } = parsHcpsFor(g.courseId);
      const players = (g.players ?? []).filter(Boolean);
      for (const p of players) {
        const s = Array.isArray(g.scores?.[p]) ? (g.scores![p] as (number | null)[]) : Array.from({ length: HOLE_COUNT }, () => null);
        const played = s.filter((v) => typeof v === "number").length;
        if (played === 0) continue;
        const hcp = typeof g.handicaps?.[p] === "number" ? (g.handicaps![p] as number) : 0;
        const e = map.get(p) ?? { player: p, totalNet: 0, totalGross: 0, roundsPlayed: 0, roundsComplete: 0 };
        e.totalGross += arrSum(s);
        e.totalNet += calcNet(s, hcps, hcp);
        e.roundsPlayed += 1;
        if (played === HOLE_COUNT) e.roundsComplete += 1;
        map.set(p, e);
      }
    }
    return [...map.values()].sort((a, b) => a.totalNet - b.totalNet || a.totalGross - b.totalGross);
  }, [groups]);

  if (loading) {
    return (
      <main className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
          <p className="text-zinc-400 text-sm">Loading leaderboard…</p>
        </div>
      </main>
    );
  }

  const selectedRound = FALL_ROUNDS.find((r) => r.roundKey === selected);

  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      <div className="max-w-lg mx-auto px-4 py-6">

        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-[10px] font-bold tracking-widest text-emerald-400 uppercase">Fall Series 2026</p>
            <h1 className="text-xl font-bold text-white">Leaderboard</h1>
          </div>
          <button onClick={() => router.push("/fall")} className="bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 rounded-xl px-3 py-2 text-sm transition-colors">← Back</button>
        </div>

        {/* Round selector */}
        <div className="flex gap-1.5 mb-3 flex-wrap">
          <button
            onClick={() => setSelected("overall")}
            className={`px-3 py-2 rounded-xl text-sm font-semibold transition-colors ${selected === "overall" ? "bg-emerald-600 text-white" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"}`}
          >
            Overall
          </button>
          {FALL_ROUNDS.map((r) => (
            <button
              key={r.roundKey}
              onClick={() => setSelected(r.roundKey)}
              className={`px-3 py-2 rounded-xl text-sm font-semibold transition-colors ${selected === r.roundKey ? "bg-emerald-600 text-white" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"}`}
            >
              R{r.roundKey.replace("round", "")}
            </button>
          ))}
        </div>

        {/* Board type — daily view */}
        {selected !== "overall" && (
          <div className="flex gap-2 mb-4">
            {(["net", "gross"] as const).map((b) => (
              <button
                key={b}
                onClick={() => setBoardType(b)}
                className={`flex-1 py-2 rounded-xl text-sm font-semibold transition-colors ${boardType === b ? "bg-zinc-200 text-zinc-900" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"}`}
              >
                {b === "net" ? "Net" : "Gross"}
              </button>
            ))}
          </div>
        )}

        {/* Label */}
        {selectedRound && (
          <p className="text-xs text-zinc-500 uppercase tracking-wide font-semibold mb-3">
            {selectedRound.label} · {selectedRound.courseName} · {boardType === "net" ? "Net" : "Gross"}
          </p>
        )}
        {selected === "overall" && (
          <p className="text-xs text-zinc-500 uppercase tracking-wide font-semibold mb-3">Total Net across all rounds played</p>
        )}

        {/* Overall */}
        {selected === "overall" && (
          <>
            <div className="flex items-center px-3 mb-1 gap-2">
              <span className="w-6 shrink-0" />
              <span className="flex-1" />
              <span className="text-[10px] text-zinc-600 w-8 text-right shrink-0">Rnds</span>
              <span className="text-[10px] text-zinc-600 w-12 text-right shrink-0">Gross</span>
              <span className="text-[10px] text-zinc-600 w-12 text-right shrink-0">Net</span>
            </div>
            <div className="space-y-1.5 mb-6">
              {overallRows.map((r, i) => (
                <div key={r.player} className={`flex items-center gap-2 rounded-xl px-3 py-3 ${i === 0 ? "bg-emerald-900/40 border border-emerald-800/50" : "bg-zinc-900"}`}>
                  <span className={`text-sm font-bold w-6 shrink-0 ${i === 0 ? "text-emerald-400" : "text-zinc-600"}`}>{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white truncate">{r.player}</p>
                    <p className="text-[11px] text-zinc-500">{r.roundsComplete} complete · {r.roundsPlayed} played</p>
                  </div>
                  <span className="text-xs text-zinc-500 w-8 text-right shrink-0">{r.roundsPlayed}</span>
                  <span className="text-sm text-zinc-400 w-12 text-right shrink-0">{r.totalGross || "—"}</span>
                  <span className={`text-sm font-bold w-12 text-right shrink-0 ${i === 0 ? "text-emerald-400" : "text-white"}`}>{r.totalNet || "—"}</span>
                </div>
              ))}
              {overallRows.length === 0 && <p className="text-center text-zinc-600 text-sm mt-6">No scores recorded yet.</p>}
            </div>
          </>
        )}

        {/* Daily */}
        {selected !== "overall" && (
          <>
            <div className="flex items-center px-3 mb-1 gap-2">
              <span className="w-6 shrink-0" />
              <span className="flex-1" />
              <span className="text-[10px] text-zinc-600 w-8 text-right shrink-0">Thru</span>
              <span className="text-[10px] text-zinc-600 w-12 text-right shrink-0">{boardType === "net" ? "Net" : "Gross"}</span>
              <span className="text-[10px] text-zinc-600 w-10 text-right shrink-0">To Par</span>
            </div>
            <div className="space-y-1.5 mb-6">
              {sortedDayRows.map((r, i) => {
                const active = r.holesPlayed > 0;
                const finished = r.holesPlayed === HOLE_COUNT;
                const score = boardType === "net" ? r.net : r.gross;
                return (
                  <div key={`${r.player}-${r.groupName}`} className={`flex items-center gap-2 rounded-xl px-3 py-3 ${i === 0 && active ? "bg-emerald-900/40 border border-emerald-800/50" : "bg-zinc-900"}`}>
                    <span className={`text-sm font-bold w-6 shrink-0 ${i === 0 && active ? "text-emerald-400" : "text-zinc-600"}`}>{active ? i + 1 : "—"}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-white truncate">{r.player}</p>
                      <p className="text-[11px] text-zinc-500 truncate">{r.groupName} · Hcp {r.handicap}</p>
                    </div>
                    <span className={`text-xs w-8 text-right shrink-0 font-semibold ${finished ? "text-emerald-400" : "text-zinc-500"}`}>{finished ? "F" : active ? String(r.holesPlayed) : "—"}</span>
                    <span className="text-sm font-bold text-white w-12 text-right shrink-0">{active ? score : "—"}</span>
                    <span className={`text-sm font-semibold w-10 text-right shrink-0 ${active && r.toPar !== null && r.toPar < 0 ? "text-red-400" : active && r.toPar === 0 ? "text-emerald-400" : "text-zinc-500"}`}>{active && r.toPar !== null ? fmtToPar(r.toPar) : "—"}</span>
                  </div>
                );
              })}
              {sortedDayRows.length === 0 && (
                <p className="text-center text-zinc-600 text-sm mt-6">No scores recorded yet for {selectedRound?.label}.</p>
              )}
            </div>
          </>
        )}

        <p className="text-xs text-zinc-700 text-center mt-6">Cal-Pacific Fall Series 2026 · Live scoring</p>
      </div>
    </main>
  );
}
