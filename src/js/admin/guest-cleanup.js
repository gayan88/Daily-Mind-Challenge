import {
    collection,
    doc,
    getDocs,
    query,
    where,
    writeBatch,
    Timestamp,
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { db } from '../api/firebase-init.js';
import { escapeHtml, showToast } from '../utils/helpers.js';

/**
 * Admin → General → "Guest clean-up" (2026-11-14). Manual on purpose: "Check" only counts, and
 * nothing is deleted until the admin presses Delete and confirms. Removes guests who haven't
 * visited for N days (default 30; `lastLoginAt` is refreshed on every page load) together with
 * everything stored under their uid. Members are never touched -- only `guests` docs are listed.
 *
 * The guests' Firebase Auth logins themselves can't be deleted from a browser (that needs the
 * Admin SDK on a server); they hold no data and cost nothing, and a deleted guest who does come
 * back simply gets a fresh guest profile (auth/user-profile.js#loadSessionProfile).
 */
export const DEFAULT_INACTIVE_DAYS = 30;

// Every collection that stores a guest's own docs, with the field holding their uid. A guest can't
// be a championship winner or create a Wordle Challenge, so those collections aren't listed.
const OWNED_COLLECTIONS = [
    ['gameScores', 'userId'],
    ['playerAchievements', 'uid'],
    ['playerMissions', 'uid'],
    ['wordleDailyAttempts', 'uid'],
    ['wordleTournamentAttempts', 'uid'],
    ['connectionsDailyAttempts', 'uid'],
    ['connectionsTournamentAttempts', 'uid'],
    ['sudokuTournamentAttempts', 'uid'],
    ['wordsearchTournamentAttempts', 'uid'],
    ['quiltTournamentAttempts', 'uid'],
    ['pounceTournamentAttempts', 'uid'],
];

function cutoffFor(days) {
    return Timestamp.fromMillis(Date.now() - days * 24 * 60 * 60 * 1000);
}

/** Guests whose last visit is older than `days`, oldest first. */
export async function findInactiveGuests(days) {
    const snap = await getDocs(query(collection(db, 'guests'), where('lastLoginAt', '<', cutoffFor(days))));
    return snap.docs
        .map((d) => ({ uid: d.id, ...d.data() }))
        .sort((a, b) => (a.lastLoginAt?.toMillis() || 0) - (b.lastLoginAt?.toMillis() || 0));
}

/** Every doc reference owned by one guest, including the guest doc and its name reservation. */
async function ownedRefs(guest) {
    const results = await Promise.all(OWNED_COLLECTIONS.map(([name, field]) =>
        getDocs(query(collection(db, name), where(field, '==', guest.uid)))));
    const refs = results.flatMap((snap) => snap.docs.map((d) => d.ref));
    if (guest.nameKey) refs.push(doc(db, 'guestNames', guest.nameKey));
    refs.push(doc(db, 'guests', guest.uid));
    return refs;
}

/** Counts what a delete would remove: guests, their scores, and all their records. */
export async function previewCleanup(guests, onProgress) {
    let records = 0;
    let scores = 0;
    for (let i = 0; i < guests.length; i++) {
        const snap = await getDocs(query(collection(db, 'gameScores'), where('userId', '==', guests[i].uid)));
        scores += snap.size;
        records += (await ownedRefs(guests[i])).length;
        onProgress?.(i + 1, guests.length);
    }
    return { guests: guests.length, scores, records };
}

/** Deletes each guest and everything they own, in batches. Returns the number of docs removed. */
export async function deleteGuests(guests, onProgress) {
    let deleted = 0;
    for (let i = 0; i < guests.length; i++) {
        const refs = await ownedRefs(guests[i]);
        for (let j = 0; j < refs.length; j += 400) {
            const batch = writeBatch(db);
            refs.slice(j, j + 400).forEach((ref) => batch.delete(ref));
            await batch.commit();
        }
        deleted += refs.length;
        onProgress?.(i + 1, guests.length);
    }
    return deleted;
}

function formatDate(ts) {
    return ts?.toDate ? ts.toDate().toISOString().slice(0, 10) : 'unknown';
}

/** Wires the card in admin.html (#guest-cleanup-card). */
export function wireGuestCleanup() {
    const daysInput = document.getElementById('guest-cleanup-days');
    const checkBtn = document.getElementById('guest-cleanup-check');
    const deleteBtn = document.getElementById('guest-cleanup-delete');
    const resultEl = document.getElementById('guest-cleanup-result');
    if (!checkBtn) return;

    let found = [];

    function days() {
        const n = parseInt(daysInput.value, 10);
        return Number.isFinite(n) && n >= 1 ? n : DEFAULT_INACTIVE_DAYS;
    }

    checkBtn.addEventListener('click', async () => {
        checkBtn.disabled = true;
        deleteBtn.hidden = true;
        resultEl.textContent = 'Checking…';
        try {
            found = await findInactiveGuests(days());
            if (found.length === 0) {
                resultEl.textContent = `No guests inactive for ${days()}+ days. Nothing to delete.`;
                return;
            }
            const summary = await previewCleanup(found, (done, total) => {
                resultEl.textContent = `Checking… ${done} / ${total} guests`;
            });
            resultEl.innerHTML = `
                <strong>${summary.guests.toLocaleString()}</strong> guest${summary.guests === 1 ? '' : 's'} inactive ${days()}+ days
                · <strong>${summary.scores.toLocaleString()}</strong> score${summary.scores === 1 ? '' : 's'}
                · <strong>${summary.records.toLocaleString()}</strong> record${summary.records === 1 ? '' : 's'} in all
                · oldest last seen ${escapeHtml(formatDate(found[0].lastLoginAt))}
            `;
            deleteBtn.textContent = `Delete ${summary.guests.toLocaleString()} guest${summary.guests === 1 ? '' : 's'}`;
            deleteBtn.hidden = false;
        } catch (err) {
            resultEl.textContent = `Check failed: ${err.message}`;
        } finally {
            checkBtn.disabled = false;
        }
    });

    deleteBtn.addEventListener('click', async () => {
        if (found.length === 0) return;
        const ok = window.confirm(`Permanently delete ${found.length} inactive guest${found.length === 1 ? '' : 's'} and all their scores, badges and records? This can't be undone. Members are not affected.`);
        if (!ok) return;
        deleteBtn.disabled = true;
        checkBtn.disabled = true;
        try {
            const removed = await deleteGuests(found, (done, total) => {
                resultEl.textContent = `Deleting… ${done} / ${total} guests`;
            });
            resultEl.textContent = `Done: removed ${found.length} guest${found.length === 1 ? '' : 's'} (${removed.toLocaleString()} records).`;
            showToast('Inactive guests deleted');
            found = [];
            deleteBtn.hidden = true;
        } catch (err) {
            resultEl.textContent = `Delete stopped: ${err.message}. Press Check again to see what's left.`;
        } finally {
            deleteBtn.disabled = false;
            checkBtn.disabled = false;
        }
    });
}
