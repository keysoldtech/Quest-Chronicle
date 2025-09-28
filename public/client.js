// This file contains all client-side JavaScript logic for the Quest & Chronicle game.
// It establishes the Socket.IO connection to the server, manages local game state,
// handles all user interactions (button clicks, form submissions), and dynamically renders
// the game state received from the server into the HTML DOM. It also contains WebRTC logic for voice chat
// and the WebGL (Three.js) logic for the 3D dice roll animations.

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
let selectedItemIdForChallenge = null;
let isPerformingAction = false; // To prevent modals during an action sequence
let isVoiceConnected = false;
const iceServers = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

// --- 3D Dice Globals ---
let diceRenderer, diceScene, diceCamera, diceMesh;
let diceAnimationId;

// Static data for rendering class cards without needing a server round-trip
const classData = {
    Barbarian: { baseHp: 24, baseDamageBonus: 4, baseShieldBonus: 0, baseAp: 3, healthDice: 4, stats: { str: 4, dex: 1, con: 3, int: 0, wis: 0, cha: 1 }, ability: { name: 'Unchecked Assault', apCost: 1, description: 'Discard a Spell to add +6 damage to your next successful weapon attack this turn.' } },
    Cleric:    { baseHp: 20, baseDamageBonus: 1, baseShieldBonus: 3, baseAp: 2, healthDice: 3, stats: { str: 1, dex: 0, con: 2, int: 1, wis: 4, cha: 2 }, ability: { name: 'Divine Aid', apCost: 1, description: 'Gain a +1d4 bonus to your next d20 roll (attack or challenge) this turn.' } },
    Mage:      { baseHp: 18, baseDamageBonus: 1, baseShieldBonus: 2, baseAp: 2, healthDice: 2, stats: { str: 0, dex: 1, con: 1, int: 4, wis: 2, cha: 1 }, ability: { name: 'Mystic Recall', apCost: 1, description: 'Draw one card from the Spell deck.' } },
    Ranger:    { baseHp: 20, baseDamageBonus: 2, baseShieldBonus: 2, baseAp: 2, healthDice: 3, stats: { str: 1, dex: 4, con: 2, int: 1, wis: 3, cha: 0 }, ability: { name: 'Hunters Mark', apCost: 1, description: 'Mark a monster. All attacks against it deal +2 damage for one round.' } },
    Rogue:     { baseHp: 18, baseDamageBonus: 3, baseShieldBonus: 1, baseAp: 3, healthDice: 2, stats: { str: 1, dex: 4, con: 1, int: 2, wis: 0, cha: 3 }, ability: { name: 'Evasion', apCost: 2, description: 'For one round, all attacks against you have disadvantage (DM rerolls hits).' } },
    Warrior:   { baseHp: 22, baseDamageBonus: 2, baseShieldBonus: 4, baseAp: 3, healthDice: 4, stats: { str: 3, dex: 2, con: 4, int: 0, wis: 1, cha: 1 }, ability: { name: 'Weapon Surge', apCost: 1, description: 'Discard a Spell to add +4 damage to your next successful weapon attack this turn.' } },
};

const statVisuals = {
    hp:          { icon: 'favorite', color: 'var(--stat-color-hp)' },
    ap:          { icon: 'bolt', color: 'var(--stat-color-ap)' },
    damageBonus: { icon: 'swords', color: 'var(--stat-color-damage)' },
    shieldBonus: { icon: 'shield', color: 'var(--stat-color-shield)' },
    str:         { icon: 'fitness_center', color: 'var(--stat-color-str)' },
    dex:         { icon: 'sprint', color: 'var(--stat-color-dex)' },
    con:         { icon: 'health_and_safety', color: 'var(--stat-color-con)' },
    int:         { icon: 'school', color: 'var(--stat-color-int)' },
    wis:         { icon: 'psychology', color: 'var(--stat-color-wis)' },
    cha:         { icon: 'groups', color: 'var(--stat-color-cha)' },
    attackBonus: { icon: 'colorize', color: 'var(--stat-color-damage)' },
    requiredRollToHit: { icon: 'security', color: 'var(--stat-color-shield)' },
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
const customSettingsPanel = get('custom-settings-panel');

// Main Game Area
const gameArea = get('game-area');

// Desktop Header Menu
const menuToggleBtn = get('menu-toggle-btn');
const menuDropdown = get('menu-dropdown');
const chatToggleBtn = get('chat-toggle-btn');
const joinVoiceBtn = get('join-voice-btn');
const muteVoiceBtn = get('mute-voice-btn');
const disconnectVoiceBtn = get('disconnect-voice-btn');
const leaveGameBtn = get('leave-game-btn');
const helpBtn = get('help-btn');
const mobileHelpBtn = get('mobile-help-btn');

// Desktop
const turnIndicator = get('turn-indicator');
const turnCounter = get('turn-counter');
const startGameBtn = get('startGameBtn');
const dmControls = get('dm-controls');
const dmPlayMonsterBtn = get('dm-play-monster-btn');
const playerList = get('player-list');
const lobbySettingsDisplay = get('lobby-settings-display');
const roomCodeDisplay = get('room-code');
const classSelectionDiv = get('class-selection');
const classCardsContainer = get('class-cards-container');
const confirmClassBtn = get('confirm-class-btn');
const playerStatsContainer = get('player-stats-container');
const playerClassName = get('player-class-name');
const playerStatsDiv = get('player-stats');
const classAbilityCard = get('class-ability-card');
const equippedItemsDiv = get('equipped-items');
const advancedCardChoiceDiv = get('advanced-card-choice');
const advancedChoiceButtonsDiv = get('advanced-choice-buttons');
const playerHandDiv = get('player-hand');
const gameBoardDiv = get('board-cards');
const worldEventsContainer = get('world-events-container');
const partyLootContainer = get('party-loot-container');
const gameLogContent = get('game-log-content');
const desktopTabButtons = document.querySelectorAll('.game-area-desktop .tab-btn');

// Desktop Action Bar
const fixedActionBar = get('fixed-action-bar');
const actionSkillChallengeBtn = get('action-skill-challenge-btn');
const actionGuardBtn = get('action-guard-btn');
const actionBriefRespiteBtn = get('action-brief-respite-btn');
const actionFullRestBtn = get('action-full-rest-btn');
const actionEndTurnBtn = get('action-end-turn-btn');

// Mobile
const mobileTurnIndicator = get('mobile-turn-indicator');
const mobileTurnCounter = get('mobile-turn-counter');
const mobileRoomCode = get('mobile-room-code');
const mobileStartGameBtn = get('mobile-startGameBtn');
const mobileBoardCards = get('mobile-board-cards');
const mobilePlayerHand = get('mobile-player-hand');
const mobileClassSelection = get('mobile-class-selection');
const mobileClassCardsContainer = get('mobile-class-cards-container');
const mobileConfirmClassBtn = get('mobile-confirm-class-btn');
const mobilePlayerStats = get('mobile-player-stats');
const mobilePlayerClassName = get('mobile-player-class-name');
const mobileStatsDisplay = get('mobile-stats-display');
const mobileClassAbilityCard = get('mobile-class-ability-card');
const mobilePlayerEquipment = get('mobile-player-equipment');
const mobileEquippedItems = get('mobile-equipped-items');
const mobilePlayerList = get('mobile-player-list');
const mobileLobbySettingsDisplay = get('mobile-lobby-settings-display');
const mobileWorldEventsContainer = get('mobile-world-events-container');
const mobilePartyLootContainer = get('mobile-party-loot-container');
const mobileBottomNav = document.querySelector('.mobile-bottom-nav');
const mobileChatLog = get('mobile-chat-log');
const mobileChatForm = get('mobile-chat-form');
const mobileChatChannel = get('mobile-chat-channel');
const mobileChatInput = get('mobile-chat-input');
const mobileActionBar = get('mobile-action-bar');
const mobileActionSkillChallengeBtn = get('mobile-action-skill-challenge-btn');
const mobileActionGuardBtn = get('mobile-action-guard-btn');
const mobileActionBriefRespiteBtn = get('mobile-action-brief-respite-btn');
const mobileActionFullRestBtn = get('mobile-action-full-rest-btn');
const mobileActionEndTurnBtn = get('mobile-action-end-turn-btn');

// Mobile Header Menu
const mobileMenuToggleBtn = get('mobile-menu-toggle-btn');
const mobileMenuDropdown = get('mobile-menu-dropdown');
const mobileJoinVoiceBtn = get('mobile-join-voice-btn');
const mobileMuteVoiceBtn = get('mobile-mute-voice-btn');
const mobileDisconnectVoiceBtn = get('mobile-disconnect-voice-btn');
const mobileLeaveGameBtn = get('mobile-leave-game-btn');


// Shared Overlays & Modals
const chatOverlay = get('chat-overlay');
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
const apModal = get('ap-modal');
const apModalCancelBtn = get('ap-modal-cancel-btn');
const apModalConfirmBtn = get('ap-modal-confirm-btn');
const endTurnConfirmModal = get('end-turn-confirm-modal');
const endTurnCancelBtn = get('end-turn-cancel-btn');
const endTurnConfirmBtn = get('end-turn-confirm-btn');
const diceRollOverlay = get('dice-roll-overlay');
const diceRollTitle = get('dice-roll-title');
const diceSceneContainer = get('dice-scene-container');
const diceRollActionBtn = get('dice-roll-action-btn');
const diceRollResult = get('dice-roll-result');
const diceRollContinueBtn = get('dice-roll-continue-btn');
const eventOverlay = get('event-overlay');
const eventTitle = get('event-title');
const eventPrompt = get('event-prompt');
const eventRollBtn = get('event-roll-btn');
const eventCardSelection = get('event-card-selection');
const worldEventSaveModal = get('world-event-save-modal');
const worldEventSaveTitle = get('world-event-save-title');
const worldEventSavePrompt = get('world-event-save-prompt');
const worldEventSaveRollBtn = get('world-event-save-roll-btn');
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
const equipmentChoiceModal = get('equipment-choice-modal');
const equippedItemDisplay = get('equipped-item-display');
const newItemDisplay = get('new-item-display');
const keepCurrentBtn = get('keep-current-btn');
const equipNewBtn = get('equip-new-btn');
const toastNotification = get('toast-notification');
const toastMessage = get('toast-message');
const toastCloseBtn = get('toast-close-btn');
const animationOverlay = get('animation-overlay');
const itemSwapModal = get('item-swap-modal');
const itemSwapPrompt = get('item-swap-prompt');
const swapNewItemDisplay = get('swap-new-item-display');
const swapHandDisplay = get('swap-hand-display');
const discardNewItemBtn = get('discard-new-item-btn');
const itemFoundModal = get('item-found-modal');
const itemFoundDisplay = get('item-found-display');
const itemFoundCloseBtn = get('item-found-close-btn');
const tutorialModal = get('tutorial-modal');
const helpModal = get('help-modal');


// --- Helper Functions ---
let toastTimeout;

function showToast(message) {
    clearTimeout(toastTimeout);
    toastMessage.textContent = message;
    toastNotification.classList.remove('hidden');
    toastTimeout = setTimeout(() => {
        toastNotification.classList.add('hidden');
    }, 4000);
}

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

function processModalQueue() {
    if (isModalActive || modalQueue.length === 0) {
        return;
    }
    isModalActive = true;
    const { showFunction } = modalQueue.shift();
    showFunction();
}

function addToModalQueue(showFunction, id) {
    if (id && modalQueue.some(item => item.id === id)) {
        return;
    }
    modalQueue.push({ showFunction, id: id || `modal-${Date.now()}` });
    processModalQueue();
}

function finishModal() {
    isModalActive = false;
    currentSkipHandler = null; 
    skipPopupBtn.classList.add('hidden');
    setTimeout(processModalQueue, 200); 
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
    
    if (type === 'system' || channel === 'game' || isNarrative) {
        if (gameLogContent) {
            gameLogContent.appendChild(p.cloneNode(true));
            gameLogContent.scrollTop = gameLogContent.scrollHeight;
        }
    }

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
        narrativePrompt.textContent = `How do you want to attack with your ${cardName}?`;
        narrativeInput.value = '';
        narrativeModal.classList.remove('hidden');
        narrativeInput.focus();
    }, 'narrative-modal');
}

function closeNarrativeModal() {
    pendingActionData = null;
    narrativeModal.classList.add('hidden');
    
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
        bonusesHTML = Object.entries(card.effect.bonuses).map(([key, value]) => {
            const visual = statVisuals[key];
            if (!visual) return '';
            const sign = value > 0 ? '+' : '';
            return `<div class="card-bonus" style="color: ${visual.color};">
                        <span class="material-symbols-outlined">${visual.icon}</span> 
                        ${key.charAt(0).toUpperCase() + key.slice(1)}: ${sign}${value}
                    </div>`;
        }).join('');
    }
    
    let monsterHologramHTML = '';
    let monsterStatsHTML = '';
    if(card.type === 'Monster') {
        // Per user request, hiding hologram and health bar as hologram isn't displaying correctly.
        monsterHologramHTML = '';
        
        monsterStatsHTML = `
            <div class="monster-stats-grid">
                <div class="card-bonus" title="Attack Bonus" style="color: ${statVisuals.attackBonus.color};"><span class="material-symbols-outlined">${statVisuals.attackBonus.icon}</span>+${card.attackBonus || 0}</div>
                <div class="card-bonus" title="Armor Class" style="color: ${statVisuals.requiredRollToHit.color};"><span class="material-symbols-outlined">${statVisuals.requiredRollToHit.icon}</span>${card.requiredRollToHit || 10}</div>
                <div class="card-bonus" title="Action Points" style="color: ${statVisuals.ap.color};"><span class="material-symbols-outlined">${statVisuals.ap.icon}</span>${card.ap || 1}</div>
            </div>
        `;
    }

    let statusEffectsHTML = '';
    if (card.statusEffects && card.statusEffects.length > 0) {
        statusEffectsHTML = `<div class="status-effects-container">` +
            card.statusEffects.map(e => `<span class="status-effect">${e.name}</span>`).join(' ') +
            `</div>`;
    }
    
    const cardTitle = card.isMagical ? `<span class="magical-item">${card.name}</span>` : card.name;

    cardDiv.innerHTML = `
        ${monsterHologramHTML}
        <div class="card-content">
            <h3 class="card-title">${cardTitle}</h3>
            <p class="card-effect">${card.effect?.description || card.description || card.outcome || ''}</p>
        </div>
        ${statusEffectsHTML}
        <div class="card-footer">
            ${monsterStatsHTML}
            <div class="card-bonuses-grid">${bonusesHTML}</div>
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
                showToast("You must select a monster to target!");
                return;
            }
            const action = card.type === 'Spell' ? 'castSpell' : 'useItem';
            openNarrativeModal({ action, cardId: card.id, targetId: selectedTargetId }, card.name);
            selectedTargetId = null; 
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

function renderPlayerList(players, gameState, listElement, settingsDisplayElement) {
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

    if (gameState.phase === 'lobby' && gameState.gameMode === 'Custom') {
        settingsDisplayElement.classList.remove('hidden');
        const s = gameState.customSettings;
        settingsDisplayElement.innerHTML = `
            <h4>Custom Game Settings</h4>
            <ul>
                <li><strong>Pressure:</strong> ${s.dungeonPressure}%</li>
                <li><strong>Loot Drop:</strong> ${s.lootDropRate}%</li>
                <li><strong>Magical Item:</strong> ${s.magicalItemChance}%</li>
                <li><strong>Hand Size:</strong> ${s.maxHandSize}</li>
                <li><strong>Enemy Scaling:</strong> ${s.enemyScaling ? `Enabled (${s.scalingRate}%)` : 'Disabled'}</li>
            </ul>
        `;
    } else {
        settingsDisplayElement.classList.add('hidden');
    }
}

function renderClassAbilityCard(player, container) {
    if (!player || !player.class) {
        container.classList.add('hidden');
        return;
    }

    const ability = classData[player.class]?.ability;
    if (!ability) {
        container.classList.add('hidden');
        return;
    }

    const canUse = player.currentAp >= ability.apCost;
    container.innerHTML = `
        <h3 class="sub-header-font">Class Ability</h3>
        <p class="ability-title">${ability.name} (-${ability.apCost} AP)</p>
        <p class="ability-desc">${ability.description}</p>
        <button id="use-ability-btn" class="btn btn-special btn-sm" ${canUse ? '' : 'disabled'}>Use Ability</button>
    `;
    container.classList.remove('hidden');

    get('use-ability-btn').onclick = () => {
        socket.emit('playerAction', { action: 'useClassAbility' });
    };
}


function renderGameState(room) {
    const oldLootCount = currentRoomState.gameState?.lootPool?.length || 0;
    currentRoomState = room;
    const { players, gameState, hostId } = room;
    myPlayerInfo = players[myId];
    if (!myPlayerInfo) return;
    const newLootCount = gameState.lootPool?.length || 0;

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


    renderPlayerList(players, gameState, playerList, lobbySettingsDisplay);
    renderPlayerList(players, gameState, mobilePlayerList, mobileLobbySettingsDisplay);
    
    const isHost = myId === hostId;
    const isDM = myPlayerInfo.role === 'DM';
    const isExplorer = myPlayerInfo.role === 'Explorer';
    const hasConfirmedClass = !!myPlayerInfo.class;
    const currentTurnTakerId = gameState.turnOrder[gameState.currentPlayerIndex];
    const isMyTurn = currentTurnTakerId === myId;
    const isStunned = myPlayerInfo.statusEffects && myPlayerInfo.statusEffects.some(e => e.type === 'stun' || e.name === 'Stunned');
    
    [startGameBtn, mobileStartGameBtn].forEach(btn => btn.classList.toggle('hidden', !isHost || gameState.phase !== 'lobby'));
    [leaveGameBtn, mobileLeaveGameBtn].forEach(btn => btn.classList.toggle('hidden', gameState.phase === 'lobby'));
    
    classSelectionDiv.classList.toggle('hidden', gameState.phase !== 'class_selection' || hasConfirmedClass || !isExplorer);
    advancedCardChoiceDiv.classList.toggle('hidden', gameState.phase !== 'advanced_setup_choice' || myPlayerInfo.madeAdvancedChoice);
    playerStatsContainer.classList.toggle('hidden', !hasConfirmedClass || !isExplorer);
    dmControls.classList.toggle('hidden', !isDM || !isMyTurn);
    gameModeSelector.classList.toggle('hidden', !isHost || gameState.phase !== 'lobby');
    customSettingsPanel.classList.toggle('hidden', !(isHost && gameState.phase === 'lobby' && document.querySelector('input[name="gameMode"]:checked').value === 'Custom'));

    const inMobileClassSelection = gameState.phase === 'class_selection' && !hasConfirmedClass && isExplorer;
    if (inMobileClassSelection) {
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

    const showActionBar = isMyTurn && isExplorer && !isStunned;
    const challenge = gameState.skillChallenge;
    fixedActionBar.classList.toggle('hidden', !showActionBar);
    mobileActionBar.classList.toggle('hidden', !showActionBar);

    if (showActionBar) {
        const canGuard = myPlayerInfo.currentAp >= 1;
        const canBriefRespite = myPlayerInfo.currentAp >= 1 && myPlayerInfo.healthDice.current > 0;
        const canFullRest = myPlayerInfo.currentAp >= 2 && myPlayerInfo.healthDice.current >= 2;
        const showChallengeButton = challenge && challenge.isActive && myPlayerInfo.currentAp >= 1;

        actionSkillChallengeBtn.classList.toggle('hidden', !showChallengeButton);
        actionGuardBtn.disabled = !canGuard;
        actionBriefRespiteBtn.disabled = !canBriefRespite;
        actionFullRestBtn.disabled = !canFullRest;

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
            }, 2500);

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
            eventTitle.textContent = "An Event is Triggered!";
            eventPrompt.textContent = "Roll the dice to see what happens.";
            eventRollBtn.classList.remove('hidden');
            eventCardSelection.classList.add('hidden');
        }, 'event-roll');
    } else if (!myPlayerInfo.pendingEventChoice) {
        eventOverlay.classList.add('hidden');
    }
    
    if (myPlayerInfo.pendingItemSwap) {
        addToModalQueue(() => {
            const { newCard } = myPlayerInfo.pendingItemSwap;
            swapNewItemDisplay.innerHTML = '';
            swapHandDisplay.innerHTML = '';
            itemSwapPrompt.textContent = `Your hand is full (${gameState.customSettings.maxHandSize} cards max). To keep the new item, you must choose one from your hand to discard.`;
            
            swapNewItemDisplay.appendChild(createCardElement(newCard));
            myPlayerInfo.hand.forEach(card => {
                const cardEl = createCardElement(card);
                cardEl.classList.add('selectable-card');
                cardEl.onclick = () => {
                    socket.emit('resolveItemSwap', { cardToDiscardId: card.id });
                    itemSwapModal.classList.add('hidden');
                    finishModal();
                };
                swapHandDisplay.appendChild(cardEl);
            });
            itemSwapModal.classList.remove('hidden');
        }, `item-swap-${myPlayerInfo.pendingItemSwap.newCard.id}`);
    } else {
        itemSwapModal.classList.add('hidden');
    }
    
    if (isMyTurn && myPlayerInfo.pendingEquipmentChoice) {
        addToModalQueue(() => {
            const { newCard, type } = myPlayerInfo.pendingEquipmentChoice;
            const currentItem = myPlayerInfo.equipment[type];
            
            equippedItemDisplay.innerHTML = '';
            newItemDisplay.innerHTML = '';
            
            if (currentItem) {
                equippedItemDisplay.appendChild(createCardElement(currentItem));
            }
            if (newCard) {
                newItemDisplay.appendChild(createCardElement(newCard));
            }
            
            equipmentChoiceModal.classList.remove('hidden');
        }, `equipment-choice-${myPlayerInfo.pendingEquipmentChoice.newCard.id}`);
    } else {
        equipmentChoiceModal.classList.add('hidden');
    }

    if (myPlayerInfo.pendingWorldEventSave) {
        addToModalQueue(() => {
            worldEventSaveModal.classList.remove('hidden');
            const { dc, save, eventName } = myPlayerInfo.pendingWorldEventSave;
            worldEventSaveTitle.textContent = eventName;
            worldEventSavePrompt.textContent = `You must make a DC ${dc} ${save} save!`;
            worldEventSaveRollBtn.classList.remove('hidden');
        }, 'world-event-save');
    } else {
        worldEventSaveModal.classList.add('hidden');
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

    if (!hasConfirmedClass && isExplorer && gameState.phase === 'class_selection') {
        [classCardsContainer, mobileClassCardsContainer].forEach(container => {
             if (container.children.length === 0) {
                for (const [classId, data] of Object.entries(classData)) {
                    const card = document.createElement('div');
                    card.className = 'class-card';
                    card.dataset.classId = classId;
                    card.innerHTML = `
                        <h3 class="class-card-title">${classId}</h3>
                        <p class="class-card-desc">${data.ability.description}</p>
                        <div class="class-card-stats">
                            <span>STR:</span><span>${data.stats.str}</span>
                            <span>DEX:</span><span>${data.stats.dex}</span>
                            <span>CON:</span><span>${data.stats.con}</span>
                            <span>INT:</span><span>${data.stats.int}</span>
                            <span>WIS:</span><span>${data.stats.wis}</span>
                            <span>CHA:</span><span>${data.stats.cha}</span>
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
    
    if (myPlayerInfo.class && isExplorer) {
        const className = myPlayerInfo.class;
        playerClassName.textContent = `The ${className}`;
        mobilePlayerClassName.textContent = `The ${className}`;
        playerClassName.classList.remove('hidden');
        mobilePlayerClassName.classList.remove('hidden');
        renderClassAbilityCard(myPlayerInfo, classAbilityCard);
        renderClassAbilityCard(myPlayerInfo, mobileClassAbilityCard);
    } else {
        playerClassName.classList.add('hidden');
        mobilePlayerClassName.classList.add('hidden');
        classAbilityCard.classList.add('hidden');
        mobileClassAbilityCard.classList.add('hidden');
    }

    let statsHTML = '';
    if (myPlayerInfo.stats && myPlayerInfo.class) {
        const pStats = myPlayerInfo.stats;
    
        statsHTML = `
            <span>HP:</span><span class="stat-value">${pStats.currentHp} / ${pStats.maxHp}</span>
            <span>AP:</span><span class="stat-value">${myPlayerInfo.currentAp} / ${pStats.ap}</span>
            <span>DMG Bonus:</span><span class="stat-value">${pStats.damageBonus}</span>
            <span>SHIELD Bonus:</span><span class="stat-value">${pStats.shieldBonus}</span>
            <span>Health Dice:</span><span class="stat-value">${myPlayerInfo.healthDice.current}d${myPlayerInfo.healthDice.max}</span>
            <span>Lives:</span><span class="stat-value">${myPlayerInfo.lifeCount}</span>
            
            <span>STR:</span><span class="stat-value">${pStats.str}</span>
            <span>DEX:</span><span class="stat-value">${pStats.dex}</span>
            <span>CON:</span><span class="stat-value">${pStats.con}</span>
            <span>INT:</span><span class="stat-value">${pStats.int}</span>
            <span>WIS:</span><span class="stat-value">${pStats.wis}</span>
            <span>CHA:</span><span class="stat-value">${pStats.cha}</span>
            ${myPlayerInfo.stats.shieldHp > 0 ? `<span>Shield HP:</span><span class="stat-value shield-hp-value">${myPlayerInfo.stats.shieldHp}</span>` : '<span class="placeholder"></span><span class="placeholder"></span>'}
        `;
        playerStatsDiv.innerHTML = statsHTML;
        mobileStatsDisplay.innerHTML = statsHTML;
    }

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
                        selectedTargetId = null; 
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
            if (!isMyTurn || isStunned) return;

            if (!selectedWeaponId) {
                showToast("Select your equipped weapon before choosing a target.");
                const equippedContainer = get('equipped-items-container');
                equippedContainer.classList.add('pulse-highlight');
                setTimeout(() => equippedContainer.classList.remove('pulse-highlight'), 1500);
                return;
            }
            
            selectedTargetId = monster.id;

            const weapon = myPlayerInfo.equipment.weapon;
            if (weapon && weapon.id === selectedWeaponId) {
                const apCost = weapon.apCost || 2;
                if (myPlayerInfo.currentAp < apCost) {
                    showToast('Not enough Action Points to attack.');
                    return;
                }
                openNarrativeModal({ action: 'attack', cardId: selectedWeaponId, targetId: selectedTargetId }, weapon.name);
            }
        };

        const desktopCardEl = createCardElement({ ...monster }, { isTargetable: isMyTurn });
        desktopCardEl.addEventListener('click', clickHandler);
        gameBoardDiv.appendChild(desktopCardEl);
        
        const mobileCardEl = createCardElement({ ...monster }, { isTargetable: isMyTurn });
        mobileCardEl.addEventListener('click', clickHandler);
        mobileBoardCards.appendChild(mobileCardEl);
    });
    
    if (isMyTurn && myPlayerInfo.currentAp === 0 && !apModalShownThisTurn && !isPerformingAction) {
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
    if (!playerName) {
        return showToast('Please enter a player name.');
    }
    
    let customSettings = {};
    const gameMode = document.querySelector('input[name="gameMode"]:checked').value;
    
    if (gameMode === 'Beginner') {
        customSettings = { dungeonPressure: 15, lootDropRate: 35, magicalItemChance: 10, maxHandSize: 5, enemyScaling: false, scalingRate: 50 };
    } else if (gameMode === 'Advanced') {
        customSettings = { dungeonPressure: 35, lootDropRate: 15, magicalItemChance: 30, maxHandSize: 5, enemyScaling: true, scalingRate: 60 };
    } else { // Custom
        customSettings = {
            dungeonPressure: parseInt(get('dungeon-pressure').value, 10),
            lootDropRate: parseInt(get('loot-drop-rate').value, 10),
            magicalItemChance: parseInt(get('magical-item-chance').value, 10),
            maxHandSize: parseInt(get('max-hand-size').value, 10),
            enemyScaling: get('enemy-scaling').checked,
            scalingRate: parseInt(get('scaling-rate').value, 10),
        };
    }

    socket.emit('createRoom', { playerName, customSettings });
});
joinRoomBtn.addEventListener('click', () => {
    const playerName = playerNameInput.value.trim();
    const roomId = roomIdInput.value.trim().toUpperCase();
    if (playerName && roomId) {
        socket.emit('joinRoom', { roomId, playerName });
    } else {
        showToast('Please enter a player name and a room code.');
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
chatToggleBtn.addEventListener('click', () => {
    chatOverlay.classList.toggle('hidden');
    menuDropdown.classList.add('hidden');
    menuToggleBtn.innerHTML = `<span class="material-symbols-outlined">menu</span>`;
});
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
    
    if (narrativeText === "") {
        narrativeText = generate_random_attack_description();
    }

    if (pendingActionData) {
        isPerformingAction = true;
        socket.emit('playerAction', { ...pendingActionData, narrative: narrativeText });
        closeNarrativeModal();
    }
});

narrativeCancelBtn.addEventListener('click', closeNarrativeModal);

eventRollBtn.onclick = () => {
    socket.emit('rollForEvent');
    eventRollBtn.classList.add('hidden');
    // Hide the modal and advance the queue so the next modal (dice roll) can appear.
    eventOverlay.classList.add('hidden');
    finishModal();
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
    socket.emit('rollForWorldEventSave');
    worldEventSaveRollBtn.classList.add('hidden');
});

document.body.addEventListener('click', (e) => {
    if (currentSkipHandler && !e.target.closest('#skip-popup-btn')) {
        skipPopupBtn.classList.remove('hidden');
    }
});
skipPopupBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (currentSkipHandler) {
        currentSkipHandler();
    }
});
toastCloseBtn.addEventListener('click', () => {
    clearTimeout(toastTimeout);
    toastNotification.classList.add('hidden');
});

// SKILL CHALLENGE LISTENERS
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

// Equipment & Item Modals
keepCurrentBtn.addEventListener('click', () => {
    if (myPlayerInfo.pendingEquipmentChoice) {
        socket.emit('resolveEquipmentChoice', { choice: 'keep', newCardId: myPlayerInfo.pendingEquipmentChoice.newCard.id });
        equipmentChoiceModal.classList.add('hidden');
        finishModal();
    }
});
equipNewBtn.addEventListener('click', () => {
     if (myPlayerInfo.pendingEquipmentChoice) {
        socket.emit('resolveEquipmentChoice', { choice: 'swap', newCardId: myPlayerInfo.pendingEquipmentChoice.newCard.id });
        equipmentChoiceModal.classList.add('hidden');
        finishModal();
    }
});
discardNewItemBtn.addEventListener('click', () => {
    socket.emit('resolveItemSwap', { cardToDiscardId: null });
    itemSwapModal.classList.add('hidden');
    finishModal();
});
itemFoundCloseBtn.addEventListener('click', () => {
    itemFoundModal.classList.add('hidden');
    finishModal();
});

// --- SOCKET.IO EVENT HANDLERS ---
socket.on('connect', () => { myId = socket.id; });
socket.on('roomCreated', (room) => {
    document.body.classList.add('in-game');
    lobbyScreen.classList.add('hidden');
    gameArea.classList.remove('hidden');
    roomCodeDisplay.textContent = room.id;
    mobileRoomCode.textContent = room.id;
    [startGameBtn, mobileStartGameBtn].forEach(btn => btn.classList.remove('hidden'));
    gameModeSelector.classList.remove('hidden');
    initDiceScene();
    renderGameState(room);
});
socket.on('joinSuccess', (room) => {
    document.body.classList.add('in-game');
    lobbyScreen.classList.add('hidden');
    gameArea.classList.remove('hidden');
    roomCodeDisplay.textContent = room.id;
    mobileRoomCode.textContent = room.id;
    gameModeSelector.classList.add('hidden');
    initDiceScene();
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
socket.on('actionError', (errorMessage) => showToast(errorMessage));

socket.on('simpleRollAnimation', (data) => {
    showDiceRoll(data);
});

socket.on('attackAnimation', (data) => {
    const { attackerId, targetId, d20Roll, isCrit, isFumble, totalRollToHit, requiredRoll, hit, damageDice, rawDamageRoll, damageBonus, totalDamage } = data;

    const finalCallback = () => {
        isPerformingAction = false;
        if (currentRoomState.id) {
            renderGameState(currentRoomState);
        }
    };

    const toHitResultHTML = `
        ${isCrit ? `<p class="result-line hit">CRITICAL HIT!</p>` : isFumble ? `<p class="result-line miss">FUMBLE!</p>` : hit ? `<p class="result-line hit">HIT!</p>` : `<p class="result-line miss">MISS!</p>`}
        <p class="roll-details">Roll: ${d20Roll} + ${damageBonus} (Bonus) = <strong>${totalRollToHit}</strong> vs DC ${requiredRoll}</p>
    `;
    
    const targetEl = document.querySelector(`.card[data-monster-id="${targetId}"]`);
    playEffectAnimation(targetEl, hit ? 'hit' : 'miss');

    showDiceRoll({
        dieType: 'd20',
        roll: d20Roll,
        title: `${myId === attackerId ? 'You Attack!' : 'Ally Attacks!'}`,
        resultHTML: toHitResultHTML,
        continueCallback: () => {
            if (hit && damageDice !== 'unarmed') {
                const damageResultHTML = `
                    <p class="result-line">DAMAGE!</p>
                    <p class="roll-details">Roll: ${rawDamageRoll} (Dice) + ${damageBonus} (Bonus) = <strong>${totalDamage}</strong></p>
                `;
                const damageDieType = `d${damageDice.split('d')[1]}`;
                showDiceRoll({
                    dieType: damageDieType,
                    roll: rawDamageRoll,
                    title: `Damage Roll`,
                    resultHTML: damageResultHTML,
                    continueCallback: finalCallback,
                });
            } else if (hit && damageDice === 'unarmed') {
                 const damageResultHTML = `<p class="result-line">DAMAGE!</p><p class="roll-details">Dealt <strong>${totalDamage}</strong> damage.</p>`;
                 showDiceRoll({ dieType: 'd6', roll: 1, title: 'Unarmed Damage', resultHTML: damageResultHTML, continueCallback: finalCallback });
            } else {
                finalCallback();
            }
        }
    });
});

socket.on('monsterAttackAnimation', (data) => {
    const { attackerId, targetId, d20Roll, isCrit, isFumble, totalRollToHit, requiredRoll, hit, damageDice, rawDamageRoll, attackBonus, totalDamage } = data;

    const targetPlayerEl = get(`player-${targetId}`);
    playEffectAnimation(targetPlayerEl, hit ? 'hit' : 'miss');

    const toHitResultHTML = `
        ${isCrit ? `<p class="result-line hit">CRITICAL HIT!</p>` : isFumble ? `<p class="result-line miss">FUMBLE!</p>` : hit ? `<p class="result-line hit">HIT!</p>` : `<p class="result-line miss">MISS!</p>`}
        <p class="roll-details">Roll: ${d20Roll} + ${attackBonus} (Bonus) = <strong>${totalRollToHit}</strong> vs DC ${requiredRoll}</p>
    `;

    showDiceRoll({
        dieType: 'd20',
        roll: d20Roll,
        title: `Monster Attacks!`,
        resultHTML: toHitResultHTML,
        continueCallback: () => {
            if (hit) {
                const damageResultHTML = `
                    <p class="result-line">DAMAGE!</p>
                    <p class="roll-details">Roll: ${rawDamageRoll} (Dice) = <strong>${totalDamage}</strong></p>
                `;
                 const damageDieType = `d${damageDice.split('d')[1]}`;
                 showDiceRoll({
                    dieType: damageDieType,
                    roll: rawDamageRoll,
                    title: `Damage Roll`,
                    resultHTML: damageResultHTML,
                });
            }
        }
    });
});

socket.on('eventRollResult', ({ roll, outcome }) => {
    const resultHTML = `<p class="result-line">You rolled a ${roll}!</p><p>${outcome.type === 'none' ? 'Nothing happened.' : 'An event occurred!'}</p>`;
    showDiceRoll({
        dieType: 'd20',
        roll: roll,
        title: "Event Roll",
        resultHTML,
        continueCallback: () => {
            if (outcome.type === 'playerEvent') {
                 addToModalQueue(() => {
                    eventOverlay.classList.remove('hidden');
                    eventTitle.textContent = 'A player event occurs!';
                    eventPrompt.textContent = 'Choose one:';
                    eventCardSelection.classList.remove('hidden');
                    eventRollBtn.classList.add('hidden');
                    eventCardSelection.innerHTML = '';
                    outcome.options.forEach(card => {
                        const cardEl = createCardElement(card);
                        cardEl.onclick = () => {
                            socket.emit('selectEventCard', { cardId: card.id });
                            eventOverlay.classList.add('hidden');
                            finishModal();
                        };
                        eventCardSelection.appendChild(cardEl);
                    });
                }, `event-result-${roll}`);
            }
        }
    });
});

socket.on('eventItemFound', (card) => {
    addToModalQueue(() => {
        itemFoundDisplay.innerHTML = '';
        itemFoundDisplay.appendChild(createCardElement(card));
        itemFoundModal.classList.remove('hidden');
    }, `item-found-${card.id}`);
});

socket.on('skillChallengeRollResult', ({ d20Roll, bonus, itemBonus, totalRoll, dc, success }) => {
     const resultHTML = `
        ${success ? `<p class="result-line hit">SUCCESS!</p>` : `<p class="result-line miss">FAILURE!</p>`}
        <p class="roll-details">Roll: ${d20Roll} + ${bonus}(stat) ${itemBonus > 0 ? `+ ${itemBonus}(item)` : ''} = <strong>${totalRoll}</strong> vs DC ${dc}</p>
    `;
    showDiceRoll({
        dieType: 'd20',
        roll: d20Roll,
        title: 'Skill Challenge',
        resultHTML,
    });
});

socket.on('worldEventSaveResult', ({ d20Roll, bonus, totalRoll, dc, success }) => {
    worldEventSaveModal.classList.add('hidden');
    finishModal();
    const resultHTML = `
        ${success ? `<p class="result-line hit">Success!</p>` : `<p class="result-line miss">Failure!</p>`}
        <p class="roll-details">Roll: ${d20Roll} + ${bonus} = <strong>${totalRoll}</strong> vs DC ${dc}</p>
    `;
    showDiceRoll({
        dieType: 'd20',
        roll: d20Roll,
        title: 'World Event Save',
        resultHTML,
    });
});


// --- VOICE CHAT ---
function updateVoiceButtons() {
    const isMuted = localStream ? !localStream.getAudioTracks()[0].enabled : false;

    // Desktop
    joinVoiceBtn.classList.toggle('hidden', isVoiceConnected);
    muteVoiceBtn.classList.toggle('hidden', !isVoiceConnected);
    disconnectVoiceBtn.classList.toggle('hidden', !isVoiceConnected);
    if (isVoiceConnected) {
        muteVoiceBtn.innerHTML = isMuted
            ? `<span class="material-symbols-outlined">mic</span>Unmute`
            : `<span class="material-symbols-outlined">mic_off</span>Mute`;
    }

    // Mobile
    mobileJoinVoiceBtn.classList.toggle('hidden', isVoiceConnected);
    mobileMuteVoiceBtn.classList.toggle('hidden', !isVoiceConnected);
    mobileDisconnectVoiceBtn.classList.toggle('hidden', !isVoiceConnected);
    if (isVoiceConnected) {
         mobileMuteVoiceBtn.innerHTML = isMuted
            ? `<span class="material-symbols-outlined">mic</span>`
            : `<span class="material-symbols-outlined">mic_off</span>`;
    }
}

async function joinVoice() {
    try {
        if (!localStream) {
            localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        }
        const audio = document.createElement('audio');
        audio.srcObject = localStream;
        audio.muted = true;
        audio.play();
        voiceChatContainer.appendChild(audio);
        
        isVoiceConnected = true;
        updateVoiceButtons();
        socket.emit('join-voice');
    } catch (err) {
        console.error("Error accessing microphone:", err);
        showToast("Could not access microphone. Please check permissions.");
    }
}

function disconnectVoice() {
    if (!localStream) return;

    socket.emit('leave-voice');
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;

    for (const peerId in peerConnections) {
        if (peerConnections[peerId]) {
            peerConnections[peerId].close();
        }
        delete peerConnections[peerId];
    }

    voiceChatContainer.innerHTML = '';
    isVoiceConnected = false;
    updateVoiceButtons();
}

[joinVoiceBtn, mobileJoinVoiceBtn].forEach(btn => btn.addEventListener('click', joinVoice));
[disconnectVoiceBtn, mobileDisconnectVoiceBtn].forEach(btn => btn.addEventListener('click', disconnectVoice));
[muteVoiceBtn, mobileMuteVoiceBtn].forEach(btn => btn.addEventListener('click', () => {
    if (localStream) {
        const audioTrack = localStream.getAudioTracks()[0];
        audioTrack.enabled = !audioTrack.enabled;
        updateVoiceButtons();
    }
}));


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

// --- MENU ---
function toggleMenu(menu, button) {
    const isHidden = menu.classList.toggle('hidden');
    button.innerHTML = isHidden
        ? `<span class="material-symbols-outlined">menu</span>`
        : `<span class="material-symbols-outlined">close</span>`;
}

menuToggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleMenu(menuDropdown, menuToggleBtn);
});
mobileMenuToggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleMenu(mobileMenuDropdown, mobileMenuToggleBtn);
});

document.addEventListener('click', (e) => {
    if (!menuDropdown.classList.contains('hidden') && !e.target.closest('.header-menu')) {
        menuDropdown.classList.add('hidden');
        menuToggleBtn.innerHTML = `<span class="material-symbols-outlined">menu</span>`;
    }
    if (!mobileMenuDropdown.classList.contains('hidden') && !e.target.closest('.header-menu')) {
        mobileMenuDropdown.classList.add('hidden');
        mobileMenuToggleBtn.innerHTML = `<span class="material-symbols-outlined">menu</span>`;
    }
});

// --- CUSTOM SETTINGS LISTENERS ---
document.querySelectorAll('.slider').forEach(slider => {
    const valueSpan = get(`${slider.id}-value`);
    if (valueSpan) {
        slider.addEventListener('input', () => {
            valueSpan.textContent = slider.value;
        });
    }
});

get('enemy-scaling').addEventListener('change', (e) => {
    get('scaling-rate-group').classList.toggle('hidden', !e.target.checked);
});

// --- Initial UI Setup ---
document.querySelector('.radio-label').classList.add('active');
document.querySelector('.radio-group').addEventListener('change', (e) => {
    if (e.target.name === 'gameMode') {
        document.querySelectorAll('.radio-label').forEach(label => label.classList.remove('active'));
        e.target.closest('.radio-label').classList.add('active');
        customSettingsPanel.classList.toggle('hidden', e.target.value !== 'Custom');
    }
});

// --- HELP & TUTORIAL ---
const tutorialContent = [
    { title: "Welcome to Quest & Chronicle!", content: "<p>This is a quick guide to get you started. On your turn, you'll gain <strong>Action Points (AP)</strong> based on your class and gear. Use them wisely!</p><p>Your primary goal is to work with your party to defeat monsters and overcome challenges thrown at you by the Dungeon Master.</p>" },
    { title: "Your Turn", content: "<p>At the start of your turn, you'll get to roll a <strong>d20</strong> for a random event. This could lead to finding new items, special player events, or nothing at all.</p><p>After that, you can spend your AP on actions. The main actions are attacking, guarding, or resting to heal.</p>" },
    { title: "Combat & Abilities", content: "<p>To attack, first click your <strong>equipped weapon</strong>, then click a monster on the board to target it. This will bring up a final confirmation prompt.</p><p>Your <strong>Class Ability</strong> is a powerful, unique skill. Check the Character tab to see its description and cost, and use it to turn the tide of battle!</p>" },
    { title: "Cards & Gear", content: "<p>You'll find new weapons, armor, and items. Click an equippable item in your hand to equip it.</p><p>Pay attention to card effects! They can provide powerful bonuses or unique actions.</p><p><strong>That's it! Good luck, adventurer!</strong></p>" }
];
let currentTutorialPage = 0;

function showTutorial() {
    tutorialModal.classList.remove('hidden');
    renderTutorialPage();
}
function renderTutorialPage() {
    const page = tutorialContent[currentTutorialPage];
    get('tutorial-content').innerHTML = `<h2>${page.title}</h2>${page.content}`;
    get('tutorial-page-indicator').textContent = `${currentTutorialPage + 1} / ${tutorialContent.length}`;
    get('tutorial-prev-btn').disabled = currentTutorialPage === 0;
    get('tutorial-next-btn').textContent = currentTutorialPage === tutorialContent.length - 1 ? "Finish" : "Next";
}
function closeTutorial() {
    tutorialModal.classList.add('hidden');
    localStorage.setItem('tutorialCompleted', 'true');
}
get('tutorial-next-btn').addEventListener('click', () => {
    if (currentTutorialPage < tutorialContent.length - 1) {
        currentTutorialPage++;
        renderTutorialPage();
    } else {
        closeTutorial();
    }
});
get('tutorial-prev-btn').addEventListener('click', () => {
    if (currentTutorialPage > 0) {
        currentTutorialPage--;
        renderTutorialPage();
    }
});
get('tutorial-skip-btn').addEventListener('click', closeTutorial);

const helpContentHTML = `
    <h3>Core Mechanics</h3>
    <p><strong>Action Points (AP):</strong> Your primary resource for taking actions on your turn. Most actions, like attacking or using abilities, cost AP. Your total AP is determined by your class and equipment.</p>
    <p><strong>Health (HP):</strong> Your life force. If it reaches 0, you fall but can get back up by spending a Life. If you're out of Lives, you're out of the game!</p>
    <p><strong>Dice Rolls:</strong> Most actions are resolved with a d20 roll. To succeed, you usually need to roll a number that meets or exceeds a target's Defense Class (DC) or Armor Class (AC).</p>

    <h3>Player Stats</h3>
    <p><strong>Damage Bonus:</strong> Added to your weapon damage rolls and your d20 roll to hit.</p>
    <p><strong>Shield Bonus:</strong> Your Armor Class (AC). Monsters must roll higher than this number to hit you.</p>
    <p><strong>Health Dice:</strong> A resource used for the Respite and Rest actions to heal outside of combat.</p>
    <p><strong>STR, DEX, CON, INT, WIS, CHA:</strong> Your core attributes, used for Skill Challenges and certain card effects.</p>
    
    <h3>Turn Events & Challenges</h3>
    <p><strong>Turn Event:</strong> At the start of your turn, you roll a d20. On a 11+, something happens! This can be finding an item, a personal story event, or a party-wide event.</p>
    <p><strong>World Events:</strong> The DM can trigger these powerful, ongoing events that affect the whole party. You may need to make a "saving throw" (a d20 roll) to resist their negative effects.</p>
    <p><strong>Skill Challenges:</strong> A party-wide objective, like climbing a cliff or disarming a trap. On your turn, you can spend 1 AP to contribute by making a skill check.</p>

    <h3>UI Navigation</h3>
    <p><strong>Game Tab:</strong> Your main view, showing the monster board, your equipment, and your hand.</p>
    <p><strong>Character Tab:</strong> Shows your detailed stats and your unique Class Ability.</p>
    <p><strong>Party Tab:</strong> A list of all players in the game, their current health, and status.</p>
    <p><strong>Info Tab:</strong> Displays active World Events and any treasure the party has discovered but not yet distributed.</p>
    <p><strong>Log Tab:</strong> A running log of all game events and player chat.</p>
`;

get('help-content').innerHTML = helpContentHTML;
[helpBtn, mobileHelpBtn].forEach(btn => btn.addEventListener('click', () => helpModal.classList.remove('hidden')));
get('help-close-btn').addEventListener('click', () => helpModal.classList.add('hidden'));


// --- INITIAL LOAD ---
if (!localStorage.getItem('tutorialCompleted')) {
    showTutorial();
}

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

// --- 3D DICE LOGIC ---
function initDiceScene() {
    if (diceRenderer) return; // Already initialized

    const container = diceSceneContainer;
    const width = container.clientWidth;
    const height = container.clientHeight;

    // Scene
    diceScene = new THREE.Scene();
    diceScene.background = null;

    // Camera
    diceCamera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
    diceCamera.position.z = 2.5;

    // Renderer
    diceRenderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    diceRenderer.setSize(width, height);
    container.appendChild(diceRenderer.domElement);

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    diceScene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
    directionalLight.position.set(1, 1, 1);
    diceScene.add(directionalLight);
}

function createTextTexture(text) {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.width = 128;
    canvas.height = 128;
    
    context.fillStyle = '#1a2226'; // var(--color-surface)
    context.fillRect(0, 0, canvas.width, canvas.height);
    
    context.font = "bold 60px 'Inter', sans-serif";
    context.fillStyle = '#e8eff3'; // var(--color-text-primary)
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, canvas.width / 2, canvas.height / 2);
    
    return new THREE.CanvasTexture(canvas);
}

function getDiceMaterials(faces) {
    return faces.map(face => new THREE.MeshLambertMaterial({ map: createTextTexture(face) }));
}

function getDiceTargetRotation(diceType, result) {
    // These rotations orient the die so the result face is pointing up (along the Y axis)
    // Values are approximate and found through experimentation.
    const quarter = Math.PI / 2;
    const rotations = {
        d6: {
            1: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0)),
            2: new THREE.Quaternion().setFromEuler(new THREE.Euler(-quarter, 0, 0)),
            3: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, quarter, 0)),
            4: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -quarter, 0)),
            5: new THREE.Quaternion().setFromEuler(new THREE.Euler(quarter, 0, 0)),
            6: new THREE.Quaternion().setFromEuler(new THREE.Euler(2 * quarter, 0, 0)),
        },
        // Approximations for other dice
        d20: { default: new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI)) },
        d8: { default: new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI)) }
    };
    return rotations[diceType][result] || rotations[diceType].default;
}

function showDiceRoll(options) {
    const { dieType, roll, title, resultHTML, continueCallback } = options;

    addToModalQueue(() => {
        if (!diceRenderer) initDiceScene();
        if (diceAnimationId) cancelAnimationFrame(diceAnimationId);

        // Clear previous die
        if (diceMesh) diceScene.remove(diceMesh);
        
        // Create new die
        let geometry, materials;
        switch (dieType) {
            case 'd8':
                geometry = new THREE.OctahedronGeometry(1);
                materials = getDiceMaterials(['1','2','3','4','5','6','7','8']);
                break;
            case 'd20':
                geometry = new THREE.IcosahedronGeometry(1);
                materials = getDiceMaterials(['1','2','3','4','5','6','7','8','9','10','11','12','13','14','15','16','17','18','19','20']);
                break;
            case 'd6':
            default:
                geometry = new THREE.BoxGeometry(1.5, 1.5, 1.5);
                materials = getDiceMaterials(['1','2','3','4','5','6']);
                break;
        }
        diceMesh = new THREE.Mesh(geometry, materials);
        diceScene.add(diceMesh);

        // Setup modal
        diceRollTitle.textContent = title;
        diceRollResult.classList.add('hidden');
        diceRollContinueBtn.classList.add('hidden');
        diceRollOverlay.classList.remove('hidden');

        // Animation variables
        const duration = 2000; // 2s roll
        const settleDuration = 500; // 0.5s settle
        const startTime = Date.now();
        const startRotation = new THREE.Quaternion().random();
        const targetRotation = getDiceTargetRotation(dieType, roll);
        diceMesh.quaternion.copy(startRotation);

        const angularVelocity = {
            x: (Math.random() - 0.5) * 10,
            y: (Math.random() - 0.5) * 10,
            z: (Math.random() - 0.5) * 10
        };

        function animate() {
            const now = Date.now();
            const elapsed = now - startTime;
            
            if (elapsed < duration) {
                diceMesh.rotation.x += angularVelocity.x * 0.01;
                diceMesh.rotation.y += angularVelocity.y * 0.01;
                diceMesh.rotation.z += angularVelocity.z * 0.01;
                diceAnimationId = requestAnimationFrame(animate);
            } else if (elapsed < duration + settleDuration) {
                const settleProgress = (elapsed - duration) / settleDuration;
                THREE.Quaternion.slerp(diceMesh.quaternion, targetRotation, diceMesh.quaternion, 0.1);
                diceAnimationId = requestAnimationFrame(animate);
            } else {
                diceMesh.quaternion.copy(targetRotation);
                // Animation finished
                diceRollResult.innerHTML = resultHTML;
                diceRollResult.classList.remove('hidden');
                diceRollContinueBtn.classList.remove('hidden');
                diceRollContinueBtn.onclick = () => {
                    diceRollOverlay.classList.add('hidden');
                    if (continueCallback) continueCallback();
                    finishModal();
                };
            }
            diceRenderer.render(diceScene, diceCamera);
        }
        animate();
    }, `dice-roll-${Math.random()}`);
}

function playEffectAnimation(targetElement, effectType) {
    if (!targetElement) return;

    const effectEl = document.createElement('div');
    effectEl.className = `effect-animation ${effectType}-effect`;
    
    const rect = targetElement.getBoundingClientRect();
    effectEl.style.top = `${rect.top + rect.height / 2}px`;
    effectEl.style.left = `${rect.left + rect.width / 2}px`;

    animationOverlay.appendChild(effectEl);

    setTimeout(() => {
        effectEl.remove();
    }, 1000); 
}