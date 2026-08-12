import { applyIcons } from '../lib/icons.js';
import { getQueryParam } from '../lib/utils.js';
import { containsBlockedWord } from '../lib/profanity.js';
import {
    getSessionUser,
    signInAsGuest,
    signUpWithUsername,
    loginWithUsername,
    requestPasswordReset,
} from '../firebase/auth.js';
import {
    createGuestProfile,
    createRegisteredProfile,
    isUsernameTaken,
    loadSessionProfile,
    BannedError,
} from '../lib/user-profile.js';

applyIcons(document);

const redirectTarget = getQueryParam('redirect') || 'index.html';
const errorEl = document.getElementById('auth-error');

function showError(message) {
    errorEl.textContent = message;
    errorEl.classList.add('visible');
}

function clearError() {
    errorEl.classList.remove('visible');
}

function goToApp() {
    window.location.href = redirectTarget;
}

const tabs = {
    guest: { tab: document.getElementById('tab-guest'), panel: document.getElementById('panel-guest') },
    login: { tab: document.getElementById('tab-login'), panel: document.getElementById('panel-login') },
    signup: { tab: document.getElementById('tab-signup'), panel: document.getElementById('panel-signup') },
};

function selectTab(name) {
    clearError();
    Object.entries(tabs).forEach(([key, { tab, panel }]) => {
        tab.classList.toggle('active', key === name);
        panel.classList.toggle('active', key === name);
    });
}

Object.entries(tabs).forEach(([key, { tab }]) => tab.addEventListener('click', () => selectTab(key)));

async function withErrorHandling(fn) {
    clearError();
    try {
        await fn();
    } catch (err) {
        if (err instanceof BannedError) {
            showError(`Your account has been banned. Reason: ${err.message}`);
        } else {
            showError(err.message || 'Something went wrong. Please try again.');
        }
    }
}

document.getElementById('guest-submit').addEventListener('click', () => withErrorHandling(async () => {
    const name = document.getElementById('guest-name').value.trim();
    if (!name) throw new Error('Please enter a display name.');
    if (await containsBlockedWord(name)) throw new Error('That display name isn\'t allowed. Please choose another.');

    const user = await signInAsGuest();
    await createGuestProfile(user.uid, name);
    goToApp();
}));

document.getElementById('login-submit').addEventListener('click', () => withErrorHandling(async () => {
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    if (!username || !password) throw new Error('Please enter your username and password.');

    const user = await loginWithUsername(username, password);
    await loadSessionProfile(user); // throws BannedError and signs out if banned
    goToApp();
}));

document.getElementById('forgot-password-link').addEventListener('click', (e) => {
    e.preventDefault();
    withErrorHandling(async () => {
        const username = window.prompt('Enter your username to receive a password reset email:');
        if (!username) return;
        await requestPasswordReset(username);
        showError('If that account has a recovery email on file, a reset link has been sent.');
    });
});

const PASSWORD_RULE = /^(?=.*[A-Z])(?=.*\d).{8,}$/;

document.getElementById('signup-submit').addEventListener('click', () => withErrorHandling(async () => {
    const username = document.getElementById('signup-username').value.trim();
    const displayName = document.getElementById('signup-displayname').value.trim();
    const password = document.getElementById('signup-password').value;
    const email = document.getElementById('signup-email').value.trim();

    if (!username || !displayName || !password) throw new Error('Username, display name, and password are required.');
    if (!/^[a-zA-Z0-9_]{3,24}$/.test(username)) throw new Error('Username must be 3-24 characters: letters, numbers, underscores.');
    if (!PASSWORD_RULE.test(password)) throw new Error('Password needs at least 8 characters, 1 uppercase letter, and 1 number.');
    if (await containsBlockedWord(displayName)) throw new Error('That display name isn\'t allowed. Please choose another.');

    const usernameLower = username.toLowerCase();
    if (await isUsernameTaken(usernameLower)) throw new Error('That username is already taken.');

    const { user, authEmail } = await signUpWithUsername(username, password, email);
    await createRegisteredProfile(user.uid, { usernameLower, displayName, email: email || null, authEmail });
    goToApp();
}));

// If already signed in (and not banned), skip the login form entirely.
getSessionUser().then(async (user) => {
    if (!user) return;
    try {
        await loadSessionProfile(user);
        goToApp();
    } catch {
        // banned or missing profile -- loadSessionProfile already signed out; stay on login.html
    }
});
