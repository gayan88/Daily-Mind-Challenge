import { initShell } from '../app.js';
import { ensureConfigDefaults, updateConfig } from '../utils/config.js';
import { AD_SLOTS, DEFAULT_ADS_CONFIG } from '../utils/ads.js';
import { lookupUserByUsername, setUserBanned, setUserAdmin } from './moderation.js';
import {
    listDailyWords, addDailyWord, updateDailyWord,
    listTournaments, createTournament, setTournamentActive, deleteTournament,
} from './wordle-admin.js';
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
        id: 'myChallengesPageSize',
        title: 'My Challenges Page Size',
        fields: [{ key: 'size', type: 'number', label: 'Challenges per page (Load More)' }],
    },
    {
        id: 'browseChallengesPageSize',
        title: 'Browse Challenges Page Size',
        fields: [{ key: 'size', type: 'number', label: 'Challenges per page (Load More)' }],
    },
    {
        id: 'leaderboardPageSize',
        title: 'Leaderboard Page Size',
        fields: [{ key: 'size', type: 'number', label: 'Rows per page (Load More)' }],
    },
    {
        id: 'challengeAttemptsPageSize',
        title: 'Challenge Attempts Page Size',
        fields: [{ key: 'size', type: 'number', label: 'Attempts per page (Load More)' }],
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

function wireCollapsibleSections() {
    document.querySelectorAll('[data-collapsible] > .admin-section-header, [data-collapsible] > .admin-subsection-header').forEach((btn) => {
        btn.addEventListener('click', () => {
            btn.closest('[data-collapsible]').classList.toggle('open');
        });
    });
}

function blockNonAdminAccess() {
    document.getElementById('admin-content').innerHTML = `
        <div class="section">
            <div class="empty-state">You don't have access to this page. <a href="/">Back to home</a></div>
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

// Renders each AD_SLOTS group into its own admin-panel container (General/Advertisements/Game
// wise sections), but all groups share one `slots` object -- saving a slot in any group re-reads
// the whole map and writes it back, so editing e.g. a Wordle ad never clobbers the Home ads.
async function renderAdSlotForms() {
    const adsConfig = await ensureConfigDefaults('ads', DEFAULT_ADS_CONFIG);
    let slots = { ...adsConfig.slots };

    function fieldId(slotId, field) {
        return `ad-${slotId}-${field}`;
    }

    function renderGroup(containerId, groupName) {
        const container = document.getElementById(containerId);
        const groupSlots = AD_SLOTS.filter((s) => s.group === groupName);

        container.innerHTML = groupSlots.map(({ id, label }) => {
            const slot = slots[id] || DEFAULT_ADS_CONFIG.slots[id];
            const imageFieldsHidden = slot.type !== 'image' ? 'hidden' : '';
            return `
                <div class="config-form">
                    <div class="config-form-title">${escapeHtml(label)}</div>
                    <div class="ad-slot-row">
                        <label class="ad-slot-enabled">
                            <input type="checkbox" id="${fieldId(id, 'enabled')}" ${slot.enabled ? 'checked' : ''}>
                            Enabled
                        </label>
                        <select id="${fieldId(id, 'type')}" data-ad-type-select="${id}">
                            <option value="google" ${slot.type === 'google' ? 'selected' : ''}>Google AdSense placeholder</option>
                            <option value="image" ${slot.type === 'image' ? 'selected' : ''}>Manual image ad</option>
                        </select>
                    </div>
                    <div class="ad-slot-image-fields" id="${fieldId(id, 'image-fields')}" ${imageFieldsHidden}>
                        <div class="form-field">
                            <label for="${fieldId(id, 'imageUrl')}">Image URL</label>
                            <input type="text" id="${fieldId(id, 'imageUrl')}" value="${escapeHtml(slot.imageUrl || '')}" placeholder="https://example.com/ad.png">
                        </div>
                        <div class="form-field">
                            <label for="${fieldId(id, 'linkUrl')}">Click-through URL</label>
                            <input type="text" id="${fieldId(id, 'linkUrl')}" value="${escapeHtml(slot.linkUrl || '')}" placeholder="https://example.com">
                        </div>
                    </div>
                    <button class="btn primary" data-save-ad-slot="${id}" type="button">Save</button>
                </div>
            `;
        }).join('');

        container.querySelectorAll('[data-ad-type-select]').forEach((select) => {
            select.addEventListener('change', () => {
                const slotId = select.dataset.adTypeSelect;
                document.getElementById(fieldId(slotId, 'image-fields')).hidden = select.value !== 'image';
            });
        });

        container.querySelectorAll('[data-save-ad-slot]').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const slotId = btn.dataset.saveAdSlot;
                slots = {
                    ...slots,
                    [slotId]: {
                        enabled: document.getElementById(fieldId(slotId, 'enabled')).checked,
                        type: document.getElementById(fieldId(slotId, 'type')).value,
                        imageUrl: document.getElementById(fieldId(slotId, 'imageUrl')).value.trim(),
                        linkUrl: document.getElementById(fieldId(slotId, 'linkUrl')).value.trim(),
                    },
                };
                await updateConfig('ads', { slots });
                showToast(`${AD_SLOTS.find((s) => s.id === slotId).label} saved`);
            });
        });
    }

    renderGroup('ad-slot-forms-home', 'home');
    renderGroup('ad-slot-forms-wordle', 'wordle');
    renderGroup('ad-slot-forms-sudoku', 'sudoku');
    renderGroup('ad-slot-forms-wordsearch', 'wordsearch');
}

async function renderDailyWordsTable() {
    const container = document.getElementById('daily-words-table');
    let words;
    try {
        words = await listDailyWords();
    } catch {
        container.innerHTML = `<div class="empty-state">Couldn't load daily words &mdash; check Firestore rules are deployed and try again.</div>`;
        return;
    }

    if (words.length === 0) {
        container.innerHTML = `<div class="empty-state">No words seeded yet. Add one above to activate the Daily Challenge.</div>`;
        return;
    }

    container.innerHTML = words.map((w) => `
        <div class="daily-word-row">
            <span class="daily-word-id">#${w.id}</span>
            <span class="daily-word-text">${escapeHtml(w.word)}</span>
            <button class="btn" data-edit-word="${w.id}" type="button">Edit</button>
        </div>
    `).join('');

    container.querySelectorAll('[data-edit-word]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const id = btn.dataset.editWord;
            const current = words.find((w) => String(w.id) === id);
            const next = window.prompt('Word text:', current.word);
            if (next === null || !next.trim()) return;
            try {
                await updateDailyWord(id, next);
                showToast(`Word #${id} updated`);
                renderDailyWordsTable();
            } catch {
                showToast("Couldn't save -- check Firestore rules are deployed");
            }
        });
    });
}

function wireDailyWordsAdd() {
    document.getElementById('daily-word-add-btn').addEventListener('click', async () => {
        const input = document.getElementById('daily-word-input');
        const word = input.value.trim();
        if (!/^[A-Za-z]{5}$/.test(word)) {
            showToast('Enter a 5-letter word');
            return;
        }
        try {
            const id = await addDailyWord(word);
            input.value = '';
            showToast(`Word #${id} added`);
            renderDailyWordsTable();
        } catch {
            showToast("Couldn't save -- check Firestore rules are deployed");
        }
    });
}

function parseWordsInput(raw) {
    return raw.split(/[,\n]/).map((w) => w.trim()).filter(Boolean);
}

async function renderTournamentsTable() {
    const container = document.getElementById('tournaments-table');
    let tournaments;
    try {
        tournaments = await listTournaments();
    } catch {
        container.innerHTML = `<div class="empty-state">Couldn't load tournaments &mdash; check Firestore rules are deployed and try again.</div>`;
        return;
    }

    if (tournaments.length === 0) {
        container.innerHTML = `<div class="empty-state">No tournaments yet. Create one below.</div>`;
        return;
    }

    container.innerHTML = tournaments.map((t) => `
        <div class="tournament-row">
            <span class="tournament-row-name">${escapeHtml(t.name)}</span>
            <span class="tournament-row-meta">${t.words.length} words &bull; ${t.timePerWordSeconds}s/word &bull; +${t.bonusPoints} bonus</span>
            <span class="status-pill ${t.active ? 'on' : ''}">${t.active ? 'Active' : 'Inactive'}</span>
            <div class="tournament-row-actions">
                <button class="btn" data-toggle-tournament="${t.id}" data-active="${t.active}" type="button">${t.active ? 'Deactivate' : 'Activate'}</button>
                <button class="btn danger" data-delete-tournament="${t.id}" type="button">Delete</button>
            </div>
        </div>
    `).join('');

    container.querySelectorAll('[data-toggle-tournament]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const id = btn.dataset.toggleTournament;
            const isActive = btn.dataset.active === 'true';
            try {
                await setTournamentActive(id, !isActive);
                renderTournamentsTable();
            } catch {
                showToast("Couldn't save -- check Firestore rules are deployed");
            }
        });
    });

    container.querySelectorAll('[data-delete-tournament]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            if (!window.confirm('Delete this tournament? Players\' progress on it will be orphaned.')) return;
            try {
                await deleteTournament(btn.dataset.deleteTournament);
                showToast('Tournament deleted');
                renderTournamentsTable();
            } catch {
                showToast("Couldn't delete -- check Firestore rules are deployed");
            }
        });
    });
}

function wireTournamentCreate() {
    document.getElementById('tournament-create-btn').addEventListener('click', async () => {
        const name = document.getElementById('tournament-name-input').value.trim();
        const words = parseWordsInput(document.getElementById('tournament-words-input').value);
        const timePerWordSeconds = Number(document.getElementById('tournament-time-input').value);
        const bonusPoints = Number(document.getElementById('tournament-bonus-input').value);

        if (!name) {
            showToast('Enter a tournament name');
            return;
        }
        if (words.length === 0 || !words.every((w) => /^[A-Za-z]{5}$/.test(w))) {
            showToast('Enter at least one 5-letter word, comma or newline-separated');
            return;
        }
        if (!timePerWordSeconds || timePerWordSeconds < 10) {
            showToast('Seconds per word must be at least 10');
            return;
        }

        try {
            await createTournament({ name, words, timePerWordSeconds, bonusPoints });
            document.getElementById('tournament-name-input').value = '';
            document.getElementById('tournament-words-input').value = '';
            showToast('Tournament created');
            renderTournamentsTable();
        } catch {
            showToast("Couldn't save -- check Firestore rules are deployed");
        }
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
}

async function init() {
    const { profile } = await initShell();

    if (!profile.isAdmin) {
        blockNonAdminAccess();
        return;
    }

    wireCollapsibleSections();
    await renderConfigForms();
    await renderAdSlotForms();
    wireModeration();
    wireDailyWordsAdd();
    await renderDailyWordsTable();
    wireTournamentCreate();
    await renderTournamentsTable();
}

init();
