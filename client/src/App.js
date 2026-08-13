import React, { useState, useEffect } from 'react';
import io from 'socket.io-client';

// NOTE: You will change this link to your Render URL during deployment!
const socket = io('http://localhost:4000');

const FORMATIONS = [
    "3-1-4-2", "3-4-1-2", "3-4-2-1", "3-4-3", "3-4-3 Flat", "3-5-2", "4-1-2-1-2", "4-1-2-1-2 (Narrow)", "4-1-2-1-2 (Wide)", "4-1-3-2", "4-1-4-1", "4-2-2-2", "4-2-3-1 (Narrow)",
    "4-2-3-1 (Wide)", "4-2-3-1", "4-2-4", "4-3-1-2", "4-3-2-1", "4-3-3 (Flat)", "4-3-3 (Defend)", "4-3-3 (Holding)", "4-3-3 (Attack)", "4-4-1-1 (Midfield)", "4-4-2 (Flat)",
    "4-4-2 (Holding)", "4-5-1 (Flat)", "4-5-1 (Attack)", "5-2-1-2", "5-3-2", "5-3-2 (Holding)", "5-4-1 (Flat)"
];

const UEFA_CLUBS = {
    "Champions League": ["Ajax", "Arsenal", "Atalanta (Bergamo Calcio)", "Athletic Bilbao", "Atlético Madrid", "Barcelona", "Bayer Leverkusen", "Bayern Munich", "Benfica", "Bodø/Glimt", "Borussia Dortmund", "Chelsea", "Club Brugge", "Copenhagen", "Eintracht Frankfurt", "Galatasaray", "Inter Milan (Lombardia FC)", "Juventus", "Liverpool", "Manchester City", "Marseille", "Monaco", "Napoli", "Newcastle United", "Olympiacos", "Paris Saint-Germain", "PSV Eindhoven", "Qarabağ", "Real Madrid", "Slavia Prague", "Sporting CP", "Tottenham Hotspur", "Union Saint-Gilloise", "Villarreal"],
    "Europa League": ["Aston Villa", "Basel", "Bologna", "Braga", "Brann", "Celta Vigo", "Celtic", "Dinamo Zagreb", "FCSB", "Fenerbahçe", "Ferencváros", "Feyenoord", "Genk", "Go Ahead Eagles", "Lille", "Lyon", "Malmö FF", "Midtjylland", "Nice", "Nottingham Forest", "Panathinaikos", "PAOK", "Porto", "Rangers", "Real Betis", "Red Bull Salzburg", "Roma", "SC Freiburg", "Sturm Graz", "Utrecht", "VfB Stuttgart", "Viktoria Plzeň", "Young Boys"],
    "Conference League": ["Aberdeen", "AEK Athens", "AZ", "BK Häcken", "Crystal Palace", "Dynamo Kyiv", "Fiorentina", "Jagiellonia Białystok", "Lausanne-Sport", "Lech Poznań", "Legia Warsaw", "Mainz 05", "Raków Częstochowa", "Rapid Wien", "Rayo Vallecano", "Samsunspor", "Shakhtar Donetsk", "Shamrock Rovers", "Shelbourne", "Sparta Prague", "Strasbourg", "Universitatea Craiova"]
};

const formatCurrency = (val) => {
    const onlyNums = String(val).replace(/\D/g, '');
    return onlyNums ? Number(onlyNums).toLocaleString('en-US') : '';
};

function App() {
  const [gameState, setGameState] = useState({ managers: {}, auctionHistory: [], cardOnBlock: null, turnOrder: [], currentTurnIndex: 0, auctionStatus: "Lobby" });
  const [myManagerName, setMyManagerName] = useState(localStorage.getItem('myManagerName') || '');
  const [timeLeft, setTimeLeft] = useState(0);
  const [regName, setRegName] = useState('');
  const [regFormation, setRegFormation] = useState(FORMATIONS[0]);
  
  const [pName, setPName] = useState('');
  const [pPos, setPPos] = useState('ST');
  const [pAge, setPAge] = useState(25);
  const [pClub, setPClub] = useState('Other League Club (Base Card Only)');
  const [pValue, setPValue] = useState("1,000,000");
  const [stats, setStats] = useState({ s1: 80, s2: 80, s3: 80, s4: 80, s5: 80, s6: 80 });
  const [viewRosterMgr, setViewRosterMgr] = useState(null);
  const [managerBids, setManagerBids] = useState({});

  useEffect(() => {
    socket.on('updateState', (newState) => {
        setGameState(newState);
        if (newState.cardOnBlock) setTimeLeft(newState.cardOnBlock.timeLeft);
    });
    socket.on('managerRegistered', (name) => {
        setMyManagerName(name);
        localStorage.setItem('myManagerName', name);
    });
    socket.on('timerTick', (time) => setTimeLeft(time));
    socket.on('auctionError', (msg) => alert("⚠️ " + msg)); 
    
    return () => {
        socket.off('updateState');
        socket.off('managerRegistered');
        socket.off('timerTick');
        socket.off('auctionError');
    };
  }, []);

  const handlePlayerSubmit = () => {
    socket.emit('submitPlayerEntry', { name: pName, position: pPos, age: pAge, club: pClub, value: pValue, stats });
    setPName(''); 
  };

  const submitBid = (mgrName) => {
    const rawBid = managerBids[mgrName] ? parseInt(String(managerBids[mgrName]).replace(/,/g, '')) : 0;
    if (rawBid < 1000000) {
        alert("⚠️ Minimum bid is €1,000,000.");
        return;
    }
    socket.emit('placeBid', { mgrName, bidAmount: rawBid });
    setManagerBids({...managerBids, [mgrName]: ''}); 
  };

  const downloadExcel = () => {
    const headers = ["Player Name", "Card Type", "Rating", "Base Price", "Final Price", "Winning Manager"];
    const rows = gameState.auctionHistory.map(item => 
        `"${item.Player}","${item.CardType}","${item.Rating}","€${item.BasePrice.toLocaleString()}","€${item.FinalPrice.toLocaleString()}","${item.Winner}"`
    );
    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "Match_Attax_Auction_History.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const activeManagerName = gameState.turnOrder[gameState.currentTurnIndex] || "";
  const isOnlineMode = gameState.gameMode && gameState.gameMode.includes("Online");
  const isMyTurn = isOnlineMode ? myManagerName === activeManagerName : true;

  const currentStatLabels = pPos === 'GK'
      ? [ { key: 's4', label: 'DIV' }, { key: 's6', label: 'HAN' }, { key: 's1', label: 'KIC' }, { key: 's3', label: 'REF' }, { key: 's2', label: 'SPD' }, { key: 's5', label: 'POS' } ]
      : [ { key: 's2', label: 'PAC' }, { key: 's4', label: 'SHO' }, { key: 's1', label: 'PAS' }, { key: 's3', label: 'DRI' }, { key: 's5', label: 'DEF' }, { key: 's6', label: 'PHY' } ];

  return (
    <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif', maxWidth: '1100px', margin: 'auto' }}>
      
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <div>
            <h1>Topps Match Attax x EA FC 26</h1>
            {myManagerName && <span style={{ background: '#007bff', color: 'white', padding: '4px 8px', borderRadius: '4px', fontSize: '14px' }}>👤 Connected as: <strong>{myManagerName}</strong></span>}
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
              <button onClick={() => { if(window.confirm('Wipe auction history, rosters, and budgets?')) socket.emit('resetAuction'); }} style={{ padding: '8px', background: '#dc3545', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
                  🔄 Restart Auction
              </button>
              <button onClick={() => { if(window.confirm('Completely wipe everything?')) { localStorage.clear(); setMyManagerName(''); socket.emit('resetEntireGame'); } }} style={{ padding: '8px', background: '#8b0000', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
                  🗑️ Hard Reset Game
              </button>
          </div>
      </div>

      <div style={{ marginBottom: '10px', padding: '10px', background: '#e9ecef', borderRadius: '5px' }}>
        <strong>🌐 Quick Database Links: </strong>
        <a href="https://sofifa.com/players" target="_blank" rel="noreferrer" style={{ marginRight: '15px' }}>Open SoFIFA</a>
        <a href="https://www.transfermarkt.co.uk/spieler-statistik/wertvollstespieler/marktwertetop" target="_blank" rel="noreferrer" style={{ marginRight: '15px' }}>Open Transfermarkt</a>
        <a href="https://www.fifplay.com/fc-26/formations/?mode=kickoff" target="_blank" rel="noreferrer">Open Formations Guide</a>
      </div>

      <details style={{ marginBottom: '20px', padding: '10px', background: '#e9ecef', borderRadius: '5px', cursor: 'pointer' }}>
          <summary style={{ fontWeight: 'bold' }}>📊 View Card Spawn Probabilities</summary>
          <table border="1" style={{ marginTop: '10px', width: '100%', borderCollapse: 'collapse', textAlign: 'center', background: '#fff' }}>
              <thead>
                  <tr style={{ background: '#ddd' }}>
                      <th style={{ padding: '8px' }}>Card Variant</th>
                      <th style={{ padding: '8px' }}>UEFA Club Probability</th>
                      <th style={{ padding: '8px' }}>Non-UEFA Club (Age &gt; 30)</th>
                  </tr>
              </thead>
              <tbody>
                  <tr><td>Base Card</td><td>32%</td><td>90%</td></tr>
                  <tr><td>Man of the Match</td><td>15%</td><td>-</td></tr>
                  <tr><td>Wildcard</td><td>10%</td><td>-</td></tr>
                  <tr><td>All-Action Hero</td><td>10%</td><td>-</td></tr>
                  <tr><td>Heritage</td><td>8%</td><td>8%</td></tr>
                  <tr><td>Counter Attax</td><td>8%</td><td>-</td></tr>
                  <tr><td>Stealth Strike</td><td>6%</td><td>-</td></tr>
                  <tr><td>100 Club</td><td>5%</td><td>-</td></tr>
                  <tr><td>101 Club</td><td>4%</td><td>-</td></tr>
                  <tr><td>Infinity</td><td>2%</td><td>2%</td></tr>
              </tbody>
          </table>
      </details>

      {gameState.auctionStatus === "Lobby" && (
        <section style={{ border: '1px solid #ccc', padding: '15px', marginBottom: '20px', background: '#e6f7ff' }}>
          <h3>1. Manager Setup & Lobby</h3>
          <input type="text" placeholder="Manager Name" value={regName} onChange={(e) => setRegName(e.target.value)} />
          <select value={regFormation} onChange={(e) => setRegFormation(e.target.value)} style={{ marginLeft: '10px' }}>
            {FORMATIONS.map(form => <option key={form} value={form}>{form}</option>)}
          </select>
          <button onClick={() => { socket.emit('registerManager', { name: regName, formation: regFormation }); setRegName(''); }} style={{ marginLeft: '10px' }}>Join Lobby</button>
          
          <div style={{ marginTop: '20px' }}>
            <h4>Select Gamemode to Start Auction:</h4>
            <button onClick={() => socket.emit('startGame', 'Pass & Play Casual')} style={{ padding: '10px', background: '#28a745', color: '#fff', marginRight: '10px', cursor: 'pointer', border: 'none' }}>🎮 Pass & Play Casual (2 Players)</button>
            <button onClick={() => socket.emit('startGame', 'Pass & Play Tournament')} style={{ padding: '10px', background: '#17a2b8', color: '#fff', marginRight: '10px', cursor: 'pointer', border: 'none' }}>🏆 Pass & Play Tournament (4/8/16 Players)</button>
            <button onClick={() => socket.emit('startGame', 'Online Match')} style={{ padding: '10px', background: '#6f42c1', color: '#fff', marginRight: '10px', cursor: 'pointer', border: 'none' }}>🌐 Online Match (2 Players)</button>
            <button onClick={() => socket.emit('startGame', 'Online Tournament')} style={{ padding: '10px', background: '#fd7e14', color: '#fff', cursor: 'pointer', border: 'none' }}>🌐 Online Tournament (4/8/16 Players)</button>
          </div>
        </section>
      )}

      <section style={{ border: '1px solid #ccc', padding: '15px', marginBottom: '20px' }}>
        <h3>Manager Trackers {gameState.gameMode && `| Mode: ${gameState.gameMode}`}</h3>
        <table border="1" width="100%" style={{ textAlign: 'left', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#f8f9fa' }}>
                <th style={{ padding: '5px' }}>Manager</th><th>Formation</th><th>Budget Left</th><th>Roster</th><th>Status</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(gameState.managers).map(([name, data]) => (
              <tr key={name}>
                <td style={{ padding: '5px' }}>{name} {activeManagerName === name && "🎯 (Turn)"}</td>
                <td>{data.Formation}</td>
                <td>€{data.Budget.toLocaleString()}</td>
                <td>{data.Roster.length}/18</td>
                <td>{data.Status}</td>
                <td>
                    <button onClick={() => setViewRosterMgr(viewRosterMgr === name ? null : name)}>View Roster</button>
                    {gameState.auctionStatus === "Lobby" && <button onClick={() => socket.emit('removeManager', name)} style={{ color: 'red', marginLeft: '5px', cursor: 'pointer' }}>❌</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {viewRosterMgr && (
            <div style={{ padding: '10px', background: '#f1f1f1', marginTop: '10px' }}>
                <strong>{viewRosterMgr}'s Roster: </strong>
                {gameState.managers[viewRosterMgr].Roster.length === 0 ? "Empty" : 
                    gameState.managers[viewRosterMgr].Roster.map(p => `${p.Name} [${p.Position}] (${p.CardType})`).join(", ")
                }
            </div>
        )}
      </section>

      {gameState.auctionStatus === "Active" && (
        <section style={{ border: '1px solid #ccc', padding: '15px', marginBottom: '20px', background: '#f8f9fa' }}>
          <h3>2. Manager Selection Turn</h3>
          <p style={{ color: 'darkred', fontWeight: 'bold' }}>🎯 It is currently {activeManagerName}'s turn to look up a player!</p>
          
          {!isMyTurn ? (
            <div style={{ padding: '20px', background: '#fff3cd', borderRadius: '5px', textAlign: 'center' }}>
               <h4>⏳ Waiting for {activeManagerName} to select and input a player...</h4>
            </div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <input type="text" placeholder="Full Player Name" value={pName} onChange={(e) => setPName(e.target.value)} />
                <select value={pPos} onChange={(e) => setPPos(e.target.value)}>
                  <option value="ST">ST / CF</option><option value="LW">LW</option><option value="RW">RW</option>
                  <option value="LM">LM</option><option value="RM">RM</option><option value="CAM">CAM</option>
                  <option value="CM">CM</option><option value="CDM">CDM</option><option value="LB">LB</option>
                  <option value="RB">RB</option><option value="CB">CB</option><option value="GK">GK</option>
                </select>
                <input type="number" placeholder="Age" value={pAge} onChange={(e) => setPAge(e.target.value)} />
                <select value={pClub} onChange={(e) => setPClub(e.target.value)}>
                  <option value="Other League Club (Base Card Only)">Other League Club (Base Card Only)</option>
                  {Object.entries(UEFA_CLUBS).map(([league, clubs]) => (
                      <optgroup key={league} label={league}>
                          {clubs.map(club => <option key={club} value={club}>{club}</option>)}
                      </optgroup>
                  ))}
                </select>
                <input type="text" placeholder="Transfermarkt Price (€)" value={pValue} onChange={(e) => setPValue(formatCurrency(e.target.value))} />
              </div>
              
              <div style={{ marginTop: '15px' }}>
                  <h4 style={{ marginBottom: '10px' }}>Enter EA FC 26 Attributes:</h4>
                  <div style={{ display: 'flex', gap: '15px' }}>
                    {currentStatLabels.map(({ key, label }) => (
                      <div key={key} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                        <label style={{ fontSize: '13px', fontWeight: 'bold', color: '#333' }}>{label}</label>
                        <input 
                            type="number" 
                            style={{ width: '60px', padding: '5px', textAlign: 'center', marginTop: '5px', border: '1px solid #ccc', borderRadius: '4px' }} 
                            value={stats[key]} 
                            onChange={(e) => setStats({ ...stats, [key]: e.target.value })} 
                        />
                      </div>
                    ))}
                  </div>
              </div>

              <button onClick={handlePlayerSubmit} disabled={!!gameState.cardOnBlock} style={{ marginTop: '15px', padding: '10px', background: 'green', color: 'white', cursor: 'pointer', border: 'none' }}>
                Generate Card & Start Clock
              </button>
            </>
          )}
        </section>
      )}

      {gameState.cardOnBlock && (
        <section style={{ border: '3px solid gold', padding: '15px', marginBottom: '20px', background: '#fff' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2>CARD ON BLOCK: {gameState.cardOnBlock.Name} ({gameState.cardOnBlock.Position})</h2>
            <h1 style={{ color: timeLeft <= 10 ? 'red' : 'black' }}>⏱️ {timeLeft}s</h1>
          </div>
          <p><strong>Club:</strong> {gameState.cardOnBlock.Club} | <strong>Rarity:</strong> {gameState.cardOnBlock.CardType}</p>
          <h3>ATTACK: {gameState.cardOnBlock.Attack} | DEFENCE: {gameState.cardOnBlock.Defence}</h3>
          
          <p>
            <strong>Base Price:</strong> €{gameState.cardOnBlock.Value.toLocaleString()} | 
            <strong style={{ marginLeft: '10px' }}>Current Highest Bid:</strong> €{gameState.cardOnBlock.highestBid.toLocaleString()} (by {gameState.cardOnBlock.highestBidder || 'None'})
          </p>

          <hr/>
          <h4>Manager Bidding Consoles (Min. Bid: €1,000,000)</h4>
          <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
            {Object.keys(gameState.managers)
              .filter(name => gameState.managers[name].Status === 'Active')
              .filter(name => isOnlineMode ? name === myManagerName : true)
              .map(name => (
                <div key={name} style={{ border: '1px solid #ccc', padding: '10px', background: '#f9f9f9', minWidth: '220px' }}>
                    <strong>{name}</strong> (Budget: €{gameState.managers[name].Budget.toLocaleString()})<br/>
                    <input type="text" placeholder="Enter bid amount" 
                           value={managerBids[name] || ''} 
                           onChange={(e) => setManagerBids({...managerBids, [name]: formatCurrency(e.target.value)})} 
                           style={{ marginTop: '5px' }} />
                    <button onClick={() => submitBid(name)} style={{ marginLeft: '5px', background: '#007bff', color: '#fff', cursor: 'pointer', border: 'none', padding: '4px 8px' }}>Bid</button>
                </div>
            ))}
          </div>
        </section>
      )}

      {gameState.auctionStatus === "Completed" && (
          <section style={{ border: '2px solid #28a745', padding: '15px', marginBottom: '20px' }}>
              <h2>🎉 Auction Completed! Build Your Starting 11</h2>
              <p>Select exactly 11 players for your starting lineup. The rest will act as substitutes.</p>
              
              {Object.entries(gameState.managers)
                .filter(([name]) => isOnlineMode ? name === myManagerName : true)
                .map(([name, data]) => {
                  const startersCount = data.Roster.filter(p => p.isStarting).length;
                  return (
                    <div key={name} style={{ marginBottom: '15px', padding: '10px', background: '#f1f1f1' }}>
                        <h3>{name} - {data.Formation} (Starters selected: {startersCount}/11)</h3>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '10px' }}>
                            {data.Roster.map((player, idx) => (
                                <label key={idx} style={{ background: player.isStarting ? '#d4edda' : '#fff', padding: '5px', border: '1px solid #ccc' }}>
                                    <input type="checkbox" checked={player.isStarting} 
                                           disabled={!player.isStarting && startersCount >= 11}
                                           onChange={(e) => socket.emit('toggleStarter', { mgrName: name, playerIndex: idx, isStarting: e.target.checked })} />
                                    {player.Name} - [{player.Position}] ({player.Rating})
                                </label>
                            ))}
                        </div>
                    </div>
                  );
              })}

              <button onClick={downloadExcel} style={{ padding: '10px', background: '#28a745', color: '#fff', cursor: 'pointer', border: 'none', marginTop: '20px', borderRadius: '5px' }}>
                  📊 Download Auction History (Excel/CSV)
              </button>
          </section>
      )}
    </div>
  );
}

export default App;