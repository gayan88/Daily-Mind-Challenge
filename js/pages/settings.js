import { initShell } from '../lib/partials.js';
import { updateDisplayName } from '../lib/user-profile.js';
import { signOutGuest } from '../firebase/auth.js';
import { showToast } from '../lib/utils.js';

async function init() {
    const { uid, profile } = await initShell();

    const nameInput = document.getElementById('display-name-input');
    nameInput.value = profile.displayName;

    document.getElementById('save-name-btn').addEventListener('click', async () => {
        const name = nameInput.value.trim();
        if (!name) {
            showToast('Display name cannot be empty');
            return;
        }
        await updateDisplayName(uid, name);
        showToast('Display name updated');
    });

    document.getElementById('reset-btn').addEventListener('click', async () => {
        const confirmed = window.confirm(
            'This will permanently disconnect this browser from your current guest identity. ' +
            'Your points, streak, and history will NOT be recoverable afterward. Continue?'
        );
        if (!confirmed) return;
        await signOutGuest();
        window.location.href = 'index.html';
    });
}

init();
