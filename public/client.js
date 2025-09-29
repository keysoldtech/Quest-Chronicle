// This file contains all client-side JavaScript logic for the Quest & Chronicle game.
// It establishes the Socket.IO connection to the server, manages local game state,
// handles all user interactions (button clicks, form submissions), and dynamically renders
// the game state received from the server into the HTML DOM. It also contains WebRTC logic for voice chat
// and the spinner animation logic for dice rolls.

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
    //     - 3.3. renderSetupChoices() (Replaced by showClassSelectionUI)
    //     - 3.4. renderGameplayState()
    //     - 3.5. renderUIForPhase() (render router)
    // 4.  UI EVENT LISTENERS (ATTACHED VIA DOMContentLoaded)
    // 5.  SOCKET.IO EVENT HANDLERS
    // 6.  VOICE CHAT (WebRTC) LOGIC
    // 7.  DICE SPINNER & ANIMATION LOGIC
    // 8.  MENU & CLASS SELECTION
    // 9.  INITIALIZATION

    // ===== 8. MENU & CLASS SELECTION =====
    let selectedGameMode = null;
    let currentRoom = null;

    function initializeMenu() {
        // DOM Elements for Menu
        const menuScreen = document.getElementById('menu-screen');
        const gameScreen = document.getElementById('game-screen');
        const playerNameInput = document.getElementById('player-name-input');
        const createRoomBtn = document.getElementById('create-room-btn');
        const joinRoomBtn = document.getElementById('join-room-btn');
        const roomCodeInput = document.getElementById('room-code-input');
        const customSettingsDiv = document.getElementById('custom-settings');
        const menuError = document.getElementById('menu-error');

        // Mode selection buttons
        const modeButtons = document.querySelectorAll('.mode-btn');
        modeButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                modeButtons.forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
                selectedGameMode = btn.getAttribute('data-mode');
                customSettingsDiv.classList.toggle('hidden', selectedGameMode !== 'Custom');
                validateCreateButton();
            });
        });
        
        playerNameInput.addEventListener('input', validateCreateButton);
        createRoomBtn.addEventListener('click', handleCreateRoom);
        joinRoomBtn.addEventListener('click', handleJoinRoom);
        roomCodeInput.addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase(); });
        
        playerNameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !createRoomBtn.disabled) handleCreateRoom();
        });
        roomCodeInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') handleJoinRoom();
        });
    }

    function validateCreateButton() {
        const playerNameInput = document.getElementById('player-name-input');
        const createRoomBtn = document.getElementById('create-room-btn');
        const hasName = playerNameInput.value.trim().length > 0;
        const hasModeSelected = selectedGameMode !== null;
        createRoomBtn.disabled = !(hasName && hasModeSelected);
    }

    function handleCreateRoom() {
        const playerNameInput = document.getElementById('player-name-input');
        const playerName = playerNameInput.value.trim();
        if (!playerName) return showMenuError('Please enter your name');
        if (!selectedGameMode) return showMenuError('Please select a game mode');
        
        let customSettings = null;
        if (selectedGameMode === 'Custom') {
            customSettings = {
                startWithWeapon: document.getElementById('setting-weapon').checked,
                startWithArmor: document.getElementById('setting-armor').checked,
                startingItems: parseInt(document.getElementById('setting-items').value),
                startingSpells: parseInt(document.getElementById('setting-spells').value),
                maxHandSize: parseInt(document.getElementById('setting-hand-size').value),
                lootDropRate: parseInt(document.getElementById('setting-loot-rate').value)
            };
        }
        
        socket.emit('createRoom', { playerName, gameMode: selectedGameMode, customSettings });
        console.log('Creating room...', { playerName, selectedGameMode, customSettings });
    }

    function handleJoinRoom() {
        const playerNameInput = document.getElementById('player-name-input');
        const roomCodeInput = document.getElementById('room-code-input');
        const playerName = playerNameInput.value.trim();
        const roomCode = roomCodeInput.value.trim().toUpperCase();
        
        if (!playerName) return showMenuError('Please enter your name');
        if (roomCode.length !== 4) return showMenuError('Please enter a valid 4-letter room code');
        
        socket.emit('joinRoom', { roomId: roomCode, playerName: playerName });
        console.log('Joining room...', { playerName, roomCode });
    }

    function showMenuError(message) {
        const menuError = document.getElementById('menu-error');
        menuError.textContent = message;
        menuError.classList.remove('hidden');
        setTimeout(() => menuError.classList.add('hidden'), 3000);
    }

    function hideMenuShowGame() {
        const menuScreen = document.getElementById('menu-screen');
        const gameScreen = document.getElementById('game-screen');
        menuScreen.classList.remove('active');
        gameScreen.classList.add('active');
        document.body.classList.add('in-game');
    }

    function showClassSelectionUI(classes) {
        const classCardsContainer = document.getElementById('class-cards-container');
        const mobileClassCardsContainer = document.getElementById('mobile-class-cards-container');

        [classCardsContainer, mobileClassCardsContainer].forEach(container => {
            if (!container) return;
            container.innerHTML = ''; 

            const classGrid = document.createElement('div');
            classGrid.className = 'class-grid';
            classGrid.id = (container.id === 'mobile-class-cards-container' ? 'mobile-' : '') + 'class-grid';

            Object.entries(classes).forEach(([classId, classData]) => {
                const classCard = document.createElement('div');
                classCard.className = 'class-card';
                classCard.innerHTML = `
                    <h3>${classId}</h3>
                    <div class="class-stats">
                        <p><strong>HP:</strong> ${classData.baseHp}</p>
                        <p><strong>Damage:</strong> +${classData.baseDamageBonus}</p>
                        <p><strong>Shield:</strong> +${classData.baseShieldBonus}</p>
                        <p><strong>AP:</strong> ${classData.baseAp}</p>
                    </div>
                    <div class="class-ability">
                        <p><strong>${classData.ability.name}</strong></p>
                        <p class="ability-desc">${classData.ability.description}</p>
                    </div>
                    <button class="select-class-btn">Select ${classId}</button>
                `;
                const selectBtn = classCard.querySelector('.select-class-btn');
                if (selectBtn) {
                    selectBtn.addEventListener('click', () => selectClass(classId));
                }
                classGrid.appendChild(classCard);
            });
            container.appendChild(classGrid);
        });

        const classSelectionDiv = document.getElementById('class-selection');
        const playerStatsContainer = document.getElementById('player-stats-container');
        const mobileClassSelection = document.getElementById('mobile-class-selection');
        const mobilePlayerStats = document.getElementById('mobile-player-stats');

        classSelectionDiv.classList.remove('hidden');
        playerStatsContainer.classList.add('hidden');
        mobileClassSelection.classList.remove('hidden');
        mobilePlayerStats.classList.add('hidden');
    }

    function selectClass(classId) {
        console.log('Selecting class:', classId);
        socket.emit('chooseClass', { classId });
        document.querySelectorAll('.select-class-btn').forEach(btn => {
            btn.disabled = true;
            btn.textContent = '...';
        });
    }

    // --- 1. CLIENT STATE & SETUP ---
    // --- 1.1. State Variables ---
    let myPlayerInfo = {};
    let myId = '';
    let currentRoomState = {};
    let localStream;
    const peerConnections = {};
    let selectedTargetId = null;
    let selectedWeaponId = null;
    let pendingActionData = null;
    let isMyTurnPreviously = false;
    let tempSelectedClassId = null;
    let pendingAbilityConfirmation = null;
    const modalQueue = [];
    let isModalActive = false;
    let currentSkipHandler = null;
    let selectedItemIdForChallenge = null;
    let isPerformingAction = false;
    let isVoiceConnected = false;
    const iceServers = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] };

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
    const gameArea = get('game-area');
    const menuToggleBtn = get('menu-toggle-btn'), menuDropdown = get('menu-dropdown'), chatToggleBtn = get('chat-toggle-btn'), joinVoiceBtn = get('join-voice-btn'), muteVoiceBtn = get('mute-voice-btn'), disconnectVoiceBtn = get('disconnect-voice-btn'), leaveGameBtn = get('leave-game-btn'), helpBtn = get('help-btn'), mobileHelpBtn = get('mobile-help-btn');
    const turnIndicator = get('turn-indicator'), turnCounter = get('turn-counter'), apCounterDesktop = get('ap-counter-desktop'), dmControls = get('dm-controls'), dmPlayMonsterBtn = get('dm-play-monster-btn'), playerList = get('player-list'), gameLobbySettingsDisplay = get('game-lobby-settings-display'), roomCodeDisplay = get('room-code'), classSelectionDiv = get('class-selection'), classCardsContainer = get('class-cards-container'), confirmClassBtn = get('confirm-class-btn'), playerStatsContainer = get('player-stats-container'), playerClassName = get('player-class-name'), playerStatsDiv = get('player-stats'), classAbilityCard = get('class-ability-card'), equippedItemsDiv = get('equipped-items'), playerHandDiv = get('player-hand'), gameBoardDiv = get('board-cards'), worldEventsContainer = get('world-events-container'), partyEventContainer = get('party-event-container'), partyLootContainer = get('party-loot-container'), gameLogContent = get('game-log-content'), desktopTabButtons = document.querySelectorAll('.game-area-desktop .tab-btn');
    const fixedActionBar = get('fixed-action-bar'), actionSkillChallengeBtn = get('action-skill-challenge-btn'), actionGuardBtn = get('action-guard-btn'), actionBriefRespiteBtn = get('action-brief-respite-btn'), actionFullRestBtn = get('action-full-rest-btn'), actionEndTurnBtn = get('action-end-turn-btn');
    const mobileTurnIndicator = get('mobile-turn-indicator'), mobileTurnCounter = get('mobile-turn-counter'), apCounterMobile = get('ap-counter-mobile'), mobileRoomCode = get('mobile-room-code'), mobileBoardCards = get('mobile-board-cards'), mobilePlayerHand = get('mobile-player-hand'), mobileClassSelection = get('mobile-class-selection'), mobileClassCardsContainer = get('mobile-class-cards-container'), mobileConfirmClassBtn = get('mobile-confirm-class-btn'), mobilePlayerStats = get('mobile-player-stats'), mobilePlayerClassName = get('mobile-player-class-name'), mobileStatsDisplay = get('mobile-stats-display'), mobileClassAbilityCard = get('mobile-class-ability-card'), mobilePlayerEquipment = get('mobile-player-equipment'), mobileEquippedItems = get('mobile-equipped-items'), mobilePlayerList = get('mobile-player-list'), mobileGameLobbySettingsDisplay = get('mobile-game-lobby-settings-display'), mobileWorldEventsContainer = get('mobile-world-events-container'), mobilePartyEventContainer = get('mobile-party-event-container'), mobilePartyLootContainer = get('mobile-party-loot-container'), mobileBottomNav = document.querySelector('.mobile-bottom-nav'), mobileChatLog = get('mobile-chat-log'), mobileChatForm = get('mobile-chat-form'), mobileChatChannel = get('mobile-chat-channel'), mobileChatInput = get('mobile-chat-input');
    const mobileActionBar = get('mobile-action-bar'), mobileActionSkillChallengeBtn = get('mobile-action-skill-challenge-btn'), mobileActionGuardBtn = get('mobile-action-guard-btn'), mobileActionBriefRespiteBtn = get('mobile-action-brief-respite-btn'), mobileActionFullRestBtn = get('mobile-action-full-rest-btn'), mobileActionEndTurnBtn = get('mobile-action-end-turn-btn');
    const mobileMenuToggleBtn = get('mobile-menu-toggle-btn'), mobileMenuDropdown = get('mobile-menu-dropdown'), mobileJoinVoiceBtn = get('mobile-join-voice-btn'), mobileMuteVoiceBtn = get('mobile-mute-voice-btn'), mobileDisconnectVoiceBtn = get('mobile-disconnect-voice-btn'), mobileLeaveGameBtn = get('mobile-leave-game-btn');
    const chatOverlay = get('chat-overlay'), chatCloseBtn = get('chat-close-btn'), chatLog = get('chat-log'), chatForm = get('chat-form'), chatChannel = get('chat-channel'), chatInput = get('chat-input');
    const narrativeModal = get('narrative-modal'), narrativePrompt = get('narrative-prompt'), narrativeInput = get('narrative-input'), narrativeCancelBtn = get('narrative-cancel-btn'), narrativeConfirmBtn = get('narrative-confirm-btn');
    const yourTurnPopup = get('your-turn-popup'), endTurnConfirmModal = get('end-turn-confirm-modal'), endTurnCancelBtn = get('end-turn-cancel-btn'), endTurnConfirmBtn = get('end-turn-confirm-btn');
    const diceRollOverlay = get('dice-roll-overlay'), diceRollTitle = get('dice-roll-title'), diceAnimationContainer = get('dice-animation-container'), diceSpinner = get('dice-spinner'), diceRollActionBtn = get('dice-roll-action-btn'), diceRollResult = get('dice-roll-result'), diceRollContinueBtn = get('dice-roll-continue-btn');
    const eventOverlay = get('event-overlay'), eventTitle = get('event-title'), eventPrompt = get('event-prompt'), eventRollBtn = get('event-roll-btn'), eventCardSelection = get('event-card-selection');
    const toastContainer = get('toast-container');

    // --- 5. SOCKET.IO EVENT HANDLERS ---
    const socket = io();
    
    // --- 2. HELPER FUNCTIONS ---
    function showInfoToast(message, type = 'info') {
        toastContainer.innerHTML = ''; 
        const toast = document.createElement('div');
        toast.className = `toast-notification-entry toast-${type}`;
        toast.innerHTML = `<span>${message}</span><button class="toast-close-btn" aria-label="Close notification">&times;</button>`;
        toast.querySelector('.toast-close-btn').onclick = () => {
            toast.classList.remove('visible');
            setTimeout(() => toast.remove(), 300);
        };
        toastContainer.appendChild(toast);
        requestAnimationFrame(() => toast.classList.add('visible'));
        setTimeout(() => { if(toast.parentElement) { toast.classList.remove('visible'); setTimeout(() => toast.remove(), 300); } }, 5000);
    }

    const randomAttackDescriptions = ["strikes with a fierce shout...", "delivers a powerful, calculated strike.", "moves with surprising speed, finding an opening.", "unleashes a precise and deadly blow.", "attacks with a determined grimace, aiming for a weak spot.", "executes a well-practiced maneuver.", "lunges forward, their weapon a blur of motion."];
    function generate_random_attack_description() { return randomAttackDescriptions[Math.floor(Math.random() * randomAttackDescriptions.length)]; }

    function processModalQueue() { if (!isModalActive && modalQueue.length > 0 && !isPerformingAction) { isModalActive = true; modalQueue.shift().showFunction(); } }
    function addToModalQueue(showFunction, id) { if (id && modalQueue.some(item => item.id === id)) return; modalQueue.push({ showFunction, id: id || `modal-${Date.now()}` }); processModalQueue(); }
    function finishModal() { isModalActive = false; currentSkipHandler = null; setTimeout(processModalQueue, 200); }

    function logMessage(message, options = {}) {
        const { type = 'system', channel, senderName, isNarrative = false } = options;
        const p = document.createElement('p');
        p.classList.add('chat-message');
        if (type === 'system') { p.classList.add('system'); p.innerHTML = `<span>[System]</span> ${message}`; } 
        else if (type === 'chat') {
            if (isNarrative) { p.classList.add('narrative'); p.innerHTML = `<strong>${senderName}:</strong> ${message}`; } 
            else { const isSelf = senderName === myPlayerInfo.name; const channelTag = channel === 'party' ? '[Party]' : '[Game]'; const channelClass = channel === 'party' ? 'party' : 'game'; const senderClass = isSelf ? 'self' : 'other'; p.innerHTML = `<span class="channel ${channelClass}">${channelTag}</span> <span class="sender ${senderClass}">${senderName}:</span> <span class="message">${message}</span>`; }
        }
        if (type === 'system' || channel === 'game' || isNarrative) { if (gameLogContent) { gameLogContent.appendChild(p.cloneNode(true)); gameLogContent.scrollTop = gameLogContent.scrollHeight; } }
        chatLog.appendChild(p.cloneNode(true)); chatLog.scrollTop = chatLog.scrollHeight;
        if (mobileChatLog) { mobileChatLog.appendChild(p.cloneNode(true)); mobileChatLog.scrollTop = mobileChatLog.scrollHeight; }
    }

    function openNarrativeModal(actionData, cardName) {
        addToModalQueue(() => { pendingActionData = actionData; narrativePrompt.textContent = `How do you want to attack with your ${cardName}?`; narrativeInput.value = ''; narrativeModal.classList.remove('hidden'); narrativeInput.focus(); }, 'narrative-modal');
    }

    function closeNarrativeModal() {
        pendingActionData = null; narrativeModal.classList.add('hidden'); selectedWeaponId = null; selectedTargetId = null; if (currentRoomState.id) { renderUIForPhase(currentRoomState); } finishModal();
    }

    // --- 3. RENDERING LOGIC ---
    function createCardElement(card, actions = {}) {
        const { isPlayable = false, isEquippable = false, isTargetable = false } = actions;
        const cardDiv = document.createElement('div');
        cardDiv.className = 'card';
        cardDiv.dataset.cardId = card.id;
        if (card.type === 'Monster') { cardDiv.dataset.monsterId = card.id; if(isTargetable) cardDiv.classList.add('targetable'); }
        let statusEffectsIconsHTML = '';
        if (card.statusEffects && card.statusEffects.length > 0) { const icons = card.statusEffects.map(effect => { const visual = statusEffectVisuals[effect.name]; if (!visual) return ''; const durationText = effect.duration > 1 ? `${effect.duration} turns left` : `${effect.duration} turn left`; const title = `${effect.name} (${durationText})`; const textColor = (visual.color === '#ffeb3b' || visual.color === '#fff176') ? '#000' : '#fff'; return `<span class="material-symbols-outlined status-effect-icon" style="background-color: ${visual.color}; color: ${textColor};" title="${title}">${visual.icon}</span>`; }).join(''); statusEffectsIconsHTML = `<div class="card-status-effects">${icons}</div>`; }
        let typeInfo = card.type;
        if (card.category && card.category !== 'General') typeInfo += ` / ${card.category}`; else if (card.type === 'World Event' && card.tags) typeInfo = card.tags;
        let bonusesHTML = '';
        if (card.effect?.bonuses) { bonusesHTML = Object.entries(card.effect.bonuses).map(([key, value]) => { const visual = statVisuals[key]; if (!visual) return ''; const sign = value > 0 ? '+' : ''; return `<div class="card-bonus" style="color: ${visual.color};"><span class="material-symbols-outlined">${visual.icon}</span> ${key.charAt(0).toUpperCase() + key.slice(1)}: ${sign}${value}</div>`; }).join(''); }
        let monsterStatsHTML = '';
        if(card.type === 'Monster') { monsterStatsHTML = `<div class="monster-stats-grid"><div class="card-bonus" title="Attack Bonus" style="color: ${statVisuals.attackBonus.color};"><span class="material-symbols-outlined">${statVisuals.attackBonus.icon}</span>+${card.attackBonus || 0}</div><div class="card-bonus" title="Armor Class" style="color: ${statVisuals.requiredRollToHit.color};"><span class="material-symbols-outlined">${statVisuals.requiredRollToHit.icon}</span>${card.requiredRollToHit || 10}</div><div class="card-bonus" title="Action Points" style="color: ${statVisuals.ap.color};"><span class="material-symbols-outlined">${statVisuals.ap.icon}</span>${card.ap || 1}</div></div>`; }
        const cardTitle = card.isMagical ? `<span class="magical-item">${card.name}</span>` : card.name;
        cardDiv.innerHTML = `${statusEffectsIconsHTML}<div class="card-content"><h3 class="card-title">${cardTitle}</h3><p class="card-effect">${card.effect?.description || card.description || card.outcome || ''}</p></div><div class="card-footer">${monsterStatsHTML}<div class="card-bonuses-grid">${bonusesHTML}</div><p class="card-type">${typeInfo}</p></div>`;
        const actionContainer = document.createElement('div');
        actionContainer.className = 'card-actions';
        if (isPlayable) { const playBtn = document.createElement('button'); const cardEffect = card.effect || {}; playBtn.textContent = card.type === 'Spell' ? 'Cast' : 'Use'; playBtn.className = 'btn btn-xs btn-primary'; playBtn.onclick = () => { if ((cardEffect.type === 'damage' || cardEffect.target === 'any-monster') && !selectedTargetId) { showInfoToast("You must select a monster to target!", 'error'); return; } const action = card.type === 'Spell' ? 'castSpell' : 'useItem'; openNarrativeModal({ action, cardId: card.id, targetId: selectedTargetId }, card.name); selectedTargetId = null; }; actionContainer.appendChild(playBtn); }
        if (isEquippable) { const equipBtn = document.createElement('button'); equipBtn.textContent = 'Equip'; equipBtn.className = 'btn btn-xs btn-success'; equipBtn.onclick = () => socket.emit('equipItem', { cardId: card.id }); actionContainer.appendChild(equipBtn); }
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
            const statusEffectsHTML = (player.statusEffects || []).map(effect => { const visual = statusEffectVisuals[effect.name]; if (!visual) return ''; const durationText = effect.duration > 1 ? `${effect.duration} turns left` : `${effect.duration} turn left`; const title = `${effect.name} (${durationText})`; return `<span class="material-symbols-outlined status-effect-icon-sm" style="color: ${visual.color};" title="${title}">${visual.icon}</span>`; }).join('');
            const hpDisplay = gameState.phase === 'lobby' || gameState.phase === 'class_selection' ? 'HP: -- / --' : `HP: ${player.stats.currentHp || '?'} / ${player.stats.maxHp || '?'}`;
            li.innerHTML = `<div class="player-info"><span>${npcTag}${player.name}${classText}</span><span class="player-role ${roleClass}">${player.role}</span></div><div class="player-hp">${hpDisplay}</div><div class="player-status-effects">${statusEffectsHTML}</div>`;
            listElement.appendChild(li);
        });
        if (settingsDisplayElement && (gameState.phase === 'lobby' || gameState.phase === 'class_selection') && gameState.gameMode === 'Custom') { settingsDisplayElement.classList.remove('hidden'); const s = gameState.customSettings; settingsDisplayElement.innerHTML = `<h4>Custom Game Settings</h4><ul><li><strong>Bag Size:</strong> ${s.maxHandSize}</li><li><strong>Start Gear:</strong> ${s.startWithWeapon ? 'Weapon' : ''} ${s.startWithArmor ? 'Armor' : ''}</li><li><strong>Start Hand:</strong> ${s.startingItems} Items, ${s.startingSpells} Spells</li><li><strong>Loot Drop:</strong> ${s.lootDropRate}%</li></ul>`; } 
        else if (settingsDisplayElement) { settingsDisplayElement.classList.add('hidden'); }
    }

    function renderGameplayState(room) {
        const { players, gameState } = room; const isExplorer = myPlayerInfo.role === 'Explorer'; const currentTurnTakerId = gameState.turnOrder[gameState.currentPlayerIndex]; const isMyTurn = currentTurnTakerId === myId; const isStunned = myPlayerInfo.statusEffects && myPlayerInfo.statusEffects.some(e => e.type === 'stun' || e.name === 'Stunned'); const challenge = gameState.skillChallenge;
        const showActionBar = isMyTurn && isExplorer && !isStunned;
        fixedActionBar.classList.toggle('hidden', !showActionBar); mobileActionBar.classList.toggle('hidden', !showActionBar);
        if (showActionBar) { const canGuard = myPlayerInfo.currentAp >= 1; const canBriefRespite = myPlayerInfo.currentAp >= 1 && myPlayerInfo.healthDice.current > 0; const canFullRest = myPlayerInfo.currentAp >= 2 && myPlayerInfo.healthDice.current >= 2; const showChallengeButton = challenge && challenge.isActive && myPlayerInfo.currentAp >= 1; actionSkillChallengeBtn.classList.toggle('hidden', !showChallengeButton); actionGuardBtn.disabled = !canGuard; actionBriefRespiteBtn.disabled = !canBriefRespite; actionFullRestBtn.disabled = !canFullRest; mobileActionSkillChallengeBtn.classList.toggle('hidden', !showChallengeButton); mobileActionGuardBtn.disabled = !canGuard; mobileActionBriefRespiteBtn.disabled = !canBriefRespite; mobileActionFullRestBtn.disabled = !canFullRest; }
        if (myPlayerInfo.class && isExplorer) { playerClassName.textContent = `The ${myPlayerInfo.class}`; mobilePlayerClassName.textContent = `The ${myPlayerInfo.class}`; [playerClassName, mobilePlayerClassName].forEach(el => el.classList.remove('hidden')); const ability = room.gameState.classData?.[myPlayerInfo.class]?.ability; if (ability) { let canUse = myPlayerInfo.currentAp >= ability.apCost; if (myPlayerInfo.class === 'Barbarian' || myPlayerInfo.class === 'Warrior') { if (!myPlayerInfo.hand.some(card => card.type === 'Spell')) canUse = false; } const abilityHTML = `<h3 class="sub-header-font">Class Ability</h3><p class="ability-title">${ability.name} (-${ability.apCost} AP)</p><p class="ability-desc">${ability.description}</p><button id="use-ability-btn" class="btn btn-special btn-sm" ${canUse ? '' : 'disabled'}>Use Ability</button>`; [classAbilityCard, mobileClassAbilityCard].forEach(c => { c.innerHTML = abilityHTML; c.classList.remove('hidden'); c.querySelector('#use-ability-btn').onclick = () => socket.emit('playerAction', { action: 'useClassAbility' }); }); } } 
        else { [playerClassName, mobilePlayerClassName, classAbilityCard, mobileClassAbilityCard].forEach(el => el.classList.add('hidden')); }
        if (myPlayerInfo.stats && myPlayerInfo.class) { const pStats = myPlayerInfo.stats; const statsOrder = ['hp', 'ap', 'damageBonus', 'shieldBonus', 'healthDice', 'lifeCount', 'shieldHp', 'str', 'dex', 'con', 'int', 'wis', 'cha']; const statsToDisplay = []; statsOrder.forEach(key => { const visual = statVisuals[key]; if (!visual) return; let label, value; switch(key) { case 'hp': label = "HP"; value = `${pStats.currentHp} / ${pStats.maxHp}`; break; case 'ap': label = "AP"; value = `${myPlayerInfo.currentAp} / ${pStats.ap}`; break; case 'damageBonus': label = "DMG Bonus"; value = pStats.damageBonus; break; case 'shieldBonus': label = "SHIELD Bonus"; value = pStats.shieldBonus; break; case 'healthDice': label = "Health Dice"; value = `${myPlayerInfo.healthDice.current}d${myPlayerInfo.healthDice.max}`; break; case 'lifeCount': label = "Lives"; value = myPlayerInfo.lifeCount; break; case 'shieldHp': if (pStats.shieldHp <= 0) return; label = "Shield HP"; value = pStats.shieldHp; break; default: label = key.toUpperCase(); value = pStats[key]; } statsToDisplay.push(`<div class="stat-line"><span class="material-symbols-outlined" style="color: ${visual.color};">${visual.icon}</span> <span class="stat-label">${label}:</span> <span class="stat-value">${value}</span></div>`); }); const statsHTML = statsToDisplay.join(''); [playerStatsDiv, mobileStatsDisplay].forEach(el => el.innerHTML = statsHTML); }
        [equippedItemsDiv, mobileEquippedItems].forEach(container => { container.innerHTML = ''; const weapon = myPlayerInfo.equipment.weapon; if (weapon) { const cardEl = createCardElement(weapon, {}); if (isMyTurn) { cardEl.classList.add('attackable-weapon'); if (weapon.id === selectedWeaponId) cardEl.classList.add('selected-weapon'); cardEl.onclick = (e) => { e.stopPropagation(); selectedWeaponId = (selectedWeaponId === weapon.id) ? null : weapon.id; selectedTargetId = null; renderUIForPhase(currentRoomState); }; } container.appendChild(cardEl); } else { const fistsCard = document.createElement('div'); fistsCard.className = 'card'; fistsCard.dataset.cardId = 'unarmed'; fistsCard.innerHTML = `<div class="card-content"><h3 class="card-title">Fists</h3><p class="card-effect">A basic unarmed strike. Costs 1 AP. Damage is based on your Strength.</p></div><div class="card-footer"><p class="card-type">Unarmed</p></div>`; if (isMyTurn) { fistsCard.classList.add('attackable-weapon'); if ('unarmed' === selectedWeaponId) fistsCard.classList.add('selected-weapon'); fistsCard.onclick = (e) => { e.stopPropagation(); selectedWeaponId = (selectedWeaponId === 'unarmed') ? null : 'unarmed'; selectedTargetId = null; renderUIForPhase(currentRoomState); }; } container.appendChild(fistsCard); } if (myPlayerInfo.equipment.armor) { container.appendChild(createCardElement(myPlayerInfo.equipment.armor, {})); } });
        [playerHandDiv, mobilePlayerHand].forEach(container => { container.innerHTML = ''; myPlayerInfo.hand.forEach(card => { const isEquippable = card.type === 'Weapon' || card.type === 'Armor'; const cardEl = createCardElement(card, { isPlayable: isMyTurn && !isEquippable, isEquippable }); container.appendChild(cardEl); }); });
        [gameBoardDiv, mobileBoardCards].forEach(container => { container.innerHTML = ''; if (gameState.board.monsters.length > 0) { gameState.board.monsters.forEach(monster => { const cardEl = createCardElement(monster, { isTargetable: isMyTurn }); cardEl.onclick = () => { if (!isMyTurn || isStunned) return; if (!selectedWeaponId) return showInfoToast("Select your weapon or fists first.", 'error'); selectedTargetId = monster.id; const weapon = myPlayerInfo.equipment.weapon; const isUnarmed = selectedWeaponId === 'unarmed'; const apCost = isUnarmed ? 1 : (weapon?.apCost || 2); if (myPlayerInfo.currentAp < apCost) return showInfoToast(`Not enough AP. Needs ${apCost}.`, 'error'); openNarrativeModal({ action: 'attack', cardId: selectedWeaponId, targetId: selectedTargetId }, isUnarmed ? 'Fists' : weapon.name); }; container.appendChild(cardEl); }); } else { container.innerHTML = '<p class="empty-pool-text">The board is clear of enemies.</p>'; } });
    }

    function renderUIForPhase(room) {
        currentRoomState = room; myPlayerInfo = room.players[myId]; if (!myPlayerInfo) { console.warn("My player info not found, waiting for next update."); return; }
        const { players, gameState } = room; renderPlayerList(players, gameState, playerList, gameLobbySettingsDisplay); renderPlayerList(players, gameState, mobilePlayerList, mobileGameLobbySettingsDisplay);
        roomCodeDisplay.textContent = room.id; mobileRoomCode.textContent = room.id; if (turnCounter) turnCounter.textContent = gameState.turnCount; if (mobileTurnCounter) mobileTurnCounter.textContent = gameState.turnCount;
        const currentTurnTakerId = gameState.turnOrder[gameState.currentPlayerIndex]; const isMyTurn = currentTurnTakerId === myId; const turnTaker = players[currentTurnTakerId];
        let turnText = 'Waiting...'; if (turnTaker) { if (turnTaker.role === 'DM') turnText = "Dungeon Master's Turn"; else turnText = `Turn: ${turnTaker.name}`; if(isMyTurn) turnText += ' (Your Turn)'; } else if (gameState.phase === 'class_selection') { turnText = "Waiting for players..."; }
        turnIndicator.textContent = turnText; mobileTurnIndicator.textContent = isMyTurn ? "Your Turn" : turnTaker?.name || "Waiting...";
        [apCounterDesktop, apCounterMobile].forEach(el => { el.classList.toggle('hidden', !isMyTurn || gameState.phase !== 'started'); if (isMyTurn && myPlayerInfo.stats.ap) { el.innerHTML = `<span class="material-symbols-outlined">bolt</span> AP: ${myPlayerInfo.currentAp} / ${myPlayerInfo.stats.ap}`; } });
        const oldLootCount = currentRoomState.gameState?.lootPool?.length || 0; const newLootCount = gameState.lootPool?.length || 0;
        [worldEventsContainer, mobileWorldEventsContainer].forEach(c => { c.innerHTML = gameState.worldEvents.currentEvent ? '' : '<p class="empty-pool-text">No active world event.</p>'; if (gameState.worldEvents.currentEvent) c.appendChild(createCardElement(gameState.worldEvents.currentEvent)); });
        [partyEventContainer, mobilePartyEventContainer].forEach(c => { c.innerHTML = gameState.currentPartyEvent ? '' : '<p class="empty-pool-text">No active party event.</p>'; if (gameState.currentPartyEvent) c.appendChild(createCardElement(gameState.currentPartyEvent)); });
        [partyLootContainer, mobilePartyLootContainer].forEach(c => { c.innerHTML = ''; if (gameState.lootPool && gameState.lootPool.length > 0) { gameState.lootPool.forEach(card => c.appendChild(createCardElement(card, {}))); } else { c.innerHTML = '<p class="empty-pool-text">No discoveries yet...</p>'; } });
        switch (gameState.phase) {
            case 'lobby': turnIndicator.textContent = "Waiting in lobby..."; mobileTurnIndicator.textContent = "Lobby"; [classSelectionDiv, playerStatsContainer, mobileClassSelection, mobilePlayerStats, gameBoardDiv, mobileBoardCards, playerHandDiv, mobilePlayerHand, fixedActionBar, mobileActionBar].forEach(el => el.classList.add('hidden')); break;
            case 'class_selection': [gameBoardDiv, mobileBoardCards, playerHandDiv, mobilePlayerHand, fixedActionBar, mobileActionBar].forEach(el => el.classList.add('hidden')); if (myPlayerInfo.role === 'DM') { classSelectionDiv.classList.add('hidden'); playerStatsContainer.classList.remove('hidden'); playerStatsContainer.innerHTML = `<h2 class="panel-header">Setup Phase</h2><p style="padding: 1rem; text-align: center;">Waiting for explorers to choose their class...</p>`; mobileClassSelection.classList.add('hidden'); mobilePlayerStats.classList.remove('hidden'); mobilePlayerStats.innerHTML = `<h2 class="panel-header">Setup Phase</h2><p style="padding: 1rem; text-align: center;">Waiting for explorers to choose their class...</p>`; } else { showClassSelectionUI(room.gameState.classData); } break;
            case 'started': gameBoardDiv.classList.remove('hidden'); mobileBoardCards.classList.remove('hidden'); playerHandDiv.classList.remove('hidden'); mobilePlayerHand.classList.remove('hidden'); classSelectionDiv.classList.add('hidden'); mobileClassSelection.classList.add('hidden'); playerStatsContainer.classList.remove('hidden'); mobilePlayerStats.classList.remove('hidden'); renderGameplayState(room); if (isMyTurn && !isMyTurnPreviously) { addToModalQueue(() => { yourTurnPopup.classList.remove('hidden'); const timeoutId = setTimeout(() => { yourTurnPopup.classList.add('hidden'); finishModal(); }, 2500); currentSkipHandler = () => { clearTimeout(timeoutId); yourTurnPopup.classList.add('hidden'); finishModal(); }; }, 'your-turn-popup'); } break;
            default: console.error("Unknown in-game phase:", gameState.phase);
        }
        isMyTurnPreviously = isMyTurn;
        if (isMyTurn && myPlayerInfo.pendingEventRoll) { addToModalQueue(() => { diceRollOverlay.classList.remove('hidden'); diceRollTitle.textContent = "An Event Occurs!"; diceRollResult.innerHTML = `<p>Roll a d20 to see what happens on your journey.</p>`; diceRollResult.classList.remove('hidden'); diceSpinner.classList.add('hidden'); diceRollContinueBtn.classList.add('hidden'); diceRollActionBtn.classList.remove('hidden'); diceRollActionBtn.textContent = "Roll d20"; diceRollActionBtn.disabled = false; diceRollActionBtn.onclick = () => { socket.emit('rollForEvent'); diceRollActionBtn.disabled = true; }; }, 'event-roll'); } else if (!myPlayerInfo.pendingEventChoice) { eventOverlay.classList.add('hidden'); }
    }

    socket.on('connect', () => { myId = socket.id; });
    socket.on('roomCreated', (roomData) => { console.log('Room created:', roomData); currentRoom = roomData; alert(`Room created! Code: ${roomData.id}`); hideMenuShowGame(); if (roomData.gameState.phase === 'class_selection') { renderUIForPhase(roomData); } });
    socket.on('joinSuccess', (roomData) => { console.log('Joined room:', roomData); currentRoom = roomData; hideMenuShowGame(); renderUIForPhase(roomData); });
    socket.on('playerLeft', ({ playerName }) => logMessage(`${playerName} has left the game.`, { type: 'system' }));
    socket.on('playerListUpdate', (room) => renderUIForPhase(room));
    socket.on('gameStarted', (roomData) => { console.log('Game started!', roomData); currentRoom = roomData; renderUIForPhase(roomData); });
    socket.on('gameStateUpdate', (room) => renderUIForPhase(room));
    socket.on('chatMessage', (data) => logMessage(data.message, { type: 'chat', ...data }));
    socket.on('actionError', (message) => { console.error('Action error:', message); showMenuError(message); showInfoToast(message, 'error'); });
    socket.on('attackAnimation', (data) => {
        const { attackerId, targetId, d20Roll, isCrit, isFumble, totalRollToHit, requiredRoll, hit, damageDice, rawDamageRoll, damageBonus, totalDamage } = data; const isMyAttack = attackerId === myId; const toHitResultHTML = `${isCrit ? `<p class="result-line hit">CRITICAL HIT!</p>` : isFumble ? `<p class="result-line miss">FUMBLE!</p>` : hit ? `<p class="result-line hit">HIT!</p>` : `<p class="result-line miss">MISS!</p>`}<p class="roll-details">Roll: ${d20Roll} + ${damageBonus} (Bonus) = <strong>${totalRollToHit}</strong> vs DC ${requiredRoll}</p>`; const damageResultHTML = damageDice === 'unarmed' ? `<p class="result-line">DAMAGE!</p><p class="roll-details">Dealt <strong>${totalDamage}</strong> damage.</p>` : `<p class="result-line">DAMAGE!</p><p class="roll-details">Roll: ${rawDamageRoll} (Dice) + ${damageBonus} (Bonus) = <strong>${totalDamage}</strong></p>`; const attacker = currentRoomState.players[attackerId]; const toHitTitle = isMyAttack ? 'You Attack!' : `${attacker?.name || 'Ally'} Attacks!`; const damageTitle = 'Damage Roll'; const targetEl = document.querySelector(`.card[data-monster-id="${targetId}"]`); playEffectAnimation(targetEl, hit ? 'hit' : 'miss'); const finalCallback = () => { diceRollOverlay.classList.add('hidden'); isPerformingAction = false; finishModal(); }; const damageStep = () => showDiceRoll({ dieType: `d${(damageDice || 'd6').split('d')[1] || 6}`, roll: rawDamageRoll, title: damageTitle, resultHTML: damageResultHTML, continueCallback: finalCallback }); const toHitStep = () => showDiceRoll({ dieType: 'd20', roll: d20Roll, title: toHitTitle, resultHTML: toHitResultHTML, continueCallback: hit ? damageStep : finalCallback }); if (isMyAttack) { isPerformingAction = true; toHitStep(); } else { showNonBlockingRollToast({ title: toHitTitle, resultHTML: toHitResultHTML }); if (hit) setTimeout(() => showNonBlockingRollToast({ title: damageTitle, resultHTML: damageResultHTML }), 2000); }
    });
    socket.on('monsterAttackAnimation', (data) => {
        const { monsterId, targetId, d20Roll, isCrit, isFumble, totalRollToHit, requiredRoll, hit, damageDice, rawDamageRoll, attackBonus, totalDamage } = data; const targetPlayerEl = get(`player-${targetId}`); playEffectAnimation(targetPlayerEl, hit ? 'hit' : 'miss'); const monster = currentRoomState.gameState.board.monsters.find(m => m.id === monsterId); const monsterName = monster?.name || 'Monster'; const toHitResultHTML = `${isCrit ? `<p class="result-line hit">CRITICAL HIT!</p>` : isFumble ? `<p class="result-line miss">FUMBLE!</p>` : hit ? `<p class="result-line hit">HIT!</p>` : `<p class="result-line miss">MISS!</p>`}<p class="roll-details">Roll: ${d20Roll} + ${attackBonus} (Bonus) = <strong>${totalRollToHit}</strong> vs DC ${requiredRoll}</p>`; showNonBlockingRollToast({ title: `${monsterName} Attacks!`, resultHTML: toHitResultHTML }); if (hit) { const damageResultHTML = `<p class="result-line">DAMAGE!</p><p class="roll-details">Roll: ${rawDamageRoll} (Dice) = <strong>${totalDamage}</strong></p>`; setTimeout(() => showNonBlockingRollToast({ title: 'Damage Roll', resultHTML: damageResultHTML }), 2000); }
    });
    socket.on('eventRollResult', ({ roll, outcome }) => { const resultHTML = `<p class="result-line">${roll}</p><p>${outcome.message}</p>`; const continueCallback = () => { diceRollOverlay.classList.add('hidden'); finishModal(); if (outcome.type === 'playerEvent') { addToModalQueue(() => { eventOverlay.classList.remove('hidden'); eventTitle.textContent = 'A player event occurs!'; eventPrompt.textContent = 'Choose one:'; eventCardSelection.classList.remove('hidden'); eventRollBtn.classList.add('hidden'); eventCardSelection.innerHTML = ''; outcome.options.forEach(card => { const cardEl = createCardElement(card); cardEl.onclick = () => { socket.emit('selectEventCard', { cardId: card.id }); eventOverlay.classList.add('hidden'); finishModal(); }; eventCardSelection.appendChild(cardEl); }); }, `event-result-${roll}`); } }; const spinnerValue = diceSpinner.querySelector('.spinner-value'); diceAnimationContainer.style.height = '200px'; diceSpinner.classList.remove('hidden'); let counter = 0; const interval = setInterval(() => { spinnerValue.textContent = Math.floor(Math.random() * 20) + 1; counter += 50; if (counter >= 1500) { clearInterval(interval); spinnerValue.textContent = roll; setTimeout(() => { diceSpinner.classList.add('hidden'); diceAnimationContainer.style.height = '0px'; diceRollResult.innerHTML = resultHTML; diceRollResult.classList.remove('hidden'); diceRollContinueBtn.classList.remove('hidden'); diceRollContinueBtn.onclick = continueCallback; }, 500); } }, 50); });

    // --- 6. VOICE CHAT (WebRTC) LOGIC ---
    function updateVoiceButtons() { const isMuted = localStream ? !localStream.getAudioTracks()[0].enabled : false; joinVoiceBtn.classList.toggle('hidden', isVoiceConnected); muteVoiceBtn.classList.toggle('hidden', !isVoiceConnected); disconnectVoiceBtn.classList.toggle('hidden', !isVoiceConnected); if (isVoiceConnected) { muteVoiceBtn.innerHTML = isMuted ? `<span class="material-symbols-outlined">mic</span>Unmute` : `<span class="material-symbols-outlined">mic_off</span>Mute`; } mobileJoinVoiceBtn.classList.toggle('hidden', isVoiceConnected); mobileMuteVoiceBtn.classList.toggle('hidden', !isVoiceConnected); mobileDisconnectVoiceBtn.classList.toggle('hidden', !isVoiceConnected); if (isVoiceConnected) { mobileMuteVoiceBtn.innerHTML = isMuted ? `<span class="material-symbols-outlined">mic</span>` : `<span class="material-symbols-outlined">mic_off</span>`; } }
    async function joinVoice() { try { if (!localStream) { localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false }); } const audio = document.createElement('audio'); audio.srcObject = localStream; audio.muted = true; audio.play(); isVoiceConnected = true; updateVoiceButtons(); socket.emit('join-voice'); } catch (err) { console.error("Error accessing microphone:", err); showInfoToast("Could not access microphone.", 'error'); } }
    function disconnectVoice() { if (!localStream) return; socket.emit('leave-voice'); localStream.getTracks().forEach(track => track.stop()); localStream = null; for (const peerId in peerConnections) { if (peerConnections[peerId]) { peerConnections[peerId].close(); } delete peerConnections[peerId]; } isVoiceConnected = false; updateVoiceButtons(); }
    const createPeerConnection = (peerId) => { const pc = new RTCPeerConnection(iceServers); peerConnections[peerId] = pc; localStream.getTracks().forEach(track => pc.addTrack(track, localStream)); pc.ontrack = event => { const audio = document.createElement('audio'); audio.srcObject = event.streams[0]; audio.play(); }; pc.onicecandidate = event => { if (event.candidate) { socket.emit('voice-ice-candidate', { candidate: event.candidate, toId: peerId }); } }; return pc; };
    socket.on('voice-peers', (peers) => { peers.forEach(async peerId => { const pc = createPeerConnection(peerId); const offer = await pc.createOffer(); await pc.setLocalDescription(offer); socket.emit('voice-offer', { offer, toId: peerId }); }); });
    socket.on('voice-peer-join', async ({ peerId }) => { const pc = createPeerConnection(peerId); const offer = await pc.createOffer(); await pc.setLocalDescription(offer); socket.emit('voice-offer', { offer, toId: peerId }); });
    socket.on('voice-offer', async ({ offer, fromId }) => { const pc = createPeerConnection(fromId); await pc.setRemoteDescription(new RTCSessionDescription(offer)); const answer = await pc.createAnswer(); await pc.setLocalDescription(answer); socket.emit('voice-answer', { answer, toId: fromId }); });
    socket.on('voice-answer', async ({ answer, fromId }) => { const pc = peerConnections[fromId]; if (pc) { await pc.setRemoteDescription(new RTCSessionDescription(answer)); } });
    socket.on('voice-ice-candidate', async ({ candidate, fromId }) => { const pc = peerConnections[fromId]; if (pc) { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } });
    socket.on('voice-peer-disconnect', ({ peerId }) => { if (peerConnections[peerId]) { peerConnections[peerId].close(); delete peerConnections[peerId]; } });

    // --- 7. DICE SPINNER & ANIMATION LOGIC ---
    function toggleMenu(menu, button) { const isHidden = menu.classList.toggle('hidden'); button.innerHTML = isHidden ? `<span class="material-symbols-outlined">menu</span>` : `<span class="material-symbols-outlined">close</span>`; }
    function showNonBlockingRollToast(data) { toastContainer.innerHTML = ''; const toast = document.createElement('div'); toast.className = 'toast-roll-overlay'; const closeBtn = document.createElement('button'); closeBtn.innerHTML = '&times;'; closeBtn.className = 'toast-roll-close'; closeBtn.setAttribute('aria-label', 'Close roll result'); closeBtn.onclick = () => { toast.classList.remove('visible'); setTimeout(() => toast.remove(), 300); }; toast.innerHTML = `<div class="toast-roll-content"><h2 class="panel-header">${data.title}</h2><div class="dice-roll-result-container">${data.resultHTML}</div></div>`; toast.querySelector('.toast-roll-content').prepend(closeBtn); toastContainer.appendChild(toast); requestAnimationFrame(() => toast.classList.add('visible')); setTimeout(() => { if (toast.parentElement) { toast.classList.remove('visible'); setTimeout(() => toast.remove(), 300); } }, 7000); }
    function showDiceRoll(options) { const { dieType, roll, title, resultHTML, continueCallback } = options; addToModalQueue(() => { diceRollTitle.textContent = title; diceRollResult.classList.add('hidden'); diceRollContinueBtn.classList.add('hidden'); diceAnimationContainer.style.height = '200px'; diceSpinner.classList.remove('hidden'); diceRollOverlay.classList.remove('hidden'); const spinnerValue = diceSpinner.querySelector('.spinner-value'); const max = parseInt(dieType.slice(1), 10); let counter = 0; const interval = setInterval(() => { spinnerValue.textContent = Math.floor(Math.random() * max) + 1; counter += 50; if (counter >= 1500) { clearInterval(interval); spinnerValue.textContent = roll; setTimeout(() => { diceSpinner.classList.add('hidden'); diceAnimationContainer.style.height = '0px'; diceRollResult.innerHTML = resultHTML; diceRollResult.classList.remove('hidden'); diceRollContinueBtn.classList.remove('hidden'); diceRollContinueBtn.onclick = () => { diceRollOverlay.classList.add('hidden'); if (continueCallback) continueCallback(); finishModal(); }; }, 500); } }, 50); }, `dice-roll-${Math.random()}`); }
    function playEffectAnimation(targetElement, effectType) { if (!targetElement) return; const effectEl = document.createElement('div'); effectEl.className = `effect-animation ${effectType}-effect`; const rect = targetElement.getBoundingClientRect(); effectEl.style.top = `${rect.top + rect.height / 2}px`; effectEl.style.left = `${rect.left + rect.width / 2}px`; animationOverlay.appendChild(effectEl); setTimeout(() => effectEl.remove(), 1000); }
    
    // --- 4. UI EVENT LISTENERS ---
    [actionEndTurnBtn, mobileActionEndTurnBtn].forEach(btn => btn.addEventListener('click', () => addToModalQueue(() => endTurnConfirmModal.classList.remove('hidden'), 'end-turn-confirm')));
    [actionGuardBtn, mobileActionGuardBtn].forEach(btn => btn.addEventListener('click', () => socket.emit('playerAction', { action: 'guard' })));
    [actionBriefRespiteBtn, mobileActionBriefRespiteBtn].forEach(btn => btn.addEventListener('click', () => socket.emit('playerAction', { action: 'briefRespite' })));
    [actionFullRestBtn, mobileActionFullRestBtn].forEach(btn => btn.addEventListener('click', () => socket.emit('playerAction', { action: 'fullRest' })));
    dmPlayMonsterBtn.addEventListener('click', () => socket.emit('dmAction', { action: 'playMonster' }));

    mobileBottomNav.addEventListener('click', (e) => { const navBtn = e.target.closest('.nav-btn'); if (!navBtn || !navBtn.dataset.screen) return; mobileBottomNav.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active')); navBtn.classList.add('active'); navBtn.classList.remove('highlight'); const screenId = `mobile-screen-${navBtn.dataset.screen}`; document.querySelectorAll('.mobile-screen').forEach(screen => screen.classList.remove('active')); get(screenId).classList.add('active'); });
    desktopTabButtons.forEach(button => { button.addEventListener('click', () => { desktopTabButtons.forEach(btn => btn.classList.remove('active')); button.classList.add('active'); button.classList.remove('highlight'); document.querySelectorAll('.game-area-desktop .tab-content').forEach(content => content.classList.remove('active')); get(button.dataset.tab).classList.add('active'); }); });

    chatToggleBtn.addEventListener('click', () => { chatOverlay.classList.toggle('hidden'); menuDropdown.classList.add('hidden'); menuToggleBtn.innerHTML = `<span class="material-symbols-outlined">menu</span>`; });
    chatCloseBtn.addEventListener('click', () => chatOverlay.classList.add('hidden'));
    chatForm.addEventListener('submit', (e) => { e.preventDefault(); const message = chatInput.value.trim(); if (message) { socket.emit('sendMessage', { channel: chatChannel.value, message }); chatInput.value = ''; } });
    mobileChatForm.addEventListener('submit', (e) => { e.preventDefault(); const message = mobileChatInput.value.trim(); if (message) { socket.emit('sendMessage', { channel: mobileChatChannel.value, message }); mobileChatInput.value = ''; } });
    [leaveGameBtn, mobileLeaveGameBtn].forEach(btn => btn.addEventListener('click', () => { if (confirm("Are you sure?")) window.location.reload(); }));
    endTurnConfirmBtn.addEventListener('click', () => { socket.emit('endTurn'); endTurnConfirmModal.classList.add('hidden'); finishModal(); });
    endTurnCancelBtn.addEventListener('click', () => { endTurnConfirmModal.classList.add('hidden'); finishModal(); });
    narrativeConfirmBtn.addEventListener('click', () => { let narrativeText = narrativeInput.value.trim(); if (narrativeText === "") narrativeText = generate_random_attack_description(); if (pendingActionData) { socket.emit('playerAction', { ...pendingActionData, narrative: narrativeText }); closeNarrativeModal(); } });
    narrativeCancelBtn.addEventListener('click', closeNarrativeModal);
    eventRollBtn.onclick = () => { socket.emit('rollForEvent'); eventPrompt.textContent = "Rolling..."; eventRollBtn.disabled = true; };
    
    [helpBtn, mobileHelpBtn].forEach(btn => btn.addEventListener('click', () => { get('help-content').innerHTML = `<h3>Core Mechanics</h3><p><strong>Action Points (AP):</strong> Your primary resource for taking actions on your turn.</p><p><strong>Health (HP):</strong> Your life force. If it reaches 0, you spend a Life to get back up.</p><h3>Actions</h3><p><strong>Attack:</strong> Click your weapon, then a monster.</p><p><strong>Guard:</strong> Add temporary Shield HP.</p><p><strong>Rest:</strong> Spend Health Dice to heal.</p>`; helpModal.classList.remove('hidden'); }));
    get('help-close-btn').addEventListener('click', () => get('help-modal').classList.add('hidden'));

    [joinVoiceBtn, mobileJoinVoiceBtn].forEach(btn => btn.addEventListener('click', joinVoice));
    [disconnectVoiceBtn, mobileDisconnectVoiceBtn].forEach(btn => btn.addEventListener('click', disconnectVoice));
    [muteVoiceBtn, mobileMuteVoiceBtn].forEach(btn => btn.addEventListener('click', () => { if (localStream) { const a = localStream.getAudioTracks()[0]; a.enabled = !a.enabled; updateVoiceButtons(); } }));
    
    menuToggleBtn.addEventListener('click', () => toggleMenu(menuDropdown, menuToggleBtn));
    mobileMenuToggleBtn.addEventListener('click', () => toggleMenu(mobileMenuDropdown, mobileMenuToggleBtn));
    document.addEventListener('click', (e) => { if (!e.target.closest('.header-menu')) { menuDropdown.classList.add('hidden'); mobileMenuDropdown.classList.add('hidden'); menuToggleBtn.innerHTML = `<span class="material-symbols-outlined">menu</span>`; mobileMenuToggleBtn.innerHTML = `<span class="material-symbols-outlined">menu</span>`; } });

    // --- 9. INITIALIZATION ---
    initializeMenu();
});

if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js')
        .then(reg => console.log('SW registered', reg))
        .catch(err => console.error('SW registration failed:', err));
}
