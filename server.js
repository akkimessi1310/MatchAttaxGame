const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const UEFA_CLUBS = [
    // Champions League
    "Ajax", "Arsenal", "Atalanta (Bergamo Calcio)", "Athletic Bilbao", "Atlético Madrid", "Barcelona", "Bayer Leverkusen", "Bayern Munich", "Benfica", "Bodø/Glimt", "Borussia Dortmund", "Chelsea", "Club Brugge", "Copenhagen", "Eintracht Frankfurt", "Galatasaray", "Inter Milan (Lombardia FC)", "Juventus", "Liverpool", "Manchester City", "Marseille", "Monaco", "Napoli", "Newcastle United", "Olympiacos", "Paris Saint-Germain", "PSV Eindhoven", "Qarabağ", "Real Madrid", "Slavia Prague", "Sporting CP", "Tottenham Hotspur", "Union Saint-Gilloise", "Villarreal",
    // Europa League
    "Aston Villa", "Basel", "Bologna", "Braga", "Brann", "Celta Vigo", "Celtic", "Dinamo Zagreb", "FCSB", "Fenerbahçe", "Ferencváros", "Feyenoord", "Genk", "Go Ahead Eagles", "Lille", "Lyon", "Malmö FF", "Midtjylland", "Nice", "Nottingham Forest", "Panathinaikos", "PAOK", "Porto", "Rangers", "Real Betis", "Red Bull Salzburg", "Roma", "SC Freiburg", "Sturm Graz", "Utrecht", "VfB Stuttgart", "Viktoria Plzeň", "Young Boys",
    // Conference League
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
    turnOrder: [],
    currentTurnIndex: 0,
    auctionStatus: "Lobby" 
};

// Map Socket IDs to Manager Names
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

function resolveAuction() {
    const card = gameState.cardOnBlock;
    if (card && card.highestBidder) {
        const mgr = gameState.managers[card.highestBidder];
        mgr.Budget -= card.highestBid;
        mgr.Roster.push({ ...card, isStarting: false });
        gameState.soldPlayers.push(card.Name.toLowerCase());

        if (mgr.Budget <= 0) {
            while (mgr.Roster.length < 11) {
                mgr.Roster.push({ Name: "Auto-Fill Penalty", Position: "N/A", CardType: "Base Card", Attack: Math.floor(Math.random()*31)+30, Defence: Math.floor(Math.random()*31)+30, isStarting: false });
            }
            mgr.Status = mgr.Roster.length === 11 ? "Auction Ended (Auto-filled)" : "Auction Ended (No extra subs)";
        } else if (mgr.Roster.length >= 18) {
            mgr.Status = "Auction Ended (Max 18 Players)";
        }

        gameState.auctionHistory.push({
            Player: card.Name, CardType: card.CardType, Rating: `${card.Attack}/${card.Defence}`, BasePrice: card.Value, FinalPrice: card.highestBid, Winner: card.highestBidder
        });
    }
    
    gameState.cardOnBlock = null;
    gameState.currentTurnIndex = (gameState.currentTurnIndex + 1) % gameState.turnOrder.length;
    
    if (Object.values(gameState.managers).every(m => m.Status !== "Active")) {
        gameState.auctionStatus = "Completed";
    }

    io.emit('updateState', gameState);
}

io.on('connection', (socket) => {
    socket.emit('updateState', gameState);

    socket.on('resetEntireGame', () => {
        gameState = { managers: {}, auctionHistory: [], soldPlayers: [], cardOnBlock: null, gameMode: null, turnOrder: [], currentTurnIndex: 0, auctionStatus: "Lobby" };
        socketToManager = {};
        clearInterval(timerInterval);
        io.emit('updateState', gameState);
    });

    socket.on('resetAuction', () => {
        for (let m in gameState.managers) {
            gameState.managers[m].Budget = 1000000000;
            gameState.managers[m].Roster = [];
            gameState.managers[m].Status = "Active";
        }
        gameState.auctionHistory = [];
        gameState.soldPlayers = [];
        gameState.cardOnBlock = null;
        gameState.turnOrder = [];
        gameState.currentTurnIndex = 0;
        gameState.gameMode = null;
        gameState.auctionStatus = "Lobby";
        clearInterval(timerInterval);
        io.emit('updateState', gameState);
    });

    socket.on('registerManager', (data) => {
        if (data.name && !gameState.managers[data.name]) {
            gameState.managers[data.name] = { Formation: data.formation, Budget: 1000000000, Roster: [], Status: "Active" };
            socketToManager[socket.id] = data.name; // Link socket to manager name
            socket.emit('managerRegistered', data.name);
            io.emit('updateState', gameState);
        }
    });

    socket.on('removeManager', (name) => {
        delete gameState.managers[name];
        io.emit('updateState', gameState);
    });

    socket.on('startGame', (mode) => {
        const mgrCount = Object.keys(gameState.managers).length;
        if (mgrCount === 0) return;

        if (mode.includes("Casual") && mgrCount !== 2) {
            return socket.emit('auctionError', "Casual modes require exactly 2 players!");
        }
        if (mode.includes("Tournament") && ![4, 8, 16].includes(mgrCount)) {
            return socket.emit('auctionError', "Tournament modes require exactly 4, 8, or 16 players!");
        }

        gameState.gameMode = mode;
        const managers = Object.keys(gameState.managers);
        gameState.turnOrder = managers.sort(() => Math.random() - 0.5);
        gameState.currentTurnIndex = 0;
        gameState.auctionStatus = "Active";
        io.emit('updateState', gameState);
    });

    socket.on('submitPlayerEntry', (playerData) => {
        if (gameState.soldPlayers.includes(playerData.name.toLowerCase())) {
            return socket.emit('auctionError', `Player '${playerData.name}' has already been sold! No duplicates allowed.`);
        }

        const { atk: b_atk, dfc: b_def } = calculateBaseStats(playerData.position, playerData.stats);
        const age = parseInt(playerData.age) || 25;
        const isUefa = UEFA_CLUBS.includes(playerData.club);

        let cardType = "Base Card";

        if (isUefa) {
            cardType = getWeightedRandom(RARITY_TIERS, RARITY_WEIGHTS);
        } else if (age > 30) {
            const nonUefaTiers = ["Base Card", "Heritage", "Infinity"];
            const nonUefaWeights = [90.0, 8.0, 2.0];
            cardType = getWeightedRandom(nonUefaTiers, nonUefaWeights);
        }

        const rawVal = String(playerData.value).replace(/,/g, '');
        const { atk: f_atk, dfc: f_def } = applyBoosts(cardType, playerData.position, age, b_atk, b_def);

        // UPDATED: timeLeft changed to 180 (3 minutes)
        gameState.cardOnBlock = {
            Name: playerData.name, Position: playerData.position, Club: playerData.club,
            CardType: cardType, Attack: f_atk, Defence: f_def, Value: parseInt(rawVal) || 1000000,
            highestBid: 0, highestBidder: null, timeLeft: 180
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
    });

    socket.on('placeBid', (data) => {
        const { mgrName, bidAmount } = data;
        const mgr = gameState.managers[mgrName];
        const bid = parseInt(String(bidAmount).replace(/,/g, ''));

        if (mgr && gameState.cardOnBlock && mgr.Status === "Active") {
            if (bid < 1000000) {
                return socket.emit('auctionError', "Minimum bid is €1,000,000.");
            }
            if (bid > mgr.Budget) {
                return socket.emit('auctionError', "You do not have enough budget for that bid!");
            }
            if (bid > gameState.cardOnBlock.highestBid) {
                gameState.cardOnBlock.highestBid = bid;
                gameState.cardOnBlock.highestBidder = mgrName;
                
                // This logic still correctly resets the clock to 10s if under 10s!
                if (gameState.cardOnBlock.timeLeft <= 10) {
                    gameState.cardOnBlock.timeLeft = 10;
                    io.emit('timerTick', 10);
                }
                io.emit('updateState', gameState);
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

server.listen(4000, () => console.log('✅ Interactive Auction Engine running on port 4000'));