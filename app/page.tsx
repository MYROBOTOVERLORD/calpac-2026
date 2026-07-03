"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";

type PlayerInfo = {
  name: string;
  day1GroupId: string | null;
  day1GroupName: string | null;
  day2GroupId: string | null;
  day2GroupName: string | null;
};

export default function Home() {
  const router = useRouter();
  const [players, setPlayers] = useState<PlayerInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const snap = await getDocs(collection(db, "groups"));
        const map = new Map<string, PlayerInfo>();

        for (const d of snap.docs) {
          const data = d.data();
          const gName = (data.groupName ?? data.groupname ?? "Unnamed Group") as string;
          const legacy = (data.playerNames ?? []) as string[];
          const d1 = ((data.playerNamesByDay?.day1 ?? legacy) as string[]).filter(Boolean);
          const d2 = ((data.playerNamesByDay?.day2 ?? legacy) as string[]).filter(Boolean);

          for (const name of d1) {
            const e = map.get(name) ?? { name, day1GroupId: null, day1GroupName: null, day2GroupId: null, day2GroupName: null };
            e.day1GroupId = d.id;
            e.day1GroupName = gName;
            map.set(name, e);
          }
          for (const name of d2) {
            const e = map.get(name) ?? { name, day1GroupId: null, day1GroupName: null, day2GroupId: null, day2GroupName: null };
            e.day2GroupId = d.id;
            e.day2GroupName = gName;
            map.set(name, e);
          }
        }

        setPlayers([...map.values()].sort((a, b) => a.name.localeCompare(b.name)));
      } catch {
        setError("Could not load players. Check your connection.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function selectPlayer(p: PlayerInfo) {
    sessionStorage.setItem(
      "calpac_player",
      JSON.stringify({ name: p.name, day1GroupId: p.day1GroupId, day2GroupId: p.day2GroupId })
    );
    // Default to day 1 group; fall back to day 2 if not in day 1
    const groupId = p.day1GroupId ?? p.day2GroupId;
    if (!groupId) return;
    if (!p.day1GroupId && p.day2GroupId) {
      sessionStorage.setItem("calpac_intended_day", "day2");
    }
    router.push(`/group/${groupId}/score`);
  }

  const filtered = search
    ? players.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))
    : players;

  if (loading) {
    return (
      <main className="min-h-screen bg-sky-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-sky-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
          <p className="text-slate-500 text-sm">Loading players…</p>
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
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-2xl font-bold">Cal-Pac 2026</h1>
            <p className="text-slate-500 text-sm mt-0.5">Select your name to start scoring</p>
          </div>
          <div className="flex gap-2 shrink-0 flex-wrap justify-end">
            <button
              onClick={() => router.push("/leaderboard")}
              className="bg-white border border-sky-200 rounded-xl px-3 py-2 text-sm font-semibold text-sky-700 hover:bg-sky-50 transition-colors"
            >
              🏆 Leaderboard
            </button>
            <button
              onClick={() => router.push("/calcutta")}
              className="bg-white border border-sky-200 rounded-xl px-3 py-2 text-sm font-semibold text-emerald-700 hover:bg-sky-50 transition-colors"
            >
              🤑 Calcutta
            </button>
            <button
              onClick={() => {
                const gid = players.find((p) => p.day1GroupId)?.day1GroupId ?? "";
                router.push(`/group/${gid}/admin`);
              }}
              className="bg-white border border-sky-200 rounded-xl px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-sky-50 transition-colors"
            >
              ⚙️ Admin
            </button>
          </div>
        </div>

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search players…"
          className="w-full mb-4 px-4 py-3 bg-white border border-sky-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-sky-200 placeholder:text-slate-400"
        />

        <div className="space-y-2">
          {filtered.map((p) => {
            const dayInfo = [
              p.day1GroupName ? `Day 1: ${p.day1GroupName}` : null,
              p.day2GroupName
                ? p.day2GroupId !== p.day1GroupId
                  ? `Day 2: ${p.day2GroupName}`
                  : "Day 1 & 2"
                : null,
            ]
              .filter(Boolean)
              .join(" · ");

            return (
              <button
                key={p.name}
                onClick={() => selectPlayer(p)}
                className="w-full bg-white border border-sky-200 rounded-2xl px-4 py-4 text-left hover:bg-sky-50 hover:border-sky-300 transition-colors active:scale-[0.99]"
              >
                <p className="font-semibold text-slate-900">{p.name}</p>
                {dayInfo && <p className="text-xs text-slate-500 mt-0.5">{dayInfo}</p>}
              </button>
            );
          })}
          {filtered.length === 0 && (
            <p className="text-center text-slate-400 text-sm mt-10">No players found.</p>
          )}
        </div>
      </div>
    </main>
  );
}

