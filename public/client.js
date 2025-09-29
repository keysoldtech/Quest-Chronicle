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

    cardDiv.innerHTML = `
        <div class="card-header">
             <h3 class="card-title">${card.name}</h3>
             ${monsterHpHTML}
        </div>
        <div class="card-content">
            <p class="card-effect">${card.effect?.description || card.description || ''}</p>
        </div>
        <div class="card-footer">
            ${monsterStatsHTML}
            ${weaponDiceHTML}
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
    const classData = gameData.classes; // Assuming gameData is available on client for this
    const classSelectionHTML = `
        <h2 class="panel-header">Choose Your Class</h2>
        <div class="panel-content class-grid">
            ${Object.entries(classData).map(([id, data]) => `
                <div class="class-card" data-class-id="${id}">
                    <h3>${id}</h3>
                    <div class="class-stats">
                        <p><strong>HP:</strong> ${data.baseHp}</p><p><strong>Dmg:</strong> +${data.baseDamageBonus}</p>
                        <p><strong>Shld:</strong> +${data.baseShieldBonus}</p><p><strong>AP:</strong> ${data.baseAp}</p>
                    </div>
                    <div class="class-ability">
                        <p><strong>${data.ability.name}</strong></p>
                        <p class="ability-desc">${data.ability.description}</p>
                    </div>
                    <button class="select-class-btn" data-class-id="${id}">Select ${id}</button>
                </div>
            `).join('')}
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

    // Turn Indicator & AP
    const turnPlayer = currentRoomState.players[gameState.turnOrder[gameState.currentPlayerIndex]];
    const turnText = turnPlayer ? `${turnPlayer.name}'s Turn` : "Loading...";
    get('turn-indicator').textContent = turnText;
    get('mobile-turn-indicator').textContent = turnText;
    get('ap-counter-desktop').classList.toggle('hidden', !isMyTurn);
    get('ap-counter-mobile').classList.toggle('hidden', !isMyTurn);
    if(isMyTurn) {
        get('ap-counter-desktop').innerHTML = `<span class="material-symbols-outlined">bolt</span>${myPlayer.currentAp}/${myPlayer.stats.ap}`;
        get('ap-counter-mobile').innerHTML = `<span class="material-symbols-outlined">bolt</span>${myPlayer.currentAp}/${myPlayer.stats.ap}`;
    }

    // Action Bars
    get('fixed-action-bar').classList.toggle('hidden', !isMyTurn);
    get('mobile-action-bar').classList.toggle('hidden', !isMyTurn);
    
    // Board
    const board = get('board-cards');
    const mobileBoard = get('mobile-board-cards');
    board.innerHTML = ''; mobileBoard.innerHTML = '';
    gameState.board.monsters.forEach(monster => {
        const cardEl = createCardElement(monster, { isTargetable: isMyTurn });
        cardEl.onclick = () => {
            if (!isMyTurn || !selectedWeaponId) return;
            const weapon = selectedWeaponId === 'unarmed' ? null : myPlayer.equipment.weapon;
            const apCost = selectedWeaponId === 'unarmed' ? 1 : (weapon?.apCost || 2);
            if (myPlayer.currentAp < apCost) return;
            socket.emit('playerAction', { action: 'attack', cardId: selectedWeaponId, targetId: monster.id });
            selectedWeaponId = null; // Deselect after attacking
        };
        board.appendChild(cardEl);
        mobileBoard.appendChild(cardEl.cloneNode(true)); // Simple clone for mobile
    });

    // Player Character Panel (Desktop) & Mobile Screen
    renderCharacterPanel(get('character-panel-content'), get('mobile-screen-character'), myPlayer);

    // Equipment & Hand
    renderHandAndEquipment(myPlayer, isMyTurn);
}

function renderCharacterPanel(desktopContainer, mobileContainer, player) {
    const { stats, class: className, equipment, statusEffects } = player;
    const classData = gameData.classes[className];
    const statsHTML = `
        <h2 class="panel-header player-class-header">${player.name} - ${className}</h2>
        <div class="panel-content">
            <div class="player-stats">
                 <div class="stat-line"><span class="material-symbols-outlined" style="color:var(--stat-color-hp)">favorite</span><span class="stat-label">Health</span><span class="stat-value">${stats.currentHp} / ${stats.maxHp}</span></div>
                 <div class="stat-line"><span class="material-symbols-outlined" style="color:var(--stat-color-ap)">bolt</span><span class="stat-label">Action Points</span><span class="stat-value">${stats.ap}</span></div>
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
    
    // Unarmed/Fist option
    const unarmedCard = createCardElement({ id: 'unarmed', name: 'Fists', type: 'Unarmed', effect: { description: 'Costs 1 AP.' } }, { isAttackable: isMyTurn });
    unarmedCard.onclick = () => {
        if (!isMyTurn) return;
        selectedWeaponId = (selectedWeaponId === 'unarmed') ? null : 'unarmed';
        renderUI(); // Re-render to show selection
    };
    equipped.appendChild(unarmedCard);

    // Equipped weapon
    if (player.equipment.weapon) {
        const weaponCard = createCardElement(player.equipment.weapon, { isAttackable: isMyTurn });
        weaponCard.onclick = () => {
            if (!isMyTurn) return;
            selectedWeaponId = (selectedWeaponId === player.equipment.weapon.id) ? null : player.equipment.weapon.id;
            renderUI();
        };
        equipped.appendChild(weaponCard);
    }
     // Equipped Armor
    if (player.equipment.armor) {
        equipped.appendChild(createCardElement(player.equipment.armor));
    }

    // Hand
    const hand = get('player-hand');
    const mobileHand = get('mobile-player-hand');
    hand.innerHTML = ''; mobileHand.innerHTML = '';
    player.hand.forEach(card => {
        const isEquippable = (card.type === 'Weapon' || card.type === 'Armor') && isMyTurn;
        hand.appendChild(createCardElement(card, { isEquippable }));
    });
    
    // Clone for mobile - non-interactive for simplicity
    mobileEquipped.innerHTML = equipped.innerHTML;
    mobileHand.innerHTML = hand.innerHTML;
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
    });
}

// --- 4. SOCKET EVENT HANDLERS ---
socket.on('connect', () => { myId = socket.id; });

// REBUILT: This is the single entry point for all state changes.
socket.on('gameStateUpdate', (newState) => {
    // TEMP DATA: Add gameData to client for rendering purposes
    // In a real build, this would be managed better to avoid sending all data
    if (typeof gameData === 'undefined') {
        window.gameData = {
            classes: {
                Barbarian: { baseHp: 24, baseDamageBonus: 4, baseShieldBonus: 0, baseAp: 3, ability: { name: 'Unchecked Assault', description: 'Discard a Spell card to add +6 damage to your next successful weapon attack this turn.' } },
                Cleric:    { baseHp: 20, baseDamageBonus: 1, baseShieldBonus: 3, baseAp: 2, ability: { name: 'Divine Aid', description: 'Gain a +1d4 bonus to your next d20 roll (attack or challenge) this turn.' } },
                Mage:      { baseHp: 18, baseDamageBonus: 1, baseShieldBonus: 2, baseAp: 2, ability: { name: 'Mystic Recall', description: 'Draw one card from the Spell deck.' } },
                Ranger:    { baseHp: 20, baseDamageBonus: 2, baseShieldBonus: 2, baseAp: 2, ability: { name: 'Hunters Mark', description: 'Mark a monster. All attacks against it deal +2 damage for one round.' } },
                Rogue:     { baseHp: 18, baseDamageBonus: 3, baseShieldBonus: 1, baseAp: 3, ability: { name: 'Evasion', description: 'For one round, all attacks against you have disadvantage (DM rerolls hits).' } },
                Warrior:   { baseHp: 22, baseDamageBonus: 2, baseShieldBonus: 4, baseAp: 3, ability: { name: 'Weapon Surge', description: 'Discard a Spell card to add +4 damage to your next successful weapon attack this turn.' } },
            }
        };
    }
    currentRoomState = newState;
    requestAnimationFrame(renderUI);
});

socket.on('actionError', (message) => {
    alert(`Error: ${message}`);
});

// --- 5. HELPER FUNCTIONS ---
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