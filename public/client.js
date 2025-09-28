// This file contains all client-side JavaScript logic for the Quest & Chronicle game.
// NOTE: This file is a partial reconstruction to demonstrate the specific bug fix. 
// Many UI rendering and event handling functions are omitted for brevity.

const socket = io();

// --- Client State ---
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
let apModalShownThisTurn = false;
const modalQueue = [];
let isModalActive = false;
let currentSkipHandler = null; 

// --- START: Bug Fix for Animation Race Condition ---
// This flag prevents other modals (like the 'Out of AP' modal) from appearing
// while a blocking animation (like an attack sequence) is in progress.
let isPerformingAction = false;
// --- END: Bug Fix ---

// --- DOM Elements (Partial) ---
const getEl = (id) => document.getElementById(id);
const diceRollOverlay = getEl('dice-roll-overlay');
const diceRollTitle = getEl('dice-roll-title');
const diceRollResult = getEl('dice-roll-result');
const diceRollContinueBtn = getEl('dice-roll-continue-btn');
const apModal = getEl('ap-modal');
const apModalCancelBtn = getEl('ap-modal-cancel-btn');
const apModalConfirmBtn = getEl('ap-modal-confirm-btn');

// --- Socket Event Handlers ---

// Main game state renderer (abbreviated)
socket.on('gameStateUpdate', (room) => {
    const isMyTurnNow = room.gameState.turnOrder[room.gameState.currentPlayerIndex] === socket.id;

    if (isMyTurnNow && !isMyTurnPreviously) {
        // Start of my turn, reset turn-specific flags
        apModalShownThisTurn = false; 
    }
    isMyTurnPreviously = isMyTurnNow;
    
    currentRoomState = room;
    myId = socket.id;
    myPlayerInfo = room.players[myId];

    // Other rendering logic would go here (board, hand, players, etc.)
    
    // Check if the current player is out of AP
    if (myPlayerInfo && myPlayerInfo.currentAp <= 0 && isMyTurnNow) {
        showAPModal();
    }
});

// Player attack animation
socket.on('attackAnimation', (data) => {
    // --- START: Bug Fix ---
    // Set the flag to block other modals
    isPerformingAction = true;
    // --- END: Bug Fix ---
    
    const attacker = currentRoomState.players[data.attackerId];
    const target = currentRoomState.gameState.board.monsters.find(m => m.id === data.targetId);
    
    diceRollTitle.textContent = `${attacker.name} Attacks!`;
    
    let resultHTML = `<p class="result-line ${data.hit ? 'hit' : 'miss'}">${data.isCrit ? "CRITICAL HIT!" : data.isFumble ? "FUMBLE!" : data.hit ? "HIT!" : "MISS!"}</p>`;
    resultHTML += `<p class="roll-details">Roll: ${data.d20Roll} + ${data.damageBonus} = <strong>${data.totalRollToHit}</strong> vs DC ${data.requiredRoll}</p>`;
    if (data.hit) {
        resultHTML += `<p class="roll-details">Damage: ${data.rawDamageRoll}(dice) + ${data.damageBonus} = <strong>${data.totalDamage}</strong></p>`;
    }

    diceRollResult.innerHTML = resultHTML;
    
    // Show the modal and prepare the continue button
    diceRollContinueBtn.classList.remove('hidden');
    diceRollResult.classList.remove('hidden');
    diceRollOverlay.classList.remove('hidden');
    
    const continueHandler = () => {
        diceRollOverlay.classList.add('hidden');
        diceRollContinueBtn.classList.add('hidden');
        diceRollContinueBtn.removeEventListener('click', continueHandler);
        
        // --- START: Bug Fix ---
        // Clear the flag once the animation sequence is complete
        isPerformingAction = false;
        // Check for AP modal again in case AP dropped to 0 from the last action
        if (myPlayerInfo && myPlayerInfo.currentAp <= 0 && isMyTurnPreviously) {
            showAPModal();
        }
        // --- END: Bug Fix ---
    };
    diceRollContinueBtn.addEventListener('click', continueHandler);
});

// Monster attack animation
socket.on('monsterAttackAnimation', (data) => {
    // --- START: Bug Fix ---
    // Set the flag to block other modals
    isPerformingAction = true;
    // --- END: Bug Fix ---

    const attacker = currentRoomState.gameState.board.monsters.find(m => m.id === data.attackerId);
    const target = currentRoomState.players[data.targetId];

    diceRollTitle.textContent = `${attacker.name} Attacks!`;

    let resultHTML = `<p class="result-line ${data.hit ? 'hit' : 'miss'}">${data.isCrit ? "CRITICAL HIT!" : data.isFumble ? "FUMBLE!" : data.hit ? "HIT!" : "MISS!"}</p>`;
    resultHTML += `<p class="roll-details">Roll: ${data.d20Roll} + ${data.attackBonus} = <strong>${data.totalRollToHit}</strong> vs DC ${data.requiredRoll}</p>`;
    if (data.hit) {
        resultHTML += `<p class="roll-details">Damage: <strong>${data.totalDamage}</strong></p>`;
    }
    
    diceRollResult.innerHTML = resultHTML;
    
    diceRollContinueBtn.classList.remove('hidden');
    diceRollResult.classList.remove('hidden');
    diceRollOverlay.classList.remove('hidden');

    const continueHandler = () => {
        diceRollOverlay.classList.add('hidden');
        diceRollContinueBtn.classList.add('hidden');
        diceRollContinueBtn.removeEventListener('click', continueHandler);

        // --- START: Bug Fix ---
        // Clear the flag once the animation sequence is complete
        isPerformingAction = false;
        // --- END: Bug Fix ---
    };
    diceRollContinueBtn.addEventListener('click', continueHandler);
});


// --- Modal Logic (Partial) ---

function showAPModal() {
    // --- START: Bug Fix ---
    // Do not show the AP modal if another action/animation is in progress.
    if (isPerformingAction || apModalShownThisTurn) {
        return;
    }
    // --- END: Bug Fix ---
    
    apModalShownThisTurn = true;
    apModal.classList.remove('hidden');
}

apModalCancelBtn.addEventListener('click', () => apModal.classList.add('hidden'));
apModalConfirmBtn.addEventListener('click', () => {
    socket.emit('endTurn');
    apModal.classList.add('hidden');
});

// Assume other event listeners and functions exist to make the app function.
// For example, lobby connections, card rendering, action buttons, etc.
// This example focuses on the specific race condition fix.
