"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { collection, doc, onSnapshot, type Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";

type CalcuttaTeamDoc = {
	teamName?: string;
	playerA?: string;
	playerB?: string;
	handicap?: number;
	handicapA?: number;
	handicapB?: number;
	scores?: Array<number | null>;
	updatedAt?: Timestamp;
};

type TeamRow = {
	id: string;
	teamName: string;
	playerA: string;
	playerB: string;
	teamHandicap: number;
	holesPlayed: number;
	teamGross: number | null;
	teamNet: number | null;
};

const EVENT_ID = "current";

function safeNum(n: unknown, fallback = 0) {
	return typeof n === "number" && Number.isFinite(n) ? n : fallback;
}

function coerceScores(input: unknown) {
	const raw = Array.isArray(input) ? input : [];
	return Array.from({ length: 18 }, (_, i) => {
		const v = raw[i];
		return typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : null;
	});
}

function sumScores(scores: Array<number | null>) {
	let total = 0, count = 0;
	for (const s of scores) {
		if (typeof s === "number" && Number.isFinite(s)) { total += s; count++; }
	}
	return { total, count };
}

function toPar(gross: number, holes: number) {
	if (gross === 0) return null;
	const diff = gross - holes; // placeholder — we don't have par per hole here
	return diff;
}

export default function CalcuttaLeaderboardPage() {
	const router = useRouter();
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [eventName, setEventName] = useState<string>("");
	const [teams, setTeams] = useState<Array<{ id: string; data: CalcuttaTeamDoc }>>([]);

	useEffect(() => {
		const eventRef = doc(db, "calcuttaEvents", EVENT_ID);
		const teamsRef = collection(db, "calcuttaEvents", EVENT_ID, "teams");

		const unsubEvent = onSnapshot(eventRef, (snap) => {
			if (snap.exists()) setEventName((snap.data().name as string) ?? "");
			setLoading(false);
		}, (err) => {
			setError(err instanceof Error ? err.message : String(err));
			setLoading(false);
		});

		const unsubTeams = onSnapshot(teamsRef, (snap) => {
			setTeams(snap.docs.map((d) => ({ id: d.id, data: d.data() as CalcuttaTeamDoc })));
		}, (err) => {
			setError(err instanceof Error ? err.message : String(err));
		});

		return () => { unsubEvent(); unsubTeams(); };
	}, []);

	const rows = useMemo((): TeamRow[] => {
		const out = teams.map(({ id, data }) => {
			const playerA = (data.playerA ?? "").trim();
			const playerB = (data.playerB ?? "").trim();
			const teamHandicap = typeof data.handicap === "number"
				? Math.floor(data.handicap)
				: Math.floor(safeNum(data.handicapA, 0)) + Math.floor(safeNum(data.handicapB, 0));
			const scores = coerceScores(data.scores);
			const { total: gross, count: holesPlayed } = sumScores(scores);
			const teamGross = holesPlayed > 0 ? gross : null;
			const complete = holesPlayed === 18;
			const teamNet = complete && teamGross != null ? teamGross - teamHandicap : null;
			const teamName = (data.teamName ?? "").trim() || `${playerA || "Player A"} / ${playerB || "Player B"}`;
			return { id, teamName, playerA: playerA || "—", playerB: playerB || "—", teamHandicap, holesPlayed, teamGross, teamNet };
		});

		out.sort((a, b) => {
			const aComplete = a.teamNet != null;
			const bComplete = b.teamNet != null;
			if (aComplete !== bComplete) return aComplete ? -1 : 1;
			if (aComplete) return (a.teamNet! - b.teamNet!) || (a.teamGross! - b.teamGross!);
			// Both incomplete: more holes played first, then lower gross
			if (b.holesPlayed !== a.holesPlayed) return b.holesPlayed - a.holesPlayed;
			const ag = a.teamGross ?? Number.POSITIVE_INFINITY;
			const bg = b.teamGross ?? Number.POSITIVE_INFINITY;
			const numA = parseInt(a.teamName.replace(/\D/g, ""), 10);
			const numB = parseInt(b.teamName.replace(/\D/g, ""), 10);
			return ag - bg || (!isNaN(numA) && !isNaN(numB) ? numA - numB : a.teamName.localeCompare(b.teamName));
		});
		return out;
	}, [teams]);

	if (loading) return (
		<main className="min-h-screen bg-zinc-950 text-white flex items-center justify-center">
			<div className="text-zinc-400 text-sm">Loading…</div>
		</main>
	);

	if (error) return (
		<main className="min-h-screen bg-zinc-950 text-white flex items-center justify-center">
			<div className="text-red-400 text-sm">{error}</div>
		</main>
	);

	return (
		<main className="min-h-screen bg-zinc-950 text-white p-4 sm:p-6">
			<div className="max-w-lg mx-auto">
				{/* Header */}
				<div className="flex items-center gap-3 mb-6">
					<button
						onClick={() => router.push("/calcutta")}
						className="text-zinc-400 hover:text-white text-sm font-semibold transition-colors"
					>
						← Calcutta
					</button>
					<div className="flex-1" />
				</div>

				<div className="mb-6">
					<h1 className="text-2xl font-bold">🏆 Leaderboard</h1>
					{eventName && <p className="text-zinc-500 text-sm mt-0.5">{eventName}</p>}
				</div>

				{rows.length === 0 ? (
					<div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 text-center">
						<p className="text-zinc-500 text-sm">No teams yet.</p>
					</div>
				) : (
					<div className="space-y-2">
						{rows.map((r, idx) => {
							const complete = r.teamNet != null;
							const netDisplay = r.teamNet != null
								? (r.teamNet > 0 ? `+${r.teamNet}` : String(r.teamNet))
								: r.teamGross != null
									? `${r.holesPlayed} holes`
									: "—";
							const isLeader = idx === 0 && complete;

							return (
								<button
									key={r.id}
									onClick={() => router.push(`/calcutta/score/${r.id}`)}
									className="w-full bg-zinc-900 border border-zinc-800 hover:border-emerald-700 hover:bg-zinc-800 rounded-2xl px-4 py-4 text-left transition-colors active:scale-[0.99]"
								>
									<div className="flex items-center gap-3">
										{/* Rank */}
										<span className={`text-sm font-bold w-6 shrink-0 text-center ${isLeader ? "text-yellow-400" : idx < 3 && complete ? "text-emerald-400" : "text-zinc-600"}`}>
											{complete ? idx + 1 : "—"}
										</span>

										{/* Team info */}
										<div className="flex-1 min-w-0">
											<p className="font-semibold text-white truncate">{r.teamName}</p>
											<p className="text-xs text-zinc-500 mt-0.5 truncate">
												{r.playerA} · {r.playerB}
											</p>
											<p className="text-[10px] text-zinc-600 mt-0.5">HCP {r.teamHandicap}</p>
										</div>

										{/* Score */}
										<div className="text-right shrink-0">
											{r.holesPlayed > 0 ? (
												<>
													<p className="text-xs text-zinc-500">
														{complete ? "Net / Gross" : `Thru ${r.holesPlayed}`}
													</p>
													<p className="text-base font-bold text-emerald-400">
														{complete
															? `${r.teamNet} / ${r.teamGross}`
															: r.teamGross}
													</p>
												</>
											) : (
												<>
													<p className="text-xs text-zinc-500">Not started</p>
													<p className="text-sm font-bold text-zinc-500">—</p>
												</>
											)}
										</div>
									</div>
								</button>
							);
						})}
					</div>
				)}

				<p className="text-xs text-zinc-600 text-center mt-6">
					Net = Gross − Team HCP · Tap a team to score
				</p>
			</div>
		</main>
	);
}
