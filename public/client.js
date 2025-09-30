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
let autoNarrateEnabled = false; // Toggles the attack narration modal
let gameUIInitialized = false; // Flag to ensure game listeners are only attached once
let endTurnModalShownThisTurn = false; // Prevent repeated "out of AP" popups

// --- 2. CORE RENDERING ENGINE ---

/**
 * Creates an HTML element for a game card.
 * @param {object} card - The card data object.
 * @param {object} options - Configuration for card interactivity.
 * @returns {HTMLElement} The card element.
 */
function createCardElement(card, options = {}) {
    if (!card) return document.createElement('div');
    const { isEquippable = false, isUsable = false, isAttackable = false, isTargetable = false, isSelectableForDiscard = false, isClaimable = false } = options;
    const cardDiv = document.createElement('div');
    cardDiv.className = 'card';
    cardDiv.dataset.cardId = card.id;

    if (card.type === 'Monster') cardDiv.dataset.monsterId = card.id;

    if (isTargetable || isSelectableForDiscard) cardDiv.classList.add('valid-target');
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
    if (isClaimable) {
        const claimBtn = document.createElement('button');
        claimBtn.textContent = 'Claim';
        claimBtn.className = 'btn btn-xs btn-special claim-btn';
        claimBtn.onclick = (e) => { 
            e.stopPropagation(); 
            socket.emit('playerAction', { action: 'claimLoot', cardId: card.id });
        };
        cardDiv.appendChild(claimBtn);
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
    get('turn-counter-mobile').textContent = gameState.turnCount;


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
        const isTargetable = actionState && (actionState.type === 'attack' || actionState.effect?.target === 'any-monster' || (actionState.ability?.target === 'monster'));
        const cardEl = createCardElement(monster, { isTargetable });
        
        cardEl.onclick = () => {
            if (!isMyTurn || !actionState) return;

            if (actionState.type === 'attack') {
                actionState.targetId = monster.id;
                const weapon = myPlayer.equipment.weapon; // This is the equipped weapon object
                const weaponName = (actionState.weaponId === 'unarmed') ? 'Fists' : weapon?.name;

                if (!weaponName) return; // Safety check in case something is out of sync

                if (autoNarrateEnabled) {
                    // Skip the modal and send the action directly
                    socket.emit('playerAction', {
                        action: 'attack',
                        cardId: actionState.weaponId,
                        targetId: actionState.targetId,
                        description: '' // Empty description for auto-narrate
                    });
                    actionState = null;
                    renderUI(); // Re-render to clear action state visuals
                } else {
                    // Show a single, unified confirmation/narration modal
                    const narrativeModal = get('narrative-modal');
                    narrativeModal.querySelector('.panel-header').textContent = 'Confirm Attack';
                    get('narrative-prompt').innerHTML = `Attacking <strong>${monster.name}</strong> with <strong>${weaponName}</strong>.`;
                    get('narrative-input').value = ''; // Clear previous narration
                    get('narrative-confirm-btn').textContent = 'Confirm Attack';
                    narrativeModal.classList.remove('hidden');
                }

            } else if (isTargetable) {
                // Handle targeting for abilities or cards
                socket.emit('playerAction', { 
                    action: actionState.type === 'useAbility' ? 'useAbility' : 'useCard',
                    cardId: actionState.cardId,
                    targetId: monster.id 
                });
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
    renderLoot(get('party-loot-container'), get('mobile-party-loot-container'), gameState.lootPool, isMyTurn);
    renderSkillChallenge(get('skill-challenge-display'), get('mobile-skill-challenge-display'), gameState.skillChallenge, isMyTurn);

    // Check for out of AP and prompt to end turn
    if (isMyTurn && myPlayer.currentAp === 0 && !actionState && !endTurnModalShownThisTurn) {
        endTurnModalShownThisTurn = true;
        const endTurnModal = get('end-turn-confirm-modal');
        get('end-turn-prompt').textContent = "You are out of Action Points. Would you like to end your turn?";
        endTurnModal.classList.remove('hidden');
    }
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
        // A card is only "usable" if it's NOT part of a discard action
        const isSelectableForDiscard = actionState?.type === 'useAbility' && actionState.step === 'selectCard' && card.type.toLowerCase() === actionState.cost.cardType.toLowerCase();
        const isUsable = (card.type === 'Spell' || card.type === 'Item') && isMyTurn && !isSelectableForDiscard;

        const cardEl = createCardElement(card, { isEquippable, isUsable, isSelectableForDiscard });

        if (isSelectableForDiscard) {
            cardEl.onclick = () => {
                socket.emit('playerAction', { 
                    action: 'useAbility',
                    cardToDiscardId: card.id 
                });
                actionState = null; // Reset state after action
                renderUI();
            };
        }
        hand.appendChild(cardEl);
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

function renderLoot(desktopContainer, mobileContainer, lootPool, isMyTurn) {
    desktopContainer.innerHTML = '';
    if (lootPool.length > 0) {
        lootPool.forEach(loot => desktopContainer.appendChild(createCardElement(loot, { isClaimable: isMyTurn })));
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
                <p><strong>Progress:</strong> ${challenge.successes}/${challenge.successThreshold} Successes | ${challenge.failures}/${challenge.failureThreshold} Failures</p>
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
        container.innerHTML = (chatLog || []).map(msg => {
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

    const mobileLogToggle = document.querySelector('.mobile-log-toggle');
    if (mobileLogToggle) {
        mobileLogToggle.addEventListener('click', (e) => {
            const btn = e.target.closest('.log-toggle-btn');
            if (!btn) return;

            const logType = btn.dataset.log;

            document.querySelectorAll('.log-toggle-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            document.getElementById('mobile-chat-log').classList.toggle('hidden', logType !== 'chat');
            document.getElementById('mobile-game-log').classList.toggle('hidden', logType !== 'log');
            document.getElementById('mobile-chat-form').classList.toggle('hidden', logType !== 'chat');
        });
    }


    get('menu-toggle-btn').addEventListener('click', () => get('menu-dropdown').classList.toggle('hidden'));
    get('mobile-menu-toggle-btn').addEventListener('click', () => get('mobile-menu-dropdown').classList.toggle('hidden'));
    
    document.querySelectorAll('#leave-game-btn, #mobile-leave-game-btn').forEach(btn => {
        btn.addEventListener('click', () => window.location.reload());
    });
    
    const handleAutoNarrateToggle = () => {
        autoNarrateEnabled = !autoNarrateEnabled;
        const statusText = `Auto-Narrate: ${autoNarrateEnabled ? 'ON' : 'OFF'}`;
        const mobileIcon = autoNarrateEnabled ? 'auto_stories' : 'speaker_notes_off';
        
        // Desktop update
        get('auto-narrate-label').textContent = statusText;
        
        // Mobile update
        const mobileBtn = get('mobile-auto-narrate-btn');
        mobileBtn.title = statusText;
        get('mobile-auto-narrate-icon').textContent = mobileIcon;

        // Common actions
        showToast(statusText, 'info');
        get('menu-dropdown').classList.add('hidden');
        get('mobile-menu-dropdown').classList.add('hidden');
    };

    get('auto-narrate-btn').addEventListener('click', handleAutoNarrateToggle);
    get('mobile-auto-narrate-btn').addEventListener('click', handleAutoNarrateToggle);

    const setupModal = (modalId, confirmBtnId, cancelBtnId, onConfirm) => {
        const modal = get(modalId);
        get(confirmBtnId).addEventListener('click', () => {
            onConfirm();
            modal.classList.add('hidden');
        });
        get(cancelBtnId).addEventListener('click', () => {
            modal.classList.add('hidden');
            if(actionState) delete actionState.targetId;
            renderUI();
        });
    };

    setupModal('narrative-modal', 'narrative-confirm-btn', 'narrative-cancel-btn', () => {
        if (!actionState || actionState.type !== 'attack') {
            actionState = null;
            renderUI();
            return;
        }
        socket.emit('playerAction', {
            action: 'attack', cardId: actionState.weaponId,
            targetId: actionState.targetId,
            description: get('narrative-input').value.trim()
        });
        actionState = null;
        renderUI();
    });

    // Wire up the end turn modal
    get('end-turn-confirm-btn').addEventListener('click', () => {
        socket.emit('endTurn');
        get('end-turn-confirm-modal').classList.add('hidden');
    });
    get('end-turn-cancel-btn').addEventListener('click', () => {
        get('end-turn-confirm-modal').classList.add('hidden');
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
        if (endTurnBtn) {
            const myPlayer = currentRoomState.players[myId];
            if (myPlayer.currentAp > 0) {
                get('end-turn-prompt').textContent = 'You still have Action Points remaining. Are you sure you want to end your turn?';
                get('end-turn-confirm-modal').classList.remove('hidden');
            } else {
                socket.emit('endTurn');
            }
            return;
        }
        
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
            if (ability) {
                if (ability.cost?.type === 'discard') {
                    actionState = { type: 'useAbility', step: 'selectCard', cost: ability.cost, ability: ability };
                    showToast(`Choose a ${ability.cost.cardType} card from your hand to discard.`, 'info');
                } else if (ability.target) {
                    actionState = { type: 'useAbility', ability: ability, effect: { target: ability.target } };
                    showToast(`Choose a ${ability.target} to target.`, 'info');
                } else {
                    socket.emit('playerAction', { action: 'useAbility' });
                }
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
}

// --- 4. SOCKET EVENT HANDLERS ---
socket.on('connect', () => { myId = socket.id; });

socket.on('gameStateUpdate', (newState) => {
    // The first time we get state, it includes static data. Store it globally.
    if (newState.staticDataForClient && typeof window.gameData === 'undefined') {
        window.gameData = { classes: newState.staticDataForClient.classes };
    }
    const oldTurnPlayerId = currentRoomState.gameState?.turnOrder[currentRoomState.gameState?.currentPlayerIndex];
    const newTurnPlayerId = newState.gameState.turnOrder[newState.gameState.currentPlayerIndex];

    currentRoomState = newState;
    requestAnimationFrame(renderUI);

    // Show "Your Turn" popup and reset modal flag
    if (newTurnPlayerId === myId && oldTurnPlayerId !== myId) {
        endTurnModalShownThisTurn = false;
        const popup = document.getElementById('your-turn-popup');
        popup.classList.remove('hidden');
        setTimeout(() => popup.classList.add('hidden'), 2000);
    }
});

socket.on('actionError', (message) => {
    showToast(`${message}`, 'error', 2500);
    actionState = null; // Clear pending action on error
    renderUI();
});

socket.on('chatMessage', (msg) => {
    if(!currentRoomState.chatLog) currentRoomState.chatLog = [];
    currentRoomState.chatLog.push(msg);
    renderChat(currentRoomState.chatLog);
    if(document.getElementById('chat-overlay').classList.contains('hidden')) {
        document.getElementById('menu-toggle-btn').classList.add('chat-notification');
    }
});

socket.on('attackRollResult', (data) => showDiceRollModal(data));
socket.on('damageRollResult', (data) => showDiceRollModal(data));


// --- 5. HELPER FUNCTIONS ---
function showDiceRollModal(data) {
    const get = id => document.getElementById(id);
    const modal = get('dice-roll-modal');
    const titleEl = get('dice-roll-title');
    const spinnerContainer = get('dice-spinner-container');
    const resultContainer = get('dice-result-container');
    const resultLineEl = get('dice-roll-result-line');
    const detailsEl = get('dice-roll-details');

    const title = data.dice ? "Damage Roll" : "Attack/Skill Roll";
    const resultColor = data.result === 'HIT' || data.result === 'CRITICAL HIT' || data.result === 'SUCCESS' ? 'var(--color-success)' : 'var(--color-danger)';
    
    let detailsHtml = '';
    if (data.dice) { // Damage roll
        titleEl.textContent = `${data.attacker.name}'s Damage Roll`;
        resultLineEl.textContent = `${data.total} Damage!`;
        resultLineEl.style.color = 'var(--stat-color-hp)';
        detailsHtml = `Rolled ${data.roll} (${data.dice}) + ${data.bonus} bonus`;
    } else { // Attack/Skill roll
        titleEl.textContent = `${data.attacker.name}'s ${data.target.name} Roll`;
        resultLineEl.textContent = data.result || '';
        resultLineEl.style.color = resultColor;
        detailsHtml = `Rolled ${data.roll} (d20) + ${data.bonus} bonus = <strong>${data.total}</strong> vs DC ${data.required}`;
    }

    spinnerContainer.classList.remove('hidden');
    resultContainer.classList.add('hidden');
    modal.classList.remove('hidden');

    setTimeout(() => {
        spinnerContainer.classList.add('hidden');
        detailsEl.innerHTML = detailsHtml;
        resultContainer.classList.remove('hidden');

        setTimeout(() => {
            modal.classList.add('hidden');
        }, 2400);
    }, 1500); // Animation duration
}

function showToast(message, type = 'info', duration = 3000) {
    const toastContainer = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast-message type-${type}`;
    toast.textContent = message;

    toastContainer.appendChild(toast);
    setTimeout(() => { toast.classList.add('visible'); }, 10);
    setTimeout(() => {
        toast.classList.remove('visible');
        toast.addEventListener('transitionend', () => toast.remove());
    }, duration);
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