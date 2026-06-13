"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import Image from "next/image";
import { useParams, useRouter } from "next/navigation";
import {
  doc,
  onSnapshot,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

// ─── Courses with greens images ─────────────────────────────────────────────
const COURSES_WITH_GREENS = new Set([
  "spruce-run",
  "the-bear",
  "arcadia-bluffs-south",
  "arcadia-bluffs",
  "bay-harbor-links",
  "forest-dunes",
]);

const ALL_PLAYERS = [
  "Craig Lauderdale", "Jay Norwood", "Dave Laurance",
  "Aaron Schliefer", "Frank Moslander", "Rick Lund",
];

// ─── Types ───────────────────────────────────────────────────────────────────

type ContestWinnerNote = { winner?: string | null; note?: string | null };

type MichiganGroupDoc = {
  day?: string;
  groupName?: string;
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function coerceScoreTable(players: string[], input?: Record<string, (number | null)[]> | null) {
  const next: Record<string, (number | null)[]> = {};
  for (const p of players) {
    const existing = input?.[p];
    next[p] = Array.from({ length: HOLE_COUNT }, (_, i) => {
      const v = Array.isArray(existing) ? existing[i] : undefined;
      return typeof v === "number" && Number.isFinite(v) ? v : null;
    });
  }
  return next;
}

function coerceHandicaps(players: string[], input?: Record<string, number | null> | null) {
  const next: Record<string, number> = {};
  for (const p of players) {
    const v = input?.[p];
    next[p] = typeof v === "number" && Number.isFinite(v) ? v : 0;
  }
  return next;
}

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

function netTotal(scores: (number | null)[], hcps: number[] | null, handicap: number): number {
  const gross = arrSum(scores);
  if (!hcps || hcps.length !== HOLE_COUNT) {
    return isCompleteRound(scores) ? gross - Math.floor(handicap) : gross;
  }
  const strokes = scores.reduce<number>((acc, v, i) =>
    typeof v === "number" ? acc + strokesForHole(hcps[i], handicap) : acc, 0);
  return gross - strokes;
}

function toParSoFar(scores: (number | null)[], pars: number[] | null): number | null {
  if (!pars || pars.length !== HOLE_COUNT) return null;
  let g = 0, p = 0, n = 0;
  scores.forEach((v, i) => { if (typeof v === "number") { g += v; p += pars[i] ?? 0; n++; } });
  return n === 0 ? null : g - p;
}

function getScoreLabel(score: number | null, par: number): string {
  if (score === null) return "";
  const diff = score - par;
  if (diff <= -2) return "Eagle";
  if (diff === -1) return "Birdie";
  if (diff === 0) return "Par";
  if (diff === 1) return "Bogey";
  if (diff === 2) return "Double";
  return `+${diff}`;
}

function getScoreColor(score: number | null, par: number): string {
  if (score === null) return "bg-zinc-700 text-zinc-400";
  const diff = score - par;
  if (diff <= -2) return "bg-yellow-400 text-zinc-900";
  if (diff === -1) return "bg-red-500 text-white";
  if (diff === 0) return "bg-emerald-600 text-white";
  if (diff === 1) return "bg-zinc-600 text-white";
  if (diff === 2) return "bg-zinc-700 text-zinc-300";
  return "bg-zinc-800 text-zinc-400";
}

function fmtToPar(v: number | null): string {
  if (v == null) return "—";
  return v === 0 ? "E" : v < 0 ? String(v) : `+${v}`;
}

// ─── Score Button ─────────────────────────────────────────────────────────────

function ScoreButton({
  value,
  par,
  onChange,
}: {
  value: number | null;
  par: number;
  onChange: (v: number | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function startEdit() {
    setDraft(value !== null ? String(value) : "");
    setEditing(true);
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  function commit() {
    const n = parseInt(draft, 10);
    onChange(Number.isFinite(n) && n > 0 ? n : null);
    setEditing(false);
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setEditing(false);
        }}
        inputMode="numeric"
        pattern="[0-9]*"
        className="w-16 h-16 text-2xl font-bold text-center rounded-2xl bg-white text-zinc-900 border-2 border-blue-400 outline-none"
      />
    );
  }

  return (
    <button
      onClick={startEdit}
      className={`w-16 h-16 rounded-2xl flex flex-col items-center justify-center transition-all active:scale-95 ${getScoreColor(value, par)}`}
    >
      <span className="text-2xl font-bold leading-none">
        {value !== null ? value : "–"}
      </span>
      {getScoreLabel(value, par) && (
        <span className="text-[10px] font-semibold opacity-75 mt-0.5 leading-none">
          {getScoreLabel(value, par)}
        </span>
      )}
    </button>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function MichiganScoringPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const router = useRouter();

  const [group, setGroup] = useState<MichiganGroupDoc | null>(null);
  const [scores, setScores] = useState<Record<string, (number | null)[]>>({});
  const [handicaps, setHandicaps] = useState<Record<string, number>>({});
  const [ctpEdit, setCtpEdit] = useState<Record<string, { winner: string; note: string }>>({});
  const [currentHole, setCurrentHole] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<"score" | "leaderboard">("score");
  const [currentPlayer, setCurrentPlayer] = useState<string | null>(null);
  const [showGreenModal, setShowGreenModal] = useState(false);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ctpSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Read player name from sessionStorage
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("michigan_player");
      if (raw) {
        const data = JSON.parse(raw);
        setCurrentPlayer(data.name ?? null);
      }
    } catch { /* ignore */ }
  }, []);

  const players = useMemo(() => group?.players ?? [], [group]);
  const pars = useMemo(() => {
    const p = group?.pars;
    return Array.isArray(p) && p.length === HOLE_COUNT ? p : null;
  }, [group]);
  const hcps = useMemo(() => {
    const h = group?.hcps;
    return Array.isArray(h) && h.length === HOLE_COUNT ? h : null;
  }, [group]);

  const par3Holes = useMemo(() => {
    if (!pars) return [] as number[];
    return pars.map((p, i) => (p === 3 ? i + 1 : null)).filter((v): v is number => v !== null);
  }, [pars]);

  const currentPar = pars ? pars[currentHole] : 4;
  const currentHcp = hcps ? hcps[currentHole] : currentHole + 1;
  const parThrough = pars
    ? pars.slice(0, currentHole + 1).reduce((a, p) => a + p, 0)
    : (currentHole + 1) * 4;

  // Firestore subscription
  useEffect(() => {
    if (!groupId) return;
    setLoading(true);
    const unsub = onSnapshot(
      doc(db, "michigan", groupId),
      (snap) => {
        if (!snap.exists()) {
          setError("Group not found. Ask admin to initialize the tournament.");
          setLoading(false);
          return;
        }
        const data = snap.data() as MichiganGroupDoc;
        setGroup(data);
        const pl = (data.players ?? []).filter(Boolean);
        setScores(coerceScoreTable(pl, data.scores ?? null));
        setHandicaps(coerceHandicaps(pl, data.handicaps ?? null));

        // CTP
        const ctpMap = data.contest?.closestToPinByHole ?? {};
        const next: Record<string, { winner: string; note: string }> = {};
        for (const [hole, v] of Object.entries(ctpMap)) {
          next[hole] = { winner: v?.winner ?? "", note: v?.note ?? "" };
        }
        setCtpEdit(next);
        setLoading(false);
      },
      () => { setError("Failed to connect to Firebase."); setLoading(false); }
    );
    return () => unsub();
  }, [groupId]);

  function scheduleSave(nextScores: Record<string, (number | null)[]>) {
    if (!groupId) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      setSaving(true);
      try {
        await updateDoc(doc(db, "michigan", groupId), {
          scores: nextScores,
          updatedAt: serverTimestamp(),
        });
      } catch {
        setError("Save failed. Check connection.");
      } finally {
        setSaving(false);
      }
    }, 600);
  }

  function handleScoreChange(player: string, holeIdx: number, value: number | null) {
    const nextScores = {
      ...scores,
      [player]: Array.from({ length: HOLE_COUNT }, (_, i) =>
        i === holeIdx ? value : (scores[player]?.[i] ?? null)
      ),
    };
    setScores(nextScores);
    scheduleSave(nextScores);
  }

  function updateCtp(holeNumber: number, field: "winner" | "note", value: string) {
    const key = String(holeNumber);
    setCtpEdit((prev) => ({
      ...prev,
      [key]: { winner: prev[key]?.winner ?? "", note: prev[key]?.note ?? "", [field]: value },
    }));

    if (ctpSaveTimerRef.current) clearTimeout(ctpSaveTimerRef.current);
    ctpSaveTimerRef.current = setTimeout(async () => {
      if (!groupId) return;
      try {
        const currentEdit = { ...ctpEdit, [key]: { winner: ctpEdit[key]?.winner ?? "", note: ctpEdit[key]?.note ?? "", [field]: value } };
        const entry = currentEdit[key];
        const winner = entry.winner.trim() || null;
        const note = entry.note.trim() || null;
        await updateDoc(doc(db, "michigan", groupId), {
          [`contest.closestToPinByHole.${key}`]: { winner, note },
          updatedAt: serverTimestamp(),
        });
      } catch { /* silent */ }
    }, 800);
  }

  // Leaderboard for this group
  const leaderboard = useMemo(() => {
    return players
      .map((p) => {
        const s = scores[p] ?? Array.from({ length: HOLE_COUNT }, () => null);
        const gross = arrSum(s);
        const hcp = handicaps[p] ?? 0;
        const net = netTotal(s, hcps, hcp);
        const toPar = toParSoFar(s, pars);
        const holesPlayed = s.filter((v) => typeof v === "number").length;
        return { player: p, gross, net, toPar, holesPlayed };
      })
      .sort((a, b) => {
        if (a.holesPlayed === 0 && b.holesPlayed > 0) return 1;
        if (b.holesPlayed === 0 && a.holesPlayed > 0) return -1;
        return a.net - b.net || a.gross - b.gross;
      });
  }, [players, scores, handicaps, hcps, pars]);

  // ─── Loading / Error ───────────────────────────────────────────────────────

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
          <p className="text-slate-400 text-sm">Loading…</p>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen bg-slate-900 flex items-center justify-center p-6">
        <div className="text-center">
          <p className="text-red-400 mb-4">{error}</p>
          <button
            onClick={() => router.push("/michigan")}
            className="bg-slate-700 text-slate-300 rounded-xl px-4 py-2 text-sm"
          >
            ← Back
          </button>
        </div>
      </main>
    );
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  const groupTitle = group?.groupName ?? groupId;
  const courseName = group?.courseName ?? group?.course ?? "Michigan";
  const courseKey = group?.course ?? null;
  const hasGreenImage = courseKey ? COURSES_WITH_GREENS.has(courseKey) : false;
  const greenImageSrc = hasGreenImage && courseKey
    ? `/greens/${courseKey}/hole-${currentHole + 1}.png`
    : null;
  const dayLabel = group?.day ?? "";
  const dateLabel = group?.date ?? "";

  return (
    <main className="min-h-screen bg-slate-900 text-white pb-24">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-slate-900/95 backdrop-blur border-b border-slate-800 px-4 py-3">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold tracking-widest text-blue-400 uppercase">
              {courseName}{dateLabel ? ` · ${dateLabel}` : ""}
            </p>
            <h1 className="text-base font-bold text-white leading-tight">{groupTitle}</h1>
          </div>
          <div className="flex items-center gap-2">
            {saving && (
              <div className="w-4 h-4 border border-blue-500 border-t-transparent rounded-full animate-spin" />
            )}
            <button
              onClick={() => router.push("/michigan")}
              className="bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-xl px-3 py-1.5 text-xs transition-colors"
            >
              ← Home
            </button>
          </div>
        </div>

        {/* Tab selector */}
        <div className="max-w-lg mx-auto flex gap-2 mt-3">
          {(["score", "leaderboard"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-2 rounded-xl text-sm font-semibold transition-colors ${
                tab === t ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700"
              }`}
            >
              {t === "score" ? "⛳ Score" : "📊 Standings"}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 pt-4">
        {tab === "score" ? (
          <>
            {/* Hole info */}
            {!pars && (
              <div className="mb-4 bg-amber-900/30 border border-amber-700 rounded-xl px-4 py-3 text-sm text-amber-300">
                ⚠️ Pars not configured yet. Ask admin to set up pars and handicaps for this round.
              </div>
            )}

            <div className="mb-4 bg-slate-800 rounded-2xl px-4 py-3 flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-500 font-semibold uppercase tracking-wide">Hole {currentHole + 1} of 18</p>
                <p className="text-2xl font-bold text-white mt-0.5">
                  Par {currentPar}
                  <span className="text-sm font-normal text-slate-400 ml-2">Hdcp {currentHcp}</span>
                </p>
                {par3Holes.includes(currentHole + 1) && (
                  <p className="text-xs text-emerald-400 font-semibold mt-0.5">📍 Closest to Pin hole</p>
                )}
              </div>
              <div className="flex flex-col items-end gap-2">
                <div className="text-right">
                  <p className="text-xs text-slate-500">Par through</p>
                  <p className="text-lg font-bold text-slate-300">{parThrough}</p>
                </div>
                {hasGreenImage && (
                  <button
                    onClick={() => setShowGreenModal(true)}
                    className="bg-emerald-700 hover:bg-emerald-600 active:scale-95 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-all"
                  >
                    🗺️ Green
                  </button>
                )}
              </div>
            </div>

            {/* Hole navigation */}
            <div className="flex gap-1 mb-4 flex-wrap">
              {Array.from({ length: 18 }, (_, i) => {
                // Determine if any player has scored this hole
                const hasScore = players.some((p) => typeof scores[p]?.[i] === "number");
                return (
                  <button
                    key={i}
                    onClick={() => setCurrentHole(i)}
                    className={`w-9 h-9 rounded-lg text-xs font-bold transition-all ${
                      i === currentHole
                        ? "bg-blue-500 text-white"
                        : hasScore
                        ? "bg-slate-600 text-white"
                        : "bg-slate-800 text-slate-500"
                    }`}
                  >
                    {i + 1}
                  </button>
                );
              })}
            </div>

            {/* Score entries */}
            <div className="space-y-3 mb-6">
              {players.map((player) => {
                const isMe = player === currentPlayer;
                const holeScore = scores[player]?.[currentHole] ?? null;
                const runningGross = arrSum((scores[player] ?? []).slice(0, currentHole + 1));
                const runningToPar = pars
                  ? runningGross - pars.slice(0, currentHole + 1).reduce((a, p) => a + p, 0)
                  : null;

                return (
                  <div
                    key={player}
                    className={`bg-slate-800 rounded-2xl px-4 py-3 flex items-center gap-3 ${
                      isMe ? "ring-1 ring-blue-500" : ""
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-semibold truncate ${isMe ? "text-blue-300" : "text-white"}`}>
                        {player}
                        {isMe && <span className="text-[10px] text-blue-400 ml-1">(you)</span>}
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {runningGross > 0
                          ? `${runningGross}${runningToPar !== null ? ` (${fmtToPar(runningToPar)})` : ""}`
                          : "No score yet"}
                        {" · "}Hcp {handicaps[player] ?? 0}
                      </p>
                    </div>
                    <ScoreButton
                      value={holeScore}
                      par={currentPar}
                      onChange={(v) => handleScoreChange(player, currentHole, v)}
                    />
                  </div>
                );
              })}
            </div>

            {/* Hole navigation buttons */}
            <div className="flex gap-3">
              <button
                onClick={() => setCurrentHole((h) => Math.max(0, h - 1))}
                disabled={currentHole === 0}
                className="flex-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-white rounded-xl py-3 text-sm font-semibold transition-colors"
              >
                ← Prev
              </button>
              <button
                onClick={() => setCurrentHole((h) => Math.min(17, h + 1))}
                disabled={currentHole === 17}
                className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded-xl py-3 text-sm font-semibold transition-colors"
              >
                Next →
              </button>
            </div>

            {/* Closest to Pin section */}
            {par3Holes.length > 0 && (
              <div className="mt-6">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">
                  📍 Closest to Pin
                </p>
                <div className="space-y-2">
                  {par3Holes.map((holeNum) => {
                    const key = String(holeNum);
                    const entry = ctpEdit[key];
                    const par3Par = pars ? pars[holeNum - 1] : 3;
                    return (
                      <div key={holeNum} className="bg-slate-800 rounded-xl px-4 py-3">
                        <p className="text-xs font-semibold text-slate-400 mb-2">Hole {holeNum} (Par {par3Par})</p>
                        <div className="flex gap-2">
                          <select
                            value={entry?.winner ?? ""}
                            onChange={(e) => updateCtp(holeNum, "winner", e.target.value)}
                            className="flex-1 bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                          >
                            <option value="">Select winner…</option>
                            {ALL_PLAYERS.map((p) => <option key={p} value={p}>{p}</option>)}
                          </select>
                          <input
                            value={entry?.note ?? ""}
                            onChange={(e) => updateCtp(holeNum, "note", e.target.value)}
                            placeholder="Distance…"
                            className="w-28 bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
                          />
                        </div>
                        {entry?.winner && (
                          <p className="text-xs text-emerald-400 mt-1.5">
                            🏆 {entry.winner}{entry.note ? ` — ${entry.note}` : ""}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        ) : (
          /* Leaderboard tab */
          <div>
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">
              {groupTitle} · Standings
            </p>
            <div className="space-y-2">
              {leaderboard.map((r, i) => {
                const active = r.holesPlayed > 0;
                const finished = r.holesPlayed === 18;
                return (
                  <div
                    key={r.player}
                    className={`flex items-center gap-3 rounded-xl px-3 py-3 ${
                      i === 0 && active ? "bg-blue-900/30 border border-blue-800/50" : "bg-slate-800"
                    }`}
                  >
                    <span className={`text-sm font-bold w-6 shrink-0 ${i === 0 && active ? "text-blue-400" : "text-slate-600"}`}>
                      {active ? i + 1 : "—"}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-semibold truncate ${r.player === currentPlayer ? "text-blue-300" : "text-white"}`}>
                        {r.player}
                      </p>
                      <p className="text-[11px] text-slate-500">Hcp {handicaps[r.player] ?? 0}</p>
                    </div>
                    <span className={`text-xs w-8 text-right shrink-0 font-semibold ${finished ? "text-emerald-400" : "text-slate-500"}`}>
                      {active ? (finished ? "F" : `T${r.holesPlayed}`) : "—"}
                    </span>
                    <span className="text-xs text-slate-500 w-14 text-right shrink-0">
                      {active ? `G: ${r.gross}` : "—"}
                    </span>
                    <span className={`text-sm font-bold w-12 text-right shrink-0 ${active ? "text-white" : "text-slate-600"}`}>
                      {active ? `N: ${r.net}` : "—"}
                    </span>
                    <span
                      className={`text-sm font-semibold w-10 text-right shrink-0 ${
                        active && r.toPar !== null && r.toPar < 0
                          ? "text-red-400"
                          : active && r.toPar === 0
                          ? "text-emerald-400"
                          : "text-slate-500"
                      }`}
                    >
                      {active && r.toPar !== null ? fmtToPar(r.toPar) : "—"}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* CTP Summary */}
            {par3Holes.length > 0 && Object.keys(ctpEdit).some((k) => ctpEdit[k]?.winner) && (
              <div className="mt-6">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">📍 Closest to Pin</p>
                {par3Holes.map((holeNum) => {
                  const entry = ctpEdit[String(holeNum)];
                  if (!entry?.winner) return null;
                  return (
                    <div key={holeNum} className="bg-slate-800 rounded-xl px-4 py-2.5 mb-2 flex items-center justify-between">
                      <span className="text-sm text-slate-400">Hole {holeNum}</span>
                      <span className="text-sm font-semibold text-emerald-400">
                        🏆 {entry.winner}{entry.note ? ` — ${entry.note}` : ""}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
      {/* Green view modal */}
      {showGreenModal && greenImageSrc && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setShowGreenModal(false)}
        >
          <div
            className="relative bg-slate-900 rounded-2xl overflow-hidden max-w-sm w-full shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700">
              <p className="text-sm font-semibold text-white">
                Hole {currentHole + 1} · {courseName}
              </p>
              <button
                onClick={() => setShowGreenModal(false)}
                className="text-slate-400 hover:text-white text-xl leading-none px-1"
              >
                ✕
              </button>
            </div>
            <div className="relative w-full">
              <Image
                src={greenImageSrc}
                alt={`Hole ${currentHole + 1} green view`}
                width={768}
                height={806}
                className="w-full h-auto"
                priority
              />
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
