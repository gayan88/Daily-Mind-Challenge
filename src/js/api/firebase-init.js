import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { initializeFirestore } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
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
