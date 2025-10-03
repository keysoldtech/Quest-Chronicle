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
    currentRollData: null,  // Holds data for an active roll modal
    activeItem: null,       // For modals needing item context (e.g., claiming loot)
    diceAnimationInterval: null,
    rollModalCloseTimeout: null,
    rollResponseTimeout: null,
    helpModalPage: 0,
    isFirstTurnTutorialActive: false,
    hasSeenSkillChallengePrompt: false, // Prevents re-opening the modal
};

// --- VOICE CHAT MANAGER ---
const voiceChatManager = {
    localStream: null,
    peers: {}, // { socketId: RTCPeerConnection }
    audioContainer: null,

    async join() {
        if (this.localStream) return;
        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            document.getElementById('join-voice-btn').classList.add('hidden');
            document.getElementById('mobile-join-voice-btn').classList.add('hidden');
            document.getElementById('mute-voice-btn').classList.remove('hidden');
            document.getElementById('leave-voice-btn').classList.remove('hidden');
            document.getElementById('mobile-mute-voice-btn').classList.remove('hidden');
            document.getElementById('mobile-leave-voice-btn').classList.remove('hidden');

            this.audioContainer = document.getElementById('voice-chat-audio-container');
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

        document.getElementById('join-voice-btn').classList.remove('hidden');
        document.getElementById('mobile-join-voice-btn').classList.remove('hidden');
        document.getElementById('mute-voice-btn').classList.add('hidden');
        document.getElementById('leave-voice-btn').classList.add('hidden');
        document.getElementById('mobile-mute-voice-btn').classList.add('hidden');
        document.getElementById('mobile-leave-voice-btn').classList.add('hidden');
    },

    toggleMute() {
        if (!this.localStream) return;
        const enabled = !this.localStream.getAudioTracks()[0].enabled;
        this.localStream.getAudioTracks()[0].enabled = enabled;
        const muteBtn = document.getElementById('mute-voice-btn');
        const mobileMuteBtn = document.getElementById('mobile-mute-voice-btn');
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
            let audioEl = document.getElementById(`audio-${peerId}`);
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
        const audioEl = document.getElementById(`audio-${peerId}`);
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

    const { isEquippable = false, isAttackable = false, isTargetable = false, isDiscardable = false, isConsumable = false, isClaimable = false } = options;
    const cardDiv = document.createElement('div');
    cardDiv.className = 'card';
    cardDiv.dataset.cardId = card.id;

    if (card.rarity) {
        cardDiv.classList.add(`rarity-${card.rarity.toLowerCase()}`);
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
        <div class="monster-stats-grid">
            <div class="card-bonus" title="Attack Bonus"><span class="material-symbols-outlined icon-damage">colorize</span>+${card.attackBonus || 0}</div>
            <div class="card-bonus" title="Armor Class"><span class="material-symbols-outlined icon-shield">security</span>${card.requiredRollToHit || 10}</div>
        </div>` : '';
    const damageDiceHTML = card.effect?.dice ? `<div class="card-bonus" title="Damage Dice"><span class="material-symbols-outlined icon-damage">casino</span>${card.effect.dice}</div>` : '';
    const apCostHTML = card.apCost ? `<div class="card-bonus" title="AP Cost"><span class="material-symbols-outlined icon-ap">bolt</span>${card.apCost}</div>` : '';
    
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

    const actionContainer = document.createElement('div');
    actionContainer.className = 'card-action-buttons';

    if (isEquippable) {
        const equipBtn = document.createElement('button');
        equipBtn.textContent = 'Equip (1AP)';
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
        // If we have a player ID, it means we were in a game but are no longer.
        // This can happen if the host disconnects or we were kicked.
        // We should clear session and reload.
        if (sessionStorage.getItem('qc_playerId')) {
            sessionStorage.removeItem('qc_roomId');
            sessionStorage.removeItem('qc_playerId');
            window.location.reload();
        }
        return;
    }

    const { players, gameState, chatLog, hostId } = currentRoomState;
    const { phase, isPaused, pauseReason } = gameState;
    const get = id => document.getElementById(id);

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
    get('room-code').textContent = currentRoomState.id;
    get('mobile-room-code').textContent = currentRoomState.id;
    get('turn-counter').textContent = gameState.turnCount;
    renderGameLog(chatLog, phase === 'started');

    const playerList = get('player-list');
    const mobilePlayerList = get('mobile-player-list');
    playerList.innerHTML = '';
    mobilePlayerList.innerHTML = '';
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
        playerList.appendChild(li);
        mobilePlayerList.appendChild(li.cloneNode(true));
    });
    
    if (isDesktop()) {
        const activePlayerListItem = playerList.querySelector('.player-list-item.active');
        if (activePlayerListItem) activePlayerListItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    // --- Phase 3: Phase-Specific Rendering ---
    const desktopCharacterPanel = get('character-sheet-block');
    const mobileCharacterPanel = get('mobile-screen-character');
    
    // Hide all lobby controls by default
    get('lobby-controls').classList.add('hidden');
    get('mobile-lobby-controls').classList.add('hidden');

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
    
    // Reworked skill challenge modal logic
    const skillChallengeIsActiveForMe = gameState.skillChallenge.isActive && gameState.turnOrder[gameState.currentPlayerIndex] === myId;
    const skillChallengeModal = get('skill-challenge-modal');

    if (skillChallengeIsActiveForMe && !clientState.hasSeenSkillChallengePrompt) {
        showSkillChallengeModal(gameState.skillChallenge.details);
        clientState.hasSeenSkillChallengePrompt = true; // Set flag so it doesn't reopen
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
    const modal = document.getElementById('class-selection-modal');
    const displayContainer = document.getElementById('desktop-class-card-display');
    const confirmBtn = document.getElementById('confirm-class-selection-btn');

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
    const get = id => document.getElementById(id);
    const isMyTurn = gameState.turnOrder[gameState.currentPlayerIndex] === myPlayer.id && !myPlayer.isDowned;

    // Health bars
    const headerStats = get('header-player-stats');
    const mobileHeaderStats = get('mobile-header-player-stats');
    if (myPlayer.stats.maxHp > 0) {
        const healthPercent = (myPlayer.stats.currentHp / myPlayer.stats.maxHp) * 100;
        get('player-health-bar').style.width = `${healthPercent}%`;
        get('player-health-text').textContent = `${myPlayer.stats.currentHp} / ${myPlayer.stats.maxHp}`;
        headerStats.classList.remove('hidden');
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
        get('ap-counter-desktop').innerHTML = `<span class="material-symbols-outlined">bolt</span>${myPlayer.currentAp}/${myPlayer.stats.maxAP}`;
        get('ap-counter-mobile').innerHTML = `<span class="material-symbols-outlined">bolt</span>${myPlayer.currentAp}/${myPlayer.stats.maxAP}`;
    }

    // Action Bars
    get('fixed-action-bar').classList.toggle('hidden', !isMyTurn);
    get('mobile-action-bar').classList.toggle('hidden', !isMyTurn);
    get('action-skill-challenge-btn').classList.toggle('hidden', !gameState.skillChallenge.isActive);
    get('mobile-action-skill-challenge-btn').classList.toggle('hidden', !gameState.skillChallenge.isActive);
    
    // Board
    const boardContainers = [get('board-cards'), get('mobile-board-cards')];
    boardContainers.forEach(c => c.innerHTML = '');
    gameState.board.monsters.forEach(monster => {
        boardContainers.forEach(container => {
            const cardEl = createCardElement(monster, { isTargetable: isMyTurn });
            cardEl.onclick = () => {
                if (!isMyTurn || !clientState.selectedWeaponId) return;
                 if (clientState.isFirstTurnTutorialActive) { // Tutorial logic
                    clientState.isFirstTurnTutorialActive = false;
                }
                showNarrativeModal(clientState.selectedWeaponId, monster.id);
                clientState.selectedWeaponId = null; 
                renderUI();
            };
            container.appendChild(cardEl);
        });
    });

    // World Events
    const worldEventBanner = get('active-world-event-display');
    const mobileWorldEventBanner = get('mobile-active-world-event-display');
    const event = gameState.worldEvents.currentEvent;
    if (event) {
        const bannerHTML = `
            <span class="material-symbols-outlined">public</span>
            <div class="world-event-text">
                <strong>${event.name}</strong>
                <span>${event.description}</span>
            </div>
            <span class="world-event-duration">Rounds Left: ${gameState.worldEvents.duration}</span>
        `;
        worldEventBanner.innerHTML = bannerHTML;
        mobileWorldEventBanner.innerHTML = bannerHTML;
        worldEventBanner.classList.remove('hidden');
        mobileWorldEventBanner.classList.remove('hidden');
    } else {
        worldEventBanner.classList.add('hidden');
        mobileWorldEventBanner.classList.add('hidden');
    }

    renderCharacterPanel(get('character-sheet-block'), get('mobile-screen-character'), myPlayer, isMyTurn);

    const lootContainers = [get('party-loot-container'), get('mobile-party-loot-container')];
    lootContainers.forEach(c => c.innerHTML = '');
    if (gameState.lootPool && gameState.lootPool.length > 0) {
        gameState.lootPool.forEach(lootItem => {
            lootContainers.forEach(container => container.appendChild(createCardElement(lootItem, { isClaimable: true })));
        });
    } else {
         lootContainers.forEach(container => container.innerHTML = `<p class="empty-pool-text">No discoveries yet.</p>`);
    }

    renderHandAndEquipment(myPlayer, isMyTurn);
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

    player.hand.forEach(card => {
        const isEquippable = (card.type === 'Weapon' || card.type === 'Armor');
        const isConsumable = card.type === 'Consumable';
        handContainers.forEach(container => {
            container.appendChild(createCardElement(card, { isEquippable, isConsumable, isDiscardable: isMyTurn }));
        });
    });

    Object.values(player.equipment).forEach(item => {
        if (item) {
            const isAttackable = item.type === 'Weapon' && isMyTurn;
            equippedContainers.forEach(container => {
                const cardEl = createCardElement(item, { isAttackable });
                if (isAttackable) {
                    cardEl.onclick = () => {
                        clientState.selectedWeaponId = clientState.selectedWeaponId === item.id ? null : item.id;
                        if (clientState.selectedWeaponId && clientState.isFirstTurnTutorialActive) {
                            showToast("Great! Now click a monster on the board to attack it.", "info");
                        }
                        renderUI();
                    };
                }
                container.appendChild(cardEl);
            });
        }
    });

    if (isMyTurn) {
        const unarmed = { id: 'unarmed', name: 'Unarmed Strike', type: 'Weapon', apCost: 1, effect: { dice: '1d4' } };
        equippedContainers.forEach(container => {
            const cardEl = createCardElement(unarmed, { isAttackable: true });
            cardEl.onclick = () => {
                clientState.selectedWeaponId = clientState.selectedWeaponId === unarmed.id ? null : unarmed.id;
                 if (clientState.selectedWeaponId && clientState.isFirstTurnTutorialActive) {
                    showToast("Great! Now click a monster on the board to attack it.", "info");
                }
                renderUI();
            };
            container.appendChild(cardEl);
        });
    }
}


function renderGameLog(log, gameStarted) {
    const logContainers = [document.getElementById('game-log-content'), document.getElementById('mobile-chat-log')];
    logContainers.forEach(container => {
        if(!container) return;
        
        const shouldScroll = Math.abs(container.scrollHeight - container.clientHeight - container.scrollTop) < 5;
        container.innerHTML = log.map(entry => {
            let content = '';
            const time = new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const timeSpan = gameStarted ? `<span class="chat-timestamp">${time}</span>` : '';
            switch (entry.type) {
                case 'chat':
                    const senderClass = entry.playerId === myId ? 'self' : '';
                    const channelClass = entry.channel.toLowerCase();
                    content = `${timeSpan} <span class="channel ${channelClass}">[${entry.channel}]</span> <span class="sender ${senderClass}">${entry.playerName}:</span> ${entry.text}`;
                    if (entry.channel === 'party' && entry.playerId !== myId) {
                        showChatPreview(entry.playerName, entry.text);
                    }
                    break;
                case 'narrative':
                     content = `<span class="narrative-text">"${entry.text}"</span> - <span class="narrative-sender">${entry.playerName}</span>`;
                     break;
                default:
                    content = entry.text || '';
            }
            return `<div class="chat-message ${entry.type}">${content}</div>`;
        }).join('');
        
        if (shouldScroll) container.scrollTop = container.scrollHeight;
    });
}

// --- 3. UI INITIALIZATION & EVENT LISTENERS ---
function initializeUI() {
    const playerNameInput = document.getElementById('player-name-input');
    const roomCodeInput = document.getElementById('room-code-input');
    const createBtn = document.getElementById('create-room-btn');
    const joinBtn = document.getElementById('join-room-btn');

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
            document.getElementById('custom-settings').classList.toggle('hidden', clientState.selectedGameMode !== 'Custom');
            validateMenu();
        });
    });

    createBtn.addEventListener('click', () => {
        myPlayerName = playerNameInput.value.trim();
        let payload = { playerName: myPlayerName, gameMode: clientState.selectedGameMode };
        if (clientState.selectedGameMode === 'Custom') {
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
    
    const storedRoomId = sessionStorage.getItem('qc_roomId');
    const storedPlayerId = sessionStorage.getItem('qc_playerId');
    if (storedRoomId && storedPlayerId) {
        socket.emit('rejoinRoom', { roomId: storedRoomId, playerId: storedPlayerId });
    }
}

function initializeGameUIListeners() {
    document.body.addEventListener('click', (e) => {
        // Class selection on mobile
        const classBtn = e.target.closest('.select-class-btn');
        if (classBtn) {
            socket.emit('chooseClass', { classId: classBtn.dataset.classId });
        }
        // Use class ability
        if (e.target.id === 'use-ability-btn') {
            const playerClass = currentRoomState.players[myId]?.class;
            if (playerClass) {
                const abilityName = currentRoomState.staticData.classes[playerClass].ability.name;
                socket.emit('playerAction', { action: 'useAbility', abilityName });
            }
        }
        // Start game button on character panel
        if (e.target.id === 'character-sheet-start-game-btn') {
            socket.emit('startGame');
        }
    });

    ['start-game-btn', 'mobile-start-game-btn'].forEach(id => {
        document.getElementById(id).addEventListener('click', () => socket.emit('startGame'));
    });

    ['chat-form', 'mobile-chat-form'].forEach(id => {
        const form = document.getElementById(id);
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const input = document.getElementById(id.replace('form', 'input'));
            const channel = document.getElementById(id.replace('form', 'channel'));
            const message = input.value.trim();
            if (message) {
                socket.emit('chatMessage', { channel: channel.value, message });
                input.value = '';
            }
        });
    });

    ['fixed-action-bar', 'mobile-action-bar'].forEach(id => {
        const bar = document.getElementById(id);
        bar.addEventListener('click', (e) => {
            const targetId = e.target.id;
            if (targetId.includes('end-turn-btn')) socket.emit('endTurn');
            else if (targetId.includes('guard-btn')) socket.emit('playerAction', { action: 'guard' });
            else if (targetId.includes('brief-respite-btn')) socket.emit('playerAction', { action: 'respite' });
            else if (targetId.includes('full-rest-btn')) socket.emit('playerAction', { action: 'rest' });
            else if (targetId.includes('skill-challenge-btn')) {
                const challenge = currentRoomState.gameState.skillChallenge.details;
                if (challenge) showSkillChallengeModal(challenge);
            }
        });
    });

    document.getElementById('chat-toggle-btn').addEventListener('click', () => document.getElementById('chat-overlay').classList.toggle('hidden'));
    document.getElementById('chat-close-btn').addEventListener('click', () => document.getElementById('chat-overlay').classList.add('hidden'));

    // --- Menu Dropdown Logic ---
    const menuToggleBtns = ['menu-toggle-btn', 'mobile-menu-toggle-btn'];
    const menuDropdowns = ['menu-dropdown', 'mobile-menu-dropdown'];

    menuToggleBtns.forEach(btnId => {
        document.getElementById(btnId).addEventListener('click', (e) => {
            e.stopPropagation();
            const dropdownId = btnId.replace('toggle-btn', 'dropdown');
            const dropdown = document.getElementById(dropdownId);
            const isCurrentlyHidden = dropdown.classList.contains('hidden');

            // Always hide all dropdowns first
            menuDropdowns.forEach(id => document.getElementById(id).classList.add('hidden'));

            // If the one we clicked was hidden, show it.
            if (isCurrentlyHidden) {
                dropdown.classList.remove('hidden');
            }
        });
    });

    // Global click listener to close menus if click is outside
    document.addEventListener('click', (e) => {
        const isClickInsideMenu = e.target.closest('.header-menu');
        if (!isClickInsideMenu) {
            menuDropdowns.forEach(id => document.getElementById(id).classList.add('hidden'));
        }
    });
    // --- End Menu Dropdown Logic ---

    const leaveGameAction = () => {
        sessionStorage.removeItem('qc_roomId');
        sessionStorage.removeItem('qc_playerId');
        window.location.reload();
    };
    ['leave-game-btn', 'mobile-leave-game-btn'].forEach(id => {
        document.getElementById(id).addEventListener('click', leaveGameAction);
    });
    
    // Voice Chat Buttons
    ['join-voice-btn', 'mobile-join-voice-btn'].forEach(id => document.getElementById(id).addEventListener('click', () => voiceChatManager.join()));
    ['leave-voice-btn', 'mobile-leave-voice-btn'].forEach(id => document.getElementById(id).addEventListener('click', () => voiceChatManager.leave()));
    ['mute-voice-btn', 'mobile-mute-voice-btn'].forEach(id => document.getElementById(id).addEventListener('click', () => voiceChatManager.toggleMute()));

    document.querySelector('.info-tabs-panel .tab-buttons').addEventListener('click', (e) => {
        if (e.target.classList.contains('tab-btn')) {
            const tabId = e.target.dataset.tab;
            document.querySelectorAll('.info-tabs-panel .tab-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            document.querySelectorAll('.info-tabs-panel .tab-content').forEach(c => c.classList.remove('active'));
            document.getElementById(tabId).classList.add('active');
        }
    });

    document.querySelector('.mobile-bottom-nav').addEventListener('click', (e) => {
        const navBtn = e.target.closest('.nav-btn');
        if (navBtn) switchMobileScreen(navBtn.dataset.screen);
    });
    
    document.getElementById('dice-roll-confirm-btn').addEventListener('click', handleDiceRoll);
    document.getElementById('dice-roll-close-btn').addEventListener('click', () => {
        document.getElementById('dice-roll-modal').classList.add('hidden');
        if(clientState.rollModalCloseTimeout) clearTimeout(clientState.rollModalCloseTimeout);
    });
    
    document.getElementById('narrative-confirm-btn').addEventListener('click', () => {
        if (!clientState.activeItem) return;
        socket.emit('playerAction', {
            action: 'attack',
            cardId: clientState.activeItem.weaponId,
            targetId: clientState.activeItem.targetId,
            narrative: document.getElementById('narrative-input').value.trim() || null
        });
        document.getElementById('narrative-modal').classList.add('hidden');
        clientState.activeItem = null;
    });
     document.getElementById('narrative-cancel-btn').addEventListener('click', () => {
        document.getElementById('narrative-modal').classList.add('hidden');
        clientState.activeItem = null;
     });
     
    document.getElementById('confirm-discard-btn').addEventListener('click', () => {
        if (!clientState.activeItem || !clientState.activeItem.selectedCardId) return;
        socket.emit('playerAction', {
            action: 'chooseNewCardDiscard',
            cardToDiscardId: clientState.activeItem.selectedCardId,
            newCard: clientState.activeItem.newCard
        });
        document.getElementById('choose-discard-modal').classList.add('hidden');
        clientState.activeItem = null;
    });

     document.getElementById('claim-loot-cancel-btn').addEventListener('click', () => {
        document.getElementById('claim-loot-modal').classList.add('hidden');
        clientState.activeItem = null;
     });
     
     document.getElementById('game-over-leave-btn').addEventListener('click', leaveGameAction);
     
     // Discovery Modal Listeners
     document.getElementById('discovery-confirm-btn').addEventListener('click', () => {
        if (!clientState.activeItem || !clientState.activeItem.keptItemId) return;
        socket.emit('playerAction', { action: 'resolveDiscovery', keptItemId: clientState.activeItem.keptItemId });
        document.getElementById('discovery-modal').classList.add('hidden');
        clientState.activeItem = null;
     });
     
     // Help Modal Listeners
     document.getElementById('help-btn').addEventListener('click', showHelpModal);
     document.getElementById('mobile-help-btn').addEventListener('click', showHelpModal);
     document.getElementById('help-close-btn').addEventListener('click', hideHelpModal);
     document.getElementById('help-prev-btn').addEventListener('click', () => navigateHelpModal(-1));
     document.getElementById('help-next-btn').addEventListener('click', () => navigateHelpModal(1));

     // Skill Challenge Modal Listeners
     document.getElementById('skill-challenge-resolve-btn').addEventListener('click', () => {
         socket.emit('playerAction', { action: 'resolveSkillCheck' });
         document.getElementById('skill-challenge-modal').classList.add('hidden');
     });
     document.getElementById('skill-challenge-decline-btn').addEventListener('click', () => {
         document.getElementById('skill-challenge-modal').classList.add('hidden');
     });
}

// --- 4. MODAL & POPUP LOGIC ---
function switchMobileScreen(screenName) {
    document.querySelectorAll('.mobile-screen').forEach(s => s.classList.remove('active'));
    document.getElementById(`mobile-screen-${screenName}`).classList.add('active');
    document.querySelectorAll('.mobile-bottom-nav .nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelector(`.mobile-bottom-nav .nav-btn[data-screen="${screenName}"]`).classList.add('active');
}

function showToast(message, type = 'info', duration = 3000) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    
    // Add class to animate in
    setTimeout(() => {
        toast.classList.add('visible');
    }, 10);

    // Set timer to remove
    setTimeout(() => {
        toast.classList.remove('visible');
        toast.addEventListener('transitionend', () => toast.remove());
    }, duration);
}

function showChatPreview(sender, message) {
    const container = document.getElementById('chat-preview-container');
    const preview = document.createElement('div');
    preview.className = 'chat-preview-item';
    preview.innerHTML = `<span class="chat-preview-sender">${sender}:</span> ${message}`;
    container.appendChild(preview);

    setTimeout(() => {
        preview.classList.add('visible');
    }, 10);
    
    setTimeout(() => {
        preview.classList.remove('visible');
        preview.addEventListener('transitionend', () => preview.remove());
    }, 5000);
}

function showYourTurnPopup() {
    const popup = document.getElementById('your-turn-popup');
    popup.classList.remove('hidden');
    setTimeout(() => popup.classList.add('hidden'), 2500);
}

function showNarrativeModal(weaponId, targetId) {
    clientState.activeItem = { weaponId, targetId };
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
    clientState.activeItem = item;
    const playerList = document.getElementById('claim-loot-player-list');
    playerList.innerHTML = '';
    
    Object.values(currentRoomState.players).filter(p => p.role === 'Explorer').forEach(p => {
        const btn = document.createElement('button');
        btn.className = 'btn btn-secondary';
        btn.textContent = p.name;
        btn.onclick = () => {
            socket.emit('playerAction', { action: 'claimLoot', itemId: clientState.activeItem.id, targetPlayerId: p.id });
            document.getElementById('claim-loot-modal').classList.add('hidden');
            clientState.activeItem = null;
        };
        playerList.appendChild(btn);
    });

    document.getElementById('claim-loot-title').textContent = `Claim ${item.name}`;
    document.getElementById('claim-loot-modal').classList.remove('hidden');
}

function showDiscoveryModal({ newCard }) {
    const modal = document.getElementById('discovery-modal');
    const myPlayer = currentRoomState.players[myId];
    if (!myPlayer) return;

    const newItemContainer = document.getElementById('discovery-new-item-container');
    const equippedContainer = document.getElementById('discovery-equipped-container');
    const confirmBtn = document.getElementById('discovery-confirm-btn');

    const itemType = newCard.type.toLowerCase(); // 'weapon' or 'armor'
    const equippedCard = myPlayer.equipment[itemType];

    clientState.activeItem = { newCard, equippedCard, keptItemId: null };
    confirmBtn.disabled = true;

    newItemContainer.innerHTML = '';
    equippedContainer.innerHTML = '';

    const handleCardSelection = (cardEl, cardId) => {
        // Remove selection from all cards in this modal
        modal.querySelectorAll('.card').forEach(c => c.classList.remove('selected-for-discard'));
        cardEl.classList.add('selected-for-discard');
        clientState.activeItem.keptItemId = cardId;
        confirmBtn.disabled = false;
    };

    const newCardEl = createCardElement(newCard);
    newCardEl.onclick = () => handleCardSelection(newCardEl, newCard.id);
    newItemContainer.appendChild(newCardEl);

    const equippedCardEl = createCardElement(equippedCard); // createCardElement handles null
    if(equippedCard) {
        equippedCardEl.onclick = () => handleCardSelection(equippedCardEl, equippedCard.id);
    }
    equippedContainer.appendChild(equippedCardEl);

    modal.classList.remove('hidden');
}

function handleUseConsumable(card) {
    const effect = card.effect;
    if (effect.target === 'any-player') {
        clientState.activeItem = card;
        const playerList = document.getElementById('claim-loot-player-list');
        playerList.innerHTML = '';
        Object.values(currentRoomState.players).filter(p => p.role === 'Explorer').forEach(p => {
            const btn = document.createElement('button');
            btn.className = 'btn btn-secondary';
            btn.textContent = p.name;
            btn.onclick = () => {
                socket.emit('playerAction', { action: 'useConsumable', cardId: clientState.activeItem.id, targetId: p.id });
                document.getElementById('claim-loot-modal').classList.add('hidden');
                clientState.activeItem = null;
            };
            playerList.appendChild(btn);
        });
        document.getElementById('claim-loot-title').textContent = `Use ${card.name} on...`;
        document.getElementById('claim-loot-modal').classList.remove('hidden');
    } else if (effect.target === 'any-monster') {
        const firstMonster = currentRoomState.gameState.board.monsters[0];
        if (firstMonster) {
            socket.emit('playerAction', { action: 'useConsumable', cardId: card.id, targetId: firstMonster.id });
        } else {
            showToast('No monsters to target!', 'error');
        }
    } else {
        socket.emit('playerAction', { action: 'useConsumable', cardId: card.id, targetId: myId });
    }
}

function showSkillChallengeModal(challenge) {
    document.getElementById('skill-challenge-title').textContent = challenge.name;
    document.getElementById('skill-challenge-description').textContent = challenge.description;
    document.getElementById('skill-challenge-modal').classList.remove('hidden');
}

// Help Modal Logic
const helpPages = [
    {
        title: "Welcome to Quest & Chronicle",
        content: `
            <p>This is a cooperative dungeon-crawling adventure. Your goal is to survive the challenges thrown at you by the Dungeon Master (DM) and emerge victorious.</p>
            <h3>Game Flow</h3>
            <ul>
                <li>The game proceeds in rounds, starting with the DM.</li>
                <li>On your turn, you'll use Action Points (AP) to perform actions like attacking, using items, or resting.</li>
                <li>The DM will spawn monsters and trigger world events to challenge the party.</li>
            </ul>
        `
    },
    {
        title: "Your Character Stats",
        content: `
            <p>Your character's abilities are defined by several key stats:</p>
            <ul>
                <li><b>HP (Health Points):</b> Your life force. If it reaches 0, you are Downed.</li>
                <li><b>AP (Action Points):</b> The resource you spend each turn to take actions.</li>
                <li><b>Damage Bonus:</b> Added to your damage rolls when you hit with a weapon.</li>
                <li><b>Shield Bonus:</b> Your defense. Monsters must roll higher than 10 + your Shield Bonus to hit you.</li>
                <li><b>Hit Bonus:</b> Added to your d20 roll when you attack.</li>
                <li><b>Core Stats (STR, DEX, etc.):</b> These influence class abilities and may be used for skill checks.</li>
            </ul>
        `
    },
    {
        title: "Common Actions",
        content: `
            <p>On your turn, you can spend AP on these actions from the action bar:</p>
            <ul>
                <li><b>Guard (1 AP):</b> Gain temporary Shield HP equal to your Shield Bonus. This lasts until the start of your next turn.</li>
                <li><b>Respite (1 AP):</b> A quick breather. Heals you for a small amount (1d4).</li>
                <li><b>Rest (2 AP):</b> A longer rest. Heals you based on your class's Health Dice.</li>
                <li><b>Equip (1 AP):</b> From your hand, click the "Equip" button on a Weapon or Armor card.</li>
            </ul>
            <p>Attacking and using card abilities also cost AP, as listed on the card.</p>
        `
    },
    {
        title: "Combat Explained",
        content: `
            <p>Combat is resolved with a two-step dice roll process.</p>
            <h3>How to Attack</h3>
            <ol>
                <li><b>Select Weapon:</b> Click on one of your equipped weapons. It will gain a golden border to show it's selected.</li>
                <li><b>Select Target:</b> Click on a monster on the game board. This will open a prompt to confirm your attack.</li>
            </ol>
            <h3>The Dice Roll</h3>
            <ol>
                <li><b>Roll to Hit:</b> You roll a 20-sided die (d20). The result is <b>(Your d20 Roll + Your Hit Bonus)</b>. If this total meets or exceeds the monster's Armor Class (AC), you hit!</li>
                <li><b>Roll for Damage:</b> On a successful hit, you roll your weapon's damage dice. The total damage is <b>(Your Damage Roll + Your Damage Bonus)</b>.</li>
            </ol>
        `
    },
    {
        title: "Items & Loot",
        content: `
            <p>Defeating monsters and overcoming challenges can reward the party with loot.</p>
            <ul>
                <li><b>Rarity:</b> Items can be Common, Uncommon (Green), Rare (Blue), or Legendary (Purple). Higher rarities provide better bonuses.</li>
                <li><b>Claiming Loot:</b> When an item is discovered, it appears in the "Party Discoveries" tab. Any player can click "Claim" to assign it to a party member.</li>
                <li><b>Individual Discovery:</b> Every 3 rounds, you'll get a personal chance to find a rare item and swap it with your currently equipped gear of the same type.</li>
            </ul>
        `
    },
];

function renderHelpPage() {
    const page = helpPages[clientState.helpModalPage];
    document.getElementById('help-content').innerHTML = `<h3>${page.title}</h3>${page.content}`;
    document.getElementById('help-page-indicator').textContent = `Page ${clientState.helpModalPage + 1} / ${helpPages.length}`;
    document.getElementById('help-prev-btn').disabled = clientState.helpModalPage === 0;
    document.getElementById('help-next-btn').disabled = clientState.helpModalPage === helpPages.length - 1;
}

function showHelpModal() {
    clientState.helpModalPage = 0;
    renderHelpPage();
    document.getElementById('help-modal').classList.remove('hidden');
}

function hideHelpModal() {
    document.getElementById('help-modal').classList.add('hidden');
}

function navigateHelpModal(direction) {
    const newPage = clientState.helpModalPage + direction;
    if (newPage >= 0 && newPage < helpPages.length) {
        clientState.helpModalPage = newPage;
        renderHelpPage();
    }
}


// --- 5. DICE ROLLING LOGIC ---
function createDieSVG(sides, value) {
    const text = value || '?';
    let dieShapePath = '';
    // Adjust y-position of text for better centering on different shapes
    let textY = 55; 
    let sidesTextY = 85;

    switch (Number(sides)) {
        case 4:
        case 20: // d20 face is a triangle
            dieShapePath = 'M 50,10 L 95,85 L 5,85 Z';
            textY = 65;
            sidesTextY = 88;
            break;
        case 8:
            dieShapePath = 'M 50,5 L 95,50 L 50,95 L 5,50 Z';
            sidesTextY = 90;
            break;
        case 10:
            dieShapePath = 'M 50,5 L 95,40 L 80,95 L 20,95 L 5,40 Z';
            sidesTextY = 88;
            break;
        case 12:
            dieShapePath = 'M 50,10 L 95,45 L 75,95 L 25,95 L 5,45 Z';
            sidesTextY = 88;
            break;
        case 6:
        default: // Default to d6 shape
            dieShapePath = 'M 10,10 H 90 V 90 H 10 Z';
            break;
    }

    return `
        <svg class="die-svg" viewBox="0 0 100 100">
            <path class="die-shape" d="${dieShapePath}" />
            <text class="die-text" x="50" y="${textY}" dominant-baseline="middle" text-anchor="middle">${text}</text>
            <text class="die-sides-text" x="50" y="${sidesTextY}" dominant-baseline="middle" text-anchor="middle">d${sides}</text>
        </svg>
    `;
}


function showDiceRollModal(data, type) {
    clientState.currentRollData = { ...data, type }; // type is 'attack', 'damage', 'skillcheck', or 'discovery'
    const { title, dice, bonus, targetAC, description } = data;
    const modal = document.getElementById('dice-roll-modal');
    document.getElementById('dice-roll-title').textContent = title;
    
    let desc = description || `Roll ${dice}`;
    if (bonus > 0) desc += ` + ${bonus}`;
    if (bonus < 0) desc += ` - ${Math.abs(bonus)}`;
    if (targetAC) desc += ` vs Target AC of ${targetAC}`;
    document.getElementById('dice-roll-description').textContent = desc;

    const container = document.getElementById('dice-display-container');
    const [num, sides] = dice.split('d').map(Number);
    container.innerHTML = createDieSVG(sides, '?');

    document.getElementById('dice-roll-result-container').classList.add('hidden');
    document.getElementById('dice-roll-result-line').textContent = '';
    document.getElementById('dice-roll-damage-line').textContent = '';
    document.getElementById('dice-roll-details').textContent = '';
    
    const confirmBtn = document.getElementById('dice-roll-confirm-btn');
    confirmBtn.textContent = 'Roll Dice';
    confirmBtn.classList.remove('hidden');
    confirmBtn.disabled = false;
    document.getElementById('dice-roll-close-btn').classList.add('hidden');
    
    modal.classList.remove('hidden');
}

function handleDiceRoll() {
    if (!clientState.currentRollData) return;
    
    document.getElementById('dice-roll-confirm-btn').disabled = true;
    const container = document.getElementById('dice-display-container');
    const dieSVG = container.querySelector('.die-svg');
    const dieText = dieSVG.querySelector('.die-text');
    const [num, sides] = clientState.currentRollData.dice.split('d').map(Number);

    if (clientState.diceAnimationInterval) clearInterval(clientState.diceAnimationInterval);
    clientState.diceAnimationInterval = setInterval(() => {
        dieText.textContent = Math.ceil(Math.random() * sides);
    }, 50);

    dieSVG.classList.add('rolling');
    
    const actionMap = {
        'attack': 'resolveAttackRoll',
        'damage': 'resolveDamageRoll',
        'skillcheck': 'resolveSkillCheckRoll',
        'discovery': 'resolveDiscoveryRoll',
    };
    const action = actionMap[clientState.currentRollData.type];
    if (action) {
        socket.emit('playerAction', { action: action, ...clientState.currentRollData });
    }

    // Add a timeout for robustness.
    if (clientState.rollResponseTimeout) clearTimeout(clientState.rollResponseTimeout);
    clientState.rollResponseTimeout = setTimeout(() => {
        // This will only fire if we don't get a response from the server.
        if (clientState.diceAnimationInterval) {
            clearInterval(clientState.diceAnimationInterval);
            clientState.diceAnimationInterval = null;

            if (dieSVG) {
                dieSVG.classList.remove('rolling');
                dieSVG.querySelector('.die-text').textContent = 'ERR';
            }
            
            showToast("No response from server. Roll cancelled.", 'error');
            
            // Update modal UI to show it's over
            document.getElementById('dice-roll-confirm-btn').classList.add('hidden');
            document.getElementById('dice-roll-confirm-btn').disabled = false; // Reset for next time
            document.getElementById('dice-roll-close-btn').classList.remove('hidden');
        }
    }, 5000); // 5-second timeout
}

function displayAttackRollResult(data) {
    const { roll, bonus, total, outcome, rollerId } = data;
    
    // Non-rollers see a simple toast
    if (rollerId !== myId) {
        showToast(`${data.rollerName} attacks ${data.targetName}... ${total} is a ${outcome}!`, outcome.toLowerCase());
        return;
    }
    
    // Roller gets the full modal experience
    // Clear the response timeout since we got a response.
    if (clientState.rollResponseTimeout) clearTimeout(clientState.rollResponseTimeout);
    clientState.rollResponseTimeout = null;

    const MIN_ANIMATION_TIME = 750; // milliseconds
    
    setTimeout(() => {
        if (clientState.diceAnimationInterval) clearInterval(clientState.diceAnimationInterval);
        clientState.diceAnimationInterval = null;

        const container = document.getElementById('dice-display-container');
        const dieSVG = container.querySelector('.die-svg');
        if (dieSVG) {
            dieSVG.classList.remove('rolling');
            dieSVG.querySelector('.die-text').textContent = roll;
            dieSVG.querySelector('.die-shape').style.fill = outcome === 'Hit' ? 'var(--color-success-dark)' : 'var(--color-danger-dark)';
            
            dieSVG.classList.add('result-glow');
            setTimeout(() => dieSVG.classList.remove('result-glow'), 1000);
        }
        
        // Show result text after the die has landed
        setTimeout(() => {
            showToast(`${data.rollerName} attacks ${data.targetName}... ${total} is a ${outcome}!`, outcome.toLowerCase());

            const resultContainer = document.getElementById('dice-roll-result-container');
            const resultLine = document.getElementById('dice-roll-result-line');
            const detailsLine = document.getElementById('dice-roll-details');
            
            resultLine.textContent = `${total} - ${outcome.toUpperCase()}!`;
            resultLine.className = `result-line ${outcome.toLowerCase()}`;
            detailsLine.textContent = `(Roll: ${roll} + Bonus: ${bonus})`;
            
            resultContainer.classList.remove('hidden');
            document.getElementById('dice-roll-confirm-btn').classList.add('hidden');

            if (outcome === 'Miss') {
                if(clientState.rollModalCloseTimeout) clearTimeout(clientState.rollModalCloseTimeout);
                clientState.rollModalCloseTimeout = setTimeout(() => {
                    document.getElementById('dice-roll-modal').classList.add('hidden');
                }, 3000);
                document.getElementById('dice-roll-close-btn').classList.remove('hidden');
            }
            // If it's a hit, we wait for the server to send the damage roll prompt.
        }, 300);

    }, MIN_ANIMATION_TIME);
}

function displayDamageRollResult(data) {
    const { rollerId, totalDamage, damageRoll, damageBonus, targetId } = data;
    
    // Animate monster shake and toast for everyone
    showToast(`${data.rollerName} dealt ${totalDamage} damage to ${data.targetName}!`, 'hit');
    const monsterCard = document.querySelector(`.card[data-monster-id="${targetId}"]`);
    if (monsterCard) {
        monsterCard.classList.add('shake');
        setTimeout(() => monsterCard.classList.remove('shake'), 820);
    }
    
    // Roller gets the modal update
    if (rollerId !== myId) return;
    
    if (clientState.rollResponseTimeout) clearTimeout(clientState.rollResponseTimeout);
    clientState.rollResponseTimeout = null;

    const MIN_ANIMATION_TIME = 750; // milliseconds

    setTimeout(() => {
        if (clientState.diceAnimationInterval) clearInterval(clientState.diceAnimationInterval);
        clientState.diceAnimationInterval = null;
        
        const dieSVG = document.querySelector('#dice-display-container .die-svg');
        if(dieSVG) {
            dieSVG.classList.remove('rolling');
            dieSVG.querySelector('.die-text').textContent = damageRoll;
            dieSVG.querySelector('.die-shape').style.fill = 'var(--color-special-dark)';

            dieSVG.classList.add('result-glow');
            setTimeout(() => dieSVG.classList.remove('result-glow'), 1000);
        }

        setTimeout(() => {
            const damageLine = document.getElementById('dice-roll-damage-line');
            damageLine.textContent = `Dealt ${totalDamage} damage!`;
            document.getElementById('dice-roll-details').textContent = `(Roll: ${damageRoll} + Bonus: ${damageBonus})`;
            damageLine.classList.remove('hidden');

            if(clientState.rollModalCloseTimeout) clearTimeout(clientState.rollModalCloseTimeout);
            clientState.rollModalCloseTimeout = setTimeout(() => {
                document.getElementById('dice-roll-modal').classList.add('hidden');
            }, 4000);
            document.getElementById('dice-roll-close-btn').classList.remove('hidden');
        }, 300);
    }, MIN_ANIMATION_TIME);
}

function displaySkillCheckRollResult(data) {
    const { rollerId, roll, bonus, total, outcome } = data;

    // Show a toast for everyone.
    showToast(`${data.rollerName}'s skill check... ${total} is a ${outcome}!`, outcome.toLowerCase());

    // Only the roller sees the modal update.
    if (rollerId !== myId) return;

    if (clientState.rollResponseTimeout) clearTimeout(clientState.rollResponseTimeout);
    clientState.rollResponseTimeout = null;

    const MIN_ANIMATION_TIME = 750;
    setTimeout(() => {
        if (clientState.diceAnimationInterval) clearInterval(clientState.diceAnimationInterval);
        clientState.diceAnimationInterval = null;

        const dieSVG = document.querySelector('#dice-display-container .die-svg');
        if (dieSVG) {
            dieSVG.classList.remove('rolling');
            dieSVG.querySelector('.die-text').textContent = roll;
            dieSVG.querySelector('.die-shape').style.fill = outcome === 'Success' ? 'var(--color-success-dark)' : 'var(--color-danger-dark)';
            dieSVG.classList.add('result-glow');
            setTimeout(() => dieSVG.classList.remove('result-glow'), 1000);
        }

        setTimeout(() => {
            const resultContainer = document.getElementById('dice-roll-result-container');
            const resultLine = document.getElementById('dice-roll-result-line');
            const detailsLine = document.getElementById('dice-roll-details');

            resultLine.textContent = `${total} - ${outcome.toUpperCase()}!`;
            resultLine.className = `result-line ${outcome.toLowerCase()}`;
            detailsLine.textContent = `(Roll: ${roll} + Bonus: ${bonus})`;

            resultContainer.classList.remove('hidden');
            document.getElementById('dice-roll-confirm-btn').classList.add('hidden');
            document.getElementById('dice-roll-close-btn').classList.remove('hidden');

            if (clientState.rollModalCloseTimeout) clearTimeout(clientState.rollModalCloseTimeout);
            clientState.rollModalCloseTimeout = setTimeout(() => {
                document.getElementById('dice-roll-modal').classList.add('hidden');
            }, 3000);
        }, 300);
    }, MIN_ANIMATION_TIME);
}


// --- 6. SOCKET.IO EVENT HANDLERS ---
socket.on('gameStateUpdate', (newState) => {
    const oldState = currentRoomState;
    currentRoomState = newState;
    myId = socket.id;

    // Check for "Your Turn" popup trigger and tutorial
    const myPlayer = newState.players[myId];
    if(myPlayer) {
        const isMyTurnNow = newState.gameState.turnOrder[newState.gameState.currentPlayerIndex] === myId;
        const wasMyTurnBefore = oldState.gameState ? oldState.gameState.turnOrder[oldState.gameState.currentPlayerIndex] === myId : false;
        if(isMyTurnNow && !wasMyTurnBefore && !myPlayer.isDowned) {
            showYourTurnPopup();
            clientState.hasSeenSkillChallengePrompt = false; // Reset challenge prompt on new turn start
            // First turn tutorial logic
            if (!myPlayer.hasTakenFirstTurn) {
                clientState.isFirstTurnTutorialActive = true;
                setTimeout(() => showToast("It's your turn! Click an equipped weapon to begin an attack.", "info", 6000), 500);
            }
        }
    }

    renderUI();
});

socket.on('playerIdentity', ({ playerId, roomId }) => {
    sessionStorage.setItem('qc_playerId', playerId);
    sessionStorage.setItem('qc_roomId', roomId);
});

socket.on('roomClosed', ({ message }) => {
    showToast(message, 'error');
    voiceChatManager.leave();
    setTimeout(() => {
        sessionStorage.removeItem('qc_roomId');
        sessionStorage.removeItem('qc_playerId');
        window.location.reload();
    }, 3000);
});


socket.on('actionError', (message) => {
    showToast(message, 'error');
});

socket.on('diceRollError', () => {
    if (clientState.diceAnimationInterval) clearInterval(clientState.diceAnimationInterval);
    if (clientState.rollResponseTimeout) clearTimeout(clientState.rollResponseTimeout);
    clientState.diceAnimationInterval = null;
    clientState.rollResponseTimeout = null;
    clientState.currentRollData = null;
    document.getElementById('dice-roll-modal').classList.add('hidden');
});

socket.on('promptAttackRoll', (data) => {
    showDiceRollModal(data, 'attack');
});

socket.on('promptDamageRoll', (data) => {
    showDiceRollModal(data, 'damage');
});

socket.on('attackResolved', (data) => {
    displayAttackRollResult(data);
});

socket.on('damageResolved', (data) => {
    displayDamageRollResult(data);
});

socket.on('promptDiscoveryRoll', (data) => {
    showDiceRollModal(data, 'discovery');
});

socket.on('discoveryRollResolved', (data) => {
    if (data.rollerId !== myId) return;

    if (clientState.rollResponseTimeout) clearTimeout(clientState.rollResponseTimeout);
    clientState.rollResponseTimeout = null;
    
    if (clientState.diceAnimationInterval) clearInterval(clientState.diceAnimationInterval);
    clientState.diceAnimationInterval = null;

    const dieSVG = document.querySelector('#dice-display-container .die-svg');
    if (dieSVG) {
        dieSVG.classList.remove('rolling');
        dieSVG.querySelector('.die-text').textContent = data.roll;
        
        let outcome = 'A decent find.';
        let outcomeClass = 'info';
        if (data.roll <= 10) { outcome = 'A common find.'; outcomeClass = 'miss'; }
        else if (data.roll <= 15) { outcome = 'An uncommon find!'; outcomeClass = 'hit'; }
        else if (data.roll <= 19) { outcome = 'A rare find!'; outcomeClass = 'hit'; }
        else { outcome = 'A legendary find!'; outcomeClass = 'hit'; }

        const resultLine = document.getElementById('dice-roll-result-line');
        resultLine.textContent = `You rolled a ${data.roll}!`;
        resultLine.className = `result-line ${outcomeClass}`;
        document.getElementById('dice-roll-details').textContent = outcome;
        document.getElementById('dice-roll-result-container').classList.remove('hidden');
        document.getElementById('dice-roll-confirm-btn').classList.add('hidden');
    }
});


socket.on('promptSkillCheckRoll', (data) => {
    showDiceRollModal(data, 'skillcheck');
});

socket.on('skillCheckResolved', (data) => {
    displaySkillCheckRollResult(data);
});


socket.on('promptIndividualDiscovery', (data) => {
    // If a dice roll modal was open for discovery, close it after a delay
    if (clientState.currentRollData?.type === 'discovery') {
        setTimeout(() => {
            document.getElementById('dice-roll-modal').classList.add('hidden');
            showDiscoveryModal(data);
        }, 2000); // Wait 2 seconds to show the roll result before swapping modals
    } else {
        showDiscoveryModal(data);
    }
});

socket.on('chooseToDiscard', ({ newCard, currentHand }) => {
    const modal = document.getElementById('choose-discard-modal');
    const newCardContainer = document.getElementById('new-card-to-discard-container');
    const handContainer = document.getElementById('hand-cards-to-discard-container');
    const confirmBtn = document.getElementById('confirm-discard-btn');

    clientState.activeItem = { newCard, selectedCardId: null };
    confirmBtn.disabled = true;

    newCardContainer.innerHTML = '';
    handContainer.innerHTML = '';

    const newCardEl = createCardElement(newCard);
    newCardEl.onclick = () => {
        document.querySelectorAll('.discard-choice-section .card').forEach(c => c.classList.remove('selected-for-discard'));
        newCardEl.classList.add('selected-for-discard');
        clientState.activeItem.selectedCardId = newCard.id;
        confirmBtn.disabled = false;
    };
    newCardContainer.appendChild(newCardEl);

    currentHand.forEach(card => {
        const cardEl = createCardElement(card);
        cardEl.onclick = () => {
            document.querySelectorAll('.discard-choice-section .card').forEach(c => c.classList.remove('selected-for-discard'));
            cardEl.classList.add('selected-for-discard');
            clientState.activeItem.selectedCardId = card.id;
            confirmBtn.disabled = false;
        };
        handContainer.appendChild(cardEl);
    });

    modal.classList.remove('hidden');
});

// Voice Chat Signaling Handlers
socket.on('existing-voice-chatters', (chatterIds) => {
    chatterIds.forEach(id => voiceChatManager.addPeer(id, true));
});
socket.on('new-voice-chatter', (chatterId) => {
    voiceChatManager.addPeer(chatterId, true);
});
socket.on('voice-chatter-left', (chatterId) => {
    voiceChatManager.removePeer(chatterId);
});
socket.on('webrtc-signal', (data) => {
    voiceChatManager.handleSignal(data);
});


// --- INITIALIZE ---
initializeUI();