document.addEventListener("DOMContentLoaded", async () => {
    const locale = await fetch('locale/es.json').then(res => res.json());
    const t = (path, params = {}) => {
        const keys = path.split('.');
        let result = locale;
        for (const k of keys) {
            result = result?.[k];
        }
        if (typeof result !== 'string') return '';
        return result.replace(/\{(\w+)\}/g, (_, key) => params[key] ?? '');
    };

    document.title = t('app.title');
    // -----------------------------
    // App State
    // -----------------------------
    const state = {
        step: "setup", // "setup" | "play"
        playerCount: 3,
        players: [
            { id: "p1", name: "P1" },
            { id: "p2", name: "P2" },
            { id: "p3", name: "P3" },
        ],
        rounds: 17,
        roundsData: [],
        bidsDialog: { open: false, roundIndex: null },
        actualsDialog: { open: false, roundIndex: null },
    };

    // -----------------------------
    // DOM References
    // -----------------------------
    const appContainer = document.getElementById("app-container");
    const bidsDialogEl = document.getElementById("bids-dialog");
    const actualsDialogEl = document.getElementById("actuals-dialog");
    const scoresPanelContainer = document.getElementById('scores-panel-container');
    const totalsPanelContainer = document.getElementById('totals-panel-container');
    const scoresPanelToggle = document.getElementById('scores-panel-toggle');
    const totalsPanelToggle = document.getElementById('totals-panel-toggle');
    if (scoresPanelToggle) scoresPanelToggle.title = t('play.panels.toggleScores');
    if (totalsPanelToggle) totalsPanelToggle.title = t('play.panels.toggleTotals');

    // -----------------------------
    // Core Game Logic (Pure Functions)
    // -----------------------------
    const roundsForPlayers = (P) => Math.floor(52 / P);
    const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
    const isComplete = (arr) => arr.every((v) => typeof v === "number");
    const roundScore = (bid, actual) => (actual === bid ? 10 + actual : 10 - Math.max(bid, actual));

    function recomputeRound(round, players) {
        const scores = {};
        let roundTotal = 0;

        const bidsVals = players.map((p) => round.bids[p.id]);
        const actualVals = players.map((p) => round.actuals[p.id]);
        const bidsAll = isComplete(bidsVals);
        const actualsAll = isComplete(actualVals);
        const bidsSum = bidsAll ? bidsVals.reduce((a, b) => a + b, 0) : 0;
        const actualsSum = actualsAll ? actualVals.reduce((a, b) => a + b, 0) : 0;

        const bidsInvalid = bidsAll ? bidsSum === round.r : false;
        const actualsInvalid = actualsAll ? actualsSum !== round.r : false;

        players.forEach((p) => {
            const b = round.bids[p.id];
            const a = round.actuals[p.id];
            if (typeof b === "number" && typeof a === "number") {
                const s = roundScore(b, a);
                scores[p.id] = s;
                roundTotal += s;
            } else {
                scores[p.id] = 0;
            }
        });
        return { ...round, scores, roundTotal, bidsInvalid, actualsInvalid };
    }

    function computeTallies(roundsData, players) {
        const cumulative = {};
        const sharePct = {};
        const exactHits = {};

        players.forEach((p) => { cumulative[p.id] = 0; exactHits[p.id] = 0; });

        roundsData.forEach((rd) => {
            if (rd.phase !== "done") return;
            players.forEach((p) => {
                cumulative[p.id] += rd.scores[p.id] ?? 0;
                const b = rd.bids[p.id];
                const a = rd.actuals[p.id];
                if (typeof b === "number" && typeof a === "number" && b === a) exactHits[p.id] += 1;
            });
        });

        const cumTotal = Object.values(cumulative).reduce((a, b) => a + b, 0);
        players.forEach((p) => { sharePct[p.id] = cumTotal > 0 ? (100 * cumulative[p.id]) / cumTotal : 0; });
        return { cumulative, sharePct, exactHits, cumTotal };
    }

    const findLeaders = (cum) => {
        const entries = Object.entries(cum);
        if (!entries.length) return [];
        const max = Math.max(...entries.map(([, v]) => v));
        return entries.filter(([, v]) => v === max).map(([k]) => k);
    };

    function buildEmptyRounds(R, players) {
        return Array.from({ length: R }, (_, i) => {
            const r = i + 1;
            const bids = {};
            const actuals = {};
            const scores = {};
            players.forEach((p) => { bids[p.id] = null; actuals[p.id] = null; scores[p.id] = 0; });
            return { r, bids, actuals, scores, roundTotal: 0, bidsInvalid: false, actualsInvalid: false, phase: "bids" };
        });
    }

    // -----------------------------
    // State Changers & Actions
    // -----------------------------
    function startGame(playerNames) {
        const P = clamp(playerNames.length, 2, 6);
        const newPlayers = playerNames.slice(0, P).map((n, i) => ({ id: `p${i + 1}`, name: n.trim() || t('setup.playerPlaceholder', { index: i + 1 }) }));
        const R = roundsForPlayers(P);
        
        state.players = newPlayers;
        state.playerCount = P;
        state.rounds = R;
        state.roundsData = buildEmptyRounds(R, newPlayers);
        state.step = "play";
        render();
    }
    
    function restartGame() {
        startGame(state.players.map(p => p.name));
    }

    function changePlayers() {
        state.step = "setup";
        render();
    }
    
    function updatePlayerCount(newCount) {
        const P = clamp(newCount, 2, 6);
        state.playerCount = P;
        const currentPlayers = state.players.map(p => p.name);
        const nextPlayers = Array.from({ length: P }, (_, i) => ({
            id: `p${i + 1}`,
            name: currentPlayers[i] || t('setup.playerPlaceholder', { index: i + 1 })
        }));
        state.players = nextPlayers;
        state.rounds = roundsForPlayers(P);
        render();
    }
    
    function updatePlayerName(index, name) {
        if (state.players[index]) {
            state.players[index].name = name;
        }
    }
    
    function openBidsDialog(roundIndex) {
        state.bidsDialog = { open: true, roundIndex };
        renderBidsDialog();
    }

    function openActualsDialog(roundIndex) {
        state.actualsDialog = { open: true, roundIndex };
        renderActualsDialog();
    }

    function saveBids(roundIndex, newBids) {
        const round = state.roundsData[roundIndex];
        const updatedRound = recomputeRound({ ...round, bids: newBids }, state.players);
        state.roundsData[roundIndex] = updatedRound;
    }
    
    function lockBids(roundIndex) {
        const round = state.roundsData[roundIndex];
        const bidsAll = state.players.every((p) => typeof round.bids[p.id] === "number");
        if (bidsAll && !round.bidsInvalid) {
            state.roundsData[roundIndex].phase = "actuals";
        }
    }

    function saveAndLockBids(roundIndex, newBids) {
        saveBids(roundIndex, newBids);
        lockBids(roundIndex);
        bidsDialogEl.close();
        render();
    }
    
    function saveActuals(roundIndex, newActuals) {
        const round = state.roundsData[roundIndex];
        const updatedRound = recomputeRound({ ...round, actuals: newActuals }, state.players);
        state.roundsData[roundIndex] = updatedRound;
    }

    function finalizeRound(roundIndex) {
        const round = state.roundsData[roundIndex];
        const actsAll = Object.values(round.actuals).every((v) => typeof v === "number");
        if(actsAll && !round.actualsInvalid) {
            state.roundsData[roundIndex].phase = "done";
        }
    }

    function saveAndFinalizeActuals(roundIndex, newActuals) {
        saveActuals(roundIndex, newActuals);
        finalizeRound(roundIndex);
        actualsDialogEl.close();
        render();
    }
    
    function unlockBids(roundIndex) {
        const round = state.roundsData[roundIndex];
        const emptyActuals = {};
        state.players.forEach(p => { emptyActuals[p.id] = null; });
        round.phase = "bids";
        round.actuals = emptyActuals;
        state.roundsData[roundIndex] = recomputeRound(round, state.players);
        render();
    }
    
    function revertFinal(roundIndex) {
        state.roundsData[roundIndex].phase = "actuals";
        render();
    }


    // -----------------------------
    // Render Functions
    // -----------------------------

    function renderHeader() {
        const controls = state.step === 'play'
            ? `<button id="change-players-btn" class="btn btn-secondary">${t('app.header.changePlayers')}</button>
               <button id="restart-btn" class="btn btn-ghost btn-icon" title="${t('app.header.restart')}"><i data-lucide="refresh-cw"></i></button>`
            : `<button id="restart-btn" class="btn btn-ghost btn-icon" title="${t('app.header.restart')}"><i data-lucide="refresh-cw"></i></button>`;

        return `
            <header>
                <h1>${t('app.header.title')}</h1>
                <div class="controls">${controls}</div>
            </header>
        `;
    }

    function renderSetup() {
        const R = roundsForPlayers(state.playerCount);
        const playerInputs = state.players.map((p, i) => `
            <div>
                <label for="name-${i}" class="label">${t('setup.playerNameLabel', { index: i + 1 })}</label>
                <div style="position: relative;">
                    <input
                        id="name-${i}"
                        class="input player-name-input"
                        placeholder="${t('setup.playerPlaceholder', { index: i + 1 })}"
                        value="${p.name}"
                        data-index="${i}"
                        style="padding-right: 2rem;"
                    >
                    <button
                        class="clear-name-btn"
                        data-action="clear-name"
                        data-index="${i}"
                        title="${t('setup.clearName')}"
                        style="position:absolute; right:0.5rem; top:50%; transform:translateY(-50%); background:transparent; border:none; color: var(--slate-400); font-size: 1rem; line-height:1; cursor:pointer;"
                    >×</button>
                </div>
            </div>
        `).join('');

        const canStart = state.players.every(p => p.name && p.name.trim().length > 0);

        return `
            <div class="card">
                <div class="card-header"><h2 class="card-title">${t('setup.gameConfigTitle')}</h2></div>
                <div class="card-content" style="display: flex; flex-direction: column; gap: 1rem;">
                    <div>
                        <label for="player-count" class="label">${t('setup.playerCountLabel')}</label>
                        <div class="input-group" style="display: flex; align-items: center; gap: 0.5rem;">
                            <button class="btn btn-secondary btn-icon" data-action="player-count-dec">-</button>
                            <input
                                id="player-count"
                                class="input"
                                type="number"
                                min="2"
                                max="6"
                                step="1"
                                value="${state.playerCount}"
                                style="text-align: center;"
                            >
                            <button class="btn btn-secondary btn-icon" data-action="player-count-inc">+</button>
                        </div>
                        <p class="text-sm" style="margin-top: 0.5rem; color: var(--slate-300);">
                            ${t('setup.roundsFormula', { rounds: `<span style="font-weight: 600; color: var(--cyan-300);">${R}</span>` })}
                        </p>
                    </div>
                    <div class="setup-grid">${playerInputs}</div>
                    <div style="padding-top: 0.5rem;">
                        <button id="start-game-btn" class="btn btn-primary" ${!canStart ? 'disabled' : ''}>${t('setup.startGame')}</button>
                    </div>
                </div>
            </div>
        `;
    }

    function renderPlay() {
        const tallies = computeTallies(state.roundsData, state.players);
        const leaders = findLeaders(tallies.cumulative);
        const currentRoundIndex = state.roundsData.findIndex((r) => r.phase !== "done");

        // NEW: fixed column widths and table min-width (prevents shrinking on mobile)
        const minTableWidth =
            80 /* # */ +
            state.players.length * 2 * 60 /* two cols per player @60px */ +
            140 /* acciones */;
        const colGroup = `
            <colgroup>
                <col style="width:80px;">
                ${state.players.map(() => `
                    <col style="width:60px;">
                    <col style="width:60px;">
                `).join('')}
                <col style="width:140px;">
            </colgroup>
        `;

        // Main Scoreboard Table
        const tableHeader = `
            <thead>
                <tr>
                    <th rowspan="2" style="width: 80px;">#</th>
                    ${state.players.map(p => `
                        <th colspan="2">
                            <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; gap:0.25rem; line-height:1;">
                                ${leaders.includes(p.id) && tallies.cumTotal > 0 ? `<i data-lucide="crown" style="width:14px; height:14px; color:#facc15;"></i>` : ''}
                                <span>${p.name}</span>
                            </div>
                        </th>
                    `).join('')}
                    <th rowspan="2" style="width: 140px;">${t('play.table.actions')}</th>
                </tr>
                <tr>
                    ${state.players.map(() => `
                        <th style="color: var(--cyan-300);">${t('play.table.bid')}</th>
                        <th style="color: var(--fuchsia-300);">${t('play.table.actual')}</th>
                    `).join('')}
                </tr>
            </thead>`;

        const tableBody = `
            <tbody>
                ${state.roundsData.map((rd, idx) => {
                    const isCurrent = idx === currentRoundIndex || currentRoundIndex === -1;
                    const commander = state.players[idx % state.players.length];
                    
                    let rowClass = '';
                    if (isCurrent && rd.phase !== "done") rowClass += 'current-round-row ';
                    if (rd.bidsInvalid || rd.actualsInvalid) rowClass += 'invalid-round-row';

                    const bidsAll = state.players.every((p) => typeof rd.bids[p.id] === "number");
                    const canLockBids = bidsAll && !rd.bidsInvalid && rd.phase === "bids";
                    const canFinalize = rd.phase === "actuals" && !rd.actualsInvalid && state.players.every((p) => typeof rd.actuals[p.id] === "number");

                    let flowContent = '';
                    if (rd.phase === 'bids') {
                        flowContent = `
                            ${rd.bidsInvalid ? `<span class="badge badge-invalid" title="${t('play.table.bidsInvalid')}"><i data-lucide="alert-triangle" style="width:12px; height:12px;"></i></span>` : ''}
                            <button class="btn btn-cyan" data-action="open-bids" data-round-index="${idx}">
                                <i data-lucide="list-ordered" style="width:16px; height:16px;"></i> ${t('play.table.enterBid')}
                            </button>
                        `;
                    } else if (rd.phase === 'actuals') {
                        flowContent = `
                            ${rd.actualsInvalid ? `<span class="badge badge-invalid" title="${t('play.table.actualsInvalid')}"><i data-lucide="alert-triangle" style="width:12px; height:12px;"></i></span>` : ''}
                            <button class="btn btn-secondary btn-icon" title="${t('play.table.unlockBids')}" data-action="unlock-bids" data-round-index="${idx}">
                                <i data-lucide="unlock" style="width:16px; height:16px;"></i>
                            </button>
                            <button class="btn btn-fuchsia" data-action="open-actuals" data-round-index="${idx}">
                                <i data-lucide="calculator" style="width:16px; height:16px;"></i> ${t('play.table.enterActual')}
                            </button>
                        `;
                    } else if (rd.phase === 'done') {
                        flowContent = `
                            <button class="btn btn-secondary" title="${t('play.table.undo')}" data-action="revert-final" data-round-index="${idx}">${t('play.table.undo')}</button>
                        `;
                    }

                    return `
                        <tr class="${rowClass}">
                            <td>
                                <span class="text-sky-round" style="font-weight: 600;">${rd.r}</span>
                                <span class="commander-name">${commander.name}</span>
                            </td>
                            ${state.players.map(p => {
                                const bidVal = rd.bids[p.id];
                                const actVal = rd.actuals[p.id];
                                return `
                                    <td class="font-mono" style="font-size: 1.25rem; text-align: center;">
                                        ${typeof bidVal === 'number' ? `<span class="text-cyan-bid">${bidVal}</span>` : `<span class="text-placeholder">—</span>`}
                                    </td>
                                    <td class="font-mono" style="font-size: 1.25rem; text-align: center;">
                                        ${rd.phase === 'bids' ? `<span class="text-placeholder">—</span>` : (typeof actVal === 'number' ? `<span class="text-fuchsia-act">${actVal}</span>` : `<span class="text-placeholder">—</span>`)}
                                    </td>
                                `;
                            }).join('')}
                            <td><div style="display:flex; justify-content:center; align-items:center; gap:0.5rem;">${flowContent}</div></td>
                        </tr>
                    `;
                }).join('')}
            </tbody>`;
        
        const mainBoard = `
            <div class="card">
                <div class="card-content" style="padding: 0;">
                    <div class="table-wrapper" style="overflow-x: auto; -webkit-overflow-scrolling: touch;">
                        <table style="table-layout: fixed; min-width: ${minTableWidth}px;">
                            ${colGroup}
                            ${tableHeader}
                            ${tableBody}
                        </table>
                    </div>
                </div>
            </div>
        `;
        
        renderScoresPanel(tallies);
        renderTotalsPanel(tallies);

        return mainBoard;
    }

    function renderScoresPanel() {
        const header = `
            <thead>
                <tr>
                    <th style="width: 56px;">#</th>
                    ${state.players.map(p => `<th style="color: var(--emerald-200);">${p.name}</th>`).join('')}
                </tr>
            </thead>
        `;
        const body = `
            <tbody>
                ${state.roundsData.map((rd, idx) => `
                    <tr>
                        <td class="text-sky-round" style="font-weight: 600;">${rd.r}</td>
                        ${state.players.map(p => {
                            const hasScore = typeof rd.bids[p.id] === 'number' && typeof rd.actuals[p.id] === 'number';
                            if (!hasScore) return `<td class="text-placeholder">—</td>`;
                            
                            const s = rd.scores[p.id];
                            const exact = rd.bids[p.id] === rd.actuals[p.id];
                            const scoreClass = exact ? 'score-exact' : (s < 0 ? 'score-neg' : 'score-miss');
                            
                            return `<td class="font-mono ${scoreClass}" style="font-size: 1.125rem;">${s}</td>`;
                        }).join('')}
                    </tr>
                `).join('')}
            </tbody>
        `;
        document.getElementById('scores-panel-content').innerHTML = `
            <div class="card">
                <div class="card-header"><h2 class="card-title">${t('play.panels.scores')}</h2></div>
                <div class="card-content" style="padding: 0;">
                    <div class="table-wrapper" style="overflow-x: auto; -webkit-overflow-scrolling: touch;">
                        <table>${header}${body}</table>
                    </div>
                </div>
            </div>
        `;
    }

    function renderTotalsPanel(tallies) {
        const leaders = findLeaders(tallies.cumulative);
        const playerRows = state.players.map(p => `
            <div class="totals-row">
                <div class="totals-player-info" style="display:flex; flex-direction:column; align-items:center; gap:0.25rem;">
                    ${leaders.includes(p.id) && tallies.cumTotal > 0 ? `<i data-lucide="crown" style="width:14px; height:14px; color:#facc15;"></i>` : ''}
                    <span>${p.name}</span>
                </div>
                <div class="totals-stats">
                    <div>
                        <div class="stat-label">${t('play.panels.statAccumulated')}</div>
                        <div class="stat-value" style="color: var(--sky-300);">${tallies.cumulative[p.id]}</div>
                    </div>
                    <div>
                        <div class="stat-label">${t('play.panels.statPercentage')}</div>
                        <div class="stat-value" style="color: var(--fuchsia-300);">${tallies.sharePct[p.id].toFixed(1)}%</div>
                    </div>
                    <div>
                        <div class="stat-label">${t('play.panels.statExactHits')}</div>
                        <div class="stat-value" style="color: var(--emerald-300);">${tallies.exactHits[p.id]}</div>
                    </div>
                </div>
            </div>
        `).join('');

        document.getElementById('totals-panel-content').innerHTML = `
            <div class="card">
                <div class="card-header"><h2 class="card-title">${t('play.panels.totals')}</h2></div>
                <div class="card-content">
                    <div class="totals-grid">
                        ${playerRows}
                        <div class="totals-row summary">
                            <span style="color: var(--slate-400);">${t('play.panels.summaryTotal')}</span>
                            <span class="stat-value" style="color: var(--indigo-300);">${tallies.cumTotal}</span>
                        </div>
                    </div>
                </div>
            </div>`;
    }

    function renderBidsDialog() {
        const { open, roundIndex } = state.bidsDialog;
        if (!open) { bidsDialogEl.close(); return; }

        const rd = state.roundsData[roundIndex];
        const tempBids = { ...rd.bids };

        const updateDialogState = () => {
            const sum = Object.values(tempBids).reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0);
            const allFilled = state.players.every(p => typeof tempBids[p.id] === 'number');
            const isValid = allFilled && sum !== rd.r;

            const sumLabel = t('dialogs.bids.sum', { sum });
            const eqLabel = sum === rd.r ? t('dialogs.bids.sumEqual', { round: rd.r }) : t('dialogs.bids.sumNotEqual', { round: rd.r });
            bidsDialogEl.querySelector('#bids-sum-badge').innerHTML = `${sumLabel} ${eqLabel}`;
            bidsDialogEl.querySelector('#bids-sum-badge').className = `badge ${sum === rd.r ? 'badge-invalid' : 'badge-cyan'}`;
            bidsDialogEl.querySelector('#save-bids-btn').disabled = !isValid;
        };

        const content = `
            <div class="dialog-header">
                <h2>
                    <span>${t('dialogs.bids.title', { round: rd.r })}</span>
                    <span id="bids-sum-badge" class="badge"></span>
                </h2>
                <p>${t('dialogs.bids.instruction', { round: rd.r })}</p>
            </div>
            <div class="dialog-body">
                ${state.players.map(p => `
                    <div class="dialog-player-row">
                        <span class="player-name">${p.name}</span>
                        <div class="input-group">
                            <button class="btn btn-secondary btn-icon" data-action="dec" data-player-id="${p.id}">-</button>
                            <input type="number" class="input bid-input" min="0" max="${rd.r}" value="${tempBids[p.id] ?? ''}" data-player-id="${p.id}">
                            <button class="btn btn-secondary btn-icon" data-action="inc" data-player-id="${p.id}">+</button>
                        </div>
                    </div>
                `).join('')}
            </div>
            <div class="dialog-footer">
                <span class="footer-note">${t('dialogs.bids.allRequired')}</span>
                <div class="footer-actions">
                    <button id="cancel-bids-btn" class="btn btn-secondary">${t('dialogs.bids.cancel')}</button>
                    <button id="save-bids-btn" class="btn btn-cyan">${t('dialogs.bids.save')}</button>
                </div>
            </div>
        `;
        
        bidsDialogEl.querySelector('.dialog-content-wrapper').innerHTML = content;
        updateDialogState();
        bidsDialogEl.showModal();

        bidsDialogEl.querySelectorAll('.bid-input, .btn-icon').forEach(el => {
            const playerId = el.dataset.playerId;
            const input = bidsDialogEl.querySelector(`.bid-input[data-player-id="${playerId}"]`);
            
            if (el.tagName === 'INPUT') {
                el.addEventListener('input', () => {
                    const val = el.value === '' ? null : clamp(parseInt(el.value, 10), 0, rd.r);
                    tempBids[playerId] = val;
                    if (el.value !== '' && Number.isNaN(val)) tempBids[playerId] = null; else el.value = val;
                    updateDialogState();
                });
            } else { // Button
                el.addEventListener('click', () => {
                    const currentVal = tempBids[playerId] ?? 0;
                    const change = el.dataset.action === 'inc' ? 1 : -1;
                    const newVal = clamp(currentVal + change, 0, rd.r);
                    tempBids[playerId] = newVal;
                    input.value = newVal;
                    updateDialogState();
                });
            }
        });

        bidsDialogEl.querySelector('#cancel-bids-btn').onclick = () => bidsDialogEl.close();
        bidsDialogEl.querySelector('#save-bids-btn').onclick = () => saveAndLockBids(roundIndex, tempBids);
    }
    
    function renderActualsDialog() {
        const { open, roundIndex } = state.actualsDialog;
        if (!open) { actualsDialogEl.close(); return; }

        const rd = state.roundsData[roundIndex];
        const tempActuals = { ...rd.actuals };

        const updateDialogState = () => {
            const sum = Object.values(tempActuals).reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0);
            const allFilled = state.players.every(p => typeof tempActuals[p.id] === 'number');
            const isValid = allFilled && sum === rd.r;

            actualsDialogEl.querySelector('#actuals-sum-badge').innerHTML = t('dialogs.actuals.sum', { sum, round: rd.r });
            actualsDialogEl.querySelector('#actuals-sum-badge').className = `badge ${sum === rd.r ? 'badge-fuchsia' : 'badge-invalid'}`;
            actualsDialogEl.querySelector('#save-actuals-btn').disabled = !isValid;
        };

        const content = `
            <div class="dialog-header">
                <h2>
                    <span>${t('dialogs.actuals.title', { round: rd.r })}</span>
                    <span id="actuals-sum-badge" class="badge"></span>
                </h2>
                <p>${t('dialogs.actuals.instruction', { round: rd.r })}</p>
            </div>
            <div class="dialog-body">
                ${state.players.map(p => `
                    <div class="dialog-player-row">
                        <span class="player-name">${p.name}</span>
                        <div class="input-group">
                            <button class="btn btn-secondary btn-icon" data-action="dec" data-player-id="${p.id}">-</button>
                            <input type="number" class="input actual-input" min="0" max="${rd.r}" value="${tempActuals[p.id] ?? ''}" data-player-id="${p.id}">
                            <button class="btn btn-secondary btn-icon" data-action="inc" data-player-id="${p.id}">+</button>
                        </div>
                    </div>
                `).join('')}
            </div>
            <div class="dialog-footer">
                <span class="footer-note">${t('dialogs.actuals.allRequired')}</span>
                <div class="footer-actions">
                    <button id="cancel-actuals-btn" class="btn btn-secondary">${t('dialogs.actuals.cancel')}</button>
                    <button id="save-actuals-btn" class="btn btn-fuchsia">${t('dialogs.actuals.save')}</button>
                </div>
            </div>
        `;

        actualsDialogEl.querySelector('.dialog-content-wrapper').innerHTML = content;
        updateDialogState();
        actualsDialogEl.showModal();

        actualsDialogEl.querySelectorAll('.actual-input, .btn-icon').forEach(el => {
            const playerId = el.dataset.playerId;
            const input = actualsDialogEl.querySelector(`.actual-input[data-player-id="${playerId}"]`);

            if (el.tagName === 'INPUT') {
                 el.addEventListener('input', () => {
                    const val = el.value === '' ? null : clamp(parseInt(el.value, 10), 0, rd.r);
                    tempActuals[playerId] = val;
                    if (el.value !== '' && Number.isNaN(val)) tempActuals[playerId] = null; else el.value = val;
                    updateDialogState();
                });
            } else { // Button
                el.addEventListener('click', () => {
                    const currentVal = tempActuals[playerId] ?? 0;
                    const change = el.dataset.action === 'inc' ? 1 : -1;
                    const newVal = clamp(currentVal + change, 0, rd.r);
                    tempActuals[playerId] = newVal;
                    input.value = newVal;
                    updateDialogState();
                });
            }
        });
        
        actualsDialogEl.querySelector('#cancel-actuals-btn').onclick = () => actualsDialogEl.close();
        actualsDialogEl.querySelector('#save-actuals-btn').onclick = () => saveAndFinalizeActuals(roundIndex, tempActuals);
    }


    // -----------------------------
    // Main Render & Event Delegation
    // -----------------------------
    function render() {
        let content = renderHeader();
        if (state.step === "setup") {
            content += renderSetup();
            scoresPanelContainer.classList.add('closed');
            totalsPanelContainer.classList.add('closed');
            // Hide panel toggles on setup screen
            if (scoresPanelToggle) scoresPanelToggle.style.display = 'none';
            if (totalsPanelToggle) totalsPanelToggle.style.display = 'none';
        } else {
            content += renderPlay();
            // Show panel toggles during play
            if (scoresPanelToggle) scoresPanelToggle.style.display = '';
            if (totalsPanelToggle) totalsPanelToggle.style.display = '';
        }
        appContainer.innerHTML = content;
        lucide.createIcons(); // Render icons
    }

    // Event delegation
    appContainer.addEventListener("click", (e) => {
        const target = e.target.closest("button");
        if (!target) return;

        // Header buttons
        if (target.id === 'restart-btn') restartGame();
        if (target.id === 'change-players-btn') changePlayers();
        
        // Setup buttons
        if (target.id === 'start-game-btn') {
            const names = Array.from(document.querySelectorAll('.player-name-input')).map(input => input.value);
            startGame(names);
        }

        // Setup inc/dec player count
        const action = target.dataset.action;
        if (action === 'player-count-dec') updatePlayerCount(state.playerCount - 1);
        if (action === 'player-count-inc') updatePlayerCount(state.playerCount + 1);

        // Clear a player's name
        if (action === 'clear-name') {
            const idx = parseInt(target.dataset.index, 10);
            updatePlayerName(idx, '');
            const input = document.getElementById(`name-${idx}`);
            if (input) input.value = '';
            const startBtn = document.getElementById('start-game-btn');
            if (startBtn) startBtn.disabled = true;
            return; // no further action needed
        }

        // Game board actions
        const roundIndex = parseInt(target.dataset.roundIndex, 10);
        if (action === 'open-bids') openBidsDialog(roundIndex);
        if (action === 'open-actuals') openActualsDialog(roundIndex);
        if (action === 'unlock-bids') unlockBids(roundIndex);
        if (action === 'revert-final') revertFinal(roundIndex);
    });
    
    appContainer.addEventListener('input', (e) => {
        // Setup screen inputs
        if (e.target.id === 'player-count') {
            updatePlayerCount(parseInt(e.target.value, 10));
        }
        if (e.target.classList.contains('player-name-input')) {
            const index = parseInt(e.target.dataset.index, 10);
            updatePlayerName(index, e.target.value);
            // Re-render to enable/disable start button
            const canStart = state.players.every(p => p.name && p.name.trim().length > 0);
            document.getElementById('start-game-btn').disabled = !canStart;
        }
    });

    // Panel Toggles
    scoresPanelToggle.addEventListener('click', () => scoresPanelContainer.classList.toggle('closed'));
    totalsPanelToggle.addEventListener('click', () => totalsPanelContainer.classList.toggle('closed'));

    // -----------------------------
    // Initial Load
    // -----------------------------
    render();
});