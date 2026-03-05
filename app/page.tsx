"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { collection, getDocs, limit, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";

export default function Home() {
  const router = useRouter();
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalizedPin = useMemo(() => pin.replace(/\s+/g, ""), [pin]);

  async function onEnter() {
    setError(null);

    if (normalizedPin.length < 4) {
      setError("Enter a valid PIN.");
      return;
    }

    setLoading(true);
    try {
      const q = query(
        collection(db, "groups"),
        where("pin", "==", normalizedPin),
        limit(1)
      );

      const snap = await getDocs(q);

      if (snap.empty) {
        setError("Invalid PIN.");
        return;
      }

      const docSnap = snap.docs[0];
      router.push(`/group/${docSnap.id}`);
    } catch {
      setError("Could not check PIN. Verify Firestore is enabled and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-sky-50 text-slate-900 flex items-center justify-center">
      <div className="bg-white/80 border border-sky-200 p-8 rounded-2xl shadow-xl w-80 text-center">
        <h1 className="text-3xl font-bold mb-2">Calpac Golf</h1>
        <p className="text-slate-600 mb-6">Enter Foursome PIN</p>

        <input
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onEnter();
          }}
          className="w-full p-3 text-center text-xl tracking-widest bg-white border border-sky-300 rounded-lg mb-4 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-200 focus:border-sky-400"
          placeholder="1234"
          maxLength={6}
          inputMode="numeric"
          autoComplete="one-time-code"
        />

        <button
          onClick={onEnter}
          disabled={loading}
          className="w-full bg-sky-600 hover:bg-sky-700 disabled:opacity-60 p-3 rounded-lg font-semibold text-white"
        >
          {loading ? "Checking..." : "Enter"}
        </button>

        {error ? <p className="text-sm text-red-300 mt-3">{error}</p> : null}

        <p className="text-xs text-slate-500 mt-4">
          Ask your group captain for the PIN
        </p>
      </div>
    </main>
  );
}
