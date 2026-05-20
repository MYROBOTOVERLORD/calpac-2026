"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";

type GroupSummary = {
  id: string;
  name: string;
  players: string[];
};

export default function Home() {
  const router = useRouter();
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const snap = await getDocs(collection(db, "groups"));
        const list: GroupSummary[] = snap.docs.map((d) => {
          const data = d.data();
          const name = (data.groupName ?? data.groupname ?? "Unnamed Group") as string;
          const players = ([
            ...((data.playerNamesByDay?.day1 ?? data.playerNames ?? []) as string[]),
          ].filter(Boolean));
          return { id: d.id, name, players };
        });
        list.sort((a, b) => a.name.localeCompare(b.name));
        setGroups(list);
      } catch {
        setError("Could not load groups.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <main className="min-h-screen bg-sky-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-sky-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
          <p className="text-slate-500 text-sm">Loading groups…</p>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen bg-sky-50 flex items-center justify-center p-6">
        <p className="text-red-500">{error}</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-sky-50 text-slate-900">
      <div className="max-w-lg mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Cal-Pac Golf</h1>
            <p className="text-slate-500 text-sm mt-0.5">Select your foursome</p>
          </div>
          <button
            onClick={() => router.push("/leaderboard")}
            className="bg-white border border-sky-200 rounded-xl px-3 py-2 text-sm font-semibold text-sky-700 hover:bg-sky-50 transition-colors"
          >
            🏆 Leaderboard
          </button>
        </div>

        <div className="space-y-2">
          {groups.map((g) => (
            <button
              key={g.id}
              onClick={() => router.push(`/group/${g.id}/score`)}
              className="w-full bg-white border border-sky-200 rounded-2xl px-4 py-4 text-left hover:bg-sky-50 hover:border-sky-300 transition-colors active:scale-[0.99]"
            >
              <p className="font-semibold text-slate-900">{g.name}</p>
              {g.players.length > 0 && (
                <p className="text-sm text-slate-500 mt-0.5 truncate">{g.players.join(" · ")}</p>
              )}
            </button>
          ))}
          {groups.length === 0 && (
            <p className="text-center text-slate-400 text-sm mt-10">No groups found.</p>
          )}
        </div>
      </div>
    </main>
  );
}
