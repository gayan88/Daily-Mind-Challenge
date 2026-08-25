import {
    doc,
    getDoc,
    setDoc,
    updateDoc,
    deleteDoc,
    getDocs,
    collection,
    serverTimestamp,
    writeBatch,
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { db } from '../api/firebase-init.js';
import { addDaysToDateString } from '../utils/helpers.js';

const WORDS_COLLECTION = 'wordleDailyWords';
const TOURNAMENTS_COLLECTION = 'wordleTournaments';
// Firestore caps a single batch at 500 writes -- leave one slot per batch for the trailing _meta
// update, so a batch of words never has to be split awkwardly around it.
const BATCH_LIMIT = 500;

/** Lists every seeded Daily Challenge word, ordered by date (which also matches challengeNumber
 * order, since dates are only ever assigned going forward -- see addDailyWord()). */
export async function listDailyWords() {
    const snap = await getDocs(collection(db, WORDS_COLLECTION));
    return snap.docs
        .filter((d) => d.id !== '_meta')
        .map((d) => ({ date: d.id, challengeNumber: d.data().challengeNumber, word: d.data().word }))
        .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Appends a new word to the end of the calendar and bumps `_meta`, which
 * `wordle-daily-data.js#getTodayChallenge()` reads to resolve today's word with a single getDoc
 * keyed directly by date. Each word doc's own id IS the "YYYY-MM-DD" date it plays on -- the very
 * first word (an empty pool) requires `startDate` (the admin's chosen launch date, becoming
 * Challenge #1); every word after that ignores `startDate` and is automatically dated one day
 * after the previous word (`_meta.lastDate + 1`), so admins never have to compute dates by hand.
 * Append-only by design -- reordering/removing earlier entries would shift which word lands on
 * which past/future date for players already mid-streak (see CLAUDE.md). Adding more words later
 * never touches or recomputes any existing word's date, since new ones are only ever appended
 * after the current end of the calendar.
 */
export async function addDailyWord(word, startDate) {
    const metaRef = doc(db, WORDS_COLLECTION, '_meta');
    const metaSnap = await getDoc(metaRef);
    const totalCount = metaSnap.exists() ? (metaSnap.data().totalCount || 0) : 0;

    let dateString;
    if (totalCount === 0) {
        if (!startDate) throw new Error('Pick a start date for the very first word (Challenge #1)');
        dateString = startDate;
    } else {
        dateString = addDaysToDateString(metaSnap.data().lastDate, 1);
    }

    const challengeNumber = totalCount + 1;
    await setDoc(doc(db, WORDS_COLLECTION, dateString), {
        challengeNumber,
        word: word.trim().toUpperCase(),
        createdAt: serverTimestamp(),
    });
    await setDoc(metaRef, {
        totalCount: challengeNumber,
        firstDate: totalCount === 0 ? dateString : metaSnap.data().firstDate,
        lastDate: dateString,
        updatedAt: serverTimestamp(),
    });
    return { date: dateString, challengeNumber };
}

/**
 * Bulk version of addDailyWord() for CSV import -- takes a plain list of words (no dates; dates
 * are assigned the exact same way addDailyWord() would, sequentially from `startDate` or
 * `_meta.lastDate + 1`) and writes them all in as few Firestore batches as possible (chunked at
 * `BATCH_LIMIT - 1` words per batch, since each batch also needs room for the trailing `_meta`
 * write). Each chunk commits atomically -- either every word in that chunk lands or none does --
 * and `_meta` is only written once, in the very last chunk, so a mid-import failure never leaves
 * `_meta.lastDate` pointing past a word that didn't actually get written.
 */
export async function bulkAddDailyWords(rawWords, startDate) {
    const metaRef = doc(db, WORDS_COLLECTION, '_meta');
    const metaSnap = await getDoc(metaRef);
    const existingTotal = metaSnap.exists() ? (metaSnap.data().totalCount || 0) : 0;
    const existingFirstDate = metaSnap.exists() ? metaSnap.data().firstDate : null;
    const existingLastDate = metaSnap.exists() ? metaSnap.data().lastDate : null;

    const words = rawWords.map((w) => w.trim().toUpperCase()).filter(Boolean);
    if (words.length === 0) throw new Error('No words to import');
    const invalid = words.find((w) => !/^[A-Z]{5}$/.test(w));
    if (invalid) throw new Error(`"${invalid}" isn't a 5-letter word`);
    if (existingTotal === 0 && !startDate) {
        throw new Error('Pick a start date for the very first word (Challenge #1)');
    }

    const assignments = [];
    let cursorDate = existingTotal === 0 ? startDate : existingLastDate;
    words.forEach((word, i) => {
        const dateString = existingTotal === 0 && i === 0 ? cursorDate : addDaysToDateString(cursorDate, 1);
        cursorDate = dateString;
        assignments.push({ dateString, word, challengeNumber: existingTotal + i + 1 });
    });

    const firstDate = existingTotal === 0 ? assignments[0].dateString : existingFirstDate;
    const lastDate = assignments[assignments.length - 1].dateString;
    const totalCount = existingTotal + assignments.length;

    for (let i = 0; i < assignments.length; i += BATCH_LIMIT - 1) {
        const chunk = assignments.slice(i, i + BATCH_LIMIT - 1);
        const batch = writeBatch(db);
        chunk.forEach(({ dateString, word, challengeNumber }) => {
            batch.set(doc(db, WORDS_COLLECTION, dateString), { challengeNumber, word, createdAt: serverTimestamp() });
        });
        if (i + chunk.length >= assignments.length) {
            batch.set(metaRef, { totalCount, firstDate, lastDate, updatedAt: serverTimestamp() });
        }
        await batch.commit();
    }

    return { count: assignments.length, firstDate: assignments[0].dateString, lastDate };
}

/**
 * Recomputes every word's challengeNumber (sorted by date) and _meta's totalCount/firstDate/
 * lastDate from scratch. Called after editing a word's date, so the sequence and _meta stay
 * internally consistent no matter which entry was edited or what order edits happen in. Only
 * rewrites a word doc when its number actually changed. Also self-heals legacy entries with no
 * challengeNumber at all (from before this date-keyed scheme existed), since the number is
 * always derived fresh from date order here rather than trusted from whatever the doc already
 * says. There's deliberately no delete for individual daily words -- removing one from the
 * middle of the calendar would leave a permanent gap on that date (new words only ever get
 * appended after `lastDate`, never backfilled), so a bad entry should be *corrected* via
 * updateDailyWord() instead of removed.
 */
async function renumberDailyWords() {
    const snap = await getDocs(collection(db, WORDS_COLLECTION));
    const words = snap.docs
        .filter((d) => d.id !== '_meta')
        .map((d) => ({ date: d.id, challengeNumber: d.data().challengeNumber, word: d.data().word }))
        .sort((a, b) => a.date.localeCompare(b.date));

    await Promise.all(words.map((w, i) => {
        const correctNumber = i + 1;
        if (w.challengeNumber === correctNumber) return null;
        return setDoc(doc(db, WORDS_COLLECTION, w.date), { challengeNumber: correctNumber }, { merge: true });
    }));

    const metaRef = doc(db, WORDS_COLLECTION, '_meta');
    await setDoc(metaRef, {
        totalCount: words.length,
        firstDate: words.length ? words[0].date : null,
        lastDate: words.length ? words[words.length - 1].date : null,
        updatedAt: serverTimestamp(),
    });
}

/**
 * Corrects an already-seeded word's text and/or date. Changing the date moves it to a new doc
 * (Firestore doc ids can't be renamed in place) -- deletes the old doc, writes a new one under
 * the new date, then renumbers everything so challengeNumber/firstDate/lastDate stay correct
 * regardless of which entry was edited or what order edits happen in. This is also how to repair
 * a malformed/legacy entry (e.g. one seeded before this date-keyed scheme existed, missing a real
 * date or a challengeNumber) -- just edit it with the date it should actually have.
 */
export async function updateDailyWord(currentDate, { word, date }) {
    const trimmedWord = word.trim().toUpperCase();
    if (date && date !== currentDate) {
        const targetSnap = await getDoc(doc(db, WORDS_COLLECTION, date));
        if (targetSnap.exists()) throw new Error(`Another word is already dated ${date}`);
        await deleteDoc(doc(db, WORDS_COLLECTION, currentDate));
        await setDoc(doc(db, WORDS_COLLECTION, date), { word: trimmedWord, createdAt: serverTimestamp() });
    } else {
        await setDoc(
            doc(db, WORDS_COLLECTION, currentDate),
            { word: trimmedWord, updatedAt: serverTimestamp() },
            { merge: true }
        );
    }
    await renumberDailyWords();
}

/** Lists all tournaments (active and inactive), newest first. */
export async function listTournaments() {
    const snap = await getDocs(collection(db, TOURNAMENTS_COLLECTION));
    return snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
}

/** Creates a new tournament, active by default. `words` is a pre-split array of 5-letter words. */
export async function createTournament({ name, words, timePerWordSeconds, bonusPoints }) {
    const ref = doc(collection(db, TOURNAMENTS_COLLECTION));
    await setDoc(ref, {
        name: name.trim(),
        words: words.map((w) => w.trim().toUpperCase()),
        timePerWordSeconds,
        bonusPoints,
        active: true,
        createdAt: serverTimestamp(),
    });
    return ref.id;
}

/** Toggles a tournament's visibility to players without deleting its data/history. */
export async function setTournamentActive(id, active) {
    await updateDoc(doc(db, TOURNAMENTS_COLLECTION, id), { active });
}

export async function deleteTournament(id) {
    await deleteDoc(doc(db, TOURNAMENTS_COLLECTION, id));
}
