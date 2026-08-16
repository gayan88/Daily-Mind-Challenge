import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { initializeFirestore } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// This app never uses onSnapshot() real-time listeners, so Firestore's default streaming
// "Listen" WebChannel connection (used for multi-tab sync) is pure overhead -- and on some
// networks (VPNs, proxies, certain routers) that streaming connection hangs for 30+ seconds
// before falling back. Forcing long-polling skips the streaming attempt entirely and is far more
// reliable on those networks, at the cost of slightly higher latency per request on healthy ones.
export const db = initializeFirestore(app, {
    experimentalForceLongPolling: true,
    useFetchStreams: false,
});
