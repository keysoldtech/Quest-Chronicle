// REFACTORED: Quest & Chronicle Client-Side Logic (v7.0.0)
// This file has been refactored for stability, maintainability, and clarity.
// The core unidirectional data flow model remains, but with significant code cleanup.

// --- 1. GLOBAL SETUP & STATE ---
const socket = io();
let myId = '';
let myPlayerName = '';
let currentRoomState = {}; // The single, authoritative copy of the game state.
let gameUIInitialized = false; // Flag to ensure game listeners are only attached once.

// Consolidated client-side state to prevent bugs from scattered global variables.
const clientState = {
    selectedGameMode: null, // For the menu screen
    selectedWeaponId: null, // For targeting UI
    selectedHandCardId: null, // For mobile card selection
    currentRollData: null,  // Holds data for an active roll modal
    activeItem: null,       // For modals needing item context (e.g., claiming loot)
    diceAnimationInterval: null,
    rollModalCloseTimeout: null,
    rollResponseTimeout: null,
    helpModalPage: 0,
    isFirstTurnTutorialActive: false,
    hasSeenSkillChallengePrompt: false, // Prevents re-opening the modal
    lastLogLength: 0, // For tracking new log entries for toasts
};

// --- HELPERS ---
const get = (id) => document.getElementById(id);
const queryAll = (selector) => document.querySelectorAll(selector);

// --- VOICE CHAT MANAGER ---
const voiceChatManager = {
    localStream: null,
    peers: {}, // { socketId: RTCPeerConnection }
    audioContainer: null,

    async join() {
        if (this.localStream) return;
        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            get('join-voice-btn').classList.add('hidden');
            get('mobile-join-voice-btn').classList.add('hidden');
            get('mute-voice-btn').classList.remove('hidden');
            get('leave-voice-btn').classList.remove('hidden');
            get('mobile-mute-voice-btn').classList.remove('hidden');
            get('mobile-leave-voice-btn').classList.remove('hidden');

            this.audioContainer = get('voice-chat-audio-container');
            socket.emit('join-voice-chat');
        } catch (err) {
            showToast('Microphone access denied.', 'error');
            console.error('Error accessing microphone:', err);
        }
    },

    leave() {
        if (!this.localStream) return;
        socket.emit('leave-voice-chat');

        this.localStream.getTracks().forEach(track => track.stop());
        this.localStream = null;

        for (const peerId in this.peers) {
            this.peers[peerId].close();
        }
        this.peers = {};
        if (this.audioContainer) this.audioContainer.innerHTML = '';

        get('join-voice-btn').classList.remove('hidden');
        get('mobile-join-voice-btn').classList.remove('hidden');
        get('mute-voice-btn').classList.add('hidden');
        get('leave-voice-btn').classList.add('hidden');
        get('mobile-mute-voice-btn').classList.add('hidden');
        get('mobile-leave-voice-btn').classList.add('hidden');
    },

    toggleMute() {
        if (!this.localStream) return;
        const enabled = !this.localStream.getAudioTracks()[0].enabled;
        this.localStream.getAudioTracks()[0].enabled = enabled;
        const muteBtn = get('mute-voice-btn');
        const mobileMuteBtn = get('mobile-mute-voice-btn');
        muteBtn.innerHTML = enabled ? `<span class="material-symbols-outlined">mic_off</span>Mute` : `<span class="material-symbols-outlined">mic</span>Unmute`;
        mobileMuteBtn.innerHTML = enabled ? `<span class="material-symbols-outlined">mic_off</span>Mute` : `<span class="material-symbols-outlined">mic</span>Unmute`;
    },

    addPeer(peerId, isInitiator) {
        if (this.peers[peerId]) return;
        const peer = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        });
        this.peers[peerId] = peer;

        this.localStream.getTracks().forEach(track => {
            peer.addTrack(track, this.localStream);
        });

        peer.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit('webrtc-signal', { to: peerId, signal: { candidate: event.candidate } });
            }
        };

        peer.ontrack = (event) => {
            let audioEl = get(`audio-${peerId}`);
            if (!audioEl) {
                audioEl = document.createElement('audio');
                audioEl.id = `audio-${peerId}`;
                audioEl.autoplay = true;
                this.audioContainer.appendChild(audioEl);
            }
            audioEl.srcObject = event.streams[0];
        };

        if (isInitiator) {
            peer.onnegotiationneeded = async () => {
                try {
                    const offer = await peer.createOffer();
                    await peer.setLocalDescription(offer);
                    socket.emit('webrtc-signal', { to: peerId, signal: { sdp: peer.localDescription } });
                } catch (err) { console.error('Error creating offer:', err); }
            };
        }
    },

    removePeer(peerId) {
        if (this.peers[peerId]) {
            this.peers[peerId].close();
            delete this.peers[peerId];
        }
        const audioEl = get(`audio-${peerId}`);
        if (audioEl) audioEl.remove();
    },

    async handleSignal({ from, signal }) {
        let peer = this.peers[from];
        if (!peer) {
            this.addPeer(from, false);
            peer = this.peers[from];
        }
        
        try {
            if (signal.sdp) {
                await peer.setRemoteDescription(new RTCSessionDescription(signal.sdp));
                if (signal.sdp.type === 'offer') {
                    const answer = await peer.createAnswer();
                    await peer.setLocalDescription(answer);
                    socket.emit('webrtc-signal', { to: from, signal: { sdp: peer.localDescription } });
                }
            } else if (signal.candidate) {
                await peer.addIceCandidate(new RTCIceCandidate(signal.candidate));
            }
        } catch (err) {
            console.error('Error handling signal:', err);
        }
    }
};


// --- 2. CORE RENDERING ENGINE ---

/**
 * Checks if the current viewport is considered desktop size.
 * @returns {boolean} True if the window width is 1024px or greater.
 */
function isDesktop() {
    return window.innerWidth >= 1024;
}

/**
 * Creates a single action button for a card, with separate icon and text elements.
 * @param {string} action - The action name (e.g., 'equip', 'discardCard').
 * @param {string} text - The text to display on the button on desktop.
 * @param {string} btnClass - Additional CSS classes for the button.
 * @returns {HTMLElement} The button element.
 */
function createActionButton(action, text, btnClass) {
    const actionIconMap = {
        equip: 'checkroom',
        useConsumable: 'science',
        castSpell: 'auto_awesome',
        claimLoot: 'redeem',
        interact: 'touch_app',
        discardCard: 'delete'
    };

    const btn = document.createElement('button');
    btn.className = `btn btn-xs ${btnClass}`;
    btn.dataset.action = action;
    
    const iconHTML = `<span class="material-symbols-outlined">${actionIconMap[action] || 'touch_app'}</span>`;
    const textHTML = `<span class="btn-text">${text}</span>`;
    
    btn.innerHTML = iconHTML + textHTML;
    return btn;
}


/**
 * Creates an HTML element for a game card with interactive options.
 * @param {object} card - The card data object.
 * @param {object} options - Configuration for card interactivity.
 * @returns {HTMLElement} The fully constructed card element.
 */
function createCardElement(card, options = {}) {
    if (!card) { // Gracefully handle null/undefined card data
        const emptyCardDiv = document.createElement('div');
        emptyCardDiv.className = 'card empty';
        emptyCardDiv.innerHTML = `<div class="card-content"><p class="empty-slot-text">Nothing Equipped</p></div>`;
        return emptyCardDiv;
    }

    const { isEquippable = false, isAttackable = false, isTargetable = false, isDiscardable = false, isConsumable = false, isClaimable = false, isInteractable = false, isCastable = false } = options;
    const cardDiv = document.createElement('div');
    cardDiv.className = 'card';
    cardDiv.dataset.cardId = card.id;

    if (card.rarity) {
        cardDiv.classList.add(`rarity-${card.rarity.toLowerCase()}`);
    }

    if (card.type === 'Spell' && card.level) {
        cardDiv.classList.add(`spell-level-${card.level}`);
    }

    if (card.type === 'Monster') {
        cardDiv.dataset.monsterId = card.id;
        if (isTargetable) cardDiv.classList.add('targetable');
    }
    if (isAttackable) {
        cardDiv.classList.add('attackable-weapon');
        if (card.id === clientState.selectedWeaponId) cardDiv.classList.add('selected-weapon');
    }

    const typeInfo = card.category && card.category !== 'General' ? `${card.type} / ${card.category}` : card.type;
    const monsterHpHTML = card.type === 'Monster' ? `<div class="monster-hp">HP: ${card.currentHp}/${card.maxHp}</div>` : '';
    const monsterStatsHTML = card.type === 'Monster' ? `
        <div class="card-bonus" title="Attack Bonus"><span class="material-symbols-outlined icon-damage">colorize</span>+${card.attackBonus || 0}</div>
        <div class="card-bonus" title="Armor Class"><span class="material-symbols-outlined icon-shield">security</span>${card.requiredRollToHit || 10}</div>
    ` : '';
    const damageDiceHTML = card.effect?.dice ? `<div class="card-bonus" title="Damage Dice"><span class="material-symbols-outlined icon-damage">casino</span>${card.effect.dice}</div>` : '';
    const apCostHTML = card.apCost ? `<div class="card-bonus" title="AP Cost"><span class="material-symbols-outlined icon-ap">bolt</span>${card.apCost}</div>` : '';
    
    let monsterAbilitiesHTML = '';
    if (card.type === 'Monster' && card.abilities && card.abilities.length > 0) {
        monsterAbilitiesHTML = `
            <div class="card-abilities">
                ${card.abilities.map(ability => `
                    <div class="card-ability-item">
                        <strong>${ability.name}:</strong> ${ability.description}
                    </div>
                `).join('')}
            </div>
        `;
    }

    const bonuses = card.effect?.bonuses;
    let bonusesHTML = '';
    if (bonuses) {
        const bonusIconMap = {
            ap: { icon: 'bolt', color: 'ap' }, 
            damageBonus: { icon: 'swords', color: 'damage' }, 
            shieldBonus: { icon: 'security', color: 'shield' }, 
            maxHp: { icon: 'favorite', color: 'hp' },
            hitBonus: { icon: 'colorize', color: 'int' },
            str: { icon: 'fitness_center', color: 'str' }, 
            dex: { icon: 'sprint', color: 'dex' }, 
            con: { icon: 'shield_person', color: 'con' },
            int: { icon: 'school', color: 'int' },
            wis: { icon: 'self_improvement', color: 'wis' }, 
            cha: { icon: 'star', color: 'cha' }
        };
        bonusesHTML = Object.entries(bonuses).map(([key, value]) => {
            if (value === 0) return '';
            const mapEntry = bonusIconMap[key];
            if (!mapEntry) return '';
            const sign = value > 0 ? '+' : '';
            return `<div class="card-bonus" title="${key}"><span class="material-symbols-outlined icon-${mapEntry.color}">${mapEntry.icon}</span>${sign}${value}</div>`;
        }).join('');
    }

    cardDiv.innerHTML = `
        <div class="card-header">
             <h3 class="card-title">${card.name}</h3>
             ${monsterHpHTML}
        </div>
        <div class="card-content">
            <p class="card-effect">${card.effect?.description || card.description || ''}</p>
            ${monsterAbilitiesHTML}
        </div>
        <div class="card-footer">
            <div class="card-bonuses-grid">
                ${monsterStatsHTML}
                ${damageDiceHTML}
                ${bonusesHTML}
                ${apCostHTML}
            </div>
            <p class="card-type">${typeInfo}</p>
        </div>
    `;

    // Add info button to inspect the card
    const infoBtn = document.createElement('button');
    infoBtn.className = 'card-info-btn';
    infoBtn.innerHTML = `<span class="material-symbols-outlined">info</span>`;
    cardDiv.appendChild(infoBtn);

    const actionContainer = document.createElement('div');
    actionContainer.className = 'card-action-buttons';

    if (isEquippable) {
        actionContainer.appendChild(createActionButton('equip', 'Equip (1AP)', 'btn-success'));
    }
    if (isConsumable) {
        actionContainer.appendChild(createActionButton('useConsumable', 'Use', 'btn-special'));
    }
    if (isCastable) {
        actionContainer.appendChild(createActionButton('castSpell', `Cast (${card.apCost}AP)`, 'btn-special'));
    }
    if (isClaimable) {
        actionContainer.appendChild(createActionButton('claimLoot', 'Claim', 'btn-primary'));
    }
    if (isInteractable && card.skillInteractions) {
        card.skillInteractions.forEach(interaction => {
            const btn = createActionButton('interact', `${interaction.name} (${interaction.apCost} AP)`, 'btn-interaction');
            btn.dataset.interactionName = interaction.name;
            actionContainer.appendChild(btn);
        });
    }
    if (isDiscardable) {
        actionContainer.appendChild(createActionButton('discardCard', 'Discard', 'btn-danger'));
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
        if (sessionStorage.getItem('qc_playerId')) {
            sessionStorage.removeItem('qc_roomId');
            sessionStorage.removeItem('qc_playerId');
            window.location.reload();
        }
        return;
    }

    const { players, gameState, chatLog, hostId } = currentRoomState;
    const { phase, isPaused, pauseReason } = gameState;
    
    // --- Toasts for new actions ---
    const newLogEntries = chatLog.slice(clientState.lastLogLength);
    newLogEntries.forEach(entry => {
        const isMyAction = entry.playerId === myId || entry.rollerId === myId;
        const isToastable = !['chat', 'narrative', 'system'].includes(entry.type);
        if (isToastable && !isMyAction) {
            showToast(entry.text, 'info');
        }
    });
    clientState.lastLogLength = chatLog.length;


    // Game Paused Overlay
    const pauseModal = get('game-paused-modal');
    if (isPaused) {
        get('game-paused-reason').textContent = pauseReason;
        pauseModal.classList.remove('hidden');
    } else {
        pauseModal.classList.add('hidden');
    }

    // --- Phase 1: Show/Hide Major Screens ---
    if (phase === 'class_selection' || phase === 'started' || phase === 'game_over') {
        get('menu-screen').classList.remove('active');
        get('game-screen').classList.add('active');
        if (!gameUIInitialized) {
            initializeGameUIListeners();
            gameUIInitialized = true;
        }
    } else { 
        get('menu-screen').classList.add('active');
        get('game-screen').classList.remove('active');
    }
    
    if (phase === 'game_over') {
        showGameOverModal(gameState.winner);
        return; // Stop rendering here for game over
    }

    // --- Phase 2: Render Common Game Elements ---
    queryAll('[data-container="room-code"]').forEach(el => el.textContent = currentRoomState.id);
    queryAll('[data-container="turn-counter"]').forEach(el => el.textContent = gameState.turnCount);
    renderGameLog(chatLog, phase === 'started');

    const playerListContainers = queryAll('[data-container="player-list"]');
    playerListContainers.forEach(c => c.innerHTML = '');
    const currentPlayerId = gameState.turnOrder[gameState.currentPlayerIndex];
    
    const playerArray = Object.values(players).sort((a,b) => {
        if (a.role === 'DM') return -1;
        if (b.role === 'DM') return 1;
        return a.name.localeCompare(b.name);
    });

    playerArray.forEach(p => {
        if (!p.role) return;
        const isCurrentTurn = p.id === currentPlayerId;
        const li = document.createElement('li');
        li.className = `player-list-item ${isCurrentTurn ? 'active' : ''} ${p.isDowned ? 'downed' : ''} ${p.role.toLowerCase()}`;
        const npcTag = p.isNpc ? '<span class="npc-tag">[NPC]</span> ' : '';
        const roleText = p.role === 'DM' ? `<span class="player-role dm">DM</span>` : '';
        let classText;
        if (phase === 'class_selection') {
            classText = p.class ? `<span class="player-class-ready"> - Ready!</span>` : `<span class="player-class-waiting"> - Choosing...</span>`;
        } else {
            classText = p.class ? `<span class="player-class"> - ${p.class}</span>` : '';
        }
        const hpDisplay = phase === 'started' && p.role === 'Explorer' ? `HP: ${p.stats.currentHp} / ${p.stats.maxHp}` : '';
        const downedText = p.isDowned ? '<span class="downed-text">[DOWNED]</span> ' : '';
        const disconnectedText = p.disconnected ? '<span class="disconnected-text">[OFFLINE]</span> ' : '';
        li.innerHTML = `<div class="player-info"><span>${disconnectedText}${downedText}${npcTag}${p.name}${classText}${roleText}</span></div><div class="player-hp">${hpDisplay}</div>`;
        playerListContainers.forEach(c => c.appendChild(li.cloneNode(true)));
    });
    
    if (isDesktop()) {
        const activePlayerListItem = document.querySelector('#player-list-display .player-list-item.active');
        if (activePlayerListItem) activePlayerListItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    // --- Phase 3: Phase-Specific Rendering ---
    const desktopCharacterPanel = get('character-sheet-block');
    const mobileCharacterPanel = get('mobile-screen-character');
    
    queryAll('[data-container="lobby-controls"]').forEach(c => c.classList.add('hidden'));

    if (phase === 'class_selection') {
        if (myPlayer.class) {
            let waitingHTML = `<h2 class="panel-header">Class Chosen!</h2><p class="panel-content">Waiting for the host to start the game...</p>`;
            
            if (myId === hostId) {
                const allReady = Object.values(players).filter(p => !p.isNpc).every(p => p.class);
                const disabledAttr = allReady ? '' : 'disabled';
                const buttonHTML = `<div class="lobby-controls-character-panel">
                    <button id="character-sheet-start-game-btn" class="btn btn-primary" ${disabledAttr}>Start Game</button>
                    ${!allReady ? '<p class="waiting-text">Waiting for other players to choose a class...</p>' : ''}
                </div>`;
                waitingHTML += buttonHTML;
            }

            desktopCharacterPanel.innerHTML = waitingHTML;
            mobileCharacterPanel.innerHTML = `<div class="panel mobile-panel">${waitingHTML}</div>`;
            get('class-selection-modal').classList.add('hidden');
        } else {
            renderClassSelection(desktopCharacterPanel, mobileCharacterPanel);
        }
    } else if (phase === 'started') {
        get('class-selection-modal').classList.add('hidden');
        renderGameplayState(myPlayer, gameState);
    }
    
    const skillChallengeIsActiveForMe = gameState.skillChallenge.isActive && gameState.turnOrder[gameState.currentPlayerIndex] === myId;
    const skillChallengeModal = get('skill-challenge-modal');

    if (skillChallengeIsActiveForMe && !clientState.hasSeenSkillChallengePrompt) {
        const details = gameState.skillChallenge.details;
        const stage = details.stages ? details.stages[gameState.skillChallenge.currentStage] : details;
        showSkillChallengeModal(stage, details.name);
        clientState.hasSeenSkillChallengePrompt = true;
    } else if (!skillChallengeIsActiveForMe && !skillChallengeModal.classList.contains('hidden')) {
        skillChallengeModal.classList.add('hidden');
    }
}

function createClassCardElement(id, data, forMobile = false) {
    const cardDiv = document.createElement('div');
    cardDiv.className = 'class-card';
    cardDiv.dataset.classId = id;

    const statsHTML = `
        <div class="class-stat-item" title="Health Points"><span class="material-symbols-outlined icon-hp">favorite</span> ${data.baseHp}</div>
        <div class="class-stat-item" title="Action Points"><span class="material-symbols-outlined icon-ap">bolt</span> ${data.baseAP}</div>
        <div class="class-stat-item" title="Damage Bonus"><span class="material-symbols-outlined icon-damage">swords</span> +${data.baseDamageBonus}</div>
        <div class="class-stat-item" title="Shield Bonus"><span class="material-symbols-outlined icon-shield">security</span> +${data.baseShieldBonus}</div>
    `;

    const buttonHTML = forMobile ? `<button class="select-class-btn btn btn-primary btn-sm" data-class-id="${id}">Select ${id}</button>` : '';

    cardDiv.innerHTML = `
        <div class="class-card-header">
            <h3>${id}</h3>
        </div>
        <div class="class-card-body">
            <div class="class-stats">
                ${statsHTML}
            </div>
            <div class="class-ability">
                <p><strong>${data.ability.name}</strong></p>
                <p class="ability-desc">${data.ability.description}</p>
            </div>
        </div>
        <div class="class-card-footer">
             ${buttonHTML}
        </div>
    `;
    return cardDiv;
}

function showClassSelectionModal() {
    const classData = currentRoomState.staticData.classes;
    const modal = get('class-selection-modal');
    const displayContainer = get('desktop-class-card-display');
    const confirmBtn = get('confirm-class-selection-btn');

    displayContainer.innerHTML = '';
    let selectedClassId = null;

    Object.entries(classData).forEach(([id, data]) => {
        const cardElement = createClassCardElement(id, data, false);
        cardElement.addEventListener('click', () => {
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
        mobileContainer.innerHTML = '';
        showClassSelectionModal();
    } else {
        const classData = currentRoomState.staticData.classes;
        const classSelectionHTML = `
            <h2 class="panel-header">Choose Your Class</h2>
            <div class="panel-content class-grid">
                ${Object.entries(classData).map(([id, data]) => createClassCardElement(id, data, true).outerHTML).join('')}
            </div>`;
        
        switchMobileScreen('character');
        desktopContainer.innerHTML = '';
        mobileContainer.innerHTML = `<div class="panel mobile-panel">${classSelectionHTML}</div>`;
    }
}


/**
 * Renders all elements related to the active gameplay loop.
 */
function renderGameplayState(myPlayer, gameState) {
    const isMyTurn = gameState.turnOrder[gameState.currentPlayerIndex] === myPlayer.id && !myPlayer.isDowned;

    renderPartyHope(gameState.partyHope);

    const playerResources = queryAll('[data-container="player-resources"]');
    if (myPlayer.stats.maxHp > 0) {
        const healthPercent = myPlayer.stats.maxHp > 0 ? (myPlayer.stats.currentHp / myPlayer.stats.maxHp) * 100 : 0;
        queryAll('[data-container="player-health-bar"]').forEach(el => el.style.width = `${healthPercent}%`);
        queryAll('[data-container="player-health-text"]').forEach(el => el.textContent = `${myPlayer.stats.currentHp} / ${myPlayer.stats.maxHp}`);

        const apPercent = myPlayer.stats.maxAP > 0 ? (myPlayer.currentAp / myPlayer.stats.maxAP) * 100 : 0;
        queryAll('[data-container="player-ap-bar"]').forEach(el => el.style.width = `${apPercent}%`);
        queryAll('[data-container="player-ap-text"]').forEach(el => el.textContent = `${myPlayer.currentAp} / ${myPlayer.stats.maxAP}`);
        
        playerResources.forEach(el => el.classList.remove('hidden'));
    } else {
        playerResources.forEach(el => el.classList.add('hidden'));
    }

    const turnPlayer = currentRoomState.players[gameState.turnOrder[gameState.currentPlayerIndex]];
    const turnText = turnPlayer ? `${turnPlayer.name}'s Turn` : "Loading...";
    queryAll('[data-container="turn-indicator"]').forEach(el => el.textContent = turnText);
    
    queryAll('[data-container="action-bar"]').forEach(el => el.classList.toggle('hidden', !isMyTurn));
    queryAll('[data-container="action-skill-challenge-btn"]').forEach(el => el.classList.toggle('hidden', !gameState.skillChallenge.isActive));
    
    const boardContainers = queryAll('[data-container="board-cards"]');
    boardContainers.forEach(c => c.innerHTML = '');
    [...gameState.board.monsters, ...gameState.board.environment].forEach(card => {
        const isInteractable = isMyTurn && (card.type === 'Monster' || card.type === 'Environmental');
        const cardEl = createCardElement(card, { isTargetable: isMyTurn, isInteractable });
        boardContainers.forEach(container => container.appendChild(cardEl.cloneNode(true)));
    });

    const worldEventBanners = queryAll('[data-container="world-event-display"]');
    const event = gameState.worldEvents.currentEvent;
    if (event) {
        const eventDesc = event.stages ? event.stages[gameState.skillChallenge.currentStage]?.description : event.description;
        const bannerHTML = `
            <span class="material-symbols-outlined">public</span>
            <div class="world-event-text">
                <strong>${event.name}</strong>
                <span>${eventDesc || ''}</span>
            </div>
            <span class="world-event-duration">Rounds Left: ${gameState.worldEvents.duration}</span>
        `;
        worldEventBanners.forEach(banner => {
            banner.innerHTML = bannerHTML;
            banner.classList.remove('hidden');
        });
    } else {
        worldEventBanners.forEach(banner => banner.classList.add('hidden'));
    }

    renderCharacterPanel(get('character-sheet-block'), get('mobile-screen-character'), myPlayer, isMyTurn);

    const lootContainers = queryAll('[data-container="party-loot"]');
    lootContainers.forEach(c => c.innerHTML = '');
    if (gameState.lootPool && gameState.lootPool.length > 0) {
        gameState.lootPool.forEach(lootItem => {
            const lootEl = createCardElement(lootItem, { isClaimable: true });
            lootContainers.forEach(container => container.appendChild(lootEl.cloneNode(true)));
        });
    } else {
         lootContainers.forEach(container => container.innerHTML = `<p class="empty-pool-text">No discoveries yet.</p>`);
    }

    renderHandAndEquipment(myPlayer, isMyTurn);
}

function renderPartyHope(hope) {
    const hopePercent = (hope / 10) * 100;
    let hopeLabel = 'Neutral';
    let hopeClass = 'neutral';

    if (hope <= 2) { hopeLabel = 'Despairing (-1 Hit)'; hopeClass = 'despairing'; }
    else if (hope <= 4) { hopeLabel = 'Struggling'; hopeClass = 'struggling'; }
    else if (hope >= 9) { hopeLabel = 'Inspired (+1 Hit)'; hopeClass = 'inspired'; }
    else if (hope >= 7) { hopeLabel = 'Hopeful'; hopeClass = 'hopeful'; }

    queryAll('[data-container="party-hope-meter"]').forEach(container => {
        container.className = container.className.replace(/despairing|struggling|neutral|hopeful|inspired/g, '').trim() + ` ${hopeClass}`;
        container.classList.remove('hidden');
    });

    queryAll('[data-container="party-hope-bar"]').forEach(el => el.style.width = `${hopePercent}%`);
    // Desktop and mobile have slightly different text formats
    get('party-hope-text-desktop').textContent = `${hopeLabel} ${hope}/10`;
    get('party-hope-text-mobile').textContent = `${hope}/10`;
}

function renderCharacterPanel(desktopContainer, mobileContainer, player, isMyTurn) {
    const { stats, class: className, baseStats, statBonuses } = player;
    if (!baseStats || !statBonuses) return;
    const classData = currentRoomState.staticData.classes[className];

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
                 ${renderStatLine('Hit Bonus', 'colorize', 'int', (baseStats.hitBonus || 0) + (player.statBonuses.hitBonus || 0) , stats.hitBonus - ((baseStats.hitBonus || 0) + (player.statBonuses.hitBonus || 0)), true)}
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
    const handContainers = queryAll('[data-container="player-hand"]');
    const equippedContainers = queryAll('[data-container="equipped-items"]');
    
    handContainers.forEach(c => c.innerHTML = '');
    equippedContainers.forEach(c => c.innerHTML = '');

    player.hand.forEach(card => {
        const isEquippable = (card.type === 'Weapon' || card.type === 'Armor') && isMyTurn;
        // BUG FIX: Broaden the check for usable items to include more types.
        const isConsumable = (card.type === 'Consumable' || card.type === 'Potion' || card.type === 'Scroll') && card.apCost > 0 && isMyTurn;
        const isCastable = card.type === 'Spell' && isMyTurn;
        const cardEl = createCardElement(card, { isEquippable, isConsumable, isCastable, isDiscardable: isMyTurn });
        
        // Add selection class for mobile UI
        if (card.id === clientState.selectedHandCardId) {
            cardEl.classList.add('is-selected');
        }

        handContainers.forEach(container => container.appendChild(cardEl.cloneNode(true)));
    });

    Object.values(player.equipment).forEach(item => {
        if (item) {
            const isAttackable = item.type.toLowerCase() === 'weapon' && isMyTurn;
            const cardEl = createCardElement(item, { isAttackable });
            equippedContainers.forEach(container => container.appendChild(cardEl.cloneNode(true)));
        }
    });

    if (isMyTurn) {
        const unarmed = { id: 'unarmed', name: 'Unarmed Strike', type: 'Weapon', apCost: 1, effect: { dice: '1d4' } };
        const cardEl = createCardElement(unarmed, { isAttackable: true });
        equippedContainers.forEach(container => container.appendChild(cardEl.cloneNode(true)));
    }
}


function renderGameLog(log, gameStarted) {
    const logContainers = queryAll('[data-container="game-log"]');
    logContainers.forEach(container => {
        if (!container) return;

        const shouldScroll = Math.abs(container.scrollHeight - container.clientHeight - container.scrollTop) < 5;

        const logHTML = log.map(entry => {
            const time = new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const timeSpan = gameStarted ? `<span class="log-timestamp">${time}</span>` : '';
            
            let icon = 'info';
            let contentHTML = '';
            let attributedTo = entry.playerName || entry.rollerName || '';

            switch (entry.type) {
                case 'chat':
                    icon = 'chat';
                    const senderClass = entry.playerId === myId ? 'self' : '';
                    contentHTML = `<div class="log-sender ${senderClass}">${entry.playerName}:</div> <div class="log-text">${entry.text}</div>`;
                    if (entry.channel === 'party' && entry.playerId !== myId) {
                        showChatPreview(entry.playerName, entry.text);
                    }
                    break;
                case 'narrative':
                    icon = 'auto_stories';
                    contentHTML = `<div class="log-text narrative">"${entry.text}"</div>`;
                    break;
                case 'combat':
                case 'combat-hit':
                    icon = 'swords';
                    contentHTML = `<div class="log-text">${entry.text}</div>`;
                    break;
                case 'system-good':
                case 'action-good':
                    icon = 'star';
                    contentHTML = `<div class="log-text">${entry.text}</div>`;
                    break;
                 case 'system-bad':
                    icon = 'warning';
                    contentHTML = `<div class="log-text">${entry.text}</div>`;
                    break;
                default: // system, dm, action
                    icon = 'info';
                    contentHTML = `<div class="log-text">${entry.text}</div>`;
                    break;
            }

            const attributionSpan = attributedTo ? `<span class="log-attribution">${attributedTo}</span>` : '';
            
            return `<div class="log-entry ${entry.type}">
                        <div class="log-meta">
                            ${timeSpan}
                            ${attributionSpan}
                        </div>
                        <div class="log-content">
                            <span class="material-symbols-outlined log-icon">${icon}</span>
                            ${contentHTML}
                        </div>
                    </div>`;
        }).join('');

        container.innerHTML = logHTML;
        if (shouldScroll) container.scrollTop = container.scrollHeight;
    });
}


// --- 3. UI INITIALIZATION & EVENT LISTENERS ---
function initializeUI() {
    const playerNameInput = get('player-name-input');
    const roomCodeInput = get('room-code-input');
    const createBtn = get('create-room-btn');
    const joinBtn = get('join-room-btn');

    function validateMenu() {
        const hasName = playerNameInput.value.trim().length > 0;
        const hasMode = clientState.selectedGameMode !== null;
        createBtn.disabled = !hasName || !hasMode;
        joinBtn.disabled = !hasName || roomCodeInput.value.trim().length !== 4;
    }

    playerNameInput.addEventListener('input', validateMenu);
    roomCodeInput.addEventListener('input', validateMenu);
    
    document.querySelectorAll('.mode-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            clientState.selectedGameMode = btn.dataset.mode;
            get('custom-settings').classList.toggle('hidden', clientState.selectedGameMode !== 'Custom');
            validateMenu();
        });
    });

    createBtn.addEventListener('click', () => {
        myPlayerName = playerNameInput.value.trim();
        let payload = { playerName: myPlayerName, gameMode: clientState.selectedGameMode };
        if (clientState.selectedGameMode === 'Custom') {
            payload.customSettings = {
                startWithWeapon: get('setting-weapon').checked,
                startWithArmor: get('setting-armor').checked,
                startingItems: parseInt(get('setting-items').value, 10),
                startingSpells: parseInt(get('setting-spells').value, 10),
                lootDropRate: parseInt(get('setting-loot-rate').value, 10),
                discoveryRolls: get('setting-discovery-rolls').checked
            };
        }
        socket.emit('createRoom', payload);
    });

    joinBtn.addEventListener('click', () => {
        myPlayerName = playerNameInput.value.trim();
        const roomId = roomCodeInput.value.trim().toUpperCase();
        socket.emit('joinRoom', { playerName: myPlayerName, roomId });
    });
    
    const storedRoomId = sessionStorage.getItem('qc_roomId');
    const storedPlayerId = sessionStorage.getItem('qc_playerId');
    if (storedRoomId && storedPlayerId) {
        socket.emit('rejoinRoom', { roomId: storedRoomId, playerId: storedPlayerId });
    }
}

/**
 * Main handler for all clicks within the game area. Uses event delegation.
 * This function is refactored to prioritize specific button clicks over general card selections,
 * fixing issues on mobile where tapping buttons would be misinterpreted.
 */
function handleGameAreaClick(e) {
    const cardElement = e.target.closest('.card');
    if (!cardElement) return; // Exit if the click wasn't on a card at all

    const isMobile = !isDesktop();
    const button = e.target.closest('button');

    // 1. PRIORITIZE ALL BUTTON CLICKS WITHIN A CARD
    if (button) {
        // Stop propagation immediately to prevent the card selection logic from firing.
        e.stopPropagation(); 
        
        // A. Handle Info Button
        if (button.classList.contains('card-info-btn')) {
            showCardInspectorModal(cardElement.dataset.cardId);
            return; // Action handled
        }

        // B. Handle Action Buttons (Use, Discard, Equip, etc.)
        const action = button.dataset.action;
        if (action) {
            const cardId = cardElement.dataset.cardId;
            const myPlayer = currentRoomState.players[myId];
            if (!myPlayer) return;

            const cardInHand = myPlayer.hand.find(c => c.id === cardId);
            const lootItem = currentRoomState.gameState.lootPool.find(c => c.id === cardId);

            switch (action) {
                case 'equip':
                    socket.emit('equipItem', { cardId });
                    break;
                case 'useConsumable':
                    if (cardInHand) handleUseConsumable(cardInHand);
                    break;
                case 'castSpell':
                    if (cardInHand) handleCastSpell(cardInHand);
                    break;
                case 'claimLoot':
                    if (lootItem) showClaimLootModal(lootItem);
                    break;
                case 'interact':
                    socket.emit('playerAction', {
                        action: 'resolveSkillInteraction',
                        cardId: cardId,
                        interactionName: button.dataset.interactionName
                    });
                    break;
                case 'discardCard':
                    socket.emit('playerAction', { action: 'discardCard', cardId });
                    break;
            }
            clientState.selectedHandCardId = null; // Deselect card after an action is taken
            renderUI(); // Re-render to remove selection highlight/buttons
            return; // Action handled
        }
    }

    // 2. HANDLE MOBILE CARD SELECTION (only if no button was clicked)
    if (isMobile && cardElement.closest('.player-hand-container')) {
         const cardId = cardElement.dataset.cardId;
         // If clicking the already selected card, treat it as a deselect.
         clientState.selectedHandCardId = (clientState.selectedHandCardId === cardId) ? null : cardId;
         renderUI(); // Re-render to show/hide buttons
         return; // Action handled
    }

    // 3. HANDLE OTHER CARD CLICKS (ATTACKING, etc.)
    const myPlayer = currentRoomState.players[myId];
    if (!myPlayer) return;
    const isMyTurn = currentRoomState.gameState.turnOrder[currentRoomState.gameState.currentPlayerIndex] === myPlayer.id && !myPlayer.isDowned;
    if (!isMyTurn) return;

    if (cardElement.classList.contains('attackable-weapon')) {
        const cardId = cardElement.dataset.cardId;
        clientState.selectedWeaponId = clientState.selectedWeaponId === cardId ? null : cardId;
        if (clientState.selectedWeaponId && clientState.isFirstTurnTutorialActive) {
            showToast("Great! Now click a monster on the board to attack it.", "info");
        }
        renderUI(); // Re-render to show selection highlight
    } else if (cardElement.classList.contains('targetable')) {
        const monsterId = cardElement.dataset.monsterId;
        if (clientState.selectedWeaponId) {
            if (clientState.isFirstTurnTutorialActive) {
                clientState.isFirstTurnTutorialActive = false;
            }
            showNarrativeModal(clientState.selectedWeaponId, monsterId);
            clientState.selectedWeaponId = null;
            renderUI(); // Re-render to remove selection highlight
        }
    }
}


function initializeGameUIListeners() {
    get('game-area').addEventListener('click', handleGameAreaClick);
    
    document.body.addEventListener('click', (e) => {
        const target = e.target;
        
        // Deselect card logic for mobile when clicking outside of the hand
        const cardInHand = e.target.closest('.player-hand-container .card');
        if (!isDesktop() && !cardInHand && clientState.selectedHandCardId) {
            clientState.selectedHandCardId = null;
            renderUI();
        }

        // Class selection on mobile
        const classBtn = target.closest('.select-class-btn');
        if (classBtn) {
            socket.emit('chooseClass', { classId: classBtn.dataset.classId });
            return;
        }
        // Use class ability
        if (target.id === 'use-ability-btn') {
            const playerClass = currentRoomState.players[myId]?.class;
            if (playerClass) {
                const abilityName = currentRoomState.staticData.classes[playerClass].ability.name;
                socket.emit('playerAction', { action: 'useAbility', abilityName });
            }
            return;
        }
        // Start game button
        if (target.id === 'character-sheet-start-game-btn' || target.closest('[data-container="start-game-btn"]')) {
            socket.emit('startGame');
            return;
        }

        // Action bar buttons
        const actionBar = target.closest('[data-container="action-bar"]');
        if (actionBar) {
            const btn = target.closest('button');
            if (!btn) return;
            const actionType = Object.keys(btn.dataset).find(key => key.startsWith('container'));
            if (!actionType) return;
            
            const action = btn.dataset[actionType];
            if (action.includes('end-turn-btn')) socket.emit('endTurn');
            else if (action.includes('guard-btn')) socket.emit('playerAction', { action: 'guard' });
            else if (action.includes('brief-respite-btn')) socket.emit('playerAction', { action: 'respite' });
            else if (action.includes('full-rest-btn')) socket.emit('playerAction', { action: 'rest' });
            else if (action.includes('skill-challenge-btn')) {
                const challenge = currentRoomState.gameState.skillChallenge.details;
                if (challenge) {
                    const stage = challenge.stages ? challenge.stages[currentRoomState.gameState.skillChallenge.currentStage] : challenge;
                    showSkillChallengeModal(stage, challenge.name);
                }
            }
        }
    });

    ['chat-form', 'mobile-chat-form'].forEach(id => {
        const form = get(id);
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const input = get(id.replace('form', 'input'));
            const channel = get(id.replace('form', 'channel'));
            const message = input.value.trim();
            if (message) {
                socket.emit('chatMessage', { channel: channel.value, message });
                input.value = '';
            }
        });
    });

    get('chat-toggle-btn').addEventListener('click', () => get('chat-overlay').classList.toggle('hidden'));
    get('chat-close-btn').addEventListener('click', () => get('chat-overlay').classList.add('hidden'));

    get('menu-toggle-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        get('menu-dropdown').classList.toggle('hidden');
    });

    get('mobile-menu-toggle-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        get('mobile-menu-dropdown').classList.toggle('hidden');
    });

    get('mobile-drawer-toggle-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        const btn = e.currentTarget;
        const drawer = get('mobile-top-drawer');
        btn.classList.toggle('toggled');
        drawer.classList.toggle('active');
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.header-menu')) {
            get('menu-dropdown').classList.add('hidden');
            get('mobile-menu-dropdown').classList.add('hidden');
        }
        if (!e.target.closest('.mobile-header') && !e.target.closest('#mobile-top-drawer')) {
            get('mobile-top-drawer').classList.remove('active');
            get('mobile-drawer-toggle-btn').classList.remove('toggled');
        }
    });

    const leaveGameAction = () => {
        sessionStorage.removeItem('qc_roomId');
        sessionStorage.removeItem('qc_playerId');
        window.location.reload();
    };
    ['leave-game-btn', 'mobile-leave-game-btn'].forEach(id => get(id).addEventListener('click', leaveGameAction));
    
    ['join-voice-btn', 'mobile-join-voice-btn'].forEach(id => get(id).addEventListener('click', () => voiceChatManager.join()));
    ['leave-voice-btn', 'mobile-leave-voice-btn'].forEach(id => get(id).addEventListener('click', () => voiceChatManager.leave()));
    ['mute-voice-btn', 'mobile-mute-voice-btn'].forEach(id => get(id).addEventListener('click', () => voiceChatManager.toggleMute()));

    document.querySelector('.info-tabs-panel .tab-buttons').addEventListener('click', (e) => {
        if (e.target.classList.contains('tab-btn')) {
            const tabId = e.target.dataset.tab;
            document.querySelectorAll('.info-tabs-panel .tab-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            document.querySelectorAll('.info-tabs-panel .tab-content').forEach(c => c.classList.remove('active'));
            get(tabId).classList.add('active');
        }
    });

    document.querySelector('.mobile-bottom-nav').addEventListener('click', (e) => {
        const navBtn = e.target.closest('.nav-btn');
        if (navBtn) switchMobileScreen(navBtn.dataset.screen);
    });
    
    get('dice-roll-confirm-btn').addEventListener('click', handleDiceRoll);
    get('dice-roll-close-btn').addEventListener('click', () => {
        get('dice-roll-modal').classList.add('hidden');
        if(clientState.rollModalCloseTimeout) clearTimeout(clientState.rollModalCloseTimeout);
    });
    
    get('narrative-confirm-btn').addEventListener('click', () => {
        if (!clientState.activeItem) return;
        socket.emit('playerAction', {
            action: 'attack',
            cardId: clientState.activeItem.weaponId,
            targetId: clientState.activeItem.targetId,
            narrative: get('narrative-input').value.trim() || null
        });
        get('narrative-modal').classList.add('hidden');
        clientState.activeItem = null;
    });
    get('narrative-cancel-btn').addEventListener('click', () => {
        get('narrative-modal').classList.add('hidden');
        clientState.activeItem = null;
    });
     
    get('confirm-discard-btn').addEventListener('click', () => {
        if (!clientState.activeItem || !clientState.activeItem.selectedCardId) return;
        socket.emit('playerAction', {
            action: 'chooseNewCardDiscard',
            cardToDiscardId: clientState.activeItem.selectedCardId,
            newCard: clientState.activeItem.newCard
        });
        get('choose-discard-modal').classList.add('hidden');
        clientState.activeItem = null;
    });
     
    get('game-over-leave-btn').addEventListener('click', leaveGameAction);
     
    get('discovery-confirm-btn').addEventListener('click', () => {
        if (!clientState.activeItem || !clientState.activeItem.keptItemId) return;
        socket.emit('playerAction', { action: 'resolveDiscovery', keptItemId: clientState.activeItem.keptItemId });
        get('discovery-modal').classList.add('hidden');
        clientState.activeItem = null;
    });
     
    ['help-btn', 'mobile-help-btn'].forEach(id => get(id).addEventListener('click', showHelpModal));
    get('help-close-btn').addEventListener('click', hideHelpModal);
    get('help-prev-btn').addEventListener('click', () => navigateHelpModal(-1));
    get('help-next-btn').addEventListener('click', () => navigateHelpModal(1));

    get('skill-challenge-resolve-btn').addEventListener('click', () => {
         socket.emit('playerAction', { action: 'resolveSkillCheck' });
         get('skill-challenge-modal').classList.add('hidden');
     });
    get('skill-challenge-decline-btn').addEventListener('click', () => {
         get('skill-challenge-modal').classList.add('hidden');
     });

    get('card-inspector-modal').addEventListener('click', (e) => {
        if (e.target.id === 'card-inspector-modal') {
             get('card-inspector-modal').classList.add('hidden');
        }
    });
    get('card-inspector-content').addEventListener('click', (e) => {
        if (e.target.closest('.card-inspector-close-btn')) {
            get('card-inspector-modal').classList.add('hidden');
        } else {
            e.stopPropagation();
        }
    });
}

// --- 4. MODAL & POPUP LOGIC ---
function switchMobileScreen(screenName) {
    document.querySelectorAll('.mobile-screen').forEach(s => s.classList.remove('active'));
    get(`mobile-screen-${screenName}`).classList.add('active');
    document.querySelectorAll('.mobile-bottom-nav .nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelector(`.mobile-bottom-nav .nav-btn[data-screen="${screenName}"]`).classList.add('active');
}

function showToast(message, type = 'info', duration = 3000) {
    const container = get('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    
    setTimeout(() => toast.classList.add('visible'), 10);
    setTimeout(() => {
        toast.classList.remove('visible');
        toast.addEventListener('transitionend', () => toast.remove());
    }, duration);
}

function showChatPreview(sender, message) {
    const container = get('chat-preview-container');
    const preview = document.createElement('div');
    preview.className = 'chat-preview-item';
    preview.innerHTML = `<span class="chat-preview-sender">${sender}:</span> ${message}`;
    container.appendChild(preview);

    setTimeout(() => preview.classList.add('visible'), 10);
    setTimeout(() => {
        preview.classList.remove('visible');
        preview.addEventListener('transitionend', () => preview.remove());
    }, 5000);
}

function showYourTurnPopup() {
    const popup = get('your-turn-popup');
    popup.classList.remove('hidden');
    setTimeout(() => popup.classList.add('hidden'), 2500);
}

function showTargetSelectionModal({ title, prompt, targets, onSelect, onCancel }) {
    const modal = get('target-selection-modal');
    const targetList = get('target-selection-list');
    
    get('target-selection-title').textContent = title;
    get('target-selection-prompt').textContent = prompt;
    targetList.innerHTML = '';

    targets.forEach(target => {
        const btn = document.createElement('button');
        btn.className = 'btn btn-secondary';
        btn.textContent = target.name;
        btn.onclick = () => {
            onSelect(target);
            modal.classList.add('hidden');
        };
        targetList.appendChild(btn);
    });

    const cancelBtn = get('target-selection-cancel-btn');
    const newCancelBtn = cancelBtn.cloneNode(true);
    cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
    
    newCancelBtn.onclick = () => {
        if (onCancel) onCancel();
        modal.classList.add('hidden');
    };
    
    modal.classList.remove('hidden');
}

function showNarrativeModal(weaponId, targetId) {
    clientState.activeItem = { weaponId, targetId };
    const weapon = Object.values(currentRoomState.players[myId].equipment).find(e => e?.id === weaponId) || { name: 'Unarmed Strike' };
    get('narrative-prompt').textContent = `How do you use your ${weapon.name}?`;
    get('narrative-input').value = '';
    get('narrative-modal').classList.remove('hidden');
}

function showGameOverModal(winner) {
    const title = get('game-over-title');
    const message = get('game-over-message');
    
    if (winner === 'Explorers') {
        title.textContent = "Victory!";
        message.textContent = "You have overcome the challenges and completed your quest!";
    } else {
        title.textContent = "Defeat...";
        message.textContent = "Your party has fallen. The darkness claims another victory.";
    }
    get('game-over-modal').classList.remove('hidden');
}

function showClaimLootModal(item) {
    clientState.activeItem = item;
    const explorers = Object.values(currentRoomState.players).filter(p => p.role === 'Explorer');
    
    showTargetSelectionModal({
        title: `Claim ${item.name}`,
        prompt: 'Who should receive this item?',
        targets: explorers,
        onSelect: (selectedPlayer) => {
            socket.emit('playerAction', { 
                action: 'claimLoot', 
                itemId: clientState.activeItem.id, 
                targetPlayerId: selectedPlayer.id 
            });
            clientState.activeItem = null;
        },
        onCancel: () => {
            clientState.activeItem = null;
        }
    });
}

function showDiscoveryModal({ newCard }) {
    const modal = get('discovery-modal');
    const myPlayer = currentRoomState.players[myId];
    if (!myPlayer) return;

    const newItemContainer = get('discovery-new-item-container');
    const equippedContainer = get('discovery-equipped-container');
    const confirmBtn = get('discovery-confirm-btn');

    const itemType = newCard.type.toLowerCase();
    const equippedCard = myPlayer.equipment[itemType];

    clientState.activeItem = { newCard, equippedCard, keptItemId: null };
    confirmBtn.disabled = true;

    newItemContainer.innerHTML = '';
    equippedContainer.innerHTML = '';

    const handleCardSelection = (cardEl, cardId) => {
        modal.querySelectorAll('.card').forEach(c => c.classList.remove('selected-for-discard'));
        cardEl.classList.add('selected-for-discard');
        clientState.activeItem.keptItemId = cardId;
        confirmBtn.disabled = false;
    };

    const newCardEl = createCardElement(newCard);
    newCardEl.onclick = () => handleCardSelection(newCardEl, newCard.id);
    newItemContainer.appendChild(newCardEl);

    const equippedCardEl = createCardElement(equippedCard);
    if(equippedCard) {
        equippedCardEl.onclick = () => handleCardSelection(equippedCardEl, equippedCard.id);
    }
    equippedContainer.appendChild(equippedCardEl);

    modal.classList.remove('hidden');
}

function handleUseConsumable(card) {
    const effect = card.effect;
    clientState.activeItem = card;

    if (effect.target === 'any-player') {
        const explorers = Object.values(currentRoomState.players).filter(p => p.role === 'Explorer' && !p.isDowned);
        showTargetSelectionModal({
            title: `Use ${card.name} on...`,
            prompt: 'Select a player to target.',
            targets: explorers,
            onSelect: (selectedPlayer) => {
                socket.emit('playerAction', { 
                    action: 'useConsumable', 
                    cardId: clientState.activeItem.id, 
                    targetId: selectedPlayer.id 
                });
                clientState.activeItem = null;
            },
            onCancel: () => { clientState.activeItem = null; }
        });
    } else if (effect.target === 'any-monster') {
        const monsters = currentRoomState.gameState.board.monsters;
        if (monsters.length > 0) {
            showTargetSelectionModal({
                title: `Use ${card.name} on...`,
                prompt: 'Select a monster to target.',
                targets: monsters,
                onSelect: (selectedMonster) => {
                    socket.emit('playerAction', { action: 'useConsumable', cardId: card.id, targetId: selectedMonster.id });
                    clientState.activeItem = null;
                },
                onCancel: () => { clientState.activeItem = null; }
            });
        } else {
            showToast('No monsters to target!', 'error');
            clientState.activeItem = null;
        }
    } else {
        socket.emit('playerAction', { action: 'useConsumable', cardId: card.id, targetId: myId });
        clientState.activeItem = null;
    }
}

function handleCastSpell(card) {
    const effect = card.effect;
    clientState.activeItem = card;

    const basePayload = { action: 'castSpell', cardId: clientState.activeItem.id };

    if (!effect.target || ['self', 'aoe', 'party'].includes(effect.target) || effect.type === 'utility') {
        socket.emit('playerAction', basePayload);
        clientState.activeItem = null;
    } else if (effect.target === 'any-player') {
        const explorers = Object.values(currentRoomState.players).filter(p => p.role === 'Explorer');
        showTargetSelectionModal({
            title: `Cast ${card.name} on...`,
            prompt: 'Select a player to target.',
            targets: explorers,
            onSelect: (selectedPlayer) => {
                socket.emit('playerAction', { ...basePayload, targetId: selectedPlayer.id });
                clientState.activeItem = null;
            },
            onCancel: () => { clientState.activeItem = null; }
        });
    } else if (effect.target === 'any-monster' || effect.target === 'multi-monster') {
        const monsters = currentRoomState.gameState.board.monsters;
        if (monsters.length > 0) {
             showTargetSelectionModal({
                title: `Cast ${card.name} on...`,
                prompt: 'Select a monster to target.',
                targets: monsters,
                onSelect: (selectedMonster) => {
                    socket.emit('playerAction', { ...basePayload, targetId: selectedMonster.id });
                    clientState.activeItem = null;
                },
                onCancel: () => { clientState.activeItem = null; }
            });
        } else {
            showToast('No monsters to target!', 'error');
            clientState.activeItem = null;
        }
    }
}

function showCardInspectorModal(cardId) {
    const allCards = [
        ...Object.values(currentRoomState.players).flatMap(p => [...p.hand, ...Object.values(p.equipment)]),
        ...currentRoomState.gameState.board.monsters,
        ...currentRoomState.gameState.board.environment,
        ...currentRoomState.gameState.lootPool,
    ];
    const cardData = allCards.find(c => c && c.id === cardId);
    if (!cardData) {
        console.error("Card data not found for inspector:", cardId);
        return;
    }

    const modal = get('card-inspector-modal');
    const contentContainer = get('card-inspector-content');
    
    // Create a larger version of the card for inspection
    const inspectorCard = createCardElement(cardData);
    inspectorCard.style.width = '300px';
    inspectorCard.style.height = '420px';
    inspectorCard.style.fontSize = '1.2rem';

    // The close button is already in the HTML, we just need to add the card.
    contentContainer.innerHTML = ''; // Clear previous
    const closeBtn = document.createElement('button');
    closeBtn.id = 'card-inspector-close-btn';
    closeBtn.className = 'btn-icon card-inspector-close-btn';
    closeBtn.setAttribute('aria-label', 'Close Inspector');
    closeBtn.innerHTML = `<span class="material-symbols-outlined">close</span>`;
    
    contentContainer.appendChild(closeBtn);
    contentContainer.appendChild(inspectorCard);

    modal.classList.remove('hidden');
}

function showChooseToDiscardModal({ newCard, currentHand }) {
    const modal = get('choose-discard-modal');
    const newCardContainer = get('new-card-to-discard-container');
    const handContainer = get('hand-cards-to-discard-container');
    const confirmBtn = get('confirm-discard-btn');

    clientState.activeItem = { newCard, currentHand, selectedCardId: null };
    confirmBtn.disabled = true;

    newCardContainer.innerHTML = '';
    handContainer.innerHTML = '';
    
    const handleCardSelection = (cardEl, cardId) => {
        modal.querySelectorAll('.card').forEach(c => c.classList.remove('selected-for-discard'));
        cardEl.classList.add('selected-for-discard');
        clientState.activeItem.selectedCardId = cardId;
        confirmBtn.disabled = false;
    };

    const newCardEl = createCardElement(newCard);
    newCardEl.onclick = () => handleCardSelection(newCardEl, newCard.id);
    newCardContainer.appendChild(newCardEl);

    currentHand.forEach(card => {
        const cardEl = createCardElement(card);
        cardEl.onclick = () => handleCardSelection(cardEl, card.id);
        handContainer.appendChild(cardEl);
    });

    modal.classList.remove('hidden');
}

function showSkillChallengeModal(stage, challengeName) {
     const modal = get('skill-challenge-modal');
     get('skill-challenge-title').textContent = challengeName || "A New Challenge!";
     get('skill-challenge-description').textContent = stage.description;
     modal.classList.remove('hidden');
}


function showHelpModal() {
    clientState.helpModalPage = 0;
    renderHelpModalContent();
    get('help-modal').classList.remove('hidden');
}
function hideHelpModal() {
    get('help-modal').classList.add('hidden');
}
function navigateHelpModal(direction) {
    const totalPages = helpContent.length;
    clientState.helpModalPage = (clientState.helpModalPage + direction + totalPages) % totalPages;
    renderHelpModalContent();
}
function renderHelpModalContent() {
    const page = helpContent[clientState.helpModalPage];
    get('help-content').innerHTML = `
        <h3><span class="material-symbols-outlined help-icon">${page.icon}</span>${page.title}</h3>
        ${page.content}
    `;
    get('help-page-indicator').textContent = `Page ${clientState.helpModalPage + 1} / ${helpContent.length}`;
    get('help-prev-btn').disabled = clientState.helpModalPage === 0;
    get('help-next-btn').disabled = clientState.helpModalPage === helpContent.length - 1;
}

const helpContent = [
    {
        icon: 'menu_book',
        title: 'Welcome to Quest & Chronicle',
        content: `<p>This guide will walk you through the basics of playing the game. Use the "Next" and "Previous" buttons to navigate.</p><p><b>The Goal:</b> As a party of Explorers, your goal is to survive challenges, defeat monsters, and overcome the scenario set by the Dungeon Master (DM). Victory is often achieved by defeating a powerful boss or completing a multi-stage objective.</p>`
    },
    {
        icon: 'bolt',
        title: 'Your Turn & Core Stats',
        content: `
            <p>On your turn, you can spend <b class="help-keyword ap">Action Points (AP)</b> to perform actions. You regain all your AP at the start of your turn.</p>
            <ul>
                <li><b class="help-keyword hp">Health Points (HP):</b> If this reaches 0, you are Downed.</li>
                <li><b class="help-keyword ap">Action Points (AP):</b> The resource you spend to take actions like attacking or casting spells.</li>
                <li><b class="help-keyword damage">Damage Bonus:</b> Added to your damage rolls.</li>
                <li><b class="help-keyword shield">Shield Bonus:</b> Added to your Shield HP when you use the Guard action.</li>
                <li><b class="help-keyword hit">Hit Bonus:</b> Added to your attack rolls to see if you hit an enemy.</li>
            </ul>`
    },
    {
        icon: 'swords',
        title: 'Taking Actions',
        content: `
            <p>Most cards in your hand or equipped have an AP cost. You can also take standard actions:</p>
            <ul>
                <li><b class="help-keyword action">Attack:</b> Use an equipped weapon to attack a monster. This will prompt a dice roll.</li>
                <li><b class="help-keyword action">Cast Spell:</b> Use a spell from your hand. Some spells require a target.</li>
                <li><b class="help-keyword action">Guard (1 AP):</b> Gain temporary Shield HP equal to your Shield Bonus. This Shield HP is lost at the end of your next turn.</li>
                <li><b class="help-keyword action">Respite (1 AP):</b> Heal a small amount of HP (1d4).</li>
                 <li><b class="help-keyword action">Rest (2 AP):</b> Heal a larger amount of HP based on your class.</li>
                <li><b class="help-keyword action">End Turn:</b> Click this when you are finished with your actions.</li>
            </ul>`
    },
    {
        icon: 'casino',
        title: 'Rolling the Dice',
        content: `
            <p>Many actions, like attacking or resolving challenges, require a dice roll. The game will prompt you when a roll is needed.</p>
            <ul>
                <li><b>Attack Rolls:</b> You roll a 20-sided die (d20) and add your <b class="help-keyword hit">Hit Bonus</b>. If the total is greater than or equal to the monster's Armor Class (AC), you <b class="help-keyword success">hit</b>!</li>
                <li><b>Damage Rolls:</b> If you hit, you'll be prompted to roll for damage. This uses the dice shown on your weapon card, plus your <b class="help-keyword damage">Damage Bonus</b>.</li>
                <li><b>Skill Checks:</b> For challenges, you roll a d20 and add the relevant stat bonus (e.g., STR, DEX). If you meet or beat the Difficulty Class (DC), you <b class="help-keyword success">succeed</b>.</li>
            </ul>`
    },
    {
        icon: 'stars',
        title: 'Party Hope',
        content: `<p>The Party Hope meter represents the party's morale. It ranges from 0 to 10.</p>
            <ul>
                <li>Hope increases when you score critical hits or defeat powerful enemies.</li>
                <li>Hope decreases when a player is Downed.</li>
                <li><b>High Hope (Inspired):</b> At 9 or 10 Hope, the party gains a +1 bonus to all Hit rolls!</li>
                <li><b>Low Hope (Despairing):</b> At 2 or less Hope, the party suffers a -1 penalty to all Hit rolls.</li>
            </ul>`
    },
    {
        icon: 'redeem',
        title: 'Loot & Items',
        content: `
            <p>Defeating monsters has a chance to drop loot! This loot appears in the "Party Discoveries" panel. Any player can click "Claim" on an item to open a menu and decide who in the party receives it.</p>
            <p>Items have rarities, indicated by their border color:</p>
            <ul>
                <li><b class="help-keyword uncommon">Uncommon (Green):</b> A slight magical enhancement.</li>
                <li><b class="help-keyword rare">Rare (Blue):</b> A significant magical power.</li>
                <li><b class="help-keyword legendary">Legendary (Purple):</b> A powerful, game-changing artifact.</li>
            </ul>`
    },
     {
        icon: 'info',
        title: 'Card Details',
        content: `
            <p>Confused about what a card does? Click the small <span class="material-symbols-outlined help-icon">info</span> icon in the top-right corner of any card to open the Card Inspector. This will show you a larger version with a full description of its abilities and effects.</p>`
    },
];

// --- 5. DICE ROLLING LOGIC ---
function showDiceRollModal({ title, description, dice, bonus, targetAC, hasAdvantage, relevantItemName, onConfirm }) {
    if(clientState.rollResponseTimeout) clearTimeout(clientState.rollResponseTimeout);

    clientState.currentRollData = { dice, bonus, targetAC, onConfirm, hasAdvantage, relevantItemName };

    get('dice-roll-title').textContent = title;
    get('dice-roll-description').textContent = description || '';
    
    get('dice-roll-result-container').classList.add('hidden');
    get('dice-roll-damage-line').textContent = ''; // Clear previous damage line
    
    const confirmBtn = get('dice-roll-confirm-btn');
    confirmBtn.disabled = false;
    confirmBtn.textContent = 'Roll Dice';
    confirmBtn.classList.remove('hidden');

    get('dice-roll-close-btn').classList.add('hidden');
    
    const diceDisplay = get('dice-display-container');
    const sides = dice.split('d')[1];
    diceDisplay.innerHTML = `
        <svg class="die-svg" viewBox="0 0 100 100">
            <rect class="die-shape" x="10" y="10" width="80" height="80" rx="10"/>
            <text x="50" y="55" text-anchor="middle" class="die-text">?_</text>
            <text x="50" y="80" text-anchor="middle" class="die-sides-text">d${sides}</text>
        </svg>
    `;
    
    get('dice-roll-modal').classList.remove('hidden');

    clientState.rollResponseTimeout = setTimeout(() => {
        if (!get('dice-roll-modal').classList.contains('hidden')) {
            handleDiceRoll(); // Auto-roll if the user doesn't click
        }
    }, 10000); // 10 seconds
}

function handleDiceRoll() {
    if(clientState.rollResponseTimeout) clearTimeout(clientState.rollResponseTimeout);
    
    const { onConfirm } = clientState.currentRollData;
    onConfirm(); // This will emit the event to the server to do the actual roll.

    const confirmBtn = get('dice-roll-confirm-btn');
    confirmBtn.disabled = true;
    confirmBtn.textContent = "Rolling...";

    const dieSVG = document.querySelector('#dice-display-container .die-svg');
    const dieText = document.querySelector('#dice-display-container .die-text');
    dieSVG.classList.add('rolling');

    if (clientState.diceAnimationInterval) clearInterval(clientState.diceAnimationInterval);
    clientState.diceAnimationInterval = setInterval(() => {
        dieText.textContent = Math.ceil(Math.random() * 20);
    }, 50);
}

function displayDiceRollResult(payload) {
    if (clientState.diceAnimationInterval) clearInterval(clientState.diceAnimationInterval);
    if(clientState.rollResponseTimeout) clearTimeout(clientState.rollResponseTimeout);

    const dieSVG = document.querySelector('#dice-display-container .die-svg');
    const dieText = document.querySelector('#dice-display-container .die-text');
    
    dieSVG.classList.remove('rolling');
    dieSVG.classList.add('result-glow');
    dieText.textContent = payload.roll;

    const resultContainer = get('dice-roll-result-container');
    const resultLine = get('dice-roll-result-line');
    const resultDetails = get('dice-roll-details');
    
    resultLine.textContent = payload.outcome;
    resultLine.className = `result-line ${payload.outcome.toLowerCase()}`;
    resultDetails.textContent = `(Roll: ${payload.roll} + Bonus: ${payload.bonus} = ${payload.total} vs Target: ${payload.targetAC})`;
    
    get('dice-roll-damage-line').textContent = ''; // Clear the old damage line
    resultContainer.classList.remove('hidden');
    get('dice-roll-confirm-btn').classList.add('hidden');
    get('dice-roll-close-btn').classList.remove('hidden');

    if (clientState.rollModalCloseTimeout) clearTimeout(clientState.rollModalCloseTimeout);
    clientState.rollModalCloseTimeout = setTimeout(() => {
        get('dice-roll-modal').classList.add('hidden');
    }, 5000); // Increased timeout for better pacing
}

// NEW: A dedicated function to display the result of a damage roll.
function displayDamageResult(payload) {
    if (clientState.diceAnimationInterval) clearInterval(clientState.diceAnimationInterval);
    if(clientState.rollResponseTimeout) clearTimeout(clientState.rollResponseTimeout);

    const dieSVG = document.querySelector('#dice-display-container .die-svg');
    const dieText = document.querySelector('#dice-display-container .die-text');
    
    dieSVG.classList.remove('rolling');
    dieSVG.classList.add('result-glow');
    dieText.textContent = payload.damageRoll;

    const resultContainer = get('dice-roll-result-container');
    const resultLine = get('dice-roll-result-line');
    const resultDetails = get('dice-roll-details');
    
    resultLine.textContent = `Dealt ${payload.totalDamage} Damage!`;
    resultLine.className = `result-line damage`;
    resultDetails.textContent = `(Roll: ${payload.damageRoll} + Bonus: ${payload.damageBonus} = ${payload.totalDamage})${payload.wasDefeated ? ' - Target Defeated!' : ''}`;
    
    get('dice-roll-damage-line').textContent = ''; 

    resultContainer.classList.remove('hidden');
    get('dice-roll-confirm-btn').classList.add('hidden');
    get('dice-roll-close-btn').classList.remove('hidden');

    if (clientState.rollModalCloseTimeout) clearTimeout(clientState.rollModalCloseTimeout);
    clientState.rollModalCloseTimeout = setTimeout(() => {
        get('dice-roll-modal').classList.add('hidden');
    }, 5000);
}


// --- 6. SOCKET.IO EVENT HANDLERS ---
socket.on('connect', () => {
    console.log('Connected to server with ID:', socket.id);
});

socket.on('gameStateUpdate', (newState) => {
    currentRoomState = newState;
    renderUI();
});

socket.on('playerIdentity', ({ playerId, roomId }) => {
    myId = socket.id;
    sessionStorage.setItem('qc_roomId', roomId);
    sessionStorage.setItem('qc_playerId', playerId);
});

socket.on('turnStarted', ({ playerId }) => {
    if (playerId === myId) {
        showYourTurnPopup();
        clientState.hasSeenSkillChallengePrompt = false;
        
        const myPlayer = currentRoomState.players[myId];
        if (myPlayer && !myPlayer.hasTakenFirstTurn) {
            clientState.isFirstTurnTutorialActive = true;
            showToast("It's your first turn! Click on a weapon (like 'Unarmed Strike') to select it for an attack.", "info", 5000);
        }
    }
});

socket.on('actionError', (message) => {
    showToast(message, 'error');
});

socket.on('roomClosed', ({ message }) => {
    showToast(message, 'error', 5000);
    setTimeout(() => {
        sessionStorage.removeItem('qc_roomId');
        sessionStorage.removeItem('qc_playerId');
        window.location.reload();
    }, 5000);
});

socket.on('chooseToDiscard', ({ newCard, currentHand }) => {
    showChooseToDiscardModal({ newCard, currentHand });
});

socket.on('promptIndividualDiscovery', ({ newCard }) => {
    showDiscoveryModal({ newCard });
});

socket.on('promptAttackRoll', (data) => {
    showDiceRollModal({
        title: data.title,
        dice: data.dice,
        bonus: data.bonus,
        targetAC: data.targetAC,
        onConfirm: () => socket.emit('playerAction', {
            action: 'resolveAttackRoll',
            weaponId: data.weaponId,
            targetId: data.targetId
        })
    });
});

socket.on('promptDiscoveryRoll', (data) => {
     showDiceRollModal({
        title: data.title,
        dice: data.dice,
        bonus: 0,
        targetAC: 'N/A',
        onConfirm: () => socket.emit('playerAction', { action: 'resolveDiscoveryRoll' })
    });
});
socket.on('discoveryRollResolved', (payload) => {
    if (get('dice-roll-modal').classList.contains('hidden')) return; // Modal was closed
    payload.outcome = `You rolled a ${payload.roll}!`;
    payload.targetAC = 'N/A';
    payload.bonus = 0;
    payload.total = payload.roll;
    displayDiceRollResult(payload);
});


socket.on('promptSkillCheckRoll', (data) => {
    showDiceRollModal({
        title: data.title,
        description: data.description,
        dice: data.dice,
        bonus: data.bonus,
        targetAC: data.targetAC,
        hasAdvantage: data.hasAdvantage,
        relevantItemName: data.relevantItemName,
        onConfirm: () => socket.emit('playerAction', {
            action: 'resolveSkillCheckRoll',
            hasAdvantage: data.hasAdvantage,
            relevantItemName: data.relevantItemName,
            interactionData: data.interactionData
        })
    });
});

socket.on('attackResolved', (payload) => {
    // REFACTORED: This handler's only job is to display the attack roll result.
    // The server will send a separate 'promptDamageRoll' event if it was a hit.
    if (payload.rollerId === myId && !get('dice-roll-modal').classList.contains('hidden')) {
        displayDiceRollResult(payload);
    }
});

// NEW ROBUST HANDLER: The server explicitly tells us when to roll for damage.
socket.on('promptDamageRoll', (data) => {
    // We add a delay to allow the player to see the "Hit!" result from the attack roll modal.
    setTimeout(() => {
        showDiceRollModal({
            title: data.title,
            dice: data.dice,
            bonus: data.bonus,
            targetAC: 'N/A', // Target AC is not relevant for damage
            onConfirm: () => socket.emit('playerAction', {
                action: 'resolveDamageRoll',
                weaponId: data.weaponId,
                targetId: data.targetId
            })
        });
    }, 1500); // 1.5 second delay for better pacing
});

socket.on('damageResolved', (payload) => {
    // REFACTORED: Use the new, clean function for displaying damage results.
    if (payload.rollerId === myId && !get('dice-roll-modal').classList.contains('hidden')) {
        displayDamageResult(payload);
    }
});

socket.on('skillCheckResolved', (payload) => {
     if (payload.rollerId === myId && !get('dice-roll-modal').classList.contains('hidden')) {
        displayDiceRollResult(payload);
    }
});

socket.on('diceRollError', () => {
    showToast("There was an error processing your roll. Please try again.", "error");
    if(!get('dice-roll-modal').classList.contains('hidden')){
        get('dice-roll-modal').classList.add('hidden');
    }
});

// Voice Chat Signaling
socket.on('existing-voice-chatters', (chatterIds) => {
    chatterIds.forEach(id => voiceChatManager.addPeer(id, true));
});
socket.on('new-voice-chatter', (chatterId) => {
    voiceChatManager.addPeer(chatterId, false);
});
socket.on('voice-chatter-left', (chatterId) => {
    voiceChatManager.removePeer(chatterId);
});
socket.on('webrtc-signal', (payload) => {
    voiceChatManager.handleSignal(payload);
});


// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', initializeUI);
window.addEventListener('resize', renderUI);