// This script handles the client-side logic for interacting with the server.

const socket = io();

// --- Client State ---
let myPlayerInfo = {};
let myId = '';
let currentRoomState = {};
let localStream;
const peerConnections = {};
let selectedTargetId = null; // For combat targeting
let selectedWeaponId = null; // For selecting a weapon to attack with
let pendingActionData = null; // For narrative modal
let isMyTurnPreviously = false; // For "Your Turn" popup
let tempSelectedClassId = null; // For temporary class selection in lobby
let pendingAbilityConfirmation = null; // For non-attack ability confirmation
let apModalShownThisTurn = false; // For AP management pop-up
const modalQueue = [];
let isModalActive = false;
let currentSkipHandler = null; // Holds the function to skip the current skippable modal
let isResolvingWorldEvent = false;
let modalWatchdog = null;
let selectedItemIdForChallenge = null;
const iceServers = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

// Static data for rendering class cards without needing a server round-trip
const classData = {
    Barbarian: { baseHp: 24, baseDamageBonus: 4, baseShieldBonus: 0, baseAp: 3, healthDice: 4, description: "A fierce warrior of primal rage.", abilities: ["Rage", "Reckless Attack"] },
    Cleric:    { baseHp: 20, baseDamageBonus: 1, baseShieldBonus: 3, baseAp: 2, healthDice: 3, description: "A conduit for divine power.", abilities: ["Channel Divinity", "Turn Undead"] },
    Mage:      { baseHp: 18, baseDamageBonus: 1, baseShieldBonus: 2, baseAp: 2, healthDice: 2, description: "Wielder of arcane energies.", abilities: ["Arcane Recovery", "Spell Mastery"] },
    Ranger:    { baseHp: 20, baseDamageBonus: 2, baseShieldBonus: 2, baseAp: 2, healthDice: 3, description: "A peerless hunter and scout.", abilities: ["Favored Enemy", "Hunter's Mark"] },
    Rogue:     { baseHp: 18, baseDamageBonus: 3, baseShieldBonus: 1, baseAp: 3, healthDice: 2, description: "A master of stealth and precision.", abilities: ["Sneak Attack", "Evasion"] },
    Warrior:   { baseHp: 22, baseDamageBonus: 2, baseShieldBonus: 4, baseAp: 3, description: "A master of arms and armor.", abilities: ["Second Wind", "Defensive Stance"] },
};


// --- DOM Element References ---
const get = (id) => document.getElementById(id);

// Lobby
const lobbyScreen = get('lobby');
const playerNameInput = get('playerName');
const createRoomBtn = get('createRoomBtn');
const joinRoomBtn = get('joinRoomBtn');
const roomIdInput = get('roomIdInput');
const gameModeSelector = get('game-mode-selector');

// Main Game Area
const gameArea = get('game-area');

// Desktop
const turnIndicator = get('turn-indicator');
const turnCounter = get('turn-counter');
const startGameBtn = get('startGameBtn');
const joinVoiceBtn = get('join-voice-btn');
const dmControls = get('dm-controls');
const dmPlayMonsterBtn = get('dm-play-monster-btn');
const playerList = get('player-list');
const roomCodeDisplay = get('room-code');
const classSelectionDiv = get('class-selection');
const classCardsContainer = get('class-cards-container');
const confirmClassBtn = get('confirm-class-btn');
const playerStatsContainer = get('player-stats-container');
const playerClassName = get('player-class-name');
const playerStatsDiv = get('player-stats');
const equippedItemsDiv = get('equipped-items');
const advancedCardChoiceDiv = get('advanced-card-choice');
const advancedChoiceButtonsDiv = get('advanced-choice-buttons');
const playerHandDiv = get('player-hand');
const gameBoardDiv = get('board-cards');
const worldEventsContainer = get('world-events-container');
const partyLootContainer = get('party-loot-container');
const gameLogContent = get('game-log-content');
const leaveGameBtn = get('leave-game-btn');
const desktopTabButtons = document.querySelectorAll('.game-area-desktop .tab-btn');

// Desktop Action Bar
const fixedActionBar = get('fixed-action-bar');
const actionAttackBtn = get('action-attack-btn');
const actionSkillChallengeBtn = get('action-skill-challenge-btn');
const actionGuardBtn = get('action-guard-btn');
const actionBriefRespiteBtn = get('action-brief-respite-btn');
const actionFullRestBtn = get('action-full-rest-btn');
const actionEndTurnBtn = get('action-end-turn-btn');

// Mobile
const mobileTurnIndicator = get('mobile-turn-indicator');
const mobileTurnCounter = get('mobile-turn-counter');
const mobileStartGameBtn = get('mobile-startGameBtn');
const mobileBoardCards = get('mobile-board-cards');
const mobilePlayerHand = get('mobile-player-hand');
const mobileClassSelection = get('mobile-class-selection');
const mobileClassCardsContainer = get('mobile-class-cards-container');
const mobileConfirmClassBtn = get('mobile-confirm-class-btn');
const mobilePlayerStats = get('mobile-player-stats');
const mobilePlayerClassName = get('mobile-player-class-name');
const mobileStatsDisplay = get('mobile-stats-display');
const mobilePlayerEquipment = get('mobile-player-equipment');
const mobileEquippedItems = get('mobile-equipped-items');
const mobilePlayerList = get('mobile-player-list');
const mobileWorldEventsContainer = get('mobile-world-events-container');
const mobilePartyLootContainer = get('mobile-party-loot-container');
const mobileLeaveGameBtn = get('mobile-leave-game-btn');
const mobileBottomNav = document.querySelector('.mobile-bottom-nav');
const mobileChatLog = get('mobile-chat-log');
const mobileChatForm = get('mobile-chat-form');
const mobileChatChannel = get('mobile-chat-channel');
const mobileChatInput = get('mobile-chat-input');
const mobileActionBar = get('mobile-action-bar');
const mobileActionAttackBtn = get('mobile-action-attack-btn');
const mobileActionSkillChallengeBtn = get('mobile-action-skill-challenge-btn');
const mobileActionGuardBtn = get('mobile-action-guard-btn');
const mobileActionBriefRespiteBtn = get('mobile-action-brief-respite-btn');
const mobileActionFullRestBtn = get('mobile-action-full-rest-btn');
const mobileActionEndTurnBtn = get('mobile-action-end-turn-btn');


// Shared Overlays & Modals
const chatOverlay = get('chat-overlay');
const chatToggleBtn = get('chat-toggle-btn');
const chatCloseBtn = get('chat-close-btn');
const chatLog = get('chat-log');
const chatForm = get('chat-form');
const chatChannel = get('chat-channel');
const chatInput = get('chat-input');
const narrativeModal = get('narrative-modal');
const narrativePrompt = get('narrative-prompt');
const narrativeInput = get('narrative-input');
const narrativeCancelBtn = get('narrative-cancel-btn');
const narrativeConfirmBtn = get('narrative-confirm-btn');
const yourTurnPopup = get('your-turn-popup');
const rollResultPopup = get('roll-result-popup');
const apModal = get('ap-modal');
const apModalCancelBtn = get('ap-modal-cancel-btn');
const apModalConfirmBtn = get('ap-modal-confirm-btn');
const endTurnConfirmModal = get('end-turn-confirm-modal');
const endTurnCancelBtn = get('end-turn-cancel-btn');
const endTurnConfirmBtn = get('end-turn-confirm-btn');
const diceRollOverlay = get('dice-roll-overlay');
const diceRollTitle = get('dice-roll-title');
const attackDice = get('attack-dice');
const diceRollResult = get('dice-roll-result');
const eventOverlay = get('event-overlay');
const eventRollContainer = get('event-roll-container');
const rollDiceBtn = get('roll-dice-btn');
const eventDiceAnimationContainer = get('event-dice-animation-container');
const dice = get('dice');
const eventResultContainer = get('event-result-container');
const eventResultTitle = get('event-result-title');
const eventResultSubtitle = get('event-result-subtitle');
const eventCardSelection = get('event-card-selection');
const eventResultOkayBtn = get('event-result-okay-btn');
const worldEventSaveModal = get('world-event-save-modal');
const worldEventSaveTitle = get('world-event-save-title');
const worldEventSavePrompt = get('world-event-save-prompt');
const worldEventDice = get('world-event-dice');
const worldEventRollResult = get('world-event-roll-result');
const worldEventSaveRollBtn = get('world-event-save-roll-btn');
const worldEventSaveContinueBtn = get('world-event-save-continue-btn');
const voiceChatContainer = get('voice-chat-container');
const skipPopupBtn = get('skip-popup-btn');
const skillChallengeOverlay = get('skill-challenge-overlay');
const skillChallengeTitle = get('skill-challenge-title');
const skillChallengeDesc = get('skill-challenge-desc');
const skillChallengeProgress = get('skill-challenge-progress');
const skillChallengeInfo = get('skill-challenge-info');
const skillChallengeLog = get('skill-challenge-log');
const skillChallengeCloseBtn = get('skill-challenge-close-btn');
const itemSelectModal = get('item-select-modal');
const itemSelectContainer = get('item-select-container');
const itemSelectCancelBtn = get('item-select-cancel-btn');
const itemSelectConfirmBtn = get('item-select-confirm-btn');


// --- Helper Functions ---
const randomAttackDescriptions = [
    "strikes with a fierce shout, pouring all their strength into the action.",
    "delivers a powerful, calculated strike.",
    "moves with surprising speed, finding an opening.",
    "unleashes a precise and deadly blow.",
    "attacks with a determined grimace, aiming for a weak spot.",
    "executes a well-practiced maneuver with fluid grace.",
    "lunges forward, their weapon a blur of motion."
];

function generate_random_attack_description() {
    return randomAttackDescriptions[Math.floor(Math.random() * randomAttackDescriptions.length)];
}

function closeAllModals() {
    console.error("Force-closing all modals due to watchdog timer.");
    narrativeModal.classList.add('hidden');
    apModal.classList.add('hidden');
    endTurnConfirmModal.classList.add('hidden');
    diceRollOverlay.classList.add('hidden');
    eventOverlay.classList.add('hidden');
    worldEventSaveModal.classList.add('hidden');
    skillChallengeOverlay.classList.add('hidden');
    itemSelectModal.classList.add('hidden');
    modalQueue.length = 0; // Clear the queue
    finishModal(); // Reset state, including watchdog
}

function startModalWatchdog() {
    clearModalWatchdog();
    modalWatchdog = setTimeout(closeAllModals, 10000); // 10 second failsafe
}

function clearModalWatchdog() {
    if (modalWatchdog) {
        clearTimeout(modalWatchdog);
        modalWatchdog = null;
    }
}

function processModalQueue() {
    if (isModalActive || modalQueue.length === 0) {
        return;
    }
    isModalActive = true;
    startModalWatchdog();
    const { showFunction } = modalQueue.shift();
    showFunction();
}

function addToModalQueue(showFunction, id) {
    if (!modalQueue.some(item => item.id === id)) {
        modalQueue.push({ showFunction, id });
        processModalQueue();
    }
}

function finishModal() {
    isModalActive = false;
    clearModalWatchdog();
    currentSkipHandler = null; // Clear any active skip handler
    skipPopupBtn.classList.add('hidden'); // Ensure skip button is hidden
    setTimeout(processModalQueue, 200); // Small delay for smoother transitions
}


function showRollResult(rollValue, type = 'd20') {
    if (!rollResultPopup) return;
    
    rollResultPopup.textContent = `${type}: ${rollValue}`;
    rollResultPopup.classList.add('visible');
    
    setTimeout(() => {
        rollResultPopup.classList.remove('visible');
    }, 1500); // Display for 1.5 seconds
}

function logMessage(message, options = {}) {
    const { type = 'system', channel, senderName, isNarrative = false } = options;
    const p = document.createElement('p');
    p.classList.add('chat-message');
    if (type === 'system') {
        p.classList.add('system');
        p.innerHTML = `<span>[System]</span> ${message}`;
    } else if (type === 'chat') {
        if (isNarrative) {
             p.classList.add('narrative');
             p.innerHTML = `<strong>${senderName}:</strong> ${message}`;
        } else {
            const isSelf = senderName === myPlayerInfo.name;
            const channelTag = channel === 'party' ? '[Party]' : '[Game]';
            const channelClass = channel === 'party' ? 'party' : 'game';
            const senderClass = isSelf ? 'self' : 'other';
            p.innerHTML = `<span class="channel ${channelClass}">${channelTag}</span> <span class="sender ${senderClass}">${senderName}:</span> <span class="message">${message}</span>`;
        }
    }
    
    // Append to dedicated game log if it's a game/system/narrative message
    if (type === 'system' || channel === 'game' || isNarrative) {
        if (gameLogContent) {
            gameLogContent.appendChild(p.cloneNode(true));
            gameLogContent.scrollTop = gameLogContent.scrollHeight;
        }
    }

    // Append to all relevant chat logs
    chatLog.appendChild(p.cloneNode(true));
    chatLog.scrollTop = chatLog.scrollHeight;
    
    if (mobileChatLog) {
        mobileChatLog.appendChild(p.cloneNode(true));
        mobileChatLog.scrollTop = mobileChatLog.scrollHeight;
    }
}

function openNarrativeModal(actionData, cardName) {
    addToModalQueue(() => {
        pendingActionData = actionData;
        narrativePrompt.textContent = `How do you use ${cardName}?`;
        narrativeInput.value = '';
        narrativeModal.classList.remove('hidden');
        narrativeInput.focus();
    }, 'narrative-modal');
}

function closeNarrativeModal() {
    pendingActionData = null;
    narrativeModal.classList.add('hidden');
    
    // On any close, reset selections to prevent dangling state.
    selectedWeaponId = null;
    selectedTargetId = null;
    if (currentRoomState.id) {
        renderGameState(currentRoomState);
    }
    
    finishModal();
}

function createCardElement(card, actions = {}) {
    const { isPlayable = false, isEquippable = false, isTargetable = false } = actions;
    const cardDiv = document.createElement('div');
    cardDiv.className = 'card';
    cardDiv.dataset.cardId = card.id;

    if (card.type === 'Monster') {
        cardDiv.dataset.monsterId = card.id;
        if(isTargetable) cardDiv.classList.add('targetable');
    }
    
    let typeInfo = card.type;
    if (card.category && card.category !== 'General') typeInfo += ` / ${card.category}`;
    else if (card.type === 'World Event' && card.tags) typeInfo = card.tags;
    
    let bonusesHTML = '';
    if (card.effect?.bonuses) {
        bonusesHTML = Object.entries(card.effect.bonuses).map(([key, value]) => 
            `<div class="card-bonus">${key.charAt(0).toUpperCase() + key.slice(1)}: ${value > 0 ? '+' : ''}${value}</div>`
        ).join('');
    }
    
    let monsterStatsHTML = '';
    if(card.type === 'Monster') {
        monsterStatsHTML = `<div class="card-bonus">HP: ${card.currentHp} / ${card.maxHp}</div>`;
    }

    let statusEffectsHTML = '';
    if (card.statusEffects && card.statusEffects.length > 0) {
        statusEffectsHTML = `<div class="status-effects-container">` +
            card.statusEffects.map(e => `<span class="status-effect">${e.name}</span>`).join(' ') +
            `</div>`;
    }

    cardDiv.innerHTML = `
        <div class="card-content">
            <h3 class="card-title">${card.name}</h3>
            <p class="card-effect">${card.effect?.description || card.description || card.outcome || ''}</p>
        </div>
        ${statusEffectsHTML}
        <div class="card-footer">
            ${bonusesHTML}
            ${monsterStatsHTML}
            <p class="card-type">${typeInfo}</p>
        </div>
    `;
    
    const actionContainer = document.createElement('div');
    actionContainer.className = 'card-actions';

    if (isPlayable) {
        const playBtn = document.createElement('button');
        const cardEffect = card.effect || {};
        playBtn.textContent = card.type === 'Spell' ? 'Cast' : 'Use';
        playBtn.className = 'btn btn-xs btn-primary';
        playBtn.onclick = () => {
            if ((cardEffect.type === 'damage' || cardEffect.target === 'any-monster') && !selectedTargetId) {
                alert("You must select a monster to target!");
                return;
            }
            const action = card.type === 'Spell' ? 'castSpell' : 'useItem';
            openNarrativeModal({ action, cardId: card.id, targetId: selectedTargetId }, card.name);
            selectedTargetId = null; // Reset target after opening modal
        };
        actionContainer.appendChild(playBtn);
    }
    if (isEquippable) {
        const equipBtn = document.createElement('button');
        equipBtn.textContent = 'Equip';
        equipBtn.className = 'btn btn-xs btn-success';
        equipBtn.onclick = () => socket.emit('equipItem', { cardId: card.id });
        actionContainer.appendChild(equipBtn);
    }
    cardDiv.appendChild(actionContainer);
    return cardDiv;
}

function renderPlayerList(players, gameState, listElement) {
    const currentPlayerId = gameState.turnOrder[gameState.currentPlayerIndex] || null;
    listElement.innerHTML = ''; 
    Object.values(players).forEach(player => {
        const isCurrentTurn = player.id === currentPlayerId;
        const li = document.createElement('li');
        li.id = `player-${player.id}`;
        li.className = `player-list-item ${isCurrentTurn ? 'active' : ''}`;
        
        const npcTag = player.isNpc ? '<span class="npc-tag">[NPC]</span> ' : '';
        const roleClass = player.role === 'DM' ? 'dm' : 'explorer';
        const classText = player.class && player.role !== 'DM' ? `<span class="player-class"> - ${player.class}</span>` : '';
        
        const statusEffectsHTML = (player.statusEffects || [])
            .map(e => `<span class="status-effect-sm">${e.name}</span>`)
            .join(' ');

        li.innerHTML = `
            <div class="player-info">
                <span>${npcTag}${player.name}${classText}</span>
                <span class="player-role ${roleClass}">${player.role}</span>
            </div>
            <div class="player-hp">HP: ${player.stats.currentHp || '?'} / ${player.stats.maxHp || '?'}</div>
            <div class="player-status-effects">${statusEffectsHTML}</div>
        `;
        listElement.appendChild(li);
    });
}

function renderGameState(room) {
    const oldLootCount = currentRoomState.gameState?.lootPool?.length || 0;
    currentRoomState = room;
    const { players, gameState, hostId } = room;
    myPlayerInfo = players[myId];
    if (!myPlayerInfo) return;
    const newLootCount = gameState.lootPool?.length || 0;

    // --- Dynamic Tab Highlighting ---
    const worldEventTab = document.querySelector('[data-tab="world-events-tab"]');
    if (myPlayerInfo.pendingWorldEventSave) {
        worldEventTab.classList.add('highlight');
    }
    const partyLootTab = document.querySelector('[data-tab="party-loot-tab"]');
    if (newLootCount > oldLootCount) {
        partyLootTab.classList.add('highlight');
    }
    const mobileInfoTab = document.querySelector('.nav-btn[data-screen="info"]');
     if (myPlayerInfo.pendingWorldEventSave || newLootCount > oldLootCount) {
        mobileInfoTab.classList.add('highlight');
    }


    renderPlayerList(players, gameState, playerList);
    renderPlayerList(players, gameState, mobilePlayerList);
    
    // --- Phase-specific UI rendering ---
    const isHost = myId === hostId;
    const isDM = myPlayerInfo.role === 'DM';
    const isExplorer = myPlayerInfo.role === 'Explorer';
    const hasConfirmedClass = !!myPlayerInfo.class;
    const currentTurnTakerId = gameState.turnOrder[gameState.currentPlayerIndex];
    const isMyTurn = currentTurnTakerId === myId;
    const isStunned = myPlayerInfo.statusEffects && myPlayerInfo.statusEffects.some(e => e.type === 'stun' || e.name === 'Stunned');
    
    // --- Universal UI state ---
    [startGameBtn, mobileStartGameBtn].forEach(btn => btn.classList.toggle('hidden', !isHost || gameState.phase !== 'lobby'));
    [leaveGameBtn, mobileLeaveGameBtn].forEach(btn => btn.classList.toggle('hidden', gameState.phase === 'lobby'));
    
    // Desktop specific
    classSelectionDiv.classList.toggle('hidden', hasConfirmedClass || !isExplorer);
    advancedCardChoiceDiv.classList.toggle('hidden', gameState.phase !== 'advanced_setup_choice' || myPlayerInfo.madeAdvancedChoice);
    playerStatsContainer.classList.toggle('hidden', !hasConfirmedClass || !isExplorer);
    dmControls.classList.toggle('hidden', !isDM || !isMyTurn);
    gameModeSelector.classList.toggle('hidden', !isHost || gameState.phase !== 'lobby');
    
    // Mobile specific
    const inMobileClassSelection = !hasConfirmedClass && isExplorer;
    if (inMobileClassSelection) {
        // If we are in class selection, force the character screen to be active
        if (!get('mobile-screen-character').classList.contains('active')) {
             document.querySelectorAll('.mobile-screen').forEach(s => s.classList.remove('active'));
             get('mobile-screen-character').classList.add('active');
             mobileBottomNav.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
             document.querySelector('.nav-btn[data-screen="character"]').classList.add('active');
        }
        mobileClassSelection.classList.remove('hidden');
        mobilePlayerStats.classList.add('hidden');
    } else {
        mobileClassSelection.classList.add('hidden');
        mobilePlayerStats.classList.toggle('hidden', !hasConfirmedClass || !isExplorer);
    }


    // --- Action Bars ---
    const showActionBar = isMyTurn && isExplorer && !isStunned;
    const challenge = gameState.skillChallenge;
    fixedActionBar.classList.toggle('hidden', !showActionBar);
    mobileActionBar.classList.toggle('hidden', !showActionBar);

    if (showActionBar) {
        const canGuard = myPlayerInfo.currentAp >= 1;
        const canBriefRespite = myPlayerInfo.currentAp >= 1 && myPlayerInfo.healthDice.current > 0;
        const canFullRest = myPlayerInfo.currentAp >= 2 && myPlayerInfo.healthDice.current >= 2;
        const showAttackButton = selectedWeaponId && selectedTargetId;
        const showChallengeButton = challenge && challenge.isActive && myPlayerInfo.currentAp >= 1;

        // Desktop
        actionAttackBtn.classList.toggle('hidden', !showAttackButton);
        actionSkillChallengeBtn.classList.toggle('hidden', !showChallengeButton);
        actionGuardBtn.disabled = !canGuard;
        actionBriefRespiteBtn.disabled = !canBriefRespite;
        actionFullRestBtn.disabled = !canFullRest;

        // Mobile
        mobileActionAttackBtn.classList.toggle('hidden', !showAttackButton);
        mobileActionSkillChallengeBtn.classList.toggle('hidden', !showChallengeButton);
        mobileActionGuardBtn.disabled = !canGuard;
        mobileActionBriefRespiteBtn.disabled = !canBriefRespite;
        mobileActionFullRestBtn.disabled = !canFullRest;
    }


    if (isMyTurn && !isMyTurnPreviously) {
        apModalShownThisTurn = false;
        pendingAbilityConfirmation = null;
        selectedWeaponId = null;
        selectedTargetId = null;
        pendingActionData = null;
        addToModalQueue(() => {
            yourTurnPopup.classList.remove('hidden');
            const timeoutId = setTimeout(() => {
                yourTurnPopup.classList.add('hidden');
                finishModal();
            }, 1500);

            currentSkipHandler = () => {
                clearTimeout(timeoutId);
                yourTurnPopup.classList.add('hidden');
                finishModal();
            };
        }, 'your-turn-popup');
    }
    isMyTurnPreviously = isMyTurn;
    
    if (isMyTurn && myPlayerInfo.pendingEventRoll) {
        addToModalQueue(() => {
            eventOverlay.classList.remove('hidden');
            eventRollContainer.classList.remove('hidden');
            eventDiceAnimationContainer.classList.add('hidden');
            eventResultContainer.classList.add('hidden');
        }, 'event-roll');
    } else if (!myPlayerInfo.pendingEventChoice) {
        eventOverlay.classList.add('hidden');
    }
    
    if (myPlayerInfo.pendingWorldEventSave) {
        addToModalQueue(() => {
            worldEventSaveModal.classList.remove('hidden');
            const { dc, save, eventName } = myPlayerInfo.pendingWorldEventSave;
            worldEventSaveTitle.textContent = eventName;
            worldEventSavePrompt.textContent = `You must make a DC ${dc} ${save} save!`;

            // Reset modal state
            worldEventSaveRollBtn.disabled = false;
            worldEventSaveRollBtn.classList.remove('hidden');
            worldEventRollResult.classList.add('hidden');
            worldEventSaveContinueBtn.classList.add('hidden');
        }, 'world-event-save');
    } else {
        if (!isResolvingWorldEvent) {
            worldEventSaveModal.classList.add('hidden');
        }
    }

    if (challenge && challenge.isActive) {
        skillChallengeOverlay.classList.remove('hidden');
        skillChallengeTitle.textContent = challenge.name;
        skillChallengeDesc.textContent = challenge.description;
        skillChallengeInfo.innerHTML = `Roll against <b>DC ${challenge.dc}</b> using <b>${challenge.skill.toUpperCase()}</b>.`;
        skillChallengeProgress.innerHTML = `
            <div class="progress-bar-container">
                <label>Successes (${challenge.successes} / ${challenge.successThreshold})</label>
                <div class="progress-bar success">
                    <div style="width: ${(challenge.successes / challenge.successThreshold) * 100}%"></div>
                </div>
            </div>
            <div class="progress-bar-container">
                <label>Failures (${challenge.failures} / ${challenge.failureThreshold})</label>
                <div class="progress-bar danger">
                    <div style="width: ${(challenge.failures / challenge.failureThreshold) * 100}%"></div>
                </div>
            </div>
        `;
        skillChallengeLog.innerHTML = '';
        challenge.log.forEach(entry => {
            const p = document.createElement('p');
            p.innerHTML = entry;
            skillChallengeLog.appendChild(p);
        });
        skillChallengeLog.scrollTop = skillChallengeLog.scrollHeight;
    } else {
        skillChallengeOverlay.classList.add('hidden');
    }


    // --- Class Selection ---
    if (!hasConfirmedClass && isExplorer) {
        [classCardsContainer, mobileClassCardsContainer].forEach(container => {
             if (container.children.length === 0) {
                for (const [classId, data] of Object.entries(classData)) {
                    const card = document.createElement('div');
                    card.className = 'class-card';
                    card.dataset.classId = classId;
                    card.innerHTML = `
                        <h3 class="class-card-title">${classId}</h3>
                        <p class="class-card-desc">${data.description}</p>
                        <div class="class-card-stats">
                            <span>HP:</span><span>${data.baseHp}</span>
                            <span>AP:</span><span>${data.baseAp}</span>
                            <span>DMG Bonus:</span><span>+${data.baseDamageBonus}</span>
                            <span>SHIELD Bonus:</span><span>+${data.baseShieldBonus}</span>
                            <span>Health Dice:</span><span>${data.healthDice}</span>
                        </div>
                    `;
                    container.appendChild(card);
                }
            }
            container.querySelectorAll('.class-card').forEach(card => {
                const classId = card.dataset.classId;
                card.classList.toggle('selected', classId === tempSelectedClassId);
                card.onclick = () => {
                    tempSelectedClassId = classId;
                    renderGameState(currentRoomState);
                };
            });
        });
       [confirmClassBtn, mobileConfirmClassBtn].forEach(btn => {
            btn.classList.toggle('hidden', !tempSelectedClassId);
            btn.disabled = false;
            btn.textContent = 'Confirm Class';
       });
    } else if (hasConfirmedClass) {
        tempSelectedClassId = null;
    }
    
    // --- Turn Indicators ---
    [turnCounter, mobileTurnCounter].forEach(el => el.textContent = gameState.turnCount);
    if (gameState.phase !== 'lobby') {
        const turnTaker = players[currentTurnTakerId];
        let turnText = 'Waiting...';
        if (turnTaker) {
            if (turnTaker.role === 'DM') turnText = "Dungeon Master's Turn";
            else turnText = `Turn: ${turnTaker.name}`;
            if(isMyTurn) turnText += ' (Your Turn)';
        }
        turnIndicator.textContent = turnText;
        mobileTurnIndicator.textContent = isMyTurn ? "Your Turn" : turnTaker?.name || "Waiting...";
    }
    
    // --- Render Class Name & Player Stats ---
    if (myPlayerInfo.class && isExplorer) {
        const className = myPlayerInfo.class;
        playerClassName.textContent = `The ${className}`;
        mobilePlayerClassName.textContent = `The ${className}`;
        playerClassName.classList.remove('hidden');
        mobilePlayerClassName.classList.remove('hidden');
    } else {
        playerClassName.classList.add('hidden');
        mobilePlayerClassName.classList.add('hidden');
    }

    let statsHTML = '';
    if (myPlayerInfo.stats && myPlayerInfo.class) {
        const classDataClient = classData[myPlayerInfo.class];
        if (classDataClient) {
            // Calculate bonuses from equipment
            let equipHpBonus = 0, equipDmgBonus = 0, equipShieldBonus = 0, equipApBonus = 0;
            Object.values(myPlayerInfo.equipment).forEach(item => {
                if (item && item.effect && item.effect.bonuses) {
                    equipHpBonus += item.effect.bonuses.hp || 0;
                    equipDmgBonus += item.effect.bonuses.damageBonus || 0;
                    equipShieldBonus += item.effect.bonuses.shieldBonus || 0;
                    equipApBonus += item.effect.bonuses.ap || 0;
                }
            });

            // Calculate bonuses from status effects
            let eventHpBonus = 0, eventDmgBonus = 0, eventShieldBonus = 0, eventApBonus = 0;
            (myPlayerInfo.statusEffects || []).forEach(effect => {
                if (effect.type === 'stat_modifier' && effect.bonuses) {
                    eventHpBonus += effect.bonuses.hp || 0;
                    eventDmgBonus += effect.bonuses.damageBonus || 0;
                    eventShieldBonus += effect.bonuses.shieldBonus || 0;
                    eventApBonus += effect.bonuses.ap || 0;
                }
            });

            const formatBonus = (bonus, label = '') => {
                if (bonus > 0) return `<span class="stat-bonus">+${bonus} ${label}</span>`.trim();
                if (bonus < 0) return `<span class="stat-bonus" style="color: var(--color-danger);">${bonus} ${label}</span>`.trim();
                return '';
            };

            statsHTML = `
                <span>HP:</span><span class="stat-value">${myPlayerInfo.stats.currentHp} / ${classDataClient.baseHp}${formatBonus(equipHpBonus)}${formatBonus(eventHpBonus, '(Event)')}</span>
                ${myPlayerInfo.stats.shieldHp > 0 ? `<span>Shield HP:</span><span class="stat-value shield-hp-value">${myPlayerInfo.stats.shieldHp}</span>` : ''}
                <span>AP:</span><span class="stat-value">${myPlayerInfo.currentAp} / ${classDataClient.baseAp}${formatBonus(equipApBonus)}${formatBonus(eventApBonus, '(Event)')}</span>
                <span>DMG Bonus:</span><span class="stat-value">${classDataClient.baseDamageBonus}${formatBonus(equipDmgBonus)}${formatBonus(eventDmgBonus, '(Event)')}</span>
                <span>SHIELD Bonus:</span><span class="stat-value">${classDataClient.baseShieldBonus}${formatBonus(equipShieldBonus)}${formatBonus(eventDmgBonus, '(Event)')}</span>
                <span>Health Dice:</span><span class="stat-value">${myPlayerInfo.healthDice.current}d / ${myPlayerInfo.healthDice.max}</span>
                <span>Lives:</span><span class="stat-value">${myPlayerInfo.lifeCount}</span>
            `;
        } else {
            statsHTML = `<span>Stats loading...</span>`;
        }
        playerStatsDiv.innerHTML = statsHTML;
        mobileStatsDisplay.innerHTML = statsHTML;
    }


    // --- Render Hand & Equipment ---
    [equippedItemsDiv, mobileEquippedItems].forEach(container => {
        container.innerHTML = '';
        ['weapon', 'armor'].forEach(type => {
            const item = myPlayerInfo.equipment[type];
            if (item) {
                const cardEl = createCardElement(item, {});
                if (type === 'weapon' && isMyTurn) {
                    cardEl.classList.add('attackable-weapon');
                    if (item.id === selectedWeaponId) cardEl.classList.add('selected-weapon');
                    cardEl.onclick = () => {
                        selectedWeaponId = (selectedWeaponId === item.id) ? null : item.id;
                        selectedTargetId = null; // Also reset target when changing weapon selection
                        renderGameState(currentRoomState);
                    };
                }
                container.appendChild(cardEl);
            }
        });
    });

    [playerHandDiv, mobilePlayerHand].forEach(container => {
        container.innerHTML = '';
        myPlayerInfo.hand.forEach(card => {
            const isEquippable = card.type === 'Weapon' || card.type === 'Armor';
            const isPlayable = isMyTurn && !isEquippable;
            const cardEl = createCardElement(card, { isPlayable, isEquippable });
            container.appendChild(cardEl);
        });
    });

    // --- Render Board, Loot & World Event ---
    [worldEventsContainer, mobileWorldEventsContainer, partyLootContainer, mobilePartyLootContainer, gameBoardDiv, mobileBoardCards].forEach(c => c.innerHTML = '');

    if (gameState.worldEvents.currentEvent) {
        [worldEventsContainer, mobileWorldEventsContainer].forEach(c => c.appendChild(createCardElement(gameState.worldEvents.currentEvent)));
    }
    if (gameState.lootPool && gameState.lootPool.length > 0) {
        gameState.lootPool.forEach(card => {
            [partyLootContainer, mobilePartyLootContainer].forEach(c => c.appendChild(createCardElement(card, {})));
        });
    } else {
        [partyLootContainer, mobilePartyLootContainer].forEach(c => c.innerHTML = '<p class="empty-pool-text">No discoveries yet...</p>');
    }
    
    gameState.board.monsters.forEach(monster => {
        const clickHandler = () => {
            if (!isMyTurn) return;

            if (!selectedWeaponId) {
                logMessage("Select your equipped weapon before choosing a target.", { channel: 'game' });
                const equippedContainer = get('equipped-items-container');
                equippedContainer.classList.add('pulse-highlight');
                setTimeout(() => equippedContainer.classList.remove('pulse-highlight'), 1500);
                return;
            }
            
            // Just set the target ID and re-render
            selectedTargetId = (selectedTargetId === monster.id) ? null : monster.id;
            renderGameState(currentRoomState);
        };

        const desktopCardEl = createCardElement({ ...monster }, { isTargetable: isMyTurn });
        if (monster.id === selectedTargetId) desktopCardEl.classList.add('selected-target');
        desktopCardEl.addEventListener('click', clickHandler);
        gameBoardDiv.appendChild(desktopCardEl);
        
        const mobileCardEl = createCardElement({ ...monster }, { isTargetable: isMyTurn });
        if (monster.id === selectedTargetId) mobileCardEl.classList.add('selected-target');
        mobileCardEl.addEventListener('click', clickHandler);
        mobileBoardCards.appendChild(mobileCardEl);
    });
    
    if (isMyTurn && myPlayerInfo.currentAp === 0 && !apModalShownThisTurn) {
        addToModalQueue(() => {
            apModal.classList.remove('hidden');
        }, 'ap-modal');
        apModalShownThisTurn = true;
    }
}

// --- UI EVENT LISTENERS ---

// Lobby
createRoomBtn.addEventListener('click', () => {
    const playerName = playerNameInput.value.trim();
    if (playerName) {
        socket.emit('createRoom', playerName);
    } else {
        alert('Please enter a player name.');
    }
});
joinRoomBtn.addEventListener('click', () => {
    const playerName = playerNameInput.value.trim();
    const roomId = roomIdInput.value.trim().toUpperCase();
    if (playerName && roomId) {
        socket.emit('joinRoom', { roomId, playerName });
    } else {
        alert('Please enter a player name and a room code.');
    }
});

// Game Setup
[startGameBtn, mobileStartGameBtn].forEach(btn => btn.addEventListener('click', () => {
    const selectedMode = document.querySelector('input[name="gameMode"]:checked').value;
    socket.emit('startGame', { gameMode: selectedMode });
}));
[confirmClassBtn, mobileConfirmClassBtn].forEach(btn => btn.addEventListener('click', () => {
     if (tempSelectedClassId) {
        socket.emit('chooseClass', { classId: tempSelectedClassId });
        btn.disabled = true;
        btn.textContent = 'Confirmed!';
    }
}));

// Turn Controls
[actionEndTurnBtn, mobileActionEndTurnBtn].forEach(btn => btn.addEventListener('click', () => {
    socket.emit('endTurn');
}));

[actionAttackBtn, mobileActionAttackBtn].forEach(btn => btn.addEventListener('click', () => {
    if (!selectedWeaponId || !selectedTargetId) return;

    const weapon = myPlayerInfo.equipment.weapon;
    if (weapon && weapon.id === selectedWeaponId) {
        const apCost = weapon.apCost || 1;
        if (myPlayerInfo.currentAp < apCost) {
            logMessage('Not enough Action Points to attack.', { channel: 'game' });
            return;
        }
        openNarrativeModal({ action: 'attack', cardId: selectedWeaponId, targetId: selectedTargetId }, weapon.name);
    }
}));
[actionGuardBtn, mobileActionGuardBtn].forEach(btn => btn.addEventListener('click', () => socket.emit('playerAction', { action: 'guard' })));
actionBriefRespiteBtn.addEventListener('click', () => socket.emit('playerAction', { action: 'briefRespite' }));
actionFullRestBtn.addEventListener('click', () => socket.emit('playerAction', { action: 'fullRest' }));
mobileActionBriefRespiteBtn.addEventListener('click', () => socket.emit('playerAction', { action: 'briefRespite' }));
mobileActionFullRestBtn.addEventListener('click', () => socket.emit('playerAction', { action: 'fullRest' }));


dmPlayMonsterBtn.addEventListener('click', () => socket.emit('dmAction', { action: 'playMonster' }));

// Navigation (Mobile & Desktop)
mobileBottomNav.addEventListener('click', (e) => {
    const navBtn = e.target.closest('.nav-btn');
    if (!navBtn || !navBtn.dataset.screen) return;

    mobileBottomNav.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
    navBtn.classList.add('active');
    navBtn.classList.remove('highlight');

    const screenId = `mobile-screen-${navBtn.dataset.screen}`;
    document.querySelectorAll('.mobile-screen').forEach(screen => screen.classList.remove('active'));
    get(screenId).classList.add('active');
});

desktopTabButtons.forEach(button => {
    button.addEventListener('click', () => {
        desktopTabButtons.forEach(btn => btn.classList.remove('active'));
        button.classList.add('active');
        button.classList.remove('highlight');

        document.querySelectorAll('.game-area-desktop .tab-content').forEach(content => {
            content.classList.remove('active');
        });
        get(button.dataset.tab).classList.add('active');
    });
});


// Chat, Modals, etc.
chatToggleBtn.addEventListener('click', () => chatOverlay.classList.toggle('hidden'));
chatCloseBtn.addEventListener('click', () => chatOverlay.classList.add('hidden'));
chatForm.addEventListener('submit', (e) => { 
    e.preventDefault();
    const message = chatInput.value.trim();
    const channel = chatChannel.value;
    if (message) {
        socket.emit('sendMessage', { channel, message });
        chatInput.value = '';
    }
});
mobileChatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const message = mobileChatInput.value.trim();
    const channel = mobileChatChannel.value;
    if (message) {
        socket.emit('sendMessage', { channel, message });
        mobileChatInput.value = '';
    }
});
[leaveGameBtn, mobileLeaveGameBtn].forEach(btn => btn.addEventListener('click', () => {
     if (confirm("Are you sure you want to leave? Your character will be controlled by an NPC.")) {
        window.location.reload();
    }
}));
endTurnConfirmBtn.addEventListener('click', () => {
    socket.emit('endTurn');
    endTurnConfirmModal.classList.add('hidden');
    finishModal();
});
endTurnCancelBtn.addEventListener('click', () => {
    endTurnConfirmModal.classList.add('hidden');
    finishModal();
});

narrativeConfirmBtn.addEventListener('click', () => {
    let narrativeText = narrativeInput.value.trim();
    
    // If the input is empty, generate a random description.
    if (narrativeText === "") {
        narrativeText = generate_random_attack_description();
    }

    if (pendingActionData) {
        socket.emit('playerAction', { ...pendingActionData, narrative: narrativeText });
        closeNarrativeModal();
    }
});

narrativeCancelBtn.addEventListener('click', closeNarrativeModal);

rollDiceBtn.onclick = () => {
    socket.emit('rollForEvent');
    eventRollContainer.classList.add('hidden');
    eventDiceAnimationContainer.classList.remove('hidden');
    dice.className = 'dice is-rolling';
};
apModalConfirmBtn.addEventListener('click', () => {
    socket.emit('endTurn');
    apModal.classList.add('hidden');
    finishModal();
});
apModalCancelBtn.addEventListener('click', () => {
    apModal.classList.add('hidden');
    finishModal();
});
worldEventSaveRollBtn.addEventListener('click', () => {
    isResolvingWorldEvent = true;
    socket.emit('rollForWorldEventSave');
    worldEventSaveRollBtn.disabled = true;
    worldEventDice.className = 'dice is-rolling';
});
// Skip functionality
document.body.addEventListener('click', (e) => {
    if (currentSkipHandler && !e.target.closest('#skip-popup-btn')) {
        skipPopupBtn.classList.remove('hidden');
    }
});
skipPopupBtn.addEventListener('click', () => {
    if (currentSkipHandler) {
        currentSkipHandler();
    }
});

// --- SKILL CHALLENGE LISTENERS ---
skillChallengeCloseBtn.addEventListener('click', () => {
    skillChallengeOverlay.classList.add('hidden');
});

function openItemSelectModal() {
    selectedItemIdForChallenge = null;
    itemSelectContainer.innerHTML = '';
    const allItems = [...myPlayerInfo.hand, ...Object.values(myPlayerInfo.equipment).filter(i => i)];
    if (allItems.length === 0) {
        itemSelectContainer.innerHTML = `<p class="empty-pool-text">You have no items to use.</p>`;
    } else {
        allItems.forEach(item => {
            const cardEl = createCardElement(item);
            cardEl.onclick = () => {
                selectedItemIdForChallenge = (selectedItemIdForChallenge === item.id) ? null : item.id;
                // Visually update selection
                itemSelectContainer.querySelectorAll('.card').forEach(c => c.classList.remove('selected-item'));
                if (selectedItemIdForChallenge === item.id) {
                    cardEl.classList.add('selected-item');
                }
            };
            itemSelectContainer.appendChild(cardEl);
        });
    }
    itemSelectModal.classList.remove('hidden');
}

[actionSkillChallengeBtn, mobileActionSkillChallengeBtn].forEach(btn => {
    btn.addEventListener('click', openItemSelectModal);
});

itemSelectCancelBtn.addEventListener('click', () => {
    itemSelectModal.classList.add('hidden');
    selectedItemIdForChallenge = null;
});

itemSelectConfirmBtn.addEventListener('click', () => {
    socket.emit('playerAction', {
        action: 'contributeToSkillChallenge',
        itemId: selectedItemIdForChallenge
    });
    itemSelectModal.classList.add('hidden');
    selectedItemIdForChallenge = null;
});



// --- SOCKET.IO EVENT HANDLERS ---
socket.on('connect', () => { myId = socket.id; });
socket.on('roomCreated', (room) => {
    lobbyScreen.classList.add('hidden');
    gameArea.classList.remove('hidden');
    roomCodeDisplay.textContent = room.id;
    [startGameBtn, mobileStartGameBtn].forEach(btn => btn.classList.remove('hidden'));
    gameModeSelector.classList.remove('hidden');
    renderGameState(room);
});
socket.on('joinSuccess', (room) => {
    lobbyScreen.classList.add('hidden');
    gameArea.classList.remove('hidden');
    roomCodeDisplay.textContent = room.id;
    gameModeSelector.classList.add('hidden');
    renderGameState(room);
});
socket.on('playerListUpdate', (room) => renderGameState(room));
socket.on('gameStarted', (room) => {
    [startGameBtn, mobileStartGameBtn].forEach(btn => btn.classList.add('hidden'));
    gameModeSelector.classList.add('hidden');
    logMessage('The game has begun!', { type: 'system' });
    renderGameState(room);
});
socket.on('gameStateUpdate', (room) => renderGameState(room));
socket.on('chatMessage', (data) => logMessage(data.message, { type: 'chat', ...data }));
socket.on('playerLeft', ({ playerName }) => logMessage(`${playerName} has left the game.`, { type: 'system' }));
socket.on('actionError', (errorMessage) => alert(errorMessage));

socket.on('attackAnimation', (data) => {
    addToModalQueue(() => {
        let fastForwarded = false;
        let timeouts = [];

        const renderResult = () => {
            attackDice.classList.remove('is-rolling');
            let resultHTML = data.hit ? `<p class="result-line hit">HIT!</p>` : `<p class="result-line miss">MISS!</p>`;
            resultHTML += `<p>Rolled ${data.totalRollToHit} vs DC ${data.requiredRoll}</p>`;
            if (data.hit) {
                resultHTML += `<p class="damage-breakdown">Damage: ${data.rawDamageRoll}(d) + ${data.damageBonus}(b) = ${data.totalDamage}</p>`;
            }
            diceRollResult.innerHTML = resultHTML;
            diceRollResult.classList.remove('hidden');
        };

        const close = () => {
            diceRollOverlay.classList.add('hidden');
            finishModal();
        };

        currentSkipHandler = () => {
            timeouts.forEach(clearTimeout);
            if (!fastForwarded) {
                renderResult();
                fastForwarded = true;
                const closeTimeout = setTimeout(close, 3000);
                timeouts = [closeTimeout];
                // Update handler for the second skip
                currentSkipHandler = () => {
                    clearTimeout(closeTimeout);
                    close();
                };
            } else {
                close();
            }
        };

        showRollResult(data.d20Roll, 'd20');
        diceRollTitle.textContent = `${data.attackerName} attacks!`;
        diceRollResult.innerHTML = '';
        diceRollResult.classList.add('hidden');
        diceRollOverlay.classList.remove('hidden');

        attackDice.classList.remove('is-rolling');
        void attackDice.offsetWidth; 
        attackDice.classList.add('is-rolling');

        const timeout1 = setTimeout(() => {
            renderResult();
            fastForwarded = true;
            const timeout2 = setTimeout(close, 3000);
            timeouts = [timeout2];
        }, 1500);
        timeouts.push(timeout1);

    }, 'attack-animation');
});

socket.on('monsterAttackAnimation', (data) => {
    addToModalQueue(() => {
        let fastForwarded = false;
        let timeouts = [];

        const renderResult = () => {
            attackDice.classList.remove('is-rolling');
            let resultHTML = data.hit ? `<p class="result-line hit">HIT!</p>` : `<p class="result-line miss">MISS!</p>`;
            resultHTML += `<p>Rolled ${data.totalRollToHit} vs DC ${data.requiredRoll}</p>`;
            if (data.hit) {
                resultHTML += `<p class="damage-breakdown">Damage: ${data.rawDamageRoll}(d) = ${data.totalDamage}</p>`;
            }
            diceRollResult.innerHTML = resultHTML;
            diceRollResult.classList.remove('hidden');
        };

        const close = () => {
            diceRollOverlay.classList.add('hidden');
            finishModal();
        };

        currentSkipHandler = () => {
            timeouts.forEach(clearTimeout);
            if (!fastForwarded) {
                renderResult();
                fastForwarded = true;
                const closeTimeout = setTimeout(close, 3000);
                timeouts = [closeTimeout];
                currentSkipHandler = () => {
                    clearTimeout(closeTimeout);
                    close();
                };
            } else {
                close();
            }
        };

        showRollResult(data.d20Roll, 'd20');
        diceRollTitle.textContent = `${data.attackerName} attacks ${data.targetName}!`;
        diceRollResult.innerHTML = '';
        diceRollResult.classList.add('hidden');
        diceRollOverlay.classList.remove('hidden');

        attackDice.classList.remove('is-rolling');
        void attackDice.offsetWidth; 
        attackDice.classList.add('is-rolling');

        const timeout1 = setTimeout(() => {
            renderResult();
            fastForwarded = true;
            const timeout2 = setTimeout(close, 3000);
            timeouts = [timeout2];
        }, 1500);
        timeouts.push(timeout1);

    }, 'monster-attack-animation');
});

socket.on('eventRollResult', ({ roll, outcome, cardOptions }) => {
    // This is part of an active modal, so we don't queue it.
    let timeoutId;

    const renderResult = () => {
        currentSkipHandler = null; // Result view is interactive, not skippable
        skipPopupBtn.classList.add('hidden');
        dice.classList.remove('is-rolling');
        eventDiceAnimationContainer.classList.add('hidden');
        eventResultContainer.classList.remove('hidden');
        
        eventResultTitle.textContent = `You rolled a ${roll}!`;
        if(outcome === 'none') {
            eventResultSubtitle.textContent = 'Nothing happens this time.';
            eventCardSelection.classList.add('hidden');
            eventResultOkayBtn.classList.remove('hidden');
            eventResultOkayBtn.onclick = () => {
                eventOverlay.classList.add('hidden');
                finishModal();
            };
        } else {
            eventResultSubtitle.textContent = outcome === 'discovery' ? 'You made a discovery! Choose one:' : 'A player event occurs! Choose one:';
            eventCardSelection.classList.remove('hidden');
            eventResultOkayBtn.classList.add('hidden');
            eventCardSelection.innerHTML = '';
            cardOptions.forEach(card => {
                const cardEl = createCardElement(card);
                cardEl.onclick = () => {
                    socket.emit('selectEventCard', { cardId: card.id });
                    eventOverlay.classList.add('hidden');
                    finishModal();
                };
                eventCardSelection.appendChild(cardEl);
            });
        }
    };

    currentSkipHandler = () => {
        clearTimeout(timeoutId);
        renderResult();
    };

    showRollResult(roll, 'd20');
    // The roll button click already started the dice animation
    timeoutId = setTimeout(renderResult, 1500);
});

socket.on('eventCardReveal', ({ chosenCard }) => {
    eventCardSelection.innerHTML = '';
    eventCardSelection.appendChild(createCardElement(chosenCard));
});

socket.on('worldEventSaveResult', ({ d20Roll, bonus, totalRoll, dc, success }) => {
    // This is part of an active modal.
    setTimeout(() => {
        // Stop the dice animation
        worldEventDice.classList.remove('is-rolling');
        
        // Hide the roll button, show the result.
        worldEventSaveRollBtn.classList.add('hidden');
        worldEventRollResult.textContent = `You rolled ${d20Roll} + ${bonus} = ${totalRoll} vs DC ${dc}. ${success ? 'Success!' : 'Failure!'}`;
        worldEventRollResult.classList.remove('hidden');
        
        // Show the continue button to allow faster closing, but also set a timeout as a failsafe.
        worldEventSaveContinueBtn.classList.remove('hidden');
        
        const closeTimeout = setTimeout(() => {
            if (!worldEventSaveModal.classList.contains('hidden')) {
                 isResolvingWorldEvent = false;
                 worldEventSaveModal.classList.add('hidden');
                 finishModal();
            }
        }, 3500);

        // Overwrite onclick to ensure we have a clean handler that also manages the timeout
        worldEventSaveContinueBtn.onclick = () => {
            clearTimeout(closeTimeout);
            isResolvingWorldEvent = false;
            worldEventSaveModal.classList.add('hidden');
            finishModal();
        };

        // Show the small popup at the top
        showRollResult(d20Roll, 'd20');

        // Clear any skip handlers, this modal is now interactive and not on a timer
        currentSkipHandler = null;
        skipPopupBtn.classList.add('hidden');
    }, 1500); // Wait for dice animation to roughly finish
});


// --- VOICE CHAT ---
joinVoiceBtn.addEventListener('click', async () => {
    try {
        if (!localStream) {
            localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        }
        const audio = document.createElement('audio');
        audio.srcObject = localStream;
        audio.muted = true;
        audio.play();
        voiceChatContainer.appendChild(audio);
        joinVoiceBtn.disabled = true;
        joinVoiceBtn.textContent = 'Voice Active';
        socket.emit('join-voice');
    } catch (err) {
        console.error("Error accessing microphone:", err);
        alert("Could not access microphone. Please check permissions.");
    }
});
const createPeerConnection = (peerId) => {
    const pc = new RTCPeerConnection(iceServers);
    peerConnections[peerId] = pc;

    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

    pc.ontrack = event => {
        const existingAudio = document.getElementById(`audio-${peerId}`);
        if (existingAudio) {
            existingAudio.srcObject = event.streams[0];
        } else {
            const audio = document.createElement('audio');
            audio.id = `audio-${peerId}`;
            audio.srcObject = event.streams[0];
            audio.play();
            voiceChatContainer.appendChild(audio);
        }
    };

    pc.onicecandidate = event => {
        if (event.candidate) {
            socket.emit('voice-ice-candidate', { candidate: event.candidate, toId: peerId });
        }
    };
    return pc;
};
socket.on('voice-peers', (peers) => {
    peers.forEach(async peerId => {
        const pc = createPeerConnection(peerId);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('voice-offer', { offer, toId: peerId });
    });
});
socket.on('voice-peer-join', async ({ peerId }) => {
    const pc = createPeerConnection(peerId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('voice-offer', { offer, toId: peerId });
});
socket.on('voice-offer', async ({ offer, fromId }) => {
    const pc = createPeerConnection(fromId);
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('voice-answer', { answer, toId: fromId });
});
socket.on('voice-answer', async ({ answer, fromId }) => {
    const pc = peerConnections[fromId];
    if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
    }
});
socket.on('voice-ice-candidate', async ({ candidate, fromId }) => {
    const pc = peerConnections[fromId];
    if (pc) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
    }
});
socket.on('voice-peer-disconnect', ({ peerId }) => {
    if (peerConnections[peerId]) {
        peerConnections[peerId].close();
        delete peerConnections[peerId];
    }
    const audio = document.getElementById(`audio-${peerId}`);
    if (audio) {
        audio.remove();
    }
});

// --- Initial UI Setup ---
document.querySelector('.radio-label').classList.add('active');
document.querySelector('.radio-group').addEventListener('change', (e) => {
    if (e.target.name === 'gameMode') {
        document.querySelectorAll('.radio-label').forEach(label => label.classList.remove('active'));
        e.target.closest('.radio-label').classList.add('active');
    }
});

// PWA Service Worker Registration
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').then(registration => {
            console.log('SW registered: ', registration);
        }).catch(registrationError => {
            console.log('SW registration failed: ', registrationError);
        });
    });
}