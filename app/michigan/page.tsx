"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";

// ─── Static Schedule ─────────────────────────────────────────────────────────

export const MICHIGAN_SCHEDULE = [
  {
    dayKey: "day1",
    label: "Day 1",
    date: "June 15",
    course: "Spruce Run",
    groups: [
      { id: "day1-a", label: "Group A", players: ["Craig Lauderdale", "Jay Norwood", "Dave Laurance"] },
      { id: "day1-b", label: "Group B", players: ["Aaron Schliefer", "Frank Moslander", "Rick Lund"] },
    ],
  },
  {
    dayKey: "day2",
    label: "Day 2",
    date: "June 16",
    course: "The Bear – Grand Traverse",
    groups: [
      { id: "day2-a", label: "Group A", players: ["Craig Lauderdale", "Aaron Schliefer", "Rick Lund"] },
      { id: "day2-b", label: "Group B", players: ["Jay Norwood", "Dave Laurance", "Frank Moslander"] },
    ],
  },
  {
    dayKey: "day3",
    label: "Day 3",
    date: "June 17",
    course: "Arcadia Bluffs South",
    groups: [
      { id: "day3-a", label: "Group A", players: ["Craig Lauderdale", "Frank Moslander", "Jay Norwood"] },
      { id: "day3-b", label: "Group B", players: ["Dave Laurance", "Aaron Schliefer", "Rick Lund"] },
    ],
  },
  {
    dayKey: "day4",
    label: "Day 4",
    date: "June 18",
    course: "Bay Harbor Links/Quarry",
    groups: [
      { id: "day4-a", label: "Group A", players: ["Craig Lauderdale", "Dave Laurance", "Aaron Schliefer"] },
      { id: "day4-b", label: "Group B", players: ["Jay Norwood", "Frank Moslander", "Rick Lund"] },
    ],
  },
  {
    dayKey: "day5",
    label: "Day 5",
    date: "June 19",
    course: "Forest Dunes",
    groups: [
      { id: "day5-a", label: "Group A", players: ["Craig Lauderdale", "Rick Lund", "Frank Moslander"] },
      { id: "day5-b", label: "Group B", players: ["Jay Norwood", "Dave Laurance", "Aaron Schliefer"] },
    ],
  },
] as const;

// ─── Types ───────────────────────────────────────────────────────────────────

type MichiganGroupDoc = {
  day: string;
  groupName: string;
  players: string[];
  course: string;
  courseName: string;
  date: string;
  pars?: number[];
  hcps?: number[];
  scores?: Record<string, (number | null)[]>;
  handicaps?: Record<string, number | null>;
};

type LiveGroupInfo = {
  holesPlayed: Record<string, number>;
  initialized: boolean;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function holesPlayedForPlayer(scores: (number | null)[] | undefined): number {
  if (!scores) return 0;
  return scores.filter((v) => typeof v === "number").length;
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function MichiganHomePage() {
  const router = useRouter();
  const [liveInfo, setLiveInfo] = useState<Record<string, LiveGroupInfo>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "michigan"),
      (snap) => {
        const next: Record<string, LiveGroupInfo> = {};
        for (const d of snap.docs) {
          const data = d.data() as MichiganGroupDoc;
          const players = data.players ?? [];
          const scores = data.scores ?? {};
          const holesPlayed: Record<string, number> = {};
          for (const p of players) {
            holesPlayed[p] = holesPlayedForPlayer(scores[p]);
          }
          next[d.id] = { holesPlayed, initialized: true };
        }
        setLiveInfo(next);
        setLoading(false);
      },
      () => setLoading(false)
    );
    return () => unsub();
  }, []);

  function navigateToScore(groupId: string, playerName: string) {
    sessionStorage.setItem("michigan_player", JSON.stringify({ name: playerName, groupId }));
    router.push(`/michigan/group/${groupId}/score`);
  }

  return (
    <main className="min-h-screen bg-slate-900 text-white">
      <div className="max-w-lg mx-auto px-4 py-6">

        {/* Header */}
        <div className="mb-6">
          <p className="text-[10px] font-bold tracking-widest text-blue-400 uppercase mb-1">June 15–19, 2026 · Michigan</p>
          <h1 className="text-2xl font-bold text-white">Michigan Golf Trip</h1>
          <p className="text-slate-400 text-sm mt-0.5">5 rounds · 6 players · rotating groups of 3</p>
        </div>

        {/* Action buttons */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => router.push("/michigan/leaderboard")}
            className="flex-1 bg-blue-600 hover:bg-blue-500 text-white rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors"
          >
            🏆 Leaderboard
          </button>
          <button
            onClick={() => router.push("/michigan/admin")}
            className="bg-slate-700 hover:bg-slate-600 text-slate-300 hover:text-white rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors"
          >
            ⚙️ Admin
          </button>
          <button
            onClick={() => router.push("/")}
            className="bg-slate-700 hover:bg-slate-600 text-slate-300 hover:text-white rounded-xl px-4 py-2.5 text-sm transition-colors"
          >
            ← Cal-Pac
          </button>
        </div>

        {/* Schedule */}
        <div className="space-y-4">
          {MICHIGAN_SCHEDULE.map((day) => {
            const today = new Date();
            const dayDate = new Date(`${day.date} 2026`);
            const isToday = today.toDateString() === dayDate.toDateString();
            const isPast = dayDate < today && !isToday;

            return (
              <div
                key={day.dayKey}
                className={`rounded-2xl border overflow-hidden ${
                  isToday
                    ? "border-blue-500 bg-blue-900/20"
                    : isPast
                    ? "border-slate-700 bg-slate-800/50 opacity-80"
                    : "border-slate-700 bg-slate-800"
                }`}
              >
                {/* Day header */}
                <div className={`px-4 py-3 flex items-center justify-between ${isToday ? "bg-blue-600/20" : "bg-slate-800"}`}>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-white">{day.label}</span>
                      {isToday && (
                        <span className="text-[10px] font-bold bg-blue-500 text-white px-2 py-0.5 rounded-full uppercase tracking-wide">
                          Today
                        </span>
                      )}
                      {isPast && (
                        <span className="text-[10px] font-bold bg-slate-600 text-slate-300 px-2 py-0.5 rounded-full uppercase tracking-wide">
                          Complete
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">{day.date} · {day.course}</p>
                  </div>
                </div>

                {/* Groups */}
                <div className="divide-y divide-slate-700">
                  {day.groups.map((group) => {
                    const live = liveInfo[group.id];
                    return (
                      <div key={group.id} className="px-4 py-3">
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-2">
                          {group.label}
                          {!loading && !live?.initialized && (
                            <span className="ml-2 text-amber-500">· not initialized</span>
                          )}
                        </p>
                        <div className="space-y-1.5">
                          {group.players.map((player) => {
                            const holes = live?.holesPlayed?.[player] ?? 0;
                            const finished = holes === 18;
                            return (
                              <button
                                key={player}
                                onClick={() => navigateToScore(group.id, player)}
                                className="w-full flex items-center justify-between bg-slate-700/50 hover:bg-slate-600/70 border border-slate-600 rounded-xl px-3.5 py-2.5 transition-colors active:scale-[0.99]"
                              >
                                <span className="text-sm font-semibold text-white">{player}</span>
                                <span
                                  className={`text-xs font-semibold ${
                                    finished
                                      ? "text-emerald-400"
                                      : holes > 0
                                      ? "text-blue-400"
                                      : "text-slate-500"
                                  }`}
                                >
                                  {finished ? "✓ F" : holes > 0 ? `Thru ${holes}` : "—"}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <p className="text-center text-slate-600 text-xs mt-8">Michigan Golf Trip 2026</p>
      </div>
    </main>
  );
}
