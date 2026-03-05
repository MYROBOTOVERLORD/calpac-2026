"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
	addDoc,
	collection,
	doc,
	onSnapshot,
	serverTimestamp,
	setDoc,
	updateDoc,
	deleteDoc,
	type Timestamp,
} from "firebase/firestore";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from "firebase/auth";
import { auth, db } from "@/lib/firebase";

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
	grossA?: number;
	grossB?: number;
	createdAt?: Timestamp;
	updatedAt?: Timestamp;
};

type TeamDraft = {
	teamName: string;
	playerA: string;
	playerB: string;
	handicapA: string;
	handicapB: string;
	grossA: string;
	grossB: string;
};

const EVENT_ID = "current";

function safeIntString(v: string) {
	const n = Math.floor(Number(v || 0));
	return Number.isFinite(n) ? n : 0;
}

export default function CalcuttaAdminPage() {
	const router = useRouter();

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

	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [event, setEvent] = useState<CalcuttaEventDoc | null>(null);
	const [teams, setTeams] = useState<Array<{ id: string; data: CalcuttaTeamDoc }>>([]);

	const [eventNameDraft, setEventNameDraft] = useState("Calcutta");
	const [courseDraft, setCourseDraft] = useState("");
	const [eventSaveError, setEventSaveError] = useState<string | null>(null);
	const [eventSaving, setEventSaving] = useState(false);

	const [newTeam, setNewTeam] = useState<TeamDraft>({
		teamName: "",
		playerA: "",
		playerB: "",
		handicapA: "0",
		handicapB: "0",
		grossA: "0",
		grossB: "0",
	});
	const [addTeamError, setAddTeamError] = useState<string | null>(null);
	const [addingTeam, setAddingTeam] = useState(false);
	const [rowSavingId, setRowSavingId] = useState<string | null>(null);
	const [rowError, setRowError] = useState<string | null>(null);

	useEffect(() => {
		const unsub = onAuthStateChanged(auth, (u) => setAdminUser(u));
		return () => unsub();
	}, []);

	useEffect(() => {
		setLoading(true);
		setError(null);

		const eventRef = doc(db, "calcuttaEvents", EVENT_ID);
		const teamsRef = collection(db, "calcuttaEvents", EVENT_ID, "teams");

		const unsubEvent = onSnapshot(
			eventRef,
			(snap) => {
				if (snap.exists()) {
					const data = snap.data() as CalcuttaEventDoc;
					setEvent(data);
					if (eventNameDraft === "Calcutta" && (data.name ?? "").trim()) setEventNameDraft(data.name ?? "Calcutta");
					if (!courseDraft && (data.course ?? "").trim()) setCourseDraft(data.course ?? "");
				} else {
					setEvent(null);
				}
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
			(err) => setError(err instanceof Error ? err.message : String(err))
		);

		return () => {
			unsubEvent();
			unsubTeams();
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

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

	async function createOrSaveEvent() {
		if (!isAdmin) {
			setEventSaveError("Admin access required.");
			return;
		}
		setEventSaving(true);
		setEventSaveError(null);
		try {
			const ref = doc(db, "calcuttaEvents", EVENT_ID);
			await setDoc(
				ref,
				{
					name: eventNameDraft.trim() || "Calcutta",
					course: courseDraft.trim() || "",
					...(event ? {} : { createdAt: serverTimestamp() }),
					updatedAt: serverTimestamp(),
				},
				{ merge: true }
			);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			setEventSaveError(message);
		} finally {
			setEventSaving(false);
		}
	}

	async function addTeam() {
		if (!isAdmin) {
			setAddTeamError("Admin access required.");
			return;
		}
		setAddTeamError(null);
		const playerA = newTeam.playerA.trim();
		const playerB = newTeam.playerB.trim();
		if (!playerA || !playerB) {
			setAddTeamError("Enter both player names.");
			return;
		}

		setAddingTeam(true);
		try {
			await addDoc(collection(db, "calcuttaEvents", EVENT_ID, "teams"), {
				teamName: newTeam.teamName.trim() || "",
				playerA,
				playerB,
				handicapA: safeIntString(newTeam.handicapA),
				handicapB: safeIntString(newTeam.handicapB),
				grossA: safeIntString(newTeam.grossA),
				grossB: safeIntString(newTeam.grossB),
				createdAt: serverTimestamp(),
				updatedAt: serverTimestamp(),
			});
			setNewTeam({ teamName: "", playerA: "", playerB: "", handicapA: "0", handicapB: "0", grossA: "0", grossB: "0" });
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			setAddTeamError(message);
		} finally {
			setAddingTeam(false);
		}
	}

	async function saveTeam(id: string, draft: CalcuttaTeamDoc) {
		if (!isAdmin) {
			setRowError("Admin access required.");
			return;
		}
		setRowSavingId(id);
		setRowError(null);
		try {
			await updateDoc(doc(db, "calcuttaEvents", EVENT_ID, "teams", id), {
				...draft,
				updatedAt: serverTimestamp(),
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			setRowError(message);
		} finally {
			setRowSavingId(null);
		}
	}

	async function removeTeam(id: string) {
		if (!isAdmin) {
			setRowError("Admin access required.");
			return;
		}
		setRowSavingId(id);
		setRowError(null);
		try {
			await deleteDoc(doc(db, "calcuttaEvents", EVENT_ID, "teams", id));
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			setRowError(message);
		} finally {
			setRowSavingId(null);
		}
	}

	if (loading) return <main className="min-h-screen bg-sky-50 text-slate-900 p-3 sm:p-6">Loading…</main>;
	if (error) return <main className="min-h-screen bg-sky-50 text-slate-900 p-3 sm:p-6">{error}</main>;

	return (
		<main className="min-h-screen bg-sky-50 text-slate-900 p-3 sm:p-6">
			<div className="max-w-5xl mx-auto">
				<div className="flex items-start justify-between gap-3 flex-wrap">
					<div>
						<h1 className="text-2xl font-bold">Calcutta · Admin</h1>
						<p className="text-slate-600 text-sm mt-1">{event ? "Editing current event" : "Event not created yet"}</p>
					</div>
					<div className="flex gap-2">
						<button
							onClick={() => router.push("/calcutta")}
							className="bg-white hover:bg-sky-50 border border-sky-200 px-4 py-2 rounded-lg text-sm"
						>
							Back to Calcutta
						</button>
					</div>
				</div>

				<div className="mt-4 bg-white/80 border border-sky-200 rounded-2xl p-4 sm:p-5">
					<div className="flex items-center justify-between gap-3 flex-wrap">
						<h2 className="text-lg font-semibold">Admin login</h2>
						{isAdmin ? (
							<p className="text-sm text-slate-700">Signed in: {adminUser?.email ?? "(unknown)"}</p>
						) : isSignedIn ? (
							<p className="text-sm text-amber-700">Signed in but not authorized</p>
						) : (
							<p className="text-sm text-slate-600">Sign in to edit teams</p>
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
							<button onClick={adminLogin} className="bg-sky-600 hover:bg-sky-500 px-4 py-2 rounded-lg font-semibold text-white">
								Sign in
							</button>
						</div>
					)}

					{adminError ? <p className="text-sm text-red-600 mt-3">{adminError}</p> : null}
				</div>

				<div className="mt-4 bg-white/80 border border-sky-200 rounded-2xl p-4 sm:p-5">
					<div className="flex items-center justify-between gap-3 flex-wrap">
						<h2 className="text-lg font-semibold">Event</h2>
						<button
							onClick={createOrSaveEvent}
							disabled={!isAdmin || eventSaving}
							className="bg-sky-600 hover:bg-sky-500 disabled:opacity-60 px-4 py-2 rounded-lg font-semibold text-white"
						>
							{eventSaving ? "Saving…" : event ? "Save event" : "Create event"}
						</button>
					</div>

					<div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
						<input
							value={eventNameDraft}
							onChange={(e) => setEventNameDraft(e.target.value)}
							className="p-2 bg-white border border-sky-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-200"
							placeholder="Event name"
						/>
						<input
							value={courseDraft}
							onChange={(e) => setCourseDraft(e.target.value)}
							className="p-2 bg-white border border-sky-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-200"
							placeholder="Course (optional)"
						/>
					</div>

					{eventSaveError ? <p className="text-sm text-red-600 mt-2">{eventSaveError}</p> : null}
				</div>

				<div className="mt-4 bg-white/80 border border-sky-200 rounded-2xl p-4 sm:p-5">
					<div className="flex items-center justify-between gap-3 flex-wrap">
						<h2 className="text-lg font-semibold">Add team</h2>
						<p className="text-sm text-slate-600">2 players per team</p>
					</div>
					<div className="mt-3 grid grid-cols-1 sm:grid-cols-4 gap-2">
						<input
							value={newTeam.teamName}
							onChange={(e) => setNewTeam((p) => ({ ...p, teamName: e.target.value }))}
							className="p-2 bg-white border border-sky-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-200"
							placeholder="Team name (optional)"
						/>
						<input
							value={newTeam.playerA}
							onChange={(e) => setNewTeam((p) => ({ ...p, playerA: e.target.value }))}
							className="p-2 bg-white border border-sky-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-200"
							placeholder="Player A"
						/>
						<input
							value={newTeam.playerB}
							onChange={(e) => setNewTeam((p) => ({ ...p, playerB: e.target.value }))}
							className="p-2 bg-white border border-sky-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-200"
							placeholder="Player B"
						/>
						<button
							onClick={addTeam}
							disabled={!isAdmin || addingTeam}
							className="bg-sky-600 hover:bg-sky-500 disabled:opacity-60 px-4 py-2 rounded-lg font-semibold text-white"
						>
							{addingTeam ? "Adding…" : "Add"}
						</button>
					</div>
					<div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
						<input
							value={newTeam.handicapA}
							onChange={(e) => setNewTeam((p) => ({ ...p, handicapA: e.target.value }))}
							inputMode="numeric"
							className="p-2 bg-white border border-sky-200 rounded-lg text-center focus:outline-none focus:ring-2 focus:ring-sky-200"
							placeholder="A HCP"
						/>
						<input
							value={newTeam.grossA}
							onChange={(e) => setNewTeam((p) => ({ ...p, grossA: e.target.value }))}
							inputMode="numeric"
							className="p-2 bg-white border border-sky-200 rounded-lg text-center focus:outline-none focus:ring-2 focus:ring-sky-200"
							placeholder="A Gross"
						/>
						<input
							value={newTeam.handicapB}
							onChange={(e) => setNewTeam((p) => ({ ...p, handicapB: e.target.value }))}
							inputMode="numeric"
							className="p-2 bg-white border border-sky-200 rounded-lg text-center focus:outline-none focus:ring-2 focus:ring-sky-200"
							placeholder="B HCP"
						/>
						<input
							value={newTeam.grossB}
							onChange={(e) => setNewTeam((p) => ({ ...p, grossB: e.target.value }))}
							inputMode="numeric"
							className="p-2 bg-white border border-sky-200 rounded-lg text-center focus:outline-none focus:ring-2 focus:ring-sky-200"
							placeholder="B Gross"
						/>
					</div>
					{addTeamError ? <p className="text-sm text-red-600 mt-2">{addTeamError}</p> : null}
				</div>

				<div className="mt-4 bg-white/80 border border-sky-200 rounded-2xl p-4 sm:p-5">
					<div className="flex items-center justify-between gap-3 flex-wrap">
						<h2 className="text-lg font-semibold">Teams</h2>
						<p className="text-sm text-slate-600">{teams.length} teams</p>
					</div>
					<div className="mt-3 overflow-x-auto bg-white border border-sky-200 rounded-xl">
						<table className="w-full min-w-[980px] text-sm">
							<thead>
								<tr className="text-left text-slate-700">
									<th className="p-2">Team</th>
									<th className="p-2">Player A</th>
									<th className="p-2">A HCP</th>
									<th className="p-2">A Gross</th>
									<th className="p-2">Player B</th>
									<th className="p-2">B HCP</th>
									<th className="p-2">B Gross</th>
									<th className="p-2"></th>
								</tr>
							</thead>
							<tbody>
								{teams.map(({ id, data }) => {
									const disabled = !isAdmin || rowSavingId === id;
									const teamName = data.teamName ?? "";
									const playerA = data.playerA ?? "";
									const playerB = data.playerB ?? "";
									const handicapA = String(Math.floor(typeof data.handicapA === "number" ? data.handicapA : 0));
									const handicapB = String(Math.floor(typeof data.handicapB === "number" ? data.handicapB : 0));
									const grossA = String(Math.floor(typeof data.grossA === "number" ? data.grossA : 0));
									const grossB = String(Math.floor(typeof data.grossB === "number" ? data.grossB : 0));

									return (
										<tr key={id} className="border-t border-sky-100 align-top">
											<td className="p-2">
												<input
													defaultValue={teamName}
													disabled={disabled}
													className="w-56 p-2 bg-white border border-sky-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-200 disabled:opacity-60"
													placeholder="Team name (optional)"
													onBlur={(e) => saveTeam(id, { ...data, teamName: e.target.value })}
												/>
											</td>
											<td className="p-2">
												<input
													defaultValue={playerA}
													disabled={disabled}
													className="w-48 p-2 bg-white border border-sky-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-200 disabled:opacity-60"
													placeholder="Player A"
													onBlur={(e) => saveTeam(id, { ...data, playerA: e.target.value })}
												/>
											</td>
											<td className="p-2">
												<input
													defaultValue={handicapA}
													disabled={disabled}
													inputMode="numeric"
													className="w-20 p-2 text-center bg-white border border-sky-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-200 disabled:opacity-60"
													onBlur={(e) => saveTeam(id, { ...data, handicapA: safeIntString(e.target.value) })}
												/>
											</td>
											<td className="p-2">
												<input
													defaultValue={grossA}
													disabled={disabled}
													inputMode="numeric"
													className="w-20 p-2 text-center bg-white border border-sky-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-200 disabled:opacity-60"
													onBlur={(e) => saveTeam(id, { ...data, grossA: safeIntString(e.target.value) })}
												/>
											</td>
											<td className="p-2">
												<input
													defaultValue={playerB}
													disabled={disabled}
													className="w-48 p-2 bg-white border border-sky-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-200 disabled:opacity-60"
													placeholder="Player B"
													onBlur={(e) => saveTeam(id, { ...data, playerB: e.target.value })}
												/>
											</td>
											<td className="p-2">
												<input
													defaultValue={handicapB}
													disabled={disabled}
													inputMode="numeric"
													className="w-20 p-2 text-center bg-white border border-sky-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-200 disabled:opacity-60"
													onBlur={(e) => saveTeam(id, { ...data, handicapB: safeIntString(e.target.value) })}
												/>
											</td>
											<td className="p-2">
												<input
													defaultValue={grossB}
													disabled={disabled}
													inputMode="numeric"
													className="w-20 p-2 text-center bg-white border border-sky-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-200 disabled:opacity-60"
													onBlur={(e) => saveTeam(id, { ...data, grossB: safeIntString(e.target.value) })}
												/>
											</td>
											<td className="p-2 whitespace-nowrap">
												<button
													onClick={() => removeTeam(id)}
													disabled={disabled}
													className="bg-white hover:bg-sky-50 border border-sky-200 px-3 py-2 rounded-lg text-sm disabled:opacity-60"
												>
													Delete
												</button>
											</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>
					{rowError ? <p className="text-sm text-red-600 mt-2">{rowError}</p> : null}
				</div>
			</div>
		</main>
	);
}
