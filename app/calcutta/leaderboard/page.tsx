"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { collection, doc, onSnapshot, type Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { COURSES, HILLS, type CourseData } from "@/lib/courses";

type CalcuttaEventDoc = {
	name?: string;
	course?: string;
	hcpIndices?: number[];
};

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
	runningNet: number | null;
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

function strokesForHole(idx: number, total: number): number {
	const s = Math.floor(total);
	if (!Number.isFinite(idx) || idx < 1 || idx > 18 || s <= 0) return 0;
	if (s < idx) return 0;
	return 1 + Math.floor((s - idx) / 18);
}

function computeScoreTotals(scores: Array<number | null>, hcpIndices: number[], teamHandicap: number) {
	let gross = 0, strokes = 0, count = 0;
	for (let i = 0; i < 18; i++) {
		const s = scores[i];
		if (typeof s === "number") {
			gross += s;
			strokes += strokesForHole(hcpIndices[i], teamHandicap);
			count++;
		}
	}
	return { gross, strokes, count };
}

export default function CalcuttaLeaderboardPage() {
	const router = useRouter();
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [event, setEvent] = useState<CalcuttaEventDoc | null>(null);
	const [teams, setTeams] = useState<Array<{ id: string; data: CalcuttaTeamDoc }>>([]);

	useEffect(() => {
		const eventRef = doc(db, "calcuttaEvents", EVENT_ID);
		const teamsRef = collection(db, "calcuttaEvents", EVENT_ID, "teams");

		const unsubEvent = onSnapshot(eventRef, (snap) => {
			if (snap.exists()) setEvent(snap.data() as CalcuttaEventDoc);
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

	const course: CourseData = useMemo(() => {
		const courseId = event?.course ?? "hills";
		return COURSES[courseId] ?? HILLS;
	}, [event?.course]);

	const hcpIndices: number[] = useMemo(() => {
		const stored = event?.hcpIndices;
		if (Array.isArray(stored) && stored.length === 18) return stored;
		return course.holes.map((h) => h.handicap);
	}, [event?.hcpIndices, course]);

	const rows = useMemo((): TeamRow[] => {
		const out = teams.map(({ id, data }) => {
			const playerA = (data.playerA ?? "").trim();
			const playerB = (data.playerB ?? "").trim();
			const teamHandicap = typeof data.handicap === "number"
				? Math.floor(data.handicap)
				: Math.floor(safeNum(data.handicapA, 0)) + Math.floor(safeNum(data.handicapB, 0));
			const scores = coerceScores(data.scores);
			const { gross, strokes, count: holesPlayed } = computeScoreTotals(scores, hcpIndices, teamHandicap);
			const teamGross = holesPlayed > 0 ? gross : null;
			const complete = holesPlayed === 18;
			const teamNet = complete && teamGross != null ? teamGross - teamHandicap : null;
			const runningNet = holesPlayed > 0 ? gross - strokes : null;
			const teamName = (data.teamName ?? "").trim() || `${playerA || "Player A"} / ${playerB || "Player B"}`;
			return { id, teamName, playerA: playerA || "—", playerB: playerB || "—", teamHandicap, holesPlayed, teamGross, teamNet, runningNet };
		});

		out.sort((a, b) => {
			const aComplete = a.teamNet != null;
			const bComplete = b.teamNet != null;
			if (aComplete !== bComplete) return aComplete ? -1 : 1;
			if (aComplete) return (a.teamNet! - b.teamNet!) || (a.teamGross! - b.teamGross!);
			if (b.holesPlayed !== a.holesPlayed) return b.holesPlayed - a.holesPlayed;
			const an = a.runningNet ?? Number.POSITIVE_INFINITY;
			const bn = b.runningNet ?? Number.POSITIVE_INFINITY;
			const numA = parseInt(a.teamName.replace(/\D/g, ""), 10);
			const numB = parseInt(b.teamName.replace(/\D/g, ""), 10);
			return an - bn || (!isNaN(numA) && !isNaN(numB) ? numA - numB : a.teamName.localeCompare(b.teamName));
		});
		return out;
	}, [teams, hcpIndices]);

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
					{event?.name && <p className="text-zinc-500 text-sm mt-0.5">{event.name}</p>}
				</div>

				{rows.length === 0 ? (
					<div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 text-center">
						<p className="text-zinc-500 text-sm">No teams yet.</p>
					</div>
				) : (
					<div className="space-y-2">
						{rows.map((r, idx) => {
							const complete = r.teamNet != null;
							const hasScore = r.holesPlayed > 0;
							const isLeader = idx === 0 && hasScore;

							return (
								<button
									key={r.id}
									onClick={() => router.push(`/calcutta/score/${r.id}`)}
									className="w-full bg-zinc-900 border border-zinc-800 hover:border-emerald-700 hover:bg-zinc-800 rounded-2xl px-4 py-4 text-left transition-colors active:scale-[0.99]"
								>
									<div className="flex items-center gap-3">
										{/* Rank */}
										<span className={`text-sm font-bold w-6 shrink-0 text-center ${isLeader ? "text-yellow-400" : idx < 3 && hasScore ? "text-emerald-400" : "text-zinc-600"}`}>
											{hasScore ? idx + 1 : "—"}
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
											{hasScore ? (
												<>
													<p className="text-xs text-zinc-500">
														{complete ? "Gross / Net" : `Thru ${r.holesPlayed}`}
													</p>
													<p className="text-base font-bold text-emerald-400">
														{complete
															? `${r.teamGross} / ${r.teamNet}`
															: `${r.teamGross} / ${r.runningNet}`}
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
					Gross / Net · Tap a team to score
				</p>
			</div>
		</main>
	);
}
