"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
	addDoc,
	collection,
	doc,
	getDoc,
	onSnapshot,
	runTransaction,
	serverTimestamp,
	updateDoc,
} from "firebase/firestore";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from "firebase/auth";
import { auth, db } from "@/lib/firebase";

type DayKey = "day1" | "day2";

type TeeKey = "combo" | "three" | "four" | "stampede" | "tips";

type GroupDoc = {
	groupName?: string;
	groupname?: string;
	pin?: string;
	playerNames?: string[];
	playerNamesByDay?: {
		day1?: string[];
		day2?: string[];
	};
	day1ScoresLocked?: boolean;
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
	charityStrokes?: Record<string, number | null>;
	treeStrokes?: Record<string, number | null>;
	tournament?: {
		day1Course?: string;
		day2Course?: string;
		day1Pars?: number[];
		day2Pars?: number[];
		day1Hcps?: number[];
		day2Hcps?: number[];
	};
};

type GroupWithId = { id: string; data: GroupDoc };

type PlayerEditDraft = {
	moveToGidDay1?: string;
	moveToGidDay2?: string;
	name?: string;
	handicap?: string;
	day2Adj?: string;
	charity?: string;
	tree?: string;
	teeDay1?: TeeKey;
	teeDay2?: TeeKey;
};

const HOLE_COUNT = 18;

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

function parseParsDraft(raw: string) {
	const parts = raw
		.split(/,|\n|\s+/)
		.map((s) => s.trim())
		.filter(Boolean);
	const nums = parts.map((p) => Number(p));
	if (nums.some((n) => !Number.isFinite(n))) return null;
	if (nums.length !== HOLE_COUNT) return null;
	const ints = nums.map((n) => Math.floor(n));
	if (ints.some((n) => n < 3 || n > 6)) return null;
	return ints;
}

function parseHcpsDraft(raw: string) {
	const parts = raw
		.split(/,|\n|\s+/)
		.map((s) => s.trim())
		.filter(Boolean);
	const nums = parts.map((p) => Number(p));
	if (nums.some((n) => !Number.isFinite(n))) return null;
	if (nums.length !== HOLE_COUNT) return null;
	const ints = nums.map((n) => Math.floor(n));
	if (ints.some((n) => n < 1 || n > 18)) return null;
	const uniq = new Set(ints);
	if (uniq.size !== HOLE_COUNT) return null;
	return ints;
}

export default function GroupAdminPage() {
	const router = useRouter();
	const { groupId } = useParams<{ groupId: string }>();

	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [group, setGroup] = useState<GroupDoc | null>(null);
	const [day1LockSaving, setDay1LockSaving] = useState(false);
	const [day1LockError, setDay1LockError] = useState<string | null>(null);

	const [adminUser, setAdminUser] = useState<User | null>(null);
	const [adminEmail, setAdminEmail] = useState("");
	const [adminPassword, setAdminPassword] = useState("");
	const [adminError, setAdminError] = useState<string | null>(null);

	const allowedAdminEmails = useMemo(() => {
		const raw = process.env.NEXT_PUBLIC_ADMIN_EMAILS ?? "";
		return raw
			.split(",")
			.map((s) => s.trim().toLowerCase())
			.filter(Boolean);
	}, []);
	const isSignedIn = !!adminUser;
	const isAdmin = useMemo(() => {
		if (!adminUser) return false;
		if (allowedAdminEmails.length === 0) return true;
		const email = (adminUser.email ?? "").toLowerCase();
		return allowedAdminEmails.includes(email);
	}, [adminUser, allowedAdminEmails]);

	const title = group?.groupName ?? group?.groupname ?? "Foursome";
	const [selectedDay, setSelectedDay] = useState<DayKey>("day1");
	const playersDay1 = useMemo(() => {
		const legacy = (group?.playerNames ?? []).filter(Boolean);
		const d1 = (group?.playerNamesByDay?.day1 ?? legacy) as string[];
		return d1.filter(Boolean);
	}, [group?.playerNames, group?.playerNamesByDay?.day1]);
	const playersDay2 = useMemo(() => {
		const legacy = (group?.playerNames ?? []).filter(Boolean);
		const d2 = (group?.playerNamesByDay?.day2 ?? legacy) as string[];
		return d2.filter(Boolean);
	}, [group?.playerNames, group?.playerNamesByDay?.day2]);
	const players = useMemo(() => (selectedDay === "day1" ? playersDay1 : playersDay2), [playersDay1, playersDay2, selectedDay]);
	const [day1ParsDraft, setDay1ParsDraft] = useState("");
	const [day2ParsDraft, setDay2ParsDraft] = useState("");
	const [day1HcpsDraft, setDay1HcpsDraft] = useState("");
	const [day2HcpsDraft, setDay2HcpsDraft] = useState("");
	const [scorecardError, setScorecardError] = useState<string | null>(null);
	const [scoresByDay, setScoresByDay] = useState<{
		day1: Record<string, Array<number | null>>;
		day2: Record<string, Array<number | null>>;
	}>({ day1: {}, day2: {} });

	const [saving, setSaving] = useState(false);
	const saveTimerRef = useRef<number | null>(null);

	const [allGroupsLoading, setAllGroupsLoading] = useState(false);
	const [allGroupsError, setAllGroupsError] = useState<string | null>(null);
	const [allGroups, setAllGroups] = useState<GroupWithId[]>([]);
	const [playerEdits, setPlayerEdits] = useState<Record<string, PlayerEditDraft>>({});
	const [savingPlayerKey, setSavingPlayerKey] = useState<string | null>(null);

	const [addPlayerName, setAddPlayerName] = useState("");
	const [addPlayerHandicap, setAddPlayerHandicap] = useState("0");
	const [addingPlayer, setAddingPlayer] = useState(false);
	const [addPlayerError, setAddPlayerError] = useState<string | null>(null);

	const [newFoursomeNumber, setNewFoursomeNumber] = useState("");
	const [creatingFoursome, setCreatingFoursome] = useState(false);
	const [createFoursomeError, setCreateFoursomeError] = useState<string | null>(null);
	const [createdFoursomeId, setCreatedFoursomeId] = useState<string | null>(null);

	useEffect(() => {
		const unsub = onAuthStateChanged(auth, (u) => setAdminUser(u));
		return () => unsub();
	}, []);

	useEffect(() => {
		if (!isAdmin) return;
		setAllGroupsLoading(true);
		setAllGroupsError(null);

		const unsub = onSnapshot(
			collection(db, "groups"),
			(snap) => {
				setAllGroups(
					snap.docs.map((d) => ({
						id: d.id,
						data: d.data() as GroupDoc,
					}))
				);
				setAllGroupsLoading(false);
			},
			(err) => {
				setAllGroupsError(err instanceof Error ? err.message : String(err));
				setAllGroupsLoading(false);
			}
		);

		return () => unsub();
	}, [isAdmin]);

	useEffect(() => {
		if (!groupId) return;
		setLoading(true);
		setError(null);
		setGroup(null);

		let unsub: (() => void) | null = null;
		(async () => {
			try {
				const snap = await getDoc(doc(db, "groups", groupId));
				if (!snap.exists()) {
					setError("Group not found.");
					setLoading(false);
					return;
				}

				unsub = onSnapshot(
					doc(db, "groups", groupId),
					(s) => {
						if (!s.exists()) return;
						const data = s.data() as GroupDoc;
						setGroup(data);
						const legacy = (data.playerNames ?? []).filter(Boolean);
						const d1 = ((data.playerNamesByDay?.day1 ?? legacy) as string[]).filter(Boolean);
						const d2 = ((data.playerNamesByDay?.day2 ?? legacy) as string[]).filter(Boolean);
						const allPlayers = uniqPreserveOrder([...d1, ...d2]);
						setScoresByDay(coerceScoresByDay(allPlayers, data.scores));
							if (!day1ParsDraft && Array.isArray(data.tournament?.day1Pars) && data.tournament?.day1Pars?.length === HOLE_COUNT) {
								setDay1ParsDraft(data.tournament.day1Pars.join(","));
							}
							if (!day2ParsDraft && Array.isArray(data.tournament?.day2Pars) && data.tournament?.day2Pars?.length === HOLE_COUNT) {
								setDay2ParsDraft(data.tournament.day2Pars.join(","));
							}
							if (!day1HcpsDraft && Array.isArray(data.tournament?.day1Hcps) && data.tournament?.day1Hcps?.length === HOLE_COUNT) {
								setDay1HcpsDraft(data.tournament.day1Hcps.join(","));
							}
							if (!day2HcpsDraft && Array.isArray(data.tournament?.day2Hcps) && data.tournament?.day2Hcps?.length === HOLE_COUNT) {
								setDay2HcpsDraft(data.tournament.day2Hcps.join(","));
							}
					},
					() => setError("Failed to subscribe to group updates.")
				);
			} catch {
				setError("Failed to load group.");
			} finally {
				setLoading(false);
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
			setError(null);
			try {
				await updateDoc(doc(db, "groups", groupId), {
					...patch,
					updatedAt: serverTimestamp(),
				});
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				setError(`Could not save: ${message}`);
			} finally {
				setSaving(false);
			}
		}, 250);
	}

	function editKey(player: string) {
		return player.trim().toLowerCase();
	}

	function getGroupTitle(data: GroupDoc, fallbackId: string) {
		return data.groupName ?? data.groupname ?? `Foursome ${fallbackId.slice(0, 5)}`;
	}

	function getFoursomeNumber(data: GroupDoc): number | null {
		const title = (data.groupName ?? data.groupname ?? "").trim();
		const m = title.match(/(\d+)/);
		if (!m) return null;
		const n = Number(m[1]);
		return Number.isFinite(n) ? Math.floor(n) : null;
	}

	const foursomeOptions = useMemo(() => {
		const seen = new Map<number, string>();
		for (const g of allGroups) {
			const n = getFoursomeNumber(g.data);
			if (n == null) continue;
			if (!seen.has(n)) seen.set(n, g.id);
		}
		const opts = Array.from(seen.entries()).map(([n, gid]) => ({ gid, n }));
		opts.sort((a, b) => a.n - b.n);
		return opts;
	}, [allGroups]);

	const gidByFoursomeNumber = useMemo(() => {
		const map = new Map<number, string>();
		for (const o of foursomeOptions) {
			if (!map.has(o.n)) map.set(o.n, o.gid);
		}
		return map;
	}, [foursomeOptions]);

	const allPlayersRoster = useMemo(() => {
		const seen = new Map<string, { player: string; day1Gid: string | null; day2Gid: string | null; primaryGroup: GroupWithId }>();
		for (const g of allGroups) {
			const legacy = (g.data.playerNames ?? []).filter(Boolean);
			const gDay1 = ((g.data.playerNamesByDay?.day1 ?? legacy) as string[]).filter(Boolean);
			const gDay2 = ((g.data.playerNamesByDay?.day2 ?? legacy) as string[]).filter(Boolean);
			for (const p of gDay1) {
				const lowKey = p.trim().toLowerCase();
				if (!seen.has(lowKey)) {
					seen.set(lowKey, { player: p, day1Gid: g.id, day2Gid: null, primaryGroup: g });
				} else {
					const existing = seen.get(lowKey)!;
					if (!existing.day1Gid) { existing.day1Gid = g.id; existing.primaryGroup = g; }
				}
			}
			for (const p of gDay2) {
				const lowKey = p.trim().toLowerCase();
				if (!seen.has(lowKey)) {
					seen.set(lowKey, { player: p, day1Gid: null, day2Gid: g.id, primaryGroup: g });
				} else {
					const existing = seen.get(lowKey)!;
					if (!existing.day2Gid) existing.day2Gid = g.id;
				}
			}
		}
		return Array.from(seen.values());
	}, [allGroups]);

	function findPlayerKey(players: string[], player: string) {
		const lowered = player.trim().toLowerCase();
		return players.find((p) => p.trim().toLowerCase() === lowered) ?? null;
	}

	async function deletePlayerGlobally(player: string, currentDay1Gid: string | null, currentDay2Gid: string | null) {
			if (!isAdmin) {
				setError("Admin access required.");
				return;
			}
			const ok = window.confirm(`Delete ${player} from all foursomes? This will remove their scores and settings.`);
			if (!ok) return;

			const gidsWithPlayer = new Set<string>();
			for (const g of allGroups) {
				const legacy = (g.data.playerNames ?? []).filter(Boolean);
				const d1 = ((g.data.playerNamesByDay?.day1 ?? legacy) as string[]).filter(Boolean);
				const d2 = ((g.data.playerNamesByDay?.day2 ?? legacy) as string[]).filter(Boolean);
				if ([...d1, ...d2].some((p) => p.toLowerCase() === player.toLowerCase())) {
					gidsWithPlayer.add(g.id);
				}
			}

			setError(null);
			for (const gid of gidsWithPlayer) {
				try {
					const groupRow = allGroups.find((g) => g.id === gid);
					if (!groupRow) continue;
					const current = groupRow.data;
					const legacy = (current.playerNames ?? []).filter(Boolean);
					const curDay1 = ((current.playerNamesByDay?.day1 ?? legacy) as string[]).filter(Boolean);
					const curDay2 = ((current.playerNamesByDay?.day2 ?? legacy) as string[]).filter(Boolean);
					const curPlayers = uniqPreserveOrder([...curDay1, ...curDay2]);
					const curKey = findPlayerKey(curPlayers, player);
					if (!curKey) continue;
					const lowered = curKey.toLowerCase();
					const nextDay1 = curDay1.filter((p) => p.toLowerCase() !== lowered);
					const nextDay2 = curDay2.filter((p) => p.toLowerCase() !== lowered);
					const nextPlayers = uniqPreserveOrder([...nextDay1, ...nextDay2]);

					const nextHandicaps = { ...(current.handicaps ?? {}) } as Record<string, number | null>;
					delete nextHandicaps[curKey];
					const nextDay2Adj = { ...(current.day2HandicapAdjustments ?? {}) } as Record<string, number | null>;
					delete nextDay2Adj[curKey];
					const nextCharity = { ...(current.charityStrokes ?? {}) } as Record<string, number | null>;
					delete nextCharity[curKey];
					const nextTree = { ...(current.treeStrokes ?? {}) } as Record<string, number | null>;
					delete nextTree[curKey];
					const nextTeeChoices = {
						day1: { ...(current.teeChoices?.day1 ?? {}) } as Record<string, TeeKey | null>,
						day2: { ...(current.teeChoices?.day2 ?? {}) } as Record<string, TeeKey | null>,
					};
					delete nextTeeChoices.day1[curKey];
					delete nextTeeChoices.day2[curKey];
					const nextScoresByDay = coerceScoresByDay(nextPlayers, current.scores);

					await updateDoc(doc(db, "groups", gid), {
						playerNames: nextPlayers,
						playerNamesByDay: { day1: nextDay1, day2: nextDay2 },
						handicaps: nextHandicaps,
						day2HandicapAdjustments: nextDay2Adj,
						charityStrokes: nextCharity,
						treeStrokes: nextTree,
						teeChoices: nextTeeChoices,
						scores: nextScoresByDay,
						updatedAt: serverTimestamp(),
					});
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					setError(`Could not delete player from group ${gid}: ${message}`);
				}
			}
		}
	async function savePlayerEdits(opts: { player: string; currentDay1Gid: string | null; currentDay2Gid: string | null }) {
		if (!isAdmin) {
			setError("Admin access required.");
			return;
		}
		const { player, currentDay1Gid, currentDay2Gid } = opts;
		const key = editKey(player);
		const edit = playerEdits[key];
		const nameDraft = (edit?.name ?? player).trim();
		const nextName = nameDraft || player;

		const primaryGid = currentDay1Gid ?? currentDay2Gid;
		if (!primaryGid) return;
		const primaryGroup = allGroups.find((g) => g.id === primaryGid);
		if (!primaryGroup) return;
		const current = primaryGroup.data;

		const currentHandicap = current.handicaps?.[player] ?? 0;
		const currentDay2Adj = current.day2HandicapAdjustments?.[player] ?? 0;
		const currentCharity = current.charityStrokes?.[player] ?? 0;
		const currentTree = current.treeStrokes?.[player] ?? 0;
		const currentTeeDay1 = (current.teeChoices?.day1?.[player] as TeeKey | null | undefined) ?? "combo";
		const currentTeeDay2 = (current.teeChoices?.day2?.[player] as TeeKey | null | undefined) ?? "stampede";

		const handicapRaw = edit?.handicap ?? String(currentHandicap);
		const day2AdjRaw = edit?.day2Adj ?? String(currentDay2Adj);
		const charityRaw = edit?.charity ?? String(currentCharity);
		const treeRaw = edit?.tree ?? String(currentTree);
		const teeDay1 = edit?.teeDay1 ?? currentTeeDay1;
		const teeDay2 = edit?.teeDay2 ?? currentTeeDay2;

		const handicapNum = Math.floor(Number(handicapRaw || 0));
		const day2AdjNum = Math.floor(Number(day2AdjRaw || 0));
		const charityNum = Math.floor(Number(charityRaw || 0));
		const treeNum = Math.floor(Number(treeRaw || 0));
		const safeHandicap = Number.isFinite(handicapNum) ? handicapNum : 0;
		const safeDay2Adj = Number.isFinite(day2AdjNum) ? day2AdjNum : 0;
		const safeCharity = Number.isFinite(charityNum) ? charityNum : 0;
		const safeTree = Number.isFinite(treeNum) ? treeNum : 0;

		const newDay1Gid = edit?.moveToGidDay1 !== undefined ? edit.moveToGidDay1 : currentDay1Gid;
		const newDay2Gid = edit?.moveToGidDay2 !== undefined ? edit.moveToGidDay2 : currentDay2Gid;
		const day1MoveNeeded = currentDay1Gid !== null && newDay1Gid !== null && newDay1Gid !== currentDay1Gid;
		const day2MoveNeeded = currentDay2Gid !== null && newDay2Gid !== null && newDay2Gid !== currentDay2Gid;
		const nameChanged = nextName.trim().toLowerCase() !== player.trim().toLowerCase();

		setSavingPlayerKey(key);
		setError(null);
		try {
			// Handle day 1 group move
			if (day1MoveNeeded && currentDay1Gid && newDay1Gid) {
				await runTransaction(db, async (tx) => {
					const fromRef = doc(db, "groups", currentDay1Gid);
					const toRef = doc(db, "groups", newDay1Gid);
					const fromSnap = await tx.get(fromRef);
					const toSnap = await tx.get(toRef);
					if (!fromSnap.exists()) throw new Error("Source group not found");
					if (!toSnap.exists()) throw new Error("Target group not found");
					const from = fromSnap.data() as GroupDoc;
					const to = toSnap.data() as GroupDoc;
					const fromLegacy = (from.playerNames ?? []).filter(Boolean);
					const toLegacy = (to.playerNames ?? []).filter(Boolean);
					const fromDay1 = ((from.playerNamesByDay?.day1 ?? fromLegacy) as string[]).filter(Boolean);
					const fromDay2 = ((from.playerNamesByDay?.day2 ?? fromLegacy) as string[]).filter(Boolean);
					const toDay1 = ((to.playerNamesByDay?.day1 ?? toLegacy) as string[]).filter(Boolean);
					const toDay2 = ((to.playerNamesByDay?.day2 ?? toLegacy) as string[]).filter(Boolean);
					const fromKey = findPlayerKey(fromDay1, player);
					if (!fromKey) return;
					const loweredFrom = fromKey.toLowerCase();
					const toKey = nextName;
					if (!toKey.trim()) throw new Error("Player name is required.");
					const toExisting = toDay1.find((p) => p.toLowerCase() === toKey.trim().toLowerCase()) ?? null;
					if (toExisting) throw new Error(`Player already exists in Day 1 target foursome (${toExisting}).`);
					const nextFromDay1 = fromDay1.filter((p) => p.toLowerCase() !== loweredFrom);
					const nextToDay1 = [...toDay1, toKey];
					const nextFromPlayers = uniqPreserveOrder([...nextFromDay1, ...fromDay2]);
					const nextToPlayers = uniqPreserveOrder([...nextToDay1, ...toDay2]);
					const stillInFrom = nextFromPlayers.some((p) => p.toLowerCase() === loweredFrom);
					const nextFromHandicaps = { ...(from.handicaps ?? {}) } as Record<string, number | null>;
					const nextFromDay2Adj = { ...(from.day2HandicapAdjustments ?? {}) } as Record<string, number | null>;
					const nextFromCharity = { ...(from.charityStrokes ?? {}) } as Record<string, number | null>;
					const nextFromTree = { ...(from.treeStrokes ?? {}) } as Record<string, number | null>;
					if (!stillInFrom) { delete nextFromHandicaps[fromKey]; delete nextFromDay2Adj[fromKey]; delete nextFromCharity[fromKey]; delete nextFromTree[fromKey]; }
					const nextFromTeeChoices = {
						day1: { ...(from.teeChoices?.day1 ?? {}) } as Record<string, TeeKey | null>,
						day2: { ...(from.teeChoices?.day2 ?? {}) } as Record<string, TeeKey | null>,
					};
					delete nextFromTeeChoices.day1[fromKey];
					if (!stillInFrom) delete nextFromTeeChoices.day2[fromKey];
					const fromBeforePlayers = uniqPreserveOrder([...fromDay1, ...fromDay2]);
					const toBeforePlayers = uniqPreserveOrder([...toDay1, ...toDay2]);
					const fromScoresByDay = coerceScoresByDay(fromBeforePlayers, from.scores);
					const toScoresByDay = coerceScoresByDay(toBeforePlayers, to.scores);
					const movedScores = fromScoresByDay.day1[fromKey] ?? Array.from({ length: HOLE_COUNT }, () => null);
					delete fromScoresByDay.day1[fromKey];
					toScoresByDay.day1[toKey] = movedScores;
					const nextFromScoresByDay = coerceScoresByDay(nextFromPlayers, fromScoresByDay as any);
					const nextToScoresByDay = coerceScoresByDay(nextToPlayers, toScoresByDay as any);
					tx.update(fromRef, { playerNames: nextFromPlayers, playerNamesByDay: { day1: nextFromDay1, day2: fromDay2 }, handicaps: nextFromHandicaps, day2HandicapAdjustments: nextFromDay2Adj, charityStrokes: nextFromCharity, treeStrokes: nextFromTree, teeChoices: nextFromTeeChoices, scores: nextFromScoresByDay, updatedAt: serverTimestamp() });
					tx.update(toRef, { playerNames: nextToPlayers, playerNamesByDay: { day1: nextToDay1, day2: toDay2 }, handicaps: { ...(to.handicaps ?? {}), [toKey]: safeHandicap }, day2HandicapAdjustments: { ...(to.day2HandicapAdjustments ?? {}), [toKey]: safeDay2Adj }, charityStrokes: { ...(to.charityStrokes ?? {}), [toKey]: safeCharity }, treeStrokes: { ...(to.treeStrokes ?? {}), [toKey]: safeTree }, teeChoices: { day1: { ...(to.teeChoices?.day1 ?? {}), [toKey]: teeDay1 }, day2: { ...(to.teeChoices?.day2 ?? {}) } }, scores: nextToScoresByDay, updatedAt: serverTimestamp() });
				});
			}

			// Handle day 2 group move
			if (day2MoveNeeded && currentDay2Gid && newDay2Gid) {
				await runTransaction(db, async (tx) => {
					const fromRef = doc(db, "groups", currentDay2Gid);
					const toRef = doc(db, "groups", newDay2Gid);
					const fromSnap = await tx.get(fromRef);
					const toSnap = await tx.get(toRef);
					if (!fromSnap.exists()) throw new Error("Source group not found");
					if (!toSnap.exists()) throw new Error("Target group not found");
					const from = fromSnap.data() as GroupDoc;
					const to = toSnap.data() as GroupDoc;
					const fromLegacy = (from.playerNames ?? []).filter(Boolean);
					const toLegacy = (to.playerNames ?? []).filter(Boolean);
					const fromDay1 = ((from.playerNamesByDay?.day1 ?? fromLegacy) as string[]).filter(Boolean);
					const fromDay2 = ((from.playerNamesByDay?.day2 ?? fromLegacy) as string[]).filter(Boolean);
					const toDay1 = ((to.playerNamesByDay?.day1 ?? toLegacy) as string[]).filter(Boolean);
					const toDay2 = ((to.playerNamesByDay?.day2 ?? toLegacy) as string[]).filter(Boolean);
					const fromKey = findPlayerKey(fromDay2, player);
					if (!fromKey) return;
					const loweredFrom = fromKey.toLowerCase();
					const toKey = nextName;
					if (!toKey.trim()) throw new Error("Player name is required.");
					const toExisting = toDay2.find((p) => p.toLowerCase() === toKey.trim().toLowerCase()) ?? null;
					if (toExisting) throw new Error(`Player already exists in Day 2 target foursome (${toExisting}).`);
					const nextFromDay2 = fromDay2.filter((p) => p.toLowerCase() !== loweredFrom);
					const nextToDay2 = [...toDay2, toKey];
					const nextFromPlayers = uniqPreserveOrder([...fromDay1, ...nextFromDay2]);
					const nextToPlayers = uniqPreserveOrder([...toDay1, ...nextToDay2]);
					const stillInFrom = nextFromPlayers.some((p) => p.toLowerCase() === loweredFrom);
					const nextFromHandicaps = { ...(from.handicaps ?? {}) } as Record<string, number | null>;
					const nextFromDay2Adj = { ...(from.day2HandicapAdjustments ?? {}) } as Record<string, number | null>;
					const nextFromCharity = { ...(from.charityStrokes ?? {}) } as Record<string, number | null>;
					const nextFromTree = { ...(from.treeStrokes ?? {}) } as Record<string, number | null>;
					if (!stillInFrom) { delete nextFromHandicaps[fromKey]; delete nextFromDay2Adj[fromKey]; delete nextFromCharity[fromKey]; delete nextFromTree[fromKey]; }
					const nextFromTeeChoices = {
						day1: { ...(from.teeChoices?.day1 ?? {}) } as Record<string, TeeKey | null>,
						day2: { ...(from.teeChoices?.day2 ?? {}) } as Record<string, TeeKey | null>,
					};
					delete nextFromTeeChoices.day2[fromKey];
					if (!stillInFrom) delete nextFromTeeChoices.day1[fromKey];
					const fromBeforePlayers = uniqPreserveOrder([...fromDay1, ...fromDay2]);
					const toBeforePlayers = uniqPreserveOrder([...toDay1, ...toDay2]);
					const fromScoresByDay = coerceScoresByDay(fromBeforePlayers, from.scores);
					const toScoresByDay = coerceScoresByDay(toBeforePlayers, to.scores);
					const movedScores = fromScoresByDay.day2[fromKey] ?? Array.from({ length: HOLE_COUNT }, () => null);
					delete fromScoresByDay.day2[fromKey];
					toScoresByDay.day2[toKey] = movedScores;
					const nextFromScoresByDay = coerceScoresByDay(nextFromPlayers, fromScoresByDay as any);
					const nextToScoresByDay = coerceScoresByDay(nextToPlayers, toScoresByDay as any);
					tx.update(fromRef, { playerNames: nextFromPlayers, playerNamesByDay: { day1: fromDay1, day2: nextFromDay2 }, handicaps: nextFromHandicaps, day2HandicapAdjustments: nextFromDay2Adj, charityStrokes: nextFromCharity, treeStrokes: nextFromTree, teeChoices: nextFromTeeChoices, scores: nextFromScoresByDay, updatedAt: serverTimestamp() });
					tx.update(toRef, { playerNames: nextToPlayers, playerNamesByDay: { day1: toDay1, day2: nextToDay2 }, handicaps: { ...(to.handicaps ?? {}), [toKey]: safeHandicap }, day2HandicapAdjustments: { ...(to.day2HandicapAdjustments ?? {}), [toKey]: safeDay2Adj }, charityStrokes: { ...(to.charityStrokes ?? {}), [toKey]: safeCharity }, treeStrokes: { ...(to.treeStrokes ?? {}), [toKey]: safeTree }, teeChoices: { day1: { ...(to.teeChoices?.day1 ?? {}) }, day2: { ...(to.teeChoices?.day2 ?? {}), [toKey]: teeDay2 } }, scores: nextToScoresByDay, updatedAt: serverTimestamp() });
				});
			}

			// Handle rename (no group moves)
			if (nameChanged && !day1MoveNeeded && !day2MoveNeeded) {
				const groupsWithPlayer = allGroups.filter((g) => {
					const legacy = (g.data.playerNames ?? []).filter(Boolean);
					const d1 = ((g.data.playerNamesByDay?.day1 ?? legacy) as string[]).filter(Boolean);
					const d2 = ((g.data.playerNamesByDay?.day2 ?? legacy) as string[]).filter(Boolean);
					return [...d1, ...d2].some((p) => p.toLowerCase() === player.toLowerCase());
				});
				for (const groupRow of groupsWithPlayer) {
					await runTransaction(db, async (tx) => {
						const ref = doc(db, "groups", groupRow.id);
						const snap = await tx.get(ref);
						if (!snap.exists()) return;
						const cur = snap.data() as GroupDoc;
						const legacy = (cur.playerNames ?? []).filter(Boolean);
						const curDay1 = ((cur.playerNamesByDay?.day1 ?? legacy) as string[]).filter(Boolean);
						const curDay2 = ((cur.playerNamesByDay?.day2 ?? legacy) as string[]).filter(Boolean);
						const curPlayers = uniqPreserveOrder([...curDay1, ...curDay2]);
						const curKey = findPlayerKey(curPlayers, player);
						if (!curKey) return;
						const nextKey = nextName.trim();
						if (!nextKey) throw new Error("Player name is required.");
						const exists = curPlayers.find((p) => p.toLowerCase() === nextKey.toLowerCase() && p.toLowerCase() !== curKey.toLowerCase());
						if (exists) throw new Error(`Player already exists (${exists}).`);
						const nextPlayers = curPlayers.map((p) => (p.toLowerCase() === curKey.toLowerCase() ? nextKey : p));
						const nextDay1 = curDay1.map((p) => (p.toLowerCase() === curKey.toLowerCase() ? nextKey : p));
						const nextDay2 = curDay2.map((p) => (p.toLowerCase() === curKey.toLowerCase() ? nextKey : p));
						const curScoresByDay = coerceScoresByDay(curPlayers, cur.scores);
						const movedDay1 = curScoresByDay.day1[curKey] ?? Array.from({ length: HOLE_COUNT }, () => null);
						const movedDay2 = curScoresByDay.day2[curKey] ?? Array.from({ length: HOLE_COUNT }, () => null);
						const nextScoresByDay = coerceScoresByDay(nextPlayers, cur.scores);
						nextScoresByDay.day1[nextKey] = movedDay1;
						nextScoresByDay.day2[nextKey] = movedDay2;
						delete nextScoresByDay.day1[curKey];
						delete nextScoresByDay.day2[curKey];
						const nextHandicaps = { ...(cur.handicaps ?? {}), [nextKey]: safeHandicap } as Record<string, number | null>;
						delete nextHandicaps[curKey];
						const nextDay2Adj = { ...(cur.day2HandicapAdjustments ?? {}), [nextKey]: safeDay2Adj } as Record<string, number | null>;
						delete nextDay2Adj[curKey];
						const nextCharity = { ...(cur.charityStrokes ?? {}), [nextKey]: safeCharity } as Record<string, number | null>;
						delete nextCharity[curKey];
						const nextTree = { ...(cur.treeStrokes ?? {}), [nextKey]: safeTree } as Record<string, number | null>;
						delete nextTree[curKey];
						const nextTeeChoices = {
							day1: { ...(cur.teeChoices?.day1 ?? {}), [nextKey]: teeDay1 } as Record<string, TeeKey | null>,
							day2: { ...(cur.teeChoices?.day2 ?? {}), [nextKey]: teeDay2 } as Record<string, TeeKey | null>,
						};
						delete nextTeeChoices.day1[curKey];
						delete nextTeeChoices.day2[curKey];
						tx.update(ref, { playerNames: nextPlayers, playerNamesByDay: { day1: nextDay1, day2: nextDay2 }, handicaps: nextHandicaps, day2HandicapAdjustments: nextDay2Adj, charityStrokes: nextCharity, treeStrokes: nextTree, teeChoices: nextTeeChoices, scores: nextScoresByDay, updatedAt: serverTimestamp() });
					});
				}
			}

			// Handle data-only updates
			if (!day1MoveNeeded && !day2MoveNeeded && !nameChanged) {
				const lowered = player.trim().toLowerCase();
				const groupsToUpdate = allGroups.filter((g) => {
					const legacy = (g.data.playerNames ?? []).filter(Boolean);
					const d1 = ((g.data.playerNamesByDay?.day1 ?? legacy) as string[]).filter(Boolean);
					const d2 = ((g.data.playerNamesByDay?.day2 ?? legacy) as string[]).filter(Boolean);
					return [...d1, ...d2].some((p) => p.toLowerCase() === lowered);
				});
				const targets = groupsToUpdate.length ? groupsToUpdate.map((g) => g.id) : [primaryGid];
				await runTransaction(db, async (tx) => {
					for (const targetGid of targets) {
						const ref = doc(db, "groups", targetGid);
						const snap = await tx.get(ref);
						if (!snap.exists()) continue;
						const cur = snap.data() as GroupDoc;
						tx.update(ref, {
							handicaps: { ...(cur.handicaps ?? {}), [player]: safeHandicap },
							day2HandicapAdjustments: { ...(cur.day2HandicapAdjustments ?? {}), [player]: safeDay2Adj },
							charityStrokes: { ...(cur.charityStrokes ?? {}), [player]: safeCharity },
							treeStrokes: { ...(cur.treeStrokes ?? {}), [player]: safeTree },
							teeChoices: { day1: { ...(cur.teeChoices?.day1 ?? {}), [player]: teeDay1 }, day2: { ...(cur.teeChoices?.day2 ?? {}), [player]: teeDay2 } },
							updatedAt: serverTimestamp(),
						});
					}
				});
			}

			setPlayerEdits((prev) => {
				const { [key]: _, ...rest } = prev;
				return rest;
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			setError(`Could not save player: ${message}`);
		} finally {
			setSavingPlayerKey(null);
		}
	}

	async function addPlayerToFoursome() {
		if (!isAdmin) {
			setError("Admin access required.");
			return;
		}
		setAddPlayerError(null);
		const name = addPlayerName.trim();
		if (!name) {
			setAddPlayerError("Enter a player name.");
			return;
		}
		const gid = groupId;
		const handicapNum = Math.floor(Number(addPlayerHandicap || 0));
		const safeHandicap = Number.isFinite(handicapNum) ? handicapNum : 0;

		setAddingPlayer(true);
		try {
			await runTransaction(db, async (tx) => {
				const ref = doc(db, "groups", gid);
				const snap = await tx.get(ref);
				if (!snap.exists()) throw new Error("Group not found");
				const cur = snap.data() as GroupDoc;
				const legacy = (cur.playerNames ?? []).filter(Boolean);
				const curDay1 = ((cur.playerNamesByDay?.day1 ?? legacy) as string[]).filter(Boolean);
				const curDay2 = ((cur.playerNamesByDay?.day2 ?? legacy) as string[]).filter(Boolean);
				const curPlayers = uniqPreserveOrder([...curDay1, ...curDay2]);
				const exists = curPlayers.find((p) => p.toLowerCase() === name.toLowerCase());
				if (exists) throw new Error(`Player already exists (${exists}).`);
				const nextDay1 = uniqPreserveOrder([...curDay1, name]);
				const nextDay2 = uniqPreserveOrder([...curDay2, name]);
				const nextPlayers = uniqPreserveOrder([...nextDay1, ...nextDay2]);
				const nextScoresByDay = coerceScoresByDay(nextPlayers, cur.scores);
				tx.update(ref, {
					playerNames: nextPlayers,
					playerNamesByDay: { day1: nextDay1, day2: nextDay2 },
					handicaps: { ...(cur.handicaps ?? {}), [name]: safeHandicap },
					day2HandicapAdjustments: { ...(cur.day2HandicapAdjustments ?? {}), [name]: 0 },
					charityStrokes: { ...(cur.charityStrokes ?? {}), [name]: 0 },
					treeStrokes: { ...(cur.treeStrokes ?? {}), [name]: 0 },
					teeChoices: { day1: { ...(cur.teeChoices?.day1 ?? {}), [name]: "combo" as TeeKey }, day2: { ...(cur.teeChoices?.day2 ?? {}), [name]: "stampede" as TeeKey } },
					scores: nextScoresByDay,
					updatedAt: serverTimestamp(),
				});
			});
			setAddPlayerName("");
			setAddPlayerHandicap("0");
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			setAddPlayerError(message);
		} finally {
			setAddingPlayer(false);
		}
	}

	async function createFoursome() {
		if (!isAdmin) { setCreateFoursomeError("Admin access required."); return; }
		setCreateFoursomeError(null);
		setCreatedFoursomeId(null);
		const n = Math.floor(Number(newFoursomeNumber.trim() || 0));
		if (!Number.isFinite(n) || n <= 0) {
			setCreateFoursomeError("Enter a valid foursome number (e.g. 4).");
			return;
		}
		const alreadyExists = foursomeOptions.some((o) => o.n === n);
		if (alreadyExists) {
			setCreateFoursomeError(`Foursome ${n} already exists.`);
			return;
		}
		setCreatingFoursome(true);
		try {
			const tournament = group?.tournament ?? {};
			const ref = await addDoc(collection(db, "groups"), {
				groupName: `Foursome ${n}`,
				playerNames: [],
				playerNamesByDay: { day1: [], day2: [] },
				day1ScoresLocked: false,
				scores: { day1: {}, day2: {} },
				handicaps: {},
				day2HandicapAdjustments: {},
				teeChoices: { day1: {}, day2: {} },
				charityStrokes: {},
				treeStrokes: {},
				tournament: { ...tournament },
				createdAt: serverTimestamp(),
				updatedAt: serverTimestamp(),
			});
			setCreatedFoursomeId(ref.id);
			setNewFoursomeNumber("");
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			setCreateFoursomeError(`Could not create foursome: ${message}`);
		} finally {
			setCreatingFoursome(false);
		}
	}

	async function saveScorecards() {
		if (!isAdmin) {
			setError("Admin access required.");
			return;
		}
		setScorecardError(null);
		const hasParsDraft = !!day1ParsDraft.trim() || !!day2ParsDraft.trim();
		const hasHcpsDraft = !!day1HcpsDraft.trim() || !!day2HcpsDraft.trim();
		if (!hasParsDraft && !hasHcpsDraft) {
			setScorecardError("Enter pars and/or HCP (stroke index) values to save.");
			return;
		}

		const day1 = day1ParsDraft.trim() ? parseParsDraft(day1ParsDraft) : null;
		const day2 = day2ParsDraft.trim() ? parseParsDraft(day2ParsDraft) : null;
		const h1 = day1HcpsDraft.trim() ? parseHcpsDraft(day1HcpsDraft) : null;
		const h2 = day2HcpsDraft.trim() ? parseHcpsDraft(day2HcpsDraft) : null;

		if (hasParsDraft && (!day1 || !day2)) {
			setScorecardError(`Enter ${HOLE_COUNT} pars per day (comma-separated). Allowed: 3-6.`);
			return;
		}
		if (hasHcpsDraft && (!h1 || !h2)) {
			setScorecardError(`Enter ${HOLE_COUNT} HCP values per day (1-18 each, no repeats).`);
			return;
		}

		try {
			const tournament = group?.tournament ?? {};
			await updateDoc(doc(db, "groups", groupId), {
				tournament: {
					...tournament,
					...(day1 ? { day1Pars: day1 } : {}),
					...(day2 ? { day2Pars: day2 } : {}),
					...(h1 ? { day1Hcps: h1 } : {}),
					...(h2 ? { day2Hcps: h2 } : {}),
				},
				updatedAt: serverTimestamp(),
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			setScorecardError(`Could not save scorecards: ${message}`);
		}
	}

	async function adminLogin() {
		setAdminError(null);
		try {
			await signInWithEmailAndPassword(auth, adminEmail.trim(), adminPassword);
			setAdminPassword("");
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			setAdminError(`Admin login failed: ${message}`);
		}
	}

	async function adminLogout() {
		setAdminError(null);
		try {
			await signOut(auth);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			setAdminError(`Could not sign out: ${message}`);
		}
	}

	async function setDay1ScoresLocked(nextLocked: boolean) {
		if (!isAdmin) {
			setError("Admin access required.");
			return;
		}
		if (!groupId) return;
		setDay1LockSaving(true);
		setDay1LockError(null);
		try {
			await updateDoc(doc(db, "groups", groupId), {
				day1ScoresLocked: nextLocked,
				updatedAt: serverTimestamp(),
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			setDay1LockError(message);
		} finally {
			setDay1LockSaving(false);
		}
	}


	if (loading) return <main className="min-h-screen bg-sky-50 text-slate-900 p-6">Loading…</main>;
	if (error) return <main className="min-h-screen bg-sky-50 text-slate-900 p-6">{error}</main>;
	if (!group) return <main className="min-h-screen bg-sky-50 text-slate-900 p-6">Missing group.</main>;

	return (
		<main className="min-h-screen bg-sky-50 text-slate-900 p-6">
			<div className="max-w-5xl mx-auto">
				<div className="flex items-start justify-between gap-4">
					<div>
						<h1 className="text-2xl font-bold">{title} · Admin</h1>
						<p className="text-slate-600 mt-1">{saving ? "Saving…" : "Saved"}</p>
					</div>
					<div className="flex flex-wrap gap-2 justify-end">
						<button
							onClick={() => router.push("/")}
							className="bg-white hover:bg-sky-50 border border-sky-200 px-4 py-2 rounded-lg text-sm"
						>
							Back to home
						</button>
						<button
							onClick={() => router.push(`/group/${groupId}`)}
							className="bg-white hover:bg-sky-50 border border-sky-200 px-4 py-2 rounded-lg text-sm"
						>
							Back to scoring
						</button>
					</div>
				</div>

				<div className="mt-6 bg-white/80 border border-sky-200 rounded-2xl p-5">
					<div className="flex items-center justify-between gap-3 flex-wrap">
						<h2 className="text-lg font-semibold">Admin login</h2>
						{isAdmin ? (
							<p className="text-sm text-slate-700">Signed in: {adminUser?.email ?? "(unknown)"}</p>
						) : isSignedIn ? (
							<p className="text-sm text-amber-700">Signed in but not authorized</p>
						) : (
							<p className="text-sm text-slate-600">Sign in to edit players/handicaps/scores</p>
						)}
					</div>

					{isSignedIn ? (
						<button
							onClick={adminLogout}
							className="mt-3 bg-white hover:bg-sky-50 border border-sky-200 px-4 py-2 rounded-lg text-sm"
						>
							Sign out
						</button>
					) : (
						<div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
							<input
								value={adminEmail}
								onChange={(e) => setAdminEmail(e.target.value)}
								className="p-2 bg-white border border-sky-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-200"
								placeholder="Admin email"
								autoComplete="username"
							/>
							<input
								value={adminPassword}
								onChange={(e) => setAdminPassword(e.target.value)}
								type="password"
								className="p-2 bg-white border border-sky-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-200"
								placeholder="Password"
								autoComplete="current-password"
							/>
							<button
								onClick={adminLogin}
								className="bg-sky-600 hover:bg-sky-500 px-4 py-2 rounded-lg font-semibold text-white"
							>
								Sign in
							</button>
						</div>
					)}

					{adminError ? <p className="text-sm text-red-600 mt-3">{adminError}</p> : null}
				</div>

				{isAdmin ? (
					<>
						<div className="mt-6 bg-white/80 border border-sky-200 rounded-2xl p-5">
							<div className="flex items-center justify-between gap-3 flex-wrap">
								<h2 className="text-lg font-semibold">Scoring lock</h2>
								<p className="text-sm text-slate-600">Current group: {title}</p>
							</div>
							<p className="text-slate-600 text-sm mt-1">Lock Day 1 to prevent edits while you adjust Day 2 handicaps.</p>
							<div className="mt-3 flex items-center gap-3 flex-wrap">
								<button
									onClick={() => setDay1ScoresLocked(!group.day1ScoresLocked)}
									disabled={day1LockSaving}
									className={`${
										group.day1ScoresLocked
											? "bg-white hover:bg-sky-50 border border-sky-200"
											: "bg-sky-600 hover:bg-sky-500 text-white"
									} disabled:opacity-60 px-4 py-2 rounded-lg font-semibold`}
								>
									{day1LockSaving ? "Saving…" : group.day1ScoresLocked ? "Unlock Day 1" : "Lock Day 1"}
								</button>
								<p className="text-sm text-slate-700">Status: {group.day1ScoresLocked ? "Locked" : "Unlocked"}</p>
							</div>
							{day1LockError ? <p className="text-sm text-red-600 mt-2">{day1LockError}</p> : null}
						</div>

						<div className="mt-6 bg-white/80 border border-sky-200 rounded-2xl p-5">
							<div className="flex items-center justify-between gap-3 flex-wrap">
								<h2 className="text-lg font-semibold">All players (all foursomes)</h2>
								{allGroupsLoading ? (
									<p className="text-sm text-slate-600">Loading…</p>
								) : (
									<p className="text-sm text-slate-600">{allGroups.length} groups · {allPlayersRoster.length} players</p>
								)}
							</div>
							<p className="text-slate-600 text-sm mt-1">Edit handicaps/tees/charity here. Assign day 1 and day 2 foursomes per player using the dropdowns.</p>
							{allGroupsError ? <p className="text-sm text-red-600 mt-2">{allGroupsError}</p> : null}

							<div className="mt-3 overflow-x-auto">
								<table className="w-full min-w-[1180px] text-sm">
									<thead>
										<tr className="text-left text-slate-700">
											<th className="p-2 min-w-[220px]">Player</th>
											<th className="p-2 min-w-[80px]">D1 Group</th>
											<th className="p-2 min-w-[80px]">D2 Group</th>
											<th className="p-2">D1 HCP</th>
											<th className="p-2">D2 HCP</th>
											<th className="p-2">Day 1 tee</th>
											<th className="p-2">Day 2 tee</th>
											<th className="p-2">Char</th>
											<th className="p-2">Tree</th>
											<th className="p-2"></th>
										</tr>
									</thead>
									<tbody>
										{allPlayersRoster.map(({ player, day1Gid, day2Gid, primaryGroup: g }) => {
												const key = editKey(player);
												const edit = playerEdits[key];
												const handicap = edit?.handicap ?? String(g.data.handicaps?.[player] ?? 0);
												const day2Adj = edit?.day2Adj ?? String(g.data.day2HandicapAdjustments?.[player] ?? 0);
												const charity = edit?.charity ?? String(g.data.charityStrokes?.[player] ?? 0);
												const tree = edit?.tree ?? String(g.data.treeStrokes?.[player] ?? 0);
												const teeDay1 = edit?.teeDay1 ?? ((g.data.teeChoices?.day1?.[player] as TeeKey | null | undefined) ?? "combo");
												const teeDay2 = edit?.teeDay2 ?? ((g.data.teeChoices?.day2?.[player] as TeeKey | null | undefined) ?? "stampede");
												const selectedDay1Gid = edit?.moveToGidDay1 !== undefined ? edit.moveToGidDay1 : (day1Gid ?? "");
												const selectedDay2Gid = edit?.moveToGidDay2 !== undefined ? edit.moveToGidDay2 : (day2Gid ?? "");
												const isRowSaving = savingPlayerKey === key;
												return (
													<tr key={key} className="border-t border-sky-100">
													<td className="p-2 min-w-[220px]">
														<input
															value={edit?.name ?? player}
															onChange={(e) =>
																setPlayerEdits((prev) => ({
																	...prev,
																	[key]: { ...(prev[key] ?? {}), name: e.target.value },
																}))
															}
																className="w-[20ch] max-w-[20ch] p-2 bg-white border border-sky-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-200"
															placeholder="Player"
														/>
													</td>
													<td className="p-2">
														<select
															value={selectedDay1Gid}
															onChange={(e) =>
																setPlayerEdits((prev) => ({
																	...prev,
																	[key]: { ...(prev[key] ?? {}), moveToGidDay1: e.target.value },
																}))
															}
															className="w-16 p-2 bg-white border border-sky-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-200"
														>
															<option value="">—</option>
															{foursomeOptions.map((opt) => (
																<option key={opt.gid} value={opt.gid}>{opt.n}</option>
															))}
														</select>
													</td>
													<td className="p-2">
														<select
															value={selectedDay2Gid}
															onChange={(e) =>
																setPlayerEdits((prev) => ({
																	...prev,
																	[key]: { ...(prev[key] ?? {}), moveToGidDay2: e.target.value },
																}))
															}
															className="w-16 p-2 bg-white border border-sky-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-200"
														>
															<option value="">—</option>
															{foursomeOptions.map((opt) => (
																<option key={opt.gid} value={opt.gid}>{opt.n}</option>
															))}
														</select>
													</td>
													<td className="p-2">
														<input
															value={handicap}
															onChange={(e) =>
																setPlayerEdits((prev) => ({
																	...prev,
																	[key]: { ...(prev[key] ?? {}), handicap: e.target.value },
																}))
														}
															inputMode="numeric"
																className="w-16 p-2 bg-white border border-sky-200 rounded-lg text-center focus:outline-none focus:ring-2 focus:ring-sky-200"
														/>
													</td>
													<td className="p-2">
														<input
															value={day2Adj}
															onChange={(e) =>
																setPlayerEdits((prev) => ({
																	...prev,
																	[key]: { ...(prev[key] ?? {}), day2Adj: e.target.value },
																}))
														}
															inputMode="numeric"
																className="w-16 p-2 bg-white border border-sky-200 rounded-lg text-center focus:outline-none focus:ring-2 focus:ring-sky-200"
														/>
													</td>
													<td className="p-2">
														<select
															value={teeDay1}
															onChange={(e) =>
																setPlayerEdits((prev) => ({
																	...prev,
																	[key]: { ...(prev[key] ?? {}), teeDay1: e.target.value as TeeKey },
																}))
														}
																className="p-2 bg-white border border-sky-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-200"
														>
																			<option value="combo">2 Trees</option>
															<option value="three">3 Trees (+1)</option>
															<option value="four">4 Trees (+2)</option>
														</select>
													</td>
													<td className="p-2">
														<select
															value={teeDay2}
															onChange={(e) =>
																setPlayerEdits((prev) => ({
																	...prev,
																	[key]: { ...(prev[key] ?? {}), teeDay2: e.target.value as TeeKey },
																}))
														}
																className="p-2 bg-white border border-sky-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-200"
														>
															<option value="stampede">Stampede</option>
															<option value="tips">Tips</option>
														</select>
													</td>
													<td className="p-2">
														<input
															value={charity}
															onChange={(e) =>
																setPlayerEdits((prev) => ({
																	...prev,
																	[key]: { ...(prev[key] ?? {}), charity: e.target.value },
																}))
														}
															inputMode="numeric"
																className="w-16 p-2 bg-white border border-sky-200 rounded-lg text-center focus:outline-none focus:ring-2 focus:ring-sky-200"
														/>
													</td>
																<td className="p-2">
																	<input
																	value={tree}
																	onChange={(e) =>
																	setPlayerEdits((prev) => ({
																		...prev,
																		[key]: { ...(prev[key] ?? {}), tree: e.target.value },
																	}))
																}
																	inputMode="numeric"
																		className="w-16 p-2 bg-white border border-sky-200 rounded-lg text-center focus:outline-none focus:ring-2 focus:ring-sky-200"
																	/>
																	</td>
													<td className="p-2 whitespace-nowrap">
														<div className="flex gap-2">
															<button
																onClick={() => router.push(`/group/${g.id}/admin`)}
																	className="bg-white hover:bg-sky-50 border border-sky-200 px-3 py-2 rounded-lg text-sm"
															>
																Open
															</button>
															<button
																onClick={() => deletePlayerGlobally(player, day1Gid, day2Gid)}
																	className="bg-white hover:bg-sky-50 border border-sky-200 px-3 py-2 rounded-lg text-sm"
															>
																Delete
															</button>
															<button
																onClick={() => savePlayerEdits({ player, currentDay1Gid: day1Gid, currentDay2Gid: day2Gid })}
																disabled={isRowSaving}
																	className="bg-sky-600 hover:bg-sky-500 disabled:opacity-60 px-3 py-2 rounded-lg font-semibold text-white"
															>
																{isRowSaving ? "Saving…" : "Save"}
															</button>
														</div>
													</td>
												</tr>
												);
											})
											}
									</tbody>
									</table>
							</div>

							<div className="mt-4 border-t border-sky-200 pt-4">
								<h3 className="text-sm font-semibold text-slate-900">Add player</h3>
								<p className="text-xs text-slate-600 mt-1">Player is added to the current foursome. Assign Day 1 / Day 2 groups above after adding.</p>
								<div className="mt-3 flex flex-wrap gap-2 items-center">
									<input
										value={addPlayerName}
										onChange={(e) => setAddPlayerName(e.target.value)}
										className="p-2 bg-white border border-sky-200 rounded-lg w-48 focus:outline-none focus:ring-2 focus:ring-sky-200"
										placeholder="Player name"
									/>
									<input
										value={addPlayerHandicap}
										onChange={(e) => setAddPlayerHandicap(e.target.value)}
										inputMode="numeric"
										className="p-2 bg-white border border-sky-200 rounded-lg w-24 focus:outline-none focus:ring-2 focus:ring-sky-200"
										placeholder="Handicap"
									/>
									<button
										onClick={addPlayerToFoursome}
										disabled={addingPlayer}
										className="bg-sky-600 hover:bg-sky-500 disabled:opacity-60 px-4 py-2 rounded-lg font-semibold text-white"
									>
										{addingPlayer ? "Adding…" : "Add player"}
									</button>
									{addPlayerError ? <p className="text-sm text-red-600">{addPlayerError}</p> : null}
								</div>
							</div>
						</div>

						<div className="mt-6 bg-white/80 border border-sky-200 rounded-2xl p-5">
							<h2 className="text-lg font-semibold">Create new foursome</h2>
							<p className="text-slate-600 text-sm mt-1">Creates an empty foursome. Add players to it via the All Players table above.</p>
							<div className="mt-3 flex flex-wrap gap-2 items-center">
								<input
									value={newFoursomeNumber}
									onChange={(e) => setNewFoursomeNumber(e.target.value)}
									inputMode="numeric"
									className="p-2 bg-white border border-sky-200 rounded-lg w-32 focus:outline-none focus:ring-2 focus:ring-sky-200"
									placeholder="Foursome #"
								/>
								<button
									onClick={createFoursome}
									disabled={creatingFoursome}
									className="bg-sky-600 hover:bg-sky-500 disabled:opacity-60 px-4 py-2 rounded-lg font-semibold text-white"
								>
									{creatingFoursome ? "Creating…" : "Create foursome"}
								</button>
								{createFoursomeError ? <p className="text-sm text-red-600">{createFoursomeError}</p> : null}
								{createdFoursomeId ? <p className="text-sm text-emerald-700">Created! It now appears in the group dropdowns.</p> : null}
							</div>
						</div>

							<div className="mt-6 bg-white/80 border border-sky-200 rounded-2xl p-5">
							<h2 className="text-lg font-semibold">Course scorecards (Pars)</h2>
								<p className="text-slate-600 text-sm mt-1">Enter 18 numbers per day (comma separated). Used to track Closest-to-Pin on every Par 3.</p>
							<div className="mt-3 grid grid-cols-1 gap-3">
								<div>
										<p className="text-sm text-slate-700">Day 1 pars</p>
									<input
										value={day1ParsDraft}
										onChange={(e) => setDay1ParsDraft(e.target.value)}
											className="mt-1 w-full p-2 bg-white border border-sky-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-200"
										placeholder="4,5,3,4,4,5,3,4,4,4,5,3,4,4,5,3,4,4"
									/>
								</div>
								<div>
										<p className="text-sm text-slate-700">Day 2 pars</p>
									<input
										value={day2ParsDraft}
										onChange={(e) => setDay2ParsDraft(e.target.value)}
											className="mt-1 w-full p-2 bg-white border border-sky-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-200"
										placeholder="4,4,3,5,4,4,3,4,5,4,4,3,5,4,4,3,4,5"
									/>
								</div>
								<div>
										<p className="text-sm text-slate-700">Day 1 HCP (stroke index)</p>
									<input
										value={day1HcpsDraft}
										onChange={(e) => setDay1HcpsDraft(e.target.value)}
											className="mt-1 w-full p-2 bg-white border border-sky-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-200"
										placeholder="7,1,13,11,5,3,15,17,9,2,16,6,8,4,12,18,14,10"
									/>
								</div>
								<div>
										<p className="text-sm text-slate-700">Day 2 HCP (stroke index)</p>
									<input
										value={day2HcpsDraft}
										onChange={(e) => setDay2HcpsDraft(e.target.value)}
											className="mt-1 w-full p-2 bg-white border border-sky-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-200"
										placeholder="7,1,13,11,5,3,15,17,9,2,16,6,8,4,12,18,14,10"
									/>
								</div>
							</div>
							<button
								onClick={saveScorecards}
									className="mt-3 bg-sky-600 hover:bg-sky-500 px-4 py-2 rounded-lg font-semibold text-white"
							>
								Save scorecards
							</button>
								{scorecardError ? <p className="text-sm text-red-600 mt-3">{scorecardError}</p> : null}
						</div>

							<div className="mt-6 bg-white/80 border border-sky-200 rounded-2xl p-5">
							<div className="flex items-center justify-between gap-3 flex-wrap">
								<h2 className="text-lg font-semibold">Score adjustments</h2>
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
							</div>

								<div className="mt-3 overflow-x-auto bg-white border border-sky-200 rounded-xl">
								<table className="w-full min-w-[720px] text-sm">
										<thead className="bg-sky-100/70">
										<tr className="text-left">
												<th className="p-3 text-slate-700">Hole</th>
											{players.map((p) => (
													<th key={p} className="p-3 text-slate-700">
													{p}
												</th>
											))}
										</tr>
									</thead>
									<tbody>
										{Array.from({ length: HOLE_COUNT }, (_, holeIdx) => (
												<tr key={holeIdx} className={holeIdx % 2 ? "bg-white/40" : "bg-white/70"}>
													<td className="p-3 text-slate-800 font-semibold">{holeIdx + 1}</td>
												{players.map((p) => {
													const table = scoresByDay[selectedDay];
													const v = table[p]?.[holeIdx];
													return (
														<td key={`${p}-${holeIdx}`} className="p-3">
															<input
																value={typeof v === "number" ? String(v) : ""}
																onChange={(e) => {
																	const raw = e.target.value;
																	const parsed = raw === "" ? null : Number(raw);
																	const nextScoresTable = {
																		...table,
																		[p]: Array.from({ length: HOLE_COUNT }, (_, i) => table[p]?.[i] ?? null),
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
																className="w-20 p-2 bg-white border border-sky-200 rounded-lg text-center focus:outline-none focus:ring-2 focus:ring-sky-200"
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
						</div>
					</>
				) : null}
			</div>
		</main>
	);
}
