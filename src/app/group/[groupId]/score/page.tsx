"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import Image from "next/image";
import {
  doc,
  onSnapshot,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { getCourseForDay, type HoleData, type CourseData } from "@/lib/courses";

// ─── Types ───────────────────────────────────────────────────────────────────

type GroupDoc = {
  groupName?: string;
  groupname?: string;
  day?: 1 | 2;
  playerNames?: string[];
  handicaps?: Record<string, number>;
  scores?: Record<string, Array<number | null>>;
};

const HOLE_COUNT = 18;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function coerceScores(
  players: string[],
  input?: GroupDoc["scores"]
): Record<string, Array<number | null>> {
  const next: Record<string, Array<number | null>> = {};
  for (const player of players) {
    const existing = input?.[player];
    next[player] = Array.from({ length: HOLE_COUNT }, (_, i) => {
      const v = Array.isArray(existing) ? existing[i] : undefined;
      return typeof v === "number" && Number.isFinite(v) ? v : null;
    });
  }
  return next;
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
  if (diff <= -2) return "bg-yellow-400 text-zinc-900";   // Eagle
  if (diff === -1) return "bg-red-500 text-white";         // Birdie
  if (diff === 0) return "bg-emerald-600 text-white";      // Par
  if (diff === 1) return "bg-zinc-600 text-white";         // Bogey
  if (diff === 2) return "bg-zinc-700 text-zinc-300";      // Double
  return "bg-zinc-800 text-zinc-400";                      // Worse
}

function netScore(gross: number | null, handicap: number, holeHandicap: number, players: number): number | null {
  if (gross === null) return null;
  // Strokes received = floor(handicap / 18) + (1 if holeHandicap <= handicap % 18)
  const base = Math.floor(handicap / HOLE_COUNT);
  const extra = holeHandicap <= (handicap % HOLE_COUNT) ? 1 : 0;
  return gross - base - extra;
}

// ─── Green Popup ─────────────────────────────────────────────────────────────

function GreenPopup({ hole, course, onClose }: {
  hole: HoleData;
  course: CourseData;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-lg mx-4 bg-zinc-900 rounded-3xl overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
          <div>
            <p className="text-xs font-semibold tracking-widest text-emerald-400 uppercase">
              {course.shortName} · Hole {hole.hole}
            </p>
            <h3 className="text-xl font-bold text-white mt-0.5">
              Par {hole.par} · Hdcp {hole.handicap}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-zinc-800 hover:bg-zinc-700 flex items-center justify-center text-zinc-400 hover:text-white transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Aerial image — full size */}
        <div className="relative w-full aspect-[4/3] bg-zinc-800">
          <img
            src={hole.imageUrl}
            alt={`Hole ${hole.hole} aerial`}
            className="w-full h-full object-cover"
          />
        </div>

        {/* Tee distances */}
        <div className="px-5 py-4">
          <p className="text-xs font-semibold tracking-widest text-zinc-500 uppercase mb-3">
            Tee Distances
          </p>
          <div className="grid grid-cols-2 gap-2">
            {hole.tees.map((tee) => (
              <div
                key={tee.name}
                className="flex items-center justify-between bg-zinc-800 rounded-xl px-4 py-2.5"
              >
                <span className="text-sm text-zinc-400">{tee.name}</span>
                <span className="text-sm font-bold text-white">{tee.yardage} yds</span>
              </div>
            ))}
          </div>

          {/* Hole description */}
          {hole.description && (
            <p className="mt-4 text-sm text-zinc-400 leading-relaxed italic">
              {hole.description}
            </p>
          )}
        </div>
      </div>
    </div>
  );
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

  const colorClass = getScoreColor(value, par);
  const label = getScoreLabel(value, par);

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
        className="w-16 h-16 text-2xl font-bold text-center rounded-2xl bg-white text-zinc-900 border-2 border-emerald-400 outline-none"
      />
    );
  }

  return (
    <button
      onClick={startEdit}
      className={`w-16 h-16 rounded-2xl flex flex-col items-center justify-center transition-all active:scale-95 ${colorClass}`}
    >
      <span className="text-2xl font-bold leading-none">
        {value !== null ? value : "–"}
      </span>
      {label && (
        <span className="text-[10px] font-semibold opacity-75 mt-0.5 leading-none">
          {label}
        </span>
      )}
    </button>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ScoringPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const router = useRouter();

  const [group, setGroup] = useState<GroupDoc | null>(null);
  const [scores, setScores] = useState<Record<string, Array<number | null>>>({});
  const [currentHole, setCurrentHole] = useState(0); // 0-indexed
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showGreen, setShowGreen] = useState(false);
  const [showNetScores, setShowNetScores] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Derive course from day field (default to Day 1 = Old Greenwood)
  const course: CourseData = useMemo(
    () => getCourseForDay((group?.day ?? 1) as 1 | 2),
    [group?.day]
  );

  const hole: HoleData = course.holes[currentHole];
  const players = useMemo(
    () => (group?.playerNames ?? []).filter(Boolean),
    [group?.playerNames]
  );
  const handicaps = group?.handicaps ?? {};

  // Running totals through current hole
  const runningTotals = useMemo(() => {
    const t: Record<string, number> = {};
    for (const p of players) {
      t[p] = (scores[p] ?? [])
        .slice(0, currentHole + 1)
        .reduce<number>((acc, v) => (typeof v === "number" ? acc + v : acc), 0);
    }
    return t;
  }, [players, scores, currentHole]);

  // Par through current hole
  const parThrough = useMemo(
    () => course.holes.slice(0, currentHole + 1).reduce((acc, h) => acc + h.par, 0),
    [course.holes, currentHole]
  );

  // ── Subscribe to Firestore ──
  useEffect(() => {
    if (!groupId) return;
    setLoading(true);

    const unsub = onSnapshot(
      doc(db, "groups", groupId),
      (snap) => {
        if (!snap.exists()) {
          setError("Group not found.");
          setLoading(false);
          return;
        }
        const data = snap.data() as GroupDoc;
        setGroup(data);
        const nextPlayers = (data.playerNames ?? []).filter(Boolean);
        setScores((prev) => {
          // Only coerce if players changed to avoid overwriting local edits
          const same = nextPlayers.join(",") === Object.keys(prev).join(",");
          return same ? prev : coerceScores(nextPlayers, data.scores);
        });
        setLoading(false);
      },
      () => {
        setError("Failed to connect. Check your connection.");
        setLoading(false);
      }
    );

    return () => unsub();
  }, [groupId]);

  // ── Debounced save ──
  function scheduleSave(nextScores: Record<string, Array<number | null>>) {
    if (!groupId) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      setSaving(true);
      try {
        await updateDoc(doc(db, "groups", groupId), {
          scores: nextScores,
          updatedAt: serverTimestamp(),
        });
      } catch {
        setError("Save failed. Check connection and try again.");
      } finally {
        setSaving(false);
      }
    }, 600);
  }

  function handleScoreChange(player: string, holeIdx: number, value: number | null) {
    const nextScores = {
      ...scores,
      [player]: Object.assign(
        Array.from({ length: HOLE_COUNT }, (_, i) => scores[player]?.[i] ?? null),
        { [holeIdx]: value }
      ),
    };
    setScores(nextScores);
    scheduleSave(nextScores);
  }

  // ── Nav ──
  function prevHole() {
    setCurrentHole((h) => Math.max(0, h - 1));
  }
  function nextHole() {
    setCurrentHole((h) => Math.min(HOLE_COUNT - 1, h + 1));
  }

  // ── Loading / Error states ──
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
          <button
            onClick={() => router.push("/")}
            className="text-sm text-zinc-400 underline"
          >
            Back to PIN entry
          </button>
        </div>
      </main>
    );
  }

  if (players.length === 0) {
    return (
      <main className="min-h-screen bg-zinc-950 flex items-center justify-center p-6">
        <div className="text-center text-zinc-400">
          <p className="mb-2">No players assigned to this group yet.</p>
          <button
            onClick={() => router.push(`/group/${groupId}`)}
            className="text-sm text-emerald-400 underline"
          >
            Go to group setup
          </button>
        </div>
      </main>
    );
  }

  const totalScoreDisplay = (score: number, par: number) => {
    const diff = score - par;
    if (diff === 0) return "E";
    return diff > 0 ? `+${diff}` : `${diff}`;
  };

  return (
    <>
      {/* Green/Hole Popup */}
      {showGreen && (
        <GreenPopup
          hole={hole}
          course={course}
          onClose={() => setShowGreen(false)}
        />
      )}

      <main className="min-h-screen bg-zinc-950 text-white flex flex-col max-w-lg mx-auto">

        {/* ── Hero Image ── */}
        <div className="relative w-full aspect-[16/9] bg-zinc-900 overflow-hidden">
          <img
            src={hole.imageUrl}
            alt={`Hole ${hole.hole} at ${course.name}`}
            className="w-full h-full object-cover"
          />

          {/* Gradient overlay */}
          <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/80" />

          {/* Top bar */}
          <div className="absolute top-0 inset-x-0 flex items-center justify-between px-4 pt-4">
            <button
              onClick={() => router.push(`/group/${groupId}`)}
              className="flex items-center gap-1.5 bg-black/50 backdrop-blur-sm rounded-full px-3 py-1.5 text-xs text-zinc-300 hover:text-white transition-colors"
            >
              ← Scorecard
            </button>
            <div className="bg-black/50 backdrop-blur-sm rounded-full px-3 py-1.5 text-xs text-zinc-300">
              {course.shortName} · {saving ? "Saving…" : "Saved"}
            </div>
          </div>

          {/* Hole info overlay */}
          <div className="absolute bottom-0 inset-x-0 px-4 pb-4">
            <div className="flex items-end justify-between">
              <div>
                <p className="text-xs font-semibold tracking-widest text-emerald-400 uppercase mb-1">
                  {course.name}
                </p>
                <h1 className="text-4xl font-black tracking-tight leading-none">
                  Hole {hole.hole}
                </h1>
                <div className="flex items-center gap-3 mt-2">
                  <span className="bg-white/20 backdrop-blur-sm rounded-full px-3 py-1 text-sm font-semibold">
                    Par {hole.par}
                  </span>
                  <span className="bg-white/20 backdrop-blur-sm rounded-full px-3 py-1 text-sm font-semibold">
                    Hdcp {hole.handicap}
                  </span>
                  <span className="bg-white/20 backdrop-blur-sm rounded-full px-3 py-1 text-sm font-semibold">
                    {hole.tees[1]?.yardage ?? hole.tees[0]?.yardage} yds
                  </span>
                </div>
              </div>

              {/* Green map button */}
              <button
                onClick={() => setShowGreen(true)}
                className="flex flex-col items-center gap-1 bg-emerald-600/90 hover:bg-emerald-500 backdrop-blur-sm rounded-2xl px-4 py-3 transition-colors active:scale-95"
              >
                <span className="text-xl">🗺</span>
                <span className="text-[10px] font-bold tracking-wide uppercase">
                  Details
                </span>
              </button>
            </div>
          </div>
        </div>

        {/* ── Score Inputs ── */}
        <div className="flex-1 px-4 pt-5 pb-4">

          {/* Net toggle */}
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-semibold text-zinc-400">
              {group?.groupName ?? group?.groupname ?? "Foursome"}
            </p>
            <button
              onClick={() => setShowNetScores((v) => !v)}
              className={`text-xs font-semibold px-3 py-1.5 rounded-full transition-colors ${
                showNetScores
                  ? "bg-emerald-600 text-white"
                  : "bg-zinc-800 text-zinc-400"
              }`}
            >
              {showNetScores ? "Net" : "Gross"}
            </button>
          </div>

          {/* Player score cards */}
          <div className="space-y-3">
            {players.map((player) => {
              const gross = scores[player]?.[currentHole] ?? null;
              const hdcp = handicaps[player] ?? 0;
              const net = showNetScores
                ? netScore(gross, hdcp, hole.handicap, players.length)
                : null;
              const displayScore = showNetScores ? net : gross;
              const runningTotal = runningTotals[player] ?? 0;
              const diff = runningTotal - parThrough;

              return (
                <div
                  key={player}
                  className="flex items-center gap-4 bg-zinc-900 rounded-2xl px-4 py-3"
                >
                  {/* Player info */}
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-white truncate">{player}</p>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      Thru {currentHole + 1} ·{" "}
                      <span
                        className={
                          diff < 0
                            ? "text-red-400"
                            : diff === 0
                            ? "text-emerald-400"
                            : "text-zinc-400"
                        }
                      >
                        {diff === 0
                          ? "E"
                          : diff > 0
                          ? `+${diff}`
                          : diff}
                      </span>
                    </p>
                  </div>

                  {/* Running total badge */}
                  <div className="text-right">
                    <p className="text-xs text-zinc-500">Total</p>
                    <p className="text-lg font-bold">{runningTotal || "—"}</p>
                  </div>

                  {/* Score button */}
                  <ScoreButton
                    value={gross}
                    par={hole.par}
                    onChange={(v) => handleScoreChange(player, currentHole, v)}
                  />
                </div>
              );
            })}
          </div>

          {/* Hole description (if available) */}
          {hole.description && (
            <div className="mt-4 bg-zinc-900/60 rounded-2xl px-4 py-3">
              <p className="text-xs text-zinc-500 italic leading-relaxed">
                {hole.description}
              </p>
            </div>
          )}
        </div>

        {/* ── Navigation ── */}
        <div className="sticky bottom-0 bg-zinc-950/95 backdrop-blur-sm border-t border-zinc-800 px-4 py-4">
          {/* Hole dots */}
          <div className="flex justify-center gap-1.5 mb-4">
            {course.holes.map((h, i) => {
              const allScored = players.every(
                (p) => scores[p]?.[i] !== null && scores[p]?.[i] !== undefined
              );
              return (
                <button
                  key={i}
                  onClick={() => setCurrentHole(i)}
                  className={`transition-all rounded-full ${
                    i === currentHole
                      ? "w-6 h-2.5 bg-emerald-400"
                      : allScored
                      ? "w-2.5 h-2.5 bg-emerald-700"
                      : "w-2.5 h-2.5 bg-zinc-700"
                  }`}
                />
              );
            })}
          </div>

          {/* Prev / Hole number / Next */}
          <div className="flex items-center gap-3">
            <button
              onClick={prevHole}
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
              onClick={nextHole}
              disabled={currentHole === HOLE_COUNT - 1}
              className="flex-1 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed rounded-2xl py-4 font-semibold text-sm transition-colors active:scale-95 flex items-center justify-center gap-2"
            >
              Hole {currentHole < HOLE_COUNT - 1 ? currentHole + 2 : "—"} →
            </button>
          </div>
        </div>

      </main>
    </>
  );
}
