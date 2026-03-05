"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { collection, doc, onSnapshot, type Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";

type CalcuttaEventDoc = {
	name?: string;
	course?: string;
	createdAt?: Timestamp;
	updatedAt?: Timestamp;
};

type CalcuttaTeamDoc = {
	teamName?: string;
	playerA?: string;
	playerB?: string;
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
	handicapA: number;
	handicapB: number;
	teamHandicap: number;
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

function isCompleteRound(scores: Array<number | null>) {
	return scores.length === 18 && scores.every((s) => typeof s === "number" && Number.isFinite(s));
}

function sumScores(scores: Array<number | null>) {
	let total = 0;
	for (const s of scores) {
		if (typeof s === "number" && Number.isFinite(s)) total += s;
	}
	return total;
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

	const rows = useMemo(() => {
		const out: TeamRow[] = teams.map(({ id, data }) => {
			const playerA = (data.playerA ?? "").trim();
			const playerB = (data.playerB ?? "").trim();
			const handicapA = Math.floor(safeNum(data.handicapA, 0));
			const handicapB = Math.floor(safeNum(data.handicapB, 0));
			const teamHandicap = handicapA + handicapB;
			const scores = coerceScores(data.scores);
			const complete = isCompleteRound(scores);
			const teamGross = complete ? sumScores(scores) : null;
			const teamNet = teamGross == null ? null : teamGross - teamHandicap;
			const teamName = (data.teamName ?? "").trim() || `${playerA || "Player A"} / ${playerB || "Player B"}`;
			return {
				id,
				teamName,
				playerA: playerA || "—",
				playerB: playerB || "—",
				handicapA,
				handicapB,
				teamHandicap,
				teamGross,
				teamNet,
			};
		});

		out.sort((a, b) => {
			const an = a.teamNet == null ? Number.POSITIVE_INFINITY : a.teamNet;
			const bn = b.teamNet == null ? Number.POSITIVE_INFINITY : b.teamNet;
			const ag = a.teamGross == null ? Number.POSITIVE_INFINITY : a.teamGross;
			const bg = b.teamGross == null ? Number.POSITIVE_INFINITY : b.teamGross;
			return an - bn || ag - bg || a.teamName.localeCompare(b.teamName);
		});
		return out;
	}, [teams]);

	if (loading) return <main className="min-h-screen bg-sky-50 text-slate-900 p-3 sm:p-6">Loading…</main>;
	if (error) return <main className="min-h-screen bg-sky-50 text-slate-900 p-3 sm:p-6">{error}</main>;

	return (
		<main className="min-h-screen bg-sky-50 text-slate-900 p-3 sm:p-6">
			<div className="max-w-5xl mx-auto">
				<div className="flex items-start justify-between gap-3 flex-wrap">
					<div>
						<h1 className="text-2xl font-bold">Calcutta</h1>
						<p className="text-slate-600 text-sm mt-1">
							{event?.course ? `${event.course} · ` : ""}2-player team event
						</p>
					</div>
					<div className="flex gap-2">
						<button
							onClick={() => router.push("/")}
							className="bg-white hover:bg-sky-50 border border-sky-200 px-4 py-2 rounded-lg text-sm"
						>
							Back to PIN login
						</button>
						<button
							onClick={() => router.push("/calcutta/admin")}
							className="bg-sky-600 hover:bg-sky-500 px-4 py-2 rounded-lg font-semibold text-white"
						>
							Admin
						</button>
					</div>
				</div>

				{event ? null : (
					<div className="mt-4 bg-white/80 border border-sky-200 rounded-2xl p-4">
						<p className="text-slate-700 text-sm">
							Calcutta event not set up yet. An admin can create it from the Admin page.
						</p>
					</div>
				)}

				<div className="mt-4 sm:mt-6 bg-white/80 border border-sky-200 rounded-2xl p-3 sm:p-5">
					<div className="flex items-center justify-between gap-3 flex-wrap">
						<h2 className="text-lg font-semibold">Leaderboard</h2>
						<p className="text-sm text-slate-600">Sorted by team net (low)</p>
					</div>

					<div className="mt-3 overflow-x-auto bg-white border border-sky-200 rounded-xl p-2 sm:p-3">
						<table className="w-full min-w-[640px] text-sm">
							<thead>
								<tr className="text-left text-slate-700">
									<th className="p-2">#</th>
									<th className="p-2">Team</th>
									<th className="p-2">Players</th>
									<th className="p-2">Team HCP</th>
									<th className="p-2">Gross</th>
									<th className="p-2">Net</th>
								</tr>
							</thead>
							<tbody>
								{rows.length ? (
									rows.map((r, idx) => (
										<tr key={r.id} className="border-t border-sky-100">
											<td className="p-2 text-slate-500">{idx + 1}</td>
											<td className="p-2 text-slate-900 font-semibold whitespace-nowrap">{r.teamName}</td>
											<td className="p-2 text-slate-800 whitespace-nowrap">
												{r.playerA} ({r.handicapA}) · {r.playerB} ({r.handicapB})
											</td>
											<td className="p-2 text-slate-800">{r.teamHandicap}</td>
											<td className="p-2 text-slate-800">{r.teamGross == null ? "—" : r.teamGross}</td>
											<td className="p-2 text-slate-800 font-semibold">{r.teamNet == null ? "—" : r.teamNet}</td>
										</tr>
									))
								) : (
									<tr>
										<td className="p-3 text-slate-600" colSpan={6}>
											No teams yet.
										</td>
									</tr>
								)}
							</tbody>
						</table>
					</div>
				</div>

				<div className="mt-4 text-xs text-slate-500">
					Best ball: enter one score per hole (team score). Totals show after all 18 holes are entered. Team Net = Team Gross − (HCP A + HCP B).
				</div>
			</div>
		</main>
	);
}
