"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { FALL_ROUNDS } from "@/lib/fallSeries";

const HOLE_COUNT = 18;

type FallGroupDoc = {
  id: string;
  round?: string;
  groupName?: string;
  players?: string[];
  courseId?: string | null;
  courseName?: string;
  scores?: Record<string, (number | null)[]>;
};

function holesPlayed(scores: (number | null)[] | undefined): number {
  if (!scores) return 0;
  return scores.filter((v) => typeof v === "number").length;
}

export default function FallHomePage() {
  const router = useRouter();
  const [groups, setGroups] = useState<FallGroupDoc[]>([]);
  const [loading, setLoading] = useState(true);

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

  const groupsByRound = useMemo(() => {
    const map = new Map<string, FallGroupDoc[]>();
    for (const g of groups) {
      const key = g.round ?? "";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(g);
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.groupName ?? a.id).localeCompare(b.groupName ?? b.id));
    }
    return map;
  }, [groups]);

  function navigateToScore(groupId: string, playerName: string) {
    sessionStorage.setItem("fall_player", JSON.stringify({ name: playerName, groupId }));
    router.push(`/fall/group/${groupId}/score`);
  }

  const totalGroups = groups.length;

  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      <div className="max-w-lg mx-auto px-4 py-6">

        {/* Header */}
        <div className="mb-6">
          <p className="text-[10px] font-bold tracking-widest text-emerald-400 uppercase mb-1">Fall 2026 · 7 Courses</p>
          <h1 className="text-2xl font-bold text-white">🍂 Fall Series</h1>
          <p className="text-zinc-400 text-sm mt-0.5">Select your name to score your round</p>
        </div>

        {/* Action buttons */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => router.push("/fall/leaderboard")}
            className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors"
          >
            🏆 Leaderboard
          </button>
          <button
            onClick={() => router.push("/fall/admin")}
            className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors"
          >
            ⚙️ Admin
          </button>
          <button
            onClick={() => router.push("/")}
            className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white rounded-xl px-4 py-2.5 text-sm transition-colors"
          >
            ← Cal-Pac
          </button>
        </div>

        {loading && <p className="text-center text-zinc-500 text-sm py-6">Loading…</p>}

        {!loading && totalGroups === 0 && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-6 text-center mb-6">
            <p className="text-sm text-zinc-400 mb-2">No groups set up yet.</p>
            <button onClick={() => router.push("/fall/admin")} className="text-sm text-emerald-400 underline">
              Open Admin to initialize the Fall Series →
            </button>
          </div>
        )}

        {/* Rounds */}
        <div className="space-y-4">
          {FALL_ROUNDS.map((round) => {
            const roundGroups = groupsByRound.get(round.roundKey) ?? [];
            const isTbd = !round.courseId;
            return (
              <div
                key={round.roundKey}
                className={`rounded-2xl border overflow-hidden ${isTbd ? "border-zinc-800 bg-zinc-900/50" : "border-zinc-700 bg-zinc-900"}`}
              >
                {/* Round header */}
                <div className="px-4 py-3 bg-zinc-800/60">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-white">{round.label}</span>
                    {isTbd && (
                      <span className="text-[10px] font-bold bg-zinc-700 text-zinc-400 px-2 py-0.5 rounded-full uppercase tracking-wide">TBD</span>
                    )}
                  </div>
                  <p className="text-xs text-emerald-400/80 mt-0.5">{round.courseName}</p>
                </div>

                {/* Groups */}
                {roundGroups.length === 0 ? (
                  <div className="px-4 py-3">
                    <p className="text-xs text-zinc-600 italic">No groups yet</p>
                  </div>
                ) : (
                  <div className="divide-y divide-zinc-800">
                    {roundGroups.map((group) => {
                      const players = (group.players ?? []).filter(Boolean);
                      return (
                        <div key={group.id} className="px-4 py-3">
                          <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-wide mb-2">
                            {group.groupName ?? group.id}
                          </p>
                          {players.length === 0 ? (
                            <p className="text-xs text-zinc-600 italic">No players assigned</p>
                          ) : (
                            <div className="space-y-1.5">
                              {players.map((player) => {
                                const holes = holesPlayed(group.scores?.[player]);
                                const finished = holes === HOLE_COUNT;
                                return (
                                  <button
                                    key={player}
                                    onClick={() => navigateToScore(group.id, player)}
                                    className="w-full flex items-center justify-between bg-zinc-800/50 hover:bg-zinc-700/70 border border-zinc-700 rounded-xl px-3.5 py-2.5 transition-colors active:scale-[0.99]"
                                  >
                                    <span className="text-sm font-semibold text-white">{player}</span>
                                    <span className={`text-xs font-semibold ${finished ? "text-emerald-400" : holes > 0 ? "text-emerald-300" : "text-zinc-500"}`}>
                                      {finished ? "✓ F" : holes > 0 ? `Thru ${holes}` : "—"}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <p className="text-center text-zinc-700 text-xs mt-8">Cal-Pacific Fall Series 2026</p>
      </div>
    </main>
  );
}
