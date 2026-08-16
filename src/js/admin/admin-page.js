import { initShell } from '../app.js';
import { ensureConfigDefaults, updateConfig } from '../utils/config.js';
import { lookupUserByUsername, setUserBanned, setUserAdmin, deleteChallenge } from './moderation.js';
import { escapeHtml, showToast } from '../utils/helpers.js';

const CONFIG_FORMS = [
    {
        id: 'dailyLoginReward',
        title: 'Daily Login Reward',
        fields: [{ key: 'points', type: 'number', label: 'Points' }],
    },
    {
        id: 'challengeExpiration',
        title: 'Challenge Expiration',
        fields: [{ key: 'days', type: 'number', label: 'Days' }],
    },
    {
        id: 'maxChallengeCreationsPerDay',
        title: 'Max Challenges Per Day',
        fields: [{ key: 'limit', type: 'number', label: 'Limit (blank = unlimited)', nullable: true }],
    },
    {
        id: 'wordValidationAPI',
        title: 'Word Validation API',
        fields: [{ key: 'endpoint', type: 'text', label: 'Endpoint URL' }],
    },
    {
        id: 'profanityList',
        title: 'Profanity List',
        fields: [{ key: 'blockedWords', type: 'textarea', label: 'Blocked words (comma-separated)', isArray: true }],
    },
];

function blockNonAdminAccess() {
    document.getElementById('admin-content').innerHTML = `
        <div class="section">
            <div class="empty-state">You don't have access to this page. <a href="index.html">Back to home</a></div>
        </div>
    `;
}

async function renderConfigForms() {
    const container = document.getElementById('config-forms');
    const docs = await Promise.all(CONFIG_FORMS.map((form) => ensureConfigDefaults(form.id)));

    container.innerHTML = CONFIG_FORMS.map((form, i) => {
        const data = docs[i];
        const fieldsHtml = form.fields.map((field) => {
            const value = data[field.key];
            if (field.type === 'textarea') {
                const text = field.isArray ? (value || []).join(', ') : (value || '');
                return `<textarea id="cfg-${form.id}-${field.key}">${escapeHtml(text)}</textarea>`;
            }
            const inputValue = value === null || value === undefined ? '' : escapeHtml(String(value));
            return `<input type="${field.type}" id="cfg-${form.id}-${field.key}" value="${inputValue}">`;
        }).join('');

        return `
            <div class="config-form">
                <div class="config-form-title">${form.title}</div>
                <div class="config-form-desc">${escapeHtml(data.description || '')}</div>
                <div class="config-form-row">
                    ${fieldsHtml}
                    <button class="btn primary" data-save-config="${form.id}" type="button">Save</button>
                </div>
            </div>
        `;
    }).join('');

    container.querySelectorAll('[data-save-config]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const formId = btn.dataset.saveConfig;
            const form = CONFIG_FORMS.find((f) => f.id === formId);
            const fields = {};
            form.fields.forEach((field) => {
                const el = document.getElementById(`cfg-${formId}-${field.key}`);
                if (field.isArray) {
                    fields[field.key] = el.value.split(',').map((w) => w.trim()).filter(Boolean);
                } else if (field.type === 'number') {
                    fields[field.key] = el.value === '' ? (field.nullable ? null : 0) : Number(el.value);
                } else {
                    fields[field.key] = el.value;
                }
            });
            await updateConfig(formId, fields);
            showToast(`${form.title} saved`);
        });
    });
}

function renderModResult(user) {
    const el = document.getElementById('mod-result');
    if (!user) {
        el.innerHTML = `<div class="empty-state">No user found with that username.</div>`;
        return;
    }

    el.innerHTML = `
        <div class="mod-user-card">
            <div class="mod-user-row"><span>Display name</span><strong>${escapeHtml(user.displayName)}</strong></div>
            <div class="mod-user-row"><span>Username</span><strong>${escapeHtml(user.username)}</strong></div>
            <div class="mod-user-row"><span>Admin</span><span class="status-pill ${user.isAdmin ? 'on' : ''}">${user.isAdmin ? 'Yes' : 'No'}</span></div>
            <div class="mod-user-row"><span>Banned</span><span class="status-pill ${user.isBanned ? 'banned' : ''}">${user.isBanned ? `Yes (${escapeHtml(user.bannedReason || '')})` : 'No'}</span></div>
            <div class="mod-actions">
                <button class="btn ${user.isBanned ? '' : 'danger'}" id="mod-ban-toggle" type="button">${user.isBanned ? 'Unban' : 'Ban'}</button>
                <button class="btn" id="mod-admin-toggle" type="button">${user.isAdmin ? 'Remove Admin' : 'Make Admin'}</button>
            </div>
        </div>
    `;

    document.getElementById('mod-ban-toggle').addEventListener('click', async () => {
        if (user.isBanned) {
            await setUserBanned(user.uid, false);
            showToast('User unbanned');
        } else {
            const reason = window.prompt('Ban reason:');
            if (reason === null) return;
            await setUserBanned(user.uid, true, reason);
            showToast('User banned');
        }
        const refreshed = await lookupUserByUsername(user.username);
        renderModResult(refreshed);
    });

    document.getElementById('mod-admin-toggle').addEventListener('click', async () => {
        await setUserAdmin(user.uid, !user.isAdmin);
        showToast(user.isAdmin ? 'Admin removed' : 'User is now an admin');
        const refreshed = await lookupUserByUsername(user.username);
        renderModResult(refreshed);
    });
}

function wireModeration() {
    document.getElementById('mod-search-btn').addEventListener('click', async () => {
        const username = document.getElementById('mod-search-input').value.trim();
        if (!username) return;
        const user = await lookupUserByUsername(username);
        renderModResult(user);
    });

    document.getElementById('delete-challenge-btn').addEventListener('click', async () => {
        const id = document.getElementById('delete-challenge-input').value.trim();
        if (!id) return;
        if (!window.confirm('Delete this challenge? This cannot be undone.')) return;
        await deleteChallenge(id);
        showToast('Challenge deleted');
        document.getElementById('delete-challenge-input').value = '';
    });
}

async function init() {
    const { profile } = await initShell();

    if (!profile.isAdmin) {
        blockNonAdminAccess();
        return;
    }

    await renderConfigForms();
    wireModeration();
}

init();
