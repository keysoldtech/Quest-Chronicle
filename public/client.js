// REBUILT: Quest & Chronicle Client-Side Logic (v6.0.0)
// This file has been completely rebuilt to use a unidirectional data flow model.
// 1. The server is the single source of truth.
// 2. The client receives the entire game state via a single `gameStateUpdate` event.
// 3. A master `renderUI` function is called, which redraws the entire interface
//    based on the new state. This eliminates all state synchronization bugs.

// --- 1. GLOBAL SETUP & STATE ---
const socket = io();
let myId = '';
let currentRoomState = {}; // The single, authoritative copy of the game state on the client.
let selectedGameMode = null; // For the menu screen
let selectedWeaponId = null; // For targeting UI
let selectedTargetId = null; // For narrative modal
let gameUIInitialized = false; // Flag to ensure game listeners are only attached once

// --- 2. CORE RENDERING ENGINE ---

/**
 * Creates an HTML element for a game card.
 * @param {object} card - The card data object.
 * @param {object} options - Configuration for card interactivity.
 * @returns {HTMLElement} The card element.
 */
function createCardElement(card, options = {}) {
    const { isEquippable = false, isAttackable = false, isTargetable = false } = options;
    const cardDiv = document.createElement('div');
    cardDiv.className = 'card';
    cardDiv.dataset.cardId = card.id;

    if (card.type === 'Monster') {
        cardDiv.dataset.monsterId = card.id;
        if (isTargetable) cardDiv.classList.add('targetable');
    }
    if (isAttackable) {
        cardDiv.classList.add('attackable-weapon');
        if (card.id === selectedWeaponId) cardDiv.classList.add('selected-weapon');
    }

    const typeInfo = card.category && card.category !== 'General' ? `${card.type} / ${card.category}` : card.type;
    const monsterHpHTML = card.type === 'Monster' ? `<div class="monster-hp">HP: ${card.currentHp}/${card.maxHp}</div>` : '';
    const monsterStatsHTML = card.type === 'Monster' ? `
        <div class="monster-stats-grid">
            <div class="card-bonus" title="Attack Bonus"><span class="material-symbols-outlined">colorize</span>+${card.attackBonus || 0}</div>
            <div class="card-bonus" title="Armor Class"><span class="material-symbols-outlined">security</span>${card.requiredRollToHit || 10}</div>
        </div>` : '';
    const weaponDiceHTML = card.type === 'Weapon' ? `<div class="card-bonus" title="Damage Dice"><span class="material-symbols-outlined">casino</span>${card.effect.dice}</div>` : '';
    
    let bonusHtml = '';
    if(card.effect?.bonuses){
        bonusHtml = `<div class="card-bonuses-grid">` + Object.entries(card.effect.bonuses).map(([key, value]) => {
            return `<div class="card-bonus" title="${key} bonus">${key.substring(0,3).toUpperCase()}: +${value}</div>`
        }).join('') + `</div>`;
    }


    cardDiv.innerHTML = `
        <div class="card-header">
             <h3 class="card-title ${card.name.includes(' of ') ? 'magical-item' : ''}">${card.name}</h3>
             ${monsterHpHTML}
        </div>
        <div class="card-content">
            <p class="card-effect">${card.effect?.description || card.description || ''}</p>
        </div>
        <div class="card-footer">
            ${monsterStatsHTML}
            ${weaponDiceHTML}
            ${bonusHtml}
            <p class="card-type">${typeInfo}</p>
        </div>
    `;

    if (isEquippable) {
        const equipBtn = document.createElement('button');
        equipBtn.textContent = 'Equip';
        equipBtn.className = 'btn btn-xs btn-success equip-btn';
        equipBtn.onclick = (e) => { e.stopPropagation(); socket.emit('equipItem', { cardId: card.id }); };
        cardDiv.appendChild(equipBtn);
    }
    return cardDiv;
}

/**
 * The master rendering function. Wipes and redraws the UI based on the current state.
 * This is the core of the new architecture.
 */
function renderUI() {
    if (!currentRoomState || !currentRoomState.id) return;
    const myPlayer = currentRoomState.players[myId];
    if (!myPlayer) return;

    const { players, gameState } = currentRoomState;
    const { phase } = gameState;
    const get = id => document.getElementById(id);

    // --- Phase 1: Show/Hide Major Screens ---
    get('menu-screen').classList.toggle('active', phase === 'lobby');
    const isGameActive = phase === 'class_selection' || phase === 'started';
    get('game-screen').classList.toggle('active', isGameActive);
    
    if (isGameActive && !gameUIInitialized) {
        initializeGameUIListeners();
        gameUIInitialized = true;
    }
    
    // --- Phase 2: Render Common Game Elements ---
    get('room-code').textContent = currentRoomState.id;
    get('mobile-room-code').textContent = currentRoomState.id;
    get('turn-counter').textContent = gameState.turnCount;

    // Player Lists
    const playerList = get('player-list');
    const mobilePlayerList = get('mobile-player-list');
    playerList.innerHTML = '';
    mobilePlayerList.innerHTML = '';
    const currentPlayerId = gameState.turnOrder[gameState.currentPlayerIndex];
    Object.values(players).forEach(p => {
        if (!p.role) return; // Don't render players still being set up
        const isCurrentTurn = p.id === currentPlayerId;
        const li = document.createElement('li');
        li.className = `player-list-item ${isCurrentTurn ? 'active' : ''} ${p.role.toLowerCase()}`;
        const npcTag = p.isNpc ? '<span class="npc-tag">[NPC]</span> ' : '';
        const roleText = p.role === 'DM' ? `<span class="player-role dm">DM</span>` : '';
        const classText = p.class ? `<span class="player-class"> - ${p.class}</span>` : '';
        const hpDisplay = phase === 'started' && p.role === 'Explorer' ? `HP: ${p.stats.currentHp} / ${p.stats.maxHp}` : '';
        li.innerHTML = `<div class="player-info"><span>${npcTag}${p.name}${classText}${roleText}</span></div><div class="player-hp">${hpDisplay}</div>`;
        playerList.appendChild(li);
        mobilePlayerList.appendChild(li.cloneNode(true));
    });

    // --- Phase 3: Phase-Specific Rendering ---
    const desktopCharacterPanel = get('character-panel-content');
    const mobileCharacterPanel = get('mobile-screen-character');
    
    if (phase === 'class_selection') {
        switchMobileScreen('character');
        if (myPlayer.class) {
            const waitingHTML = `<h2 class="panel-header">Class Chosen!</h2><p class="panel-content">Waiting for game to start...</p>`;
            desktopCharacterPanel.innerHTML = waitingHTML;
            mobileCharacterPanel.innerHTML = `<div class="panel mobile-panel">${waitingHTML}</div>`;
        } else {
            renderClassSelection(desktopCharacterPanel, mobileCharacterPanel);
        }
    } else if (phase === 'started') {
        renderGameplayState(myPlayer, gameState);
    }
}

/**
 * Renders the class selection UI into the specified containers.
 */
function renderClassSelection(desktopContainer, mobileContainer) {
    const classData = gameData.classes;
    const classSelectionHTML = `
        <h2 class="panel-header">Choose Your Class</h2>
        <div class="panel-content">
            <div class="class-grid">
                ${Object.entries(classData).map(([id, data]) => `
                    <div class="class-card" data-class-id="${id}">
                        <h3>${id}</h3>
                        <div class="class-stats">
                            ${Object.entries(data.stats).map(([stat, val]) => `<p><strong>${stat.toUpperCase()}</strong> ${val}</p>`).join('')}
                        </div>
                        <div class="class-ability">
                            <p><strong>${data.ability.name}</strong></p>
                            <p class="ability-desc">${data.ability.description}</p>
                        </div>
                        <button class="select-class-btn" data-class-id="${id}">Select ${id}</button>
                    </div>
                `).join('')}
            </div>
        </div>`;
    
    desktopContainer.innerHTML = classSelectionHTML;
    mobileContainer.innerHTML = `<div class="panel mobile-panel">${classSelectionHTML}</div>`;
}

/**
 * Renders all elements related to the active gameplay loop.
 */
function renderGameplayState(myPlayer, gameState) {
    const get = id => document.getElementById(id);
    const isMyTurn = gameState.turnOrder[gameState.currentPlayerIndex] === myPlayer.id;

    // Turn Indicator & Persistent Vitals
    const turnPlayer = currentRoomState.players[gameState.turnOrder[gameState.currentPlayerIndex]];
    const turnText = turnPlayer ? `${turnPlayer.name}'s Turn` : "Loading...";
    get('turn-indicator').textContent = turnText;
    get('mobile-turn-indicator').textContent = turnText;

    get('hp-counter-desktop').innerHTML = `<span class="material-symbols-outlined">favorite</span>${myPlayer.stats.currentHp}/${myPlayer.stats.maxHp}`;
    get('hp-counter-mobile').innerHTML = `<span class="material-symbols-outlined">favorite</span>${myPlayer.stats.currentHp}/${myPlayer.stats.maxHp}`;
    
    const apText = isMyTurn ? `${myPlayer.currentAp}/${myPlayer.stats.ap}` : `0/${myPlayer.stats.ap}`;
    get('ap-counter-desktop').innerHTML = `<span class="material-symbols-outlined">bolt</span>${apText}`;
    get('ap-counter-mobile').innerHTML = `<span class="material-symbols-outlined">bolt</span>${apText}`;

    // Action Bars
    get('fixed-action-bar').classList.toggle('hidden', !isMyTurn);
    get('mobile-action-bar').classList.toggle('hidden', !isMyTurn);
    
    // Board
    const board = get('board-cards');
    const mobileBoard = get('mobile-board-cards');
    board.innerHTML = ''; mobileBoard.innerHTML = '';
    gameState.board.monsters.forEach(monster => {
        const cardEl = createCardElement(monster, { isTargetable: isMyTurn && selectedWeaponId });
        cardEl.onclick = () => {
            if (!isMyTurn || !selectedWeaponId) return;
            selectedTargetId = monster.id;
            const weaponName = selectedWeaponId === 'unarmed' ? 'Fists' : myPlayer.equipment.weapon?.name;
            document.getElementById('narrative-prompt').textContent = `How do you attack with your ${weaponName}?`;
            document.getElementById('narrative-modal').classList.remove('hidden');
            document.getElementById('narrative-input').focus();
        };
        board.appendChild(cardEl);
        mobileBoard.appendChild(cardEl.cloneNode(true));
    });

    renderCharacterPanel(get('character-panel-content'), get('mobile-screen-character'), myPlayer);
    renderHandAndEquipment(myPlayer, isMyTurn);
    renderGameLog(get('game-log-content'), gameState.gameLog);
    renderGameLog(get('mobile-game-log'), gameState.gameLog);
    renderWorldEvents(get('world-events-container'), gameState.worldEvents);
    renderWorldEvents(get('mobile-world-events-container'), gameState.worldEvents);
}

function renderCharacterPanel(desktopContainer, mobileContainer, player) {
    const { stats, class: className } = player;
    const classData = gameData.classes[className];
    const statsHTML = `
        <h2 class="panel-header player-class-header">${player.name} - ${className}</h2>
        <div class="panel-content">
            <div class="player-stats-grid">
                ${Object.entries(stats).filter(([key]) => ['str','dex','con','int','wis','cha'].includes(key))
                .map(([key, val]) => `<div class="stat-line"><span class="stat-label">${key.toUpperCase()}</span><span class="stat-value">${val}</span></div>`).join('')}
            </div>
            <div class="player-stats-derived">
                 <div class="stat-line"><span class="material-symbols-outlined" style="color:var(--stat-color-hp)">favorite</span><span class="stat-label">Health</span><span class="stat-value">${stats.currentHp} / ${stats.maxHp}</span></div>
                 <div class="stat-line"><span class="material-symbols-outlined" style="color:var(--stat-color-ap)">bolt</span><span class="stat-label">Action Points</span><span class="stat-value">${player.currentAp} / ${stats.ap}</span></div>
                 <div class="stat-line"><span class="material-symbols-outlined" style="color:var(--stat-color-damage)">swords</span><span class="stat-label">Damage Bonus</span><span class="stat-value">+${stats.damageBonus}</span></div>
                 <div class="stat-line"><span class="material-symbols-outlined" style="color:var(--stat-color-shield)">shield</span><span class="stat-label">Shield Bonus</span><span class="stat-value">+${stats.shieldBonus}</span></div>
            </div>
            ${classData ? `<div class="class-ability-card">
                <p class="ability-title">${classData.ability.name}</p>
                <p class="ability-desc">${classData.ability.description}</p>
            </div>` : ''}
        </div>`;

    desktopContainer.innerHTML = statsHTML;
    mobileContainer.innerHTML = `<div class="panel mobile-panel">${statsHTML}</div>`;
}

function renderHandAndEquipment(player, isMyTurn) {
    const get = id => document.getElementById(id);
    const equipped = get('equipped-items');
    const mobileEquipped = get('mobile-equipped-items');
    equipped.innerHTML = ''; mobileEquipped.innerHTML = '';
    
    if (player.equipment.weapon === null) {
        const unarmedCard = createCardElement({ id: 'unarmed', name: 'Fists', type: 'Unarmed', effect: { description: 'Costs 1 AP.' }, apCost: 1 }, { isAttackable: isMyTurn });
        unarmedCard.onclick = () => {
            if (!isMyTurn) return;
            selectedWeaponId = (selectedWeaponId === 'unarmed') ? null : 'unarmed';
            renderUI();
        };
        equipped.appendChild(unarmedCard);
    }

    if (player.equipment.weapon) {
        const weaponCard = createCardElement(player.equipment.weapon, { isAttackable: isMyTurn });
        weaponCard.onclick = () => {
            if (!isMyTurn) return;
            selectedWeaponId = (selectedWeaponId === player.equipment.weapon.id) ? null : player.equipment.weapon.id;
            renderUI();
        };
        equipped.appendChild(weaponCard);
    }
    if (player.equipment.armor) {
        equipped.appendChild(createCardElement(player.equipment.armor));
    }

    const hand = get('player-hand');
    const mobileHand = get('mobile-player-hand');
    hand.innerHTML = ''; mobileHand.innerHTML = '';
    player.hand.forEach(card => {
        const isEquippable = (card.type === 'Weapon' || card.type === 'Armor') && isMyTurn;
        hand.appendChild(createCardElement(card, { isEquippable }));
    });
    
    mobileEquipped.innerHTML = equipped.innerHTML;
    mobileHand.innerHTML = hand.innerHTML;
}

function renderGameLog(logContainer, gameLog) {
    if (!gameLog || gameLog.length === 0) {
        logContainer.innerHTML = '<p class="empty-pool-text">No events have occurred yet.</p>';
        return;
    }
    logContainer.innerHTML = gameLog.map(entry => 
        `<div class="log-entry type-${entry.type}">
            <span class="log-turn">T${entry.turn}:</span> ${entry.message}
         </div>`
    ).join('');
}

function renderWorldEvents(container, worldEvents) {
    container.innerHTML = '';
    if (worldEvents.currentEvent) {
        container.appendChild(createCardElement(worldEvents.currentEvent));
    } else {
        container.innerHTML = '<p class="empty-pool-text">No active world event.</p>';
    }
}

// --- 3. UI EVENT LISTENERS ---
document.addEventListener('DOMContentLoaded', () => {
    // Menu Screen Listeners
    const get = id => document.getElementById(id);
    const playerNameInput = get('player-name-input');
    const createRoomBtn = get('create-room-btn');
    const joinRoomBtn = get('join-room-btn');
    const roomCodeInput = get('room-code-input');
    const customSettingsDiv = get('custom-settings');
    const modeButtons = document.querySelectorAll('.mode-btn');

    function validateCreateButton() {
        createRoomBtn.disabled = !(playerNameInput.value.trim().length > 0 && selectedGameMode !== null);
    }

    modeButtons.forEach(btn => btn.addEventListener('click', () => {
        modeButtons.forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        selectedGameMode = btn.dataset.mode;
        customSettingsDiv.classList.toggle('hidden', selectedGameMode !== 'Custom');
        validateCreateButton();
    }));

    playerNameInput.addEventListener('input', validateCreateButton);

    createRoomBtn.addEventListener('click', () => {
        socket.emit('createRoom', { 
            playerName: playerNameInput.value.trim(), 
            gameMode: selectedGameMode, 
            customSettings: selectedGameMode === 'Custom' ? {
                startWithWeapon: get('setting-weapon').checked,
                startWithArmor: get('setting-armor').checked,
                startingItems: parseInt(get('setting-items').value),
                startingSpells: parseInt(get('setting-spells').value),
                maxHandSize: parseInt(get('setting-hand-size').value),
                lootDropRate: parseInt(get('setting-loot-rate').value)
            } : null
        });
    });
    
    joinRoomBtn.addEventListener('click', () => {
        socket.emit('joinRoom', { 
            roomId: roomCodeInput.value.trim().toUpperCase(), 
            playerName: playerNameInput.value.trim()
        });
    });
});

function initializeGameUIListeners() {
    const get = id => document.getElementById(id);

    // Event delegation for dynamically created elements
    document.body.addEventListener('click', (e) => {
        const classBtn = e.target.closest('.select-class-btn');
        if (classBtn?.dataset?.classId) {
            socket.emit('chooseClass', { classId: classBtn.dataset.classId });
            return;
        }

        const navBtn = e.target.closest('.nav-btn');
        if (navBtn?.dataset?.screen) {
            switchMobileScreen(navBtn.dataset.screen);
            return;
        }
        
        const endTurnBtn = e.target.closest('#action-end-turn-btn, #mobile-action-end-turn-btn');
        if (endTurnBtn) {
             socket.emit('endTurn');
             return;
        }
        
        const guardBtn = e.target.closest('#action-guard-btn, #mobile-action-guard-btn');
        if (guardBtn) {
            socket.emit('playerAction', { action: 'guard' });
            return;
        }

        const challengeBtn = e.target.closest('#action-skill-challenge-btn, #mobile-action-skill-challenge-btn');
        if (challengeBtn) {
            socket.emit('playerAction', { action: 'skillChallenge', challengeId: 'sc-01' }); // Hardcoded for now
            return;
        }
    });

    // Narrative Modal
    get('narrative-cancel-btn').addEventListener('click', () => {
        get('narrative-modal').classList.add('hidden');
        selectedTargetId = null;
        selectedWeaponId = null;
        renderUI();
    });
    get('narrative-confirm-btn').addEventListener('click', () => {
        socket.emit('playerAction', { 
            action: 'attack', 
            cardId: selectedWeaponId, 
            targetId: selectedTargetId,
            description: get('narrative-input').value.trim()
        });
        get('narrative-input').value = '';
        get('narrative-modal').classList.add('hidden');
        selectedWeaponId = null;
        selectedTargetId = null;
    });
}

// --- 4. SOCKET EVENT HANDLERS ---
socket.on('connect', () => { myId = socket.id; });

socket.on('gameStateUpdate', (newState) => {
    if (typeof gameData === 'undefined') {
        window.gameData = {
            classes: {
                Barbarian: { stats: { str: 4, dex: 1, con: 3, int: 0, wis: 0, cha: 1 }, ability: { name: 'Unchecked Assault', description: 'Discard a Spell card to add +6 damage to your next successful weapon attack this turn.' } },
                Cleric:    { stats: { str: 1, dex: 0, con: 2, int: 1, wis: 4, cha: 2 }, ability: { name: 'Divine Aid', description: 'Gain a +1d4 bonus to your next d20 roll (attack or challenge) this turn.' } },
                Mage:      { stats: { str: 0, dex: 1, con: 1, int: 4, wis: 2, cha: 1 }, ability: { name: 'Mystic Recall', description: 'Draw one card from the Spell deck.' } },
                Ranger:    { stats: { str: 1, dex: 4, con: 2, int: 1, wis: 3, cha: 0 }, ability: { name: 'Hunters Mark', description: 'Mark a monster. All attacks against it deal +2 damage for one round.' } },
                Rogue:     { stats: { str: 1, dex: 4, con: 1, int: 2, wis: 0, cha: 3 }, ability: { name: 'Evasion', description: 'For one round, all attacks against you have disadvantage (DM rerolls hits).' } },
                Warrior:   { stats: { str: 3, dex: 2, con: 4, int: 0, wis: 1, cha: 1 }, ability: { name: 'Weapon Surge', description: 'Discard a Spell card to add +4 damage to your next successful weapon attack this turn.' } },
            }
        };
    }
    currentRoomState = newState;
    requestAnimationFrame(renderUI);
});

socket.on('actionError', (message) => {
    alert(`Error: ${message}`);
});

socket.on('attackRollResult', (data) => showRollResult(data));
socket.on('damageRollResult', (data) => showRollResult(data));


// --- 5. HELPER FUNCTIONS ---
function showRollResult(data) {
    const isMyAction = data.attacker.id === myId;
    const toastContainer = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast-roll-overlay ${isMyAction ? 'self' : 'other'}`;

    const title = data.dice ? "Damage Roll" : "Attack Roll";
    const resultColor = data.result === 'HIT' || data.result === 'CRITICAL HIT' || data.result === 'SUCCESS' ? 'var(--color-success)' : 'var(--color-danger)';
    
    let detailsHtml = '';
    if (data.dice) { // Damage roll
        detailsHtml = `Rolled ${data.roll} (${data.dice}) + ${data.bonus} bonus = <strong>${data.total} Damage</strong>`;
    } else { // Attack roll
        detailsHtml = `Rolled ${data.roll} (d20) + ${data.bonus} bonus = <strong>${data.total}</strong> vs DC ${data.required}`;
    }

    toast.innerHTML = `
        <div class="toast-roll-content">
            <h2 class="panel-header">${data.attacker.name}'s ${title}</h2>
            <p class="result-line" style="color:${resultColor};">${data.result || ''}</p>
            <p class="roll-details">${detailsHtml}</p>
        </div>
    `;
    
    toastContainer.appendChild(toast);
    
    setTimeout(() => { toast.classList.add('visible'); }, 10);
    setTimeout(() => {
        toast.classList.remove('visible');
        toast.addEventListener('transitionend', () => toast.remove());
    }, 2400);
}

function switchMobileScreen(screenName) {
    document.querySelectorAll('.mobile-screen').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(n => n.classList.remove('active'));
    document.getElementById(`mobile-screen-${screenName}`)?.classList.add('active');
    document.querySelector(`.nav-btn[data-screen="${screenName}"]`)?.classList.add('active');
}

// --- Service Worker ---
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(err => console.error('SW registration failed:', err));
    });
}