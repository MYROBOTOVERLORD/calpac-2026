"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
	collection,
	doc,
	getDoc,
	getDocs,
	limit,
	onSnapshot,
	query,
	serverTimestamp,
	updateDoc,
	where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

type GroupDoc = {
	groupName?: string;
	groupname?: string; // tolerate existing lowercase field
	tournamentId?: string;
	pin?: string;
	playerNames?: string[];
	scores?: Record<string, Array<number | null>>;
};

const HOLE_COUNT = 18;

function coerceScores(players: string[], input?: GroupDoc["scores"]) {
	const next: Record<string, Array<number | null>> = {};
	for (const player of players) {
		const existing = input?.[player];
		if (Array.isArray(existing)) {
			next[player] = Array.from({ length: HOLE_COUNT }, (_, i) => {
				const v = existing[i];
				return typeof v === "number" && Number.isFinite(v) ? v : null;
			});
		} else {
			next[player] = Array.from({ length: HOLE_COUNT }, () => null);
		}
	}
	return next;
}

function sum(scores: Array<number | null>) {
	return scores.reduce<number>((acc, v) => (typeof v === "number" ? acc + v : acc), 0);
}

export default function GroupPage() {
	const router = useRouter();
	const { groupId } = useParams<{ groupId: string }>();

	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [group, setGroup] = useState<GroupDoc | null>(null);
	const [playersDraft, setPlayersDraft] = useState("");
	const [scores, setScores] = useState<Record<string, Array<number | null>>>({});
	const [saving, setSaving] = useState(false);
	const saveTimerRef = useRef<number | null>(null);

	const title = group?.groupName ?? group?.groupname ?? "Foursome";
	const players = useMemo(() => (group?.playerNames ?? []).filter(Boolean), [group?.playerNames]);
	const totals = useMemo(() => {
		const t: Record<string, number> = {};
		for (const p of players) t[p] = sum(scores[p] ?? []);
		return t;
	}, [players, scores]);
	const groupTotal = useMemo(() => players.reduce((acc, p) => acc + (totals[p] ?? 0), 0), [players, totals]);

	useEffect(() => {
		(async () => {
			setLoading(true);
			setError(null);
			setGroup(null);

			try {
				// Try path as doc id first: groups/{groupId}
				const byIdSnap = await getDoc(doc(db, "groups", groupId));
				if (byIdSnap.exists()) {
					setGroup(byIdSnap.data() as GroupDoc);
					return;
				}

				// Otherwise treat path as PIN: groups where pin == {groupId}
				const q = query(collection(db, "groups"), where("pin", "==", groupId), limit(1));
				const pinSnap = await getDocs(q);

				if (pinSnap.empty) {
					setError("No group found for that PIN.");
					return;
				}

				// Redirect to canonical doc-id URL
				router.replace(`/group/${pinSnap.docs[0].id}`);
			} catch {
				setError("Failed to load group.");
			} finally {
				setLoading(false);
			}
		})();
	}, [groupId, router]);

	useEffect(() => {
		if (!groupId) return;
		let unsub: (() => void) | null = null;

		(async () => {
			try {
				const byIdSnap = await getDoc(doc(db, "groups", groupId));
				if (!byIdSnap.exists()) return;

				const ref = doc(db, "groups", groupId);
				unsub = onSnapshot(
					ref,
					(snap) => {
						if (!snap.exists()) return;
						const data = snap.data() as GroupDoc;
						setGroup(data);
						const nextPlayers = (data.playerNames ?? []).filter(Boolean);
						setScores(coerceScores(nextPlayers, data.scores));
					},
					() => {
						setError("Failed to subscribe to group updates.");
					}
				);
			} catch {
				// ignore; load effect above will show an error
			}
		})();

		return () => {
			if (unsub) unsub();
		};
	}, [groupId]);

	function scheduleSave(nextScores: Record<string, Array<number | null>>) {
		if (!groupId) return;
		if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
		saveTimerRef.current = window.setTimeout(async () => {
			setSaving(true);
			try {
				await updateDoc(doc(db, "groups", groupId), {
					scores: nextScores,
					updatedAt: serverTimestamp(),
				});
			} catch {
				setError("Could not save scores. Check Firestore rules and try again.");
			} finally {
				setSaving(false);
			}
		}, 400);
	}

	async function savePlayers() {
		setError(null);
		const nextPlayers = playersDraft
			.split(/,|\n/)
			.map((s) => s.trim())
			.filter(Boolean);

		if (nextPlayers.length === 0) {
			setError("Enter at least one player name.");
			return;
		}

		try {
			await updateDoc(doc(db, "groups", groupId), {
				playerNames: nextPlayers,
				updatedAt: serverTimestamp(),
			});
			setPlayersDraft("");
		} catch {
			setError("Could not save players. Check Firestore rules and try again.");
		}
	}

	if (loading) return <main className="min-h-screen bg-zinc-900 text-white p-6">Loading...</main>;
	if (error) return <main className="min-h-screen bg-zinc-900 text-white p-6">{error}</main>;
	if (!group) return <main className="min-h-screen bg-zinc-900 text-white p-6">Missing group data.</main>;

	return (
		<main className="min-h-screen bg-zinc-900 text-white p-6">
			<div className="max-w-5xl mx-auto">
				<div className="flex items-start justify-between gap-4">
					<div>
						<h1 className="text-2xl font-bold">{title}</h1>
						<p className="text-zinc-400 mt-1">
							{players.length ? `${players.length} players` : "No players yet"} · {saving ? "Saving…" : "Saved"}
						</p>
					</div>
				</div>

				{players.length === 0 ? (
					<div className="mt-6 bg-zinc-800 border border-zinc-700 rounded-2xl p-5">
						<h2 className="text-lg font-semibold">Add players</h2>
						<p className="text-zinc-400 text-sm mt-1">Enter names separated by commas.</p>
						<textarea
							value={playersDraft}
							onChange={(e) => setPlayersDraft(e.target.value)}
							rows={3}
							className="mt-3 w-full p-3 bg-zinc-900 border border-zinc-700 rounded-lg"
							placeholder="Alice, Bob, Carlos, Dana"
						/>
						<button
							onClick={savePlayers}
							className="mt-3 bg-emerald-600 hover:bg-emerald-500 px-4 py-2 rounded-lg font-semibold"
						>
							Save players
						</button>
					</div>
				) : (
					<>
						<div className="mt-6 bg-zinc-800 border border-zinc-700 rounded-2xl p-5">
							<div className="flex items-center justify-between gap-3 flex-wrap">
								<h2 className="text-lg font-semibold">Totals</h2>
								<p className="text-zinc-300 text-sm">Group total: {groupTotal}</p>
							</div>
							<div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
								{players.map((p) => (
									<div key={p} className="bg-zinc-900 border border-zinc-700 rounded-xl p-3">
										<p className="text-sm text-zinc-400">{p}</p>
										<p className="text-2xl font-bold mt-1">{totals[p] ?? 0}</p>
									</div>
								))}
							</div>
						</div>

						<div className="mt-6 overflow-x-auto bg-zinc-800 border border-zinc-700 rounded-2xl">
							<table className="w-full min-w-[720px] text-sm">
								<thead className="bg-zinc-900/60">
									<tr className="text-left">
										<th className="p-3 text-zinc-300">Hole</th>
										{players.map((p) => (
											<th key={p} className="p-3 text-zinc-300">{p}</th>
										))}
									</tr>
								</thead>
								<tbody>
									{Array.from({ length: HOLE_COUNT }, (_, holeIdx) => (
										<tr key={holeIdx} className={holeIdx % 2 ? "bg-zinc-800" : "bg-zinc-800/60"}>
											<td className="p-3 text-zinc-200 font-semibold">{holeIdx + 1}</td>
											{players.map((p) => {
												const v = scores[p]?.[holeIdx];
												return (
													<td key={`${p}-${holeIdx}`} className="p-3">
														<input
															value={typeof v === "number" ? String(v) : ""}
															onChange={(e) => {
																const raw = e.target.value;
																const parsed = raw === "" ? null : Number(raw);
																const nextScores = {
																	...scores,
																	[p]: Array.from({ length: HOLE_COUNT }, (_, i) => scores[p]?.[i] ?? null),
																};
																nextScores[p][holeIdx] =
																	typeof parsed === "number" && Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
																setScores(nextScores);
																scheduleSave(nextScores);
															}}
															inputMode="numeric"
															pattern="[0-9]*"
															className="w-20 p-2 bg-zinc-900 border border-zinc-700 rounded-lg text-center"
															placeholder="-"
														/>
													</td>
												);
											})}
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</>
				)}
			</div>
		</main>
	);
}
