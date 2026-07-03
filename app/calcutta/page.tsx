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
	createdAt?: Timestamp;
	updatedAt?: Timestamp;
};

type CalcuttaTeamDoc = {
	teamName?: string;
	playerA?: string;
	playerB?: string;
	handicap?: number;
	handicapA?: number;
	handicapB?: number;
	scores?: Array<number | null>;
	createdAt?: Timestamp;
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

function sumScores(scores: Array<number | null>) {
	let total = 0, count = 0;
	for (const s of scores) {
		if (typeof s === "number" && Number.isFinite(s)) { total += s; count++; }
	}
	return { total, count };
}

function strokesForHole(idx: number, total: number): number {
	const s = Math.floor(total);
	if (!Number.isFinite(idx) || idx < 1 || idx > 18 || s <= 0) return 0;
	if (s < idx) return 0;
	return 1 + Math.floor((s - idx) / 18);
}

export default function CalcuttaPage() {
	const router = useRouter();
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [event, setEvent] = useState<CalcuttaEventDoc | null>(null);
	const [teams, setTeams] = useState<Array<{ id: string; data: CalcuttaTeamDoc }>>([]);

	useEffect(() => {
		setLoading(true);
		setError(null);

		const eventRef = doc(db, "calcuttaEvents", EVENT_ID);
		const teamsRef = collection(db, "calcuttaEvents", EVENT_ID, "teams");

		const unsubEvent = onSnapshot(
			eventRef,
			(snap) => {
				setEvent(snap.exists() ? (snap.data() as CalcuttaEventDoc) : null);
				setLoading(false);
			},
			(err) => {
				setError(err instanceof Error ? err.message : String(err));
				setLoading(false);
			}
		);

		const unsubTeams = onSnapshot(
			teamsRef,
			(snap) => {
				setTeams(snap.docs.map((d) => ({ id: d.id, data: d.data() as CalcuttaTeamDoc })));
			},
			(err) => {
				setError(err instanceof Error ? err.message : String(err));
			}
		);

		return () => {
			unsubEvent();
			unsubTeams();
		};
	}, []);

	const course: CourseData = useMemo(() => {
		return COURSES[event?.course ?? "hills"] ?? HILLS;
	}, [event?.course]);

	const hcpIndices: number[] = useMemo(() => {
		const stored = event?.hcpIndices;
		if (Array.isArray(stored) && stored.length === 18) return stored;
		return course.holes.map((h) => h.handicap);
	}, [event?.hcpIndices, course]);

	const rows = useMemo(() => {
		const out: TeamRow[] = teams.map(({ id, data }) => {
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
			let runningStrokes = 0;
			for (let i = 0; i < 18; i++) {
				if (scores[i] != null) runningStrokes += strokesForHole(hcpIndices[i], teamHandicap);
			}
			const runningNet = holesPlayed > 0 ? gross - runningStrokes : null;
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

	if (loading) return <main className="min-h-screen bg-zinc-950 text-white p-3 sm:p-6 flex items-center justify-center"><div className="text-zinc-400 text-sm">Loading…</div></main>;
	if (error) return <main className="min-h-screen bg-zinc-950 text-white p-3 sm:p-6 flex items-center justify-center"><div className="text-red-400 text-sm">{error}</div></main>;

	return (
		<main className="min-h-screen bg-zinc-950 text-white p-4 sm:p-6">
			<div className="max-w-lg mx-auto">
				{/* Header */}
				<div className="mb-4">
					<button
						onClick={() => router.push("/")}
						className="text-zinc-500 hover:text-zinc-300 text-sm transition-colors"
					>
						← Main Scoring
					</button>
				</div>
				<div className="flex items-start justify-between gap-3 mb-6">
					<div>
						<h1 className="text-2xl font-bold">🤑 Calcutta</h1>
						<p className="text-zinc-500 text-sm mt-0.5">Select your team to score</p>
					</div>
					<div className="flex gap-2">
						<button
							onClick={() => router.push("/calcutta/leaderboard")}
							className="bg-emerald-900 hover:bg-emerald-800 border border-emerald-700 px-3 py-2 rounded-xl text-sm font-semibold text-emerald-300 transition-colors"
						>
							🏆 Board
						</button>
						<button
							onClick={() => router.push("/calcutta/admin")}
							className="bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 px-3 py-2 rounded-xl text-sm font-semibold text-zinc-400 transition-colors"
						>
							⚙️ Admin
						</button>
					</div>
				</div>

				{!event && (
					<div className="mb-4 bg-zinc-900 border border-zinc-700 rounded-2xl p-4">
						<p className="text-zinc-400 text-sm">Calcutta event not set up yet. An admin can create it from the Admin page.</p>
					</div>
				)}

				{/* Team list — tap to score */}
				{rows.length > 0 ? (
					<div className="space-y-2 mb-6">
						{rows.map((r, idx) => (
							<button
								key={r.id}
								onClick={() => router.push(`/calcutta/score/${r.id}`)}
								className="w-full bg-zinc-900 border border-zinc-800 hover:border-emerald-700 hover:bg-zinc-800 rounded-2xl px-4 py-4 text-left transition-colors active:scale-[0.99]"
							>
								<div className="flex items-center gap-3">
									<span className={`text-sm font-bold w-5 shrink-0 ${idx === 0 ? "text-emerald-400" : "text-zinc-600"}`}>{idx + 1}</span>
									<div className="flex-1 min-w-0">
										<p className="font-semibold text-white">{r.teamName}</p>
										<p className="text-xs text-zinc-500 mt-0.5">{r.playerA} · {r.playerB} · HCP {r.teamHandicap}</p>
									</div>
									<div className="text-right shrink-0">
										<p className="text-xs text-zinc-600">
											{r.holesPlayed > 0 ? (r.teamNet != null ? "Gross / Net" : `Thru ${r.holesPlayed}`) : "Net"}
										</p>
										<p className="text-base font-bold text-emerald-400">
											{r.teamNet != null
												? `${r.teamGross} / ${r.teamNet}`
												: r.runningNet != null
													? `${r.teamGross} / ${r.runningNet}`
													: "—"}
										</p>
									</div>
									<span className="text-zinc-600 ml-1">→</span>
								</div>
							</button>
						))}
					</div>
				) : (
					<div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 text-center mb-6">
						<p className="text-zinc-500 text-sm">No teams yet. An admin can add teams from the Admin page.</p>
					</div>
				)}

				<p className="text-xs text-zinc-600 text-center">
					Team Net = Gross − Team HCP. Sorted by net score.
				</p>
			</div>
		</main>
	);
}
