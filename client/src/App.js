import React, { useState, useEffect } from 'react';
import io from 'socket.io-client';

// NOTE: Keep your existing Render URL here!
const socket = io('https://matchattaxgame.onrender.com');

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

// Premium Theme Colors
const theme = {
    bgMain: '#0b0e14',
    bgCard: '#151922',
    accentNeon: '#00ff87', // FC 24/25 style neon green
    accentGold: '#FFD700',
    textMain: '#f0f2f5',
    textMuted: '#a0aabc',
    border: '#2a2d34'
};

const inputStyle = {
    backgroundColor: '#0b0e14', color: theme.textMain, border: `1px solid ${theme.border}`, 
    padding: '10px', borderRadius: '6px', width: '100%', boxSizing: 'border-box'
};

const btnStyle = {
    padding: '10px 15px', border: 'none', borderRadius: '6px', fontWeight: 'bold', 
    cursor: 'pointer', transition: '0.2s', color: '#000'
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
    <div style={{ padding: '30px 20px', fontFamily: '"Segoe UI", Tahoma, Geneva, Verdana, sans-serif', maxWidth: '1200px', margin: 'auto', minHeight: '100vh', color: theme.textMain }}>
      
      {/* Global Style Injection */}
      <style>{`
        body { background-color: ${theme.bgMain}; margin: 0; color: ${theme.textMain}; }
        input:focus, select:focus { outline: 2px solid ${theme.accentNeon}; border-color: transparent !important; }
        ::-webkit-scrollbar { width: 8px; }
        ::-webkit-scrollbar-track { background: ${theme.bgMain}; }
        ::-webkit-scrollbar-thumb { background: #333; border-radius: 4px; }
        ::-webkit-scrollbar-thumb:hover { background: #555; }
        table { border-collapse: collapse; border-radius: 8px; overflow: hidden; width: 100%; box-shadow: 0 4px 6px rgba(0,0,0,0.3); }
        th, td { border: 1px solid ${theme.border}; padding: 12px; text-align: left; }
        th { background-color: #1e2330; color: ${theme.accentNeon}; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; font-size: 13px; }
        tr:nth-child(even) { background-color: #12151c; }
        tr:nth-child(odd) { background-color: ${theme.bgCard}; }
        section { background-color: ${theme.bgCard}; border-radius: 12px; border: 1px solid ${theme.border}; box-shadow: 0 8px 16px rgba(0,0,0,0.4); padding: 25px; margin-bottom: 25px; }
      `}</style>

      {/* HEADER SECTION */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px', borderBottom: `1px solid ${theme.border}`, paddingBottom: '20px' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '2.5rem', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '-1px', background: `linear-gradient(90deg, ${theme.accentNeon}, #00b8ff)`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                FC 26 x Match Attax
            </h1>
            {myManagerName && <div style={{ marginTop: '8px', color: theme.textMuted, fontSize: '14px' }}>
                <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: theme.accentNeon, marginRight: '8px', boxShadow: `0 0 8px ${theme.accentNeon}` }}></span>
                Connected as: <strong style={{ color: '#fff' }}>{myManagerName}</strong>
            </div>}
          </div>
          <div style={{ display: 'flex', gap: '12px' }}>
              <button onClick={() => { if(window.confirm('Wipe auction history, rosters, and budgets?')) socket.emit('resetAuction'); }} style={{ ...btnStyle, background: '#2c3e50', color: '#fff' }}>🔄 Restart Auction</button>
              <button onClick={() => { if(window.confirm('Completely wipe everything?')) { localStorage.clear(); setMyManagerName(''); socket.emit('resetEntireGame'); } }} style={{ ...btnStyle, background: '#c0392b', color: '#fff' }}>🗑️ Hard Reset</button>
          </div>
      </div>

      <div style={{ marginBottom: '20px', padding: '15px', background: 'rgba(0, 255, 135, 0.05)', borderRadius: '8px', border: `1px solid rgba(0, 255, 135, 0.2)`, display: 'flex', gap: '20px', fontSize: '14px' }}>
        <strong style={{ color: theme.accentNeon }}>🌐 Databases:</strong>
        <a href="https://sofifa.com/players" target="_blank" rel="noreferrer" style={{ color: '#00b8ff', textDecoration: 'none', fontWeight: '500' }}>SoFIFA</a>
        <a href="https://www.transfermarkt.co.uk/spieler-statistik/wertvollstespieler/marktwertetop" target="_blank" rel="noreferrer" style={{ color: '#00b8ff', textDecoration: 'none', fontWeight: '500' }}>Transfermarkt</a>
        <a href="https://www.fifplay.com/fc-26/formations/?mode=kickoff" target="_blank" rel="noreferrer" style={{ color: '#00b8ff', textDecoration: 'none', fontWeight: '500' }}>Formations Guide</a>
      </div>

      <details style={{ marginBottom: '30px', padding: '15px', background: theme.bgCard, borderRadius: '8px', border: `1px solid ${theme.border}`, cursor: 'pointer' }}>
          <summary style={{ fontWeight: 'bold', color: theme.accentNeon }}>📊 View Card Spawn Probabilities & Boosts</summary>
          <div style={{ marginTop: '15px', overflowX: 'auto' }}>
            <table style={{ whiteSpace: 'nowrap' }}>
                <thead>
                    <tr>
                        <th>Card Variant</th>
                        <th>UEFA Prob.</th>
                        <th>Non-UEFA (&gt;30) Prob.</th>
                        <th>Stat Boosts & Conditions</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td>Base Card</td><td>32%</td><td>90%</td><td style={{ color: theme.textMuted }}>None</td></tr>
                    <tr><td>Man of the Match</td><td>15%</td><td>-</td><td><span style={{ color: theme.accentNeon }}>+3 ATK, +3 DEF</span> (All)</td></tr>
                    <tr><td>Wildcard</td><td>10%</td><td>-</td><td><span style={{ color: theme.accentNeon }}>+5 ATK, +5 DEF</span> (CB, RB, LB, RM, LM, RW, LW, ST)</td></tr>
                    <tr><td>All-Action Hero</td><td>10%</td><td>-</td><td><span style={{ color: theme.accentNeon }}>+5 ATK, +5 DEF</span> (CDM, CM, CAM, GK)</td></tr>
                    <tr><td>Heritage</td><td>8%</td><td>8%</td><td><span style={{ color: theme.accentNeon }}>+7 ATK, +7 DEF</span> (Requires Age &gt; 30)</td></tr>
                    <tr><td>Counter Attax</td><td>8%</td><td>-</td><td><span style={{ color: theme.accentNeon }}>+7 ATK, +3 DEF</span> (ST, RM, LM, RW, LW, LB, RB)</td></tr>
                    <tr><td>Stealth Strike</td><td>6%</td><td>-</td><td><span style={{ color: theme.accentNeon }}>+10 ATK</span> (FWD/MID) <strong style={{ color: theme.textMuted }}>OR</strong> <span style={{ color: theme.accentNeon }}>+10 DEF</span> (DEF/GK)</td></tr>
                    <tr><td>100 Club</td><td>5%</td><td>-</td><td><span style={{ color: theme.accentGold }}>100 ATK</span> (FWD/MID) <strong style={{ color: theme.textMuted }}>OR</strong> <span style={{ color: theme.accentGold }}>100 DEF</span> (DEF/GK)</td></tr>
                    <tr><td>101 Club</td><td>4%</td><td>-</td><td><span style={{ color: theme.accentGold }}>101 ATK, 101 DEF</span> (All)</td></tr>
                    <tr><td>Infinity</td><td>2%</td><td>2%</td><td><span style={{ color: '#8a2be2', fontWeight: 'bold' }}>Infinity ATK & DEF</span> (All)</td></tr>
                </tbody>
            </table>
          </div>
      </details>

      {/* LOBBY SECTION */}
      {gameState.auctionStatus === "Lobby" && (
        <section>
          <h3 style={{ marginTop: 0, color: theme.accentNeon, textTransform: 'uppercase', letterSpacing: '1px' }}>1. Manager Headquarters</h3>
          <div style={{ display: 'flex', gap: '15px', marginBottom: '25px', maxWidth: '600px' }}>
              <input type="text" placeholder="Enter Manager Name" value={regName} onChange={(e) => setRegName(e.target.value)} style={inputStyle} />
              <select value={regFormation} onChange={(e) => setRegFormation(e.target.value)} style={{...inputStyle, width: '250px'}}>
                {FORMATIONS.map(form => <option key={form} value={form}>{form}</option>)}
              </select>
              <button onClick={() => { socket.emit('registerManager', { name: regName, formation: regFormation }); setRegName(''); }} style={{ ...btnStyle, background: theme.accentNeon, minWidth: '120px' }}>Join Lobby</button>
          </div>
          
          <div style={{ borderTop: `1px solid ${theme.border}`, paddingTop: '20px' }}>
            <h4 style={{ color: theme.textMuted, marginBottom: '15px' }}>SELECT GAMEMODE TO INITIATE AUCTION:</h4>
            <div style={{ display: 'flex', gap: '15px', flexWrap: 'wrap' }}>
                <button onClick={() => socket.emit('startGame', 'Pass & Play Casual')} style={{ ...btnStyle, background: 'rgba(255,255,255,0.1)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)' }}>🎮 Pass & Play Casual</button>
                <button onClick={() => socket.emit('startGame', 'Pass & Play Tournament')} style={{ ...btnStyle, background: 'rgba(255,255,255,0.1)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)' }}>🏆 Pass & Play Tournament</button>
                <button onClick={() => socket.emit('startGame', 'Online Match')} style={{ ...btnStyle, background: '#00b8ff', color: '#000' }}>🌐 Online Match (2P)</button>
                <button onClick={() => socket.emit('startGame', 'Online Tournament')} style={{ ...btnStyle, background: '#8a2be2', color: '#fff' }}>🌐 Online Tournament (4-16P)</button>
            </div>
          </div>
        </section>
      )}

      {/* MANAGER TRACKERS */}
      <section>
        <h3 style={{ marginTop: 0, color: theme.accentNeon, textTransform: 'uppercase' }}>Live Manager Hub {gameState.gameMode && <span style={{ color: theme.textMuted, fontSize: '14px', textTransform: 'none' }}>— {gameState.gameMode}</span>}</h3>
        <table>
          <thead>
            <tr><th>Manager</th><th>Formation</th><th>Transfer Budget</th><th>Roster</th><th>Status</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {Object.entries(gameState.managers).map(([name, data]) => (
              <tr key={name}>
                <td>
                    <strong style={{ color: activeManagerName === name ? theme.accentNeon : '#fff' }}>{name}</strong>
                    {activeManagerName === name && <span style={{ marginLeft: '10px', fontSize: '12px', background: theme.accentNeon, color: '#000', padding: '2px 6px', borderRadius: '4px', fontWeight: 'bold' }}>ON CLOCK</span>}
                </td>
                <td>{data.Formation}</td>
                <td style={{ fontFamily: 'monospace', fontSize: '16px', color: theme.accentGold }}>€{data.Budget.toLocaleString()}</td>
                <td>{data.Roster.length}/18</td>
                <td><span style={{ color: data.Status === 'Active' ? theme.accentNeon : theme.textMuted }}>{data.Status}</span></td>
                <td>
                    <button onClick={() => setViewRosterMgr(viewRosterMgr === name ? null : name)} style={{ ...btnStyle, padding: '6px 12px', background: '#2c3e50', color: '#fff', fontSize: '12px' }}>View Squad</button>
                    {gameState.auctionStatus === "Lobby" && <button onClick={() => socket.emit('removeManager', name)} style={{ background: 'none', border: 'none', color: '#e74c3c', cursor: 'pointer', marginLeft: '10px', fontSize: '16px' }}>✖</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {viewRosterMgr && (
            <div style={{ padding: '20px', background: '#0b0e14', marginTop: '15px', borderRadius: '8px', border: `1px solid ${theme.border}` }}>
                <strong style={{ color: theme.accentGold }}>{viewRosterMgr}'s Current Roster: </strong><br/><br/>
                {gameState.managers[viewRosterMgr].Roster.length === 0 ? <span style={{ color: theme.textMuted }}>Squad is empty.</span> : 
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                        {gameState.managers[viewRosterMgr].Roster.map((p, i) => (
                            <span key={i} style={{ background: '#1e2330', padding: '6px 12px', borderRadius: '4px', fontSize: '13px', border: '1px solid #333' }}>
                                <strong>{p.Name}</strong> <span style={{ color: theme.accentNeon }}>[{p.Position}]</span> <span style={{ color: theme.textMuted }}>({p.CardType})</span>
                            </span>
                        ))}
                    </div>
                }
            </div>
        )}
      </section>

      {/* SCOUTING / PLAYER SELECTION */}
      {gameState.auctionStatus === "Active" && (
        <section>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h3 style={{ margin: 0, color: theme.accentNeon, textTransform: 'uppercase' }}>2. Global Scouting Network</h3>
              <div style={{ background: 'rgba(255, 0, 0, 0.1)', color: '#ff4d4d', padding: '6px 12px', borderRadius: '6px', border: '1px solid rgba(255, 0, 0, 0.3)', fontWeight: 'bold', fontSize: '14px' }}>
                  🎯 {activeManagerName}'S TURN TO SCOUT
              </div>
          </div>
          
          {!isMyTurn ? (
            <div style={{ padding: '40px', background: '#0b0e14', borderRadius: '8px', textAlign: 'center', border: `1px dashed #333` }}>
               <h4 style={{ color: theme.textMuted, margin: 0, fontWeight: 'normal' }}>⏳ Waiting for <strong>{activeManagerName}</strong> to finalize scouting target...</h4>
            </div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
                <input type="text" placeholder="Full Player Name" value={pName} onChange={(e) => setPName(e.target.value)} style={inputStyle} />
                <select value={pPos} onChange={(e) => setPPos(e.target.value)} style={inputStyle}>
                  <option value="ST">ST / CF</option><option value="LW">LW</option><option value="RW">RW</option>
                  <option value="LM">LM</option><option value="RM">RM</option><option value="CAM">CAM</option>
                  <option value="CM">CM</option><option value="CDM">CDM</option><option value="LB">LB</option>
                  <option value="RB">RB</option><option value="CB">CB</option><option value="GK">GK</option>
                </select>
                <input type="number" placeholder="Age" value={pAge} onChange={(e) => setPAge(e.target.value)} style={inputStyle} />
                <select value={pClub} onChange={(e) => setPClub(e.target.value)} style={inputStyle}>
                  <option value="Other League Club (Base Card Only)">Other League Club (Base Card Only)</option>
                  {Object.entries(UEFA_CLUBS).map(([league, clubs]) => (
                      <optgroup key={league} label={league}>
                          {clubs.map(club => <option key={club} value={club}>{club}</option>)}
                      </optgroup>
                  ))}
                </select>
                <input type="text" placeholder="Transfermarkt Price (€)" value={pValue} onChange={(e) => setPValue(formatCurrency(e.target.value))} style={inputStyle} />
              </div>
              
              <div style={{ marginTop: '25px', padding: '20px', background: '#0b0e14', borderRadius: '8px', border: `1px solid ${theme.border}` }}>
                  <h4 style={{ margin: '0 0 15px 0', color: theme.textMuted, textTransform: 'uppercase', fontSize: '13px' }}>EA FC 26 Base Attributes</h4>
                  <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                    {currentStatLabels.map(({ key, label }) => (
                      <div key={key} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1, minWidth: '60px' }}>
                        <label style={{ fontSize: '12px', fontWeight: 'bold', color: theme.accentNeon, marginBottom: '8px' }}>{label}</label>
                        <input 
                            type="number" 
                            style={{ ...inputStyle, textAlign: 'center', fontSize: '16px', fontWeight: 'bold', padding: '10px 5px' }} 
                            value={stats[key]} 
                            onChange={(e) => setStats({ ...stats, [key]: e.target.value })} 
                        />
                      </div>
                    ))}
                  </div>
              </div>

              <button onClick={handlePlayerSubmit} disabled={!!gameState.cardOnBlock} style={{ ...btnStyle, background: `linear-gradient(90deg, ${theme.accentNeon}, #00b8ff)`, color: '#000', width: '100%', marginTop: '20px', padding: '15px', fontSize: '16px', textTransform: 'uppercase', letterSpacing: '1px', boxShadow: `0 4px 15px rgba(0, 255, 135, 0.3)` }}>
                Generate Card & Launch Auction
              </button>
            </>
          )}
        </section>
      )}

      {/* AUCTION BLOCK - GOLD THEME */}
      {gameState.cardOnBlock && (
        <section style={{ border: `2px solid ${theme.accentGold}`, boxShadow: `0 0 20px rgba(255, 215, 0, 0.15)`, background: 'linear-gradient(145deg, #151922, #1a1a1a)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
                <div style={{ color: theme.accentGold, fontSize: '14px', fontWeight: 'bold', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '5px' }}>Live Transfer Target</div>
                <h2 style={{ margin: 0, fontSize: '2.2rem', color: '#fff', textTransform: 'uppercase' }}>{gameState.cardOnBlock.Name} <span style={{ color: theme.textMuted, fontSize: '1.5rem' }}>[{gameState.cardOnBlock.Position}]</span></h2>
            </div>
            <div style={{ textAlign: 'right' }}>
                <h1 style={{ margin: 0, fontSize: '3rem', color: timeLeft <= 10 ? '#ff4d4d' : theme.accentNeon, textShadow: `0 0 10px ${timeLeft <= 10 ? 'rgba(255,0,0,0.5)' : 'rgba(0,255,135,0.3)'}` }}>
                    {timeLeft}s
                </h1>
            </div>
          </div>
          
          <div style={{ display: 'flex', gap: '30px', marginTop: '20px', padding: '20px', background: '#0b0e14', borderRadius: '8px', border: `1px solid ${theme.border}` }}>
              <div>
                  <div style={{ color: theme.textMuted, fontSize: '12px', textTransform: 'uppercase' }}>Club</div>
                  <div style={{ fontSize: '18px', fontWeight: 'bold' }}>{gameState.cardOnBlock.Club}</div>
              </div>
              <div>
                  <div style={{ color: theme.textMuted, fontSize: '12px', textTransform: 'uppercase' }}>Card Rarity</div>
                  <div style={{ fontSize: '18px', fontWeight: 'bold', color: theme.accentGold }}>{gameState.cardOnBlock.CardType}</div>
              </div>
              <div>
                  <div style={{ color: theme.textMuted, fontSize: '12px', textTransform: 'uppercase' }}>OVR Attributes</div>
                  <div style={{ fontSize: '18px', fontWeight: 'bold' }}>
                      <span style={{ color: '#00b8ff' }}>ATK {gameState.cardOnBlock.Attack}</span> <span style={{ color: '#444' }}>|</span> <span style={{ color: '#ff4d4d' }}>DEF {gameState.cardOnBlock.Defence}</span>
                  </div>
              </div>
          </div>
          
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '20px', padding: '15px 20px', background: 'rgba(255, 215, 0, 0.05)', borderRadius: '8px' }}>
            <div style={{ fontSize: '16px' }}>
                <span style={{ color: theme.textMuted }}>Base Valuation:</span> <strong style={{ color: '#fff' }}>€{gameState.cardOnBlock.Value.toLocaleString()}</strong>
            </div>
            <div style={{ fontSize: '20px' }}>
                <span style={{ color: theme.textMuted }}>Current Bid:</span> <strong style={{ color: theme.accentGold }}>€{gameState.cardOnBlock.highestBid.toLocaleString()}</strong> 
                <span style={{ fontSize: '14px', color: theme.textMuted, marginLeft: '10px' }}>(by {gameState.cardOnBlock.highestBidder || 'None'})</span>
            </div>
          </div>

          <hr style={{ borderColor: theme.border, margin: '30px 0 20px 0' }}/>
          <h4 style={{ margin: '0 0 15px 0', color: theme.textMuted, textTransform: 'uppercase' }}>Manager Bidding Consoles (Min. Bid: €1M)</h4>
          
          <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
            {Object.keys(gameState.managers)
              .filter(name => gameState.managers[name].Status === 'Active')
              .filter(name => isOnlineMode ? name === myManagerName : true)
              .map(name => (
                <div key={name} style={{ flex: 1, minWidth: '250px', border: `1px solid ${theme.border}`, padding: '20px', borderRadius: '8px', background: '#0b0e14' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '15px' }}>
                        <strong style={{ fontSize: '18px', color: '#fff' }}>{name}</strong>
                        <span style={{ color: theme.accentGold, fontFamily: 'monospace' }}>€{gameState.managers[name].Budget.toLocaleString()}</span>
                    </div>
                    <div style={{ display: 'flex', gap: '10px' }}>
                        <input type="text" placeholder="Enter bid..." 
                            value={managerBids[name] || ''} 
                            onChange={(e) => setManagerBids({...managerBids, [name]: formatCurrency(e.target.value)})} 
                            style={{ ...inputStyle, background: '#1a1a1a' }} />
                        <button onClick={() => submitBid(name)} style={{ ...btnStyle, background: theme.accentNeon, width: '80px' }}>BID</button>
                    </div>
                </div>
            ))}
          </div>
        </section>
      )}

      {/* SQUAD BUILDER / COMPLETED SCREEN */}
      {gameState.auctionStatus === "Completed" && (
          <section style={{ border: `2px solid ${theme.accentNeon}`, boxShadow: `0 0 15px rgba(0, 255, 135, 0.1)` }}>
              <div style={{ textAlign: 'center', marginBottom: '30px' }}>
                <h2 style={{ color: theme.accentNeon, margin: '0 0 10px 0', textTransform: 'uppercase', fontSize: '2.5rem' }}>Transfer Window Closed</h2>
                <p style={{ color: theme.textMuted, fontSize: '16px' }}>Select exactly 11 players for your Starting XI. The rest will move to the bench.</p>
              </div>
              
              {Object.entries(gameState.managers)
                .filter(([name]) => isOnlineMode ? name === myManagerName : true)
                .map(([name, data]) => {
                  const startersCount = data.Roster.filter(p => p.isStarting).length;
                  const isFull = startersCount === 11;
                  return (
                    <div key={name} style={{ marginBottom: '30px', padding: '25px', background: '#0b0e14', borderRadius: '12px', border: `1px solid ${theme.border}` }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', borderBottom: `1px solid ${theme.border}`, paddingBottom: '15px' }}>
                            <h3 style={{ margin: 0, fontSize: '1.5rem', color: '#fff' }}>{name} <span style={{ color: theme.textMuted, fontSize: '1rem', fontWeight: 'normal' }}>({data.Formation})</span></h3>
                            <div style={{ background: isFull ? 'rgba(0,255,135,0.1)' : 'rgba(255,255,255,0.05)', color: isFull ? theme.accentNeon : '#fff', padding: '8px 15px', borderRadius: '20px', border: `1px solid ${isFull ? theme.accentNeon : theme.border}`, fontWeight: 'bold' }}>
                                Starting XI: {startersCount}/11
                            </div>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '15px' }}>
                            {data.Roster.map((player, idx) => (
                                <label key={idx} style={{ 
                                    background: player.isStarting ? 'rgba(0, 255, 135, 0.08)' : '#151922', 
                                    padding: '12px', borderRadius: '8px', border: `1px solid ${player.isStarting ? theme.accentNeon : theme.border}`, 
                                    cursor: (!player.isStarting && isFull) ? 'not-allowed' : 'pointer',
                                    display: 'flex', alignItems: 'center', gap: '10px', transition: '0.2s',
                                    opacity: (!player.isStarting && isFull) ? 0.5 : 1
                                }}>
                                    <input type="checkbox" checked={player.isStarting} 
                                           disabled={!player.isStarting && isFull}
                                           onChange={(e) => socket.emit('toggleStarter', { mgrName: name, playerIndex: idx, isStarting: e.target.checked })} 
                                           style={{ accentColor: theme.accentNeon, width: '18px', height: '18px' }}/>
                                    <div style={{ lineHeight: '1.4' }}>
                                        <div style={{ fontWeight: 'bold', color: player.isStarting ? theme.accentNeon : '#fff' }}>{player.Name}</div>
                                        <div style={{ fontSize: '12px', color: theme.textMuted }}>[{player.Position}] <span style={{ color: theme.accentGold }}>{player.Rating}</span></div>
                                    </div>
                                </label>
                            ))}
                        </div>
                    </div>
                  );
              })}

              <div style={{ textAlign: 'center', marginTop: '40px' }}>
                <button onClick={downloadExcel} style={{ ...btnStyle, background: '#27ae60', color: '#fff', padding: '15px 30px', fontSize: '16px', borderRadius: '30px', boxShadow: '0 4px 15px rgba(39, 174, 96, 0.4)' }}>
                    📊 Download Official Match Data (CSV)
                </button>
              </div>
          </section>
      )}
    </div>
  );
}

export default App;