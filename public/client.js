// This file contains all client-side JavaScript logic for the Quest & Chronicle game.
// It establishes the Socket.IO connection to the server, manages local game state,
// handles all user interactions (button clicks, form submissions), and dynamically renders
// the game state received from the server into the HTML DOM. It also contains WebRTC logic for voice chat
// and the spinner animation logic for dice rolls.

// --- 8. INITIALIZATION & PWA SERVICE WORKER ---
document.addEventListener('DOMContentLoaded', () => {

    // --- INDEX ---
    // 1.  CLIENT STATE & SETUP
    //     - 1.1. State Variables
    //     - 1.2. Static Data (Visuals)
    //     - 1.3. DOM Element References
    // 2.  HELPER FUNCTIONS
    //     - 2.1. Toast Notifications
    //     - 2.2. Modal & Queue Management
    //     - 2.3. Logging
    // 3.  RENDERING LOGIC (REBUILT)
    //     - 3.1. createCardElement()
    //     - 3.2. renderPlayerList()
    //     - 3.3. renderSetupChoices() (Rebuilt)
    //     - 3.4. renderGameplayState()
    //     - 3.5. renderUIForPhase() (Rebuilt render router)
    // 4.  UI EVENT LISTENERS (ATTACHED VIA DOMContentLoaded)
    // 5.  SOCKET.IO EVENT HANDLERS
    // 6.  VOICE CHAT (WebRTC) LOGIC
    // 7.  DICE SPINNER & ANIMATION LOGIC
    // 8.  INITIALIZATION & PWA SERVICE WORKER

    // --- 1. CLIENT STATE & SETUP ---

    // --- 1.1. State Variables ---
    const socket = io();
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

    // --- 1.2. Static Data (Visuals) ---
    const statVisuals = {
        hp:          { icon: 'favorite', color: 'var(--stat-color-hp)' },
        ap:          { icon: 'bolt', color: 'var(--stat-color-ap)' },
        damageBonus: { icon: 'swords', color: 'var(--stat-color-damage)' },
        shieldBonus: { icon: 'shield', color: 'var(--stat-color-shield)' },
        healthDice:  { icon: 'healing', color: 'var(--stat-color-hp)' },
        lifeCount:   { icon: 'ecg_heart', color: 'var(--stat-color-hp)' },
        shieldHp:    { icon: 'shield_with_heart', color: 'var(--stat-color-shield)' },
        str:         { icon: 'fitness_center', color: 'var(--stat-color-str)' },
        dex:         { icon: 'sprint', color: 'var(--stat-color-dex)' },
        con:         { icon: 'health_and_safety', color: 'var(--stat-color-con)' },
        int:         { icon: 'school', color: 'var(--stat-color-int)' },
        wis:         { icon: 'psychology', color: 'var(--stat-color-wis)' },
        cha:         { icon: 'groups', color: 'var(--stat-color-cha)' },
        attackBonus: { icon: 'colorize', color: 'var(--stat-color-damage)' },
        requiredRollToHit: { icon: 'security', color: 'var(--stat-color-shield)' },
    };

    const statusEffectVisuals = {
        'Stunned':           { icon: 'dizziness', color: '#ffeb3b' },
        'Poisoned':          { icon: 'skull', color: '#4caf50' },
        'Guarded':           { icon: 'shield', color: '#9e9e9e' },
        'On Fire':           { icon: 'local_fire_department', color: '#f44336' },
        'Slowed':            { icon: 'hourglass_empty', color: '#795548' },
        'Drained':           { icon: 'battery_alert', color: '#9c27b0' },
        'Inspired':          { icon: 'star', color: '#ffc107' },
        'Unchecked Assault': { icon: 'axe', color: '#e53935' },
        'Weapon Surge':      { icon: 'swords', color: '#1e88e5' },
        'Divine Aid':        { icon: 'auto_awesome', color: '#fff176' },
    };

    // --- 1.3. DOM Element References ---
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

    // Header Menu
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
    const apCounterDesktop = get('ap-counter-desktop');
    const dmControls = get('dm-controls');
    const dmPlayMonsterBtn = get('dm-play-monster-btn');
    const playerList = get('player-list');
    const gameLobbySettingsDisplay = get('game-lobby-settings-display');
    const roomCodeDisplay = get('room-code');
    const classSelectionDiv = get('class-selection');
    const classCardsContainer = get('class-cards-container');
    const confirmClassBtn = get('confirm-class-btn');
    const playerStatsContainer = get('player-stats-container');
    const playerClassName = get('player-class-name');
    const playerStatsDiv = get('player-stats');
    const classAbilityCard = get('class-ability-card');
    const equippedItemsDiv = get('equipped-items');
    const playerHandDiv = get('player-hand');
    const gameBoardDiv = get('board-cards');
    const worldEventsContainer = get('world-events-container');
    const partyEventContainer = get('party-event-container');
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
    const apCounterMobile = get('ap-counter-mobile');
    const mobileRoomCode = get('mobile-room-code');
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
    const mobileGameLobbySettingsDisplay = get('mobile-game-lobby-settings-display');
    const mobileWorldEventsContainer = get('mobile-world-events-container');
    const mobilePartyEventContainer = get('mobile-party-event-container');
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
    const endTurnConfirmModal = get('end-turn-confirm-modal');
    const endTurnCancelBtn = get('end-turn-cancel-btn');
    const endTurnConfirmBtn = get('end-turn-confirm-btn');
    const diceRollOverlay = get('dice-roll-overlay');
    const diceRollTitle = get('dice-roll-title');
    const diceAnimationContainer = get('dice-animation-container');
    const diceSpinner = get('dice-spinner');
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
    const toastContainer = get('toast-container');


    // --- 2. HELPER FUNCTIONS ---

    // --- 2.1. Toast Notifications ---
    function showInfoToast(message, type = 'info') {
        toastContainer.innerHTML = ''; 

        const toast = document.createElement('div');
        toast.className = `toast-notification-entry toast-${type}`;
        
        const messageSpan = document.createElement('span');
        messageSpan.textContent = message;
        
        const closeBtn = document.createElement('button');
        closeBtn.innerHTML = '&times;';
        closeBtn.className = 'toast-close-btn';
        closeBtn.setAttribute('aria-label', 'Close notification');
        closeBtn.onclick = () => {
            toast.classList.remove('visible');
            setTimeout(() => toast.remove(), 300);
        };

        toast.appendChild(messageSpan);
        toast.appendChild(closeBtn);
        toastContainer.appendChild(toast);

        requestAnimationFrame(() => {
            toast.classList.add('visible');
        });
        
        setTimeout(() => {
            if(toast.parentElement) {
                toast.classList.remove('visible');
                setTimeout(() => toast.remove(), 300);
            }
        }, 5000);
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

    // --- 2.2. Modal & Queue Management ---
    function processModalQueue() {
        if (isModalActive || modalQueue.length === 0 || isPerformingAction) {
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

    // --- 2.3. Logging ---
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
            renderUIForPhase(currentRoomState);
        }
        
        finishModal();
    }

    // --- 3. RENDERING LOGIC (REBUILT) ---

    // --- 3.1. createCardElement() ---
    function createCardElement(card, actions = {}) {
        const { isPlayable = false, isEquippable = false, isTargetable = false } = actions;
        const cardDiv = document.createElement('div');
        cardDiv.className = 'card';
        cardDiv.dataset.cardId = card.id;

        if (card.type === 'Monster') {
            cardDiv.dataset.monsterId = card.id;
            if(isTargetable) cardDiv.classList.add('targetable');
        }
        
        let statusEffectsIconsHTML = '';
        if (card.statusEffects && card.statusEffects.length > 0) {
            const icons = card.statusEffects.map(effect => {
                const visual = statusEffectVisuals[effect.name];
                if (!visual) return '';
                const durationText = effect.duration > 1 ? `${effect.duration} turns left` : `${effect.duration} turn left`;
                const title = `${effect.name} (${durationText})`;
                const textColor = (visual.color === '#ffeb3b' || visual.color === '#fff176') ? '#000' : '#fff';
                return `<span class="material-symbols-outlined status-effect-icon" style="background-color: ${visual.color}; color: ${textColor};" title="${title}">${visual.icon}</span>`;
            }).join('');
            statusEffectsIconsHTML = `<div class="card-status-effects">${icons}</div>`;
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
            monsterHologramHTML = '';
            
            monsterStatsHTML = `
                <div class="monster-stats-grid">
                    <div class="card-bonus" title="Attack Bonus" style="color: ${statVisuals.attackBonus.color};"><span class="material-symbols-outlined">${statVisuals.attackBonus.icon}</span>+${card.attackBonus || 0}</div>
                    <div class="card-bonus" title="Armor Class" style="color: ${statVisuals.requiredRollToHit.color};"><span class="material-symbols-outlined">${statVisuals.requiredRollToHit.icon}</span>${card.requiredRollToHit || 10}</div>
                    <div class="card-bonus" title="Action Points" style="color: ${statVisuals.ap.color};"><span class="material-symbols-outlined">${statVisuals.ap.icon}</span>${card.ap || 1}</div>
                </div>
            `;
        }

        const cardTitle = card.isMagical ? `<span class="magical-item">${card.name}</span>` : card.name;

        cardDiv.innerHTML = `
            ${statusEffectsIconsHTML}
            ${monsterHologramHTML}
            <div class="card-content">
                <h3 class="card-title">${cardTitle}</h3>
                <p class="card-effect">${card.effect?.description || card.description || card.outcome || ''}</p>
            </div>
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
                    showInfoToast("You must select a monster to target!", 'error');
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

    // --- 3.2.renderPlayerList() ---
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
                .map(effect => {
                    const visual = statusEffectVisuals[effect.name];
                    if (!visual) return '';
                    const durationText = effect.duration > 1 ? `${effect.duration} turns left` : `${effect.duration} turn left`;
                    const title = `${effect.name} (${durationText})`;
                    return `<span class="material-symbols-outlined status-effect-icon-sm" style="color: ${visual.color};" title="${title}">${visual.icon}</span>`;
                })
                .join('');
            
            const hpDisplay = gameState.phase === 'lobby' || gameState.phase === 'class_selection'
                ? 'HP: -- / --'
                : `HP: ${player.stats.currentHp || '?'} / ${player.stats.maxHp || '?'}`;

            li.innerHTML = `
                <div class="player-info">
                    <span>${npcTag}${player.name}${classText}</span>
                    <span class="player-role ${roleClass}">${player.role}</span>
                </div>
                <div class="player-hp">${hpDisplay}</div>
                <div class="player-status-effects">${statusEffectsHTML}</div>
            `;
            listElement.appendChild(li);
        });

        if (settingsDisplayElement && (gameState.phase === 'lobby' || gameState.phase === 'class_selection') && gameState.gameMode === 'Custom') {
            settingsDisplayElement.classList.remove('hidden');
            const s = gameState.customSettings;
            settingsDisplayElement.innerHTML = `
                <h4>Custom Game Settings</h4>
                <ul>
                    <li><strong>Bag Size:</strong> ${s.maxHandSize}</li>
                    <li><strong>Start Gear:</strong> ${s.startWithWeapon ? 'Weapon' : ''} ${s.startWithArmor ? 'Armor' : ''}</li>
                    <li><strong>Start Hand:</strong> ${s.startingItems} Items, ${s.startingSpells} Spells</li>
                    <li><strong>Loot Drop:</strong> ${s.lootDropRate}%</li>
                    <li><strong>Enemy Scaling:</strong> ${s.enemyScaling ? `Enabled (${s.scalingRate}%)` : 'Disabled'}</li>
                </ul>
            `;
        } else if (settingsDisplayElement) {
            settingsDisplayElement.classList.add('hidden');
        }
    }

    // REBUILT: This function is now only responsible for rendering the setup choices and is called by the main render router.
    function renderSetupChoices(room) {
        if (!myPlayerInfo || myPlayerInfo.role !== 'Explorer' || !room.gameState.classData) return;
        const { gameState } = room;

        // Switch to character tab view on mobile if not already there
        if (!get('mobile-screen-character').classList.contains('active')) {
            document.querySelectorAll('.mobile-screen').forEach(s => s.classList.remove('active'));
            get('mobile-screen-character').classList.add('active');
            mobileBottomNav.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
            document.querySelector('.nav-btn[data-screen="character"]').classList.add('active');
        }

        const hasChosenClass = !!myPlayerInfo.class;

        // --- Part 1: Render Class Selection UI ---
        [classCardsContainer, mobileClassCardsContainer].forEach(container => {
            container.innerHTML = '';
            const classData = gameState.classData;
            if (!classData) {
                container.innerHTML = `<p class="empty-pool-text">Loading classes...</p>`;
                return;
            }
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
           
           container.querySelectorAll('.class-card').forEach(card => {
               const classId = card.dataset.classId;
               card.classList.toggle('selected', classId === tempSelectedClassId);
               card.onclick = () => {
                   if (hasChosenClass) return; // Don't allow changing class
                   
                   tempSelectedClassId = classId;
                   
                   // Update visuals directly instead of a full re-render
                   container.querySelectorAll('.class-card').forEach(c => c.classList.remove('selected'));
                   card.classList.add('selected');
                   
                   // Show confirm buttons
                   confirmClassBtn.classList.remove('hidden');
                   mobileConfirmClassBtn.classList.remove('hidden');
               };
           });
       });

       // --- Part 2: Control Visibility ---
        const showClassSelection = !hasChosenClass;
        
        [classCardsContainer, mobileClassCardsContainer].forEach(el => el.style.display = showClassSelection ? 'flex' : 'none');
        
        [confirmClassBtn, mobileConfirmClassBtn].forEach(btn => {
           btn.classList.toggle('hidden', !tempSelectedClassId || hasChosenClass);
           if (!hasChosenClass) {
               btn.disabled = false;
               btn.textContent = 'Confirm Class';
           }
        });
    }


    // --- 3.4. renderGameplayState() ---
    function renderGameplayState(room) {
        const { players, gameState } = room;
        const isExplorer = myPlayerInfo.role === 'Explorer';
        const currentTurnTakerId = gameState.turnOrder[gameState.currentPlayerIndex];
        const isMyTurn = currentTurnTakerId === myId;
        const isStunned = myPlayerInfo.statusEffects && myPlayerInfo.statusEffects.some(e => e.type === 'stun' || e.name === 'Stunned');
        const challenge = gameState.skillChallenge;

        const showActionBar = isMyTurn && isExplorer && !isStunned;
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

        if (myPlayerInfo.class && isExplorer) {
            playerClassName.textContent = `The ${myPlayerInfo.class}`;
            mobilePlayerClassName.textContent = `The ${myPlayerInfo.class}`;
            [playerClassName, mobilePlayerClassName].forEach(el => el.classList.remove('hidden'));
            
            const ability = room.gameState.classData?.[myPlayerInfo.class]?.ability;
            if (ability) {
                let canUse = myPlayerInfo.currentAp >= ability.apCost;
                if (myPlayerInfo.class === 'Barbarian' || myPlayerInfo.class === 'Warrior') {
                    if (!myPlayerInfo.hand.some(card => card.type === 'Spell')) canUse = false;
                }
                const abilityHTML = `
                    <h3 class="sub-header-font">Class Ability</h3>
                    <p class="ability-title">${ability.name} (-${ability.apCost} AP)</p>
                    <p class="ability-desc">${ability.description}</p>
                    <button id="use-ability-btn" class="btn btn-special btn-sm" ${canUse ? '' : 'disabled'}>Use Ability</button>
                `;
                [classAbilityCard, mobileClassAbilityCard].forEach(c => {
                    c.innerHTML = abilityHTML;
                    c.classList.remove('hidden');
                    c.querySelector('#use-ability-btn').onclick = () => socket.emit('playerAction', { action: 'useClassAbility' });
                });
            }
        } else {
            [playerClassName, mobilePlayerClassName, classAbilityCard, mobileClassAbilityCard].forEach(el => el.classList.add('hidden'));
        }

        if (myPlayerInfo.stats && myPlayerInfo.class) {
            const pStats = myPlayerInfo.stats;
            const statsOrder = ['hp', 'ap', 'damageBonus', 'shieldBonus', 'healthDice', 'lifeCount', 'shieldHp', 'str', 'dex', 'con', 'int', 'wis', 'cha'];
            const statsToDisplay = [];

            statsOrder.forEach(key => {
                const visual = statVisuals[key];
                if (!visual) return;
                let label, value;
                switch(key) {
                    case 'hp': label = "HP"; value = `${pStats.currentHp} / ${pStats.maxHp}`; break;
                    case 'ap': label = "AP"; value = `${myPlayerInfo.currentAp} / ${pStats.ap}`; break;
                    case 'damageBonus': label = "DMG Bonus"; value = pStats.damageBonus; break;
                    case 'shieldBonus': label = "SHIELD Bonus"; value = pStats.shieldBonus; break;
                    case 'healthDice': label = "Health Dice"; value = `${myPlayerInfo.healthDice.current}d${myPlayerInfo.healthDice.max}`; break;
                    case 'lifeCount': label = "Lives"; value = myPlayerInfo.lifeCount; break;
                    case 'shieldHp': if (pStats.shieldHp <= 0) return; label = "Shield HP"; value = pStats.shieldHp; break;
                    default: label = key.toUpperCase(); value = pStats[key];
                }
                statsToDisplay.push(`<div class="stat-line"><span class="material-symbols-outlined" style="color: ${visual.color};">${visual.icon}</span> <span class="stat-label">${label}:</span> <span class="stat-value">${value}</span></div>`);
            });
            const statsHTML = statsToDisplay.join('');
            [playerStatsDiv, mobileStatsDisplay].forEach(el => el.innerHTML = statsHTML);
        }

        [equippedItemsDiv, mobileEquippedItems].forEach(container => {
            container.innerHTML = '';
            const weapon = myPlayerInfo.equipment.weapon;
            if (weapon) {
                const cardEl = createCardElement(weapon, {});
                if (isMyTurn) {
                    cardEl.classList.add('attackable-weapon');
                    if (weapon.id === selectedWeaponId) cardEl.classList.add('selected-weapon');
                    cardEl.onclick = (e) => {
                        e.stopPropagation();
                        selectedWeaponId = (selectedWeaponId === weapon.id) ? null : weapon.id;
                        selectedTargetId = null;
                        renderUIForPhase(currentRoomState);
                    };
                }
                container.appendChild(cardEl);
            } else {
                 const fistsCard = document.createElement('div');
                fistsCard.className = 'card';
                fistsCard.dataset.cardId = 'unarmed';
                fistsCard.innerHTML = `<div class="card-content"><h3 class="card-title">Fists</h3><p class="card-effect">A basic unarmed strike. Costs 1 AP. Damage is based on your Strength.</p></div><div class="card-footer"><p class="card-type">Unarmed</p></div>`;
                if (isMyTurn) {
                    fistsCard.classList.add('attackable-weapon');
                    if ('unarmed' === selectedWeaponId) fistsCard.classList.add('selected-weapon');
                    fistsCard.onclick = (e) => {
                        e.stopPropagation();
                        selectedWeaponId = (selectedWeaponId === 'unarmed') ? null : 'unarmed';
                        selectedTargetId = null;
                        renderUIForPhase(currentRoomState);
                    };
                }
                container.appendChild(fistsCard);
            }
            if (myPlayerInfo.equipment.armor) {
                container.appendChild(createCardElement(myPlayerInfo.equipment.armor, {}));
            }
        });

        [playerHandDiv, mobilePlayerHand].forEach(container => {
            container.innerHTML = '';
            myPlayerInfo.hand.forEach(card => {
                const isEquippable = card.type === 'Weapon' || card.type === 'Armor';
                const cardEl = createCardElement(card, { isPlayable: isMyTurn && !isEquippable, isEquippable });
                container.appendChild(cardEl);
            });
        });

        [gameBoardDiv, mobileBoardCards].forEach(container => {
            container.innerHTML = '';
            if (gameState.board.monsters.length > 0) {
                gameState.board.monsters.forEach(monster => {
                    const cardEl = createCardElement(monster, { isTargetable: isMyTurn });
                    cardEl.onclick = () => {
                        if (!isMyTurn || isStunned) return;
                        if (!selectedWeaponId) return showInfoToast("Select your weapon or fists first.", 'error');
                        selectedTargetId = monster.id;
                        const weapon = myPlayerInfo.equipment.weapon;
                        const isUnarmed = selectedWeaponId === 'unarmed';
                        const apCost = isUnarmed ? 1 : (weapon?.apCost || 2);
                        if (myPlayerInfo.currentAp < apCost) return showInfoToast(`Not enough AP. Needs ${apCost}.`, 'error');
                        openNarrativeModal({ action: 'attack', cardId: selectedWeaponId, targetId: selectedTargetId }, isUnarmed ? 'Fists' : weapon.name);
                    };
                    container.appendChild(cardEl);
                });
            } else {
                container.innerHTML = '<p class="empty-pool-text">The board is clear of enemies.</p>';
            }
        });
    }


    // --- 3.5. renderUIForPhase() (Rebuilt render router) ---
    function renderUIForPhase(room) {
        currentRoomState = room;
        myPlayerInfo = room.players[myId];
        if (!myPlayerInfo) { 
            console.warn("My player info not found, waiting for next update.");
            return;
        }

        const { players, gameState } = room;

        lobbyScreen.classList.add('hidden');
        gameArea.classList.remove('hidden');

        renderPlayerList(players, gameState, playerList, gameLobbySettingsDisplay);
        renderPlayerList(players, gameState, mobilePlayerList, mobileGameLobbySettingsDisplay);
        
        roomCodeDisplay.textContent = room.id;
        mobileRoomCode.textContent = room.id;
        if (turnCounter) turnCounter.textContent = gameState.turnCount;
        if (mobileTurnCounter) mobileTurnCounter.textContent = gameState.turnCount;
        
        const currentTurnTakerId = gameState.turnOrder[gameState.currentPlayerIndex];
        const isMyTurn = currentTurnTakerId === myId;
        const turnTaker = players[currentTurnTakerId];

        let turnText = 'Waiting...';
        if (turnTaker) {
            if (turnTaker.role === 'DM') turnText = "Dungeon Master's Turn";
            else turnText = `Turn: ${turnTaker.name}`;
            if(isMyTurn) turnText += ' (Your Turn)';
        } else if (gameState.phase === 'class_selection') {
            turnText = "Waiting for players...";
        }
        turnIndicator.textContent = turnText;
        mobileTurnIndicator.textContent = isMyTurn ? "Your Turn" : turnTaker?.name || "Waiting...";
        
        [apCounterDesktop, apCounterMobile].forEach(el => {
            el.classList.toggle('hidden', !isMyTurn || gameState.phase !== 'started');
            if (isMyTurn && myPlayerInfo.stats.ap) {
                el.innerHTML = `<span class="material-symbols-outlined">bolt</span> AP: ${myPlayerInfo.currentAp} / ${myPlayerInfo.stats.ap}`;
            }
        });

        const oldLootCount = currentRoomState.gameState?.lootPool?.length || 0;
        const newLootCount = gameState.lootPool?.length || 0;
        [worldEventsContainer, mobileWorldEventsContainer].forEach(c => {
            c.innerHTML = gameState.worldEvents.currentEvent ? '' : '<p class="empty-pool-text">No active world event.</p>';
            if (gameState.worldEvents.currentEvent) c.appendChild(createCardElement(gameState.worldEvents.currentEvent));
        });
        [partyEventContainer, mobilePartyEventContainer].forEach(c => {
            c.innerHTML = gameState.currentPartyEvent ? '' : '<p class="empty-pool-text">No active party event.</p>';
            if (gameState.currentPartyEvent) c.appendChild(createCardElement(gameState.currentPartyEvent));
        });
        [partyLootContainer, mobilePartyLootContainer].forEach(c => {
            c.innerHTML = '';
            if (gameState.lootPool && gameState.lootPool.length > 0) {
                gameState.lootPool.forEach(card => c.appendChild(createCardElement(card, {})));
            } else {
                c.innerHTML = '<p class="empty-pool-text">No discoveries yet...</p>';
            }
        });

        const mobileInfoTab = document.querySelector('.nav-btn[data-screen="info"]');
        mobileInfoTab.classList.toggle('highlight', myPlayerInfo.pendingWorldEventSave || newLootCount > oldLootCount || gameState.currentPartyEvent);
        document.querySelector('[data-tab="world-events-tab"]').classList.toggle('highlight', myPlayerInfo.pendingWorldEventSave);
        document.querySelector('[data-tab="party-events-tab"]').classList.toggle('highlight', !!gameState.currentPartyEvent);
        document.querySelector('[data-tab="party-loot-tab"]').classList.toggle('highlight', newLootCount > oldLootCount);

        // Explicitly manage panel visibility based on game phase
        switch (gameState.phase) {
            case 'lobby':
                turnIndicator.textContent = "Waiting in lobby...";
                mobileTurnIndicator.textContent = "Lobby";
                // Hide all in-game panels
                [classSelectionDiv, playerStatsContainer, mobileClassSelection, mobilePlayerStats, gameBoardDiv, mobileBoardCards, playerHandDiv, mobilePlayerHand, fixedActionBar, mobileActionBar].forEach(el => el.classList.add('hidden'));
                break;

            case 'class_selection':
                // Hide gameplay elements
                [gameBoardDiv, mobileBoardCards, playerHandDiv, mobilePlayerHand, fixedActionBar, mobileActionBar].forEach(el => el.classList.add('hidden'));

                if (myPlayerInfo.role === 'DM') {
                     // For DM, show a waiting message in the stats panel instead of class selection
                    classSelectionDiv.classList.add('hidden');
                    playerStatsContainer.classList.remove('hidden');
                    playerStatsContainer.innerHTML = `<h2 class="panel-header">Setup Phase</h2><p style="padding: 1rem; text-align: center;">Waiting for explorers to choose their class...</p>`;
                    mobileClassSelection.classList.add('hidden');
                    mobilePlayerStats.classList.remove('hidden');
                    mobilePlayerStats.innerHTML = `<h2 class="panel-header">Setup Phase</h2><p style="padding: 1rem; text-align: center;">Waiting for explorers to choose their class...</p>`;
                } else {
                    // For players, show class selection UI, hide stats UI
                    classSelectionDiv.classList.remove('hidden');
                    playerStatsContainer.classList.add('hidden');
                    mobileClassSelection.classList.remove('hidden');
                    mobilePlayerStats.classList.add('hidden');
                    renderSetupChoices(room);
                }
                break;

            case 'started':
                // Show gameplay elements, hide class selection
                gameBoardDiv.classList.remove('hidden');
                mobileBoardCards.classList.remove('hidden');
                playerHandDiv.classList.remove('hidden');
                mobilePlayerHand.classList.remove('hidden');
                classSelectionDiv.classList.add('hidden');
                mobileClassSelection.classList.add('hidden');
                
                // Show player stats
                playerStatsContainer.classList.remove('hidden');
                mobilePlayerStats.classList.remove('hidden');
                
                renderGameplayState(room);

                if (isMyTurn && !isMyTurnPreviously) {
                     addToModalQueue(() => {
                        yourTurnPopup.classList.remove('hidden');
                        const timeoutId = setTimeout(() => { yourTurnPopup.classList.add('hidden'); finishModal(); }, 2500);
                        currentSkipHandler = () => { clearTimeout(timeoutId); yourTurnPopup.classList.add('hidden'); finishModal(); };
                    }, 'your-turn-popup');
                }
                break;
                
            default:
                console.error("Unknown in-game phase:", gameState.phase);
        }
        isMyTurnPreviously = isMyTurn;

        if (isMyTurn && myPlayerInfo.pendingEventRoll) {
            addToModalQueue(() => {
                diceRollOverlay.classList.remove('hidden');
                diceRollTitle.textContent = "An Event Occurs!";
                diceRollResult.innerHTML = `<p>Roll a d20 to see what happens on your journey.</p>`;
                diceRollResult.classList.remove('hidden');
                diceSpinner.classList.add('hidden');
                diceRollContinueBtn.classList.add('hidden');
                diceRollActionBtn.classList.remove('hidden');
                diceRollActionBtn.textContent = "Roll d20";
                diceRollActionBtn.disabled = false;
                diceRollActionBtn.onclick = () => { socket.emit('rollForEvent'); diceRollActionBtn.disabled = true; };
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
    }


    // --- 5. SOCKET.IO EVENT HANDLERS ---

    socket.on('connect', () => { myId = socket.id; });

    socket.on('roomCreated', (room) => {
        document.body.classList.add('in-game');
        renderUIForPhase(room);
    });

    socket.on('joinSuccess', (room) => {
        document.body.classList.add('in-game');
        renderUIForPhase(room);
    });
    socket.on('playerLeft', ({ playerName }) => logMessage(`${playerName} has left the game.`, { type: 'system' }));

    socket.on('playerListUpdate', (room) => renderUIForPhase(room));

    socket.on('gameStarted', (room) => {
        renderUIForPhase(room);
    });
    socket.on('gameStateUpdate', (room) => renderUIForPhase(room));
    socket.on('chatMessage', (data) => logMessage(data.message, { type: 'chat', ...data }));
    socket.on('actionError', (errorMessage) => {
        showInfoToast(errorMessage, 'error');
    });

    socket.on('simpleRollAnimation', (data) => {
        if (data.playerId !== myId) {
            showNonBlockingRollToast(data);
        }
    });

    socket.on('attackAnimation', (data) => {
        const { attackerId, targetId, d20Roll, isCrit, isFumble, totalRollToHit, requiredRoll, hit, damageDice, rawDamageRoll, damageBonus, totalDamage } = data;
        const isMyAttack = attackerId === myId;
        
        const toHitResultHTML = `${isCrit ? `<p class="result-line hit">CRITICAL HIT!</p>` : isFumble ? `<p class="result-line miss">FUMBLE!</p>` : hit ? `<p class="result-line hit">HIT!</p>` : `<p class="result-line miss">MISS!</p>`}<p class="roll-details">Roll: ${d20Roll} + ${damageBonus} (Bonus) = <strong>${totalRollToHit}</strong> vs DC ${requiredRoll}</p>`;
        const damageResultHTML = damageDice === 'unarmed' ? `<p class="result-line">DAMAGE!</p><p class="roll-details">Dealt <strong>${totalDamage}</strong> damage.</p>` : `<p class="result-line">DAMAGE!</p><p class="roll-details">Roll: ${rawDamageRoll} (Dice) + ${damageBonus} (Bonus) = <strong>${totalDamage}</strong></p>`;

        const attacker = currentRoomState.players[attackerId];
        const toHitTitle = isMyAttack ? 'You Attack!' : `${attacker?.name || 'Ally'} Attacks!`;
        const damageTitle = 'Damage Roll';
        
        const targetEl = document.querySelector(`.card[data-monster-id="${targetId}"]`);
        playEffectAnimation(targetEl, hit ? 'hit' : 'miss');

        const finalCallback = () => { diceRollOverlay.classList.add('hidden'); isPerformingAction = false; finishModal(); };
        const damageStep = () => showDiceRoll({ dieType: `d${(damageDice || 'd6').split('d')[1] || 6}`, roll: rawDamageRoll, title: damageTitle, resultHTML: damageResultHTML, continueCallback: finalCallback });
        const toHitStep = () => showDiceRoll({ dieType: 'd20', roll: d20Roll, title: toHitTitle, resultHTML: toHitResultHTML, continueCallback: hit ? damageStep : finalCallback });

        if (isMyAttack) {
            isPerformingAction = true;
            toHitStep();
        } else {
            showNonBlockingRollToast({ title: toHitTitle, resultHTML: toHitResultHTML });
            if (hit) setTimeout(() => showNonBlockingRollToast({ title: damageTitle, resultHTML: damageResultHTML }), 2000);
        }
    });

    socket.on('monsterAttackAnimation', (data) => {
        const { monsterId, targetId, d20Roll, isCrit, isFumble, totalRollToHit, requiredRoll, hit, damageDice, rawDamageRoll, attackBonus, totalDamage } = data;

        const targetPlayerEl = get(`player-${targetId}`);
        playEffectAnimation(targetPlayerEl, hit ? 'hit' : 'miss');
        
        const monster = currentRoomState.gameState.board.monsters.find(m => m.id === monsterId);
        const monsterName = monster?.name || 'Monster';

        const toHitResultHTML = `${isCrit ? `<p class="result-line hit">CRITICAL HIT!</p>` : isFumble ? `<p class="result-line miss">FUMBLE!</p>` : hit ? `<p class="result-line hit">HIT!</p>` : `<p class="result-line miss">MISS!</p>`}<p class="roll-details">Roll: ${d20Roll} + ${attackBonus} (Bonus) = <strong>${totalRollToHit}</strong> vs DC ${requiredRoll}</p>`;
        showNonBlockingRollToast({ title: `${monsterName} Attacks!`, resultHTML: toHitResultHTML });
        
        if (hit) {
            const damageResultHTML = `<p class="result-line">DAMAGE!</p><p class="roll-details">Roll: ${rawDamageRoll} (Dice) = <strong>${totalDamage}</strong></p>`;
            setTimeout(() => showNonBlockingRollToast({ title: 'Damage Roll', resultHTML: damageResultHTML }), 2000);
        }
    });

    socket.on('eventRollResult', ({ roll, outcome }) => {
        const resultHTML = `<p class="result-line">${roll}</p><p>${outcome.message}</p>`;

        const continueCallback = () => {
            diceRollOverlay.classList.add('hidden');
            finishModal(); 

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
        };
        
        const spinnerValue = diceSpinner.querySelector('.spinner-value');
        diceAnimationContainer.style.height = '200px';
        diceSpinner.classList.remove('hidden');
        
        let counter = 0;
        const interval = setInterval(() => {
            spinnerValue.textContent = Math.floor(Math.random() * 20) + 1;
            counter += 50;
            if (counter >= 1500) {
                clearInterval(interval);
                spinnerValue.textContent = roll;
                setTimeout(() => {
                    diceSpinner.classList.add('hidden');
                    diceAnimationContainer.style.height = '0px';
                    diceRollResult.innerHTML = resultHTML;
                    diceRollResult.classList.remove('hidden');
                    diceRollContinueBtn.classList.remove('hidden');
                    diceRollContinueBtn.onclick = continueCallback;
                }, 500);
            }
        }, 50);
    });

    socket.on('eventItemFound', (card) => {
        addToModalQueue(() => {
            itemFoundDisplay.innerHTML = '';
            itemFoundDisplay.appendChild(createCardElement(card));
            itemFoundModal.classList.remove('hidden');
        }, `item-found-${card.id}`);
    });

    socket.on('skillChallengeRollResult', ({ d20Roll, bonus, itemBonus, totalRoll, dc, success }) => {
         const resultHTML = `${success ? `<p class="result-line hit">SUCCESS!</p>` : `<p class="result-line miss">FAILURE!</p>`}<p class="roll-details">Roll: ${d20Roll} + ${bonus}(stat) ${itemBonus > 0 ? `+ ${itemBonus}(item)` : ''} = <strong>${totalRoll}</strong> vs DC ${dc}</p>`;
        showDiceRoll({ dieType: 'd20', roll: d20Roll, title: 'Skill Challenge', resultHTML });
    });

    socket.on('worldEventSaveResult', ({ d20Roll, bonus, totalRoll, dc, success }) => {
        worldEventSaveModal.classList.add('hidden');
        finishModal();
        const resultHTML = `${success ? `<p class="result-line hit">Success!</p>` : `<p class="result-line miss">Failure!</p>`}<p class="roll-details">Roll: ${d20Roll} + ${bonus} = <strong>${totalRoll}</strong> vs DC ${dc}</p>`;
        showDiceRoll({ dieType: 'd20', roll: d20Roll, title: 'World Event Save', resultHTML });
    });


    // --- 6. VOICE CHAT (WebRTC) LOGIC ---
    function updateVoiceButtons() {
        const isMuted = localStream ? !localStream.getAudioTracks()[0].enabled : false;

        joinVoiceBtn.classList.toggle('hidden', isVoiceConnected);
        muteVoiceBtn.classList.toggle('hidden', !isVoiceConnected);
        disconnectVoiceBtn.classList.toggle('hidden', !isVoiceConnected);
        if (isVoiceConnected) {
            muteVoiceBtn.innerHTML = isMuted
                ? `<span class="material-symbols-outlined">mic</span>Unmute`
                : `<span class="material-symbols-outlined">mic_off</span>Mute`;
        }

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
            showInfoToast("Could not access microphone. Please check permissions.", 'error');
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

    // --- 7. DICE SPINNER & ANIMATION LOGIC ---
    function toggleMenu(menu, button) {
        const isHidden = menu.classList.toggle('hidden');
        button.innerHTML = isHidden
            ? `<span class="material-symbols-outlined">menu</span>`
            : `<span class="material-symbols-outlined">close</span>`;
    }

    function initializeLobby() {
        const beginnerRadio = document.querySelector('input[name="gameMode"][value="Beginner"]');
        if (beginnerRadio) {
            beginnerRadio.checked = true;
            beginnerRadio.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }

    function showNonBlockingRollToast(data) {
        toastContainer.innerHTML = '';

        const toast = document.createElement('div');
        toast.className = 'toast-roll-overlay';

        const closeBtn = document.createElement('button');
        closeBtn.innerHTML = '&times;';
        closeBtn.className = 'toast-roll-close';
        closeBtn.setAttribute('aria-label', 'Close roll result');
        closeBtn.onclick = () => {
            toast.classList.remove('visible');
            setTimeout(() => toast.remove(), 300);
        };

        toast.innerHTML = `<div class="toast-roll-content"><h2 class="panel-header">${data.title}</h2><div class="dice-roll-result-container">${data.resultHTML}</div></div>`;
        toast.querySelector('.toast-roll-content').prepend(closeBtn);
        
        toastContainer.appendChild(toast);

        requestAnimationFrame(() => toast.classList.add('visible'));

        setTimeout(() => { if (toast.parentElement) { toast.classList.remove('visible'); setTimeout(() => toast.remove(), 300); } }, 7000);
    }

    function showDiceRoll(options) {
        const { dieType, roll, title, resultHTML, continueCallback } = options;

        addToModalQueue(() => {
            diceRollTitle.textContent = title;
            diceRollResult.classList.add('hidden');
            diceRollContinueBtn.classList.add('hidden');
            diceAnimationContainer.style.height = '200px';
            diceSpinner.classList.remove('hidden');
            diceRollOverlay.classList.remove('hidden');
            
            const spinnerValue = diceSpinner.querySelector('.spinner-value');
            const max = parseInt(dieType.slice(1), 10);
            let counter = 0;
            const interval = setInterval(() => {
                spinnerValue.textContent = Math.floor(Math.random() * max) + 1;
                counter += 50;
                if (counter >= 1500) {
                    clearInterval(interval);
                    spinnerValue.textContent = roll;
                    setTimeout(() => {
                        diceSpinner.classList.add('hidden');
                        diceAnimationContainer.style.height = '0px';
                        diceRollResult.innerHTML = resultHTML;
                        diceRollResult.classList.remove('hidden');
                        diceRollContinueBtn.classList.remove('hidden');
                        diceRollContinueBtn.onclick = () => {
                            diceRollOverlay.classList.add('hidden');
                            if (continueCallback) continueCallback();
                            finishModal();
                        };
                    }, 500);
                }
            }, 50);
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

        setTimeout(() => effectEl.remove(), 1000); 
    }
    
    // --- 4. UI EVENT LISTENERS ---

    // --- 4.1. Lobby & Game Setup ---
    createRoomBtn.addEventListener('click', () => {
        const playerName = playerNameInput.value.trim();
        if (!playerName) return showInfoToast('Please enter a player name.', 'error');
        const checkedRadio = document.querySelector('input[name="gameMode"]:checked');
        if (!checkedRadio) return showInfoToast('Please select a game mode.', 'error');
        const gameMode = checkedRadio.value;
        let customSettings = {};
        if (gameMode === 'Beginner') {
            customSettings = { dungeonPressure: 15, lootDropRate: 35, magicalItemChance: 10, maxHandSize: 5, enemyScaling: false, scalingRate: 50, startWithWeapon: true, startWithArmor: true, startingItems: 2, startingSpells: 2 };
        } else if (gameMode === 'Advanced') {
            customSettings = { dungeonPressure: 35, lootDropRate: 15, magicalItemChance: 30, maxHandSize: 5, enemyScaling: true, scalingRate: 60, startWithWeapon: false, startWithArmor: false, startingItems: 0, startingSpells: 0 };
        } else {
            customSettings = {
                maxHandSize: parseInt(get('max-hand-size').value, 10), startWithWeapon: get('start-with-weapon').checked, startWithArmor: get('start-with-armor').checked, startingItems: parseInt(get('starting-items').value, 10),
                startingSpells: parseInt(get('starting-spells').value, 10), lootDropRate: parseInt(get('loot-drop-rate').value, 10), enemyScaling: get('enemy-scaling').checked, scalingRate: parseInt(get('scaling-rate').value, 10),
                dungeonPressure: 25, magicalItemChance: 20
            };
        }
        socket.emit('createRoom', { playerName, gameMode, customSettings });
    });
    joinRoomBtn.addEventListener('click', () => {
        const playerName = playerNameInput.value.trim();
        const roomId = roomIdInput.value.trim().toUpperCase();
        if (playerName && roomId) socket.emit('joinRoom', { roomId, playerName });
        else showInfoToast('Please enter a player name and a room code.', 'error');
    });

    [confirmClassBtn, mobileConfirmClassBtn].forEach(btn => btn.addEventListener('click', () => {
        if (tempSelectedClassId) {
            socket.emit('chooseClass', { classId: tempSelectedClassId });
            btn.disabled = true;
            btn.textContent = 'Confirmed!';
        }
    }));

    // --- 4.2. Turn & Action Controls ---
    [actionEndTurnBtn, mobileActionEndTurnBtn].forEach(btn => btn.addEventListener('click', () => addToModalQueue(() => endTurnConfirmModal.classList.remove('hidden'), 'end-turn-confirm')));
    [actionGuardBtn, mobileActionGuardBtn].forEach(btn => btn.addEventListener('click', () => socket.emit('playerAction', { action: 'guard' })));
    [actionBriefRespiteBtn, mobileActionBriefRespiteBtn].forEach(btn => btn.addEventListener('click', () => socket.emit('playerAction', { action: 'briefRespite' })));
    [actionFullRestBtn, mobileActionFullRestBtn].forEach(btn => btn.addEventListener('click', () => socket.emit('playerAction', { action: 'fullRest' })));
    dmPlayMonsterBtn.addEventListener('click', () => socket.emit('dmAction', { action: 'playMonster' }));

    // --- 4.3. Navigation (Mobile & Desktop) ---
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
            document.querySelectorAll('.game-area-desktop .tab-content').forEach(content => content.classList.remove('active'));
            get(button.dataset.tab).classList.add('active');
        });
    });

    // --- 4.4. Chat & Modals ---
    chatToggleBtn.addEventListener('click', () => {
        chatOverlay.classList.toggle('hidden');
        menuDropdown.classList.add('hidden');
        menuToggleBtn.innerHTML = `<span class="material-symbols-outlined">menu</span>`;
    });
    chatCloseBtn.addEventListener('click', () => chatOverlay.classList.add('hidden'));
    chatForm.addEventListener('submit', (e) => { 
        e.preventDefault();
        const message = chatInput.value.trim();
        if (message) { socket.emit('sendMessage', { channel: chatChannel.value, message }); chatInput.value = ''; }
    });
    mobileChatForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const message = mobileChatInput.value.trim();
        if (message) { socket.emit('sendMessage', { channel: mobileChatChannel.value, message }); mobileChatInput.value = ''; }
    });
    [leaveGameBtn, mobileLeaveGameBtn].forEach(btn => btn.addEventListener('click', () => { if (confirm("Are you sure?")) window.location.reload(); }));
    endTurnConfirmBtn.addEventListener('click', () => { socket.emit('endTurn'); endTurnConfirmModal.classList.add('hidden'); finishModal(); });
    endTurnCancelBtn.addEventListener('click', () => { endTurnConfirmModal.classList.add('hidden'); finishModal(); });
    narrativeConfirmBtn.addEventListener('click', () => {
        let narrativeText = narrativeInput.value.trim();
        if (narrativeText === "") narrativeText = generate_random_attack_description();
        if (pendingActionData) { socket.emit('playerAction', { ...pendingActionData, narrative: narrativeText }); closeNarrativeModal(); }
    });
    narrativeCancelBtn.addEventListener('click', closeNarrativeModal);
    eventRollBtn.onclick = () => { socket.emit('rollForEvent'); eventPrompt.textContent = "Rolling..."; eventRollBtn.disabled = true; };
    worldEventSaveRollBtn.addEventListener('click', () => { socket.emit('rollForWorldEventSave'); worldEventSaveRollBtn.classList.add('hidden'); });
    skipPopupBtn.addEventListener('click', (e) => { e.stopPropagation(); if (currentSkipHandler) currentSkipHandler(); });
    skillChallengeCloseBtn.addEventListener('click', () => skillChallengeOverlay.classList.add('hidden'));

    [actionSkillChallengeBtn, mobileActionSkillChallengeBtn].forEach(btn => btn.addEventListener('click', () => {
        selectedItemIdForChallenge = null;
        itemSelectContainer.innerHTML = '';
        const allItems = [...myPlayerInfo.hand, ...Object.values(myPlayerInfo.equipment).filter(i => i)];
        if (allItems.length === 0) itemSelectContainer.innerHTML = `<p class="empty-pool-text">You have no items.</p>`;
        else {
            allItems.forEach(item => {
                const cardEl = createCardElement(item);
                cardEl.onclick = () => {
                    selectedItemIdForChallenge = (selectedItemIdForChallenge === item.id) ? null : item.id;
                    itemSelectContainer.querySelectorAll('.card').forEach(c => c.classList.remove('selected-item'));
                    if (selectedItemIdForChallenge === item.id) cardEl.classList.add('selected-item');
                };
                itemSelectContainer.appendChild(cardEl);
            });
        }
        itemSelectModal.classList.remove('hidden');
    }));
    itemSelectCancelBtn.addEventListener('click', () => { itemSelectModal.classList.add('hidden'); selectedItemIdForChallenge = null; });
    itemSelectConfirmBtn.addEventListener('click', () => {
        socket.emit('playerAction', { action: 'contributeToSkillChallenge', itemId: selectedItemIdForChallenge });
        itemSelectModal.classList.add('hidden');
        selectedItemIdForChallenge = null;
    });

    keepCurrentBtn.addEventListener('click', () => { if (myPlayerInfo.pendingEquipmentChoice) { socket.emit('resolveEquipmentChoice', { choice: 'keep', newCardId: myPlayerInfo.pendingEquipmentChoice.newCard.id }); equipmentChoiceModal.classList.add('hidden'); finishModal(); } });
    equipNewBtn.addEventListener('click', () => { if (myPlayerInfo.pendingEquipmentChoice) { socket.emit('resolveEquipmentChoice', { choice: 'swap', newCardId: myPlayerInfo.pendingEquipmentChoice.newCard.id }); equipmentChoiceModal.classList.add('hidden'); finishModal(); } });
    discardNewItemBtn.addEventListener('click', () => { socket.emit('resolveItemSwap', { cardToDiscardId: null }); itemSwapModal.classList.add('hidden'); finishModal(); });
    itemFoundCloseBtn.addEventListener('click', () => { itemFoundModal.classList.add('hidden'); finishModal(); });

    // --- 4.5. Menu & Custom Settings ---
    document.querySelectorAll('.slider').forEach(slider => { const valueSpan = get(`${slider.id}-value`); if (valueSpan) slider.addEventListener('input', () => valueSpan.textContent = slider.value); });
    get('enemy-scaling').addEventListener('change', (e) => get('scaling-rate-group').classList.toggle('hidden', !e.target.checked));

    // --- 4.6. Help & Tutorial ---
    const tutorialContent = [
        { title: "Welcome to Quest & Chronicle!", content: "<p>This is a quick guide to get you started. On your turn, you'll gain <strong>Action Points (AP)</strong> based on your class and gear. Use them wisely!</p><p>Your primary goal is to work with your party to defeat monsters and overcome challenges thrown at you by the Dungeon Master.</p>" },
        { title: "Your Turn", content: "<p>At the start of your turn, you may get to roll a <strong>d20</strong> for a random event. This could lead to finding new items, special player events, or nothing at all.</p><p>After that, you can spend your AP on actions. The main actions are attacking, guarding, using cards, or resting to heal.</p>" },
        { title: "Combat & Abilities", content: "<p>To attack, first click your <strong>equipped weapon</strong> (or fists), then click a monster on the board to target it. This will bring up a final confirmation prompt.</p><p>Your <strong>Class Ability</strong> is a powerful, unique skill. Check the Character tab to see its description and cost, and use it to turn the tide of battle!</p>" },
        { title: "Cards & Gear", content: "<p>You'll find new new weapons, armor, spells, and items. Click an equippable item in your hand to equip it. If your hand is full when you find a new item, you'll be asked to swap something out.</p><p>Pay attention to card effects! They can provide powerful bonuses or unique actions.</p><p><strong>That's it! Good luck, adventurer!</strong></p>" }
    ];
    let currentTutorialPage = 0;
    function renderTutorialPage() {
        const page = tutorialContent[currentTutorialPage];
        get('tutorial-page-content').innerHTML = `<h2 class="panel-header">${page.title}</h2><div class="tutorial-page-body">${page.content}</div>`;
        get('tutorial-page-indicator').textContent = `${currentTutorialPage + 1} / ${tutorialContent.length}`;
        get('tutorial-prev-btn').disabled = currentTutorialPage === 0;
        get('tutorial-next-btn').textContent = currentTutorialPage === tutorialContent.length - 1 ? "Finish" : "Next";
    }
    function closeTutorial() { tutorialModal.classList.add('hidden'); localStorage.setItem('tutorialCompleted', 'true'); }
    get('tutorial-next-btn').addEventListener('click', () => { if (currentTutorialPage < tutorialContent.length - 1) { currentTutorialPage++; renderTutorialPage(); } else closeTutorial(); });
    get('tutorial-prev-btn').addEventListener('click', () => { if (currentTutorialPage > 0) { currentTutorialPage--; renderTutorialPage(); } });
    get('tutorial-close-btn').addEventListener('click', closeTutorial);

    const helpContentHTML = `<h3>Core Mechanics</h3><p><strong>Action Points (AP):</strong> Your primary resource for taking actions on your turn. Refills at the start of your turn.</p><p><strong>Health (HP):</strong> Your life force. If it reaches 0, you spend a Life to get back up.</p><h3>Player Stats</h3><p><strong>Damage Bonus:</strong> Added to weapon damage rolls and your d20 roll to hit an enemy.</p><p><strong>Shield Bonus:</strong> Your defense against attacks. An enemy must roll a d20 + their attack bonus higher than 10 + your shield bonus to hit you.</p><h3>Actions (Your Turn)</h3><p><strong>Attack (-1 or -2 AP):</strong> Click your equipped weapon, then a monster.</p><p><strong>Use Item/Cast Spell (-1 AP):</strong> Use a card from your hand.</p><p><strong>Guard (-1 AP):</strong> Add temporary Shield HP.</p><p><strong>Brief Respite (-1 AP):</strong> Spend one Health Die to heal.</p><p><strong>Full Rest (-2 AP):</strong> Spend two Health Dice to heal more.</p>`;
    [helpBtn, mobileHelpBtn].forEach(btn => btn.addEventListener('click', () => { get('help-content').innerHTML = helpContentHTML; helpModal.classList.remove('hidden'); }));
    get('help-close-btn').addEventListener('click', () => helpModal.classList.add('hidden'); });

    if (!localStorage.getItem('tutorialCompleted')) { renderTutorialPage(); tutorialModal.classList.remove('hidden'); }

    // --- 4.7. Voice Chat ---
    [joinVoiceBtn, mobileJoinVoiceBtn].forEach(btn => btn.addEventListener('click', joinVoice));
    [disconnectVoiceBtn, mobileDisconnectVoiceBtn].forEach(btn => btn.addEventListener('click', disconnectVoice));
    [muteVoiceBtn, mobileMuteVoiceBtn].forEach(btn => btn.addEventListener('click', () => { if (localStream) { const a = localStream.getAudioTracks()[0]; a.enabled = !a.enabled; updateVoiceButtons(); } }));
    
    // --- 4.8. Menu Toggles ---
    menuToggleBtn.addEventListener('click', () => toggleMenu(menuDropdown, menuToggleBtn));
    mobileMenuToggleBtn.addEventListener('click', () => toggleMenu(mobileMenuDropdown, mobileMenuToggleBtn));
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.header-menu')) {
            menuDropdown.classList.add('hidden');
            mobileMenuDropdown.classList.add('hidden');
            menuToggleBtn.innerHTML = `<span class="material-symbols-outlined">menu</span>`;
            mobileMenuToggleBtn.innerHTML = `<span class="material-symbols-outlined">menu</span>`;
        }
    });
    
    // --- 4.9. Lobby Settings ---
    document.querySelectorAll('input[name="gameMode"]').forEach(radio => radio.addEventListener('change', () => customSettingsPanel.classList.toggle('hidden', document.querySelector('input[name="gameMode"]:checked').value !== 'Custom')));

    initializeLobby();
});

if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js')
        .then(reg => console.log('SW registered', reg))
        .catch(err => console.error('SW registration failed:', err));
}
