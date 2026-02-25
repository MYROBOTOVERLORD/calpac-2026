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

type DayKey = "day1" | "day2";

type TeeKey = "combo" | "three" | "four" | "stampede" | "tips";

type ContestEntry = {
	hole?: number | null;
	winner?: string | null;
	note?: string | null;
};

type ContestWinnerNote = {
	winner?: string | null;
	note?: string | null;
};

type GroupDoc = {
	groupName?: string;
	groupname?: string;
	tournamentId?: string;
	pin?: string;
	playerNames?: string[];
	playerNamesByDay?: {
		day1?: string[];
		day2?: string[];
	};
	// Back-compat: old format was { [player]: (number|null)[] }
	scores?:
		| Record<string, Array<number | null>>
		| {
				day1?: Record<string, Array<number | null>>;
				day2?: Record<string, Array<number | null>>;
		  };
	handicaps?: Record<string, number | null>;
	day2HandicapAdjustments?: Record<string, number | null>;
	teeChoices?: {
		day1?: Record<string, TeeKey | null>;
		day2?: Record<string, TeeKey | null>;
	};
	day1ScoresLocked?: boolean;
	charityStrokes?: Record<string, number | null>;
	treeStrokes?: Record<string, number | null>;
	contest?: {
		day1?: {
			// New: per-hole entries (for each Par 3)
			closestToPinByHole?: Record<string, ContestWinnerNote>;
			// Legacy: single entry
			closestToPin?: ContestEntry;
			longestDrive?: ContestEntry;
		};
		day2?: {
			closestToPinByHole?: Record<string, ContestWinnerNote>;
			closestToPin?: ContestEntry;
			longestDrive?: ContestEntry;
		};
	};
	tournament?: {
		day1Course?: string;
		day2Course?: string;
		day1Pars?: number[];
		day2Pars?: number[];
		// Stroke index (1-18) for handicap allocation by hole
		day1Hcps?: number[];
		day2Hcps?: number[];
	};
};

const HOLE_COUNT = 18;

function uniqPreserveOrder(values: string[]) {
	const out: string[] = [];
	const seen = new Set<string>();
	for (const v of values) {
		const key = v.trim();
		if (!key) continue;
		const lowered = key.toLowerCase();
		if (seen.has(lowered)) continue;
		seen.add(lowered);
		out.push(key);
	}
	return out;
}

function coerceScoreTable(players: string[], input?: Record<string, Array<number | null>> | null) {
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

function coerceScoresByDay(players: string[], input?: GroupDoc["scores"]) {
	const raw = input as any;
	const isOld = input && typeof input === "object" && !("day1" in raw) && !("day2" in raw);
	const day1Raw = isOld ? (input as Record<string, Array<number | null>>) : raw?.day1;
	const day2Raw = isOld ? undefined : raw?.day2;

	return {
		day1: coerceScoreTable(players, day1Raw ?? null),
		day2: coerceScoreTable(players, day2Raw ?? null),
	};
}

function coerceNumberMap(players: string[], input?: Record<string, number | null> | null, defaultValue = 0) {
	const next: Record<string, number> = {};
	for (const p of players) {
		const v = input?.[p];
		next[p] = typeof v === "number" && Number.isFinite(v) ? v : defaultValue;
	}
	return next;
}

function coerceTeeMap(players: string[], input?: Record<string, TeeKey | null> | null, defaultValue: TeeKey = "combo") {
	const next: Record<string, TeeKey> = {};
	for (const p of players) {
		const v = input?.[p];
		next[p] = v === "three" || v === "four" || v === "combo" || v === "stampede" || v === "tips" ? v : defaultValue;
	}
	return next;
}

function teeBonusForDay(day: DayKey, tee: TeeKey | null | undefined) {
	if (day === "day1") {
		if (tee === "three") return 1;
		if (tee === "four") return 2;
		return 0;
	}
	// Day 2: Stampede/Tips (no bonus unless rules change)
	return 0;
}

function sum(scores: Array<number | null>) {
	return scores.reduce<number>((acc, v) => (typeof v === "number" ? acc + v : acc), 0);
}

function isCompleteRound(scores: Array<number | null> | undefined) {
	if (!scores || scores.length !== HOLE_COUNT) return false;
	return scores.every((v) => typeof v === "number" && Number.isFinite(v) && v >= 0);
}

function sumNumbers(values: number[]) {
	return values.reduce((acc, v) => acc + v, 0);
}

function strokesForHole(holeStrokeIndex: number, totalStrokes: number) {
	if (!Number.isFinite(holeStrokeIndex) || holeStrokeIndex < 1 || holeStrokeIndex > 18) return 0;
	const s = Math.floor(totalStrokes);
	if (!Number.isFinite(s) || s <= 0) return 0;
	if (s < holeStrokeIndex) return 0;
	return 1 + Math.floor((s - holeStrokeIndex) / 18);
}

function computeNetRunningTotal(opts: {
	scores: Array<number | null>;
	hcps?: number[] | null;
	totalStrokes: number;
}) {
	const { scores, hcps, totalStrokes } = opts;
	const gross = sum(scores);
	if (!Array.isArray(hcps) || hcps.length !== HOLE_COUNT) {
		// Fallback: without stroke-index-by-hole we cannot allocate strokes correctly
		// for an in-progress round. Only subtract the full handicap once the round is complete.
		return isCompleteRound(scores) ? gross - Math.floor(totalStrokes) : gross;
	}
	let strokesUsed = 0;
	for (let i = 0; i < HOLE_COUNT; i++) {
		const v = scores[i];
		if (typeof v !== "number" || !Number.isFinite(v) || v < 0) continue;
		strokesUsed += strokesForHole(hcps[i], totalStrokes);
	}
	return gross - strokesUsed;
}

function computeNetToPar(opts: {
	scores: Array<number | null>;
	pars: number[];
	hcps?: number[] | null;
	totalStrokes: number;
}) {
	const { scores, pars, hcps, totalStrokes } = opts;
	if (!isCompleteRound(scores)) return null;
	if (!Array.isArray(pars) || pars.length !== HOLE_COUNT) return null;
	const parsTotal = sumNumbers(pars);

	// If we have stroke-index-by-hole, allocate strokes by hole.
	if (Array.isArray(hcps) && hcps.length === HOLE_COUNT) {
		let netTotal = 0;
		for (let i = 0; i < HOLE_COUNT; i++) {
			const grossHole = scores[i] as number;
			const holeStrokes = strokesForHole(hcps[i], totalStrokes);
			netTotal += grossHole - holeStrokes;
		}
		return netTotal - parsTotal;
	}

	// Fallback: total math (same round total, but no per-hole allocation).
	const grossTotal = sum(scores);
	const netTotal = grossTotal - Math.floor(totalStrokes);
	return netTotal - parsTotal;
}

function computeToParSoFar(opts: { scores: Array<number | null>; pars?: number[] | null }) {
	const { scores, pars } = opts;
	if (!Array.isArray(pars) || pars.length !== HOLE_COUNT) return null;
	let grossSoFar = 0;
	let parSoFar = 0;
	let holesCounted = 0;
	for (let i = 0; i < HOLE_COUNT; i++) {
		const v = scores[i];
		if (typeof v !== "number" || !Number.isFinite(v) || v < 0) continue;
		grossSoFar += v;
		parSoFar += pars[i] ?? 0;
		holesCounted += 1;
	}
	if (holesCounted === 0) return null;
	return grossSoFar - parSoFar;
}

function applyCharityAtEnd(net: number, scores: Array<number | null>, charity: number) {
	const c = Math.floor(charity);
	if (!Number.isFinite(c) || c <= 0) return net;
	return isCompleteRound(scores) ? net - c : net;
}

function holeStringToNumber(s: string) {
	const n = Number(s);
	if (!Number.isFinite(n)) return null;
	if (n <= 0) return null;
	return Math.floor(n);
}

function normalizeContestEntry(input: { hole: string; winner: string; note: string }): ContestEntry {
	return {
		hole: input.hole ? holeStringToNumber(input.hole) : null,
		winner: input.winner.trim() ? input.winner.trim() : null,
		note: input.note.trim() ? input.note.trim() : null,
	};
}

function normalizeWinnerNote(input: { winner: string; note: string }): ContestWinnerNote {
	const winner = input.winner.trim();
	const note = input.note.trim();
	return {
		winner: winner ? winner : null,
		note: note ? note : null,
	};
}

function normalizeClosestToPinByHoleState(
	input: Record<string, { winner: string; note: string }>
): Record<string, ContestWinnerNote> {
	const out: Record<string, ContestWinnerNote> = {};
	for (const [hole, entry] of Object.entries(input)) {
		const normalized = normalizeWinnerNote(entry);
		if (normalized.winner != null || normalized.note != null) out[hole] = normalized;
	}
	return out;
}

function parseFeetInches(note: string) {
	const raw = (note ?? "").trim();
	if (!raw) return { feet: "", inches: "" };

	// Common patterns:
	// - 3' 7"
	// - 3 ft 7 in
	// - 3 7
	// - 3-7
	const apostropheMatch = raw.match(/(\d+)\s*'\s*(\d+)?\s*(?:\"|in|inch|inches)?/i);
	if (apostropheMatch) {
		return { feet: apostropheMatch[1] ?? "", inches: apostropheMatch[2] ?? "" };
	}
	const ftInMatch = raw.match(/(\d+)\s*(?:ft|feet)\s*(\d+)?\s*(?:in|inch|inches)?/i);
	if (ftInMatch) {
		return { feet: ftInMatch[1] ?? "", inches: ftInMatch[2] ?? "" };
	}
	const nums = raw.match(/\d+/g) ?? [];
	if (nums.length >= 2) return { feet: nums[0] ?? "", inches: nums[1] ?? "" };
	if (nums.length === 1) return { feet: nums[0] ?? "", inches: "" };
	return { feet: "", inches: "" };
}

function formatFeetInches(feetRaw: string, inchesRaw: string) {
	const feetTrim = feetRaw.trim();
	const inchesTrim = inchesRaw.trim();
	if (!feetTrim && !inchesTrim) return "";

	const feetNum = feetTrim ? Math.max(0, Math.floor(Number(feetTrim))) : 0;
	const inchesNum = inchesTrim ? Math.max(0, Math.floor(Number(inchesTrim))) : 0;
	if (!Number.isFinite(feetNum) || !Number.isFinite(inchesNum)) return "";

	const totalInches = feetNum * 12 + inchesNum;
	const normFeet = Math.floor(totalInches / 12);
	const normInches = totalInches % 12;
	return `${normFeet}' ${normInches}"`;
}

function coerceClosestToPinByHoleFromDoc(input?: {
	closestToPinByHole?: Record<string, ContestWinnerNote>;
	closestToPin?: ContestEntry;
}) {
	const out: Record<string, { winner: string; note: string }> = {};
	const map = input?.closestToPinByHole;
	if (map && typeof map === "object") {
		for (const [hole, v] of Object.entries(map)) {
			out[String(hole)] = {
				winner: v?.winner ?? "",
				note: v?.note ?? "",
			};
		}
		return out;
	}
	const legacy = input?.closestToPin;
	if (legacy && legacy.hole != null) {
		out[String(legacy.hole)] = {
			winner: legacy.winner ?? "",
			note: legacy.note ?? "",
		};
	}
	return out;
}

export default function GroupPage() {
	const router = useRouter();
	const { groupId } = useParams<{ groupId: string }>();

	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [group, setGroup] = useState<GroupDoc | null>(null);
	const [selectedDay, setSelectedDay] = useState<DayKey>("day1");
	const [scoresByDay, setScoresByDay] = useState<{
		day1: Record<string, Array<number | null>>;
		day2: Record<string, Array<number | null>>;
	}>({ day1: {}, day2: {} });
	const [handicaps, setHandicaps] = useState<Record<string, number>>({});
	const [day2Adjustments, setDay2Adjustments] = useState<Record<string, number>>({});
	const [teeChoicesByDay, setTeeChoicesByDay] = useState<{ day1: Record<string, TeeKey>; day2: Record<string, TeeKey> }>({
		day1: {},
		day2: {},
	});
	const [charityStrokes, setCharityStrokes] = useState<Record<string, number>>({});
	const [treeStrokes, setTreeStrokes] = useState<Record<string, number>>({});
	const [contestByDay, setContestByDay] = useState<{
		day1: {
			closestToPinByHole: Record<string, { winner: string; note: string }>;
			legacyClosestToPin: { hole: string; winner: string; note: string };
			longestDrive: { hole: string; winner: string; note: string };
		};
		day2: {
			closestToPinByHole: Record<string, { winner: string; note: string }>;
			legacyClosestToPin: { hole: string; winner: string; note: string };
			longestDrive: { hole: string; winner: string; note: string };
		};
	}>({
		day1: {
			closestToPinByHole: {},
			legacyClosestToPin: { hole: "", winner: "", note: "" },
			longestDrive: { hole: "", winner: "", note: "" },
		},
		day2: {
			closestToPinByHole: {},
			legacyClosestToPin: { hole: "", winner: "", note: "" },
			longestDrive: { hole: "", winner: "", note: "" },
		},
	});
	const [saving, setSaving] = useState(false);
	const saveTimerRef = useRef<number | null>(null);
	const ctpPropagateTimerRef = useRef<number | null>(null);
	const longestDrivePropagateTimerRef = useRef<number | null>(null);

	const title = group?.groupName ?? group?.groupname ?? "Foursome";
	const playersDay1 = useMemo(() => {
		const fromByDay = group?.playerNamesByDay?.day1;
		const legacy = group?.playerNames;
		const base = (Array.isArray(fromByDay) ? fromByDay : Array.isArray(legacy) ? legacy : []) as string[];
		return base.filter(Boolean);
	}, [group?.playerNames, group?.playerNamesByDay?.day1]);
	const playersDay2 = useMemo(() => {
		const fromByDay = group?.playerNamesByDay?.day2;
		const legacy = group?.playerNames;
		const base = (Array.isArray(fromByDay) ? fromByDay : Array.isArray(legacy) ? legacy : []) as string[];
		return base.filter(Boolean);
	}, [group?.playerNames, group?.playerNamesByDay?.day2]);
	const players = useMemo(() => {
		return selectedDay === "day1" ? playersDay1 : playersDay2;
	}, [playersDay1, playersDay2, selectedDay]);
	const courseName = useMemo(() => {
		const d1 = group?.tournament?.day1Course ?? "Old Greenwood";
		const d2 = group?.tournament?.day2Course ?? "Grays Crossing";
		return selectedDay === "day1" ? d1 : d2;
	}, [group?.tournament?.day1Course, group?.tournament?.day2Course, selectedDay]);
	const isDay1LockedView = selectedDay === "day1" && !!group?.day1ScoresLocked;

	const dayPars = useMemo(() => {
		const pars = selectedDay === "day1" ? group?.tournament?.day1Pars : group?.tournament?.day2Pars;
		return Array.isArray(pars) && pars.length === HOLE_COUNT ? pars : null;
	}, [group?.tournament?.day1Pars, group?.tournament?.day2Pars, selectedDay]);
	const dayHcps = useMemo(() => {
		const hcps = selectedDay === "day1" ? group?.tournament?.day1Hcps : group?.tournament?.day2Hcps;
		return Array.isArray(hcps) && hcps.length === HOLE_COUNT ? hcps : null;
	}, [group?.tournament?.day1Hcps, group?.tournament?.day2Hcps, selectedDay]);
	const par3Holes = useMemo(() => {
		if (!dayPars) return [] as number[];
		const holes: number[] = [];
		for (let i = 0; i < dayPars.length; i++) {
			if (dayPars[i] === 3) holes.push(i + 1);
		}
		return holes;
	}, [dayPars]);

	const scores = scoresByDay[selectedDay];
	const grossTotals = useMemo(() => {
		const t: Record<string, number> = {};
		for (const p of players) t[p] = sum(scores[p] ?? []);
		return t;
	}, [players, scores]);
	const netTotals = useMemo(() => {
		const t: Record<string, number> = {};
		for (const p of players) {
			const base = handicaps[p] ?? 0;
			const adj = selectedDay === "day2" ? (day2Adjustments[p] ?? 0) : 0;
			const teeBonus = teeBonusForDay(selectedDay, teeChoicesByDay[selectedDay]?.[p]);
			const charity = charityStrokes[p] ?? 0;
			const tree = treeStrokes[p] ?? 0;
			const allocationStrokes = base + adj + teeBonus;
			const netBeforeCharity = computeNetRunningTotal({
				scores: scores[p] ?? Array.from({ length: HOLE_COUNT }, () => null),
				hcps: dayHcps,
				totalStrokes: allocationStrokes,
			});
			t[p] = applyCharityAtEnd(netBeforeCharity, scores[p] ?? [], charity + tree);
		}
		return t;
	}, [charityStrokes, day2Adjustments, dayHcps, handicaps, players, scores, selectedDay, teeChoicesByDay, treeStrokes]);
	const netToParByPlayer = useMemo(() => {
		const out: Record<string, number | null> = {};
		if (!dayPars) {
			for (const p of players) out[p] = null;
			return out;
		}
		for (const p of players) {
			const base = handicaps[p] ?? 0;
			const adj = selectedDay === "day2" ? (day2Adjustments[p] ?? 0) : 0;
			const teeBonus = teeBonusForDay(selectedDay, teeChoicesByDay[selectedDay]?.[p]);
			const charity = charityStrokes[p] ?? 0;
			const tree = treeStrokes[p] ?? 0;
			const allocationStrokes = base + adj + teeBonus;
			const netToPar = computeNetToPar({
				scores: scores[p] ?? Array.from({ length: HOLE_COUNT }, () => null),
				pars: dayPars,
				hcps: dayHcps,
				totalStrokes: allocationStrokes,
			});
			out[p] = netToPar == null ? null : applyCharityAtEnd(netToPar, scores[p] ?? [], charity + tree);
		}
		return out;
	}, [charityStrokes, day2Adjustments, dayHcps, dayPars, handicaps, players, scores, selectedDay, teeChoicesByDay, treeStrokes]);

	const day1Course = group?.tournament?.day1Course ?? "Old Greenwood";
	type LeaderRow = {
		player: string;
		handicap: number;
		adjustment: number;
		gross: number;
		net: number;
		toPar: number | null;
	};
	const day1Leaderboard = useMemo(() => {
		const pars = group?.tournament?.day1Pars;
		const hcps = group?.tournament?.day1Hcps;
		const rows: LeaderRow[] = playersDay1.map((p) => {
			const gross = sum(scoresByDay.day1[p] ?? []);
			const handicap = handicaps[p] ?? 0;
			const teeBonus = teeBonusForDay("day1", teeChoicesByDay.day1?.[p]);
			const charity = charityStrokes[p] ?? 0;
			const tree = treeStrokes[p] ?? 0;
			const allocationStrokes = handicap + teeBonus;
			const netBeforeCharity = computeNetRunningTotal({
				scores: scoresByDay.day1[p] ?? Array.from({ length: HOLE_COUNT }, () => null),
				hcps: Array.isArray(hcps) && hcps.length === HOLE_COUNT ? hcps : null,
				totalStrokes: allocationStrokes,
			});
			const net = applyCharityAtEnd(netBeforeCharity, scoresByDay.day1[p] ?? [], charity + tree);
			const toPar = computeToParSoFar({
				scores: scoresByDay.day1[p] ?? Array.from({ length: HOLE_COUNT }, () => null),
				pars: Array.isArray(pars) && pars.length === HOLE_COUNT ? pars : null,
			});
			return {
				player: p,
				handicap,
				adjustment: 0,
				gross,
				net,
				toPar,
			};
		});
		rows.sort((a, b) => a.net - b.net || a.gross - b.gross || a.player.localeCompare(b.player));
		return rows;
	}, [charityStrokes, group?.tournament?.day1Hcps, group?.tournament?.day1Pars, handicaps, playersDay1, scoresByDay.day1, teeChoicesByDay.day1, treeStrokes]);

	const day2Course = group?.tournament?.day2Course ?? "Grays Crossing";
	const day2Leaderboard = useMemo(() => {
		const pars = group?.tournament?.day2Pars;
		const hcps = group?.tournament?.day2Hcps;
		const rows: LeaderRow[] = playersDay2.map((p) => {
			const gross = sum(scoresByDay.day2[p] ?? []);
			const handicap = handicaps[p] ?? 0;
			const adjustment = day2Adjustments[p] ?? 0;
			const teeBonus = teeBonusForDay("day2", teeChoicesByDay.day2?.[p]);
			const charity = charityStrokes[p] ?? 0;
			const tree = treeStrokes[p] ?? 0;
			const allocationStrokes = handicap + adjustment + teeBonus;
			const netBeforeCharity = computeNetRunningTotal({
				scores: scoresByDay.day2[p] ?? Array.from({ length: HOLE_COUNT }, () => null),
				hcps: Array.isArray(hcps) && hcps.length === HOLE_COUNT ? hcps : null,
				totalStrokes: allocationStrokes,
			});
			const net = applyCharityAtEnd(netBeforeCharity, scoresByDay.day2[p] ?? [], charity + tree);
			const toPar = computeToParSoFar({
				scores: scoresByDay.day2[p] ?? Array.from({ length: HOLE_COUNT }, () => null),
				pars: Array.isArray(pars) && pars.length === HOLE_COUNT ? pars : null,
			});
			return {
				player: p,
				handicap,
				adjustment,
				gross,
				net,
				toPar,
			};
		});
		rows.sort((a, b) => a.net - b.net || a.gross - b.gross || a.player.localeCompare(b.player));
		return rows;
	}, [charityStrokes, day2Adjustments, group?.tournament?.day2Hcps, group?.tournament?.day2Pars, handicaps, playersDay2, scoresByDay.day2, teeChoicesByDay.day2, treeStrokes]);

	useEffect(() => {
		(async () => {
			setLoading(true);
			setError(null);
			setGroup(null);

			try {
				const byIdSnap = await getDoc(doc(db, "groups", groupId));
				if (byIdSnap.exists()) {
					setGroup(byIdSnap.data() as GroupDoc);
					return;
				}

				const q = query(collection(db, "groups"), where("pin", "==", groupId), limit(1));
				const pinSnap = await getDocs(q);

				if (pinSnap.empty) {
					setError("No group found for that PIN.");
					return;
				}

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
						const legacy = (data.playerNames ?? []).filter(Boolean);
						const d1 = ((data.playerNamesByDay?.day1 ?? legacy) as string[]).filter(Boolean);
						const d2 = ((data.playerNamesByDay?.day2 ?? legacy) as string[]).filter(Boolean);
						const allPlayers = uniqPreserveOrder([...d1, ...d2]);
						setScoresByDay(coerceScoresByDay(allPlayers, data.scores));
						setHandicaps(coerceNumberMap(allPlayers, data.handicaps ?? null, 0));
						setDay2Adjustments(coerceNumberMap(allPlayers, data.day2HandicapAdjustments ?? null, 0));
						setTeeChoicesByDay({
							day1: coerceTeeMap(allPlayers, data.teeChoices?.day1 ?? null, "combo"),
							day2: coerceTeeMap(allPlayers, data.teeChoices?.day2 ?? null, "combo"),
						});
						setCharityStrokes(coerceNumberMap(allPlayers, data.charityStrokes ?? null, 0));
						setTreeStrokes(coerceNumberMap(allPlayers, data.treeStrokes ?? null, 0));
						setContestByDay({
							day1: {
								closestToPinByHole: coerceClosestToPinByHoleFromDoc(data.contest?.day1),
								legacyClosestToPin: {
									hole: data.contest?.day1?.closestToPin?.hole != null ? String(data.contest.day1.closestToPin.hole) : "",
									winner: data.contest?.day1?.closestToPin?.winner ?? "",
									note: data.contest?.day1?.closestToPin?.note ?? "",
								},
								longestDrive: {
									hole: data.contest?.day1?.longestDrive?.hole != null ? String(data.contest.day1.longestDrive.hole) : "",
									winner: data.contest?.day1?.longestDrive?.winner ?? "",
									note: data.contest?.day1?.longestDrive?.note ?? "",
								},
							},
							day2: {
								closestToPinByHole: coerceClosestToPinByHoleFromDoc(data.contest?.day2),
								legacyClosestToPin: {
									hole: data.contest?.day2?.closestToPin?.hole != null ? String(data.contest.day2.closestToPin.hole) : "",
									winner: data.contest?.day2?.closestToPin?.winner ?? "",
									note: data.contest?.day2?.closestToPin?.note ?? "",
								},
								longestDrive: {
									hole: data.contest?.day2?.longestDrive?.hole != null ? String(data.contest.day2.longestDrive.hole) : "",
									winner: data.contest?.day2?.longestDrive?.winner ?? "",
									note: data.contest?.day2?.longestDrive?.note ?? "",
								},
							},
						});
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

	function scheduleSave(patch: Record<string, unknown>) {
		if (!groupId) return;
		if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
		saveTimerRef.current = window.setTimeout(async () => {
			setSaving(true);
			try {
				await updateDoc(doc(db, "groups", groupId), {
					...patch,
					updatedAt: serverTimestamp(),
				});
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				setError(`Could not save changes: ${message}`);
			} finally {
				setSaving(false);
			}
		}, 400);
	}

	function scheduleClosestToPinPropagate(opts: { holeKey: string; entry: { winner: string; note: string } }) {
		if (!group) return;
		const normalized = normalizeWinnerNote(opts.entry);
		// Only propagate once a distance has been posted.
		if (normalized.note == null) return;

		const tournamentId = group.tournamentId?.trim();
		// Safety: without a tournament scope, do not broadcast updates across all groups.
		if (!tournamentId) return;

		if (ctpPropagateTimerRef.current) window.clearTimeout(ctpPropagateTimerRef.current);
		ctpPropagateTimerRef.current = window.setTimeout(async () => {
			try {
				const groupsQ = query(collection(db, "groups"), where("tournamentId", "==", tournamentId));
				const snap = await getDocs(groupsQ);
				await Promise.all(
					snap.docs.map((d) => {
						const ref = doc(db, "groups", d.id);
						return updateDoc(ref, {
							[`contest.${selectedDay}.closestToPinByHole.${opts.holeKey}`]: {
								winner: normalized.winner,
								note: normalized.note,
							},
							updatedAt: serverTimestamp(),
						});
					})
				);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				setError(`Could not propagate Closest-to-Pin: ${message}`);
			}
		}, 700);
	}

	function scheduleLongestDrivePropagate(winner: string) {
		if (!group) return;
		const tournamentId = group.tournamentId?.trim();
		if (!tournamentId) return;

		const normalizedWinner = winner.trim();
		if (!normalizedWinner) return;

		if (longestDrivePropagateTimerRef.current) window.clearTimeout(longestDrivePropagateTimerRef.current);
		longestDrivePropagateTimerRef.current = window.setTimeout(async () => {
			try {
				const groupsQ = query(collection(db, "groups"), where("tournamentId", "==", tournamentId));
				const snap = await getDocs(groupsQ);
				await Promise.all(
					snap.docs.map((d) => {
						const ref = doc(db, "groups", d.id);
						return updateDoc(ref, {
							[`contest.${selectedDay}.longestDrive`]: {
								hole: null,
								winner: normalizedWinner,
								note: null,
							},
							updatedAt: serverTimestamp(),
						});
					})
				);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				setError(`Could not propagate Longest Drive: ${message}`);
			}
		}, 700);
	}

	function updateLongestDrive(field: "hole" | "winner" | "note", value: string) {
		setContestByDay((prev) => {
			const next = {
				...prev,
				[selectedDay]: {
					...prev[selectedDay],
					longestDrive: {
						...prev[selectedDay].longestDrive,
						[field]: value,
					},
				},
			};

			const contestPatch = {
				...(group?.contest ?? {}),
				[selectedDay]: {
					...(group?.contest?.[selectedDay] ?? {}),
					closestToPinByHole: normalizeClosestToPinByHoleState(next[selectedDay].closestToPinByHole),
					closestToPin: normalizeContestEntry(next[selectedDay].legacyClosestToPin),
					longestDrive: normalizeContestEntry(next[selectedDay].longestDrive),
				},
			};
			scheduleSave({ contest: contestPatch });

			if (field === "winner") {
				scheduleLongestDrivePropagate(value);
			}

			return next;
		});
	}

	function updateLegacyClosestToPin(field: "hole" | "winner" | "note", value: string) {
		setContestByDay((prev) => {
			const next = {
				...prev,
				[selectedDay]: {
					...prev[selectedDay],
					legacyClosestToPin: {
						...prev[selectedDay].legacyClosestToPin,
						[field]: value,
					},
				},
			};

			const contestPatch = {
				...(group?.contest ?? {}),
				[selectedDay]: {
					...(group?.contest?.[selectedDay] ?? {}),
					closestToPinByHole: normalizeClosestToPinByHoleState(next[selectedDay].closestToPinByHole),
					closestToPin: normalizeContestEntry(next[selectedDay].legacyClosestToPin),
					longestDrive: normalizeContestEntry(next[selectedDay].longestDrive),
				},
			};
			scheduleSave({ contest: contestPatch });

			return next;
		});
	}

	function updateClosestToPinForHole(holeNumber: number, field: "winner" | "note", value: string) {
		const holeKey = String(holeNumber);
		setContestByDay((prev) => {
			const existing = prev[selectedDay].closestToPinByHole[holeKey] ?? { winner: "", note: "" };
			const nextDay = {
				...prev[selectedDay],
				closestToPinByHole: {
					...prev[selectedDay].closestToPinByHole,
					[holeKey]: {
						...existing,
						[field]: value,
					},
				},
			};
			const next = { ...prev, [selectedDay]: nextDay };

			const contestPatch = {
				...(group?.contest ?? {}),
				[selectedDay]: {
					...(group?.contest?.[selectedDay] ?? {}),
					closestToPinByHole: normalizeClosestToPinByHoleState(next[selectedDay].closestToPinByHole),
					closestToPin: normalizeContestEntry(next[selectedDay].legacyClosestToPin),
					longestDrive: normalizeContestEntry(next[selectedDay].longestDrive),
				},
			};
			scheduleSave({ contest: contestPatch });

			const nextEntry = next[selectedDay].closestToPinByHole[holeKey] ?? { winner: "", note: "" };
			scheduleClosestToPinPropagate({ holeKey, entry: nextEntry });

			return next;
		});
	}

	if (loading) return <main className="min-h-screen bg-sky-50 text-slate-900 p-3 sm:p-6">Loading...</main>;
	if (error) return <main className="min-h-screen bg-sky-50 text-slate-900 p-3 sm:p-6">{error}</main>;
	if (!group) return <main className="min-h-screen bg-sky-50 text-slate-900 p-3 sm:p-6">Missing group data.</main>;

	return (
		<main className="min-h-screen bg-sky-50 text-slate-900 p-3 sm:p-6">
			<div className="max-w-5xl mx-auto">
					<div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 sm:gap-4">
						<div>
							<h1 className="text-xl sm:text-2xl font-bold">{title}</h1>
							<p className="text-slate-600 mt-1">
								{players.length ? `${players.length} players` : "No players yet"} · {saving ? "Saving…" : "Saved"}
							</p>
						</div>
					</div>

					{players.length ? (
						<div className="mt-5 flex items-center justify-between gap-3 flex-wrap">
							<div className="inline-flex rounded-lg border border-sky-200 overflow-hidden bg-white/70">
								<button
									onClick={() => setSelectedDay("day1")}
									className={`px-4 py-2 text-sm ${selectedDay === "day1" ? "bg-sky-600 text-white" : "bg-white/60 hover:bg-white"}`}
								>
									Day 1
								</button>
								<button
									onClick={() => setSelectedDay("day2")}
									className={`px-4 py-2 text-sm ${selectedDay === "day2" ? "bg-sky-600 text-white" : "bg-white/60 hover:bg-white"}`}
								>
									Day 2
								</button>
							</div>
							<div className="text-sm text-slate-700">
								<p>Course: {courseName}</p>
								{isDay1LockedView ? <p className="text-xs text-slate-600 mt-0.5">Day 1 locked by admin.</p> : null}
							</div>
						</div>
					) : null}

					{players.length === 0 ? (
						<div className="mt-6 bg-white/80 border border-sky-200 rounded-2xl p-5">
							<h2 className="text-lg font-semibold">Players not set</h2>
							<p className="text-slate-600 text-sm mt-1">Ask an admin to set up players, handicaps, and adjustments.</p>
							<button
								onClick={() => router.push(`/group/${groupId}/admin`)}
								className="mt-3 bg-white hover:bg-sky-50 border border-sky-200 px-4 py-2 rounded-lg text-sm"
							>
								Open admin
							</button>
						</div>
					) : (
						<>
							<div className="mt-4 sm:mt-6 overflow-x-auto bg-white/80 border border-sky-200 rounded-2xl">
								<table className="w-full min-w-[680px] text-xs sm:text-sm">
									<thead className="bg-sky-100/70">
										<tr className="text-left">
											<th className="pl-1 pr-0.5 py-1 sm:p-3 text-slate-700">Hole</th>
											{players.map((p) => (
												<th key={p} className="px-0.5 py-1 sm:p-3 text-slate-700 whitespace-nowrap">
													{p}
												</th>
											))}
										</tr>
									</thead>
									<tbody>
										{Array.from({ length: HOLE_COUNT }, (_, holeIdx) => (
											<tr key={holeIdx} className={holeIdx % 2 ? "bg-white/40" : "bg-white/70"}>
												<td className="pl-1 pr-0.5 py-1 sm:p-3 text-slate-800 font-semibold whitespace-nowrap">
													<div className="sm:hidden">
														<div>Hole {holeIdx + 1}</div>
														{dayPars || dayHcps ? (
															<div className="text-slate-500 font-normal leading-tight mt-0.5">
																{dayPars ? <div>Par {dayPars[holeIdx]}</div> : null}
																{dayHcps ? <div>Hcp {dayHcps[holeIdx]}</div> : null}
															</div>
														) : null}
													</div>
													<div className="hidden sm:block">
														Hole {holeIdx + 1}
														{dayPars ? <span className="text-slate-500 font-normal"> · Par {dayPars[holeIdx]}</span> : null}
														{dayHcps ? <span className="text-slate-500 font-normal"> · Hcp {dayHcps[holeIdx]}</span> : null}
													</div>
												</td>
												{players.map((p) => {
													const v = scores[p]?.[holeIdx];
													const base = handicaps[p] ?? 0;
													const adj = selectedDay === "day2" ? (day2Adjustments[p] ?? 0) : 0;
															const teeBonus = teeBonusForDay(selectedDay, teeChoicesByDay[selectedDay]?.[p]);
														const totalStrokes = base + adj + teeBonus;
													const holeStroke = dayHcps ? strokesForHole(dayHcps[holeIdx], totalStrokes) : 0;
													const netHole = typeof v === "number" && Number.isFinite(v) ? v - holeStroke : null;
													return (
														<td key={`${p}-${holeIdx}`} className="px-0.5 py-1 sm:p-3">
															<div className="flex flex-col sm:flex-row sm:items-center gap-0.5 sm:gap-3">
																<input
																	disabled={isDay1LockedView}
																	value={typeof v === "number" ? String(v) : ""}
																	onChange={(e) => {
																		if (isDay1LockedView) return;
																		const raw = e.target.value;
																		const parsed = raw === "" ? null : Number(raw);
																		const nextScoresTable = {
																			...scores,
																			[p]: Array.from({ length: HOLE_COUNT }, (_, i) => scores[p]?.[i] ?? null),
																		};
																		nextScoresTable[p][holeIdx] =
																			typeof parsed === "number" && Number.isFinite(parsed) && parsed >= 0 ? parsed : null;

																		const nextScoresByDay = {
																			...scoresByDay,
																			[selectedDay]: nextScoresTable,
																		};
																		setScoresByDay(nextScoresByDay);
																		scheduleSave({ scores: nextScoresByDay });
																	}}
																	inputMode="numeric"
																	pattern="[0-9]*"
																	className={`w-11 sm:w-20 p-1 sm:p-2 border rounded-lg text-center focus:outline-none focus:ring-2 focus:ring-sky-200 ${
																		isDay1LockedView
																			? "bg-slate-100 border-slate-200 text-slate-500 cursor-not-allowed"
																			: "bg-white border-sky-200"
																	}`}
																	placeholder="-"
																/>
															<div className="whitespace-nowrap">
																<div className="text-[11px] sm:text-xs text-slate-500">Net</div>
																<div className="text-base sm:text-lg font-semibold text-slate-900 leading-none">
																	{netHole == null ? "—" : netHole}
																</div>
																{netHole != null && holeStroke ? (
																	<div className="text-xs text-slate-500">(−{holeStroke})</div>
																) : null}
															</div>
															</div>
														</td>
													);
												})}
											</tr>
										))}
															<tr className="bg-sky-100/70 border-t border-sky-200">
																<td className="p-2 sm:p-3 text-slate-800 font-semibold">Total · Gross</td>
																{players.map((p) => (
																		<td key={`gross-${p}`} className="p-2 sm:p-3 text-slate-800 font-semibold">
																			{grossTotals[p] ?? 0}
																		</td>
																))}
														</tr>
															<tr className="bg-sky-100/70 border-t border-sky-200">
																<td className="p-2 sm:p-3 text-slate-800 font-semibold">Charity / Tree</td>
																{players.map((p) => (
																		<td key={`ct-${p}`} className="p-2 sm:p-3 text-slate-800 font-semibold whitespace-nowrap">
																			Ch {charityStrokes[p] ?? 0} · Tr {treeStrokes[p] ?? 0}
																		</td>
																))}
														</tr>
											<tr className="bg-sky-100/70 border-t border-sky-200">
												<td className="p-2 sm:p-3 text-slate-800 font-semibold">Total · Net</td>
											{players.map((p) => (
													<td key={`net-${p}`} className="p-2 sm:p-3 text-slate-800 font-semibold">
													{netTotals[p] ?? 0}
												</td>
											))}
										</tr>
									</tbody>
								</table>
							</div>

							<div className="mt-4 sm:mt-6 bg-white/80 border border-sky-200 rounded-2xl p-3 sm:p-5">
								<div className="flex items-center justify-between gap-3 flex-wrap">
									<h2 className="text-lg font-semibold">Totals</h2>
								</div>

								<div className="mt-2 sm:mt-3 grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4 items-start">
									<div className="bg-white border border-sky-200 rounded-xl p-2 sm:p-3 overflow-x-auto self-start">
										<table className="w-full min-w-[560px] text-xs sm:text-sm">
											<thead>
												<tr className="text-left text-slate-700">
													<th className="p-1.5 sm:p-2">Player</th>
													<th className="p-1.5 sm:p-2">Handicap</th>
													{selectedDay === "day2" ? <th className="p-1.5 sm:p-2">Day 2 adj</th> : null}
													<th className="p-1.5 sm:p-2">Gross</th>
													<th className="p-1.5 sm:p-2">Net*</th>
												</tr>
											</thead>
											<tbody>
												{players.map((p) => (
													<tr key={p} className="border-t border-sky-100">
														<td className="p-1.5 sm:p-2 text-slate-900 font-semibold">{p}</td>
														<td className="p-1.5 sm:p-2 text-slate-800">{handicaps[p] ?? 0}</td>
														{selectedDay === "day2" ? <td className="p-1.5 sm:p-2 text-slate-800">{day2Adjustments[p] ?? 0}</td> : null}
														<td className="p-1.5 sm:p-2 text-slate-800">{grossTotals[p] ?? 0}</td>
														<td className="p-1.5 sm:p-2 text-slate-800">{netTotals[p] ?? 0}</td>
													</tr>
												))}
											</tbody>
										</table>
										<p className="text-xs text-slate-500 mt-1 sm:mt-2">*Net includes tee bonus. Charity + Tree strokes apply to final score only.</p>
									</div>

									<div className="bg-white border border-sky-200 rounded-xl p-2 sm:p-3 self-start">
										<h3 className="text-sm font-semibold text-slate-900">Closest to the Pin</h3>
										{par3Holes.length ? <p className="text-xs text-slate-500 mt-1">Par 3 holes: {par3Holes.join(", ")}</p> : null}
										{par3Holes.length ? (
											<div className="mt-2 space-y-2">
												{par3Holes.map((hole) => {
													const entry = contestByDay[selectedDay].closestToPinByHole[String(hole)] ?? { winner: "", note: "" };
													const distance = parseFeetInches(entry.note);
													return (
														<div key={hole} className="grid grid-cols-1 sm:grid-cols-3 gap-1.5 sm:gap-2">
															<div className="p-2 bg-sky-50 border border-sky-200 rounded-lg text-slate-800">Hole {hole} · Par 3</div>
															<input
																value={entry.winner}
																onChange={(e) => updateClosestToPinForHole(hole, "winner", e.target.value)}
																className="p-1.5 sm:p-2 bg-white border border-sky-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-200"
																placeholder="Winner"
															/>
															<div className="grid grid-cols-2 gap-1.5 sm:gap-2">
																<input
																	value={distance.feet}
																	onChange={(e) => updateClosestToPinForHole(hole, "note", formatFeetInches(e.target.value, distance.inches))}
																	inputMode="numeric"
																	className="p-1.5 sm:p-2 bg-white border border-sky-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-200"
																	placeholder="Feet"
																/>
																<input
																	value={distance.inches}
																	onChange={(e) => updateClosestToPinForHole(hole, "note", formatFeetInches(distance.feet, e.target.value))}
																	inputMode="numeric"
																	className="p-1.5 sm:p-2 bg-white border border-sky-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-200"
																	placeholder="Inches"
																/>
															</div>
														</div>
													);
												})}
											</div>
										) : (
											<>
												<p className="text-xs text-slate-600 mt-1">Set course pars in Admin to enable Par 3 tracking.</p>
												<div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-1.5 sm:gap-2">
													<input
														value={contestByDay[selectedDay].legacyClosestToPin.hole}
														onChange={(e) => updateLegacyClosestToPin("hole", e.target.value)}
														inputMode="numeric"
															className="p-1.5 sm:p-2 bg-white border border-sky-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-200"
														placeholder="Hole"
													/>
													<input
														value={contestByDay[selectedDay].legacyClosestToPin.winner}
														onChange={(e) => updateLegacyClosestToPin("winner", e.target.value)}
															className="p-1.5 sm:p-2 bg-white border border-sky-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-200"
														placeholder="Winner"
													/>
															<div className="grid grid-cols-2 gap-1.5 sm:gap-2">
																{(() => {
																	const d = parseFeetInches(contestByDay[selectedDay].legacyClosestToPin.note);
																	return (
																		<>
																			<input
																				value={d.feet}
																				onChange={(e) => updateLegacyClosestToPin("note", formatFeetInches(e.target.value, d.inches))}
																				inputMode="numeric"
																				className="p-1.5 sm:p-2 bg-white border border-sky-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-200"
																				placeholder="Feet"
																			/>
																			<input
																				value={d.inches}
																				onChange={(e) => updateLegacyClosestToPin("note", formatFeetInches(d.feet, e.target.value))}
																				inputMode="numeric"
																				className="p-1.5 sm:p-2 bg-white border border-sky-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-200"
																				placeholder="Inches"
																			/>
																		</>
																	);
																})()}
															</div>
												</div>
											</>
										)}

										<h3 className="text-sm font-semibold text-slate-900 mt-3 sm:mt-4">Longest Drive</h3>
										<div className="mt-2">
											<input
												value={contestByDay[selectedDay].longestDrive.winner}
												onChange={(e) => updateLongestDrive("winner", e.target.value)}
												className="w-full p-1.5 sm:p-2 bg-white border border-sky-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-200"
												placeholder="Winner name"
											/>
										</div>
									</div>
								</div>
							</div>

							<div className="mt-6 bg-white/80 border border-sky-200 rounded-2xl p-4 sm:p-5">
								<div className="flex items-center justify-between gap-3 flex-wrap">
									<h2 className="text-lg font-semibold">Leaderboards</h2>
									<p className="text-sm text-slate-600">Sorted by net (low)</p>
								</div>

								<div className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-4">
									<div className="bg-white border border-sky-200 rounded-xl p-3 overflow-x-auto">
										<div className="flex items-baseline justify-between gap-3">
											<h3 className="text-sm font-semibold text-slate-900">Day 1</h3>
											<p className="text-xs text-slate-500">{day1Course}</p>
										</div>
										<table className="w-full min-w-[520px] text-sm mt-2">
											<thead>
												<tr className="text-left text-slate-700">
													<th className="p-2">#</th>
													<th className="p-2">Player</th>
													<th className="p-2">HCP</th>
													<th className="p-2">Gross</th>
													<th className="p-2">Net</th>
																<th className="p-2">To Par</th>
												</tr>
											</thead>
											<tbody>
												{day1Leaderboard.map((r, idx) => (
													<tr key={`d1-${r.player}`} className="border-t border-sky-100">
														<td className="p-2 text-slate-500">{idx + 1}</td>
														<td className="p-2 text-slate-900 font-semibold">{r.player}</td>
														<td className="p-2 text-slate-800">{r.handicap}</td>
														<td className="p-2 text-slate-800">{r.gross}</td>
														<td className="p-2 text-slate-800">{r.net}</td>
														<td className="p-2 text-slate-800">
																	{r.toPar == null ? "—" : r.toPar === 0 ? "E" : r.toPar < 0 ? `${r.toPar}` : `+${r.toPar}`}
														</td>
													</tr>
												))}
											</tbody>
										</table>
									</div>

									<div className="bg-white border border-sky-200 rounded-xl p-3 overflow-x-auto">
										<div className="flex items-baseline justify-between gap-3">
											<h3 className="text-sm font-semibold text-slate-900">Day 2 (Final)</h3>
											<p className="text-xs text-slate-500">{day2Course} · includes adj</p>
										</div>
										<table className="w-full min-w-[620px] text-sm mt-2">
											<thead>
												<tr className="text-left text-slate-700">
													<th className="p-2">#</th>
													<th className="p-2">Player</th>
													<th className="p-2">HCP</th>
													<th className="p-2">Adj</th>
													<th className="p-2">Gross</th>
													<th className="p-2">Net</th>
																<th className="p-2">To Par</th>
												</tr>
											</thead>
											<tbody>
												{day2Leaderboard.map((r, idx) => (
													<tr key={`d2-${r.player}`} className="border-t border-sky-100">
														<td className="p-2 text-slate-500">{idx + 1}</td>
														<td className="p-2 text-slate-900 font-semibold">{r.player}</td>
														<td className="p-2 text-slate-800">{r.handicap}</td>
														<td className="p-2 text-slate-800">{r.adjustment}</td>
														<td className="p-2 text-slate-800">{r.gross}</td>
														<td className="p-2 text-slate-800">{r.net}</td>
														<td className="p-2 text-slate-800">
																	{r.toPar == null ? "—" : r.toPar === 0 ? "E" : r.toPar < 0 ? `${r.toPar}` : `+${r.toPar}`}
														</td>
													</tr>
												))}
											</tbody>
										</table>
									</div>
								</div>
							</div>

							<div className="mt-6 bg-white/80 border border-sky-200 rounded-2xl p-4 sm:p-5">
								<div className="flex items-center justify-between gap-3 flex-wrap">
									<h2 className="text-lg font-semibold">Admin</h2>
									<p className="text-sm text-slate-600">Handicaps, adjustments, players, score edits</p>
								</div>
								<button
									onClick={() => router.push(`/group/${groupId}/admin`)}
									className="mt-3 bg-white hover:bg-sky-50 border border-sky-200 px-4 py-2 rounded-lg text-sm"
								>
									Open admin
								</button>
							</div>
						</>
					)}

				</div>
			</main>
		);
}
