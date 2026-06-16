"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  collection,
  deleteField,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { computeDayPoints, type DayKey, type PointOverrides } from "@/lib/michiganPoints";

// ─── Schedule definition (mirrors michigan/page.tsx) ─────────────────────────

const MICHIGAN_SCHEDULE = [
  {
    dayKey: "day1r1",
    label: "Day 1 · Round 1",
    date: "June 15, 2026",
    course: "spruce-run",
    courseName: "Spruce Run",
    pars: [4,5,4,4,4,3,4,3,5, 3,4,4,4,4,4,3,4,4],
    hcps: [9,7,5,1,3,17,13,15,11, 6,4,14,12,10,8,18,16,2],
    groups: [
      { id: "day1r1-a", label: "Group A", players: ["Craig Lauderdale", "Rick Lund", "Frank Moslander"] },
      { id: "day1r1-b", label: "Group B", players: ["Aaron Schliefer", "Jay Norwood", "Dave Laurance"] },
    ],
  },
  {
    dayKey: "day1r2",
    label: "Day 1 · Round 2",
    date: "June 15, 2026",
    course: "the-bear",
    courseName: "The Bear – Grand Traverse",
    pars: [4,4,5,3,4,5,4,4,3, 5,4,4,3,4,5,4,3,4],
    hcps: [11,5,9,15,1,17,3,7,13, 2,8,4,18,16,12,6,14,10],
    groups: [
      { id: "day1r2-a", label: "Group A", players: ["Craig Lauderdale", "Rick Lund", "Frank Moslander"] },
      { id: "day1r2-b", label: "Group B", players: ["Aaron Schliefer", "Jay Norwood", "Dave Laurance"] },
    ],
  },
  {
    dayKey: "day2",
    label: "Day 2",
    date: "June 16, 2026",
    course: "arcadia-bluffs-south",
    courseName: "Arcadia Bluffs South",
    pars: [4,4,5,4,3,5,4,3,4, 4,5,3,4,5,4,3,4,4],
    hcps: [9,17,3,1,7,13,11,15,5, 14,4,16,2,10,18,8,12,6],
    groups: [
      { id: "day2-a", label: "Group A", players: ["Craig Lauderdale", "Aaron Schliefer", "Rick Lund"] },
      { id: "day2-b", label: "Group B", players: ["Jay Norwood", "Dave Laurance", "Frank Moslander"] },
    ],
  },
  {
    dayKey: "day3",
    label: "Day 3",
    date: "June 17, 2026",
    course: "bay-harbor-links",
    courseName: "Bay Harbor Links/Quarry",
    pars: [4,4,4,3,4,4,5,3,5, 4,3,5,4,5,4,4,3,4],
    hcps: [13,7,9,17,15,5,3,11,1, 14,18,6,10,2,12,4,16,8],
    groups: [
      { id: "day3-a", label: "Group A", players: ["Craig Lauderdale", "Frank Moslander", "Jay Norwood"] },
      { id: "day3-b", label: "Group B", players: ["Dave Laurance", "Aaron Schliefer", "Rick Lund"] },
    ],
  },
  {
    dayKey: "day4",
    label: "Day 4",
    date: "June 18, 2026",
    course: "forest-dunes",
    courseName: "Forest Dunes",
    pars: [4,4,3,4,5,4,5,4,3, 4,3,4,4,4,5,3,4,5],
    hcps: [15,1,13,9,5,11,7,3,17, 4,18,10,14,2,6,8,16,12],
    groups: [
      { id: "day4-a", label: "Group A", players: ["Craig Lauderdale", "Dave Laurance", "Aaron Schliefer"] },
      { id: "day4-b", label: "Group B", players: ["Jay Norwood", "Frank Moslander", "Rick Lund"] },
    ],
  },
  {
    dayKey: "day5",
    label: "Day 5",
    date: "June 19, 2026",
    course: "arcadia-bluffs",
    courseName: "Arcadia Bluffs",
    pars: [5,3,5,4,5,3,4,4,3, 4,5,4,3,4,5,4,3,4],
    hcps: [15,17,7,13,3,9,1,5,11, 2,12,10,8,14,18,4,16,6],
    groups: [
      { id: "day5-a", label: "Group A", players: ["Craig Lauderdale", "Rick Lund", "Frank Moslander"] },
      { id: "day5-b", label: "Group B", players: ["Jay Norwood", "Dave Laurance", "Aaron Schliefer"] },
    ],
  },
];

const ALL_PLAYERS = ["Craig Lauderdale", "Jay Norwood", "Dave Laurance", "Aaron Schliefer", "Frank Moslander", "Rick Lund"];

// ─── Types ───────────────────────────────────────────────────────────────────

type MichiganGroupDoc = {
  id: string;
  day?: string;
  groupName?: string;
  players?: string[];
  courseName?: string;
  date?: string;
  pars?: number[];
  hcps?: number[];
  scores?: Record<string, (number | null)[]>;
  handicaps?: Record<string, number | null>;
  contest?: { closestToPinByHole?: Record<string, { winner?: string | null; note?: string | null }> };
};

const HOLE_COUNT = 18;

function buildInitialDoc(day: (typeof MICHIGAN_SCHEDULE)[0], group: (typeof MICHIGAN_SCHEDULE)[0]["groups"][0]) {
  const scores: Record<string, (number | null)[]> = {};
  const handicaps: Record<string, number | null> = {};
  for (const p of group.players) {
    scores[p] = Array.from({ length: HOLE_COUNT }, () => null);
    handicaps[p] = null;
  }
  return {
    day: day.dayKey,
    groupName: `${day.label} · ${group.label}`,
    groupLabel: group.label,
    players: group.players,
    course: day.course,
    courseName: day.courseName,
    date: day.date,
    pars: day.pars,
    hcps: day.hcps,
    scores,
    handicaps,
    contest: { closestToPinByHole: {} },
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

function parseParOrHcp(raw: string): number[] | null {
  const parts = raw.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
  if (parts.length !== HOLE_COUNT) return null;
  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => !Number.isFinite(n))) return null;
  return nums.map((n) => Math.floor(n));
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function MichiganAdminPage() {
  const router = useRouter();
  const [adminUser, setAdminUser] = useState<User | null>(null);
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [adminError, setAdminError] = useState<string | null>(null);

  const allowedAdminEmails = useMemo(() => {
    const raw = process.env.NEXT_PUBLIC_ADMIN_EMAILS ?? "";
    return raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  }, []);

  const isAdmin = useMemo(() => {
    if (!adminUser) return false;
    if (allowedAdminEmails.length === 0) return true;
    return allowedAdminEmails.includes((adminUser.email ?? "").toLowerCase());
  }, [adminUser, allowedAdminEmails]);

  const [groups, setGroups] = useState<MichiganGroupDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [initStatus, setInitStatus] = useState<string | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  const [initLoading, setInitLoading] = useState(false);

  // Handicap editor: { [groupId]: { [player]: string } }
  const [hcpDrafts, setHcpDrafts] = useState<Record<string, Record<string, string>>>({});
  const [hcpSaving, setHcpSaving] = useState<string | null>(null);

  // Par/Hcp editor: { [groupId]: { pars: string, hcps: string } }
  const [scorecardDrafts, setScorecardDrafts] = useState<Record<string, { pars: string; hcps: string }>>({});
  const [scorecardSaving, setScorecardSaving] = useState<string | null>(null);
  const [scorecardError, setScorecardError] = useState<string | null>(null);

  // Roster editor (inline, per-slot auto-save)
  const [rosterSaving, setRosterSaving] = useState<string | null>(null);
  const [rosterErrors, setRosterErrors] = useState<Record<string, string | null>>({});

  // Points override editor: { [dayKey]: { [player]: string } }
  const [pointOverrides, setPointOverrides] = useState<PointOverrides>({});
  const [overrideDrafts, setOverrideDrafts] = useState<Record<string, Record<string, string>>>({});
  const overrideSaveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setAdminUser(u));
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!isAdmin) { setLoading(false); return; }
    const unsub = onSnapshot(
      collection(db, "michigan"),
      (snap) => {
        setGroups(snap.docs.map((d) => ({ id: d.id, ...d.data() } as MichiganGroupDoc)));
        setLoading(false);
      },
      () => setLoading(false)
    );
    return () => unsub();
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    const unsub = onSnapshot(doc(db, "michiganMeta", "pointOverrides"), (snap) => {
      setPointOverrides((snap.data() as PointOverrides) ?? {});
    });
    return () => unsub();
  }, [isAdmin]);

  // Populate override drafts when overrides load (don't clobber values the admin is mid-typing)
  useEffect(() => {
    setOverrideDrafts((prev) => {
      const next = { ...prev };
      for (const dayKey of Object.keys(pointOverrides) as DayKey[]) {
        const dayOverrides = pointOverrides[dayKey] ?? {};
        for (const [player, value] of Object.entries(dayOverrides)) {
          if (next[dayKey]?.[player] === undefined) {
            next[dayKey] = { ...(next[dayKey] ?? {}), [player]: String(value) };
          }
        }
      }
      return next;
    });
  }, [pointOverrides]);

  // Populate draft state when groups load
  useEffect(() => {
    for (const g of groups) {
      if (!hcpDrafts[g.id]) {
        const drafts: Record<string, string> = {};
        for (const p of g.players ?? []) {
          const v = g.handicaps?.[p];
          drafts[p] = typeof v === "number" ? String(v) : "";
        }
        setHcpDrafts((prev) => ({ ...prev, [g.id]: drafts }));
      }
      if (!scorecardDrafts[g.id]) {
        setScorecardDrafts((prev) => ({
          ...prev,
          [g.id]: {
            pars: Array.isArray(g.pars) && g.pars.length === HOLE_COUNT ? g.pars.join(",") : "",
            hcps: Array.isArray(g.hcps) && g.hcps.length === HOLE_COUNT ? g.hcps.join(",") : "",
          },
        }));
      }
    }
  }, [groups]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setAdminError(null);
    try {
      await signInWithEmailAndPassword(auth, adminEmail, adminPassword);
    } catch (err) {
      setAdminError(err instanceof Error ? err.message : "Login failed.");
    }
  }

  async function initializeTournament() {
    setInitLoading(true);
    setInitStatus(null);
    setInitError(null);
    try {
      const existingIds = new Set(groups.map((g) => g.id));
      let created = 0;
      for (const day of MICHIGAN_SCHEDULE) {
        for (const group of day.groups) {
          if (!existingIds.has(group.id)) {
            await setDoc(doc(db, "michigan", group.id), buildInitialDoc(day, group));
            created++;
          }
        }
      }
      setInitStatus(created > 0 ? `✓ Created ${created} group(s).` : "All groups already exist.");
    } catch (err) {
      setInitError(err instanceof Error ? err.message : "Initialization failed.");
    } finally {
      setInitLoading(false);
    }
  }

  async function saveHandicaps(groupId: string) {
    const drafts = hcpDrafts[groupId] ?? {};
    const patch: Record<string, number | null> = {};
    for (const [player, raw] of Object.entries(drafts)) {
      const n = Number(raw);
      patch[player] = raw.trim() === "" ? null : Number.isFinite(n) ? n : null;
    }
    setHcpSaving(groupId);
    try {
      await updateDoc(doc(db, "michigan", groupId), {
        handicaps: patch,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      console.error(err);
    } finally {
      setHcpSaving(null);
    }
  }

  async function saveScorecard(groupId: string) {
    const draft = scorecardDrafts[groupId];
    if (!draft) return;
    const pars = parseParOrHcp(draft.pars);
    const hcps = parseParOrHcp(draft.hcps);
    if (!pars) { setScorecardError("Pars must be 18 space/comma-separated numbers."); return; }
    if (!hcps) { setScorecardError("Handicap indices must be 18 space/comma-separated numbers."); return; }

    // Validate pars
    if (pars.some((p) => p < 3 || p > 6)) { setScorecardError("Each par must be 3–6."); return; }
    const parsTotal = pars.reduce((a, b) => a + b, 0);
    if (parsTotal < 68 || parsTotal > 76) { setScorecardError(`Par total ${parsTotal} is unusual. Expected 68–76.`); return; }

    // Validate hcps
    const hcpSet = new Set(hcps);
    if (hcpSet.size !== 18 || hcps.some((h) => h < 1 || h > 18)) {
      setScorecardError("Handicap indices must be unique values 1–18."); return;
    }

    setScorecardSaving(groupId);
    setScorecardError(null);
    try {
      await updateDoc(doc(db, "michigan", groupId), {
        pars,
        hcps,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      setScorecardError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setScorecardSaving(null);
    }
  }

  async function clearScores(groupId: string) {
    if (!confirm("Clear all scores for this group? This cannot be undone.")) return;
    const g = groups.find((x) => x.id === groupId);
    if (!g) return;
    const emptyScores: Record<string, (number | null)[]> = {};
    for (const p of g.players ?? []) {
      emptyScores[p] = Array.from({ length: HOLE_COUNT }, () => null);
    }
    try {
      await updateDoc(doc(db, "michigan", groupId), {
        scores: emptyScores,
        contest: { closestToPinByHole: {} },
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      console.error(err);
    }
  }

  async function handleRosterSlotChange(groupId: string, slot: number, newPlayer: string) {
    const g = groups.find((x) => x.id === groupId);
    if (!g) return;
    const updated = [...(g.players ?? ["", "", ""])];
    updated[slot] = newPlayer;

    if (newPlayer) {
      if (updated.some((p, i) => i !== slot && p === newPlayer)) {
        setRosterErrors((prev) => ({ ...prev, [groupId]: `${newPlayer} is already in this group.` }));
        return;
      }
      const siblings = groups.filter((x) => x.day === g.day && x.id !== groupId);
      const conflict = siblings.some((s) => (s.players ?? []).includes(newPlayer));
      if (conflict) {
        setRosterErrors((prev) => ({ ...prev, [groupId]: `${newPlayer} is already in another group for this round.` }));
        return;
      }
    }

    setRosterErrors((prev) => ({ ...prev, [groupId]: null }));
    setRosterSaving(groupId);
    const newScores: Record<string, (number | null)[]> = {};
    const newHandicaps: Record<string, number | null> = {};
    for (const p of updated) {
      if (!p) continue;
      newScores[p] = Array.isArray(g.scores?.[p])
        ? (g.scores![p] as (number | null)[])
        : Array.from({ length: HOLE_COUNT }, () => null);
      newHandicaps[p] = typeof g.handicaps?.[p] === "number" ? (g.handicaps![p] as number) : null;
    }
    try {
      await updateDoc(doc(db, "michigan", groupId), {
        players: updated,
        scores: newScores,
        handicaps: newHandicaps,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      setRosterErrors((prev) => ({ ...prev, [groupId]: err instanceof Error ? err.message : "Save failed." }));
    } finally {
      setRosterSaving(null);
    }
  }

  function handleOverrideChange(dayKey: DayKey, player: string, raw: string) {
    setOverrideDrafts((prev) => ({
      ...prev,
      [dayKey]: { ...(prev[dayKey] ?? {}), [player]: raw },
    }));

    const timerKey = `${dayKey}:${player}`;
    if (overrideSaveTimers.current[timerKey]) clearTimeout(overrideSaveTimers.current[timerKey]);
    overrideSaveTimers.current[timerKey] = setTimeout(async () => {
      const trimmed = raw.trim();
      const value = trimmed === "" ? null : Number(trimmed);
      if (value !== null && !Number.isFinite(value)) return;
      try {
        await setDoc(
          doc(db, "michiganMeta", "pointOverrides"),
          { [dayKey]: { [player]: value === null ? deleteField() : value } },
          { merge: true }
        );
      } catch (err) {
        console.error(err);
      }
    }, 600);
  }

  // ─── Auth gate ────────────────────────────────────────────────────────────

  if (!adminUser) {
    return (
      <main className="min-h-screen bg-slate-900 text-white flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <button onClick={() => router.push("/michigan")} className="text-slate-500 text-sm mb-4 hover:text-slate-300">
            ← Back to Michigan
          </button>
          <h1 className="text-xl font-bold mb-6">Michigan Admin Login</h1>
          <form onSubmit={handleLogin} className="space-y-3">
            <input
              type="email"
              value={adminEmail}
              onChange={(e) => setAdminEmail(e.target.value)}
              placeholder="Email"
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-blue-500"
            />
            <input
              type="password"
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
              placeholder="Password"
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-blue-500"
            />
            {adminError && <p className="text-red-400 text-sm">{adminError}</p>}
            <button type="submit" className="w-full bg-blue-600 hover:bg-blue-500 text-white rounded-xl py-3 font-semibold transition-colors">
              Sign In
            </button>
          </form>
        </div>
      </main>
    );
  }

  if (!isAdmin) {
    return (
      <main className="min-h-screen bg-slate-900 text-white flex items-center justify-center p-6">
        <div className="text-center">
          <p className="text-red-400 mb-4">Access denied. Your account is not an admin.</p>
          <button onClick={() => signOut(auth)} className="bg-slate-700 text-slate-300 rounded-xl px-4 py-2 text-sm">
            Sign Out
          </button>
        </div>
      </main>
    );
  }

  // ─── Admin UI ─────────────────────────────────────────────────────────────

  const existingIds = new Set(groups.map((g) => g.id));
  const allInitialized = MICHIGAN_SCHEDULE.every((day) =>
    day.groups.every((g) => existingIds.has(g.id))
  );

  return (
    <main className="min-h-screen bg-slate-900 text-white pb-16">
      <div className="max-w-lg mx-auto px-4 py-6">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <p className="text-[10px] font-bold tracking-widest text-blue-400 uppercase">Michigan 2026</p>
            <h1 className="text-xl font-bold">Tournament Admin</h1>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => router.push("/michigan")}
              className="bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-xl px-3 py-2 text-sm"
            >
              ← Home
            </button>
            <button
              onClick={() => signOut(auth)}
              className="bg-slate-700 hover:bg-slate-600 text-slate-400 rounded-xl px-3 py-2 text-xs"
            >
              Sign Out
            </button>
          </div>
        </div>

        {/* Initialize button */}
        <div className="bg-slate-800 rounded-2xl p-4 mb-6 border border-slate-700">
          <h2 className="text-sm font-bold text-white mb-2">Tournament Setup</h2>
          <p className="text-xs text-slate-400 mb-3">
            {allInitialized
              ? "✓ All 12 group documents are initialized in Firestore."
              : `${groups.length}/12 groups initialized. Click below to create any missing groups.`}
          </p>
          <button
            onClick={initializeTournament}
            disabled={initLoading || allInitialized}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors w-full"
          >
            {initLoading ? "Initializing…" : allInitialized ? "✓ Already Initialized" : "Initialize Michigan Tournament"}
          </button>
          {initStatus && <p className="text-emerald-400 text-xs mt-2">{initStatus}</p>}
          {initError && <p className="text-red-400 text-xs mt-2">{initError}</p>}
        </div>

        {/* Schedule info */}
        <div className="bg-slate-800 rounded-2xl p-4 mb-6 border border-slate-700">
          <h2 className="text-sm font-bold text-white mb-3">Player Schedule</h2>
          {MICHIGAN_SCHEDULE.map((day) => (
            <div key={day.dayKey} className="mb-3 last:mb-0">
              <p className="text-xs font-bold text-blue-400 mb-1">{day.label} · {day.date} · {day.courseName}</p>
              {day.groups.map((g) => (
                <p key={g.id} className="text-xs text-slate-400 ml-2">
                  {g.label}: {g.players.join(", ")}
                  {!existingIds.has(g.id) && <span className="text-amber-400 ml-1">(not created)</span>}
                  {existingIds.has(g.id) && <span className="text-emerald-500 ml-1">✓</span>}
                </p>
              ))}
            </div>
          ))}
        </div>

        {/* Per-group management */}
        {loading && <p className="text-slate-500 text-sm text-center">Loading groups…</p>}

        {MICHIGAN_SCHEDULE.map((day) =>
          day.groups.map((schedGroup) => {
            const g = groups.find((x) => x.id === schedGroup.id);
            if (!g) return (
              <div key={schedGroup.id} className="bg-slate-800 rounded-2xl p-4 mb-4 border border-amber-800/50 opacity-60">
                <p className="text-sm font-semibold text-amber-400">{schedGroup.id} — Not initialized</p>
              </div>
            );

            const players = g.players ?? [];
            const hcpDraft = hcpDrafts[g.id] ?? {};
            const scDraft = scorecardDrafts[g.id] ?? { pars: "", hcps: "" };
            const holesCompleted = players.reduce((acc, p) => {
              const h = (g.scores?.[p] ?? []).filter((v) => typeof v === "number").length;
              return acc + h;
            }, 0);

            return (
              <div key={g.id} className="bg-slate-800 rounded-2xl p-4 mb-4 border border-slate-700">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="text-sm font-bold text-white">{g.groupName ?? g.id}</p>
                    <p className="text-xs text-slate-500">{g.courseName} · {g.date}</p>
                  </div>
                  <span className={`text-xs font-semibold px-2 py-1 rounded-lg ${
                    holesCompleted === players.length * 18
                      ? "bg-emerald-900/50 text-emerald-400"
                      : holesCompleted > 0
                      ? "bg-blue-900/50 text-blue-400"
                      : "bg-slate-700 text-slate-500"
                  }`}>
                    {holesCompleted === 0 ? "Not started" : holesCompleted === players.length * 18 ? "Complete" : `In progress`}
                  </span>
                </div>

                {/* Roster */}
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wide">Roster</p>
                    {rosterSaving === g.id && <span className="text-[10px] text-slate-500">Saving…</span>}
                  </div>
                  <div className="space-y-2">
                    {[0, 1, 2].map((slot) => (
                      <select
                        key={slot}
                        value={players[slot] ?? ""}
                        onChange={(e) => handleRosterSlotChange(g.id, slot, e.target.value)}
                        className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                      >
                        <option value="">— select player —</option>
                        {ALL_PLAYERS.map((p) => (
                          <option key={p} value={p}>{p}</option>
                        ))}
                      </select>
                    ))}
                  </div>
                  {rosterErrors[g.id] && <p className="text-red-400 text-xs mt-1">{rosterErrors[g.id]}</p>}
                </div>

                {/* Handicaps */}
                <div className="mb-4">
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">Course Handicaps</p>
                  <div className="space-y-2">
                    {players.map((player) => (
                      <div key={player} className="flex items-center gap-2">
                        <span className="text-sm text-slate-300 flex-1 truncate">{player}</span>
                        <input
                          type="number"
                          value={hcpDraft[player] ?? ""}
                          onChange={(e) =>
                            setHcpDrafts((prev) => ({
                              ...prev,
                              [g.id]: { ...(prev[g.id] ?? {}), [player]: e.target.value },
                            }))
                          }
                          placeholder="Hcp"
                          min={0}
                          max={54}
                          className="w-20 bg-slate-700 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
                        />
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={() => saveHandicaps(g.id)}
                    disabled={hcpSaving === g.id}
                    className="mt-2 w-full bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-300 rounded-xl py-2 text-xs font-semibold transition-colors"
                  >
                    {hcpSaving === g.id ? "Saving…" : "Save Handicaps"}
                  </button>
                </div>

                {/* Pars & Handicap Indices */}
                <div className="mb-4">
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">Scorecard (Pars &amp; Hcp Indices)</p>
                  <div className="space-y-2">
                    <div>
                      <label className="text-xs text-slate-500 mb-1 block">Pars (18 values, comma-separated)</label>
                      <input
                        value={scDraft.pars}
                        onChange={(e) =>
                          setScorecardDrafts((prev) => ({
                            ...prev,
                            [g.id]: { ...(prev[g.id] ?? {}), pars: e.target.value },
                          }))
                        }
                        placeholder="4,4,3,5,4,…"
                        className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-500 mb-1 block">Handicap indices (18 unique values 1–18)</label>
                      <input
                        value={scDraft.hcps}
                        onChange={(e) =>
                          setScorecardDrafts((prev) => ({
                            ...prev,
                            [g.id]: { ...(prev[g.id] ?? {}), hcps: e.target.value },
                          }))
                        }
                        placeholder="1,3,15,7,9,…"
                        className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-blue-500"
                      />
                    </div>
                  </div>
                  {scorecardError && scorecardSaving !== g.id && (
                    <p className="text-red-400 text-xs mt-1">{scorecardError}</p>
                  )}
                  <button
                    onClick={() => saveScorecard(g.id)}
                    disabled={scorecardSaving === g.id}
                    className="mt-2 w-full bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-300 rounded-xl py-2 text-xs font-semibold transition-colors"
                  >
                    {scorecardSaving === g.id ? "Saving…" : "Save Scorecard"}
                  </button>
                </div>

                {/* Score summary */}
                <div className="mb-3">
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">Score Progress</p>
                  {players.map((p) => {
                    const holesPlayed = (g.scores?.[p] ?? []).filter((v) => typeof v === "number").length;
                    return (
                      <div key={p} className="flex items-center justify-between text-xs py-1">
                        <span className="text-slate-300">{p}</span>
                        <span className={holesPlayed === 18 ? "text-emerald-400" : holesPlayed > 0 ? "text-blue-400" : "text-slate-600"}>
                          {holesPlayed === 18 ? "✓ Complete" : holesPlayed > 0 ? `${holesPlayed}/18` : "No scores"}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {/* Clear scores */}
                <button
                  onClick={() => clearScores(g.id)}
                  className="w-full border border-red-900 hover:bg-red-900/30 text-red-400 hover:text-red-300 rounded-xl py-2 text-xs font-semibold transition-colors"
                >
                  🗑 Clear All Scores
                </button>
              </div>
            );
          })
        )}

        {/* Player handicap overview across all days */}
        <div className="bg-slate-800 rounded-2xl p-4 mb-4 border border-slate-700 mt-6">
          <h2 className="text-sm font-bold text-white mb-3">Handicap Overview (All Players)</h2>
          <p className="text-xs text-slate-500 mb-3">Set per-round handicaps in each group section above. Here&apos;s a summary:</p>
          {ALL_PLAYERS.map((player) => (
            <div key={player} className="mb-3">
              <p className="text-xs font-semibold text-slate-300 mb-1">{player}</p>
              <div className="grid grid-cols-5 gap-1">
                {MICHIGAN_SCHEDULE.map((day) => {
                  const group = day.groups.find((g) => g.players.includes(player));
                  const groupDoc = groups.find((x) => x.id === group?.id);
                  const hcp = groupDoc?.handicaps?.[player];
                  return (
                    <div key={day.dayKey} className="bg-slate-700 rounded-lg px-2 py-1.5 text-center">
                      <p className="text-[9px] text-slate-500">{day.label}</p>
                      <p className={`text-xs font-bold ${typeof hcp === "number" ? "text-white" : "text-slate-600"}`}>
                        {typeof hcp === "number" ? hcp : "—"}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Points override — manual fix for bad historical data */}
        <div className="bg-slate-800 rounded-2xl p-4 mb-4 border border-amber-800/50">
          <h2 className="text-sm font-bold text-white mb-1">⚠️ Points Override</h2>
          <p className="text-xs text-slate-400 mb-4">
            Manually fix a player&apos;s round points if a round was scored with bad data. Leave blank to use the
            computed value. Overridden rounds still count toward &quot;rounds complete&quot; on the leaderboard.
          </p>
          {MICHIGAN_SCHEDULE.map((day) => {
            const dayKey = day.dayKey as DayKey;
            const computed = computeDayPoints(groups, dayKey);
            const players = day.groups.flatMap((g) => g.players);
            return (
              <div key={day.dayKey} className="mb-4 last:mb-0">
                <p className="text-xs font-bold text-blue-400 mb-2">{day.label} · {day.courseName}</p>
                <div className="space-y-1.5">
                  {players.map((player) => (
                    <div key={player} className="flex items-center gap-2">
                      <span className="text-sm text-slate-300 flex-1 truncate">{player}</span>
                      <span className="text-[11px] text-slate-500 w-24 text-right">
                        computed {typeof computed[player] === "number" ? computed[player] : "—"}
                      </span>
                      <input
                        type="number"
                        min={0}
                        max={6}
                        value={overrideDrafts[dayKey]?.[player] ?? ""}
                        onChange={(e) => handleOverrideChange(dayKey, player, e.target.value)}
                        placeholder="—"
                        className="w-16 bg-slate-700 border border-amber-700/50 rounded-lg px-3 py-1.5 text-sm text-white text-right focus:outline-none focus:border-amber-500"
                      />
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </main>
  );
}
