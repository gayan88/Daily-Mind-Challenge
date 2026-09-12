import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth, connectAuthEmulator } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { initializeFirestore, connectFirestoreEmulator } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { getAnalytics } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-analytics.js';
import { firebaseConfig } from './firebase-config.js';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// getAnalytics() can throw in environments where the underlying measurement API isn't available
// (some in-app webviews, private-browsing modes) -- every consumer treats a null `analytics` as
// "tracking silently disabled" rather than a hard failure, so one unsupported browser can never
// break session init / page rendering for that visitor.
let analyticsInstance = null;
try {
    analyticsInstance = getAnalytics(app);
} catch {
    analyticsInstance = null;
}
export const analytics = analyticsInstance;

// This app never uses onSnapshot() real-time listeners, so Firestore's default streaming
// "Listen" WebChannel connection (used for multi-tab sync) is pure overhead -- and on some
// networks (VPNs, proxies, certain routers) that streaming connection hangs for 30+ seconds
// before falling back. Forcing long-polling skips the streaming attempt entirely and is far more
// reliable on those networks, at the cost of slightly higher latency per request on healthy ones.
export const db = initializeFirestore(app, {
    experimentalForceLongPolling: true,
    useFetchStreams: false,
});

// Local-only: when this app is served from localhost/127.0.0.1 (python3 -m http.server, per
// docs/architecture.md's "Running locally"), point at the Firebase Emulator Suite instead of the
// real project -- lets firestore.rules changes be tested against a throwaway local Firestore/Auth
// instance before ever being deployed to production. Never triggers for the real deployed site
// (a real hostname), so this can't affect production. Start the emulators first with
// `firebase emulators:start` (ports match `firebase.json`'s `emulators` config below).
if (typeof location !== 'undefined' && (location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    connectFirestoreEmulator(db, 'localhost', 8080);
    connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
}
