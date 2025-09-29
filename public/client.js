// REFACTORED: Quest & Chronicle Client-Side Logic (v5.0.14)
// This file has been completely refactored to use a unidirectional data flow model.
// 1. The server is the single source of truth.
// 2. The client receives the entire game state via a single `gameStateUpdate` event.
// 3. A master `renderUI` function is called, which redraws the entire interface
//    based on the new state. This eliminates all state synchronization bugs.

// --- 1. GLOBAL SETUP & STATE ---
const socket = io();
let myId = '';
let currentRoomState = {}; // The single, authoritative copy of the game state on the client.
let selectedGameMode = null; // For the menu screen
let selectedWeaponId = null; // For targeting
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
    const cardTitle = card.isMagical ? `<span class="magical-item">${card.name}</span>` : card.name;
    const monsterStatsHTML = card.type === 'Monster' ? `
        <div class="monster-stats-grid">
            <div class="card-bonus" title="Attack Bonus"><span class="material-symbols-outlined">colorize</span>+${card.attackBonus || 0}</div>
            <div class="card-bonus" title="Armor Class"><span class="material-symbols-outlined">security</span>${card.requiredRollToHit || 10}</div>
            <div class="card-bonus" title="Action Points"><span class="material-symbols-outlined">bolt</span>${card.ap || 1}</div>
        </div>` : '';

    cardDiv.innerHTML = `
        <div class="card-content">
            <h3 class="card-title">${cardTitle}</h3>
            <p class="card-effect">${card.effect?.description || card.description || ''}</p>
        </div>
        <div class="card-footer">
            ${monsterStatsHTML}
            <p class="card-type">${typeInfo}</p>
        </div>
    `;

    if (isEquippable) {
        const equipBtn = document.createElement('button');
        equipBtn.textContent = 'Equip';
        equipBtn.className = 'btn btn-xs btn-success';
        equipBtn.style.cssText = 'position:absolute; bottom:5px; left:50%; transform:translateX(-50%);';
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
    const menuScreen = get('menu-screen');
    const gameScreen = get('game-screen');

    if (phase === 'class_selection' || phase === 'started') {
        if (menuScreen.classList.contains('active')) {
            menuScreen.classList.remove('active');
            gameScreen.classList.add('active');
            if (!gameUIInitialized) {
                initializeGameUIListeners();
                gameUIInitialized = true;
            }
        }
    } else {
        // Fallback to menu if phase is unknown
        menuScreen.classList.add('active');
        gameScreen.classList.remove('active');
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
        const isCurrentTurn = p.id === currentPlayerId;
        const li = document.createElement('li');
        li.className = `player-list-item ${isCurrentTurn ? 'active' : ''}`;
        const npcTag = p.isNpc ? '<span class="npc-tag">[NPC]</span> ' : '';
        const classText = p.class ? `<span class="player-class"> - ${p.class}</span>` : '';
        const hpDisplay = phase === 'started' ? `HP: ${p.stats.currentHp} / ${p.stats.maxHp}` : 'HP: -- / --';
        li.innerHTML = `<div class="player-info"><span>${npcTag}${p.name}${classText}</span></div><div class="player-hp">${hpDisplay}</div>`;
        playerList.appendChild(li);
        mobilePlayerList.appendChild(li.cloneNode(true));
    });

    // --- Phase 3: Phase-Specific Rendering ---
    const desktopCharacterPanel = get('class-selection-container');
    const mobileCharacterPanel = get('mobile-screen-character');
    const desktopStatsPanel = get('player-stats-container');
    desktopCharacterPanel.innerHTML = '';
    mobileCharacterPanel.innerHTML = '';
    
    if (phase === 'class_selection') {
        desktopStatsPanel.classList.add('hidden');
        desktopCharacterPanel.parentElement.classList.remove('hidden');
        switchMobileScreen('character');

        if (myPlayer.class) {
            const waitingHTML = `<h2 class="panel-header">Class Chosen!</h2><p style="padding: 1rem; text-align: center;">Waiting for game to start...</p>`;
            desktopCharacterPanel.innerHTML = waitingHTML;
            mobileCharacterPanel.innerHTML = `<div class="panel mobile-panel">${waitingHTML}</div>`;
        } else {
            renderClassSelection(gameState.classData, desktopCharacterPanel, mobileCharacterPanel);
        }
    } else if (phase === 'started') {
        desktopCharacterPanel.parentElement.classList.add('hidden');
        desktopStatsPanel.classList.remove('hidden');
        renderGameplayState(myPlayer, gameState);
    }
}

/**
 * Renders the class selection UI into the specified containers.
 */
function renderClassSelection(classData, desktopContainer, mobileContainer) {
    const classSelectionHTML = `
        <h2 class="panel-header">Choose Your Class</h2>
        <div class="class-grid">
            ${Object.entries(classData).map(([id, data]) => `
                <div class="class-card" data-class-id="${id}">
                    <h3>${id}</h3>
                    <div class="class-stats">
                        <p><strong>HP:</strong> ${data.baseHp}</p>
                        <p><strong>Damage:</strong> +${data.baseDamageBonus}</p>
                        <p><strong>Shield:</strong> +${data.baseShieldBonus}</p>
                        <p><strong>AP:</strong> ${data.baseAp}</p>
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

    // Action Bars
    const showActionBar = isMyTurn;
    get('fixed-action-bar').classList.toggle('hidden', !showActionBar);
    get('mobile-action-bar').classList.toggle('hidden', !showActionBar);
    
    // Board
    const board = get('board-cards');
    const mobileBoard = get('mobile-board-cards');
    board.innerHTML = '';
    mobileBoard.innerHTML = '';
    if (gameState.board.monsters.length > 0) {
        gameState.board.monsters.forEach(monster => {
            const cardEl = createCardElement(monster, { isTargetable: isMyTurn });
            cardEl.onclick = () => {
                if (!isMyTurn || !selectedWeaponId) return;
                const weapon = myPlayer.equipment.weapon;
                const isUnarmed = selectedWeaponId === 'unarmed';
                const apCost = isUnarmed ? 1 : (weapon?.apCost || 2);
                if (myPlayer.currentAp < apCost) return;
                socket.emit('playerAction', { action: 'attack', cardId: selectedWeaponId, targetId: monster.id, narrative: 'An attack!' });
            };
            board.appendChild(cardEl);
            mobileBoard.appendChild(cardEl.cloneNode(true)); // Simple clone for mobile
        });
    } else {
        const emptyText = '<p class="empty-pool-text">The board is clear of enemies.</p>';
        board.innerHTML = emptyText;
        mobileBoard.innerHTML = emptyText;
    }

    // Equipment
    const equipped = get('equipped-items');
    const mobileEquipped = get('mobile-equipped-items');
    equipped.innerHTML = '';
    mobileEquipped.innerHTML = '';
    const weapon = myPlayer.equipment.weapon;
    const weaponCard = weapon ? createCardElement(weapon, { isAttackable: isMyTurn }) : createCardElement({ id: 'unarmed', name: 'Fists', type: 'Unarmed', effect: { description: 'Costs 1 AP.' } }, { isAttackable: isMyTurn });
    weaponCard.onclick = () => {
        if (!isMyTurn) return;
        selectedWeaponId = (selectedWeaponId === weaponCard.dataset.cardId) ? null : weaponCard.dataset.cardId;
        renderUI(); // Re-render to show selection
    };
    equipped.appendChild(weaponCard);
    mobileEquipped.appendChild(weaponCard.cloneNode(true));
    if (myPlayer.equipment.armor) {
        const armorCard = createCardElement(myPlayer.equipment.armor);
        equipped.appendChild(armorCard);
        mobileEquipped.appendChild(armorCard.cloneNode(true));
    }
    
    // Hand
    const hand = get('player-hand');
    const mobileHand = get('mobile-player-hand');
    hand.innerHTML = '';
    mobileHand.innerHTML = '';
    myPlayer.hand.forEach(card => {
        const isEquippable = card.type === 'Weapon' || card.type === 'Armor';
        const cardEl = createCardElement(card, { isEquippable });
        hand.appendChild(cardEl);
        mobileHand.appendChild(cardEl.cloneNode(true));
    });
}

// --- 3. UI EVENT LISTENERS ---

// Called once when the document is ready
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

    modeButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            modeButtons.forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            selectedGameMode = btn.dataset.mode;
            customSettingsDiv.classList.toggle('hidden', selectedGameMode !== 'Custom');
            validateCreateButton();
        });
    });

    playerNameInput.addEventListener('input', validateCreateButton);

    createRoomBtn.addEventListener('click', () => {
        const playerName = playerNameInput.value.trim();
        let customSettings = null;
        if (selectedGameMode === 'Custom') {
            customSettings = { /* ... collect settings ... */ };
        }
        socket.emit('createRoom', { playerName, gameMode: selectedGameMode, customSettings });
    });
    
    joinRoomBtn.addEventListener('click', () => {
        const playerName = playerNameInput.value.trim();
        const roomCode = roomCodeInput.value.trim().toUpperCase();
        socket.emit('joinRoom', { roomId: roomCode, playerName });
    });
});

// Called once when the game screen is first shown
function initializeGameUIListeners() {
    const get = id => document.getElementById(id);

    // Class selection clicks (event delegation)
    document.body.addEventListener('click', (e) => {
        const target = e.target.closest('.select-class-btn');
        if (target && target.dataset.classId) {
            socket.emit('chooseClass', { classId: target.dataset.classId });
        }
    });

    // Mobile Navigation
    get('mobile-bottom-nav').addEventListener('click', (e) => {
        const navBtn = e.target.closest('.nav-btn');
        if (navBtn) switchMobileScreen(navBtn.dataset.screen);
    });

    // Action Buttons
    [get('action-end-turn-btn'), get('mobile-action-end-turn-btn')].forEach(btn => {
        btn.addEventListener('click', () => socket.emit('endTurn'));
    });
    [get('action-guard-btn'), get('mobile-action-guard-btn')].forEach(btn => {
        btn.addEventListener('click', () => socket.emit('playerAction', { action: 'guard' }));
    });
}

// --- 4. SOCKET EVENT HANDLERS ---
socket.on('connect', () => { myId = socket.id; });

// REFACTORED: This is the single entry point for all state changes.
socket.on('gameStateUpdate', (newState) => {
    currentRoomState = newState;
    requestAnimationFrame(renderUI); // Use rAF to prevent layout thrashing
});

socket.on('actionError', (message) => {
    // Replace with a proper toast notification system later
    alert(`Error: ${message}`);
});

// --- 5. HELPER FUNCTIONS ---
function switchMobileScreen(screenName) {
    document.querySelectorAll('.mobile-screen').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(n => n.classList.remove('active'));
    
    const screen = document.getElementById(`mobile-screen-${screenName}`);
    if (screen) screen.classList.add('active');
    
    const navBtn = document.querySelector(`.nav-btn[data-screen="${screenName}"]`);
    if (navBtn) navBtn.classList.add('active');
}

// --- Service Worker ---
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js')
        .then(reg => console.log('SW registered'))
        .catch(err => console.error('SW registration failed:', err));
}