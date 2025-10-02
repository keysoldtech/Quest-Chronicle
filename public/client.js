// REBUILT: Quest & Chronicle Client-Side Logic (v6.1.0)
// This file has been completely rebuilt to use a unidirectional data flow model.
// 1. The server is the single source of truth.
// 2. The client receives the entire game state via a single `gameStateUpdate` event.
// 3. A master `renderUI` function is called, which redraws the entire interface
//    based on the new state. This eliminates all state synchronization bugs.

// --- 1. GLOBAL SETUP & STATE ---
const socket = io();
let myId = '';
let myPlayerName = '';
let currentRoomState = {}; // The single, authoritative copy of the game state on the client.
let selectedGameMode = null; // For the menu screen
let selectedWeaponId = null; // For targeting UI
let gameUIInitialized = false; // Flag to ensure game listeners are only attached once
let currentRollData = null; // Holds data for an active roll modal
let diceAnimationInterval = null;
let rollModalCloseTimeout = null; // Timer for closing the roll modal
let activeItem = null; // For modals that need to remember which item is being used/claimed.

// --- 2. CORE RENDERING ENGINE ---
function isDesktop() {
    return window.innerWidth >= 1024;
}

/**
 * Creates an HTML element for a game card.
 * @param {object} card - The card data object.
 * @param {object} options - Configuration for card interactivity.
 * @returns {HTMLElement} The card element.
 */
function createCardElement(card, options = {}) {
    const { isEquippable = false, isAttackable = false, isTargetable = false, isDiscardable = false, isConsumable = false, isClaimable = false } = options;
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
    const apCostHTML = card.apCost ? `<div class="card-bonus" title="AP Cost"><span class="material-symbols-outlined">bolt</span>${card.apCost}</div>` : '';

    cardDiv.innerHTML = `
        <div class="card-header">
             <h3 class="card-title">${card.name}</h3>
             ${monsterHpHTML}
        </div>
        <div class="card-content">
            <p class="card-effect">${card.effect?.description || card.description || ''}</p>
        </div>
        <div class="card-footer">
            <div class="card-bonuses-grid">
                ${monsterStatsHTML}
                ${weaponDiceHTML}
                ${apCostHTML}
            </div>
            <p class="card-type">${typeInfo}</p>
        </div>
    `;

    const actionContainer = document.createElement('div');
    actionContainer.className = 'card-action-buttons';

    if (isEquippable) {
        const equipBtn = document.createElement('button');
        equipBtn.textContent = 'Equip';
        equipBtn.className = 'btn btn-xs btn-success';
        equipBtn.onclick = (e) => { e.stopPropagation(); socket.emit('equipItem', { cardId: card.id }); };
        actionContainer.appendChild(equipBtn);
    }
    
    if (isConsumable) {
        const useBtn = document.createElement('button');
        useBtn.textContent = 'Use';
        useBtn.className = 'btn btn-xs btn-special';
        useBtn.onclick = (e) => { e.stopPropagation(); handleUseConsumable(card); };
        actionContainer.appendChild(useBtn);
    }

    if (isClaimable) {
        const claimBtn = document.createElement('button');
        claimBtn.textContent = 'Claim';
        claimBtn.className = 'btn btn-xs btn-primary';
        claimBtn.onclick = (e) => { e.stopPropagation(); showClaimLootModal(card); };
        actionContainer.appendChild(claimBtn);
    }

    if (isDiscardable) {
        const discardBtn = document.createElement('button');
        discardBtn.textContent = 'Discard';
        discardBtn.className = 'btn btn-xs btn-danger';
        discardBtn.onclick = (e) => { e.stopPropagation(); socket.emit('playerAction', { action: 'discardCard', cardId: card.id }); };
        actionContainer.appendChild(discardBtn);
    }

    if (actionContainer.hasChildNodes()) {
        cardDiv.appendChild(actionContainer);
    }

    return cardDiv;
}

/**
 * The master rendering function. Wipes and redraws the UI based on the current state.
 */
function renderUI() {
    if (!currentRoomState || !currentRoomState.id) return;
    const myPlayer = currentRoomState.players[myId];
    if (!myPlayer) {
        return;
    }

    const { players, gameState, chatLog } = currentRoomState;
    const { phase } = gameState;
    const get = id => document.getElementById(id);

    // --- Phase 1: Show/Hide Major Screens ---
    const isGamePhase = phase === 'class_selection' || phase === 'started' || phase === 'game_over' || phase === 'skill_challenge';
    document.body.classList.toggle('game-active', isGamePhase);
    
    if (isGamePhase && !gameUIInitialized) {
        initializeGameUIListeners();
        gameUIInitialized = true;
    }
    
    if (phase === 'game_over') {
        showGameOverModal(gameState.winner);
        return; // Stop rendering the rest of the UI
    }

    // --- Phase 2: Render Common Game Elements ---
    get('room-code').textContent = currentRoomState.id;
    get('mobile-room-code').textContent = currentRoomState.id;
    get('turn-counter').textContent = gameState.turnCount;
    get('mobile-turn-counter').textContent = gameState.turnCount;
    renderGameLog(chatLog);

    // Player Lists
    const playerList = get('player-list');
    const mobilePlayerList = get('mobile-player-list');
    playerList.innerHTML = '';
    mobilePlayerList.innerHTML = '';
    const currentPlayerId = gameState.turnOrder[gameState.currentPlayerIndex];
    Object.values(players).forEach(p => {
        if (!p.role) return;
        const isCurrentTurn = p.id === currentPlayerId;
        const li = document.createElement('li');
        li.className = `player-list-item ${isCurrentTurn ? 'active' : ''} ${p.isDowned ? 'downed' : ''} ${p.role.toLowerCase()}`;
        const npcTag = p.isNpc ? '<span class="npc-tag">[NPC]</span> ' : '';
        const roleText = p.role === 'DM' ? `<span class="player-role dm">DM</span>` : '';
        const classText = p.class ? `<span class="player-class"> - ${p.class}</span>` : '';
        const hpDisplay = phase === 'started' && p.role === 'Explorer' ? `HP: ${p.stats.currentHp} / ${p.stats.maxHp}` : '';
        const downedText = p.isDowned ? '<span class="downed-text">[DOWNED]</span> ' : '';
        const disconnectedText = p.disconnected ? '<span class="disconnected-text">[OFFLINE]</span> ' : '';
        li.innerHTML = `<div class="player-info"><span>${disconnectedText}${downedText}${npcTag}${p.name}${classText}${roleText}</span></div><div class="player-hp">${hpDisplay}</div>`;
        playerList.appendChild(li);
        mobilePlayerList.appendChild(li.cloneNode(true));
    });
    
    if (isDesktop()) {
        const activePlayerListItem = playerList.querySelector('.player-list-item.active');
        if (activePlayerListItem) {
            activePlayerListItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }

    // --- Phase 3: Phase-Specific Rendering ---
    const desktopCharacterPanel = get('character-sheet-block');
    const mobileCharacterPanel = get('mobile-screen-character');
    
    if (phase === 'class_selection') {
        if (myPlayer.class) {
            const waitingHTML = `<h2 class="panel-header">Class Chosen!</h2><p class="panel-content">Waiting for game to start...</p>`;
            desktopCharacterPanel.innerHTML = waitingHTML;
            mobileCharacterPanel.innerHTML = `<div class="panel mobile-panel">${waitingHTML}</div>`;
            get('class-selection-modal').classList.add('hidden'); // Ensure modal is hidden if player reconnects
        } else {
            renderClassSelection(desktopCharacterPanel, mobileCharacterPanel);
        }
    } else if (phase === 'started' || phase === 'skill_challenge') {
        get('class-selection-modal').classList.add('hidden'); // Ensure modal is hidden after game starts
        renderGameplayState(myPlayer, gameState);
    }
    
    // v6.5.0: Show/hide skill challenge modal based on phase
    const skillChallengeModal = get('skill-challenge-modal');
    if (phase === 'skill_challenge' && gameState.skillChallenge.isActive) {
        showSkillChallengeModal(gameState.skillChallenge.details);
    } else {
        skillChallengeModal.classList.add('hidden');
    }
}

function createClassCardElement(id, data) {
    const cardDiv = document.createElement('div');
    cardDiv.className = 'class-card';
    cardDiv.dataset.classId = id;

    cardDiv.innerHTML = `
        <h3>${id}</h3>
        <div class="class-stats">
            <p><strong>HP:</strong> ${data.baseHp}</p><p><strong>Dmg:</strong> +${data.baseDamageBonus}</p>
            <p><strong>Shld:</strong> +${data.baseShieldBonus}</p><p><strong>AP:</strong> ${data.baseAp}</p>
        </div>
        <div class="class-ability">
            <p><strong>${data.ability.name}</strong></p>
            <p class="ability-desc">${data.ability.description}</p>
        </div>
        <button class="select-class-btn btn btn-primary btn-sm" data-class-id="${id}">Select ${id}</button>
    `;
    return cardDiv;
}

function showClassSelectionModal() {
    const classData = currentRoomState.staticData.classes;
    const modal = document.getElementById('class-selection-modal');
    const displayContainer = document.getElementById('desktop-class-card-display');
    const confirmBtn = document.getElementById('confirm-class-selection-btn');

    displayContainer.innerHTML = ''; // Clear previous cards
    let selectedClassId = null;

    Object.entries(classData).forEach(([id, data]) => {
        const cardElement = createClassCardElement(id, data);
        
        const cardButton = cardElement.querySelector('.select-class-btn');
        if (cardButton) cardButton.style.display = 'none'; // Hide button for modal UX

        cardElement.addEventListener('click', () => {
            // Logic to select card, highlight it, and enable the confirm button
            displayContainer.querySelectorAll('.class-card').forEach(c => c.classList.remove('selected-item'));
            cardElement.classList.add('selected-item');
            selectedClassId = id;
            confirmBtn.disabled = false;
        });
        
        displayContainer.appendChild(cardElement);
    });

    confirmBtn.onclick = () => {
        if(selectedClassId) {
            socket.emit('chooseClass', { classId: selectedClassId });
            modal.classList.add('hidden');
        }
    };
    
    modal.classList.remove('hidden');
}

function renderClassSelection(desktopContainer, mobileContainer) {
    if (isDesktop()) {
        desktopContainer.innerHTML = `<h2 class="panel-header">Choose Your Class</h2><p class="panel-content">Please make your selection from the popup...</p>`;
        mobileContainer.innerHTML = ''; // Clear mobile view on desktop
        showClassSelectionModal();
    } else {
        // Fallback to existing embedded mobile logic
        const classData = currentRoomState.staticData.classes;
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
                        <button class="select-class-btn btn btn-primary btn-sm" data-class-id="${id}">Select ${id}</button>
                    </div>
                `).join('')}
            </div>`;
        
        switchMobileScreen('character');
        desktopContainer.innerHTML = ''; // Clear desktop view on mobile
        mobileContainer.innerHTML = `<div class="panel mobile-panel">${classSelectionHTML}</div>`;
    }
}


/**
 * Renders all elements related to the active gameplay loop.
 */
function renderGameplayState(myPlayer, gameState) {
    const get = id => document.getElementById(id);
    const isMyTurn = gameState.turnOrder[gameState.currentPlayerIndex] === myPlayer.id && !myPlayer.isDowned;

    // Health bars
    const headerStats = get('header-player-stats');
    const mobileHeaderStats = get('mobile-header-player-stats');
    if ((gameState.phase === 'started' || gameState.phase === 'skill_challenge') && myPlayer.stats.maxHp > 0) {
        const healthPercent = (myPlayer.stats.currentHp / myPlayer.stats.maxHp) * 100;
        
        // Desktop
        get('player-health-bar').style.width = `${healthPercent}%`;
        get('player-health-text').textContent = `${myPlayer.stats.currentHp} / ${myPlayer.stats.maxHp}`;
        headerStats.classList.remove('hidden');

        // Mobile
        get('mobile-player-health-bar').style.width = `${healthPercent}%`;
        get('mobile-player-health-text').textContent = `${myPlayer.stats.currentHp}/${myPlayer.stats.maxHp}`;
        mobileHeaderStats.classList.remove('hidden');
    } else {
        headerStats.classList.add('hidden');
        mobileHeaderStats.classList.add('hidden');
    }

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
    const boardContainers = [get('board-cards'), get('mobile-board-cards')];
    boardContainers.forEach(c => c.innerHTML = '');
    gameState.board.monsters.forEach(monster => {
        boardContainers.forEach(container => {
            const cardEl = createCardElement(monster, { isTargetable: isMyTurn });
            cardEl.onclick = () => {
                if (!isMyTurn || !selectedWeaponId) return;
                showNarrativeModal(selectedWeaponId, monster.id);
                selectedWeaponId = null; 
                renderUI();
            };
            container.appendChild(cardEl);
        });
    });

    // Player Character Panel (Desktop) & Mobile Screen
    renderCharacterPanel(get('character-sheet-block'), get('mobile-screen-character'), myPlayer, isMyTurn);

    // Loot Pool
    const lootContainers = [get('party-loot-container'), get('mobile-party-loot-container')];
    lootContainers.forEach(c => c.innerHTML = '');
    if (gameState.lootPool && gameState.lootPool.length > 0) {
        gameState.lootPool.forEach(lootItem => {
            lootContainers.forEach(container => {
                container.appendChild(createCardElement(lootItem, { isClaimable: true }));
            });
        });
    } else {
         lootContainers.forEach(container => {
            container.innerHTML = `<p class="empty-pool-text">No discoveries yet.</p>`;
         });
    }

    // Equipment & Hand
    renderHandAndEquipment(myPlayer, isMyTurn);
}

function renderCharacterPanel(desktopContainer, mobileContainer, player, isMyTurn) {
    const { stats, class: className } = player;
    const classData = currentRoomState.staticData.classes[className];
    const statsHTML = `
        <h2 class="panel-header player-class-header">${player.name} - ${className}</h2>
        <div class="panel-content">
            <div class="player-stats">
                 <div class="stat-line"><span class="material-symbols-outlined" style="color:var(--stat-color-hp)">favorite</span><span class="stat-label">Health</span><span class="stat-value">${stats.currentHp} / ${stats.maxHp}</span></div>
                 <div class="stat-line shield-hp-line ${stats.shieldHp > 0 ? '' : 'hidden'}"><span class="material-symbols-outlined" style="color:var(--stat-color-shield-hp)">shield</span><span class="stat-label">Shield</span><span class="stat-value">+${stats.shieldHp}</span></div>
                 <div class="stat-line"><span class="material-symbols-outlined" style="color:var(--stat-color-ap)">bolt</span><span class="stat-label">Action Points</span><span class="stat-value">${stats.ap}</span></div>
                 <div class="stat-line"><span class="material-symbols-outlined" style="color:var(--stat-color-damage)">swords</span><span class="stat-label">Damage Bonus</span><span class="stat-value">+${stats.damageBonus}</span></div>
                 <div class="stat-line"><span class="material-symbols-outlined" style="color:var(--stat-color-shield)">security</span><span class="stat-label">Shield Bonus</span><span class="stat-value">+${stats.shieldBonus}</span></div>
            </div>
            ${classData && classData.ability ? `<div class="class-ability-card">
                <p class="ability-title">${classData.ability.name} (${classData.ability.apCost} AP)</p>
                <p class="ability-desc">${classData.ability.description}</p>
                <button class="btn btn-sm btn-special ability-button" data-ability-name="${classData.ability.name}" ${isMyTurn ? '' : 'disabled'}>Use Ability</button>
            </div>` : ''}
        </div>`;

    desktopContainer.innerHTML = statsHTML;
    mobileContainer.innerHTML = `<div class="panel mobile-panel">${statsHTML}</div>`;
}

// REFACTORED: Renders hand/equipment for both desktop and mobile without cloning to fix mobile attack bug.
function renderHandAndEquipment(player, isMyTurn) {
    const get = id => document.getElementById(id);
    const equippedContainers = [get('equipped-items'), get('mobile-equipped-items')];
    const handContainers = [get('player-hand'), get('mobile-player-hand')];
    
    equippedContainers.forEach(c => c.innerHTML = '');
    handContainers.forEach(c => c.innerHTML = '');

    // RENDER EQUIPPED
    const unarmedData = { id: 'unarmed', name: 'Fists', type: 'Unarmed', apCost: 1, effect: { dice: '1d4', description: 'Costs 1 AP. Deals 1d4 damage.' } };
    const weaponData = player.equipment.weapon || unarmedData;

    equippedContainers.forEach(container => {
        // Weapon
        const weaponCard = createCardElement(weaponData, { isAttackable: isMyTurn });
        weaponCard.onclick = () => {
            if (!isMyTurn) return;
            selectedWeaponId = (selectedWeaponId === weaponData.id) ? null : weaponData.id;
            renderUI();
        };
        container.appendChild(weaponCard);

        // Armor
        if (player.equipment.armor) {
            container.appendChild(createCardElement(player.equipment.armor));
        }
    });

    // RENDER HAND
    player.hand.forEach(card => {
        const isEquippable = (card.type === 'Weapon' || card.type === 'Armor') && isMyTurn;
        const isConsumable = card.type === 'Consumable' && isMyTurn;
        handContainers.forEach(container => {
            container.appendChild(createCardElement(card, { isEquippable, isDiscardable: isMyTurn, isConsumable }));
        });
    });
}

function renderGameLog(chatLog) {
    const logContainers = [
        document.getElementById('game-log-content'),
        document.getElementById('chat-log'),
        document.getElementById('mobile-chat-log')
    ];

    logContainers.forEach(container => {
        if (!container) return;
        container.innerHTML = '';
        chatLog.forEach(msg => {
            const p = document.createElement('p');
            p.className = `chat-message ${msg.type || 'system'}`;

            if (msg.type === 'narrative') {
                p.innerHTML = `<strong>${escapeHTML(msg.playerName)}:</strong> <em>"${escapeHTML(msg.text)}"</em>`;
            } else if (msg.type === 'chat') {
                const senderClass = msg.playerId === myId ? 'self' : '';
                const channelClass = msg.channel || 'game';
                p.innerHTML = `[<span class="channel ${channelClass}">${channelClass.toUpperCase()}</span>] <strong class="sender ${senderClass}">${escapeHTML(msg.playerName)}:</strong> ${escapeHTML(msg.text)}`;
            } else {
                 p.textContent = msg.text;
            }

            container.appendChild(p);
        });
        container.scrollTop = container.scrollHeight;
    });
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
        myPlayerName = playerNameInput.value.trim();
        socket.emit('createRoom', { 
            playerName: myPlayerName, 
            gameMode: selectedGameMode, 
            customSettings: selectedGameMode === 'Custom' ? {
                startWithWeapon: get('setting-weapon').checked,
                startWithArmor: get('setting-armor').checked,
                startingItems: parseInt(get('setting-items').value),
                startingSpells: parseInt(get('setting-spells').value),
                lootDropRate: parseInt(get('setting-loot-rate').value)
            } : null
        });
    });
    
    joinRoomBtn.addEventListener('click', () => {
        myPlayerName = playerNameInput.value.trim();
        socket.emit('joinRoom', { 
            roomId: roomCodeInput.value.trim().toUpperCase(), 
            playerName: myPlayerName
        });
    });

    get('game-over-leave-btn').addEventListener('click', () => {
        sessionStorage.removeItem('qc_playerId');
        sessionStorage.removeItem('qc_roomId');
        window.location.reload();
    });

    // End Turn Modal Listeners
    get('end-turn-confirm-btn').addEventListener('click', () => {
        socket.emit('endTurn');
        get('end-turn-confirm-modal').classList.add('hidden');
    });
    get('end-turn-cancel-btn').addEventListener('click', () => {
        get('end-turn-confirm-modal').classList.add('hidden');
    });
    // v6.5.0: Wire up cancel button for new modals
    get('claim-loot-cancel-btn').addEventListener('click', () => {
        get('claim-loot-modal').classList.add('hidden');
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

        const abilityBtn = e.target.closest('.ability-button');
        if (abilityBtn?.dataset?.abilityName) {
            socket.emit('playerAction', { 
                action: 'useAbility', 
                abilityName: abilityBtn.dataset.abilityName 
            });
            return;
        }

        const navBtn = e.target.closest('.nav-btn');
        if (navBtn?.dataset?.screen) {
            switchMobileScreen(navBtn.dataset.screen);
            return;
        }
        
        const endTurnBtn = e.target.closest('#action-end-turn-btn, #mobile-action-end-turn-btn');
        if (endTurnBtn) {
            const modal = get('end-turn-confirm-modal');
            modal.querySelector('h2').textContent = 'End Your Turn?';
            modal.querySelector('p').textContent = 'Are you sure you want to end your turn?';
            modal.classList.remove('hidden');
            return;
        }
        
        const guardBtn = e.target.closest('#action-guard-btn, #mobile-action-guard-btn');
        if (guardBtn) {
            socket.emit('playerAction', { action: 'guard' });
            return;
        }

        const respiteBtn = e.target.closest('#action-brief-respite-btn, #mobile-action-brief-respite-btn');
        if (respiteBtn) {
            socket.emit('playerAction', { action: 'respite' });
            return;
        }

        const restBtn = e.target.closest('#action-full-rest-btn, #mobile-action-full-rest-btn');
        if (restBtn) {
            socket.emit('playerAction', { action: 'rest' });
            return;
        }

        const tabBtn = e.target.closest('.tab-btn');
        if (tabBtn?.dataset?.tab) {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            tabBtn.classList.add('active');
            get(tabBtn.dataset.tab).classList.add('active');
            return;
        }
        
        const leaveBtn = e.target.closest('#leave-game-btn, #mobile-leave-game-btn');
        if (leaveBtn) {
            sessionStorage.removeItem('qc_playerId');
            sessionStorage.removeItem('qc_roomId');
            window.location.reload();
            return;
        }
    });

    // Chat form listeners
    const chatForm = get('chat-form');
    chatForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const input = get('chat-input');
        const channel = get('chat-channel');
        if (input.value.trim()) {
            socket.emit('chatMessage', { channel: channel.value, message: input.value.trim() });
            input.value = '';
        }
    });

    const mobileChatForm = get('mobile-chat-form');
    mobileChatForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const input = get('mobile-chat-input');
        const channel = get('mobile-chat-channel');
        if (input.value.trim()) {
            socket.emit('chatMessage', { channel: channel.value, message: input.value.trim() });
            input.value = '';
        }
    });
}

// --- 4. SOCKET EVENT HANDLERS ---
socket.on('connect', () => { 
    myId = socket.id;
    console.log(`Socket connected with ID: ${myId}`);

    const persistentId = sessionStorage.getItem('qc_playerId');
    const roomId = sessionStorage.getItem('qc_roomId');

    // If we have session data, attempt to rejoin the previous game.
    if (persistentId && roomId) {
        console.log(`Attempting to rejoin room ${roomId} with persistent ID ${persistentId}`);
        socket.emit('rejoinRoom', { roomId, playerId: persistentId });
    }
});

socket.on('playerIdentity', ({ playerId, roomId }) => {
    console.log(`Received identity: ${playerId} for room ${roomId}`);
    sessionStorage.setItem('qc_playerId', playerId);
    sessionStorage.setItem('qc_roomId', roomId);
});


socket.on('disconnect', (reason) => {
    console.log(`Socket disconnected: ${reason}.`);
    showToast('Connection lost. Reconnecting...', 'error');
});

socket.on('gameStateUpdate', (newState) => {
    currentRoomState = newState;
    requestAnimationFrame(renderUI);
});

socket.on('actionError', (message) => {
    showToast(`Error: ${message}`, 'error');
});

socket.on('showToast', (data) => {
    showToast(data.message, data.type || 'info');
});

socket.on('apZeroPrompt', () => {
    const modal = document.getElementById('end-turn-confirm-modal');
    modal.querySelector('h2').textContent = 'Out of AP';
    modal.querySelector('p').textContent = 'You have 0 AP remaining. End your turn?';
    modal.classList.remove('hidden');
});

socket.on('promptAttackRoll', (data) => {
    clearTimeout(rollModalCloseTimeout);
    currentRollData = data;
    const get = id => document.getElementById(id);
    const modal = get('dice-roll-modal');
    get('dice-roll-title').textContent = data.title;
    get('dice-roll-description').textContent = `You need to roll a ${data.dice} + ${data.bonus} to beat a target of ${data.targetAC}.`;
    
    get('dice-roll-result-container').classList.add('hidden');
    get('dice-roll-confirm-btn').classList.remove('hidden');
    get('dice-roll-confirm-btn').disabled = false;
    get('dice-roll-confirm-btn').textContent = "Roll to Hit";
    get('dice-roll-close-btn').classList.add('hidden');
    
    const animContainer = get('dice-animation-container');
    const diceSides = parseInt(data.dice.split('d')[1]);
    animContainer.innerHTML = getDiceSVG(diceSides);
    
    modal.classList.remove('hidden');

    get('dice-roll-confirm-btn').onclick = () => {
        get('dice-roll-confirm-btn').disabled = true;
        startDiceAnimation(diceSides);
        socket.emit('playerAction', { 
            action: 'resolve_hit',
            weaponId: data.weaponId,
            targetId: data.targetId
        });
    };
});

socket.on('attackResult', (data) => {
    let toastMsg = `${data.rollerName} ${data.action.toLowerCase()}s ${data.targetName}. They rolled ${data.total} (${data.roll}+${data.bonus}) and... ${data.outcome}!`;
    showToast(toastMsg, data.outcome.toLowerCase().includes('miss') ? 'miss' : 'hit');

    // If I was the one rolling, update my modal
    if (data.rollerId === myId && currentRollData) {
        stopDiceAnimation(data.roll);
        const get = id => document.getElementById(id);
        const resultLine = get('dice-roll-result-line');
        const detailsLine = get('dice-roll-details');

        resultLine.textContent = `${data.outcome}! (${data.total})`;
        resultLine.className = `result-line ${data.outcome.toLowerCase().includes('miss') ? 'miss' : 'hit'}`;
        detailsLine.textContent = `You rolled a ${data.roll} + ${data.bonus} accuracy bonus.`;

        get('dice-roll-result-container').classList.remove('hidden');
        get('dice-roll-confirm-btn').classList.add('hidden');
        
        if (data.needsDamageRoll) {
            // Re-purpose the modal for damage roll
            setTimeout(() => {
                get('dice-roll-title').textContent = "Damage Roll";
                get('dice-roll-description').textContent = `You hit! Now roll ${data.damageDice} for damage.`;
                const damageDiceSides = parseInt(data.damageDice.split('d')[1]);
                get('dice-animation-container').innerHTML = getDiceSVG(damageDiceSides);
                get('dice-roll-result-container').classList.add('hidden');
                get('dice-roll-confirm-btn').classList.remove('hidden');
                get('dice-roll-confirm-btn').disabled = false;
                get('dice-roll-confirm-btn').textContent = "Roll Damage";
                
                get('dice-roll-confirm-btn').onclick = () => {
                    get('dice-roll-confirm-btn').disabled = true;
                    startDiceAnimation(damageDiceSides);
                    socket.emit('playerAction', {
                        action: 'resolve_damage',
                        weaponId: data.weaponId,
                        targetId: data.targetId,
                    });
                };
            }, 1500);
        } else {
            // It's a miss, close the modal
            const closeBtn = get('dice-roll-close-btn');
            closeBtn.classList.remove('hidden');
            const closeModal = () => {
                get('dice-roll-modal').classList.add('hidden');
                currentRollData = null;
            };
            closeBtn.onclick = closeModal;
            clearTimeout(rollModalCloseTimeout);
            rollModalCloseTimeout = setTimeout(closeModal, 4000);
        }
    }
});

socket.on('damageResult', (data) => {
    let toastMsg = `${data.rollerName} dealt ${data.damage} damage to ${data.targetName}! (${data.damageRoll} + ${data.damageBonus} bonus)`;
    showToast(toastMsg, 'hit');

    if (data.rollerId === myId && currentRollData) {
        stopDiceAnimation(data.damageRoll);
        const get = id => document.getElementById(id);
        const resultLine = get('dice-roll-result-line');
        const detailsLine = get('dice-roll-details');
        
        resultLine.textContent = `${data.damage} Damage!`;
        resultLine.className = 'result-line hit';
        detailsLine.textContent = `You rolled ${data.damageRoll} + ${data.damageBonus} bonus.`;

        get('dice-roll-result-container').classList.remove('hidden');
        get('dice-roll-confirm-btn').classList.add('hidden');
        
        const closeBtn = get('dice-roll-close-btn');
        closeBtn.classList.remove('hidden');
        const closeModal = () => {
            get('dice-roll-modal').classList.add('hidden');
            currentRollData = null;
        };
        closeBtn.onclick = closeModal;
        clearTimeout(rollModalCloseTimeout);
        rollModalCloseTimeout = setTimeout(closeModal, 4000);
    }
});

socket.on('chooseToDiscard', ({ newCard, currentHand }) => {
    const get = id => document.getElementById(id);
    const modal = get('choose-discard-modal');
    const newCardContainer = get('new-card-to-discard-container');
    const handContainer = get('hand-cards-to-discard-container');
    const confirmBtn = get('confirm-discard-btn');

    newCardContainer.innerHTML = '';
    handContainer.innerHTML = '';
    let selectedCardId = null;

    const selectCard = (cardEl, cardId) => {
        // Remove selection from all cards
        modal.querySelectorAll('.card').forEach(c => c.classList.remove('selected-for-discard'));
        // Add selection to clicked card
        cardEl.classList.add('selected-for-discard');
        selectedCardId = cardId;
        confirmBtn.disabled = false;
    };

    const newCardEl = createCardElement(newCard);
    newCardEl.onclick = () => selectCard(newCardEl, newCard.id);
    newCardContainer.appendChild(newCardEl);

    currentHand.forEach(card => {
        const cardEl = createCardElement(card);
        cardEl.onclick = () => selectCard(cardEl, card.id);
        handContainer.appendChild(cardEl);
    });

    confirmBtn.onclick = () => {
        if (selectedCardId) {
            socket.emit('playerAction', {
                action: 'chooseNewCardDiscard',
                cardToDiscardId: selectedCardId,
                newCard: newCard
            });
            modal.classList.add('hidden');
            confirmBtn.onclick = null; // Clean up listener
        }
    };

    modal.classList.remove('hidden');
});

// --- 5. HELPER FUNCTIONS ---
function escapeHTML(str) {
    const p = document.createElement('p');
    p.appendChild(document.createTextNode(str));
    return p.innerHTML;
}

function switchMobileScreen(screenName) {
    document.querySelectorAll('.mobile-screen').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(n => n.classList.remove('active'));
    document.getElementById(`mobile-screen-${screenName}`)?.classList.add('active');
    document.querySelector(`.nav-btn[data-screen="${screenName}"]`)?.classList.add('active');
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-20px)';
    container.appendChild(toast);
    
    requestAnimationFrame(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateY(0)';
    });

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-20px)';
        toast.addEventListener('transitionend', () => toast.remove());
    }, 5000);
}

function showNarrativeModal(weaponId, targetId) {
    const get = id => document.getElementById(id);
    const modal = get('narrative-modal');
    const input = get('narrative-input');
    const confirmBtn = get('narrative-confirm-btn');
    const cancelBtn = get('narrative-cancel-btn');

    input.value = '';
    modal.classList.remove('hidden');
    input.focus();

    const onConfirm = () => {
        socket.emit('playerAction', {
            action: 'attack',
            cardId: weaponId,
            targetId: targetId,
            narrative: input.value.trim()
        });
        cleanup();
    };

    const onCancel = () => {
        cleanup();
    };

    const cleanup = () => {
        modal.classList.add('hidden');
        confirmBtn.replaceWith(confirmBtn.cloneNode(true)); // Remove listeners
        cancelBtn.replaceWith(cancelBtn.cloneNode(true));
    };

    confirmBtn.onclick = onConfirm;
    cancelBtn.onclick = onCancel;
}

function showGameOverModal(winner) {
    const get = id => document.getElementById(id);
    const modal = get('game-over-modal');
    const title = get('game-over-title');
    const message = get('game-over-message');

    if (winner === 'Monsters') {
        title.textContent = 'You Have Been Defeated';
        message.textContent = 'The darkness consumes you. Better luck next time, adventurer.';
    } else {
        title.textContent = 'Victory!';
        message.textContent = 'You have overcome the challenges and emerged triumphant!';
    }
    modal.classList.remove('hidden');
}

function showClaimLootModal(item) {
    activeItem = item;
    const modal = document.getElementById('claim-loot-modal');
    const playerList = document.getElementById('claim-loot-player-list');
    modal.querySelector('#claim-loot-title').textContent = `Claim ${item.name}`;
    modal.querySelector('#claim-loot-prompt').textContent = 'Who should receive this item?';
    playerList.innerHTML = '';

    Object.values(currentRoomState.players)
        .filter(p => p.role === 'Explorer' && !p.isNpc && !p.isDowned)
        .forEach(player => {
            const btn = document.createElement('button');
            btn.className = 'btn btn-primary';
            btn.textContent = player.name;
            btn.onclick = () => {
                socket.emit('playerAction', {
                    action: 'claimLoot',
                    itemId: activeItem.id,
                    targetPlayerId: player.id
                });
                modal.classList.add('hidden');
            };
            playerList.appendChild(btn);
        });
    
    modal.classList.remove('hidden');
}

function handleUseConsumable(card) {
    const effect = card.effect;
    if (!effect.target || effect.target === 'utility' || effect.target === 'self') {
        socket.emit('playerAction', { action: 'useConsumable', cardId: card.id, targetId: myId });
        return;
    }

    activeItem = card;
    const modal = document.getElementById('claim-loot-modal'); // Re-using modal for targeting
    const targetList = document.getElementById('claim-loot-player-list');
    const title = document.getElementById('claim-loot-title');
    const prompt = document.getElementById('claim-loot-prompt');
    targetList.innerHTML = '';

    let targets = [];
    if (effect.target === 'any-player') {
        title.textContent = `Use ${card.name} On...`;
        prompt.textContent = `Select a player to receive the effects of ${card.name}.`;
        targets = Object.values(currentRoomState.players).filter(p => p.role === 'Explorer' && !p.isDowned);
    } else if (effect.target === 'any-monster') {
        title.textContent = `Use ${card.name} On...`;
        prompt.textContent = `Select a monster to target with ${card.name}.`;
        targets = currentRoomState.gameState.board.monsters;
    }

    if (targets.length === 0) {
        showToast('No valid targets available.', 'error');
        return;
    }

    targets.forEach(target => {
        const btn = document.createElement('button');
        btn.className = 'btn btn-primary';
        btn.textContent = target.name;
        btn.onclick = () => {
            socket.emit('playerAction', {
                action: 'useConsumable',
                cardId: activeItem.id,
                targetId: target.id
            });
            modal.classList.add('hidden');
        };
        targetList.appendChild(btn);
    });
    
    modal.classList.remove('hidden');
}


function showSkillChallengeModal(challenge) {
    if (!challenge) return;
    const modal = document.getElementById('skill-challenge-modal');
    document.getElementById('skill-challenge-title').textContent = challenge.name;
    document.getElementById('skill-challenge-description').textContent = challenge.description;
    
    const resolveBtn = document.getElementById('skill-challenge-resolve-btn');
    resolveBtn.onclick = () => {
        socket.emit('playerAction', { action: 'resolveSkillCheck' });
        // The server will change game phase, which will cause renderUI to hide the modal
    };
    
    modal.classList.remove('hidden');
}

// --- DICE ANIMATION HELPERS ---
const DICE_SVGS = {
    d20: `<svg viewBox="0 0 100 100"><polygon class="dice-face" points="50 5, 95 25, 95 75, 50 95, 5 75, 5 25, 50 5"/><text x="50" y="55" class="dice-text">?</text></svg>`,
    d12: `<svg viewBox="0 0 100 100"><polygon class="dice-face" points="50 5, 85 20, 95 50, 85 80, 50 95, 15 80, 5 50, 15 20, 50 5"/><text x="50" y="55" class="dice-text">?</text></svg>`,
    d10: `<svg viewBox="0 0 100 100"><polygon class="dice-face" points="50 5, 95 40, 80 95, 20 95, 5 40, 50 5"/><text x="50" y="55" class="dice-text">?</text></svg>`,
    d8: `<svg viewBox="0 0 100 100"><polygon class="dice-face" points="50 5, 95 50, 50 95, 5 50, 50 5"/><text x="50" y="55" class="dice-text">?</text></svg>`,
    d6: `<svg viewBox="0 0 100 100"><rect class="dice-face" x="5" y="5" width="90" height="90" rx="10"/><text x="50" y="55" class="dice-text">?</text></svg>`,
    d4: `<svg viewBox="0 0 100 100"><polygon class="dice-face" points="50 5, 95 85, 5 85, 50 5"/><text x="50" y="65" class="dice-text">?</text></svg>`,
}

function getDiceSVG(sides) {
    if (sides >= 20) return DICE_SVGS.d20;
    if (sides >= 12) return DICE_SVGS.d12;
    if (sides >= 10) return DICE_SVGS.d10;
    if (sides >= 8) return DICE_SVGS.d8;
    if (sides >= 6) return DICE_SVGS.d6;
    return DICE_SVGS.d4;
}

function startDiceAnimation(sides) {
    const textEl = document.querySelector('#dice-animation-container .dice-text');
    if (!textEl) return;
    document.querySelector('#dice-animation-container svg').classList.remove('stopped');
    clearInterval(diceAnimationInterval);
    diceAnimationInterval = setInterval(() => {
        textEl.textContent = Math.ceil(Math.random() * sides);
    }, 50);
}

function stopDiceAnimation(finalValue) {
    clearInterval(diceAnimationInterval);
    const svgEl = document.querySelector('#dice-animation-container svg');
    const textEl = document.querySelector('#dice-animation-container .dice-text');
    if (!svgEl || !textEl) return;
    svgEl.classList.add('stopped');
    textEl.textContent = finalValue;
}


// --- Service Worker ---
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(err => console.error('SW registration failed:', err));
    });
}