"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { doc, onSnapshot, serverTimestamp, updateDoc, collection } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { COURSES, HILLS, type HoleData, type CourseData } from "@/lib/courses";

// ─── Types ────────────────────────────────────────────────────────────────────

type CalcuttaTeamDoc = {
  teamName?: string;
  playerA?: string;
  playerB?: string;
  handicap?: number;
  handicapA?: number;
  handicapB?: number;
  scores?: Array<number | null>;
};

type CalcuttaEventDoc = {
  name?: string;
  course?: string;
};

type TeamLeaderRow = {
  id: string;
  teamName: string;
  playerA: string;
  playerB: string;
  teamHandicap: number;
  teamGross: number | null;
  teamNet: number | null;
};

const EVENT_ID = "current";
const HOLE_COUNT = 18;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function safeNum(n: unknown, fallback = 0) {
  return typeof n === "number" && Number.isFinite(n) ? n : fallback;
}

function coerceScores(input: unknown): Array<number | null> {
  const raw = Array.isArray(input) ? input : [];
  return Array.from({ length: HOLE_COUNT }, (_, i) => {
    const v = raw[i];
    return typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : null;
  });
}

function arrSum(arr: Array<number | null>) {
  return arr.reduce<number>((a, v) => (typeof v === "number" ? a + v : a), 0);
}

function isComplete(arr: Array<number | null>) {
  return arr.every((v) => typeof v === "number");
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

function fmtNet(net: number | null) {
  if (net === null) return "—";
  return net === 0 ? "E" : net < 0 ? String(net) : `+${net}`;
}

function strokesOnHole(teamHandicap: number, holeHandicap: number): number {
  return Math.max(0, Math.floor((teamHandicap + 18 - holeHandicap) / 18));
}

// ─── Green Popup ──────────────────────────────────────────────────────────────

function GreenPopup({ hole, course, onClose }: { hole: HoleData; course: CourseData; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-lg mx-4 bg-zinc-900 rounded-3xl overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
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

        <div className="relative w-full aspect-[4/3] bg-zinc-800">
          <img
            src={hole.greenImageUrl ?? hole.imageUrl}
            alt={`Hole ${hole.hole} green map`}
            className="w-full h-full object-contain"
          />
        </div>

        <div className="px-5 py-4">
          <p className="text-xs font-semibold tracking-widest text-zinc-500 uppercase mb-3">Tee Distances</p>
          <div className="grid grid-cols-2 gap-2">
            {hole.tees.map((tee) => (
              <div key={tee.name} className="flex items-center justify-between bg-zinc-800 rounded-xl px-4 py-2.5">
                <span className="text-sm text-zinc-400">{tee.name}</span>
                <span className="text-sm font-bold text-white">{tee.yardage} yds</span>
              </div>
            ))}
          </div>
          {hole.description && (
            <p className="mt-4 text-sm text-zinc-400 leading-relaxed italic">{hole.description}</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Score Button ─────────────────────────────────────────────────────────────

function ScoreButton({ value, par, onChange }: { value: number | null; par: number; onChange: (v: number | null) => void }) {
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
      className={`w-16 h-16 rounded-2xl flex flex-col items-center justify-center transition-all active:scale-95 ${colorClass}`}
    >
      <span className="text-2xl font-bold leading-none">{value !== null ? value : "–"}</span>
      {label && <span className="text-[10px] font-semibold opacity-75 mt-0.5 leading-none">{label}</span>}
    </button>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function CalcuttaScoringPage() {
  const { teamId } = useParams<{ teamId: string }>();
  const router = useRouter();

  const [team, setTeam] = useState<CalcuttaTeamDoc | null>(null);
  const [event, setEvent] = useState<CalcuttaEventDoc | null>(null);
  const [allTeams, setAllTeams] = useState<Array<{ id: string; data: CalcuttaTeamDoc }>>([]);
  const [scores, setScores] = useState<Array<number | null>>(Array.from({ length: HOLE_COUNT }, () => null));
  const [currentHole, setCurrentHole] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showGreen, setShowGreen] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load event doc (for course)
  useEffect(() => {
    const unsub = onSnapshot(doc(db, "calcuttaEvents", EVENT_ID), (snap) => {
      setEvent(snap.exists() ? (snap.data() as CalcuttaEventDoc) : null);
    });
    return () => unsub();
  }, []);

  // Load this team
  useEffect(() => {
    if (!teamId) return;
    setLoading(true);
    const unsub = onSnapshot(
      doc(db, "calcuttaEvents", EVENT_ID, "teams", teamId),
      (snap) => {
        if (!snap.exists()) { setError("Team not found."); setLoading(false); return; }
        const data = snap.data() as CalcuttaTeamDoc;
        setTeam(data);
        setScores(coerceScores(data.scores));
        setLoading(false);
      },
      () => { setError("Failed to connect."); setLoading(false); }
    );
    return () => unsub();
  }, [teamId]);

  // Load all teams for leaderboard
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "calcuttaEvents", EVENT_ID, "teams"),
      (snap) => setAllTeams(snap.docs.map((d) => ({ id: d.id, data: d.data() as CalcuttaTeamDoc })))
    );
    return () => unsub();
  }, []);

  // Resolve course from event doc
  const course: CourseData = useMemo(() => {
    const courseId = event?.course ?? "hills";
    return COURSES[courseId] ?? HILLS;
  }, [event?.course]);

  const hole: HoleData = course.holes[currentHole];

  const teamHandicap = useMemo(() => {
    if (!team) return 0;
    // Use new single team handicap; fall back to sum of legacy per-player fields
    return typeof team.handicap === "number"
      ? Math.floor(team.handicap)
      : Math.floor(safeNum(team.handicapA, 0)) + Math.floor(safeNum(team.handicapB, 0));
  }, [team]);

  const teamGross = arrSum(scores);
  const holesPlayed = scores.filter((v) => typeof v === "number").length;
  const parThrough = course.holes.slice(0, currentHole + 1).reduce((a, h) => a + h.par, 0);
  const grossThrough = arrSum(scores.slice(0, currentHole + 1));
  const diffThrough = grossThrough - parThrough;

  const leaderboard = useMemo((): TeamLeaderRow[] => {
    return allTeams
      .map(({ id, data }) => {
        const hcp = typeof data.handicap === "number"
          ? Math.floor(data.handicap)
          : Math.floor(safeNum(data.handicapA, 0)) + Math.floor(safeNum(data.handicapB, 0));
        const s = coerceScores(data.scores);
        const holesPlayed = s.filter((v) => typeof v === "number").length;
        const gross = holesPlayed > 0 ? arrSum(s) : null;
        const net = isComplete(s) && gross != null ? gross - hcp : null;
        const name = (data.teamName ?? "").trim() || `${data.playerA ?? "?"} / ${data.playerB ?? "?"}`;
        return { id, teamName: name, playerA: (data.playerA ?? "").trim(), playerB: (data.playerB ?? "").trim(), teamHandicap: hcp, teamGross: gross, teamNet: net };
      })
      .sort((a, b) => {
        const an = a.teamNet ?? Infinity;
        const bn = b.teamNet ?? Infinity;
        const ag = a.teamGross ?? Infinity;
        const bg = b.teamGross ?? Infinity;
        return an - bn || ag - bg || a.teamName.localeCompare(b.teamName);
      });
  }, [allTeams]);

  function scheduleSave(next: Array<number | null>) {
    if (!teamId) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      setSaving(true);
      try {
        await updateDoc(doc(db, "calcuttaEvents", EVENT_ID, "teams", teamId), {
          scores: next,
          updatedAt: serverTimestamp(),
        });
      } catch {
        setError("Save failed.");
      } finally {
        setSaving(false);
      }
    }, 600);
  }

  function handleScoreChange(holeIdx: number, value: number | null) {
    const next = scores.map((v, i) => (i === holeIdx ? value : v));
    setScores(next);
    scheduleSave(next);
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-zinc-400 text-sm">Loading team…</p>
        </div>
      </main>
    );
  }

  if (error || !team) {
    return (
      <main className="min-h-screen bg-zinc-950 flex items-center justify-center p-6">
        <div className="text-center">
          <p className="text-red-400 mb-4">{error ?? "Team not found."}</p>
          <button onClick={() => router.push("/calcutta")} className="text-sm text-zinc-400 underline">Back to Calcutta</button>
        </div>
      </main>
    );
  }

  const teamDisplayName = (team.teamName ?? "").trim() || `${team.playerA ?? "?"} / ${team.playerB ?? "?"}`;

  return (
    <>
      {showGreen && <GreenPopup hole={hole} course={course} onClose={() => setShowGreen(false)} />}

      <main className="min-h-screen bg-zinc-950 text-white max-w-lg mx-auto pb-8">

        {/* ── Top Bar ── */}
        <div className="flex items-center justify-between px-4 pt-4 pb-1">
          <div className="flex flex-col gap-0.5">
            <button
              onClick={() => router.push("/calcutta")}
              className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors py-0.5 text-left"
            >
              ← Calcutta
            </button>
            <button
              onClick={() => router.push("/")}
              className="text-xs text-zinc-600 hover:text-zinc-300 transition-colors py-0.5 text-left"
            >
              ← Main Scoring
            </button>
          </div>
          <span className="text-xs text-emerald-400 font-semibold truncate max-w-[180px] text-center">{teamDisplayName}</span>
          <div className="text-xs text-zinc-600 w-20 text-right">{saving ? "Saving…" : holesPlayed > 0 ? "Saved" : ""}</div>
        </div>

        {/* ── Hero Image ── */}
        <div className="relative w-full aspect-[16/9] bg-zinc-900 overflow-hidden mt-2">
          <img
            src={hole.imageUrl}
            alt={`Hole ${hole.hole} at ${course.name}`}
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/80" />

          <div className="absolute top-0 inset-x-0 flex items-center justify-between px-4 pt-3">
            <div className="bg-black/50 backdrop-blur-sm rounded-full px-3 py-1.5 text-xs text-zinc-300">
              🤑 Calcutta
            </div>
            <div className="bg-black/50 backdrop-blur-sm rounded-full px-3 py-1.5 text-xs text-zinc-300">
              {course.shortName}
            </div>
          </div>

          <div className="absolute bottom-0 inset-x-0 px-4 pb-4">
            <div className="flex items-end justify-between">
              <div>
                <p className="text-xs font-semibold tracking-widest text-emerald-400 uppercase mb-1">{course.name}</p>
                <h1 className="text-4xl font-black tracking-tight leading-none">Hole {hole.hole}</h1>
                <div className="flex items-center gap-3 mt-2">
                  <span className="bg-white/20 backdrop-blur-sm rounded-full px-3 py-1 text-sm font-semibold">Par {hole.par}</span>
                  <span className="bg-white/20 backdrop-blur-sm rounded-full px-3 py-1 text-sm font-semibold">Hdcp {hole.handicap}</span>
                  <span className="bg-white/20 backdrop-blur-sm rounded-full px-3 py-1 text-sm font-semibold">
                    {hole.tees[0]?.yardage} yds
                  </span>
                </div>
              </div>
              <button
                onClick={() => setShowGreen(true)}
                className="flex flex-col items-center gap-1 bg-emerald-600/90 hover:bg-emerald-500 backdrop-blur-sm rounded-2xl px-4 py-3 transition-colors active:scale-95"
              >
                <span className="text-xl">🗺</span>
                <span className="text-[10px] font-bold tracking-wide uppercase">Details</span>
              </button>
            </div>
          </div>
        </div>

        {/* ── Score Input ── */}
        {(() => {
          const holeStrokes = strokesOnHole(teamHandicap, hole.handicap);
          const holeGross = scores[currentHole] ?? null;
          const holeNet = holeGross !== null ? holeGross - holeStrokes : null;
          return (
            <div className="px-4 pt-5 pb-2">
              <div className="bg-zinc-900 rounded-2xl px-4 py-4 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-white truncate">{teamDisplayName}</p>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    {team.playerA} · {team.playerB} · Hdcp {teamHandicap}
                  </p>
                  {holesPlayed > 0 && (
                    <p className="text-xs mt-1">
                      <span className="text-zinc-500">Thru {holesPlayed} · </span>
                      <span className={diffThrough < 0 ? "text-red-400 font-semibold" : diffThrough === 0 ? "text-emerald-400 font-semibold" : "text-zinc-400 font-semibold"}>
                        {diffThrough === 0 ? "E" : diffThrough > 0 ? `+${diffThrough}` : diffThrough}
                      </span>
                    </p>
                  )}
                </div>
                <div className="text-right mr-2 shrink-0">
                  <div className="flex gap-3">
                    <div>
                      <p className="text-xs text-zinc-500">Gross</p>
                      <p className="text-lg font-bold">{holeGross ?? "—"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-zinc-500">Net{holeStrokes > 0 ? ` (−${holeStrokes})` : ""}</p>
                      <p className="text-lg font-bold text-emerald-400">{holeNet ?? "—"}</p>
                    </div>
                  </div>
                </div>
                <ScoreButton
                  value={scores[currentHole] ?? null}
                  par={hole.par}
                  onChange={(v) => handleScoreChange(currentHole, v)}
                />
              </div>
            </div>
          );
        })()}

        {/* ── Navigation ── */}
        <div className="px-4 py-4 border-t border-zinc-800 mt-3">
          <div className="flex justify-center gap-1.5 mb-4">
            {course.holes.map((_, i) => {
              const done = scores[i] != null;
              return (
                <button
                  key={i}
                  onClick={() => setCurrentHole(i)}
                  className={`transition-all rounded-full ${
                    i === currentHole ? "w-6 h-2.5 bg-emerald-400" : done ? "w-2.5 h-2.5 bg-emerald-700" : "w-2.5 h-2.5 bg-zinc-700"
                  }`}
                />
              );
            })}
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setCurrentHole((h) => Math.max(0, h - 1))}
              disabled={currentHole === 0}
              className="flex-1 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed rounded-2xl py-4 font-semibold text-sm transition-colors active:scale-95 flex items-center justify-center gap-2"
            >
              ← Hole {currentHole > 0 ? currentHole : "—"}
            </button>
            <div className="text-center px-2">
              <p className="text-2xl font-black">{currentHole + 1}</p>
              <p className="text-xs text-zinc-500">of {HOLE_COUNT}</p>
            </div>
            <button
              onClick={() => setCurrentHole((h) => Math.min(HOLE_COUNT - 1, h + 1))}
              disabled={currentHole === HOLE_COUNT - 1}
              className="flex-1 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed rounded-2xl py-4 font-semibold text-sm transition-colors active:scale-95 flex items-center justify-center gap-2"
            >
              Hole {currentHole < HOLE_COUNT - 1 ? currentHole + 2 : "—"} →
            </button>
          </div>
        </div>

        {/* ── Team Totals ── */}
        <section className="px-4 mt-4">
          <h2 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3">Team Totals</h2>
          <div className="bg-zinc-900 rounded-2xl px-4 py-4 flex items-center gap-4">
            <div className="flex-1">
              <p className="font-semibold text-white">{teamDisplayName}</p>
              <p className="text-xs text-zinc-500 mt-0.5">Combined Hcp: {teamHandicap}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-zinc-500">Gross</p>
              <p className="text-base font-bold text-white">{holesPlayed > 0 ? teamGross : "—"}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-zinc-500">Net</p>
              <p className="text-base font-bold text-emerald-400">
                {holesPlayed > 0 ? (() => {
                  let strokes = 0;
                  for (let i = 0; i < HOLE_COUNT; i++) {
                    if (scores[i] != null) strokes += strokesOnHole(teamHandicap, course.holes[i].handicap);
                  }
                  return teamGross - strokes;
                })() : "—"}
              </p>
            </div>
          </div>
        </section>

        {/* ── Leaderboard ── */}
        <section className="px-4 mt-6">
          <h2 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3">Leaderboard</h2>
          <div className="bg-zinc-900 rounded-2xl overflow-hidden">
            <div className="flex items-center px-4 py-2 border-b border-zinc-800">
              <span className="w-5 shrink-0" />
              <span className="flex-1" />
              <span className="text-[10px] text-zinc-600 w-12 text-right shrink-0">Gross</span>
              <span className="text-[10px] text-zinc-600 w-12 text-right shrink-0">Net</span>
            </div>
            <div className="divide-y divide-zinc-800">
              {leaderboard.map((r, i) => {
                const isThis = r.id === teamId;
                return (
                  <button
                    key={r.id}
                    onClick={() => router.push(`/calcutta/score/${r.id}`)}
                    className={`w-full flex items-center gap-2 px-4 py-3 text-left transition-colors ${
                      isThis ? "bg-emerald-900/30" : "hover:bg-zinc-800/60"
                    }`}
                  >
                    <span className={`text-sm font-bold w-5 shrink-0 ${i === 0 ? "text-emerald-400" : "text-zinc-500"}`}>{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-semibold truncate ${isThis ? "text-emerald-300" : "text-white"}`}>{r.teamName}</p>
                      {(r.playerA || r.playerB) && (
                        <p className="text-[10px] text-zinc-500 truncate">{r.playerA} · {r.playerB}</p>
                      )}
                    </div>
                    <span className="text-sm text-zinc-400 w-12 text-right shrink-0">{r.teamGross ?? "—"}</span>
                    <span className="text-sm font-bold text-white w-12 text-right shrink-0">
                      {r.teamNet ?? "—"}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        {/* ── Admin link ── */}
        <div className="px-4 mt-6">
          <button
            onClick={() => router.push("/calcutta/admin")}
            className="w-full bg-zinc-800/50 hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 border border-zinc-700 rounded-2xl py-4 text-sm transition-colors"
          >
            Admin →
          </button>
        </div>

      </main>
    </>
  );
}
