import { initShell } from '../app.js';
import { updateRegisteredProfile } from '../auth/user-profile.js';
import { changePassword } from '../auth/auth.js';
import { containsBlockedWord } from '../utils/profanity.js';
import { showToast } from '../utils/helpers.js';

const PASSWORD_RULE = /^(?=.*[A-Z])(?=.*\d).{8,}$/;

function blockGuestAccess() {
    document.getElementById('settings-content').innerHTML = `
        <div class="section">
            <div class="empty-state">
                Guest accounts don't have a settings page. <a href="index.html">Back to home</a> --
                or sign up for an account from the login page to unlock settings.
            </div>
        </div>
    `;
}

async function init() {
    const { uid, profile } = await initShell();

    if (profile.kind !== 'registered') {
        blockGuestAccess();
        return;
    }

    const nameInput = document.getElementById('display-name-input');
    const emailInput = document.getElementById('email-input');
    nameInput.value = profile.displayName;
    emailInput.value = profile.email || '';

    document.getElementById('save-account-btn').addEventListener('click', async () => {
        const name = nameInput.value.trim();
        const email = emailInput.value.trim();
        if (!name) {
            showToast('Display name cannot be empty');
            return;
        }
        if (await containsBlockedWord(name)) {
            showToast('That display name isn\'t allowed. Please choose another.');
            return;
        }
        await updateRegisteredProfile(uid, { displayName: name, email: email || null });
        showToast('Account updated');
    });

    document.getElementById('change-password-btn').addEventListener('click', async () => {
        const newPassword = document.getElementById('new-password-input').value;
        if (!PASSWORD_RULE.test(newPassword)) {
            showToast('Password needs at least 8 characters, 1 uppercase letter, and 1 number.');
            return;
        }
        try {
            await changePassword(newPassword);
            document.getElementById('new-password-input').value = '';
            showToast('Password changed');
        } catch (err) {
            if (err.code === 'auth/requires-recent-login') {
                showToast('For security, please log out and back in before changing your password.');
            } else {
                showToast(err.message || 'Could not change password.');
            }
        }
    });
}

init();
