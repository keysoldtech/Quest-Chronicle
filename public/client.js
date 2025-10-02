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
    
    const bonuses = card.effect?.bonuses;
    let bonusesHTML = '';
    if (bonuses) {
        const bonusIconMap = {
            ap: 'bolt', damageBonus: 'swords', shieldBonus: 'security', hp: 'favorite',
            str: 'fitness_center', dex: 'sprint', con: 'shield_person'
        };
        bonusesHTML = Object.entries(bonuses).map(([key, value]) => {
            if (value === 0) return '';
            const icon = bonusIconMap[key];
            if (!icon) return ''; // Only render bonuses we have icons for
            const sign = value > 0 ? '+' : '';
            return `<div class="card-bonus" title="${key}"><span class="material-symbols-outlined">${icon}</span>${sign}${value}</div>`;
        }).join('');
    }

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
                ${bonusesHTML}
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
        // This can happen briefly during a reconnect. If we have a stored ID, wait for the next update.
        if (sessionStorage.getItem('qc_playerId')) return;
        // If there's no stored ID and no player object, something is wrong, refresh to menu.
        sessionStorage.removeItem('qc_roomId');
        window.location.reload();
        return;
    }

    const { players, gameState, chatLog } = currentRoomState;
    const { phase } = gameState;
    const get = id => document.getElementById(id);

    // --- Phase 1: Show/Hide Major Screens ---
    // The `active` class is now controlled by CSS to prevent overlaps.
    const isGameActive = phase === 'class_selection' || phase === 'started' || phase === 'game_over' || phase === 'skill_challenge';
    get('menu-screen').classList.toggle('active', !isGameActive);
    get('game-screen').classList.toggle('active', isGameActive);
    
    if (isGameActive && !gameUIInitialized) {
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
            <p><strong>Shld:</strong> +${data.baseShieldBonus}</p><p><strong>AP:</strong> ${data.baseAP}</p>
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
                            <p><strong>Shld:</strong> +${data.baseShieldBonus}</p><p><strong>AP:</strong> ${data.baseAP}</p>
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
    get('mobile-header-player-stats').classList.toggle('hidden', myPlayer.isDowned);
    get('ap-counter-mobile').classList.toggle('hidden', !isMyTurn);
    if(isMyTurn) {
        const currentAp = myPlayer.currentAp ?? 0;
        // FIX #47: Ensure maxAP is read from the final calculated stats object.
        const maxAp = myPlayer.stats.maxAP ?? 0;
        get('ap-counter-desktop').innerHTML = `<span class="material-symbols-outlined">bolt</span>${currentAp}/${maxAp}`;
        get('ap-counter-mobile').innerHTML = `<span class="material-symbols-outlined">bolt</span>${currentAp}/${maxAp}`;
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
    const { stats, class: className, baseStats, statBonuses } = player;

    if (!baseStats || !statBonuses) return; // Don't render if data is missing

    const classData = currentRoomState.staticData.classes[className];

    // FIX #48: Helper now adds 'stat-debuff' class for negative bonuses.
    const renderStatLine = (label, icon, iconColor, baseValue, bonusValue, isPrefix = false) => {
        let bonusHtml = '';
        if (bonusValue && bonusValue !== 0) {
            const sign = bonusValue > 0 ? '+' : '';
            const bonusClass = bonusValue > 0 ? 'stat-bonus' : 'stat-debuff';
            bonusHtml = ` <span class="${bonusClass}">(${sign}${bonusValue})</span>`;
        }
        const prefix = (isPrefix && baseValue > 0) ? '+' : '';
        return `<div class="stat-line">
                    <span class="material-symbols-outlined" style="color:var(--stat-color-${iconColor})">${icon}</span>
                    <span class="stat-label">${label}</span>
                    <span class="stat-value">${prefix}${baseValue}${bonusHtml}</span>
                </div>`;
    };

    const statsHTML = `
        <h2 class="panel-header player-class-header">${player.name} - ${className}</h2>
        <div class="panel-content">
            <div class="player-stats">
                 <div class="stat-line"><span class="material-symbols-outlined" style="color:var(--stat-color-hp)">favorite</span><span class="stat-label">Health</span><span class="stat-value">${stats.currentHp} / ${stats.maxHp}</span></div>
                 <div class="stat-line shield-hp-line ${stats.shieldHp > 0 ? '' : 'hidden'}"><span class="material-symbols-outlined" style="color:var(--stat-color-shield-hp)">shield</span><span class="stat-label">Shield</span><span class="stat-value">+${stats.shieldHp}</span></div>
                 ${renderStatLine('Action Points', 'bolt', 'ap', baseStats.ap || 0, statBonuses.ap || 0)}
                 ${renderStatLine('Damage Bonus', 'swords', 'damage', baseStats.damageBonus || 0, statBonuses.damageBonus || 0, true)}
                 ${renderStatLine('Shield Bonus', 'security', 'shield', baseStats.shieldBonus || 0, statBonuses.shieldBonus || 0, true)}
                 ${renderStatLine('Hit Bonus', 'colorize', 'int', baseStats.hitBonus || 0, statBonuses.hitBonus || 0, true)}
            </div>
            <div class="player-stats core-stats">
                 ${renderStatLine('Strength', 'fitness_center', 'str', baseStats.str || 0, statBonuses.str || 0)}
                 ${renderStatLine('Dexterity', 'sprint', 'dex', baseStats.dex || 0, statBonuses.dex || 0)}
                 ${renderStatLine('Constitution', 'shield_person', 'con', baseStats.con || 0, statBonuses.con || 0)}
                 ${renderStatLine('Intelligence', 'school', 'int', baseStats.int || 0, statBonuses.int || 0)}
                 ${renderStatLine('Wisdom', 'self_improvement', 'wis', baseStats.wis || 0, statBonuses.wis || 0)}
                 ${renderStatLine('Charisma', 'star', 'cha', baseStats.cha || 0, statBonuses.cha || 0)}
            </div>
             ${classData && isMyTurn ? `
                 <div class="class-ability-card">
                     <p class="ability-title">${classData.ability.name} (${classData.ability.apCost} AP)</p>
                     <p class="ability-desc">${classData.ability.description}</p>
                     <button id="use-ability-btn" class="btn btn-special btn-sm ability-button">Use Ability</button>
                 </div>
             ` : ''}
        </div>
    `;

    if (isDesktop()) {
        desktopContainer.innerHTML = statsHTML;
    } else {
        mobileContainer.innerHTML = `<div class="panel mobile-panel">${statsHTML}</div>`;
    }
}

function renderHandAndEquipment(player, isMyTurn) {
    const handContainers = [document.getElementById('player-hand'), document.getElementById('mobile-player-hand')];
    const equippedContainers = [document.getElementById('equipped-items'), document.getElementById('mobile-equipped-items')];
    
    handContainers.forEach(c => c.innerHTML = '');
    equippedContainers.forEach(c => c.innerHTML = '');

    // Render Hand
    player.hand.forEach(card => {
        const isEquippable = (card.type === 'Weapon' || card.type === 'Armor');
        const isConsumable = card.type === 'Consumable';
        handContainers.forEach(container => {
            container.appendChild(createCardElement(card, { isEquippable, isConsumable, isDiscardable: isMyTurn }));
        });
    });

    // Render Equipment
    Object.values(player.equipment).forEach(item => {
        if (item) {
            const isAttackable = item.type === 'Weapon' && isMyTurn;
            equippedContainers.forEach(container => {
                const cardEl = createCardElement(item, { isAttackable });
                if (isAttackable) {
                    cardEl.onclick = () => {
                        selectedWeaponId = selectedWeaponId === item.id ? null : item.id;
                        renderUI();
                    };
                }
                container.appendChild(cardEl);
            });
        }
    });

    // Add unarmed attack "card" if it's my turn
    if (isMyTurn) {
        const unarmed = { id: 'unarmed', name: 'Unarmed Strike', type: 'Weapon', apCost: 1, effect: { dice: '1d4' } };
        equippedContainers.forEach(container => {
            const cardEl = createCardElement(unarmed, { isAttackable: true });
            cardEl.onclick = () => {
                selectedWeaponId = selectedWeaponId === unarmed.id ? null : unarmed.id;
                renderUI();
            };
            container.appendChild(cardEl);
        });
    }
}


function renderGameLog(log) {
    const logContainers = [document.getElementById('game-log-content'), document.getElementById('mobile-chat-log')];
    logContainers.forEach(container => {
        if(!container) return;
        
        const shouldScroll = Math.abs(container.scrollHeight - container.clientHeight - container.scrollTop) < 5;

        container.innerHTML = log.map(entry => {
            let content = '';
            switch (entry.type) {
                case 'chat':
                    const senderClass = entry.playerId === myId ? 'self' : '';
                    const channelClass = entry.channel.toLowerCase();
                    content = `<span class="channel ${channelClass}">[${entry.channel}]</span> <span class="sender ${senderClass}">${entry.playerName}:</span> ${entry.text}`;
                    break;
                case 'system-good':
                case 'system-bad':
                case 'combat':
                case 'combat-hit':
                case 'dm':
                case 'system':
                case 'action':
                case 'action-good':
                    content = entry.text;
                    break;
                case 'narrative':
                     content = `<span class="narrative-text">"${entry.text}"</span> - <span class="narrative-sender">${entry.playerName}</span>`;
                     break;
                default:
                    content = entry.text || '';
            }
            return `<div class="chat-message ${entry.type}">${content}</div>`;
        }).join('');
        
        if (shouldScroll) {
            container.scrollTop = container.scrollHeight;
        }
    });
}

// --- 3. UI INITIALIZATION & EVENT LISTENERS ---
function initializeUI() {
    // --- Menu Screen Listeners ---
    const playerNameInput = document.getElementById('player-name-input');
    const roomCodeInput = document.getElementById('room-code-input');
    const createBtn = document.getElementById('create-room-btn');
    const joinBtn = document.getElementById('join-room-btn');

    function validateMenu() {
        const hasName = playerNameInput.value.trim().length > 0;
        const hasMode = selectedGameMode !== null;
        createBtn.disabled = !hasName || !hasMode;
        joinBtn.disabled = !hasName || roomCodeInput.value.trim().length !== 4;
    }

    playerNameInput.addEventListener('input', validateMenu);
    roomCodeInput.addEventListener('input', validateMenu);
    
    document.querySelectorAll('.mode-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            selectedGameMode = btn.dataset.mode;
            document.getElementById('custom-settings').classList.toggle('hidden', selectedGameMode !== 'Custom');
            validateMenu();
        });
    });

    createBtn.addEventListener('click', () => {
        myPlayerName = playerNameInput.value.trim();
        let payload = { playerName: myPlayerName, gameMode: selectedGameMode };
        if (selectedGameMode === 'Custom') {
            payload.customSettings = {
                startWithWeapon: document.getElementById('setting-weapon').checked,
                startWithArmor: document.getElementById('setting-armor').checked,
                startingItems: parseInt(document.getElementById('setting-items').value, 10),
                startingSpells: parseInt(document.getElementById('setting-spells').value, 10),
                lootDropRate: parseInt(document.getElementById('setting-loot-rate').value, 10)
            };
        }
        socket.emit('createRoom', payload);
    });

    joinBtn.addEventListener('click', () => {
        myPlayerName = playerNameInput.value.trim();
        const roomId = roomCodeInput.value.trim().toUpperCase();
        socket.emit('joinRoom', { playerName: myPlayerName, roomId });
    });
    
    // --- Attempt Rejoin on Load ---
    const storedRoomId = sessionStorage.getItem('qc_roomId');
    const storedPlayerId = sessionStorage.getItem('qc_playerId');
    if (storedRoomId && storedPlayerId) {
        socket.emit('rejoinRoom', { roomId: storedRoomId, playerId: storedPlayerId });
    }
}

function initializeGameUIListeners() {
    // --- Universal Listeners (called once) ---
    document.body.addEventListener('click', (e) => {
        // Class selection (mobile)
        if (e.target.classList.contains('select-class-btn')) {
            const classId = e.target.dataset.classId;
            socket.emit('chooseClass', { classId });
        }
        
        // Use Ability Button
        if (e.target.id === 'use-ability-btn') {
            const playerClass = currentRoomState.players[myId]?.class;
            if (playerClass) {
                const abilityName = currentRoomState.staticData.classes[playerClass].ability.name;
                socket.emit('playerAction', { action: 'useAbility', abilityName });
            }
        }
    });

    // --- Chat ---
    ['chat-form', 'mobile-chat-form'].forEach(id => {
        const form = document.getElementById(id);
        const input = document.getElementById(id.replace('form', 'input'));
        const channel = document.getElementById(id.replace('form', 'channel'));
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const message = input.value.trim();
            if (message) {
                socket.emit('chatMessage', { channel: channel.value, message });
                input.value = '';
            }
        });
    });

    // --- Action Bars ---
    ['fixed-action-bar', 'mobile-action-bar'].forEach(id => {
        const bar = document.getElementById(id);
        bar.addEventListener('click', (e) => {
            const targetId = e.target.id;
            if (targetId.includes('end-turn-btn')) {
                socket.emit('endTurn');
            } else if (targetId.includes('guard-btn')) {
                socket.emit('playerAction', { action: 'guard' });
            } else if (targetId.includes('brief-respite-btn')) {
                socket.emit('playerAction', { action: 'respite' });
            } else if (targetId.includes('full-rest-btn')) {
                socket.emit('playerAction', { action: 'rest' });
            } else if (targetId.includes('skill-challenge-btn')) {
                socket.emit('playerAction', { action: 'resolveSkillCheck' });
            }
        });
    });

    // --- Menus & Toggles ---
    document.getElementById('chat-toggle-btn').addEventListener('click', () => {
        document.getElementById('chat-overlay').classList.toggle('hidden');
    });
    document.getElementById('chat-close-btn').addEventListener('click', () => {
        document.getElementById('chat-overlay').classList.add('hidden');
    });

    ['menu-toggle-btn', 'mobile-menu-toggle-btn'].forEach(id => {
        const btn = document.getElementById(id);
        const dropdown = document.getElementById(id.replace('toggle', 'dropdown'));
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            dropdown.classList.toggle('hidden');
        });
    });
    
    document.addEventListener('click', () => {
        document.getElementById('menu-dropdown').classList.add('hidden');
        document.getElementById('mobile-menu-dropdown').classList.add('hidden');
    });

    // --- Info Panel Tabs (Desktop) ---
    document.querySelector('.info-tabs-panel .tab-buttons').addEventListener('click', (e) => {
        if (e.target.classList.contains('tab-btn')) {
            const tabId = e.target.dataset.tab;
            document.querySelectorAll('.info-tabs-panel .tab-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            document.querySelectorAll('.info-tabs-panel .tab-content').forEach(c => c.classList.remove('active'));
            document.getElementById(tabId).classList.add('active');
        }
    });

    // --- Mobile Bottom Nav ---
    document.querySelector('.mobile-bottom-nav').addEventListener('click', (e) => {
        const navBtn = e.target.closest('.nav-btn');
        if (navBtn) {
            switchMobileScreen(navBtn.dataset.screen);
        }
    });
    
    // --- Dice Modal ---
    document.getElementById('dice-roll-confirm-btn').addEventListener('click', handleDiceRoll);
    document.getElementById('dice-roll-close-btn').addEventListener('click', () => {
        document.getElementById('dice-roll-modal').classList.add('hidden');
        if(rollModalCloseTimeout) clearTimeout(rollModalCloseTimeout);
    });
    
    // --- Narrative Modal ---
    document.getElementById('narrative-confirm-btn').addEventListener('click', () => {
        if (!activeItem) return;
        const narrative = document.getElementById('narrative-input').value.trim();
        socket.emit('playerAction', {
            action: 'attack',
            cardId: activeItem.weaponId,
            targetId: activeItem.targetId,
            narrative: narrative || null
        });
        document.getElementById('narrative-modal').classList.add('hidden');
        activeItem = null;
    });
     document.getElementById('narrative-cancel-btn').addEventListener('click', () => {
        document.getElementById('narrative-modal').classList.add('hidden');
        activeItem = null;
     });
     
    // --- Discard Modal ---
    document.getElementById('confirm-discard-btn').addEventListener('click', () => {
        if (!activeItem || !activeItem.selectedCardId) return;
        socket.emit('playerAction', {
            action: 'chooseNewCardDiscard',
            cardToDiscardId: activeItem.selectedCardId,
            newCard: activeItem.newCard
        });
        document.getElementById('choose-discard-modal').classList.add('hidden');
        activeItem = null;
    });

    // --- Claim Loot Modal ---
     document.getElementById('claim-loot-cancel-btn').addEventListener('click', () => {
        document.getElementById('claim-loot-modal').classList.add('hidden');
        activeItem = null;
     });
     
     // --- Game Over Modal ---
     document.getElementById('game-over-leave-btn').addEventListener('click', () => {
         sessionStorage.removeItem('qc_roomId');
         sessionStorage.removeItem('qc_playerId');
         window.location.reload();
     });
}

// --- 4. MODAL & POPUP LOGIC ---
function switchMobileScreen(screenName) {
    document.querySelectorAll('.mobile-screen').forEach(s => s.classList.remove('active'));
    document.getElementById(`mobile-screen-${screenName}`).classList.add('active');
    document.querySelectorAll('.mobile-bottom-nav .nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelector(`.mobile-bottom-nav .nav-btn[data-screen="${screenName}"]`).classList.add('active');
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.transform = 'translateX(120%)';
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function showYourTurnPopup() {
    const popup = document.getElementById('your-turn-popup');
    popup.classList.remove('hidden');
    setTimeout(() => popup.classList.add('hidden'), 2500);
}

function showNarrativeModal(weaponId, targetId) {
    activeItem = { weaponId, targetId };
    const weapon = Object.values(currentRoomState.players[myId].equipment).find(e => e?.id === weaponId) || { name: 'Unarmed Strike' };
    document.getElementById('narrative-prompt').textContent = `How do you use your ${weapon.name}?`;
    document.getElementById('narrative-input').value = '';
    document.getElementById('narrative-modal').classList.remove('hidden');
}

function showGameOverModal(winner) {
    const title = document.getElementById('game-over-title');
    const message = document.getElementById('game-over-message');
    
    if (winner === 'Explorers') {
        title.textContent = "Victory!";
        message.textContent = "You have overcome the challenges and completed your quest!";
    } else {
        title.textContent = "Defeat...";
        message.textContent = "Your party has fallen. The darkness claims another victory.";
    }
    document.getElementById('game-over-modal').classList.remove('hidden');
}

function showClaimLootModal(item) {
    activeItem = item;
    const playerList = document.getElementById('claim-loot-player-list');
    playerList.innerHTML = '';
    
    Object.values(currentRoomState.players).filter(p => p.role === 'Explorer').forEach(p => {
        const btn = document.createElement('button');
        btn.className = 'btn btn-secondary';
        btn.textContent = p.name;
        btn.onclick = () => {
            socket.emit('playerAction', {
                action: 'claimLoot',
                itemId: activeItem.id,
                targetPlayerId: p.id
            });
            document.getElementById('claim-loot-modal').classList.add('hidden');
            activeItem = null;
        };
        playerList.appendChild(btn);
    });

    document.getElementById('claim-loot-title').textContent = `Claim ${item.name}`;
    document.getElementById('claim-loot-modal').classList.remove('hidden');
}

function handleUseConsumable(card) {
    const effect = card.effect;
    if (effect.target === 'any-player') {
         // Show player list to target
        activeItem = card;
        const playerList = document.getElementById('claim-loot-player-list'); // Re-use the claim loot modal structure
        playerList.innerHTML = '';
        Object.values(currentRoomState.players).filter(p => p.role === 'Explorer').forEach(p => {
            const btn = document.createElement('button');
            btn.className = 'btn btn-secondary';
            btn.textContent = p.name;
            btn.onclick = () => {
                socket.emit('playerAction', {
                    action: 'useConsumable',
                    cardId: activeItem.id,
                    targetId: p.id
                });
                document.getElementById('claim-loot-modal').classList.add('hidden');
                activeItem = null;
            };
            playerList.appendChild(btn);
        });
        document.getElementById('claim-loot-title').textContent = `Use ${card.name} on...`;
        document.getElementById('claim-loot-modal').classList.remove('hidden');

    } else if (effect.target === 'any-monster') {
        // Prompt for monster target
        showToast('Select a monster to target with this item.', 'info');
        // This is a complex UX, for now we will just allow targeting the first monster
        const firstMonster = currentRoomState.gameState.board.monsters[0];
        if (firstMonster) {
            socket.emit('playerAction', { action: 'useConsumable', cardId: card.id, targetId: firstMonster.id });
        } else {
            showToast('No monsters to target!', 'error');
        }
    } else {
        // Self-use or no target needed
        socket.emit('playerAction', { action: 'useConsumable', cardId: card.id, targetId: myId });
    }
}

function showSkillChallengeModal(challenge) {
    document.getElementById('skill-challenge-title').textContent = challenge.name;
    document.getElementById('skill-challenge-description').textContent = challenge.description;
    document.getElementById('skill-challenge-modal').classList.remove('hidden');
    // The button to resolve is part of the action bar now
}


// --- 5. DICE ROLLING LOGIC ---
function showDiceRollModal(data) {
    currentRollData = data;
    const { title, dice, bonus, targetAC } = data;
    const modal = document.getElementById('dice-roll-modal');
    document.getElementById('dice-roll-title').textContent = title;
    
    let description = `Roll ${dice}`;
    if (bonus > 0) description += ` + ${bonus}`;
    if (bonus < 0) description += ` - ${Math.abs(bonus)}`;
    if (targetAC) description += ` vs Target AC of ${targetAC}`;
    document.getElementById('dice-roll-description').textContent = description;

    const container = document.getElementById('dice-animation-container');
    container.innerHTML = `<svg viewBox="0 0 100 100"><rect class="dice-face" x="5" y="5" width="90" height="90" rx="10"/><text id="dice-text" class="dice-text" x="50" y="55">?</text></svg>`;
    container.querySelector('svg').classList.remove('stopped');

    document.getElementById('dice-roll-result-container').classList.add('hidden');
    document.getElementById('dice-roll-confirm-btn').classList.remove('hidden');
    document.getElementById('dice-roll-close-btn').classList.add('hidden');
    
    modal.classList.remove('hidden');
}

function handleDiceRoll() {
    if (!currentRollData) return;
    
    document.getElementById('dice-roll-confirm-btn').disabled = true;
    const diceText = document.getElementById('dice-text');
    
    if (diceAnimationInterval) clearInterval(diceAnimationInterval);
    diceAnimationInterval = setInterval(() => {
        diceText.textContent = Math.ceil(Math.random() * 20);
    }, 50);

    // After a short animation, send the roll request to the server
    setTimeout(() => {
        if (diceAnimationInterval) clearInterval(diceAnimationInterval);
        if(currentRollData.action === 'attack'){
             socket.emit('playerAction', { action: 'resolve_hit', ...currentRollData });
        }
    }, 1000);
}

function displayAttackResult(data) {
    const { roll, bonus, total, outcome, needsDamageRoll, rollerName, targetName, weaponId, targetId, damageDice } = data;

    const isMyRoll = data.rollerId === myId;
    const modal = document.getElementById('dice-roll-modal');

    // Update dice animation to show the final roll
    if (isMyRoll) {
        if (diceAnimationInterval) clearInterval(diceAnimationInterval);
        document.getElementById('dice-text').textContent = roll;
        document.getElementById('dice-animation-container svg').classList.add('stopped');
    }
    
    const resultLine = document.getElementById('dice-roll-result-line');
    resultLine.textContent = `${total} - ${outcome.toUpperCase()}!`;
    resultLine.className = `result-line ${outcome.toLowerCase()}`;
    document.getElementById('dice-roll-details').textContent = `(${roll} + ${bonus} bonus)`;
    
    if (isMyRoll) {
        document.getElementById('dice-roll-result-container').classList.remove('hidden');
        document.getElementById('dice-roll-confirm-btn').classList.add('hidden');
    }

    if (needsDamageRoll && isMyRoll) {
        const damageBtn = document.createElement('button');
        damageBtn.id = 'dice-roll-damage-btn';
        damageBtn.className = 'btn btn-special';
        damageBtn.textContent = `Roll for Damage (${damageDice})`;
        damageBtn.onclick = () => {
            socket.emit('playerAction', { action: 'resolve_damage', weaponId, targetId });
            damageBtn.disabled = true;
        };
        const actions = modal.querySelector('.modal-actions');
        // Clear previous damage buttons
        const oldBtn = document.getElementById('dice-roll-damage-btn');
        if (oldBtn) oldBtn.remove();
        
        actions.appendChild(damageBtn);

    } else if (isMyRoll) {
        document.getElementById('dice-roll-close-btn').classList.remove('hidden');
        if(rollModalCloseTimeout) clearTimeout(rollModalCloseTimeout);
        rollModalCloseTimeout = setTimeout(() => modal.classList.add('hidden'), 3000);
    }
    
    showToast(`${rollerName} attacks ${targetName}... ${total} is a ${outcome}!`, outcome.toLowerCase());
}

function displayDamageResult(data) {
    const { rollerName, targetName, damage } = data;
    showToast(`${rollerName} dealt ${damage} damage to ${targetName}!`, 'hit');
    
    const isMyRoll = data.rollerId === myId;
    if (isMyRoll) {
        const modal = document.getElementById('dice-roll-modal');
        const oldBtn = document.getElementById('dice-roll-damage-btn');
        if (oldBtn) oldBtn.remove();

        document.getElementById('dice-roll-close-btn').classList.remove('hidden');
        if(rollModalCloseTimeout) clearTimeout(rollModalCloseTimeout);
        rollModalCloseTimeout = setTimeout(() => modal.classList.add('hidden'), 3000);
    }
}


// --- 6. SOCKET.IO EVENT HANDLERS ---
socket.on('gameStateUpdate', (newState) => {
    currentRoomState = newState;
    myId = socket.id; // Update myId in case it changed on reconnect
    renderUI();
});

socket.on('playerIdentity', ({ playerId, roomId }) => {
    sessionStorage.setItem('qc_playerId', playerId);
    sessionStorage.setItem('qc_roomId', roomId);
});

socket.on('actionError', (message) => {
    showToast(message, 'error');
});

socket.on('yourTurn', () => {
    showYourTurnPopup();
});

socket.on('promptAttackRoll', (data) => {
    showDiceRollModal({ action: 'attack', ...data });
});

socket.on('attackResult', (data) => {
    displayAttackResult(data);
});
socket.on('damageResult', (data) => {
    displayDamageResult(data);
});

socket.on('chooseToDiscard', ({ newCard, currentHand }) => {
    const modal = document.getElementById('choose-discard-modal');
    const newCardContainer = document.getElementById('new-card-to-discard-container');
    const handContainer = document.getElementById('hand-cards-to-discard-container');
    const confirmBtn = document.getElementById('confirm-discard-btn');

    activeItem = { newCard, selectedCardId: null };
    confirmBtn.disabled = true;

    newCardContainer.innerHTML = '';
    handContainer.innerHTML = '';

    const newCardEl = createCardElement(newCard);
    newCardEl.onclick = () => {
        document.querySelectorAll('.discard-choice-section .card').forEach(c => c.classList.remove('selected-for-discard'));
        newCardEl.classList.add('selected-for-discard');
        activeItem.selectedCardId = newCard.id;
        confirmBtn.disabled = false;
    };
    newCardContainer.appendChild(newCardEl);

    currentHand.forEach(card => {
        const cardEl = createCardElement(card);
        cardEl.onclick = () => {
            document.querySelectorAll('.discard-choice-section .card').forEach(c => c.classList.remove('selected-for-discard'));
            cardEl.classList.add('selected-for-discard');
            activeItem.selectedCardId = card.id;
            confirmBtn.disabled = false;
        };
        handContainer.appendChild(cardEl);
    });

    modal.classList.remove('hidden');
});

// --- INITIALIZE ---
initializeUI();
