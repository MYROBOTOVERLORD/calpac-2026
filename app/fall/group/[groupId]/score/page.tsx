"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { doc, onSnapshot, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { COURSES, type CourseData, type HoleData } from "@/lib/courses";

// ─── Types ───────────────────────────────────────────────────────────────────

type ContestWinnerNote = { winner?: string | null; note?: string | null };

type FallGroupDoc = {
  round?: string;
  groupName?: string;
  players?: string[];
  courseId?: string | null;
  courseName?: string;
  scores?: Record<string, (number | null)[]>;
  handicaps?: Record<string, number | null>;
  scoresLocked?: boolean;
  contest?: { closestToPinByHole?: Record<string, ContestWinnerNote> };
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

function netRunning(scores: (number | null)[], hcps: number[] | null, handicap: number): number {
  const gross = arrSum(scores);
  if (!hcps || hcps.length !== HOLE_COUNT) {
    return isCompleteRound(scores) ? gross - Math.floor(handicap) : gross;
  }
  return gross - scores.reduce<number>((acc, v, i) => (typeof v === "number" ? acc + strokesForHole(hcps[i], handicap) : acc), 0);
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

function parseFeetInches(raw: string) {
  const s = (raw ?? "").trim();
  if (!s) return { feet: "", inches: "" };
  const apo = s.match(/(\d+)\s*'\s*(\d+)?/);
  if (apo) return { feet: apo[1] ?? "", inches: apo[2] ?? "" };
  const nums = s.match(/\d+/g) ?? [];
  if (nums.length >= 2) return { feet: nums[0] ?? "", inches: nums[1] ?? "" };
  if (nums.length === 1) return { feet: nums[0] ?? "", inches: "" };
  return { feet: "", inches: "" };
}

function formatFeetInches(feet: string, inches: string) {
  const f = feet.trim(), i = inches.trim();
  if (!f && !i) return "";
  const fn = Math.max(0, parseInt(f, 10) || 0);
  const inc = Math.max(0, parseInt(i, 10) || 0);
  const total = fn * 12 + inc;
  return `${Math.floor(total / 12)}' ${total % 12}"`;
}

// ─── Details Popup ───────────────────────────────────────────────────────────

function DetailsPopup({ hole, course, onClose }: {
  hole: HoleData;
  course: CourseData;
  onClose: () => void;
}) {
  const yards = hole.tees[0]?.yardage;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={onClose}>
      <div className="relative w-full max-w-lg mx-4 bg-zinc-900 rounded-3xl overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
          <div>
            <p className="text-xs font-semibold tracking-widest text-emerald-400 uppercase">{course.shortName} · Hole {hole.hole}</p>
            <h3 className="text-xl font-bold text-white mt-0.5">Par {hole.par} · Hdcp {hole.handicap}</h3>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-full bg-zinc-800 hover:bg-zinc-700 flex items-center justify-center text-zinc-400 hover:text-white transition-colors">✕</button>
        </div>

        {hole.greenImageUrl || hole.imageUrl ? (
          <div className="relative w-full bg-zinc-800 flex items-center justify-center max-h-[72vh] overflow-hidden">
            <img src={hole.greenImageUrl ?? hole.imageUrl} alt={`Hole ${hole.hole}`} className="w-full h-auto max-h-[72vh] object-contain" />
          </div>
        ) : (
          <div className="relative w-full aspect-[4/3] bg-gradient-to-br from-emerald-900 via-zinc-900 to-zinc-950 flex items-center justify-center">
            <div className="text-center">
              <p className="text-7xl font-black text-emerald-500/40 leading-none">{hole.hole}</p>
              <p className="text-sm text-zinc-400 mt-3">Par {hole.par}{yards ? ` · ${yards} yds` : ""}</p>
              <p className="text-xs text-zinc-600 mt-1">Handicap {hole.handicap}</p>
            </div>
          </div>
        )}

        <div className="px-5 py-4">
          {hole.description ? (
            <p className="text-sm text-zinc-400 leading-relaxed italic">{hole.description}</p>
          ) : (
            <p className="text-sm text-zinc-500 italic">{course.name} · White tees</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Score Button ─────────────────────────────────────────────────────────────

function ScoreButton({ value, par, disabled, onChange }: {
  value: number | null;
  par: number;
  disabled?: boolean;
  onChange: (v: number | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function startEdit() {
    if (disabled) return;
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
        onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
        inputMode="numeric"
        pattern="[0-9]*"
        className="w-16 h-16 text-2xl font-bold text-center rounded-2xl bg-white text-zinc-900 border-2 border-emerald-400 outline-none"
      />
    );
  }

  return (
    <button
      onClick={startEdit}
      className={`w-16 h-16 rounded-2xl flex flex-col items-center justify-center transition-all active:scale-95 ${disabled ? "bg-zinc-800 text-zinc-600 cursor-not-allowed" : getScoreColor(value, par)}`}
    >
      <span className="text-2xl font-bold leading-none">{value !== null ? value : "–"}</span>
      {getScoreLabel(value, par) && (
        <span className="text-[10px] font-semibold opacity-75 mt-0.5 leading-none">{getScoreLabel(value, par)}</span>
      )}
    </button>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function FallScoringPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const router = useRouter();

  const [group, setGroup] = useState<FallGroupDoc | null>(null);
  const [scores, setScores] = useState<Record<string, (number | null)[]>>({});
  const [handicaps, setHandicaps] = useState<Record<string, number>>({});
  const [ctpEdit, setCtpEdit] = useState<Record<string, { winner: string; note: string }>>({});
  const [currentHole, setCurrentHole] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [currentPlayer, setCurrentPlayer] = useState<string | null>(null);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ctpSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("fall_player");
      if (raw) {
        const data = JSON.parse(raw);
        setCurrentPlayer(data.name ?? null);
      }
    } catch { /* ignore */ }
  }, []);

  const players = useMemo(() => (group?.players ?? []).filter(Boolean), [group]);

  const course: CourseData | null = useMemo(() => {
    const id = group?.courseId;
    return id && COURSES[id] ? COURSES[id] : null;
  }, [group?.courseId]);

  const pars = useMemo(() => (course ? course.holes.map((h) => h.par) : null), [course]);
  const hcps = useMemo(() => (course ? course.holes.map((h) => h.handicap) : null), [course]);

  const par3Holes = useMemo(() => {
    if (!course) return [] as number[];
    return course.holes.filter((h) => h.par === 3).map((h) => h.hole);
  }, [course]);

  const hole: HoleData | null = course ? course.holes[currentHole] : null;

  // Firestore subscription
  useEffect(() => {
    if (!groupId) return;
    setLoading(true);
    const unsub = onSnapshot(
      doc(db, "fall", groupId),
      (snap) => {
        if (!snap.exists()) { setError("Group not found. Ask admin to initialize the Fall Series."); setLoading(false); return; }
        const data = snap.data() as FallGroupDoc;
        setGroup(data);
        const pl = (data.players ?? []).filter(Boolean);
        setScores(coerceScoreTable(pl, data.scores ?? null));
        setHandicaps(coerceHandicaps(pl, data.handicaps ?? null));
        const ctpMap = data.contest?.closestToPinByHole ?? {};
        const next: Record<string, { winner: string; note: string }> = {};
        for (const [h, v] of Object.entries(ctpMap)) next[h] = { winner: v?.winner ?? "", note: v?.note ?? "" };
        setCtpEdit(next);
        setLoading(false);
      },
      () => { setError("Failed to connect."); setLoading(false); }
    );
    return () => unsub();
  }, [groupId]);

  function scheduleSave(nextScores: Record<string, (number | null)[]>) {
    if (!groupId) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      setSaving(true);
      try {
        await updateDoc(doc(db, "fall", groupId), { scores: nextScores, updatedAt: serverTimestamp() });
      } catch {
        setError("Save failed.");
      } finally {
        setSaving(false);
      }
    }, 600);
  }

  const locked = !!group?.scoresLocked;

  function handleScoreChange(player: string, holeIdx: number, value: number | null) {
    if (locked) return;
    const nextScores = {
      ...scores,
      [player]: Array.from({ length: HOLE_COUNT }, (_, i) => (i === holeIdx ? value : (scores[player]?.[i] ?? null))),
    };
    setScores(nextScores);
    scheduleSave(nextScores);
  }

  function updateCtpForHole(holeNumber: number, field: "winner" | "note", value: string) {
    if (locked) return;
    const key = String(holeNumber);
    setCtpEdit((prev) => {
      const existing = prev[key] ?? { winner: "", note: "" };
      const next = { ...prev, [key]: { ...existing, [field]: value } };
      const entry = next[key];
      const winner = entry.winner.trim() || null;
      const note = entry.note.trim() || null;
      if (ctpSaveTimerRef.current) clearTimeout(ctpSaveTimerRef.current);
      ctpSaveTimerRef.current = setTimeout(async () => {
        if (!groupId) return;
        try {
          await updateDoc(doc(db, "fall", groupId), {
            [`contest.closestToPinByHole.${key}`]: { winner, note },
            updatedAt: serverTimestamp(),
          });
        } catch { /* silent */ }
      }, 600);
      return next;
    });
  }

  const runningTotals = useMemo(() => {
    const t: Record<string, number> = {};
    for (const p of players) t[p] = (scores[p] ?? []).slice(0, currentHole + 1).reduce<number>((a, v) => (typeof v === "number" ? a + v : a), 0);
    return t;
  }, [players, scores, currentHole]);

  const grossTotals = useMemo(() => {
    const t: Record<string, number> = {};
    for (const p of players) t[p] = arrSum(scores[p] ?? []);
    return t;
  }, [players, scores]);

  const netTotals = useMemo(() => {
    const t: Record<string, number> = {};
    for (const p of players) t[p] = netRunning(scores[p] ?? [], hcps, handicaps[p] ?? 0);
    return t;
  }, [players, scores, hcps, handicaps]);

  const leaderboard = useMemo(() => {
    return players
      .map((p) => {
        const s = scores[p] ?? Array.from({ length: HOLE_COUNT }, () => null);
        const holesPlayed = s.filter((v) => typeof v === "number").length;
        return { player: p, gross: arrSum(s), net: netRunning(s, hcps, handicaps[p] ?? 0), toPar: toParSoFar(s, pars), holesPlayed };
      })
      .sort((a, b) => {
        if (a.holesPlayed === 0 && b.holesPlayed > 0) return 1;
        if (b.holesPlayed === 0 && a.holesPlayed > 0) return -1;
        return a.net - b.net || a.gross - b.gross;
      });
  }, [players, scores, hcps, handicaps, pars]);

  if (loading) {
    return (
      <main className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-zinc-400 text-sm">Loading group…</p>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen bg-zinc-950 flex items-center justify-center p-6">
        <div className="text-center">
          <p className="text-red-400 mb-4">{error}</p>
          <button onClick={() => router.push("/fall")} className="text-sm text-zinc-400 underline">Back to Fall Series</button>
        </div>
      </main>
    );
  }

  if (!course) {
    return (
      <main className="min-h-screen bg-zinc-950 flex items-center justify-center p-6">
        <div className="text-center text-zinc-400">
          <p className="mb-4">No course is assigned to this round yet.</p>
          <button onClick={() => router.push("/fall")} className="text-sm text-emerald-400 underline">Back to Fall Series</button>
        </div>
      </main>
    );
  }

  if (players.length === 0) {
    return (
      <main className="min-h-screen bg-zinc-950 flex items-center justify-center p-6">
        <div className="text-center text-zinc-400">
          <p className="mb-4">No players assigned to this group yet.</p>
          <button onClick={() => router.push(`/fall/admin`)} className="text-sm text-emerald-400 underline">Open admin</button>
        </div>
      </main>
    );
  }

  const title = group?.groupName ?? groupId;
  const h = hole as HoleData;
  const yards = h.tees[0]?.yardage;

  return (
    <>
      {showDetails && <DetailsPopup hole={h} course={course} onClose={() => setShowDetails(false)} />}

      <main className="min-h-screen bg-zinc-950 text-white max-w-lg mx-auto pb-8">

        {/* ── Top Bar ── */}
        <div className="flex items-center justify-between px-4 pt-4 pb-1">
          <button onClick={() => router.push("/fall")} className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors py-1">
            ← {currentPlayer ? "Change Player" : "Rounds"}
          </button>
          {currentPlayer && <span className="text-xs text-emerald-400 font-semibold">{currentPlayer}</span>}
          <button onClick={() => router.push("/fall/leaderboard")} className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors py-1">
            🏆 Leaderboard
          </button>
        </div>

        {/* ── Hero Image ── */}
        <div className="relative w-full aspect-[16/9] bg-zinc-900 overflow-hidden">
          {h.imageUrl ? (
            <img src={h.imageUrl} alt={`Hole ${h.hole} at ${course.name}`} className="w-full h-full object-cover object-top" />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-emerald-900 via-zinc-900 to-zinc-950 flex items-center justify-center">
              <p className="text-[10rem] font-black text-emerald-500/10 leading-none select-none">{h.hole}</p>
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/80" />

          <div className="absolute top-0 inset-x-0 flex items-center justify-between px-4 pt-3">
            <div className="bg-black/50 backdrop-blur-sm rounded-full px-3 py-1.5 text-xs text-zinc-300">{title}</div>
            <div className="bg-black/50 backdrop-blur-sm rounded-full px-3 py-1.5 text-xs text-zinc-300">
              {course.shortName} · {saving ? "Saving…" : "Saved"}
            </div>
          </div>

          <div className="absolute bottom-0 inset-x-0 px-4 pb-4">
            <div className="flex items-end justify-between">
              <div>
                <p className="text-xs font-semibold tracking-widest text-emerald-400 uppercase mb-1">{course.name}</p>
                <h1 className="text-4xl font-black tracking-tight leading-none">Hole {h.hole}</h1>
                <div className="flex items-center gap-3 mt-2">
                  <span className="bg-white/20 backdrop-blur-sm rounded-full px-3 py-1 text-sm font-semibold">Par {h.par}</span>
                  <span className="bg-white/20 backdrop-blur-sm rounded-full px-3 py-1 text-sm font-semibold">Hdcp {h.handicap}</span>
                  {yards != null && (
                    <span className="bg-white/20 backdrop-blur-sm rounded-full px-3 py-1 text-sm font-semibold">{yards} yds</span>
                  )}
                </div>
              </div>
              <button
                onClick={() => setShowDetails(true)}
                className="flex flex-col items-center gap-1 bg-emerald-600/90 hover:bg-emerald-500 backdrop-blur-sm rounded-2xl px-4 py-3 transition-colors active:scale-95"
              >
                <span className="text-xl">🗺</span>
                <span className="text-[10px] font-bold tracking-wide uppercase">Details</span>
              </button>
            </div>
          </div>
        </div>

        {/* ── Score Inputs ── */}
        <div className="px-4 pt-5 pb-2">
          {locked && (
            <div className="mb-3 bg-yellow-900/30 border border-yellow-800/40 rounded-xl px-3 py-2 text-xs text-yellow-400">
              🔒 Scores are locked by admin
            </div>
          )}
          <div className="space-y-3">
            {players.map((player) => {
              const gross = scores[player]?.[currentHole] ?? null;
              const hdcp = handicaps[player] ?? 0;
              const hcpIdx = hcps?.[currentHole] ?? h.handicap;
              const holeStrokes = strokesForHole(hcpIdx, hdcp);
              const netHole = gross !== null ? gross - holeStrokes : null;
              const rt = runningTotals[player] ?? 0;
              const playerScores = (scores[player] ?? []).slice(0, currentHole + 1);
              const holesPlayed = playerScores.filter((v) => typeof v === "number").length;
              const parForScoredHoles = playerScores.reduce<number>((a, v, i) => (typeof v === "number" ? a + (pars?.[i] ?? 0) : a), 0);
              const diff = rt - parForScoredHoles;

              return (
                <div key={player} className="flex items-center gap-3 bg-zinc-900 rounded-2xl px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-white truncate">{player}</p>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      {gross !== null ? (
                        <>
                          <span>Gross {gross}</span>
                          {holeStrokes > 0 && <span className="text-zinc-400"> · Net {netHole}</span>}
                        </>
                      ) : (
                        <span className="text-zinc-600">No score yet</span>
                      )}
                    </p>
                    {holeStrokes > 0 && <p className="text-xs font-bold text-yellow-400 mt-0.5">−{holeStrokes} Stroke{holeStrokes > 1 ? "s" : ""}</p>}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs text-zinc-500">Thru {holesPlayed || "—"}</p>
                    <p className="text-sm font-bold">
                      {holesPlayed > 0 ? (
                        <span className={diff < 0 ? "text-red-400" : diff === 0 ? "text-emerald-400" : "text-zinc-300"}>
                          {diff === 0 ? "E" : diff > 0 ? `+${diff}` : diff}
                        </span>
                      ) : "—"}
                    </p>
                  </div>
                  <ScoreButton value={gross} par={h.par} disabled={locked} onChange={(v) => handleScoreChange(player, currentHole, v)} />
                  {holeStrokes > 0 && (
                    <div className={`w-10 h-10 rounded-xl flex flex-col items-center justify-center shrink-0 ${getScoreColor(netHole, h.par)}`}>
                      <span className="text-sm font-bold leading-none">{netHole ?? "—"}</span>
                      {netHole !== null && <span className="text-[9px] font-semibold opacity-75 mt-0.5 leading-none">{getScoreLabel(netHole, h.par)}</span>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {h.description && (
            <div className="mt-3 bg-zinc-900/60 rounded-2xl px-4 py-3">
              <p className="text-xs text-zinc-500 italic leading-relaxed">{h.description}</p>
            </div>
          )}
        </div>

        {/* ── Navigation ── */}
        <div className="px-4 py-4 border-t border-zinc-800 mt-3">
          <div className="flex justify-center gap-1.5 mb-4 flex-wrap">
            {course.holes.map((_, i) => {
              const done = players.every((p) => scores[p]?.[i] != null);
              return (
                <button
                  key={i}
                  onClick={() => setCurrentHole(i)}
                  className={`transition-all rounded-full ${i === currentHole ? "w-6 h-2.5 bg-emerald-400" : done ? "w-2.5 h-2.5 bg-emerald-700" : "w-2.5 h-2.5 bg-zinc-700"}`}
                />
              );
            })}
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setCurrentHole((x) => Math.max(0, x - 1))}
              disabled={currentHole === 0}
              className="flex-1 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed rounded-2xl py-4 font-semibold text-sm transition-colors active:scale-95 flex items-center justify-center gap-2"
            >
              ← Hole {currentHole > 0 ? currentHole : "—"}
            </button>
            <div className="text-center px-2">
              <p className="text-2xl font-black">{currentHole + 1}</p>
              <p className="text-xs text-zinc-500">of 18</p>
            </div>
            <button
              onClick={() => setCurrentHole((x) => Math.min(HOLE_COUNT - 1, x + 1))}
              disabled={currentHole === HOLE_COUNT - 1}
              className="flex-1 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed rounded-2xl py-4 font-semibold text-sm transition-colors active:scale-95 flex items-center justify-center gap-2"
            >
              Hole {currentHole < HOLE_COUNT - 1 ? currentHole + 2 : "—"} →
            </button>
          </div>
        </div>

        {/* ── Player Totals ── */}
        <section className="px-4 mt-6">
          <h2 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3">Player Totals</h2>
          <div className="bg-zinc-900 rounded-2xl divide-y divide-zinc-800">
            {players.map((p) => (
              <div key={p} className="flex items-center px-4 py-3 gap-4">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-white truncate">{p}</p>
                  <p className="text-xs text-zinc-500 mt-0.5">Hcp {handicaps[p] ?? 0}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-zinc-500">Gross</p>
                  <p className="text-base font-bold text-white">{grossTotals[p] || "—"}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-zinc-500">Net</p>
                  <p className="text-base font-bold text-emerald-400">{netTotals[p] || "—"}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Contests (CTP) ── */}
        {par3Holes.length > 0 && (
          <section className="px-4 mt-6">
            <h2 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3">Contests</h2>
            <div className="bg-zinc-900 rounded-2xl p-4 space-y-3">
              <p className="text-xs font-semibold text-zinc-400">⛳ Closest to the Pin · Par 3s: {par3Holes.map((x) => `Hole ${x}`).join(", ")}</p>
              {par3Holes.map((x) => {
                const entry = ctpEdit[String(x)] ?? { winner: "", note: "" };
                const dist = parseFeetInches(entry.note);
                return (
                  <div key={x} className="bg-zinc-800 rounded-xl p-3">
                    <p className="text-xs text-zinc-500 font-semibold mb-2">Hole {x} · Par 3</p>
                    <div className="flex gap-2">
                      <input
                        value={entry.winner}
                        onChange={(e) => updateCtpForHole(x, "winner", e.target.value)}
                        placeholder="Winner name"
                        className="flex-1 bg-zinc-700 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                      <input
                        value={dist.feet}
                        onChange={(e) => updateCtpForHole(x, "note", formatFeetInches(e.target.value, dist.inches))}
                        inputMode="numeric"
                        placeholder="Ft"
                        className="w-14 bg-zinc-700 border border-zinc-600 rounded-lg px-2 py-2 text-sm text-white text-center placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                      <input
                        value={dist.inches}
                        onChange={(e) => updateCtpForHole(x, "note", formatFeetInches(dist.feet, e.target.value))}
                        inputMode="numeric"
                        placeholder="In"
                        className="w-14 bg-zinc-700 border border-zinc-600 rounded-lg px-2 py-2 text-sm text-white text-center placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>
                    {entry.winner && entry.note && <p className="text-xs text-emerald-400 mt-1.5">{entry.winner} · {entry.note}</p>}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ── Leaderboard (this round) ── */}
        <section className="px-4 mt-6">
          <h2 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3">Leaderboard · {course.name}</h2>
          <div className="bg-zinc-900 rounded-2xl overflow-hidden px-4 pt-4 pb-4">
            {leaderboard.some((r) => r.holesPlayed > 0) ? (
              <>
                <div className="flex items-center px-3 mb-1">
                  <span className="w-5 shrink-0" />
                  <span className="flex-1" />
                  <span className="text-[10px] text-zinc-600 w-10 text-right shrink-0">Gross</span>
                  <span className="text-[10px] text-zinc-600 w-10 text-right shrink-0">Net</span>
                  <span className="text-[10px] text-zinc-600 w-10 text-right shrink-0">To Par</span>
                </div>
                <div className="space-y-1.5">
                  {leaderboard.map((r, i) => {
                    const active = r.holesPlayed > 0;
                    return (
                      <div key={r.player} className={`flex items-center gap-2 rounded-xl px-3 py-2.5 ${i === 0 && active ? "bg-emerald-900/40 border border-emerald-800/50" : "bg-zinc-800"}`}>
                        <span className={`text-sm font-bold w-5 shrink-0 ${i === 0 && active ? "text-emerald-400" : "text-zinc-500"}`}>{active ? i + 1 : "—"}</span>
                        <span className="flex-1 text-sm font-semibold text-white truncate">{r.player}</span>
                        <span className="text-sm text-zinc-400 w-10 text-right shrink-0">{r.gross || "—"}</span>
                        <span className="text-sm font-bold text-white w-10 text-right shrink-0">{r.net || "—"}</span>
                        <span className={`text-sm font-semibold w-10 text-right shrink-0 ${r.toPar != null && r.toPar < 0 ? "text-red-400" : r.toPar === 0 ? "text-emerald-400" : "text-zinc-400"}`}>{fmtToPar(r.toPar)}</span>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <p className="text-xs text-zinc-600 italic">No scores yet</p>
            )}
          </div>
        </section>

        {/* ── Admin ── */}
        <div className="px-4 mt-6">
          <button onClick={() => router.push(`/fall/admin`)} className="w-full bg-zinc-800/50 hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 border border-zinc-700 rounded-2xl py-4 text-sm transition-colors">
            Admin Login →
          </button>
        </div>

      </main>
    </>
  );
}
