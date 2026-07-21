"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
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

function emptyScores(players: string[]) {
  const s: Record<string, (number | null)[]> = {};
  for (const p of players) s[p] = Array.from({ length: HOLE_COUNT }, () => null);
  return s;
}

function buildInitialDoc(roundKey: string, groupName: string, courseId: string | null, courseName: string) {
  return {
    round: roundKey,
    groupName,
    players: [] as string[],
    courseId,
    courseName,
    scores: {},
    handicaps: {},
    contest: { closestToPinByHole: {} },
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

export default function FallAdminPage() {
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

  const [groups, setGroups] = useState<FallGroupDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [initStatus, setInitStatus] = useState<string | null>(null);
  const [initLoading, setInitLoading] = useState(false);

  // Roster drafts: { [groupId]: string[] }
  const [rosterDrafts, setRosterDrafts] = useState<Record<string, string[]>>({});
  const [rosterSaving, setRosterSaving] = useState<string | null>(null);
  // Handicap drafts: { [groupId]: { [player]: string } }
  const [hcpDrafts, setHcpDrafts] = useState<Record<string, Record<string, string>>>({});
  const [hcpSaving, setHcpSaving] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setAdminUser(u));
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!isAdmin) { setLoading(false); return; }
    const unsub = onSnapshot(
      collection(db, "fall"),
      (snap) => {
        setGroups(snap.docs.map((d) => ({ id: d.id, ...d.data() } as FallGroupDoc)));
        setLoading(false);
      },
      () => setLoading(false)
    );
    return () => unsub();
  }, [isAdmin]);

  // Seed drafts when groups load (without clobbering active edits)
  useEffect(() => {
    for (const g of groups) {
      if (!rosterDrafts[g.id]) {
        setRosterDrafts((prev) => ({ ...prev, [g.id]: [...(g.players ?? [])] }));
      }
      if (!hcpDrafts[g.id]) {
        const d: Record<string, string> = {};
        for (const p of g.players ?? []) {
          const v = g.handicaps?.[p];
          d[p] = typeof v === "number" ? String(v) : "";
        }
        setHcpDrafts((prev) => ({ ...prev, [g.id]: d }));
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

  async function initializeSeries() {
    setInitLoading(true);
    setInitStatus(null);
    try {
      const existingIds = new Set(groups.map((g) => g.id));
      let created = 0;
      for (const round of FALL_ROUNDS) {
        const id = `${round.roundKey}-a`;
        if (!existingIds.has(id)) {
          await setDoc(doc(db, "fall", id), buildInitialDoc(round.roundKey, `${round.label} · Group A`, round.courseId, round.courseName));
          created++;
        }
      }
      setInitStatus(created > 0 ? `✓ Created ${created} group(s).` : "All rounds already have a starter group.");
    } catch (err) {
      setInitStatus(err instanceof Error ? err.message : "Initialization failed.");
    } finally {
      setInitLoading(false);
    }
  }

  async function addGroup(roundKey: string, courseId: string | null, courseName: string, label: string) {
    const roundGroups = groups.filter((g) => g.round === roundKey);
    const letter = String.fromCharCode(65 + roundGroups.length); // A, B, C…
    const id = `${roundKey}-${letter.toLowerCase()}`;
    try {
      await setDoc(doc(db, "fall", id), buildInitialDoc(roundKey, `${label} · Group ${letter}`, courseId, courseName));
    } catch (err) {
      console.error(err);
    }
  }

  async function deleteGroup(groupId: string) {
    if (!confirm("Delete this group and all its scores? This cannot be undone.")) return;
    try {
      await deleteDoc(doc(db, "fall", groupId));
    } catch (err) {
      console.error(err);
    }
  }

  function setRosterSlot(groupId: string, idx: number, value: string) {
    setRosterDrafts((prev) => {
      const list = [...(prev[groupId] ?? [])];
      list[idx] = value;
      return { ...prev, [groupId]: list };
    });
  }

  function addRosterSlot(groupId: string) {
    setRosterDrafts((prev) => ({ ...prev, [groupId]: [...(prev[groupId] ?? []), ""] }));
  }

  function removeRosterSlot(groupId: string, idx: number) {
    setRosterDrafts((prev) => {
      const list = [...(prev[groupId] ?? [])];
      list.splice(idx, 1);
      return { ...prev, [groupId]: list };
    });
  }

  async function saveRoster(groupId: string) {
    const g = groups.find((x) => x.id === groupId);
    if (!g) return;
    const cleaned = (rosterDrafts[groupId] ?? []).map((p) => p.trim()).filter(Boolean);
    // de-dupe, preserve order
    const players = [...new Set(cleaned)];
    // reconcile scores + handicaps by name
    const newScores: Record<string, (number | null)[]> = {};
    const newHandicaps: Record<string, number | null> = {};
    for (const p of players) {
      newScores[p] = Array.isArray(g.scores?.[p]) ? (g.scores![p] as (number | null)[]) : Array.from({ length: HOLE_COUNT }, () => null);
      newHandicaps[p] = typeof g.handicaps?.[p] === "number" ? (g.handicaps![p] as number) : null;
    }
    setRosterSaving(groupId);
    try {
      await updateDoc(doc(db, "fall", groupId), {
        players,
        scores: newScores,
        handicaps: newHandicaps,
        updatedAt: serverTimestamp(),
      });
      // sync hcp drafts to new roster
      setHcpDrafts((prev) => {
        const d: Record<string, string> = {};
        for (const p of players) d[p] = typeof newHandicaps[p] === "number" ? String(newHandicaps[p]) : (prev[groupId]?.[p] ?? "");
        return { ...prev, [groupId]: d };
      });
    } catch (err) {
      console.error(err);
    } finally {
      setRosterSaving(null);
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
      await updateDoc(doc(db, "fall", groupId), { handicaps: patch, updatedAt: serverTimestamp() });
    } catch (err) {
      console.error(err);
    } finally {
      setHcpSaving(null);
    }
  }

  async function clearScores(groupId: string) {
    if (!confirm("Clear all scores for this group? This cannot be undone.")) return;
    const g = groups.find((x) => x.id === groupId);
    if (!g) return;
    try {
      await updateDoc(doc(db, "fall", groupId), {
        scores: emptyScores((g.players ?? []).filter(Boolean)),
        contest: { closestToPinByHole: {} },
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      console.error(err);
    }
  }

  // ─── Auth gate ────────────────────────────────────────────────────────────

  if (!adminUser) {
    return (
      <main className="min-h-screen bg-zinc-950 text-white flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <button onClick={() => router.push("/fall")} className="text-zinc-500 text-sm mb-4 hover:text-zinc-300">← Back to Fall Series</button>
          <h1 className="text-xl font-bold mb-6">Fall Series Admin</h1>
          <form onSubmit={handleLogin} className="space-y-3">
            <input type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} placeholder="Email"
              className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-emerald-500" />
            <input type="password" value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} placeholder="Password"
              className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-emerald-500" />
            {adminError && <p className="text-red-400 text-sm">{adminError}</p>}
            <button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl py-3 font-semibold transition-colors">Sign In</button>
          </form>
        </div>
      </main>
    );
  }

  if (!isAdmin) {
    return (
      <main className="min-h-screen bg-zinc-950 text-white flex items-center justify-center p-6">
        <div className="text-center">
          <p className="text-red-400 mb-4">Access denied. Your account is not an admin.</p>
          <button onClick={() => signOut(auth)} className="bg-zinc-800 text-zinc-300 rounded-xl px-4 py-2 text-sm">Sign Out</button>
        </div>
      </main>
    );
  }

  // ─── Admin UI ─────────────────────────────────────────────────────────────

  const existingIds = new Set(groups.map((g) => g.id));
  const allSeeded = FALL_ROUNDS.every((r) => existingIds.has(`${r.roundKey}-a`));

  return (
    <main className="min-h-screen bg-zinc-950 text-white pb-16">
      <div className="max-w-lg mx-auto px-4 py-6">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <p className="text-[10px] font-bold tracking-widest text-emerald-400 uppercase">Fall Series 2026</p>
            <h1 className="text-xl font-bold">Series Admin</h1>
          </div>
          <div className="flex gap-2">
            <button onClick={() => router.push("/fall")} className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl px-3 py-2 text-sm">← Home</button>
            <button onClick={() => signOut(auth)} className="bg-zinc-800 hover:bg-zinc-700 text-zinc-400 rounded-xl px-3 py-2 text-xs">Sign Out</button>
          </div>
        </div>

        {/* Initialize */}
        <div className="bg-zinc-900 rounded-2xl p-4 mb-6 border border-zinc-800">
          <h2 className="text-sm font-bold text-white mb-2">Series Setup</h2>
          <p className="text-xs text-zinc-400 mb-3">
            {allSeeded
              ? "✓ Every round has a starter group. Add more groups or edit rosters below."
              : "Create a starter “Group A” for each of the 7 rounds. You can add players and more groups afterward."}
          </p>
          <button
            onClick={initializeSeries}
            disabled={initLoading}
            className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors w-full"
          >
            {initLoading ? "Initializing…" : allSeeded ? "Re-run Setup (create any missing groups)" : "Initialize Fall Series"}
          </button>
          {initStatus && <p className="text-emerald-400 text-xs mt-2">{initStatus}</p>}
        </div>

        {loading && <p className="text-zinc-500 text-sm text-center">Loading groups…</p>}

        {/* Per-round management */}
        {FALL_ROUNDS.map((round) => {
          const roundGroups = groups.filter((g) => g.round === round.roundKey);
          const course = round.courseId ? COURSES[round.courseId] : null;
          return (
            <div key={round.roundKey} className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <p className="text-sm font-bold text-white">{round.label}</p>
                  <p className="text-xs text-emerald-400/80">
                    {round.courseName}{course ? ` · Par ${course.par}` : " · not wired to a course yet"}
                  </p>
                </div>
                <button
                  onClick={() => addGroup(round.roundKey, round.courseId, round.courseName, round.label)}
                  className="bg-zinc-800 hover:bg-zinc-700 text-emerald-400 rounded-lg px-3 py-1.5 text-xs font-semibold"
                >
                  + Group
                </button>
              </div>

              {roundGroups.length === 0 && (
                <p className="text-xs text-zinc-600 italic mb-2">No groups. Use “Initialize” above or “+ Group”.</p>
              )}

              {roundGroups.map((g) => {
                const roster = rosterDrafts[g.id] ?? [];
                const hcpDraft = hcpDrafts[g.id] ?? {};
                const savedPlayers = (g.players ?? []).filter(Boolean);
                return (
                  <div key={g.id} className="bg-zinc-900 rounded-2xl p-4 mb-3 border border-zinc-800">
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-sm font-bold text-white">{g.groupName ?? g.id}</p>
                      <button onClick={() => deleteGroup(g.id)} className="text-red-500 hover:text-red-400 text-xs">Delete</button>
                    </div>

                    {/* Roster */}
                    <div className="mb-4">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-xs font-bold text-zinc-400 uppercase tracking-wide">Roster</p>
                        {rosterSaving === g.id && <span className="text-[10px] text-zinc-500">Saving…</span>}
                      </div>
                      <div className="space-y-2">
                        {roster.map((name, idx) => (
                          <div key={idx} className="flex gap-2">
                            <input
                              value={name}
                              onChange={(e) => setRosterSlot(g.id, idx, e.target.value)}
                              placeholder={`Player ${idx + 1}`}
                              className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-emerald-500"
                            />
                            <button onClick={() => removeRosterSlot(g.id, idx)} className="w-9 shrink-0 bg-zinc-800 hover:bg-zinc-700 text-zinc-500 hover:text-red-400 rounded-lg text-sm">✕</button>
                          </div>
                        ))}
                      </div>
                      <div className="flex gap-2 mt-2">
                        <button onClick={() => addRosterSlot(g.id)} className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl py-2 text-xs font-semibold transition-colors">+ Add Player</button>
                        <button onClick={() => saveRoster(g.id)} disabled={rosterSaving === g.id} className="flex-1 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white rounded-xl py-2 text-xs font-semibold transition-colors">Save Roster</button>
                      </div>
                    </div>

                    {/* Handicaps */}
                    {savedPlayers.length > 0 && (
                      <div className="mb-4">
                        <p className="text-xs font-bold text-zinc-400 uppercase tracking-wide mb-2">Course Handicaps</p>
                        <div className="space-y-2">
                          {savedPlayers.map((player) => (
                            <div key={player} className="flex items-center gap-2">
                              <span className="text-sm text-zinc-300 flex-1 truncate">{player}</span>
                              <input
                                type="number"
                                value={hcpDraft[player] ?? ""}
                                onChange={(e) => setHcpDrafts((prev) => ({ ...prev, [g.id]: { ...(prev[g.id] ?? {}), [player]: e.target.value } }))}
                                placeholder="Hcp"
                                min={0}
                                max={54}
                                className="w-20 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-emerald-500"
                              />
                            </div>
                          ))}
                        </div>
                        <button onClick={() => saveHandicaps(g.id)} disabled={hcpSaving === g.id} className="mt-2 w-full bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-300 rounded-xl py-2 text-xs font-semibold transition-colors">
                          {hcpSaving === g.id ? "Saving…" : "Save Handicaps"}
                        </button>
                      </div>
                    )}

                    {/* Score progress */}
                    {savedPlayers.length > 0 && (
                      <div className="mb-3">
                        <p className="text-xs font-bold text-zinc-400 uppercase tracking-wide mb-2">Score Progress</p>
                        {savedPlayers.map((p) => {
                          const played = (g.scores?.[p] ?? []).filter((v) => typeof v === "number").length;
                          return (
                            <div key={p} className="flex items-center justify-between text-xs py-1">
                              <span className="text-zinc-300">{p}</span>
                              <span className={played === 18 ? "text-emerald-400" : played > 0 ? "text-emerald-300" : "text-zinc-600"}>
                                {played === 18 ? "✓ Complete" : played > 0 ? `${played}/18` : "No scores"}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    <button onClick={() => clearScores(g.id)} className="w-full border border-red-900 hover:bg-red-900/30 text-red-400 hover:text-red-300 rounded-xl py-2 text-xs font-semibold transition-colors">
                      🗑 Clear All Scores
                    </button>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </main>
  );
}
