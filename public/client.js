// REBUILT: Quest & Chronicle Client-Side Logic (v6.1.0)
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
let actionState = null; // Manages multi-step actions like targeting
let gameUIInitialized = false; // Flag to ensure game listeners are only attached once

// --- 2. CORE RENDERING ENGINE ---

/**
 * Creates an HTML element for a game card.
 * @param {object} card - The card data object.
 * @param {object} options - Configuration for card interactivity.
 * @returns {HTMLElement} The card element.
 */
function createCardElement(card, options = {}) {
    if (!card) return document.createElement('div');
    const { isEquippable = false, isUsable = false, isAttackable = false, isTargetable = false } = options;
    const cardDiv = document.createElement('div');
    cardDiv.className = 'card';
    cardDiv.dataset.cardId = card.id;

    if (card.type === 'Monster') cardDiv.dataset.monsterId = card.id;

    if (isTargetable) cardDiv.classList.add('valid-target');
    if (isAttackable) {
        cardDiv.classList.add('attackable-weapon');
        if (actionState?.type === 'attack' && card.id === actionState.weaponId) cardDiv.classList.add('selected-weapon');
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
        equipBtn.className = 'btn btn-xs btn-primary equip-btn';
        equipBtn.onclick = (e) => { e.stopPropagation(); socket.emit('equipItem', { cardId: card.id }); };
        cardDiv.appendChild(equipBtn);
    }
    if (isUsable) {
        const useBtn = document.createElement('button');
        useBtn.textContent = 'Use';
        useBtn.className = 'btn btn-xs btn-success use-card-btn';
        useBtn.onclick = (e) => {
            e.stopPropagation();
            actionState = { type: 'useCard', cardId: card.id, effect: card.effect };
            renderUI();
        };
        cardDiv.appendChild(useBtn);
    }
    return cardDiv;
}

/**
 * The master rendering function. Wipes and redraws the UI based on the current state.
 */
function renderUI() {
    if (!currentRoomState || !currentRoomState.id || !window.gameData) return;
    const myPlayer = currentRoomState.players[myId];
    if (!myPlayer) return;

    const { players, gameState, chatLog } = currentRoomState;
    const { phase } = gameState;
    const get = id => document.getElementById(id);

    get('menu-screen').classList.toggle('active', phase !== 'started' && phase !== 'class_selection');
    const isGameActive = phase === 'class_selection' || phase === 'started';
    get('game-screen').classList.toggle('active', isGameActive);
    
    if (isGameActive && !gameUIInitialized) {
        initializeGameUIListeners();
        gameUIInitialized = true;
    }
    
    get('room-code').textContent = currentRoomState.id;
    get('mobile-room-code').textContent = currentRoomState.id;
    get('turn-counter-desktop').textContent = gameState.turnCount;

    // Player Lists
    const playerList = get('player-list');
    const mobilePlayerList = get('mobile-player-list');
    playerList.innerHTML = '';
    mobilePlayerList.innerHTML = '';
    const currentPlayerId = gameState.turnOrder[gameState.currentPlayerIndex];
    Object.values(players).forEach(p => {
        if (!p.role) return;
        const isCurrentTurn = p.id === currentPlayerId;
        const isTargetable = actionState && (actionState.effect?.target === 'any-player' || (actionState.effect?.target === 'self' && p.id === myId));
        const li = document.createElement('li');
        li.className = `player-list-item ${isCurrentTurn ? 'active' : ''} ${p.role.toLowerCase()} ${isTargetable ? 'valid-target' : ''}`;
        
        li.onclick = () => {
            if (isTargetable) {
                socket.emit('playerAction', { ...actionState, targetId: p.id });
                actionState = null;
                renderUI();
            }
        };

        const npcTag = p.isNpc ? '<span class="npc-tag">[NPC]</span> ' : '';
        const roleText = p.role === 'DM' ? `<span class="player-role dm">DM</span>` : '';
        const classText = p.class ? `<span class="player-class"> - ${p.class}</span>` : '';
        const hpDisplay = phase === 'started' && p.role === 'Explorer' ? `HP: ${p.stats.currentHp} / ${p.stats.maxHp}` : '';
        li.innerHTML = `<div class="player-info"><span>${npcTag}${p.name}${classText}${roleText}</span></div><div class="player-hp">${hpDisplay}</div>`;
        playerList.appendChild(li);
        mobilePlayerList.appendChild(li.cloneNode(true));
    });
    
    renderChat(chatLog);

    const desktopCharacterPanel = get('character-panel-content');
    const mobileCharacterPanel = get('mobile-screen-character');
    
    if (phase === 'class_selection') {
        switchMobileScreen('character');
        if (myPlayer.class) {
            const waitingHTML = `<h2 class="panel-header">Class Chosen!</h2><p class="panel-content">Waiting for other players...</p>`;
            desktopCharacterPanel.innerHTML = waitingHTML;
            mobileCharacterPanel.innerHTML = `<div class="panel mobile-panel">${waitingHTML}</div>`;
        } else {
            renderClassSelection(desktopCharacterPanel, mobileCharacterPanel);
        }
    } else if (phase === 'started') {
        renderGameplayState(myPlayer, gameState);
    }
}

function renderClassSelection(desktopContainer, mobileContainer) {
    const classData = window.gameData.classes;
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

function renderGameplayState(myPlayer, gameState) {
    const get = id => document.getElementById(id);
    const isMyTurn = gameState.turnOrder[gameState.currentPlayerIndex] === myPlayer.id;

    const turnPlayer = currentRoomState.players[gameState.turnOrder[gameState.currentPlayerIndex]];
    const turnText = turnPlayer ? `${turnPlayer.name}'s Turn` : "Loading...";
    get('turn-indicator').textContent = turnText;
    get('mobile-turn-indicator').textContent = turnText;

    get('hp-counter-desktop').innerHTML = `<span class="material-symbols-outlined">favorite</span>${myPlayer.stats.currentHp}/${myPlayer.stats.maxHp}`;
    get('hp-counter-mobile').innerHTML = `<span class="material-symbols-outlined">favorite</span>${myPlayer.stats.currentHp}/${myPlayer.stats.maxHp}`;
    
    const apText = isMyTurn ? `${myPlayer.currentAp}/${myPlayer.stats.ap}` : `0/${myPlayer.stats.ap}`;
    get('ap-counter-desktop').innerHTML = `<span class="material-symbols-outlined">bolt</span>${apText}`;
    get('ap-counter-mobile').innerHTML = `<span class="material-symbols-outlined">bolt</span>${apText}`;

    get('fixed-action-bar').classList.toggle('hidden', !isMyTurn);
    get('mobile-action-bar').classList.toggle('hidden', !isMyTurn);
    get('action-cancel-btn').classList.toggle('hidden', !actionState);
    
    const board = get('board-cards');
    const mobileBoard = get('mobile-board-cards');
    board.innerHTML = ''; mobileBoard.innerHTML = '';
    gameState.board.monsters.forEach(monster => {
        const isTargetable = actionState && actionState.effect?.target === 'any-monster';
        const cardEl = createCardElement(monster, { isTargetable });
        cardEl.onclick = () => {
            if (!isMyTurn) return;
            if (actionState?.type === 'attack') {
                const weaponName = actionState.weaponId === 'unarmed' ? 'Fists' : myPlayer.equipment.weapon?.name;
                get('narrative-prompt').textContent = `How do you attack ${monster.name} with your ${weaponName}?`;
                get('narrative-modal').classList.remove('hidden');
                get('narrative-input').focus();
                actionState.targetId = monster.id;
            } else if (isTargetable) {
                socket.emit('playerAction', { ...actionState, targetId: monster.id });
                actionState = null;
                renderUI();
            }
        };
        board.appendChild(cardEl);
        mobileBoard.appendChild(cardEl.cloneNode(true));
    });

    renderCharacterPanel(get('character-panel-content'), get('mobile-screen-character'), myPlayer, isMyTurn);
    renderHandAndEquipment(myPlayer, isMyTurn);
    renderGameLog(get('game-log-content'), gameState.gameLog);
    renderGameLog(get('mobile-game-log'), gameState.gameLog);
    renderWorldEvents(get('world-events-container'), get('mobile-world-events-container'), gameState.worldEvents);
    renderPartyEvent(get('party-event-container'), get('mobile-party-event-container'), gameState.currentPartyEvent);
    renderLoot(get('party-loot-container'), get('mobile-party-loot-container'), gameState.lootPool);
    renderSkillChallenge(get('skill-challenge-display'), get('mobile-skill-challenge-display'), gameState.skillChallenge, isMyTurn);
}

function renderCharacterPanel(desktopContainer, mobileContainer, player, isMyTurn) {
    const { stats, class: className } = player;
    const classData = window.gameData.classes[className];
    
    const useAbilityBtnHTML = (isMyTurn && classData) ? `<button class="btn btn-sm btn-special use-ability-btn">Use: ${classData.ability.name} (${classData.ability.apCost} AP)</button>` : '';

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
                ${useAbilityBtnHTML}
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
    
    const createWeaponCard = (weapon, isUnarmed = false) => {
        const card = createCardElement(weapon, { isAttackable: isMyTurn });
        card.onclick = () => {
            if (!isMyTurn) return;
            const weaponId = isUnarmed ? 'unarmed' : weapon.id;
            actionState = (actionState?.weaponId === weaponId) ? null : { type: 'attack', weaponId };
            renderUI();
        };
        return card;
    };

    if (!player.equipment.weapon) {
        equipped.appendChild(createWeaponCard({ id: 'unarmed', name: 'Fists', type: 'Weapon', category: 'Unarmed', effect: { description: 'Costs 1 AP.' }, apCost: 1 }, true));
    } else {
        equipped.appendChild(createWeaponCard(player.equipment.weapon));
    }

    if (player.equipment.armor) {
        equipped.appendChild(createCardElement(player.equipment.armor));
    }

    const hand = get('player-hand');
    const mobileHand = get('mobile-player-hand');
    hand.innerHTML = ''; mobileHand.innerHTML = '';
    player.hand.forEach(card => {
        const isEquippable = (card.type === 'Weapon' || card.type === 'Armor') && isMyTurn;
        const isUsable = (card.type === 'Spell' || card.type === 'Consumable') && isMyTurn;
        hand.appendChild(createCardElement(card, { isEquippable, isUsable }));
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

function renderWorldEvents(desktopContainer, mobileContainer, worldEvents) {
    desktopContainer.innerHTML = '';
    if (worldEvents.currentEvent) {
        desktopContainer.appendChild(createCardElement(worldEvents.currentEvent));
    } else {
        desktopContainer.innerHTML = '<p class="empty-pool-text">No active world event.</p>';
    }
    mobileContainer.innerHTML = desktopContainer.innerHTML;
}

function renderPartyEvent(desktopContainer, mobileContainer, partyEvent) {
    desktopContainer.innerHTML = '';
    if (partyEvent) {
        desktopContainer.appendChild(createCardElement(partyEvent));
    } else {
        desktopContainer.innerHTML = '<p class="empty-pool-text">No active party event.</p>';
    }
    mobileContainer.innerHTML = desktopContainer.innerHTML;
}

function renderLoot(desktopContainer, mobileContainer, lootPool) {
    desktopContainer.innerHTML = '';
    if (lootPool.length > 0) {
        lootPool.forEach(loot => desktopContainer.appendChild(createCardElement(loot)));
    } else {
        desktopContainer.innerHTML = '<p class="empty-pool-text">No discoveries yet.</p>';
    }
    mobileContainer.innerHTML = desktopContainer.innerHTML;
}

function renderSkillChallenge(desktopContainer, mobileContainer, challenge, isMyTurn) {
    desktopContainer.innerHTML = '';
    mobileContainer.innerHTML = '';
    document.getElementById('action-skill-challenge-btn').classList.add('hidden');
    document.getElementById('mobile-action-skill-challenge-btn').classList.add('hidden');

    if (challenge && challenge.isActive) {
        const challengeHTML = `
            <h3 class="panel-header">${challenge.name}</h3>
            <div class="challenge-content">
                <p>${challenge.description}</p>
                <p><strong>Check:</strong> DC ${challenge.dc} (${challenge.skill.toUpperCase()})</p>
            </div>
        `;
        desktopContainer.innerHTML = challengeHTML;
        mobileContainer.innerHTML = challengeHTML;
        desktopContainer.classList.remove('hidden');
        mobileContainer.classList.remove('hidden');

        if(isMyTurn) {
            document.getElementById('action-skill-challenge-btn').classList.remove('hidden');
            document.getElementById('mobile-action-skill-challenge-btn').classList.remove('hidden');
        }
    } else {
        desktopContainer.classList.add('hidden');
        mobileContainer.classList.add('hidden');
    }
}


function renderChat(chatLog) {
    const desktopLog = document.getElementById('chat-log');
    const mobileLog = document.getElementById('mobile-chat-log');
    
    const renderLog = (container) => {
        container.innerHTML = chatLog.map(msg => {
            const senderClass = msg.senderId === myId ? 'self' : '';
            return `<div class="chat-message">
                <span class="channel ${msg.channel}">${msg.channel.toUpperCase()}</span>
                <span class="sender ${senderClass}">${msg.senderName}:</span>
                <span class="message-text">${msg.message}</span>
            </div>`;
        }).join('');
        container.scrollTop = container.scrollHeight;
    };

    renderLog(desktopLog);
    renderLog(mobileLog);
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
    
    get('chat-toggle-btn').addEventListener('click', () => {
        get('chat-overlay').classList.toggle('hidden');
        get('menu-dropdown').classList.add('hidden');
        get('menu-toggle-btn').classList.remove('chat-notification');
    });
    get('chat-close-btn').addEventListener('click', () => get('chat-overlay').classList.add('hidden'));

    const handleChatSubmit = (form, channelInput, msgInput) => {
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const message = msgInput.value.trim();
            if (message) {
                socket.emit('chatMessage', { channel: channelInput.value, message });
                msgInput.value = '';
            }
        });
    };
    handleChatSubmit(get('chat-form'), get('chat-channel'), get('chat-input'));
    handleChatSubmit(get('mobile-chat-form'), get('mobile-chat-channel'), get('mobile-chat-input'));

    get('menu-toggle-btn').addEventListener('click', () => get('menu-dropdown').classList.toggle('hidden'));
    get('mobile-menu-toggle-btn').addEventListener('click', () => get('mobile-menu-dropdown').classList.toggle('hidden'));
    
    document.querySelectorAll('#leave-game-btn, #mobile-leave-game-btn').forEach(btn => {
        btn.addEventListener('click', () => window.location.reload());
    });

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
        if (endTurnBtn) { socket.emit('endTurn'); return; }
        
        const guardBtn = e.target.closest('#action-guard-btn, #mobile-action-guard-btn');
        if (guardBtn) { socket.emit('playerAction', { action: 'guard' }); return; }
        
        const respiteBtn = e.target.closest('#action-brief-respite-btn, #mobile-action-brief-respite-btn');
        if(respiteBtn) { socket.emit('playerAction', { action: 'briefRespite' }); return; }
        
        const restBtn = e.target.closest('#action-full-rest-btn, #mobile-action-full-rest-btn');
        if(restBtn) { socket.emit('playerAction', { action: 'fullRest' }); return; }

        const challengeBtn = e.target.closest('#action-skill-challenge-btn, #mobile-action-skill-challenge-btn');
        if (challengeBtn) {
            socket.emit('playerAction', { action: 'skillChallenge', challengeId: currentRoomState.gameState.skillChallenge.id });
            return;
        }
        
        const useAbilityBtn = e.target.closest('.use-ability-btn');
        if (useAbilityBtn) {
            const myPlayer = currentRoomState.players[myId];
            const ability = window.gameData.classes[myPlayer.class]?.ability;
            if(ability) {
                actionState = { type: 'useAbility', effect: ability };
                renderUI();
            }
            return;
        }
        
        const cancelBtn = e.target.closest('#action-cancel-btn');
        if (cancelBtn) {
            actionState = null;
            renderUI();
        }
    });

    get('narrative-cancel-btn').addEventListener('click', () => {
        get('narrative-modal').classList.add('hidden');
        actionState = null;
        renderUI();
    });
    get('narrative-confirm-btn').addEventListener('click', () => {
        socket.emit('playerAction', { 
            action: 'attack', 
            cardId: actionState.weaponId, 
            targetId: actionState.targetId,
            description: get('narrative-input').value.trim()
        });
        get('narrative-input').value = '';
        get('narrative-modal').classList.add('hidden');
        actionState = null;
    });
}

// --- 4. SOCKET EVENT HANDLERS ---
socket.on('connect', () => { myId = socket.id; });

socket.on('gameStateUpdate', (newState) => {
    // BUG FIX: The first time we get state, it includes static data. Store it globally.
    if (newState.staticDataForClient && typeof window.gameData === 'undefined') {
        window.gameData = { classes: newState.staticDataForClient.classes };
    }
    currentRoomState = newState;
    requestAnimationFrame(renderUI);
});

socket.on('actionError', (message) => {
    alert(`Error: ${message}`);
    actionState = null; // Clear pending action on error
    renderUI();
});

socket.on('chatMessage', (msg) => {
    currentRoomState.chatLog.push(msg);
    renderChat(currentRoomState.chatLog);
    if(document.getElementById('chat-overlay').classList.contains('hidden')) {
        document.getElementById('menu-toggle-btn').classList.add('chat-notification');
    }
});

socket.on('attackRollResult', (data) => showRollResult(data));
socket.on('damageRollResult', (data) => showRollResult(data));


// --- 5. HELPER FUNCTIONS ---
function showRollResult(data) {
    const isMyAction = data.attacker.id === myId;
    const toastContainer = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast-roll-overlay ${isMyAction ? 'self' : 'other'}`;

    const title = data.dice ? "Damage Roll" : "Attack/Skill Roll";
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