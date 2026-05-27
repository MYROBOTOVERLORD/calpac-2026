"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { getCourseForDay, type HoleData, type CourseData } from "@/lib/courses";

// ─── Types ───────────────────────────────────────────────────────────────────

type DayKey = "day1" | "day2";
type TeeKey = "combo" | "three" | "four" | "stampede" | "tips";
type ContestWinnerNote = { winner?: string | null; note?: string | null };
type ContestEntry = { hole?: number | null; winner?: string | null; note?: string | null };
type LeaderRow = { player: string; gross: number; net: number; toPar: number | null };

type GroupDoc = {
  groupName?: string;
  groupname?: string;
  tournamentId?: string;
  playerNames?: string[];
  playerNamesByDay?: { day1?: string[]; day2?: string[] };
  scores?:
    | Record<string, Array<number | null>>
    | { day1?: Record<string, Array<number | null>>; day2?: Record<string, Array<number | null>> };
  handicaps?: Record<string, number | null>;
  day2HandicapAdjustments?: Record<string, number | null>;
  teeChoices?: { day1?: Record<string, TeeKey | null>; day2?: Record<string, TeeKey | null> };
  day1ScoresLocked?: boolean;
  charityStrokes?: Record<string, number | null>;
  treeStrokes?: Record<string, number | null>;
  contest?: {
    day1?: { closestToPinByHole?: Record<string, ContestWinnerNote>; closestToPin?: ContestEntry; longestDrive?: ContestEntry };
    day2?: { closestToPinByHole?: Record<string, ContestWinnerNote>; closestToPin?: ContestEntry; longestDrive?: ContestEntry };
  };
  tournament?: {
    day1Course?: string;
    day2Course?: string;
    day1Pars?: number[];
    day2Pars?: number[];
    day1Hcps?: number[];
    day2Hcps?: number[];
  };
};

const HOLE_COUNT = 18;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function coerceScoreTable(players: string[], input?: Record<string, Array<number | null>> | null) {
  const next: Record<string, Array<number | null>> = {};
  for (const p of players) {
    const existing = input?.[p];
    next[p] = Array.from({ length: HOLE_COUNT }, (_, i) => {
      const v = Array.isArray(existing) ? existing[i] : undefined;
      return typeof v === "number" && Number.isFinite(v) ? v : null;
    });
  }
  return next;
}

function coerceScoresByDay(players: string[], input?: GroupDoc["scores"]) {
  const raw = input as Record<string, unknown>;
  const isOld = input && typeof input === "object" && !("day1" in raw) && !("day2" in raw);
  return {
    day1: coerceScoreTable(players, isOld ? (input as Record<string, Array<number | null>>) : (raw?.day1 as Record<string, Array<number | null>> | null)),
    day2: coerceScoreTable(players, isOld ? null : (raw?.day2 as Record<string, Array<number | null>> | null)),
  };
}

function coerceNumberMap(players: string[], input?: Record<string, number | null> | null, def = 0) {
  const next: Record<string, number> = {};
  for (const p of players) {
    const v = input?.[p];
    next[p] = typeof v === "number" && Number.isFinite(v) ? v : def;
  }
  return next;
}

function coerceTeeMap(players: string[], input?: Record<string, TeeKey | null> | null, def: TeeKey = "combo") {
  const next: Record<string, TeeKey> = {};
  for (const p of players) {
    const v = input?.[p];
    next[p] = v === "three" || v === "four" || v === "combo" || v === "stampede" || v === "tips" ? v : def;
  }
  return next;
}

function teeBonusForDay(day: DayKey, tee?: TeeKey | null): number {
  return day === "day1" && tee === "three" ? 1 : 0;
}

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

function coerceCtpFromDoc(input?: {
  closestToPinByHole?: Record<string, ContestWinnerNote>;
  closestToPin?: ContestEntry;
}) {
  const out: Record<string, { winner: string; note: string }> = {};
  const map = input?.closestToPinByHole;
  if (map && typeof map === "object") {
    for (const [hole, v] of Object.entries(map)) {
      out[String(hole)] = { winner: v?.winner ?? "", note: v?.note ?? "" };
    }
    return out;
  }
  const legacy = input?.closestToPin;
  if (legacy?.hole != null) {
    out[String(legacy.hole)] = { winner: legacy.winner ?? "", note: legacy.note ?? "" };
  }
  return out;
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
            src={hole.imageUrl}
            alt={`Hole ${hole.hole} aerial`}
            className="w-full h-full object-cover"
          />
        </div>

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
  disabled,
  onChange,
}: {
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

  const colorClass = disabled ? "bg-zinc-800 text-zinc-600 cursor-not-allowed" : getScoreColor(value, par);
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
  const [selectedDay, setSelectedDay] = useState<DayKey>("day1");
  const [scoresByDay, setScoresByDay] = useState<{
    day1: Record<string, Array<number | null>>;
    day2: Record<string, Array<number | null>>;
  }>({ day1: {}, day2: {} });
  const [handicaps, setHandicaps] = useState<Record<string, number>>({});
  const [day2Adjustments, setDay2Adjustments] = useState<Record<string, number>>({});
  const [teeChoicesByDay, setTeeChoicesByDay] = useState<{ day1: Record<string, TeeKey>; day2: Record<string, TeeKey> }>({ day1: {}, day2: {} });
  const [charityStrokes, setCharityStrokes] = useState<Record<string, number>>({});
  const [treeStrokes, setTreeStrokes] = useState<Record<string, number>>({});
  const [currentHole, setCurrentHole] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showGreen, setShowGreen] = useState(false);
  // Player session (set by home page via sessionStorage)
  const [currentPlayer, setCurrentPlayer] = useState<string | null>(null);
  const [playerDay1GroupId, setPlayerDay1GroupId] = useState<string | null>(null);
  const [playerDay2GroupId, setPlayerDay2GroupId] = useState<string | null>(null);
  const [ctpByDayEdit, setCtpByDayEdit] = useState<{
    day1: Record<string, { winner: string; note: string }>;
    day2: Record<string, { winner: string; note: string }>;
  }>({ day1: {}, day2: {} });
  const [ldEdit, setLdEdit] = useState<{ day1: string; day2: string }>({ day1: "", day2: "" });
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ctpSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ctpPropagateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ldSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ldPropagateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Read player session + intended day from sessionStorage
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("calpac_player");
      if (raw) {
        const data = JSON.parse(raw);
        setCurrentPlayer(data.name ?? null);
        setPlayerDay1GroupId(data.day1GroupId ?? null);
        setPlayerDay2GroupId(data.day2GroupId ?? null);
      }
      const intendedDay = sessionStorage.getItem("calpac_intended_day");
      if (intendedDay === "day1" || intendedDay === "day2") {
        setSelectedDay(intendedDay);
        sessionStorage.removeItem("calpac_intended_day");
      }
    } catch { /* ignore */ }
  }, []);

  const title = group?.groupName ?? group?.groupname ?? "Foursome";

  const playersDay1 = useMemo(() => {
    const d = group?.playerNamesByDay?.day1;
    const l = group?.playerNames;
    return ((Array.isArray(d) ? d : Array.isArray(l) ? l : []) as string[]).filter(Boolean);
  }, [group?.playerNames, group?.playerNamesByDay?.day1]);

  const playersDay2 = useMemo(() => {
    const d = group?.playerNamesByDay?.day2;
    const l = group?.playerNames;
    return ((Array.isArray(d) ? d : Array.isArray(l) ? l : []) as string[]).filter(Boolean);
  }, [group?.playerNames, group?.playerNamesByDay?.day2]);

  const players = selectedDay === "day1" ? playersDay1 : playersDay2;
  const scores = scoresByDay[selectedDay];
  const isDay1Locked = selectedDay === "day1" && !!group?.day1ScoresLocked;

  const course: CourseData = useMemo(
    () => getCourseForDay(selectedDay === "day1" ? 1 : 2),
    [selectedDay]
  );
  const hole: HoleData = course.holes[currentHole];

  const dayPars = useMemo(() => {
    const p = selectedDay === "day1" ? group?.tournament?.day1Pars : group?.tournament?.day2Pars;
    return Array.isArray(p) && p.length === HOLE_COUNT ? p : null;
  }, [group?.tournament, selectedDay]);

  const dayHcps = useMemo(() => {
    const h = selectedDay === "day1" ? group?.tournament?.day1Hcps : group?.tournament?.day2Hcps;
    return Array.isArray(h) && h.length === HOLE_COUNT ? h : null;
  }, [group?.tournament, selectedDay]);

  const par3Holes = useMemo(() => {
    if (!dayPars) return [] as number[];
    return dayPars.map((p, i) => (p === 3 ? i + 1 : null)).filter((v): v is number => v !== null);
  }, [dayPars]);

  const runningTotals = useMemo(() => {
    const t: Record<string, number> = {};
    for (const p of players) {
      t[p] = (scores[p] ?? []).slice(0, currentHole + 1).reduce<number>((a, v) => (typeof v === "number" ? a + v : a), 0);
    }
    return t;
  }, [players, scores, currentHole]);

  const parThrough = useMemo(() => {
    if (dayPars) return dayPars.slice(0, currentHole + 1).reduce((a, p) => a + p, 0);
    return course.holes.slice(0, currentHole + 1).reduce((a, h) => a + h.par, 0);
  }, [course.holes, currentHole, dayPars]);

  const grossTotals = useMemo(() => {
    const t: Record<string, number> = {};
    for (const p of players) t[p] = arrSum(scores[p] ?? []);
    return t;
  }, [players, scores]);

  const netTotals = useMemo(() => {
    const t: Record<string, number> = {};
    for (const p of players) {
      const base = handicaps[p] ?? 0;
      const adj = selectedDay === "day2" ? (day2Adjustments[p] ?? 0) : 0;
      const teeBonus = teeBonusForDay(selectedDay, teeChoicesByDay[selectedDay]?.[p]);
      const charity = (charityStrokes[p] ?? 0) + (treeStrokes[p] ?? 0);
      const net = netRunning(scores[p] ?? Array.from({ length: HOLE_COUNT }, () => null), dayHcps, base + adj + teeBonus);
      t[p] = applyCharity(net, scores[p] ?? [], charity);
    }
    return t;
  }, [charityStrokes, day2Adjustments, dayHcps, handicaps, players, scores, selectedDay, teeChoicesByDay, treeStrokes]);

  const day1Leaderboard = useMemo((): LeaderRow[] => {
    const pars = group?.tournament?.day1Pars ?? null;
    const hcps = group?.tournament?.day1Hcps;
    const hcpsValid = Array.isArray(hcps) && hcps.length === HOLE_COUNT ? hcps : null;
    const parsValid = Array.isArray(pars) && pars.length === HOLE_COUNT ? pars : null;
    const rows = playersDay1.map((p): LeaderRow => {
      const s = scoresByDay.day1[p] ?? Array.from({ length: HOLE_COUNT }, () => null);
      const hcp = handicaps[p] ?? 0;
      const teeBonus = teeBonusForDay("day1", teeChoicesByDay.day1?.[p]);
      const charity = (charityStrokes[p] ?? 0) + (treeStrokes[p] ?? 0);
      const net = applyCharity(netRunning(s, hcpsValid, hcp + teeBonus), s, charity);
      return { player: p, gross: arrSum(s), net, toPar: toParSoFar(s, parsValid) };
    });
    return rows.sort((a, b) => a.net - b.net || a.gross - b.gross);
  }, [charityStrokes, group?.tournament?.day1Hcps, group?.tournament?.day1Pars, handicaps, playersDay1, scoresByDay.day1, teeChoicesByDay.day1, treeStrokes]);

  const day2Leaderboard = useMemo((): LeaderRow[] => {
    const pars = group?.tournament?.day2Pars ?? null;
    const hcps = group?.tournament?.day2Hcps;
    const hcpsValid = Array.isArray(hcps) && hcps.length === HOLE_COUNT ? hcps : null;
    const parsValid = Array.isArray(pars) && pars.length === HOLE_COUNT ? pars : null;
    const rows = playersDay2.map((p): LeaderRow => {
      const s = scoresByDay.day2[p] ?? Array.from({ length: HOLE_COUNT }, () => null);
      const hcp = handicaps[p] ?? 0;
      const adj = day2Adjustments[p] ?? 0;
      const teeBonus = teeBonusForDay("day2", teeChoicesByDay.day2?.[p]);
      const charity = (charityStrokes[p] ?? 0) + (treeStrokes[p] ?? 0);
      const net = applyCharity(netRunning(s, hcpsValid, hcp + adj + teeBonus), s, charity);
      return { player: p, gross: arrSum(s), net, toPar: toParSoFar(s, parsValid) };
    });
    return rows.sort((a, b) => a.net - b.net || a.gross - b.gross);
  }, [charityStrokes, day2Adjustments, group?.tournament?.day2Hcps, group?.tournament?.day2Pars, handicaps, playersDay2, scoresByDay.day2, teeChoicesByDay.day2, treeStrokes]);

  useEffect(() => {
    if (!groupId) return;
    setLoading(true);
    const unsub = onSnapshot(
      doc(db, "groups", groupId),
      (snap) => {
        if (!snap.exists()) { setError("Group not found."); setLoading(false); return; }
        const data = snap.data() as GroupDoc;
        setGroup(data);
        const legacy = (data.playerNames ?? []).filter(Boolean);
        const d1 = ((data.playerNamesByDay?.day1 ?? legacy) as string[]).filter(Boolean);
        const d2 = ((data.playerNamesByDay?.day2 ?? legacy) as string[]).filter(Boolean);
        const all = [...new Set([...d1, ...d2])];
        setScoresByDay(coerceScoresByDay(all, data.scores));
        setHandicaps(coerceNumberMap(all, data.handicaps ?? null, 0));
        setDay2Adjustments(coerceNumberMap(all, data.day2HandicapAdjustments ?? null, 0));
        setTeeChoicesByDay({
          day1: coerceTeeMap(all, data.teeChoices?.day1 ?? null, "combo"),
          day2: coerceTeeMap(all, data.teeChoices?.day2 ?? null, "combo"),
        });
        setCharityStrokes(coerceNumberMap(all, data.charityStrokes ?? null, 0));
        setTreeStrokes(coerceNumberMap(all, data.treeStrokes ?? null, 0));
        setCtpByDayEdit({
          day1: coerceCtpFromDoc(data.contest?.day1),
          day2: coerceCtpFromDoc(data.contest?.day2),
        });
        setLdEdit({
          day1: data.contest?.day1?.longestDrive?.winner ?? "",
          day2: data.contest?.day2?.longestDrive?.winner ?? "",
        });
        setLoading(false);
      },
      () => { setError("Failed to connect."); setLoading(false); }
    );
    return () => unsub();
  }, [groupId]);

  function scheduleSave(next: typeof scoresByDay) {
    if (!groupId) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      setSaving(true);
      try {
        await updateDoc(doc(db, "groups", groupId), { scores: next, updatedAt: serverTimestamp() });
      } catch {
        setError("Save failed.");
      } finally {
        setSaving(false);
      }
    }, 600);
  }

  function updateLongestDrive(day: DayKey, value: string) {
    setLdEdit((prev) => ({ ...prev, [day]: value }));
    const winner = value.trim() || null;

    if (ldSaveTimerRef.current) clearTimeout(ldSaveTimerRef.current);
    ldSaveTimerRef.current = setTimeout(async () => {
      try {
        await updateDoc(doc(db, "groups", groupId), {
          [`contest.${day}.longestDrive`]: { hole: null, winner, note: null },
          updatedAt: serverTimestamp(),
        });
      } catch {
        setError("Could not save Longest Drive.");
      }
    }, 600);

    if (winner) {
      const tournamentId = group?.tournamentId?.trim();
      if (tournamentId) {
        if (ldPropagateTimerRef.current) clearTimeout(ldPropagateTimerRef.current);
        ldPropagateTimerRef.current = setTimeout(async () => {
          try {
            const snap = await getDocs(query(collection(db, "groups"), where("tournamentId", "==", tournamentId)));
            await Promise.all(
              snap.docs.map((d) =>
                updateDoc(doc(db, "groups", d.id), {
                  [`contest.${day}.longestDrive`]: { hole: null, winner, note: null },
                  updatedAt: serverTimestamp(),
                })
              )
            );
          } catch {
            /* silent */
          }
        }, 800);
      }
    }
  }

  function handleScoreChange(player: string, holeIdx: number, value: number | null) {
    if (isDay1Locked) return;
    const nextDayScores = {
      ...scores,
      [player]: Array.from({ length: HOLE_COUNT }, (_, i) => (i === holeIdx ? value : (scores[player]?.[i] ?? null))),
    };
    const next = { ...scoresByDay, [selectedDay]: nextDayScores };
    setScoresByDay(next);
    scheduleSave(next);
  }

  function updateCtpForHole(day: DayKey, holeNumber: number, field: "winner" | "note", value: string) {
    const holeKey = String(holeNumber);
    setCtpByDayEdit((prev) => {
      const existing = prev[day][holeKey] ?? { winner: "", note: "" };
      const next = {
        ...prev,
        [day]: { ...prev[day], [holeKey]: { ...existing, [field]: value } },
      };
      const entry = next[day][holeKey];
      const winner = entry.winner.trim() || null;
      const note = entry.note.trim() || null;

      if (ctpSaveTimerRef.current) clearTimeout(ctpSaveTimerRef.current);
      ctpSaveTimerRef.current = setTimeout(async () => {
        try {
          await updateDoc(doc(db, "groups", groupId), {
            [`contest.${day}.closestToPinByHole.${holeKey}`]: { winner, note },
            updatedAt: serverTimestamp(),
          });
        } catch {
          setError("Could not save CTP result.");
        }
      }, 600);

      if (field === "note" && note != null) {
        const tournamentId = group?.tournamentId?.trim();
        if (tournamentId) {
          if (ctpPropagateTimerRef.current) clearTimeout(ctpPropagateTimerRef.current);
          ctpPropagateTimerRef.current = setTimeout(async () => {
            try {
              const snap = await getDocs(query(collection(db, "groups"), where("tournamentId", "==", tournamentId)));
              await Promise.all(
                snap.docs.map((d) =>
                  updateDoc(doc(db, "groups", d.id), {
                    [`contest.${day}.closestToPinByHole.${holeKey}`]: { winner, note },
                    updatedAt: serverTimestamp(),
                  })
                )
              );
            } catch {
              /* silent — propagation is best-effort */
            }
          }, 800);
        }
      }

      return next;
    });
  }

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
          <button onClick={() => router.push("/")} className="text-sm text-zinc-400 underline">Back to PIN entry</button>
        </div>
      </main>
    );
  }

  if (players.length === 0) {
    return (
      <main className="min-h-screen bg-zinc-950 flex items-center justify-center p-6">
        <div className="text-center text-zinc-400">
          <p className="mb-4">No players assigned to this group yet.</p>
          <button onClick={() => router.push(`/group/${groupId}/admin`)} className="text-sm text-emerald-400 underline">
            Open admin
          </button>
        </div>
      </main>
    );
  }

  const ctpEdits = ctpByDayEdit[selectedDay];
  const ldWinner = ldEdit[selectedDay];
  const day1CourseName = group?.tournament?.day1Course ?? "Old Greenwood";
  const day2CourseName = group?.tournament?.day2Course ?? "Grays Crossing";

  return (
    <>
      {showGreen && <GreenPopup hole={hole} course={course} onClose={() => setShowGreen(false)} />}

      <main className="min-h-screen bg-zinc-950 text-white max-w-lg mx-auto pb-8">

        {/* ── Top Bar ── */}
        <div className="flex items-center justify-between px-4 pt-4 pb-1">
          <button
            onClick={() => router.push("/")}
            className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors py-1"
          >
            ← {currentPlayer ? "Change Player" : "Groups"}
          </button>
          {currentPlayer && (
            <span className="text-xs text-emerald-400 font-semibold">{currentPlayer}</span>
          )}
          <button
            onClick={() => router.push("/leaderboard")}
            className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors py-1"
          >
            🏆 Leaderboard
          </button>
        </div>

        {/* ── Day Selector ── */}
        <div className="flex gap-2 px-4 pt-4 pb-2">
          {(["day1", "day2"] as DayKey[]).map((d) => (
            <button
              key={d}
              onClick={() => {
                if (d === selectedDay) return;
                // If player's groups differ between days, navigate to the correct group
                const targetGroupId = d === "day1" ? playerDay1GroupId : playerDay2GroupId;
                if (targetGroupId && targetGroupId !== groupId) {
                  sessionStorage.setItem("calpac_intended_day", d);
                  router.push(`/group/${targetGroupId}/score`);
                } else {
                  setSelectedDay(d);
                }
              }}
              className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-colors ${
                selectedDay === d ? "bg-emerald-600 text-white" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
              }`}
            >
              {d === "day1" ? `Day 1 · ${day1CourseName.split(" ")[0]}` : `Day 2 · ${day2CourseName.split(" ")[0]}`}
            </button>
          ))}
        </div>

        {/* ── Hero Image ── */}
        <div className="relative w-full aspect-[16/9] bg-zinc-900 overflow-hidden">
          <img
            src={hole.imageUrl}
            alt={`Hole ${hole.hole} at ${course.name}`}
            className="w-full h-full object-cover"
          />
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
                <h1 className="text-4xl font-black tracking-tight leading-none">Hole {hole.hole}</h1>
                <div className="flex items-center gap-3 mt-2">
                  <span className="bg-white/20 backdrop-blur-sm rounded-full px-3 py-1 text-sm font-semibold">Par {hole.par}</span>
                  <span className="bg-white/20 backdrop-blur-sm rounded-full px-3 py-1 text-sm font-semibold">Hdcp {hole.handicap}</span>
                  <span className="bg-white/20 backdrop-blur-sm rounded-full px-3 py-1 text-sm font-semibold">
                    {hole.tees[1]?.yardage ?? hole.tees[0]?.yardage} yds
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

        {/* ── Score Inputs ── */}
        <div className="px-4 pt-5 pb-2">
          {isDay1Locked && (
            <div className="mb-3 bg-yellow-900/30 border border-yellow-800/40 rounded-xl px-3 py-2 text-xs text-yellow-400">
              Day 1 scores are locked by admin
            </div>
          )}

          <div className="space-y-3">
            {players.map((player) => {
              const gross = scores[player]?.[currentHole] ?? null;
              const hdcp = handicaps[player] ?? 0;
              const adj = selectedDay === "day2" ? (day2Adjustments[player] ?? 0) : 0;
              const teeBonus = teeBonusForDay(selectedDay, teeChoicesByDay[selectedDay]?.[player]);
              const hcpIdx = dayHcps?.[currentHole] ?? hole.handicap;
              const holeStrokes = strokesForHole(hcpIdx, hdcp + adj + teeBonus);
              const netHole = gross !== null ? gross - holeStrokes : null;
              const rt = runningTotals[player] ?? 0;
              const diff = rt - parThrough;

              return (
                <div key={player} className="flex items-center gap-4 bg-zinc-900 rounded-2xl px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-white truncate">{player}</p>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      Thru {currentHole + 1} ·{" "}
                      <span className={diff < 0 ? "text-red-400" : diff === 0 ? "text-emerald-400" : "text-zinc-400"}>
                        {diff === 0 ? "E" : diff > 0 ? `+${diff}` : diff}
                      </span>
                    </p>
                  </div>
                  <div className="text-right">
                    {holeStrokes > 0 ? (
                      <>
                        <p className="text-xs text-zinc-500">Net hole</p>
                        <p className="text-sm font-bold">{netHole ?? "—"}</p>
                      </>
                    ) : (
                      <>
                        <p className="text-xs text-zinc-500">Total</p>
                        <p className="text-lg font-bold">{rt || "—"}</p>
                      </>
                    )}
                  </div>
                  <ScoreButton
                    value={gross}
                    par={hole.par}
                    disabled={isDay1Locked}
                    onChange={(v) => handleScoreChange(player, currentHole, v)}
                  />
                </div>
              );
            })}
          </div>

          {hole.description && (
            <div className="mt-3 bg-zinc-900/60 rounded-2xl px-4 py-3">
              <p className="text-xs text-zinc-500 italic leading-relaxed">{hole.description}</p>
            </div>
          )}
        </div>

        {/* ── Navigation ── */}
        <div className="px-4 py-4 border-t border-zinc-800 mt-3">
          <div className="flex justify-center gap-1.5 mb-4">
            {course.holes.map((_, i) => {
              const done = players.every((p) => scores[p]?.[i] != null);
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
              <p className="text-xs text-zinc-500">of 18</p>
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

        {/* ── Player Totals ── */}
        <section className="px-4 mt-6">
          <h2 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3">
            Player Totals · {selectedDay === "day1" ? "Day 1" : "Day 2"}
          </h2>
          <div className="bg-zinc-900 rounded-2xl divide-y divide-zinc-800">
            {players.map((p) => {
              const adj = selectedDay === "day2" ? (day2Adjustments[p] ?? 0) : 0;
              const teeBonus = teeBonusForDay(selectedDay, teeChoicesByDay[selectedDay]?.[p]);
              const charity = (charityStrokes[p] ?? 0) + (treeStrokes[p] ?? 0);
              const effectiveHcp = (handicaps[p] ?? 0) + adj + teeBonus;
              return (
                <div key={p} className="flex items-center px-4 py-3 gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-white truncate">{p}</p>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      Hcp {effectiveHcp}{charity > 0 ? ` · +${charity} bonus strokes` : ""}
                    </p>
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
              );
            })}
          </div>
        </section>

        {/* ── Contests ── */}
        <section className="px-4 mt-6">
          <h2 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3">
            Contests · {selectedDay === "day1" ? "Day 1" : "Day 2"}
          </h2>
          <div className="bg-zinc-900 rounded-2xl p-4 space-y-5">

            {/* CTP */}
            <div>
              <p className="text-xs font-semibold text-zinc-400 mb-3">
                ⛳ Closest to the Pin{par3Holes.length ? ` · Par 3s: ${par3Holes.map((h) => `Hole ${h}`).join(", ")}` : ""}
              </p>
              {par3Holes.length > 0 ? (
                <div className="space-y-3">
                  {par3Holes.map((h) => {
                    const entry = ctpEdits[String(h)] ?? { winner: "", note: "" };
                    const dist = parseFeetInches(entry.note);
                    return (
                      <div key={h} className="bg-zinc-800 rounded-xl p-3">
                        <p className="text-xs text-zinc-500 font-semibold mb-2">Hole {h} · Par 3</p>
                        <div className="flex gap-2">
                          <input
                            value={entry.winner}
                            onChange={(e) => updateCtpForHole(selectedDay, h, "winner", e.target.value)}
                            placeholder="Winner name"
                            className="flex-1 bg-zinc-700 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                          />
                          <input
                            value={dist.feet}
                            onChange={(e) => updateCtpForHole(selectedDay, h, "note", formatFeetInches(e.target.value, dist.inches))}
                            inputMode="numeric"
                            placeholder="Ft"
                            className="w-14 bg-zinc-700 border border-zinc-600 rounded-lg px-2 py-2 text-sm text-white text-center placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                          />
                          <input
                            value={dist.inches}
                            onChange={(e) => updateCtpForHole(selectedDay, h, "note", formatFeetInches(dist.feet, e.target.value))}
                            inputMode="numeric"
                            placeholder="In"
                            className="w-14 bg-zinc-700 border border-zinc-600 rounded-lg px-2 py-2 text-sm text-white text-center placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                          />
                        </div>
                        {entry.winner && entry.note && (
                          <p className="text-xs text-emerald-400 mt-1.5">{entry.winner} · {entry.note}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-zinc-600 italic">Set course pars in Admin to enable CTP tracking per hole.</p>
              )}
            </div>

            {/* Longest Drive */}
            <div>
              <p className="text-xs font-semibold text-zinc-400 mb-2">💨 Longest Drive</p>
              <div className="bg-zinc-800 rounded-xl p-3">
                <input
                  value={ldWinner}
                  onChange={(e) => updateLongestDrive(selectedDay, e.target.value)}
                  placeholder="Winner name"
                  className="w-full bg-zinc-700 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
                {ldWinner && (
                  <p className="text-xs text-emerald-400 mt-1.5">{ldWinner}</p>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* ── Leaderboard ── */}
        <section className="px-4 mt-6">
          <h2 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3">Leaderboard</h2>
          <div className="bg-zinc-900 rounded-2xl overflow-hidden">

            {/* Day 1 */}
            <div className="px-4 pt-4 pb-3 border-b border-zinc-800">
              <p className="text-xs font-semibold text-emerald-400 uppercase tracking-wide mb-2">
                Day 1 · {day1CourseName}
              </p>
              {day1Leaderboard.length > 0 ? (
                <>
                  <div className="flex items-center px-3 mb-1">
                    <span className="w-5 shrink-0" />
                    <span className="flex-1" />
                    <span className="text-[10px] text-zinc-600 w-10 text-right shrink-0">Gross</span>
                    <span className="text-[10px] text-zinc-600 w-10 text-right shrink-0">Net</span>
                    <span className="text-[10px] text-zinc-600 w-10 text-right shrink-0">To Par</span>
                  </div>
                  <div className="space-y-1.5">
                    {day1Leaderboard.map((r, i) => (
                      <div
                        key={r.player}
                        className={`flex items-center gap-2 rounded-xl px-3 py-2.5 ${
                          i === 0 ? "bg-emerald-900/40 border border-emerald-800/50" : "bg-zinc-800"
                        }`}
                      >
                        <span className={`text-sm font-bold w-5 shrink-0 ${i === 0 ? "text-emerald-400" : "text-zinc-500"}`}>{i + 1}</span>
                        <span className="flex-1 text-sm font-semibold text-white truncate">{r.player}</span>
                        <span className="text-sm text-zinc-400 w-10 text-right shrink-0">{r.gross || "—"}</span>
                        <span className="text-sm font-bold text-white w-10 text-right shrink-0">{r.net || "—"}</span>
                        <span
                          className={`text-sm font-semibold w-10 text-right shrink-0 ${
                            r.toPar != null && r.toPar < 0 ? "text-red-400" : r.toPar === 0 ? "text-emerald-400" : "text-zinc-400"
                          }`}
                        >
                          {fmtToPar(r.toPar)}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <p className="text-xs text-zinc-600 italic">No Day 1 scores yet</p>
              )}
            </div>

            {/* Day 2 */}
            <div className="px-4 pt-4 pb-4">
              <p className="text-xs font-semibold text-emerald-400 uppercase tracking-wide mb-2">
                Day 2 · {day2CourseName}
              </p>
              {day2Leaderboard.length > 0 ? (
                <>
                  <div className="flex items-center px-3 mb-1">
                    <span className="w-5 shrink-0" />
                    <span className="flex-1" />
                    <span className="text-[10px] text-zinc-600 w-10 text-right shrink-0">Gross</span>
                    <span className="text-[10px] text-zinc-600 w-10 text-right shrink-0">Net</span>
                    <span className="text-[10px] text-zinc-600 w-10 text-right shrink-0">To Par</span>
                  </div>
                  <div className="space-y-1.5">
                    {day2Leaderboard.map((r, i) => (
                      <div
                        key={r.player}
                        className={`flex items-center gap-2 rounded-xl px-3 py-2.5 ${
                          i === 0 ? "bg-emerald-900/40 border border-emerald-800/50" : "bg-zinc-800"
                        }`}
                      >
                        <span className={`text-sm font-bold w-5 shrink-0 ${i === 0 ? "text-emerald-400" : "text-zinc-500"}`}>{i + 1}</span>
                        <span className="flex-1 text-sm font-semibold text-white truncate">{r.player}</span>
                        <span className="text-sm text-zinc-400 w-10 text-right shrink-0">{r.gross || "—"}</span>
                        <span className="text-sm font-bold text-white w-10 text-right shrink-0">{r.net || "—"}</span>
                        <span
                          className={`text-sm font-semibold w-10 text-right shrink-0 ${
                            r.toPar != null && r.toPar < 0 ? "text-red-400" : r.toPar === 0 ? "text-emerald-400" : "text-zinc-400"
                          }`}
                        >
                          {fmtToPar(r.toPar)}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <p className="text-xs text-zinc-600 italic">No Day 2 scores yet</p>
              )}
            </div>
          </div>
        </section>

        {/* ── Admin ── */}
        <div className="px-4 mt-6">
          <button
            onClick={() => router.push(`/group/${groupId}/admin`)}
            className="w-full bg-zinc-800/50 hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 border border-zinc-700 rounded-2xl py-4 text-sm transition-colors"
          >
            Admin Login →
          </button>
        </div>

      </main>
    </>
  );
}
