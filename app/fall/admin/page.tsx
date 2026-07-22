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
  scoresLocked?: boolean;
};

type RowEdit = { name?: string; hcp?: string; moveToGid?: string };
type AddDraft = { name: string; hcp: string; gid: string };

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
    scoresLocked: false,
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

  const [rowEdits, setRowEdits] = useState<Record<string, RowEdit>>({});
  const [rowSaving, setRowSaving] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, string | null>>({});
  const [addDrafts, setAddDrafts] = useState<Record<string, AddDraft>>({});
  const [lockSaving, setLockSaving] = useState<string | null>(null);

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

  const rowKey = (gid: string, player: string) => `${gid}::${player}`;

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

  async function toggleLock(groupId: string, next: boolean) {
    setLockSaving(groupId);
    try {
      await updateDoc(doc(db, "fall", groupId), { scoresLocked: next, updatedAt: serverTimestamp() });
    } catch (err) {
      console.error(err);
    } finally {
      setLockSaving(null);
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

  // Rename (in place) + move (across groups) + set handicap — mirrors tourney savePlayerEdits
  async function savePlayerRow(groupId: string, player: string) {
    const key = rowKey(groupId, player);
    const edit = rowEdits[key] ?? {};
    const src = groups.find((g) => g.id === groupId);
    if (!src) return;

    const newName = (edit.name ?? player).trim() || player;
    const targetGid = edit.moveToGid && edit.moveToGid !== groupId ? edit.moveToGid : groupId;
    const target = groups.find((g) => g.id === targetGid);
    if (!target) return;

    const hcpRaw = edit.hcp;
    const existingHcp = typeof src.handicaps?.[player] === "number" ? (src.handicaps![player] as number) : null;
    const hcpVal = hcpRaw === undefined ? existingHcp : hcpRaw.trim() === "" ? null : Number.isFinite(Number(hcpRaw)) ? Number(hcpRaw) : null;
    const savedScores = Array.isArray(src.scores?.[player]) ? (src.scores![player] as (number | null)[]) : Array.from({ length: HOLE_COUNT }, () => null);

    const collidesIn = (grp: FallGroupDoc, exclude: string) =>
      (grp.players ?? []).some((p) => p.toLowerCase() === newName.toLowerCase() && p.toLowerCase() !== exclude.toLowerCase());

    setRowSaving(key);
    setRowError((prev) => ({ ...prev, [key]: null }));
    try {
      if (targetGid === groupId) {
        // rename in place
        if (newName.toLowerCase() !== player.toLowerCase() && collidesIn(src, player)) {
          setRowError((prev) => ({ ...prev, [key]: `${newName} is already in this group.` }));
          return;
        }
        const players = (src.players ?? []).map((p) => (p === player ? newName : p));
        const scores = { ...(src.scores ?? {}) };
        const handicaps = { ...(src.handicaps ?? {}) };
        if (newName !== player) { delete scores[player]; delete handicaps[player]; }
        scores[newName] = savedScores;
        handicaps[newName] = hcpVal;
        await updateDoc(doc(db, "fall", groupId), { players, scores, handicaps, updatedAt: serverTimestamp() });
      } else {
        // move to another group (same round)
        if (collidesIn(target, "")) {
          setRowError((prev) => ({ ...prev, [key]: `${newName} is already in ${target.groupName ?? target.id}.` }));
          return;
        }
        // remove from source
        const srcPlayers = (src.players ?? []).filter((p) => p !== player);
        const srcScores = { ...(src.scores ?? {}) }; delete srcScores[player];
        const srcHcps = { ...(src.handicaps ?? {}) }; delete srcHcps[player];
        // add to target
        const tgtPlayers = [...(target.players ?? []), newName];
        const tgtScores = { ...(target.scores ?? {}), [newName]: savedScores };
        const tgtHcps = { ...(target.handicaps ?? {}), [newName]: hcpVal };
        await updateDoc(doc(db, "fall", groupId), { players: srcPlayers, scores: srcScores, handicaps: srcHcps, updatedAt: serverTimestamp() });
        await updateDoc(doc(db, "fall", targetGid), { players: tgtPlayers, scores: tgtScores, handicaps: tgtHcps, updatedAt: serverTimestamp() });
      }
      setRowEdits((prev) => { const n = { ...prev }; delete n[key]; return n; });
    } catch (err) {
      setRowError((prev) => ({ ...prev, [key]: err instanceof Error ? err.message : "Save failed." }));
    } finally {
      setRowSaving(null);
    }
  }

  async function deletePlayer(groupId: string, player: string) {
    if (!confirm(`Remove ${player} from this group?`)) return;
    const g = groups.find((x) => x.id === groupId);
    if (!g) return;
    const players = (g.players ?? []).filter((p) => p !== player);
    const scores = { ...(g.scores ?? {}) }; delete scores[player];
    const handicaps = { ...(g.handicaps ?? {}) }; delete handicaps[player];
    try {
      await updateDoc(doc(db, "fall", groupId), { players, scores, handicaps, updatedAt: serverTimestamp() });
    } catch (err) {
      console.error(err);
    }
  }

  async function addPlayer(roundKey: string) {
    const draft = addDrafts[roundKey];
    if (!draft) return;
    const name = draft.name.trim();
    const gid = draft.gid;
    if (!name || !gid) return;
    const g = groups.find((x) => x.id === gid);
    if (!g) return;
    if ((g.players ?? []).some((p) => p.toLowerCase() === name.toLowerCase())) return;
    const hcpVal = draft.hcp.trim() === "" ? null : Number.isFinite(Number(draft.hcp)) ? Number(draft.hcp) : null;
    try {
      await updateDoc(doc(db, "fall", gid), {
        players: [...(g.players ?? []), name],
        scores: { ...(g.scores ?? {}), [name]: Array.from({ length: HOLE_COUNT }, () => null) },
        handicaps: { ...(g.handicaps ?? {}), [name]: hcpVal },
        updatedAt: serverTimestamp(),
      });
      setAddDrafts((prev) => ({ ...prev, [roundKey]: { name: "", hcp: "", gid } }));
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
      <div className="max-w-2xl mx-auto px-4 py-6">

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
              ? "✓ Every round has a starter group. Add more groups, players and handicaps below."
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
          const roundGroups = groups.filter((g) => g.round === round.roundKey)
            .sort((a, b) => (a.groupName ?? a.id).localeCompare(b.groupName ?? b.id));
          const course = round.courseId ? COURSES[round.courseId] : null;
          const groupOptions = roundGroups.map((g) => ({ gid: g.id, name: g.groupName ?? g.id }));
          const add = addDrafts[round.roundKey] ?? { name: "", hcp: "", gid: groupOptions[0]?.gid ?? "" };
          // flatten players across the round's groups
          const roster = roundGroups.flatMap((g) => (g.players ?? []).filter(Boolean).map((p) => ({ g, player: p })));

          return (
            <div key={round.roundKey} className="mb-8">
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

              {/* Group controls (lock / clear / delete) */}
              {roundGroups.length > 0 && (
                <div className="space-y-2 mb-3">
                  {roundGroups.map((g) => {
                    const holesDone = (g.players ?? []).reduce((acc, p) => acc + (g.scores?.[p] ?? []).filter((v) => typeof v === "number").length, 0);
                    return (
                      <div key={g.id} className="bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2.5 flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-white flex-1 min-w-[8rem]">
                          {g.groupName ?? g.id}
                          {g.scoresLocked && <span className="ml-2 text-[10px] font-bold bg-yellow-900/50 text-yellow-400 px-2 py-0.5 rounded-full uppercase">🔒 Locked</span>}
                          <span className="ml-2 text-[10px] text-zinc-500">{(g.players ?? []).filter(Boolean).length} players · {holesDone} scores</span>
                        </span>
                        <button
                          onClick={() => toggleLock(g.id, !g.scoresLocked)}
                          disabled={lockSaving === g.id}
                          className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 ${g.scoresLocked ? "bg-zinc-700 hover:bg-zinc-600 text-zinc-200" : "bg-emerald-700 hover:bg-emerald-600 text-white"}`}
                        >
                          {lockSaving === g.id ? "…" : g.scoresLocked ? "Unlock" : "Lock"}
                        </button>
                        <button onClick={() => clearScores(g.id)} className="rounded-lg px-3 py-1.5 text-xs font-semibold bg-zinc-800 hover:bg-red-900/40 text-red-400 border border-red-900/60">Clear</button>
                        <button onClick={() => deleteGroup(g.id)} className="rounded-lg px-3 py-1.5 text-xs font-semibold bg-zinc-800 hover:bg-red-900/40 text-red-500">Delete</button>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Players table */}
              {roster.length > 0 && (
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-x-auto mb-3">
                  <table className="w-full min-w-[460px] text-xs">
                    <thead>
                      <tr className="text-left text-zinc-500">
                        <th className="p-2 font-semibold">Player</th>
                        <th className="p-2 font-semibold">Group</th>
                        <th className="p-2 font-semibold w-14">HCP</th>
                        <th className="p-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {roster.map(({ g, player }) => {
                        const key = rowKey(g.id, player);
                        const edit = rowEdits[key] ?? {};
                        const nameVal = edit.name ?? player;
                        const hcpVal = edit.hcp ?? (typeof g.handicaps?.[player] === "number" ? String(g.handicaps![player]) : "");
                        const gidVal = edit.moveToGid ?? g.id;
                        return (
                          <tr key={key} className="border-t border-zinc-800">
                            <td className="p-2">
                              <input
                                value={nameVal}
                                onChange={(e) => setRowEdits((prev) => ({ ...prev, [key]: { ...(prev[key] ?? {}), name: e.target.value } }))}
                                className="w-[12ch] px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-white focus:outline-none focus:border-emerald-500"
                              />
                            </td>
                            <td className="p-2">
                              <select
                                value={gidVal}
                                onChange={(e) => setRowEdits((prev) => ({ ...prev, [key]: { ...(prev[key] ?? {}), moveToGid: e.target.value } }))}
                                className="px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-white focus:outline-none focus:border-emerald-500 max-w-[9rem]"
                              >
                                {groupOptions.map((o) => <option key={o.gid} value={o.gid}>{o.name}</option>)}
                              </select>
                            </td>
                            <td className="p-2">
                              <input
                                value={hcpVal}
                                onChange={(e) => setRowEdits((prev) => ({ ...prev, [key]: { ...(prev[key] ?? {}), hcp: e.target.value } }))}
                                inputMode="numeric"
                                className="w-12 px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-center text-white focus:outline-none focus:border-emerald-500"
                              />
                            </td>
                            <td className="p-2 whitespace-nowrap">
                              <div className="flex gap-1 justify-end">
                                <button onClick={() => deletePlayer(g.id, player)} className="bg-zinc-800 hover:bg-red-900/40 text-red-400 border border-zinc-700 rounded px-2 py-1">Del</button>
                                <button
                                  onClick={() => savePlayerRow(g.id, player)}
                                  disabled={rowSaving === key}
                                  className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded px-2.5 py-1 font-semibold"
                                >
                                  {rowSaving === key ? "…" : "Save"}
                                </button>
                              </div>
                              {rowError[key] && <p className="text-red-400 text-[10px] mt-1">{rowError[key]}</p>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Add player */}
              {groupOptions.length > 0 && (
                <div className="flex flex-wrap gap-2 items-center">
                  <input
                    value={add.name}
                    onChange={(e) => setAddDrafts((prev) => ({ ...prev, [round.roundKey]: { ...add, name: e.target.value } }))}
                    placeholder="Add player name"
                    className="flex-1 min-w-[10rem] bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-emerald-500"
                  />
                  <input
                    value={add.hcp}
                    onChange={(e) => setAddDrafts((prev) => ({ ...prev, [round.roundKey]: { ...add, hcp: e.target.value } }))}
                    placeholder="Hcp"
                    inputMode="numeric"
                    className="w-16 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white text-center placeholder:text-zinc-500 focus:outline-none focus:border-emerald-500"
                  />
                  <select
                    value={add.gid || groupOptions[0]?.gid}
                    onChange={(e) => setAddDrafts((prev) => ({ ...prev, [round.roundKey]: { ...add, gid: e.target.value } }))}
                    className="bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-2 text-sm text-white focus:outline-none focus:border-emerald-500 max-w-[9rem]"
                  >
                    {groupOptions.map((o) => <option key={o.gid} value={o.gid}>{o.name}</option>)}
                  </select>
                  <button
                    onClick={() => addPlayer(round.roundKey)}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg px-4 py-2 text-sm font-semibold transition-colors"
                  >
                    Add
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </main>
  );
}
