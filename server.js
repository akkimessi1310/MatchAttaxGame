require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { Redis } = require('@upstash/redis');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// Upstash Redis Client
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const UEFA_CLUBS = [
    "AEK Athens", "Arsenal", "Aston Villa", "Atlético Madrid", "Barcelona", "Bayern Munich", "Bodø/Glimt", "Borussia Dortmund", "Club Brugge", "Como", "Fenerbahçe", "Feyenoord", "Galatasaray", "Inter Milan (Lombardia FC)", "LASK", "Lens", "Lille", "Liverpool", "Manchester City", "Manchester United", "Napoli", "Paris Saint-Germain", "Porto", "PSV Eindhoven", "RB Leipzig", "Real Betis", "Real Madrid", "Roma", "Shakhtar Donetsk", "Slavia Prague", "Sporting CP", "VfB Stuttgart", "Viking", "Villarreal",
    "Anderlecht", "AZ", "Bayer Leverkusen", "Benfica", "Beşiktaş", "Bournemouth", "Celta Vigo", "Celtic", "Crystal Palace", "Dinamo Zagreb", "Ferencváros", "Jagiellonia Białystok", "Juventus", "Lech Poznań", "Lillestrøm", "Lyon", "Marseille", "Milan (Milano FC)", "NEC", "Olympiacos", "Real Sociedad", "Red Bull Salzburg", "Rennes", "Sparta Prague", "Sturm Graz", "Sunderland", "Torreense", "TSG Hoffenheim", "Union Saint-Gilloise", "Viktoria Plzeň",
    "AGF", "Ajax", "Atalanta (Bergamo Calcio)", "Braga", "Brann", "Brighton & Hove Albion", "Copenhagen", "Gent", "Getafe", "Hajduk Split", "Heart of Midlothian", "Lugano", "Midtjylland", "Mjällby AIF", "Monaco", "Nordsjælland", "Panathinaikos", "SC Freiburg", "Sint-Truiden", "Thun", "Trabzonspor", "Twente", "Universitatea Craiova"
];

const RARITY_TIERS = ["Base Card", "Man of the Match", "Wildcard", "All-Action Hero", "Heritage", "Counter Attax", "Stealth Strike", "100 Club", "101 Club", "Infinity"];
const RARITY_WEIGHTS = [32.0, 15.0, 10.0, 10.0, 8.0, 8.0, 6.0, 5.0, 4.0, 2.0];

// ==========================================
// STATE MANAGEMENT & REDIS HELPERS
// ==========================================
const activeGames = {}; // Maps roomId -> { state: gameStateObject, timer: intervalObject }
const socketToRoom = {}; // Maps socket.id -> roomId
const socketToManager = {}; // Maps socket.id -> managerName

async function saveGameToRedis(roomId) {
    if (activeGames[roomId]) {
        try {
            // Save state with 24-hour expiration
            await redis.set(`matchattax:${roomId}`, activeGames[roomId].state, { ex: 86400 });
        } catch (err) {
            console.error(`Error saving room ${roomId} to Redis:`, err);
        }
    }
}

async function loadGameFromRedis(roomId) {
    try {
        return await redis.get(`matchattax:${roomId}`);
    } catch (err) {
        console.error(`Error loading room ${roomId} from Redis:`, err);
        return null;
    }
}

function createEmptyGameState() {
    return { 
        host: null,
        managers: {}, 
        auctionHistory: [], 
        soldPlayers: [], 
        cardOnBlock: null,
        gameMode: null,
        draftSystem: "Auction",
        turnOrder: [],
        currentTurnIndex: 0,
        auctionStatus: "Lobby",
        bracket: null,
        draftRound: 1,
        draftPick: -1,
        activeDraftManager: null,
        draftTimeLeft: 180,
        isTimerPaused: false
    };
}

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

// ==========================================
// GAME ENGINE LOGIC
// ==========================================
function checkDraftEnd(roomId) {
    let game = activeGames[roomId];
    if (!game) return false;

    let allDone = true;
    for (let name of game.state.turnOrder) {
        let mgr = game.state.managers[name];
        if (mgr && mgr.Roster.length < 18 && !mgr.isDraftPassed) {
            allDone = false;
            break;
        }
    }
    if (allDone) {
        clearInterval(game.timer);
        game.state.auctionStatus = "Completed";
        io.to(roomId).emit('updateState', game.state);
        saveGameToRedis(roomId);
        return true;
    }
    return false;
}

function startDraftTimer(roomId, startingTime = 180) {
    let game = activeGames[roomId];
    if (!game) return;

    clearInterval(game.timer);
    game.state.draftTimeLeft = startingTime;
    game.state.isTimerPaused = false;
    io.to(roomId).emit('timerTick', game.state.draftTimeLeft);
    
    game.timer = setInterval(() => {
        game.state.draftTimeLeft--;
        if (game.state.draftTimeLeft <= 0) {
            clearInterval(game.timer);
            autoDraftPunishment(roomId, game.state.activeDraftManager);
        } else {
            io.to(roomId).emit('timerTick', game.state.draftTimeLeft);
        }
    }, 1000);
}

function pauseDraftTimer(roomId) {
    let game = activeGames[roomId];
    if (game && game.timer) {
        clearInterval(game.timer);
        game.state.isTimerPaused = true;
        io.to(roomId).emit('updateState', game.state); 
        saveGameToRedis(roomId);
    }
}

function autoDraftPunishment(roomId, mgrName) {
    let game = activeGames[roomId];
    if (!game) return;

    let mgr = game.state.managers[mgrName];
    if (!mgr) return advanceDraftTurn(roomId);
    
    let punishmentCount = mgr.Roster.filter(p => p.Name.startsWith("Punishment Player")).length + 1;
    let pPlayer = {
        Name: `Punishment Player ${punishmentCount}`, Position: "N/A", CardType: "Base Card", 
        Attack: Math.floor(Math.random()*31)+30, Defence: Math.floor(Math.random()*31)+30, 
        BaseAttack: 0, BaseDefence: 0, Value: 0, isStarting: false 
    };
    
    mgr.Roster.push(pPlayer);
    game.state.auctionHistory.push({
        Player: pPlayer.Name, CardType: pPlayer.CardType, Rating: `${pPlayer.Attack}/${pPlayer.Defence}`, BasePrice: 0, FinalPrice: "Punishment", Winner: mgrName
    });
    
    io.to(roomId).emit('updateState', game.state);
    saveGameToRedis(roomId);
    advanceDraftTurn(roomId);
}

function advanceDraftTurn(roomId) {
    let game = activeGames[roomId];
    if (!game) return;

    if (checkDraftEnd(roomId)) return;

    let found = false;
    let attempts = 0;
    let maxAttempts = game.state.turnOrder.length * 20; 
    
    while (!found && attempts < maxAttempts) {
        game.state.draftPick++;
        if (game.state.draftPick >= game.state.turnOrder.length) {
            game.state.draftPick = 0;
            game.state.draftRound++;
        }
        
        if (game.state.draftRound > 18) {
            game.state.auctionStatus = "Completed";
            clearInterval(game.timer);
            io.to(roomId).emit('updateState', game.state);
            saveGameToRedis(roomId);
            return;
        }

        let index = game.state.draftRound % 2 !== 0 
            ? game.state.draftPick 
            : (game.state.turnOrder.length - 1 - game.state.draftPick); 
            
        let mgrName = game.state.turnOrder[index];
        let mgr = game.state.managers[mgrName];
        
        if (mgr && mgr.Roster.length < 18 && !mgr.isDraftPassed) {
            game.state.activeDraftManager = mgrName;
            found = true;
            io.to(roomId).emit('updateState', game.state);
            saveGameToRedis(roomId);
            
            if (mgr.isOnline === false) {
                pauseDraftTimer(roomId);
            } else {
                startDraftTimer(roomId, 180);
            }
        }
        attempts++;
    }
    
    if (!found) {
        game.state.auctionStatus = "Completed";
        clearInterval(game.timer);
        io.to(roomId).emit('updateState', game.state);
        saveGameToRedis(roomId);
    }
}

function resolveAuction(roomId) {
    let game = activeGames[roomId];
    if (!game) return;

    const card = game.state.cardOnBlock;
    if (card) {
        if (card.highestBidder) {
            const mgr = game.state.managers[card.highestBidder];
            mgr.Budget -= card.highestBid;
            mgr.Roster.push({ ...card, isStarting: false });
            game.state.soldPlayers.push(card.Name.toLowerCase());

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

            game.state.auctionHistory.push({
                Player: card.Name, CardType: card.CardType, Rating: `${card.Attack}/${card.Defence}`, BasePrice: card.Value, FinalPrice: card.highestBid, Winner: card.highestBidder
            });
        } else {
            game.state.auctionHistory.push({
                Player: card.Name, CardType: card.CardType, Rating: `${card.Attack}/${card.Defence}`, BasePrice: card.Value, FinalPrice: 0, Winner: "Unsold"
            });
        }
    }
    
    game.state.cardOnBlock = null;
    game.state.currentTurnIndex = (game.state.currentTurnIndex + 1) % game.state.turnOrder.length;
    
    if (Object.values(game.state.managers).every(m => m.Status !== "Active")) {
        game.state.auctionStatus = "Completed";
    }
    io.to(roomId).emit('updateState', game.state);
    saveGameToRedis(roomId);
}

function checkAuctionEndEarly(roomId) {
    let game = activeGames[roomId];
    if (!game || !game.state.cardOnBlock) return;

    const activeMgrs = Object.keys(game.state.managers).filter(name => game.state.managers[name].Status === 'Active');
    const passedCount = game.state.cardOnBlock.passedManagers.filter(m => activeMgrs.includes(m)).length;
    let shouldEnd = false;
    
    if (game.state.cardOnBlock.highestBidder) {
        if (passedCount >= activeMgrs.length - 1) shouldEnd = true;
    } else {
        if (passedCount >= activeMgrs.length) shouldEnd = true;
    }

    if (shouldEnd) {
        clearInterval(game.timer);
        resolveAuction(roomId);
    }
}

// ==========================================
// SOCKET COMMUNICATION
// ==========================================
io.on('connection', (socket) => {
    
    // --- ROOM CREATION & JOINING ---
    socket.on('createRoom', async () => {
        const roomId = Math.random().toString(36).substring(2, 6).toUpperCase(); 
        activeGames[roomId] = { state: createEmptyGameState(), timer: null };
        socket.join(roomId);
        socketToRoom[socket.id] = roomId;
        
        await saveGameToRedis(roomId);

        socket.emit('roomCreated', roomId);
        io.to(roomId).emit('updateState', activeGames[roomId].state);
    });

    socket.on('joinRoom', async (roomId) => {
        if(!roomId) return;
        roomId = roomId.toUpperCase();

        // If server was sleeping or reset memory, fetch room from Redis
        if (!activeGames[roomId]) {
            const savedState = await loadGameFromRedis(roomId);
            if (savedState) {
                activeGames[roomId] = { state: savedState, timer: null };
            } else {
                return socket.emit('auctionError', "Room not found or has expired!");
            }
        }
        
        socket.join(roomId);
        socketToRoom[socket.id] = roomId;
        socket.emit('roomJoined', roomId);
        io.to(roomId).emit('updateState', activeGames[roomId].state);
    });

    socket.on('reconnectUser', async ({ roomId, mgrName }) => {
        if (!roomId) return;
        roomId = roomId.toUpperCase();

        // Restore room from Redis if missing
        if (!activeGames[roomId]) {
            const savedState = await loadGameFromRedis(roomId);
            if (savedState) activeGames[roomId] = { state: savedState, timer: null };
        }

        let game = activeGames[roomId];
        
        if (game) {
            socket.join(roomId);
            socketToRoom[socket.id] = roomId;
            
            if (mgrName && game.state.managers[mgrName]) {
                socketToManager[socket.id] = mgrName;
                game.state.managers[mgrName].isOnline = true; 
                
                if(!game.state.host) game.state.host = mgrName;

                if (game.state.activeDraftManager === mgrName && game.state.isTimerPaused) {
                    startDraftTimer(roomId, game.state.draftTimeLeft);
                }
            }
            socket.emit('roomJoined', roomId);
            socket.emit('updateState', game.state);
        } else {
            socket.emit('forceClearStorage'); 
        }
    });

    socket.on('disconnect', () => {
        const roomId = socketToRoom[socket.id];
        const mgrName = socketToManager[socket.id];
        
        if (roomId && activeGames[roomId] && mgrName) {
            let game = activeGames[roomId];
            
            if (game.state.managers[mgrName]) {
                game.state.managers[mgrName].isOnline = false;
                
                if (game.state.activeDraftManager === mgrName && game.state.draftSystem === "Draft" && game.state.auctionStatus === "Active") {
                    pauseDraftTimer(roomId);
                }
                io.to(roomId).emit('updateState', game.state);
                saveGameToRedis(roomId);
            }
            
            if (game.state.host === mgrName) {
                const remainingOnline = Object.keys(game.state.managers).find(name => game.state.managers[name].isOnline);
                if(remainingOnline) {
                    game.state.host = remainingOnline;
                    saveGameToRedis(roomId);
                }
            }
        }
        
        delete socketToRoom[socket.id];
        delete socketToManager[socket.id];
    });

    // --- GAME ACTIONS ---
    socket.on('registerManager', ({ roomId, data }) => {
        let game = activeGames[roomId];
        if (!game) return;
        
        if (data.name && !game.state.managers[data.name]) {
            game.state.managers[data.name] = { Formation: data.formation, Budget: 1000000000, Roster: [], Status: "Active", isDraftPassed: false, isOnline: true };
            
            if (!game.state.host) game.state.host = data.name;
            
            // Only tie socket to the first registered manager
            if (!socketToManager[socket.id]) {
                socketToManager[socket.id] = data.name; 
            }
            
            socket.emit('managerRegistered', data.name);
            io.to(roomId).emit('updateState', game.state);
            saveGameToRedis(roomId);
        }
    });

    socket.on('resetAuction', ({ roomId }) => {
        let game = activeGames[roomId];
        if (!game) return;
        
        for (let m in game.state.managers) {
            game.state.managers[m].Budget = 1000000000;
            game.state.managers[m].Roster = [];
            game.state.managers[m].Status = "Active";
            game.state.managers[m].isDraftPassed = false;
        }
        game.state.auctionHistory = [];
        game.state.soldPlayers = [];
        game.state.cardOnBlock = null;
        game.state.turnOrder = [];
        game.state.currentTurnIndex = 0;
        game.state.gameMode = null;
        game.state.auctionStatus = "Lobby";
        game.state.bracket = null;
        game.state.draftRound = 1;
        game.state.draftPick = -1;
        game.state.activeDraftManager = null;
        clearInterval(game.timer);
        
        io.to(roomId).emit('updateState', game.state);
        saveGameToRedis(roomId);
    });

    socket.on('startGame', ({ roomId, mode, system }) => {
        let game = activeGames[roomId];
        if (!game) return;

        const mgrCount = Object.keys(game.state.managers).length;
        if (mgrCount < 2) return socket.emit('auctionError', "You need at least 2 players to start a game!");

        if ((mode.includes("Casual") || mode.includes("Match")) && mgrCount !== 2) {
            return socket.emit('auctionError', "Head-to-head matches require exactly 2 players!");
        }
        if (mode.includes("Tournament") && (mgrCount < 3 || mgrCount > 16)) {
            return socket.emit('auctionError', "Only 3 to 16 players can play.");
        }

        game.state.gameMode = mode;
        game.state.draftSystem = system || "Auction";
        const managers = Object.keys(game.state.managers);
        game.state.turnOrder = managers.sort(() => Math.random() - 0.5);
        game.state.auctionStatus = "Active";

        if (mode.includes("Tournament")) {
            const nextPow2 = Math.pow(2, Math.ceil(Math.log2(mgrCount)));
            const numByes = nextPow2 - mgrCount;
            const byePlayers = game.state.turnOrder.slice(0, numByes);
            const round1Players = game.state.turnOrder.slice(numByes);
            
            let matchups = [];
            for(let i=0; i<round1Players.length; i+=2) {
                if (round1Players[i+1]) matchups.push([round1Players[i], round1Players[i+1]]);
            }
            game.state.bracket = { totalPlayers: mgrCount, byes: byePlayers, round1: matchups };
        } else {
            game.state.bracket = null;
        }

        if (game.state.draftSystem === "Draft") {
            game.state.draftRound = 1;
            game.state.draftPick = -1;
            game.state.activeDraftManager = null;
            advanceDraftTurn(roomId); 
        } else {
            game.state.currentTurnIndex = 0;
            io.to(roomId).emit('updateState', game.state);
        }
        saveGameToRedis(roomId);
    });

    socket.on('submitPlayerEntry', ({ roomId, ...playerData }) => {
        let game = activeGames[roomId];
        if (!game) return;

        if (game.state.soldPlayers.includes(playerData.name.toLowerCase())) {
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

        if (game.state.draftSystem === "Draft") {
            let mgrName = game.state.activeDraftManager;
            let mgr = game.state.managers[mgrName];
            if (!mgr) return;
            
            let newPlayer = {
                Name: playerData.name, Position: pos, Club: playerData.club, CardType: cardType, 
                Attack: f_atk, Defence: f_def, BaseAttack: b_atk, BaseDefence: b_def, 
                Value: parseInt(rawVal) || 1000000, isStarting: false
            };
            
            mgr.Roster.push(newPlayer);
            game.state.soldPlayers.push(playerData.name.toLowerCase());
            game.state.auctionHistory.push({
                Player: newPlayer.Name, CardType: newPlayer.CardType, Rating: `${newPlayer.Attack}/${newPlayer.Defence}`, BasePrice: newPlayer.Value, FinalPrice: "Drafted", Winner: mgrName
            });
            
            io.to(roomId).emit('updateState', game.state);
            saveGameToRedis(roomId);
            advanceDraftTurn(roomId);

        } else {
            game.state.cardOnBlock = {
                Name: playerData.name, Position: pos, Club: playerData.club, CardType: cardType, 
                Attack: f_atk, Defence: f_def, BaseAttack: b_atk, BaseDefence: b_def, 
                Value: parseInt(rawVal) || 1000000, highestBid: 0, highestBidder: null, timeLeft: 180, passedManagers: []
            };
            io.to(roomId).emit('updateState', game.state);
            saveGameToRedis(roomId);

            clearInterval(game.timer);
            game.timer = setInterval(() => {
                if (!game.state.cardOnBlock) { clearInterval(game.timer); return; }
                game.state.cardOnBlock.timeLeft -= 1;
                if (game.state.cardOnBlock.timeLeft <= 0) {
                    clearInterval(game.timer);
                    resolveAuction(roomId);
                } else {
                    io.to(roomId).emit('timerTick', game.state.cardOnBlock.timeLeft);
                }
            }, 1000);
        }
    });

    socket.on('toggleDraftPass', ({ roomId, mgrName, isPassing }) => {
        let game = activeGames[roomId];
        if (!game) return;
        let mgr = game.state.managers[mgrName];
        if (!mgr || mgr.Roster.length < 11) return;
        
        mgr.isDraftPassed = isPassing;
        io.to(roomId).emit('updateState', game.state);
        saveGameToRedis(roomId);
        
        if (isPassing && game.state.activeDraftManager === mgrName) advanceDraftTurn(roomId);
        else checkDraftEnd(roomId);
    });

    socket.on('togglePass', ({ roomId, mgrName, isPassing }) => {
        let game = activeGames[roomId];
        if (!game || game.state.draftSystem === "Draft" || !game.state.cardOnBlock || !game.state.managers[mgrName]) return;
        
        if (game.state.cardOnBlock.highestBidder === mgrName) {
            return socket.emit('auctionError', "You cannot pass while holding the highest bid!");
        }

        if (isPassing) {
            if (!game.state.cardOnBlock.passedManagers.includes(mgrName)) game.state.cardOnBlock.passedManagers.push(mgrName);
        } else {
            game.state.cardOnBlock.passedManagers = game.state.cardOnBlock.passedManagers.filter(m => m !== mgrName);
        }

        io.to(roomId).emit('updateState', game.state);
        checkAuctionEndEarly(roomId); 
    });

    socket.on('placeBid', ({ roomId, mgrName, bidAmount }) => {
        let game = activeGames[roomId];
        if (!game || game.state.draftSystem === "Draft") return;
        
        const mgr = game.state.managers[mgrName];
        const bid = parseInt(String(bidAmount).replace(/,/g, ''));

        if (mgr && game.state.cardOnBlock && mgr.Status === "Active") {
            if (game.state.cardOnBlock.passedManagers.includes(mgrName)) return socket.emit('auctionError', "You have passed on this player! Toggle 'Pass' off to bid again.");
            if (bid < 1000000) return socket.emit('auctionError', "Minimum bid is €1,000,000.");
            if (bid > mgr.Budget) return socket.emit('auctionError', "You do not have enough budget for that bid!");
            
            if (bid > game.state.cardOnBlock.highestBid) {
                game.state.cardOnBlock.highestBid = bid;
                game.state.cardOnBlock.highestBidder = mgrName;
                if (game.state.cardOnBlock.timeLeft <= 10) {
                    game.state.cardOnBlock.timeLeft = 10;
                    io.to(roomId).emit('timerTick', 10);
                }
                io.to(roomId).emit('updateState', game.state);
                checkAuctionEndEarly(roomId);
            }
        }
    });
    
    socket.on('toggleStarter', ({ roomId, mgrName, playerIndex, isStarting }) => {
        let game = activeGames[roomId];
        if (game && game.state.managers[mgrName] && game.state.managers[mgrName].Roster[playerIndex]) {
            game.state.managers[mgrName].Roster[playerIndex].isStarting = isStarting;
            io.to(roomId).emit('updateState', game.state);
            saveGameToRedis(roomId);
        }
    });

    // --- ADMIN / HOST CONTROLS ---
    socket.on('adminSkipTurn', ({ roomId }) => {
        let game = activeGames[roomId];
        if (!game) return;
        const requester = socketToManager[socket.id];
        if (game.state.host !== requester) return;

        if (game.state.draftSystem === "Draft" && game.state.activeDraftManager) {
            autoDraftPunishment(roomId, game.state.activeDraftManager);
        } else if (game.state.cardOnBlock) {
            game.state.cardOnBlock.timeLeft = 0; 
        }
    });

    socket.on('adminKickPlayer', ({ roomId, targetName }) => {
        let game = activeGames[roomId];
        if (!game) return;
        const requester = socketToManager[socket.id];
        if (game.state.host !== requester || targetName === requester) return; 

        delete game.state.managers[targetName];
        game.state.turnOrder = game.state.turnOrder.filter(name => name !== targetName);
        
        if (game.state.activeDraftManager === targetName) advanceDraftTurn(roomId);
        
        io.to(roomId).emit('updateState', game.state);
        saveGameToRedis(roomId);
    });
});

server.listen(4000, () => console.log('✅ Interactive Engine running on port 4000'));