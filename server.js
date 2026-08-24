const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const UEFA_CLUBS = [
    "Ajax", "Arsenal", "Atalanta (Bergamo Calcio)", "Athletic Bilbao", "Atlético Madrid", "Barcelona", "Bayer Leverkusen", "Bayern Munich", "Benfica", "Bodø/Glimt", "Borussia Dortmund", "Chelsea", "Club Brugge", "Copenhagen", "Eintracht Frankfurt", "Galatasaray", "Inter Milan (Lombardia FC)", "Juventus", "Liverpool", "Manchester City", "Marseille", "Monaco", "Napoli", "Newcastle United", "Olympiacos", "Paris Saint-Germain", "PSV Eindhoven", "Qarabağ", "Real Madrid", "Slavia Prague", "Sporting CP", "Tottenham Hotspur", "Union Saint-Gilloise", "Villarreal",
    "Aston Villa", "Basel", "Bologna", "Braga", "Brann", "Celta Vigo", "Celtic", "Dinamo Zagreb", "FCSB", "Fenerbahçe", "Ferencváros", "Feyenoord", "Genk", "Go Ahead Eagles", "Lille", "Lyon", "Malmö FF", "Midtjylland", "Nice", "Nottingham Forest", "Panathinaikos", "PAOK", "Porto", "Rangers", "Real Betis", "Red Bull Salzburg", "Roma", "SC Freiburg", "Sturm Graz", "Utrecht", "VfB Stuttgart", "Viktoria Plzeň", "Young Boys",
    "Aberdeen", "AEK Athens", "AZ", "BK Häcken", "Crystal Palace", "Dynamo Kyiv", "Fiorentina", "Jagiellonia Białystok", "Lausanne-Sport", "Lech Poznań", "Legia Warsaw", "Mainz 05", "Raków Częstochowa", "Rapid Wien", "Rayo Vallecano", "Samsunspor", "Shakhtar Donetsk", "Shamrock Rovers", "Shelbourne", "Sparta Prague", "Strasbourg", "Universitatea Craiova"
];

const RARITY_TIERS = ["Base Card", "Man of the Match", "Wildcard", "All-Action Hero", "Heritage", "Counter Attax", "Stealth Strike", "100 Club", "101 Club", "Infinity"];
const RARITY_WEIGHTS = [32.0, 15.0, 10.0, 10.0, 8.0, 8.0, 6.0, 5.0, 4.0, 2.0];

let gameState = { 
    managers: {}, 
    auctionHistory: [], 
    soldPlayers: [], 
    cardOnBlock: null,
    gameMode: null,
    draftSystem: "Auction", // NEW: "Auction" or "Draft"
    turnOrder: [],
    currentTurnIndex: 0,
    auctionStatus: "Lobby",
    bracket: null,
    // Draft specific tracking
    draftRound: 1,
    draftPick: -1,
    activeDraftManager: null
};

let socketToManager = {};
let timerInterval;

function calculateBaseStats(pos, atts) {
    let atk = 0, dfc = 0;
    const PAS = parseInt(atts.s1)||0, PAC = parseInt(atts.s2)||0, DRI = parseInt(atts.s3)||0, SHO = parseInt(atts.s4)||0;
    const DEF = parseInt(atts.s5)||0, PHY = parseInt(atts.s6)||0;

    if (pos === 'CB') { atk = Math.round(0.45*PAS + 0.30*PAC + 0.15*DRI + 0.10*SHO); dfc = Math.round(0.65*DEF + 0.25*PHY + 0.10*PAC); } 
    else if (['RB', 'LB'].includes(pos)) { atk = Math.round(0.35*PAC + 0.35*PAS + 0.20*DRI + 0.10*SHO); dfc = Math.round(0.50*DEF + 0.25*PHY + 0.25*PAC); } 
    else if (pos === 'CDM') { atk = Math.round(0.40*PAS + 0.25*DRI + 0.20*PAC + 0.15*SHO); dfc = Math.round(0.55*DEF + 0.35*PHY + 0.10*PAC); } 
    else if (pos === 'CM') { atk = Math.round(0.35*PAS + 0.30*DRI + 0.20*SHO + 0.15*PAC); dfc = Math.round(0.45*DEF + 0.40*PHY + 0.15*PAC); } 
    else if (pos === 'CAM') { atk = Math.round(0.40*DRI + 0.35*PAS + 0.15*SHO + 0.10*PAC); dfc = Math.round(0.35*DEF + 0.35*PHY + 0.30*PAC); } 
    else if (['RM', 'LM', 'RW', 'LW'].includes(pos)) { atk = Math.round(0.35*PAC + 0.35*DRI + 0.15*SHO + 0.15*PAS); dfc = Math.round(0.30*DEF + 0.35*PHY + 0.35*PAC); } 
    else if (pos === 'ST') { atk = Math.round(0.50*SHO + 0.25*DRI + 0.15*PAC + 0.10*PAS); dfc = Math.round(0.65*DEF + 0.25*PHY + 0.10*PAC); } 
    else if (pos === 'GK') { atk = Math.round(0.20*PAS + 0.10*PAC); dfc = Math.round(0.25*DRI + 0.25*SHO + 0.25*DEF + 0.25*PHY); }
    return { atk, dfc };
}

function getWeightedRandom(items, weights) {
    let sum = weights.reduce((a, b) => a + b, 0);
    let rand = Math.random() * sum;
    for (let i = 0; i < items.length; i++) {
        rand -= weights[i];
        if (rand <= 0) return items[i];
    }
    return items[0];
}

function applyBoosts(card, pos, age, b_atk, b_def) {
    let atk = b_atk, dfc = b_def;
    if (card === "Man of the Match") { atk += 3; dfc += 3; }
    else if (card === "Wildcard" && ['CB','RB','LB','RM','LM','RW','LW','ST'].includes(pos)) { atk += 5; dfc += 5; }
    else if (card === "All-Action Hero" && ['CDM','CM','CAM','GK'].includes(pos)) { atk += 5; dfc += 5; }
    else if (card === "Heritage" && age > 30) { atk += 7; dfc += 7; }
    else if (card === "Counter Attax" && ['ST','RM','LM','RW','LW','LB','RB'].includes(pos)) { atk += 7; dfc += 3; }
    else if (card === "Stealth Strike") { if (['ST','RM','LM','RW','LW','CAM','CM'].includes(pos)) atk += 10; else if (['CB','RB','LB','CDM','GK'].includes(pos)) dfc += 10; }
    else if (card === "100 Club") { if (['ST','RM','LM','RW','LW','CAM','CM'].includes(pos)) atk = 100; else dfc = 100; }
    else if (card === "101 Club") { atk = 101; dfc = 101; }
    else if (card === "Infinity") { atk = "Infinity"; dfc = "Infinity"; }
    return { atk, dfc };
}

// ----------------------------------------------------
// DRAFT ENGINE LOGIC
// ----------------------------------------------------
function checkDraftEnd() {
    let allDone = true;
    for (let name of gameState.turnOrder) {
        let mgr = gameState.managers[name];
        if (mgr && mgr.Roster.length < 18 && !mgr.isDraftPassed) {
            allDone = false;
            break;
        }
    }
    if (allDone) {
        clearInterval(timerInterval);
        gameState.auctionStatus = "Completed";
        io.emit('updateState', gameState);
        return true;
    }
    return false;
}

function startDraftTimer() {
    clearInterval(timerInterval);
    let timeLeft = 180;
    io.emit('timerTick', timeLeft);
    
    timerInterval = setInterval(() => {
        timeLeft--;
        if (timeLeft <= 0) {
            clearInterval(timerInterval);
            autoDraftPunishment(gameState.activeDraftManager);
        } else {
            io.emit('timerTick', timeLeft);
        }
    }, 1000);
}

function autoDraftPunishment(mgrName) {
    let mgr = gameState.managers[mgrName];
    if (!mgr) return advanceDraftTurn();
    
    let punishmentCount = mgr.Roster.filter(p => p.Name.startsWith("Punishment Player")).length + 1;
    let pPlayer = {
        Name: `Punishment Player ${punishmentCount}`, Position: "N/A", CardType: "Base Card", 
        Attack: Math.floor(Math.random()*31)+30, Defence: Math.floor(Math.random()*31)+30, 
        BaseAttack: 0, BaseDefence: 0, Value: 0, isStarting: false 
    };
    
    mgr.Roster.push(pPlayer);
    gameState.auctionHistory.push({
        Player: pPlayer.Name, CardType: pPlayer.CardType, Rating: `${pPlayer.Attack}/${pPlayer.Defence}`, BasePrice: 0, FinalPrice: "Punishment", Winner: mgrName
    });
    
    io.emit('updateState', gameState);
    advanceDraftTurn();
}

function advanceDraftTurn() {
    if (checkDraftEnd()) return;

    let found = false;
    let attempts = 0;
    let maxAttempts = gameState.turnOrder.length * 20; 
    
    while (!found && attempts < maxAttempts) {
        gameState.draftPick++;
        if (gameState.draftPick >= gameState.turnOrder.length) {
            gameState.draftPick = 0;
            gameState.draftRound++;
        }
        
        if (gameState.draftRound > 18) {
            gameState.auctionStatus = "Completed";
            clearInterval(timerInterval);
            io.emit('updateState', gameState);
            return;
        }

        // Snake Draft logic: Forward on odd rounds, Backward on even rounds
        let index = gameState.draftRound % 2 !== 0 
            ? gameState.draftPick 
            : (gameState.turnOrder.length - 1 - gameState.draftPick); 
            
        let mgrName = gameState.turnOrder[index];
        let mgr = gameState.managers[mgrName];
        
        // Skip managers who are full or have toggled the Pass button
        if (mgr && mgr.Roster.length < 18 && !mgr.isDraftPassed) {
            gameState.activeDraftManager = mgrName;
            found = true;
            startDraftTimer();
        }
        attempts++;
    }
    
    if (!found) {
        gameState.auctionStatus = "Completed";
        clearInterval(timerInterval);
        io.emit('updateState', gameState);
    }
}

// ----------------------------------------------------
// AUCTION ENGINE LOGIC
// ----------------------------------------------------
function resolveAuction() {
    const card = gameState.cardOnBlock;
    if (card) {
        if (card.highestBidder) {
            const mgr = gameState.managers[card.highestBidder];
            mgr.Budget -= card.highestBid;
            mgr.Roster.push({ ...card, isStarting: false });
            gameState.soldPlayers.push(card.Name.toLowerCase());

            if (mgr.Budget <= 0) {
                let punishmentCount = mgr.Roster.filter(p => p.Name.startsWith("Punishment Player")).length + 1;
                while (mgr.Roster.length < 11) {
                    mgr.Roster.push({ 
                        Name: `Punishment Player ${punishmentCount}`, Position: "N/A", CardType: "Base Card", 
                        Attack: Math.floor(Math.random()*31)+30, Defence: Math.floor(Math.random()*31)+30, 
                        isStarting: false 
                    });
                    punishmentCount++;
                }
                mgr.Status = mgr.Roster.length === 11 ? "Auction Ended (Auto-filled)" : "Auction Ended (No extra subs)";
            } else if (mgr.Roster.length >= 18) {
                mgr.Status = "Auction Ended (Max 18 Players)";
            }

            gameState.auctionHistory.push({
                Player: card.Name, CardType: card.CardType, Rating: `${card.Attack}/${card.Defence}`, BasePrice: card.Value, FinalPrice: card.highestBid, Winner: card.highestBidder
            });
        } else {
            gameState.auctionHistory.push({
                Player: card.Name, CardType: card.CardType, Rating: `${card.Attack}/${card.Defence}`, BasePrice: card.Value, FinalPrice: 0, Winner: "Unsold"
            });
        }
    }
    
    gameState.cardOnBlock = null;
    gameState.currentTurnIndex = (gameState.currentTurnIndex + 1) % gameState.turnOrder.length;
    
    if (Object.values(gameState.managers).every(m => m.Status !== "Active")) {
        gameState.auctionStatus = "Completed";
    }
    io.emit('updateState', gameState);
}

function checkAuctionEndEarly() {
    if (!gameState.cardOnBlock) return;
    const activeMgrs = Object.keys(gameState.managers).filter(name => gameState.managers[name].Status === 'Active');
    const passedCount = gameState.cardOnBlock.passedManagers.filter(m => activeMgrs.includes(m)).length;
    let shouldEnd = false;
    
    if (gameState.cardOnBlock.highestBidder) {
        if (passedCount >= activeMgrs.length - 1) shouldEnd = true;
    } else {
        if (passedCount >= activeMgrs.length) shouldEnd = true;
    }

    if (shouldEnd) {
        clearInterval(timerInterval);
        resolveAuction();
    }
}

// ----------------------------------------------------
// SOCKET COMMUNICATION
// ----------------------------------------------------
io.on('connection', (socket) => {
    socket.emit('updateState', gameState);

    socket.on('resetEntireGame', () => {
        gameState = { managers: {}, auctionHistory: [], soldPlayers: [], cardOnBlock: null, gameMode: null, draftSystem: "Auction", turnOrder: [], currentTurnIndex: 0, auctionStatus: "Lobby", bracket: null, draftRound: 1, draftPick: -1, activeDraftManager: null };
        socketToManager = {};
        clearInterval(timerInterval);
        io.emit('updateState', gameState);
    });

    socket.on('resetAuction', () => {
        for (let m in gameState.managers) {
            gameState.managers[m].Budget = 1000000000;
            gameState.managers[m].Roster = [];
            gameState.managers[m].Status = "Active";
            gameState.managers[m].isDraftPassed = false;
        }
        gameState.auctionHistory = [];
        gameState.soldPlayers = [];
        gameState.cardOnBlock = null;
        gameState.turnOrder = [];
        gameState.currentTurnIndex = 0;
        gameState.gameMode = null;
        gameState.auctionStatus = "Lobby";
        gameState.bracket = null;
        gameState.draftRound = 1;
        gameState.draftPick = -1;
        gameState.activeDraftManager = null;
        clearInterval(timerInterval);
        io.emit('updateState', gameState);
    });

    socket.on('registerManager', (data) => {
        if (data.name && !gameState.managers[data.name]) {
            gameState.managers[data.name] = { Formation: data.formation, Budget: 1000000000, Roster: [], Status: "Active", isDraftPassed: false };
            socketToManager[socket.id] = data.name; 
            socket.emit('managerRegistered', data.name);
            io.emit('updateState', gameState);
        }
    });

    socket.on('removeManager', (name) => {
        delete gameState.managers[name];
        io.emit('updateState', gameState);
    });

    socket.on('startGame', (data) => {
        // Fallback checks for older clients
        let mode = typeof data === 'string' ? data : data.mode;
        let system = typeof data === 'string' ? "Auction" : (data.system || "Auction");

        const mgrCount = Object.keys(gameState.managers).length;
        if (mgrCount < 2) return socket.emit('auctionError', "You need at least 2 players to start a game!");

        if (mode.includes("Casual") && mgrCount !== 2) {
            return socket.emit('auctionError', "Casual modes require exactly 2 players!");
        }
        if (mode.includes("Tournament") && mgrCount > 16) {
            return socket.emit('auctionError', "Tournaments support a maximum of 16 players.");
        }

        gameState.gameMode = mode;
        gameState.draftSystem = system;
        const managers = Object.keys(gameState.managers);
        gameState.turnOrder = managers.sort(() => Math.random() - 0.5);
        gameState.auctionStatus = "Active";

        if (mode.includes("Tournament")) {
            const nextPow2 = Math.pow(2, Math.ceil(Math.log2(mgrCount)));
            const numByes = nextPow2 - mgrCount;
            const byePlayers = gameState.turnOrder.slice(0, numByes);
            const round1Players = gameState.turnOrder.slice(numByes);
            
            let matchups = [];
            for(let i=0; i<round1Players.length; i+=2) {
                if (round1Players[i+1]) matchups.push([round1Players[i], round1Players[i+1]]);
            }
            gameState.bracket = { totalPlayers: mgrCount, byes: byePlayers, round1: matchups };
        } else {
            gameState.bracket = null;
        }

        // Boot correct engine
        if (system === "Draft") {
            gameState.draftRound = 1;
            gameState.draftPick = -1;
            gameState.activeDraftManager = null;
            advanceDraftTurn();
        } else {
            gameState.currentTurnIndex = 0;
            io.emit('updateState', gameState);
        }
    });

    socket.on('submitPlayerEntry', (playerData) => {
        if (gameState.soldPlayers.includes(playerData.name.toLowerCase())) {
            return socket.emit('auctionError', `Player '${playerData.name}' has already been assigned to a team! No duplicates allowed.`);
        }

        const { atk: b_atk, dfc: b_def } = calculateBaseStats(playerData.position, playerData.stats);
        const age = parseInt(playerData.age) || 25;
        const isUefa = UEFA_CLUBS.includes(playerData.club);
        const pos = playerData.position;

        let cardType = "Base Card";

        if (isUefa) {
            let eligibleTiers = [];
            let eligibleWeights = [];
            for (let i = 0; i < RARITY_TIERS.length; i++) {
                const tier = RARITY_TIERS[i];
                const weight = RARITY_WEIGHTS[i];
                let isEligible = false;
                if (["Base Card", "Man of the Match", "Stealth Strike", "100 Club", "101 Club", "Infinity"].includes(tier)) isEligible = true; 
                else if (tier === "Wildcard" && ['CB','RB','LB','RM','LM','RW','LW','ST'].includes(pos)) isEligible = true;
                else if (tier === "All-Action Hero" && ['CDM','CM','CAM','GK'].includes(pos)) isEligible = true;
                else if (tier === "Heritage" && age > 30) isEligible = true;
                else if (tier === "Counter Attax" && ['ST','RM','LM','RW','LW','LB','RB'].includes(pos)) isEligible = true;

                if (isEligible) { eligibleTiers.push(tier); eligibleWeights.push(weight); }
            }
            cardType = getWeightedRandom(eligibleTiers, eligibleWeights);
        } else if (age > 30) {
            cardType = getWeightedRandom(["Base Card", "Heritage", "Infinity"], [90.0, 8.0, 2.0]);
        }

        const rawVal = String(playerData.value).replace(/,/g, '');
        const { atk: f_atk, dfc: f_def } = applyBoosts(cardType, pos, age, b_atk, b_def);

        // ROUTE LOGIC BASED ON GAME SYSTEM
        if (gameState.draftSystem === "Draft") {
            let mgrName = gameState.activeDraftManager;
            let mgr = gameState.managers[mgrName];
            if (!mgr) return;
            
            let newPlayer = {
                Name: playerData.name, Position: pos, Club: playerData.club, CardType: cardType, 
                Attack: f_atk, Defence: f_def, BaseAttack: b_atk, BaseDefence: b_def, 
                Value: parseInt(rawVal) || 1000000, isStarting: false
            };
            
            mgr.Roster.push(newPlayer);
            gameState.soldPlayers.push(playerData.name.toLowerCase());
            gameState.auctionHistory.push({
                Player: newPlayer.Name, CardType: newPlayer.CardType, Rating: `${newPlayer.Attack}/${newPlayer.Defence}`, BasePrice: newPlayer.Value, FinalPrice: "Drafted", Winner: mgrName
            });
            
            io.emit('updateState', gameState);
            advanceDraftTurn();

        } else {
            gameState.cardOnBlock = {
                Name: playerData.name, Position: pos, Club: playerData.club, CardType: cardType, 
                Attack: f_atk, Defence: f_def, BaseAttack: b_atk, BaseDefence: b_def, 
                Value: parseInt(rawVal) || 1000000, highestBid: 0, highestBidder: null, timeLeft: 180, passedManagers: []
            };
            io.emit('updateState', gameState);

            clearInterval(timerInterval);
            timerInterval = setInterval(() => {
                if (!gameState.cardOnBlock) { clearInterval(timerInterval); return; }
                gameState.cardOnBlock.timeLeft -= 1;
                if (gameState.cardOnBlock.timeLeft <= 0) {
                    clearInterval(timerInterval);
                    resolveAuction();
                } else {
                    io.emit('timerTick', gameState.cardOnBlock.timeLeft);
                }
            }, 1000);
        }
    });

    socket.on('toggleDraftPass', (data) => {
        const { mgrName, isPassing } = data;
        let mgr = gameState.managers[mgrName];
        if (!mgr || mgr.Roster.length < 11) return;
        
        mgr.isDraftPassed = isPassing;
        io.emit('updateState', gameState);
        
        if (isPassing && gameState.activeDraftManager === mgrName) {
            advanceDraftTurn();
        } else {
            checkDraftEnd();
        }
    });

    socket.on('togglePass', (data) => {
        if (gameState.draftSystem === "Draft") return;
        const { mgrName, isPassing } = data;
        if (!gameState.cardOnBlock || !gameState.managers[mgrName]) return;
        
        if (gameState.cardOnBlock.highestBidder === mgrName) {
            return socket.emit('auctionError', "You cannot pass while holding the highest bid!");
        }

        if (isPassing) {
            if (!gameState.cardOnBlock.passedManagers.includes(mgrName)) gameState.cardOnBlock.passedManagers.push(mgrName);
        } else {
            gameState.cardOnBlock.passedManagers = gameState.cardOnBlock.passedManagers.filter(m => m !== mgrName);
        }

        io.emit('updateState', gameState);
        checkAuctionEndEarly(); 
    });

    socket.on('placeBid', (data) => {
        if (gameState.draftSystem === "Draft") return;
        const { mgrName, bidAmount } = data;
        const mgr = gameState.managers[mgrName];
        const bid = parseInt(String(bidAmount).replace(/,/g, ''));

        if (mgr && gameState.cardOnBlock && mgr.Status === "Active") {
            if (gameState.cardOnBlock.passedManagers.includes(mgrName)) return socket.emit('auctionError', "You have passed on this player! Toggle 'Pass' off to bid again.");
            if (bid < 1000000) return socket.emit('auctionError', "Minimum bid is €1,000,000.");
            if (bid > mgr.Budget) return socket.emit('auctionError', "You do not have enough budget for that bid!");
            
            if (bid > gameState.cardOnBlock.highestBid) {
                gameState.cardOnBlock.highestBid = bid;
                gameState.cardOnBlock.highestBidder = mgrName;
                if (gameState.cardOnBlock.timeLeft <= 10) {
                    gameState.cardOnBlock.timeLeft = 10;
                    io.emit('timerTick', 10);
                }
                io.emit('updateState', gameState);
                checkAuctionEndEarly();
            }
        }
    });
    
    socket.on('toggleStarter', ({ mgrName, playerIndex, isStarting }) => {
        if (gameState.managers[mgrName] && gameState.managers[mgrName].Roster[playerIndex]) {
            gameState.managers[mgrName].Roster[playerIndex].isStarting = isStarting;
            io.emit('updateState', gameState);
        }
    });
});

server.listen(4000, () => console.log('✅ Interactive Engine running on port 4000'));