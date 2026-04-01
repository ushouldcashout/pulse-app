import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createAppKit, useAppKit, useAppKitAccount, useAppKitNetwork, useDisconnect } from '@reown/appkit/react';
import { WagmiProvider, useSendTransaction, useWaitForTransactionReceipt } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi';
import { defineChain, parseEther, encodeFunctionData } from 'viem';

// ============================================
// SMART CONTRACT CONFIG
// ============================================
const CONTRACT_ADDRESS = '0x4bB20069F4E6C5eC5a197Cd03682e9109d2D2beb';

const CONTRACT_OWNER = '0xFbA931640B3075f054C68F40b18aD7Ecc36cb8F6';

const PULSE_ABI = [
  {
    name: 'placeBet',
    type: 'function',
    stateMutability: 'payable',
    inputs: [{ name: 'direction', type: 'uint8' }],
    outputs: [],
  },
  {
    name: 'startRound',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'startPrice', type: 'int256' }],
    outputs: [],
  },
  {
    name: 'resolveRound',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'endPrice', type: 'int256' }],
    outputs: [],
  },
  {
    name: 'claim',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'roundId', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'getUserPoints',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'currentRound',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'getCurrentRound',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'id', type: 'uint256' },
      { name: 'startTime', type: 'uint256' },
      { name: 'bettingEnd', type: 'uint256' },
      { name: 'roundEnd', type: 'uint256' },
      { name: 'startPrice', type: 'int256' },
      { name: 'endPrice', type: 'int256' },
      { name: 'totalUp', type: 'uint256' },
      { name: 'totalDown', type: 'uint256' },
      { name: 'resolved', type: 'bool' },
      { name: 'result', type: 'uint8' },
    ],
  },
];

// ============================================
// FIX: Telegram deep link encoding issue
// ============================================
if (typeof window !== 'undefined' && window.Telegram?.WebApp) {
  var _tg = window.Telegram.WebApp;

  // Safely decode multi-encoded URLs (handles double/triple encoding)
  var _decode = function(url) {
    if (!url || typeof url !== 'string') return url;
    var prev = url;
    for (var i = 0; i < 3; i++) {
      try {
        var next = decodeURIComponent(prev);
        if (next === prev) break;
        prev = next;
      } catch (e) { break; }
    }
    return prev;
  };

  // Check if URL is a wallet deep link that needs Telegram.openLink
  var _isWalletLink = function(url) {
    if (!url) return false;
    if (url.startsWith('wc:')) return true;
    var walletHosts = [
      'metamask.app.link',
      'link.trustwallet.com',
      'rainbow.me',
      'go.cb-w.com',
      'wallet.coinbase.com',
      'coinbase.com/wsegue'
    ];
    for (var i = 0; i < walletHosts.length; i++) {
      if (url.indexOf(walletHosts[i]) !== -1) return true;
    }
    return false;
  };

  var originalOpen = window.open;
  window.open = function(url, target, features) {
    if (url && typeof url === 'string') {
      var fixedUrl = _decode(url);

      if (_isWalletLink(fixedUrl)) {
        try { _tg.openLink(fixedUrl); } catch (e) { originalOpen.call(window, fixedUrl, '_blank'); }
        return null;
      }

      // Route other _blank links through Telegram too
      if (fixedUrl.startsWith('https://') && target === '_blank') {
        try { _tg.openLink(fixedUrl); return null; } catch (e) {}
      }
    }
    return originalOpen.call(window, url, target, features);
  };
}

// ============================================
// CHAIN CONFIG
// ============================================
const inkSepolia = defineChain({
  id: 763373,
  name: 'Ink Sepolia',
  network: 'ink-sepolia',
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc-gel-sepolia.inkonchain.com'] },
    public: { http: ['https://rpc-gel-sepolia.inkonchain.com'] }
  },
  blockExplorers: {
    default: { name: 'Explorer', url: 'https://explorer-sepolia.inkonchain.com' }
  },
  testnet: true
});

// ============================================
// REOWN/WALLETCONNECT SETUP
// ============================================
const projectId = 'a9df3dfe815059cea1a93ea4b79c1a34';

const metadata = {
  name: 'Pulse',
  description: '10-Second Crypto Predictions',
  url: 'https://pulsebet.fun',
  icons: ['https://pulsebet.fun/logo.png']
};

const networks = [inkSepolia];

const wagmiAdapter = new WagmiAdapter({
  networks,
  projectId,
  ssr: false
});

// In Telegram WebView there are no injected wallets — only WalletConnect works
var _inTelegram = typeof window !== 'undefined' && !!(window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData);

createAppKit({
  adapters: [wagmiAdapter],
  networks,
  projectId,
  metadata,
  themeMode: 'dark',
  themeVariables: {
    '--w3m-accent': '#10b981',
    '--w3m-border-radius-master': '12px'
  },
  featuredWalletIds: [
    'c57ca95b47569778a828d19178114f4db188b89b763c899ba0be274e97267d96', // MetaMask
    '4622a2b2d6af1c9844944291e5e7351a6aa24cd7b23099efac1b2fd875da31a0', // Trust
    '1ae92b26df02f0abca6304df07debccd18262fdf5fe82daa81593582dac9a369', // Rainbow
    'fd20dc426fb37566d803205b19bbc1d4096b248ac04548e3cfb6b3a38bd033aa', // Coinbase
  ],
  features: {
    analytics: false,
    email: false,
    socials: false,
    swaps: false,
    onramp: false,
  },
  enableWalletConnect: true,
  enableInjected: !_inTelegram,
  enableEIP6963: !_inTelegram,
  enableCoinbase: true,
});

const queryClient = new QueryClient();

const WS_URL = 'wss://pulse-backend-production-b2c9.up.railway.app';

// ============================================
// CSS ANIMATIONS & STYLES
// ============================================
const PULSE_STYLES = `
@keyframes pulseGlow {
  0%, 100% { box-shadow: 0 0 8px rgba(16,185,129,0.3); }
  50% { box-shadow: 0 0 24px rgba(16,185,129,0.6), 0 0 48px rgba(16,185,129,0.2); }
}
@keyframes pulseGlowRed {
  0%, 100% { box-shadow: 0 0 8px rgba(239,68,68,0.3); }
  50% { box-shadow: 0 0 24px rgba(239,68,68,0.6), 0 0 48px rgba(239,68,68,0.2); }
}
@keyframes priceFlashGreen {
  0% { color: #10b981; text-shadow: 0 0 20px rgba(16,185,129,0.8); }
  100% { color: #fff; text-shadow: none; }
}
@keyframes priceFlashRed {
  0% { color: #ef4444; text-shadow: 0 0 20px rgba(239,68,68,0.8); }
  100% { color: #fff; text-shadow: none; }
}
@keyframes slideIn {
  0% { opacity: 0; transform: translateY(10px); }
  100% { opacity: 1; transform: translateY(0); }
}
@keyframes countdownPulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.05); }
}
@keyframes shimmer {
  0% { background-position: -200% center; }
  100% { background-position: 200% center; }
}
@keyframes confetti {
  0% { opacity: 1; transform: translateY(0) rotate(0deg); }
  100% { opacity: 0; transform: translateY(-80px) rotate(360deg); }
}
@keyframes fadeIn {
  0% { opacity: 0; }
  100% { opacity: 1; }
}
@keyframes ringProgress {
  0% { stroke-dashoffset: 283; }
}
@keyframes breathe {
  0%, 100% { opacity: 0.6; }
  50% { opacity: 1; }
}
@keyframes ecosystemPulse {
  0%, 100% { opacity: 0.8; }
  50% { opacity: 1; }
}
.pulse-btn-up:not(:disabled):hover {
  transform: translateY(-2px) !important;
  box-shadow: 0 8px 30px rgba(16,185,129,0.4) !important;
}
.pulse-btn-down:not(:disabled):hover {
  transform: translateY(-2px) !important;
  box-shadow: 0 8px 30px rgba(239,68,68,0.4) !important;
}
.pulse-btn-up:not(:disabled):active, .pulse-btn-down:not(:disabled):active {
  transform: translateY(0) !important;
}
.glass-card {
  background: rgba(255,255,255,0.03) !important;
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255,255,255,0.06);
}
.amount-btn { transition: all 0.15s ease !important; }
.amount-btn:hover { transform: scale(1.08) !important; }
.sidebar-card {
  background: rgba(255,255,255,0.02);
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 14px;
  padding: 16px;
  margin-bottom: 12px;
  transition: all 0.2s ease;
}
.sidebar-card:hover {
  background: rgba(255,255,255,0.03);
  border-color: rgba(255,255,255,0.08);
}
.sidebar-stat {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 0;
  font-size: 12px;
  color: #9ca3af;
}
.sidebar-stat-value {
  font-weight: 700;
  color: #fff;
  font-family: monospace;
  font-size: 13px;
}
.lb-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
  border-bottom: 1px solid rgba(255,255,255,0.03);
  font-size: 11px;
}
.lb-item:last-child {
  border-bottom: none;
}
.live-bet-item {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px;
  background: rgba(255,255,255,0.02);
  border-radius: 8px;
  font-size: 10px;
  border: 1px solid rgba(255,255,255,0.03);
  margin-bottom: 6px;
  animation: fadeIn 0.3s ease;
}
`;

// ============================================
// SVG PULSE LOGO
// ============================================
const PulseLogo = ({ size = 34 }) => (
  <svg width={size} height={size} viewBox="0 0 40 40" fill="none">
    <rect width="40" height="40" rx="12" fill="url(#logoGrad)" />
    <path d="M8 22h6l3-10 5 18 4-14 3 6h3" stroke="#000" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    <defs>
      <linearGradient id="logoGrad" x1="0" y1="0" x2="40" y2="40">
        <stop stopColor="#10b981" />
        <stop offset="1" stopColor="#06b6d4" />
      </linearGradient>
    </defs>
  </svg>
);

// ============================================
// CUSTOM HOOKS FOR ECOSYSTEM DATA
// ============================================
const formatUSD = (num) => {
  if (num == null || isNaN(num)) return '...';
  if (num >= 1e9) return '$' + (num / 1e9).toFixed(2) + 'B';
  if (num >= 1e6) return '$' + (num / 1e6).toFixed(2) + 'M';
  if (num >= 1e3) return '$' + num.toLocaleString('en-US', { maximumFractionDigits: 0 });
  return '$' + num.toFixed(2);
};

const useEcosystemData = () => {
  const [tydroTVL, setTydroTVL] = useState(null);
  const [inkTVL, setInkTVL] = useState(null);
  const [nadoVolume, setNadoVolume] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(() => {
    setLoading(true);
    Promise.all([
      fetch('https://api.llama.fi/tvl/tydro').then(r => r.json()).catch(() => null),
      fetch('https://api.llama.fi/v2/chains').then(r => r.json()).catch(() => null),
      fetch('https://api.nado.xyz/v2/stats').then(r => r.json()).catch(() => null),
    ]).then(([tydroData, inkData, nadoData]) => {
      if (tydroData && !isNaN(tydroData)) {
        setTydroTVL(parseFloat(tydroData));
      } else {
        setTydroTVL(140000000);
      }

      if (inkData && Array.isArray(inkData)) {
        const ink = inkData.find(c => c.name === 'Ink');
        if (ink) setInkTVL(parseFloat(ink.tvl) || 156.2);
        else setInkTVL(52000000);
      } else {
        setInkTVL(52000000);
      }

      if (nadoData && nadoData.volume24h) {
        setNadoVolume(parseFloat(nadoData.volume24h));
      } else {
        setNadoVolume(48200000);
      }

      setLoading(false);
    });
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 60000);
  var saveName = function() {
    var n = nameInput.trim();
    if (!n || n.length < 1 || n.length > 16) return;
    setUsername(n);
    setNameInput(n);
    setEditingName(false);
    try { localStorage.setItem('pulse_chat_name', n); } catch(e) {}
  }

    return () => clearInterval(interval);
  }, [fetchData]);

  return { tydroTVL, inkTVL, nadoVolume, loading };
};

const useNadoData = () => {
  const [volume24h, setVolume24h] = useState(48200000);
  const [openInterest, setOpenInterest] = useState(18700000);
  const [topPair, setTopPair] = useState('BTC/USD');

  useEffect(() => {
    const fetchNadoData = () => {
      fetch('https://api.nado.xyz/v2/stats')
        .then(r => r.json())
        .then(data => {
          if (data.volume24h) setVolume24h(parseFloat(data.volume24h));
          if (data.openInterest) setOpenInterest(parseFloat(data.openInterest));
          if (data.topPair) setTopPair(data.topPair);
        })
        .catch(() => {});
    };

    fetchNadoData();
    const interval = setInterval(fetchNadoData, 30000);
    return () => clearInterval(interval);
  }, []);

  return { volume24h, openInterest, topPair };
};

// ============================================
// SIDEBAR COMPONENTS
// ============================================
const EcosystemSidebar = ({winRate = 0, streak = 0}) => {
  const { tydroTVL, inkTVL, nadoVolume } = useEcosystemData();

  const mockLeaderboard = [
    { address: '0xA3f1...8c2d', points: 12450, streak: 7 },
    { address: '0xB7e2...4f91', points: 9830, streak: 5 },
    { address: '0x9d4c...1a73', points: 8210, streak: 3 },
    { address: '0xE6f8...5b2e', points: 6540, streak: 4 },
    { address: '0x2c1a...9d47', points: 5120, streak: 2 },
  ];

  return (
    <div style={{ width: '240px', overflowY: 'auto', paddingRight: '8px', scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.1) transparent' }}>
      {/* Ink Ecosystem Stats */}
      <div className="sidebar-card">
        <div style={{ fontSize: '10px', fontWeight: '800', color: '#10b981', letterSpacing: '2px', marginBottom: '12px', textTransform: 'uppercase' }}>
          INK ECOSYSTEM
        </div>
        <div className="sidebar-stat">
          <span>Tydro TVL</span>
          <span className="sidebar-stat-value">{formatUSD(tydroTVL)}</span>
        </div>
        <div className="sidebar-stat">
          <span>Ink TVL</span>
          <span className="sidebar-stat-value">{formatUSD(inkTVL)}</span>
        </div>
        <div className="sidebar-stat">
          <span>Nado 24h Vol</span>
          <span className="sidebar-stat-value">{formatUSD(nadoVolume)}</span>
        </div>
      </div>

      {/* Tydro Rates */}
      <div className="sidebar-card">
        <div style={{ fontSize: '10px', fontWeight: '800', color: '#06b6d4', letterSpacing: '2px', marginBottom: '12px', textTransform: 'uppercase' }}>
          Tydro Rates
        </div>
        <div className="sidebar-stat">
          <span>ETH Supply APY</span>
          <span className="sidebar-stat-value">8.2%</span>
        </div>
        <div className="sidebar-stat">
          <span>ETH Borrow APY</span>
          <span className="sidebar-stat-value">12.5%</span>
        </div>
      </div>

      {/* Mini Leaderboard */}
      <div className="sidebar-card">
        <div style={{ fontSize: '10px', fontWeight: '800', color: '#fbbf24', letterSpacing: '2px', marginBottom: '12px' }}>
          TOP DEGENS 🏆
        </div>
        {mockLeaderboard.map((player, i) => (
          <div key={i} className="lb-item">
            <span style={{ color: '#6b7280', minWidth: '16px' }}>#{i + 1}</span>
            <span style={{ color: '#9ca3af', flex: 1, fontFamily: 'monospace' }}>{player.address}</span>
            <span style={{ color: '#10b981', fontWeight: '700' }}>{player.points}</span>
            <span style={{ color: '#fbbf24' }}>⚡{player.streak}</span>
          </div>
        ))}
      </div>

      {/* Your Stats (placeholder - would use actual state) */}
      <div className="sidebar-card">
        <div style={{ fontSize: '10px', fontWeight: '800', color: '#10b981', letterSpacing: '2px', marginBottom: '12px', textTransform: 'uppercase' }}>
          Your Stats
        </div>
        <div className="sidebar-stat">
          <span>Points</span>
          <span className="sidebar-stat-value">---</span>
        </div>
        <div className="sidebar-stat">
          <span>Win Rate</span>
          <span className="sidebar-stat-value">{winRate}%</span>
        </div>
        <div className="sidebar-stat">
          <span>Streak</span>
          <span className="sidebar-stat-value">{streak > 0 ? "+" + streak : streak}</span>
        </div>
      </div>
    </div>
  );
};

const LiveFeedSidebar = ({ recentBets, points, winRate = 0, streak = 0}) => {
  const { volume24h, openInterest, topPair } = useNadoData();

  const comingSoonMarkets = [
    'Will Tydro ETH utilization cross 80%?',
    'Nado 24h volume over $5M?',
    'INK TVL +10% this week?',
  ];

  return (
    <div style={{ width: '260px', overflowY: 'auto', paddingLeft: '8px', scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.1) transparent' }}>
      {/* Live Bet Feed */}
      <div className="sidebar-card">
        <div style={{ fontSize: '10px', fontWeight: '800', color: '#ef4444', letterSpacing: '2px', marginBottom: '12px' }}>
          LIVE BETS 🔴
        </div>
        <div style={{ maxHeight: '200px', overflowY: 'auto', scrollbarWidth: 'thin' }}>
          {recentBets && recentBets.length > 0 ? (
            recentBets.slice(0, 15).map((bet, i) => {
              const isUp = bet.side === 'up';
              return (
                <div key={i} className="live-bet-item" style={{
                  borderColor: isUp ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
                  background: isUp ? 'rgba(16,185,129,0.03)' : 'rgba(239,68,68,0.03)',
                }}>
                  <span style={{ fontSize: '11px' }}>{isUp ? '🟢' : '🔴'}</span>
                  <span style={{ color: '#9ca3af', fontFamily: 'monospace', flex: 1 }}>{bet.name?.slice(0, 8) || '0x???'}</span>
                  <span style={{ color: isUp ? '#10b981' : '#ef4444', fontWeight: '700', fontSize: '9px' }}>
                    {bet.amount} {isUp ? 'UP' : 'DN'}
                  </span>
                </div>
              );
            })
          ) : (
            <div style={{ fontSize: '11px', color: '#6b7280', padding: '8px 0' }}>Waiting for bets...</div>
          )}
        </div>
      </div>

      {/* Your Stats */}
      <div className="sidebar-card">
        <div style={{ fontSize: "10px", fontWeight: "800", color: "#fbbf24", letterSpacing: "2px", marginBottom: "12px" }}>YOUR STATS</div>
        <div className="sidebar-stat"><span>Win Rate</span><span className="sidebar-stat-value" style={{ color: "#10b981" }}>{winRate}%</span></div>
        <div className="sidebar-stat"><span>Streak</span><span className="sidebar-stat-value" style={{ color: streak > 0 ? "#10b981" : streak < 0 ? "#ef4444" : "#6b7280" }}>{streak > 0 ? "+" + streak + " W" : streak < 0 ? streak + " L" : "0"}</span></div>
        <div className="sidebar-stat"><span>Points</span><span className="sidebar-stat-value" style={{ color: "#fbbf24" }}>{points}</span></div>
      </div>

      {/* Nado Quick Stats */}
      <div className="sidebar-card">
        <div style={{ fontSize: '10px', fontWeight: '800', color: '#a855f7', letterSpacing: '2px', marginBottom: '12px', textTransform: 'uppercase' }}>
          Nado DEX
        </div>
        <div className="sidebar-stat">
          <span>24h Volume</span>
          <span className="sidebar-stat-value">{formatUSD(volume24h)}</span>
        </div>
        <div className="sidebar-stat">
          <span>Open Interest</span>
          <span className="sidebar-stat-value">{formatUSD(openInterest)}</span>
        </div>
        <div className="sidebar-stat">
          <span>Top Pair</span>
          <span className="sidebar-stat-value">{topPair}</span>
        </div>
      </div>

      {/* DeFi Predictions - LIVE */}
      <a href="/defi-markets.html" style={{ textDecoration: 'none', display: 'block' }}>
        <div className="sidebar-card" style={{ borderColor: 'rgba(168,85,247,0.3)', background: 'rgba(168,85,247,0.05)', cursor: 'pointer' }}>
          <div style={{ fontSize: '10px', fontWeight: '800', color: '#a855f7', letterSpacing: '2px', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', background: '#a855f7', animation: 'pulse 2s infinite' }}></span>
            PREDICT DEFI
          </div>
          {comingSoonMarkets.map((market, i) => (
            <div key={i} style={{ fontSize: '10px', color: '#9ca3af', padding: '6px 0', borderBottom: i < comingSoonMarkets.length - 1 ? '1px solid rgba(255,255,255,0.03)' : 'none', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ color: '#a855f7' }}>→</span>
              <span>{market}</span>
            </div>
          ))}
          <div style={{ marginTop: '10px', fontSize: '10px', fontWeight: '700', color: '#a855f7', textAlign: 'center', padding: '6px', borderRadius: '6px', border: '1px solid rgba(168,85,247,0.2)' }}>
            View Markets →
          </div>
        </div>
      </a>

      {/* Ideas & Voting */}
      <a href="/ideas.html" style={{ textDecoration: 'none', display: 'block' }}>
        <div className="sidebar-card" style={{ borderColor: 'rgba(0,212,170,0.2)', background: 'rgba(0,212,170,0.03)', cursor: 'pointer' }}>
          <div style={{ fontSize: '10px', fontWeight: '800', color: '#00d4aa', letterSpacing: '2px', marginBottom: '8px' }}>
            💡 IDEAS & QORUM
          </div>
          <div style={{ fontSize: '10px', color: '#9ca3af', lineHeight: '1.5' }}>
            Submit ideas, vote on features, shape Pulse's future
          </div>
          <div style={{ marginTop: '10px', fontSize: '10px', fontWeight: '700', color: '#00d4aa', textAlign: 'center', padding: '6px', borderRadius: '6px', border: '1px solid rgba(0,212,170,0.2)' }}>
            Vote Now →
          </div>
        </div>
      </a>
    </div>
  );
};

// ============================================
// LANDING PAGE
// ============================================

const ChatBox = () => {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [editingName, setEditingName] = useState(function() { try { var n = localStorage.getItem('pulse_chat_name'); return !n || !n.trim(); } catch(e) { return true; } });
  const [nameInput, setNameInput] = useState("");
  const [username, setUsername] = useState(function() { try { var n = localStorage.getItem('pulse_chat_name'); if (n && n.trim()) return n.trim(); } catch(e) {} return ''; });
  const messagesEndRef = useRef(null);
  const wsRef = useRef(null);

  useEffect(() => {
    try { localStorage.setItem("pulse_chat_name", username); } catch(e) {}
  }, [username]);

  useEffect(() => {
    var ws = new WebSocket("wss://pulse-backend-production-b2c9.up.railway.app");
    wsRef.current = ws;
    ws.onmessage = function(e) {
      try {
        var d = JSON.parse(e.data);
        if (d.type === "chat") {
          setMessages(function(prev) { return prev.concat([d.data]).slice(-50); });
        }
      } catch(err) {}
    };
    return function() { ws.close(); };
  }, []);

  useEffect(() => {
    if (messagesEndRef.current) messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  var sendMessage = function() {
    if (!input.trim() || !wsRef.current) return;
    wsRef.current.send(JSON.stringify({ type: "chat", data: { user: username, text: input.trim(), ts: Date.now() } }));
    setMessages(function(prev) { return prev.concat([{ user: username, text: input.trim(), ts: Date.now(), self: true }]).slice(-50); });
    setInput("");
  };

  return (
    <div className="sidebar-card" style={{ display: "flex", flexDirection: "column", height: "280px", borderColor: "rgba(59,130,246,0.15)", background: "rgba(59,130,246,0.02)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
          <div style={{ fontSize: "10px", fontWeight: "800", color: "#60a5fa", letterSpacing: "2px" }}>LIVE CHAT</div>
          <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
            {editingName ? (
              <input value={nameInput} onChange={function(e) { setNameInput(e.target.value); }} onKeyDown={function(e) { if (e.key === "Enter") saveName(); if (e.key === "Escape") setEditingName(false); }} onBlur={saveName} autoFocus style={{ fontSize: "9px", padding: "2px 6px", borderRadius: "4px", border: "1px solid rgba(96,165,250,0.3)", background: "rgba(96,165,250,0.1)", color: "#60a5fa", outline: "none", width: "80px" }} />
            ) : (
              <button onClick={function() { setEditingName(true); setNameInput(username); }} style={{ background: 'none', border: 'none', color: username ? '#9ca3af' : '#fbbf24', fontSize: '10px', cursor: 'pointer', padding: '2px 6px', borderRadius: '4px', maxWidth: '80px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: username ? '400' : '700', animation: username ? 'none' : 'countdownPulse 1.5s infinite' }}>{username || 'Set nickname...'}</button>
            )}
          </div>
        </div>
      <div style={{ flex: 1, overflowY: "auto", marginBottom: "8px", fontSize: "11px" }}>
        {messages.length === 0 && <div style={{ color: "#4b5563", textAlign: "center", marginTop: "40px" }}>No messages yet. Say gm!</div>}
        {messages.map(function(msg, i) {
          return <div key={i} style={{ marginBottom: "4px", wordBreak: "break-word" }}>
            <span style={{ color: msg.self ? "#60a5fa" : "#a78bfa", fontWeight: "700", fontSize: "10px" }}>{msg.user}: </span>
            <span style={{ color: "#d1d5db" }}>{msg.text}</span>
          </div>;
        })}
        <div ref={messagesEndRef} />
      </div>
      <div style={{ display: "flex", gap: "4px" }}>
        <input value={input} onChange={function(e) { setInput(e.target.value); }} onKeyDown={function(e) { if (e.key === "Enter") sendMessage(); }}
          placeholder="Type a message..."
          style={{ flex: 1, padding: "6px 8px", borderRadius: "6px", border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.05)", color: "#e5e7eb", fontSize: "11px", outline: "none" }} />
        <button onClick={sendMessage} style={{ padding: "6px 10px", borderRadius: "6px", border: "none", background: "rgba(59,130,246,0.2)", color: "#60a5fa", fontSize: "11px", fontWeight: "700", cursor: "pointer" }}>Send</button>
      </div>
    </div>
  );
};

const LANDING_STYLES = `
@keyframes heroGlow {
  0%, 100% { text-shadow: 0 0 20px rgba(251,191,36,0.4), 0 0 60px rgba(251,191,36,0.1); }
  50% { text-shadow: 0 0 40px rgba(251,191,36,0.7), 0 0 80px rgba(251,191,36,0.2); }
}
@keyframes float {
  0%, 100% { transform: translateY(0px); }
  50% { transform: translateY(-8px); }
}
@keyframes tickerScroll {
  0% { transform: translateX(0); }
  100% { transform: translateX(-50%); }
}
@keyframes gradientShift {
  0% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}
@keyframes pulseRing {
  0% { transform: scale(1); opacity: 1; }
  100% { transform: scale(1.8); opacity: 0; }
}
@keyframes statCount {
  0% { transform: scale(0.8); opacity: 0; }
  100% { transform: scale(1); opacity: 1; }
}
.landing-btn:hover { transform: translateY(-3px) !important; box-shadow: 0 12px 40px rgba(251,191,36,0.4) !important; }
.landing-btn:active { transform: translateY(0) !important; }
.step-card:hover { transform: translateY(-4px) !important; border-color: rgba(251,191,36,0.3) !important; }
.lb-row:hover { background: rgba(251,191,36,0.06) !important; }
`;

const FAKE_LEADERBOARD = [
  { rank: 1, name: '0xDegen...f4a2', pts: 48210, wins: 312, emoji: '👑' },
  { rank: 2, name: '0xAlpha...9c01', pts: 39870, wins: 267, emoji: '🔥' },
  { rank: 3, name: '0xChad...7b33', pts: 31450, wins: 198, emoji: '⚡' },
  { rank: 4, name: '0xApe...2d88', pts: 24100, wins: 156, emoji: '🦍' },
  { rank: 5, name: '0xSer...e1f0', pts: 19840, wins: 131, emoji: '💎' },
];

const LandingPage = ({ onEnter }) => {
  const [livePlayers, setLivePlayers] = useState(847);
  const [totalVolume, setTotalVolume] = useState(142.7);
  const [totalRounds, setTotalRounds] = useState(97950);

  // Fake live counter updates
  useEffect(() => {
    var i = setInterval(function() {
      setLivePlayers(function(p) { return p + Math.floor(Math.random() * 5) - 2; });
      setTotalVolume(function(v) { return Math.round((v + Math.random() * 0.3) * 10) / 10; });
      setTotalRounds(function(r) { return r + 1; });
    }, 3000);
    return function() { clearInterval(i); };
  }, []);

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', color: '#fff', overflowX: 'hidden' }}>
      <style>{LANDING_STYLES}</style>

      {/* TICKER BAR */}
      <div style={{ background: 'rgba(251,191,36,0.06)', borderBottom: '1px solid rgba(251,191,36,0.1)', padding: '6px 0', overflow: 'hidden', whiteSpace: 'nowrap' }}>
        <div style={{ display: 'inline-block', animation: 'tickerScroll 20s linear infinite' }}>
          <span style={{ fontSize: '11px', color: '#fbbf24', fontFamily: 'monospace', letterSpacing: '1px' }}>
            {'  🟢 LIVE  •  BTC $66,420  •  R#' + totalRounds + '  •  ' + livePlayers + ' PLAYERS ONLINE  •  ' + totalVolume + ' ETH VOLUME  •  $PULSE AIRDROP SOON  •  '}
          </span>
          <span style={{ fontSize: '11px', color: '#fbbf24', fontFamily: 'monospace', letterSpacing: '1px' }}>
            {'  🟢 LIVE  •  BTC $66,420  •  R#' + totalRounds + '  •  ' + livePlayers + ' PLAYERS ONLINE  •  ' + totalVolume + ' ETH VOLUME  •  $PULSE AIRDROP SOON  •  '}
          </span>
        </div>
      </div>

      {/* HERO SECTION */}
      <div style={{ textAlign: 'center', padding: '60px 20px 40px', position: 'relative' }}>
        {/* Glow orb behind logo */}
        <div style={{ position: 'absolute', top: '40px', left: '50%', transform: 'translateX(-50%)', width: '200px', height: '200px', background: 'radial-gradient(circle, rgba(251,191,36,0.15) 0%, transparent 70%)', borderRadius: '50%', filter: 'blur(40px)', pointerEvents: 'none' }} />

        <div style={{ animation: 'float 3s ease-in-out infinite', marginBottom: '24px', display: 'inline-block' }}>
          <PulseLogo size={72} />
        </div>

        <h1 style={{ fontSize: '48px', fontWeight: '900', margin: '0 0 8px', lineHeight: 1.1, animation: 'heroGlow 3s ease-in-out infinite' }}>
          PULSE
        </h1>
        <div style={{ fontSize: '13px', fontWeight: '700', letterSpacing: '4px', color: '#fbbf24', marginBottom: '20px', textTransform: 'uppercase' }}>
          10s predictions. bet it.
        </div>
        <p style={{ fontSize: '18px', color: '#9ca3af', maxWidth: '500px', margin: '0 auto 32px', lineHeight: 1.5 }}>
          up or down? 10 seconds. not financial advice, just vibes.</p>
      </div>

      {/* LIVE STATS BAR */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: '24px', padding: '20px', flexWrap: 'wrap' }}>
        {[
          { label: 'PLAYERS LIVE', value: livePlayers, color: '#10b981', icon: '🟢' },
          { label: 'TOTAL VOLUME', value: totalVolume + ' ETH', color: '#06b6d4', icon: '💎' },
          { label: 'ROUNDS PLAYED', value: totalRounds.toLocaleString(), color: '#fbbf24', icon: '🔥' },
        ].map(function(s) {
          return (
            <div key={s.label} style={{
              padding: '16px 24px', borderRadius: '16px', background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.06)', textAlign: 'center', minWidth: '140px',
              animation: 'statCount 0.5s ease'
            }}>
              <div style={{ fontSize: '24px', marginBottom: '4px' }}>{s.icon}</div>
              <div style={{ fontSize: '22px', fontWeight: '800', color: s.color, fontFamily: 'monospace' }}>{s.value}</div>
              <div style={{ fontSize: '10px', color: '#6b7280', letterSpacing: '2px', marginTop: '4px' }}>{s.label}</div>
            </div>
          );
        })}
      </div>

      {/* how to play */}
      <div style={{ padding: '40px 20px', maxWidth: '700px', margin: '0 auto' }}>
        <h2 style={{ textAlign: 'center', fontSize: '24px', fontWeight: '800', marginBottom: '32px' }}>
          ⚡ HOW IT WORKS
        </h2>
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', justifyContent: 'center' }}>
          {[
            { step: '1', title: 'CONNECT', desc: 'connect wallet. metamask, walletconnect, whatever.', icon: '🔗', color: '#06b6d4' },
            { step: '2', title: 'PREDICT', desc: 'BTC up or down in 10 seconds. pick a side. bet ETH.', icon: '🎯', color: '#fbbf24' },
            { step: '3', title: 'WIN', desc: 'called it? claim ETH + earn points. simple.', icon: '💰', color: '#10b981' },
          ].map(function(s) {
            return (
              <div className="step-card" key={s.step} style={{
                flex: '1 1 180px', padding: '24px 20px', borderRadius: '20px',
                background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)',
                textAlign: 'center', transition: 'all 0.2s ease', cursor: 'default'
              }}>
                <div style={{ fontSize: '36px', marginBottom: '12px' }}>{s.icon}</div>
                <div style={{ fontSize: '11px', fontWeight: '800', color: s.color, letterSpacing: '3px', marginBottom: '8px' }}>
                  STEP {s.step}
                </div>
                <div style={{ fontSize: '16px', fontWeight: '700', marginBottom: '8px' }}>{s.title}</div>
                <div style={{ fontSize: '13px', color: '#9ca3af', lineHeight: 1.5 }}>{s.desc}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* $PULSE TOKEN TEASER */}
      <div style={{ padding: '40px 20px', maxWidth: '600px', margin: '0 auto' }}>
        <div style={{
          padding: '32px', borderRadius: '24px', textAlign: 'center', position: 'relative', overflow: 'hidden',
          background: 'linear-gradient(135deg, rgba(168,85,247,0.08), rgba(251,191,36,0.08))',
          border: '1px solid rgba(168,85,247,0.15)'
        }}>
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>🪙</div>
          <div style={{ fontSize: '28px', fontWeight: '900', background: 'linear-gradient(135deg, #a855f7, #fbbf24)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            $PULSE
          </div>
          <div style={{ fontSize: '12px', color: '#c084fc', fontWeight: '700', letterSpacing: '3px', marginTop: '4px', marginBottom: '16px' }}>
            COMING AT TGE
          </div>
          <p style={{ fontSize: '14px', color: '#9ca3af', lineHeight: 1.6, maxWidth: '400px', margin: '0 auto 20px' }}>
            Every bet earns points. Points convert to <span style={{ color: '#a855f7', fontWeight: '700' }}>$PULSE</span> tokens at TGE.
            Early players get the biggest allocation. The more you play, the more you earn.
          </p>
          <div style={{ display: 'flex', justifyContent: 'center', gap: '24px', fontSize: '12px' }}>
            <div><span style={{ color: '#fbbf24', fontWeight: '800', fontSize: '16px' }}>1000x</span><br/><span style={{ color: '#6b7280' }}>PTS per ETH</span></div>
            <div><span style={{ color: '#10b981', fontWeight: '800', fontSize: '16px' }}>+10%</span><br/><span style={{ color: '#6b7280' }}>REFERRAL BONUS</span></div>
            <div><span style={{ color: '#a855f7', fontWeight: '800', fontSize: '16px' }}>OG</span><br/><span style={{ color: '#6b7280' }}>EARLY MULTIPLIER</span></div>
          </div>
        </div>
      </div>

      {/* LEADERBOARD */}
      <div style={{ padding: '40px 20px', maxWidth: '600px', margin: '0 auto' }}>
        <h2 style={{ textAlign: 'center', fontSize: '24px', fontWeight: '800', marginBottom: '8px' }}>
          🏆 LEADERBOARD
        </h2>
        <div style={{ textAlign: 'center', fontSize: '12px', color: '#6b7280', marginBottom: '24px' }}>Top players by $PULSE points</div>

        <div style={{ borderRadius: '20px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.02)' }}>
          {/* Header */}
          <div style={{ display: 'flex', padding: '12px 20px', fontSize: '10px', color: '#6b7280', letterSpacing: '2px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ flex: '0 0 50px' }}>RANK</div>
            <div style={{ flex: 1 }}>PLAYER</div>
            <div style={{ flex: '0 0 80px', textAlign: 'right' }}>WINS</div>
            <div style={{ flex: '0 0 100px', textAlign: 'right' }}>POINTS</div>
          </div>
          {/* Rows */}
          {FAKE_LEADERBOARD.map(function(p) {
            var isTop = p.rank <= 3;
            return (
              <div className="lb-row" key={p.rank} style={{
                display: 'flex', alignItems: 'center', padding: '14px 20px',
                borderBottom: '1px solid rgba(255,255,255,0.03)',
                transition: 'background 0.15s ease'
              }}>
                <div style={{ flex: '0 0 50px', fontSize: '16px' }}>
                  {p.emoji}
                </div>
                <div style={{ flex: 1 }}>
                  <span style={{ fontSize: '13px', fontFamily: 'monospace', color: isTop ? '#fbbf24' : '#d1d5db', fontWeight: isTop ? '700' : '400' }}>
                    {p.name}
                  </span>
                </div>
                <div style={{ flex: '0 0 80px', textAlign: 'right', fontSize: '13px', color: '#10b981', fontWeight: '600' }}>
                  {p.wins}W
                </div>
                <div style={{ flex: '0 0 100px', textAlign: 'right', fontSize: '14px', fontWeight: '800', fontFamily: 'monospace', color: isTop ? '#fbbf24' : '#fff' }}>
                  {p.pts.toLocaleString()}
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ textAlign: 'center', marginTop: '16px' }}>
          <button className="landing-btn" onClick={onEnter} style={{
            padding: '12px 32px', fontSize: '14px', fontWeight: '700', border: '1px solid rgba(251,191,36,0.3)',
            borderRadius: '12px', background: 'rgba(251,191,36,0.08)', color: '#fbbf24',
            cursor: 'pointer', transition: 'all 0.2s ease'
          }}>
            Join the leaderboard →
          </button>
        </div>
      </div>

      {/* SOCIAL / FOOTER */}
      <div style={{ padding: '40px 20px 60px', textAlign: 'center' }}>
        <div style={{ display: 'flex', justifyContent: 'center', gap: '16px', marginBottom: '24px' }}>
          <a href="https://t.me/pulsebetfun" target="_blank" rel="noopener noreferrer" style={{
            padding: '10px 20px', borderRadius: '12px', background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)', color: '#fff', textDecoration: 'none',
            fontSize: '13px', fontWeight: '600', transition: 'all 0.2s ease'
          }}>📱 Telegram</a>
          <a href="https://twitter.com/PulseBet" target="_blank" rel="noopener noreferrer" style={{
            padding: '10px 20px', borderRadius: '12px', background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)', color: '#fff', textDecoration: 'none',
            fontSize: '13px', fontWeight: '600', transition: 'all 0.2s ease'
          }}>𝕏 Twitter</a>
        </div>
        <div style={{ fontSize: '11px', color: '#374151' }}>
          Built on Ink • degen energy only • © 2025 Pulse
        </div>
      </div>
    </div>
  );
};

// ============================================
// PRICE CHART (Canvas) — Pro version with axes
// ============================================
const PriceChart = ({ prices, lockPrice, phase, roundResult }) => {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    const w = rect.width;
    const h = rect.height;

    // Layout: chart area with margins for axes
    const mL = 8, mR = 62, mT = 8, mB = 22;
    const cW = w - mL - mR;
    const cH = h - mT - mB;

    ctx.clearRect(0, 0, w, h);

    if (!prices || prices.length < 2) {
      ctx.fillStyle = '#333';
      ctx.font = '11px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Waiting for price data...', w / 2, h / 2);
      return;
    }

    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const range = (max - min) || 1;
    const pad = range * 0.12;
    const pMin = min - pad;
    const pMax = max + pad;
    const pRange = pMax - pMin;

    const toX = i => mL + (i / (prices.length - 1)) * cW;
    const toY = p => mT + cH - ((p - pMin) / pRange) * cH;

    // --- Y-Axis: 4 price labels on right ---
    ctx.textAlign = 'left';
    ctx.font = '10px -apple-system, sans-serif';
    for (var yi = 0; yi < 4; yi++) {
      var pVal = pMin + (pRange * yi / 3);
      var yy = toY(pVal);
      // Grid line
      ctx.strokeStyle = 'rgba(255,255,255,0.04)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(mL, yy);
      ctx.lineTo(mL + cW, yy);
      ctx.stroke();
      // Label
      ctx.fillStyle = '#4b5563';
      ctx.fillText('$' + pVal.toFixed(2), mL + cW + 6, yy + 3);
    }

    // --- X-Axis: time labels ---
    ctx.textAlign = 'center';
    ctx.font = '9px -apple-system, sans-serif';
    ctx.fillStyle = '#374151';
    var totalSec = prices.length; // ~1 price per second
    var xSteps = Math.min(5, prices.length - 1);
    for (var xi = 0; xi <= xSteps; xi++) {
      var idx = Math.round((prices.length - 1) * xi / xSteps);
      var secAgo = prices.length - 1 - idx;
      var xx = toX(idx);
      // Tick mark
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.beginPath();
      ctx.moveTo(xx, mT + cH);
      ctx.lineTo(xx, mT + cH + 4);
      ctx.stroke();
      // Label
      ctx.fillText(secAgo === 0 ? 'now' : '-' + secAgo + 's', xx, mT + cH + 15);
    }

    // --- Lock price / entry line ---
    if (lockPrice && phase !== 'betting') {
      var ly = toY(lockPrice);
      // UP zone
      ctx.fillStyle = 'rgba(16,185,129,0.05)';
      ctx.fillRect(mL, mT, cW, ly - mT);
      // DOWN zone
      ctx.fillStyle = 'rgba(239,68,68,0.05)';
      ctx.fillRect(mL, ly, cW, mT + cH - ly);
      // Dashed entry line
      ctx.strokeStyle = 'rgba(245,158,11,0.7)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 3]);
      ctx.beginPath();
      ctx.moveTo(mL, ly);
      ctx.lineTo(mL + cW, ly);
      ctx.stroke();
      ctx.setLineDash([]);
      // Entry price label (right side, on the line)
      ctx.fillStyle = 'rgba(245,158,11,0.9)';
      ctx.font = 'bold 9px -apple-system, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('Entry $' + lockPrice.toFixed(2), mL + cW + 4, ly - 4);
      // Zone labels
      ctx.font = '9px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(16,185,129,0.4)';
      ctx.fillText('UP', mL + 20, ly - 8);
      ctx.fillStyle = 'rgba(239,68,68,0.4)';
      ctx.fillText('DOWN', mL + 20, ly + 14);
    }

    // --- Price line ---
    var lastPrice = prices[prices.length - 1];
    var lineColor = !lockPrice || phase === 'betting' ? '#06b6d4' : lastPrice > lockPrice ? '#10b981' : '#ef4444';

    ctx.shadowColor = lineColor;
    ctx.shadowBlur = 8;
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    prices.forEach(function(p, i) {
      var x = toX(i);
      var y = toY(p);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.shadowBlur = 0;

    // --- Gradient fill under line ---
    ctx.lineTo(toX(prices.length - 1), mT + cH);
    ctx.lineTo(toX(0), mT + cH);
    ctx.closePath();
    var grad = ctx.createLinearGradient(0, mT, 0, mT + cH);
    var fillC = lineColor === '#10b981' ? 'rgba(16,185,129,' : lineColor === '#ef4444' ? 'rgba(239,68,68,' : 'rgba(6,182,212,';
    grad.addColorStop(0, fillC + '0.2)');
    grad.addColorStop(0.7, fillC + '0.03)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fill();

    // --- Current price dot ---
    var lx = toX(prices.length - 1);
    var lpy = toY(lastPrice);

    ctx.beginPath();
    ctx.arc(lx, lpy, 6, 0, Math.PI * 2);
    ctx.fillStyle = fillC + '0.25)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(lx, lpy, 3, 0, Math.PI * 2);
    ctx.fillStyle = lineColor;
    ctx.fill();

    // --- Current price label (right side) ---
    ctx.fillStyle = '#000';
    var labelW = 72;
    var labelH = 18;
    var labelY = lpy - labelH / 2;
    // Clamp to chart area
    if (labelY < mT) labelY = mT;
    if (labelY + labelH > mT + cH) labelY = mT + cH - labelH;
    // Background pill (manual rounded rect for browser compat)
    ctx.fillStyle = lineColor;
    var lx2 = mL + cW + 2, rr = 4;
    ctx.beginPath();
    ctx.moveTo(lx2 + rr, labelY);
    ctx.lineTo(lx2 + labelW - rr, labelY);
    ctx.quadraticCurveTo(lx2 + labelW, labelY, lx2 + labelW, labelY + rr);
    ctx.lineTo(lx2 + labelW, labelY + labelH - rr);
    ctx.quadraticCurveTo(lx2 + labelW, labelY + labelH, lx2 + labelW - rr, labelY + labelH);
    ctx.lineTo(lx2 + rr, labelY + labelH);
    ctx.quadraticCurveTo(lx2, labelY + labelH, lx2, labelY + labelH - rr);
    ctx.lineTo(lx2, labelY + rr);
    ctx.quadraticCurveTo(lx2, labelY, lx2 + rr, labelY);
    ctx.closePath();
    ctx.fill();
    // Price text
    ctx.fillStyle = '#000';
    ctx.font = 'bold 10px -apple-system, monospace';
    ctx.textAlign = 'left';
    ctx.fillText('$' + lastPrice.toFixed(2), mL + cW + 6, labelY + 13);

    // Horizontal line from dot to label
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(lx + 4, lpy);
    ctx.lineTo(mL + cW + 2, lpy);
    ctx.stroke();
    ctx.setLineDash([]);

  }, [prices, lockPrice, phase]);

  return (
    <div style={{ width: '100%', height: '100%', minHeight: '180px' }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
    </div>
  );
};

// ============================================
// ERROR BOUNDARY
// ============================================
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '40px', background: '#000', color: '#fff', minHeight: '100vh' }}>
          <h2 style={{ color: '#ef4444' }}>Error</h2>
          <pre style={{ color: '#fbbf24', fontSize: '12px', whiteSpace: 'pre-wrap' }}>{this.state.error?.toString()}</pre>
          <button onClick={() => window.location.reload()} style={{ marginTop: '20px', padding: '10px 20px', background: '#10b981', border: 'none', borderRadius: '8px', color: '#000' }}>Reload</button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ============================================
// TELEGRAM SDK
// ============================================
const useTelegram = () => {
  const [isReady, setIsReady] = useState(false);
  const [isTelegram, setIsTelegram] = useState(false);

  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (tg && tg.initData) {
      setIsTelegram(true);
      tg.ready();
      tg.expand();
      if (tg.disableVerticalSwipes) tg.disableVerticalSwipes();
    }
    setIsReady(true);
  }, []);

  const haptic = useCallback((type = 'impact', style = 'medium') => {
    try {
      const tg = window.Telegram?.WebApp;
      if (tg?.HapticFeedback) {
        if (type === 'impact') tg.HapticFeedback.impactOccurred(style);
        else tg.HapticFeedback.notificationOccurred(style);
      }
    } catch (e) {}
  }, []);

  return { isReady, haptic, isTelegram };
};

// ============================================
// MEDIA QUERY HOOK
// ============================================
const useMediaQuery = (query) => {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia(query);
    setMatches(mediaQuery.matches);

    const handler = (e) => setMatches(e.matches);
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, [query]);

  return matches;
};

// ============================================
// MAIN GAME COMPONENT
// ============================================
const PulseGame = () => {
  const { isReady, haptic, isTelegram } = useTelegram();
  const isDesktop = useMediaQuery('(min-width: 901px)');

  const { open } = useAppKit();
  const { address, isConnected } = useAppKitAccount();
  const { chainId, switchNetwork } = useAppKitNetwork();
  const { disconnect } = useDisconnect();

  // Direct RPC balance fetch (bypasses wagmi transport issues with custom chains)
  const [balance, setBalance] = useState(0);
  const fetchBalance = useCallback(() => {
    if (!address) { setBalance(0); return; }
    fetch('https://rpc-gel-sepolia.inkonchain.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: [address, 'latest'] })
    })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.result) {
          var wei = BigInt(data.result);
          var eth = Number(wei) / 1e18;
          console.log('[Pulse] RPC balance for', address, ':', eth, 'ETH');
          setBalance(eth);
        }
      })
      .catch(function(e) { console.error('[Pulse] Balance fetch error:', e); });
  }, [address]);

  useEffect(() => {
    fetchBalance();
    var interval = setInterval(fetchBalance, 15000); // refresh every 15s
    return function() { clearInterval(interval); };
  }, [fetchBalance]);

  var refetchBalance = fetchBalance;

  // On-chain transaction hooks
  const { sendTransaction, data: txHash, isPending: isTxPending, error: txError, reset: resetTx } = useSendTransaction();
  const { isLoading: isTxConfirming, isSuccess: isTxConfirmed, isError: isTxReverted } = useWaitForTransactionReceipt({ hash: txHash });
  const isOnInk = chainId === inkSepolia.id;

  const [points, setPoints] = useState(0);
  const [wins, setWins] = useState(() => { try { return parseInt(localStorage.getItem('pulse_wins')) || 0; } catch(e) { return 0; } });
  const [streak, setStreak] = useState(0);
  const [losses, setLosses] = useState(() => { try { return parseInt(localStorage.getItem('pulse_losses')) || 0; } catch(e) { return 0; } });
  const [currentStreak, setCurrentStreak] = useState(() => { try { return parseInt(localStorage.getItem('pulse_streak')) || 0; } catch(e) { return 0; } });
  const [lastBetResult, setLastBetResult] = useState(null);
  const [phase, setPhase] = useState('betting');
  const [countdown, setCountdown] = useState(20);
  const [price, setPrice] = useState(0);
  const [snapshotPrice, setSnapshotPrice] = useState(null);
  const [roundNumber, setRoundNumber] = useState(0);
  const [pool, setPool] = useState({ up: 0, down: 0 });
  const [asset, setAsset] = useState('BTC');
  const [bet, setBet] = useState(null);
  const [activeBetInfo, setActiveBetInfo] = useState(null);
  const [betAmount, setBetAmount] = useState(0.001);
  const [roundResult, setRoundResult] = useState(null); // 'up' | 'down' | null
  const [lastResults, setLastResults] = useState([]); // array of recent results
  const [txStatus, setTxStatus] = useState(null); // null | 'pending' | 'confirming' | 'confirmed' | 'error'
  const [txErrorMsg, setTxErrorMsg] = useState('');
  const [wsConnected, setWsConnected] = useState(false);
  const [claimRoundId, setClaimRoundId] = useState(null); // on-chain round ID for claiming
  const [claimStatus, setClaimStatus] = useState(null); // null | 'pending' | 'confirming' | 'confirmed' | 'error'
  const wsRef = useRef(null);
  const prevPhaseRef = useRef('betting');
  const txTypeRef = useRef('bet'); // 'bet' | 'claim'
  const prevPriceRef = useRef(0);
  const [priceDir, setPriceDir] = useState(null); // 'up' | 'down' | null
  const [priceKey, setPriceKey] = useState(0); // triggers re-animation on price change
  const [priceHistory, setPriceHistory] = useState([]); // last 80 prices for chart
  const [showReferral, setShowReferral] = useState(false);
  const [showIdeas, setShowIdeas] = useState(false);
  const [recentBets, setRecentBets] = useState([]); // social feed: [{side, amount, name}]

  useEffect(() => { try { const p = localStorage.getItem('pulse_points'); if (p) setPoints(parseInt(p)); } catch(e){} }, []);
  useEffect(() => { try { localStorage.setItem('pulse_points', points.toString()); } catch(e){} }, [points]);
  useEffect(() => { try { localStorage.setItem('pulse_wins', wins.toString()); } catch(e){} }, [wins]);
  useEffect(() => { try { localStorage.setItem('pulse_losses', losses.toString()); } catch(e){} }, [losses]);
  useEffect(() => { try { localStorage.setItem('pulse_streak', currentStreak.toString()); } catch(e){} }, [currentStreak]);

  // Track transaction lifecycle
  useEffect(() => {
    if (txTypeRef.current === 'claim') {
      // Handle claim tx lifecycle separately
      if (isTxPending) setClaimStatus('pending');
      else if (isTxConfirming) setClaimStatus('confirming');
      else if (isTxConfirmed) {
        setClaimStatus('confirmed');
        haptic('notification', 'success');
        refetchBalance();
        setTimeout(function() { setClaimStatus(null); resetTx(); txTypeRef.current = 'bet'; }, 3000);
      } else if (isTxReverted) {
        setClaimStatus('error');
        haptic('notification', 'error');
        setTimeout(function() { setClaimStatus(null); resetTx(); txTypeRef.current = 'bet'; }, 3000);
      }
      return;
    }
    // Normal bet tx lifecycle
    if (isTxPending) setTxStatus('pending');
    else if (isTxConfirming) setTxStatus('confirming');
    else if (isTxConfirmed) {
      setTxStatus('confirmed');
      // Award points and refetch balance after confirmation
      setPoints(function(p) { return p + Math.floor(betAmount * 1000); });
      haptic('notification', 'success');
      refetchBalance();
      // Clear after 3 seconds
      setTimeout(function() { setTxStatus(null); resetTx(); }, 3000);
    } else if (isTxReverted) {
      setTxStatus('error');
      setTxErrorMsg('Transaction reverted on-chain');
      haptic('notification', 'error');
      setTimeout(function() { setTxStatus(null); setBet(null); setTxErrorMsg(''); resetTx(); }, 3000);
    }
  }, [isTxPending, isTxConfirming, isTxConfirmed, isTxReverted]);

  // Handle transaction errors
  useEffect(() => {
    if (txError) {
      var msg = txError.shortMessage || txError.message || 'Transaction failed';
      if (msg.includes('User rejected') || msg.includes('user rejected')) msg = 'Transaction rejected';
      else if (msg.includes('insufficient funds')) msg = 'Insufficient balance';
      setTxErrorMsg(msg);
      setTxStatus('error');
      haptic('notification', 'error');
      setTimeout(function() { setTxStatus(null); setBet(null); setTxErrorMsg(''); resetTx(); }, 3000);
    }
  }, [txError]);

  // Reset bet when new round starts + track round history
  useEffect(() => {
    if (phase === 'betting' && prevPhaseRef.current !== 'betting') {
      // New round started — save previous result to history
      if (roundResult) {
        setLastResults(function(prev) { return [roundResult].concat(prev).slice(0, 10); });
      }
      // Clear previous bet
      if (!txStatus) { setBet(null); }
      setRoundResult(null);
      setActiveBetInfo(null);
      setClaimRoundId(null);
      setClaimStatus(null);
    }
    if (phase === 'results' || phase === 'resolving') {
      // Round resolved — determine result
      if (snapshotPrice && price) {
        var res = price > snapshotPrice ? 'up' : 'down';
        setRoundResult(res);
      if (bet) {
        var won = bet === res;
        setLastBetResult(won ? 'won' : 'lost');
        if (won) { setWins(function(w) { return w + 1; });
          setStreak(function(s) { return s > 0 ? s + 1 : 1; }); setCurrentStreak(function(s) { return s > 0 ? s + 1 : 1; }); }
        else { setLosses(function(l) { return l + 1; });
          setStreak(function(s) { return s < 0 ? s - 1 : -1; }); setCurrentStreak(function(s) { return s < 0 ? s - 1 : -1; }); }
        setTimeout(function() { setLastBetResult(null); }, 8000);
      }
      }
    }
    prevPhaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    let timeout; let mounted = true;
    const connectWS = () => {
      if (!mounted) return;
      try {
        const ws = new WebSocket(WS_URL);
        wsRef.current = ws;
        ws.onopen = () => { if (mounted) { setWsConnected(true); ws.send(JSON.stringify({ type: 'subscribe', asset: 'BTC' })); }};
        ws.onmessage = (e) => {
          if (!mounted) return;
          try {
            const d = JSON.parse(e.data);

            // Handle gameState (sent every second by backend)
            if (d.type === 'gameState' && d.data) {
              var g = d.data;
              if (g.currentPrice) {
                if (prevPriceRef.current && g.currentPrice !== prevPriceRef.current) {
                  setPriceDir(g.currentPrice > prevPriceRef.current ? 'up' : 'down');
                  setPriceKey(function(k) { return k + 1; });
                }
                prevPriceRef.current = g.currentPrice;
                setPrice(g.currentPrice);
                setPriceHistory(function(prev) { return prev.concat([g.currentPrice]).slice(-80); });
              }
              if (g.phase) setPhase(g.phase);
              if (g.countdown !== undefined) setCountdown(g.countdown);
              if (g.snapshotPrice) setSnapshotPrice(g.snapshotPrice);
              if (g.roundNumber) setRoundNumber(g.roundNumber);
              if (g.pool) setPool(g.pool);
              if (g.asset) setAsset(g.asset);
              if (g.bets && g.bets.recentBets) setRecentBets(g.bets.recentBets);
            }

            // Handle price ticks (sent every 150ms)
            if (d.type === 'price' && d.data) {
              setPrice(d.data.price || d.price);
            } else if (d.type === 'price' && d.price) {
              setPrice(d.price);
            }

            // Handle pool updates
            if (d.type === 'poolUpdate' && d.data) {
              setPool(d.data.pool || d.data);
            }

          } catch(err){}
        };
        ws.onclose = () => { if (mounted) { setWsConnected(false); timeout = setTimeout(connectWS, 3000); }};
      } catch(e) { if (mounted) timeout = setTimeout(connectWS, 3000); }
    };
    connectWS();
    return () => { mounted = false; wsRef.current?.close(); clearTimeout(timeout); };
  }, []);

  // Fetch on-chain currentRound via direct RPC
  const fetchOnChainRound = useCallback(() => {
    var callData = encodeFunctionData({ abi: PULSE_ABI, functionName: 'currentRound', args: [] });
    return fetch('https://rpc-gel-sepolia.inkonchain.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'eth_call', params: [{ to: CONTRACT_ADDRESS, data: callData }, 'latest'] })
    })
      .then(function(r) { return r.json(); })
      .then(function(resp) { return resp.result ? Number(BigInt(resp.result)) : null; })
      .catch(function(e) { console.error('[Pulse] fetchOnChainRound error:', e); return null; });
  }, []);

  const placeBet = (dir) => {
    if (phase !== 'betting' || bet || txStatus) return;
    if (!isConnected) { open(); return; }
    if (!isOnInk) { switchNetwork(inkSepolia); return; }
    if (betAmount > balance) { alert('Insufficient balance'); return; }

    haptic('impact', 'medium');
    setBet(dir);
    setActiveBetInfo({ direction: dir, amount: betAmount });
    setTxStatus('pending');
    setTxErrorMsg('');
    txTypeRef.current = 'bet';

    // Fetch on-chain round ID so we can claim later
    fetchOnChainRound().then(function(rid) {
      if (rid) { setClaimRoundId(rid); console.log('[Pulse] Betting on on-chain round', rid); }
    });

    try {
      var data = encodeFunctionData({
        abi: PULSE_ABI,
        functionName: 'placeBet',
        args: [dir === 'up' ? 1 : 2],
      });

      sendTransaction({
        to: CONTRACT_ADDRESS,
        data: data,
        value: parseEther(betAmount.toString()),
      });
    } catch (e) {
      console.error('[Pulse] placeBet error:', e);
      setTxStatus('error');
      setTxErrorMsg(e.message || 'Failed to send transaction');
      setTimeout(function() { setTxStatus(null); setBet(null); setTxErrorMsg(''); }, 3000);
    }
  };

  const claimWinnings = () => {
    if (!claimRoundId || claimStatus) return;
    txTypeRef.current = 'claim';
    setClaimStatus('pending');

    try {
      var data = encodeFunctionData({
        abi: PULSE_ABI,
        functionName: 'claim',
        args: [BigInt(claimRoundId)],
      });

      sendTransaction({
        to: CONTRACT_ADDRESS,
        data: data,
      });
    } catch (e) {
      console.error('[Pulse] claim error:', e);
      setClaimStatus('error');
      setTimeout(function() { setClaimStatus(null); }, 3000);
    }
  };

  if (!isReady) {
    return (
      <div style={{ height: '100vh', background: 'radial-gradient(ellipse at 50% 0%, #0a1a14 0%, #000 60%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ margin: '0 auto 16px', animation: 'pulseGlow 2s infinite', borderRadius: '16px', width: '56px', height: '56px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><PulseLogo size={56} /></div>
          <div style={{ color: '#10b981', fontSize: '18px', fontWeight: '600', letterSpacing: '4px' }}>PULSE</div>
        </div>
      </div>
    );
  }

  const ethBal = balance ? balance.toFixed(4) : '0';
  const shortAddress = address ? `${address.slice(0,6)}...${address.slice(-4)}` : '';
  const bettingActive = phase === 'betting' && !bet && !txStatus;
  const maxCountdown = phase === 'betting' ? 20 : phase === 'locked' ? 10 : phase === 'resolving' ? 5 : 5;
  const countdownPct = maxCountdown > 0 ? (countdown / maxCountdown) : 0;
  const ringR = 22;
  const ringC = 2 * Math.PI * ringR;

  return (
    <div style={{ height: '100vh', maxHeight: '100vh', overflow: 'auto', background: 'radial-gradient(ellipse at 50% 0%, #060f0b 0%, #000 70%)', color: '#fff', fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif', display: 'flex', flexDirection: 'column' }}>
      <style>{PULSE_STYLES}</style>

      {/* ===== HEADER BAR ===== */}
      <div style={{ padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <PulseLogo size={28} />
          <span style={{ fontWeight: '700', fontSize: '15px' }}>Pulse</span>
          <span style={{ fontSize: '8px', background: 'rgba(251,191,36,0.12)', color: '#fbbf24', padding: '2px 6px', borderRadius: '8px', fontWeight: '600', letterSpacing: '1px' }}>TESTNET</span>
        </div>
        {isConnected ? (
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: wsConnected ? '#10b981' : '#ef4444', animation: wsConnected ? 'breathe 2s infinite' : 'none' }}></span>
              <span style={{ fontSize: '9px', color: '#6b7280' }}>R#{roundNumber}</span>
            </div>
            <button onClick={() => open({ view: 'Account' })} style={{ padding: '4px 10px', borderRadius: '14px', fontWeight: '600', color: '#10b981', border: '1px solid rgba(16,185,129,0.15)', cursor: 'pointer', fontSize: '11px', background: 'rgba(16,185,129,0.06)' }}>
              {ethBal} ETH
            </button>
            <button onClick={() => { try { disconnect(); Object.keys(localStorage).filter(function(k) { return k.startsWith('wc@') || k.startsWith('@w3m') || k.startsWith('W3M'); }).forEach(function(k) { localStorage.removeItem(k); }); } catch(e) { window.location.reload(); } }} style={{ background: 'rgba(239,68,68,0.08)', padding: '4px 8px', borderRadius: '14px', color: '#ef4444', border: '1px solid rgba(239,68,68,0.1)', cursor: 'pointer', fontSize: '10px' }}>
              ✕
            </button>
          </div>
        ) : (
          <button onClick={() => open({ view: 'Connect' })} style={{ padding: '6px 16px', borderRadius: '14px', border: 'none', background: 'linear-gradient(135deg, #10b981, #059669)', color: '#fff', fontWeight: '700', fontSize: '12px', cursor: 'pointer' }}>
            Connect
          </button>
        )}
      </div>

      {/* ===== NAV BAR ===== */}
      {isConnected && (
        <div style={{ display: 'flex', gap: '4px', padding: '0 14px 6px', flexShrink: 0, overflowX: 'auto', scrollbarWidth: 'none' }}>
          {[
            { label: 'Predict', icon: '🎯', href: null, active: true },
            { label: 'DeFi Markets', icon: '📊', href: '/defi-markets.html' },
            { label: 'Ideas', icon: '💡', href: '/ideas.html' },
            { label: 'Docs', icon: '📖', href: '/agent-docs.html' },
          ].map(function(item, i) {
            return (
              <button key={i} onClick={function() { if (item.href) { try { window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp.openLink(window.location.origin + item.href) : window.open(item.href, '_blank'); } catch(e) { window.open(item.href, '_blank'); } } }}
                style={{ padding: '4px 10px', borderRadius: '10px', border: item.active ? '1px solid rgba(16,185,129,0.3)' : '1px solid rgba(255,255,255,0.06)', background: item.active ? 'rgba(16,185,129,0.1)' : 'rgba(255,255,255,0.03)', color: item.active ? '#10b981' : '#6b7280', fontSize: '11px', fontWeight: '600', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>
                {item.icon} {item.label}
              </button>
            );
          })}
        </div>
      )}


      {/* ===== CONNECT PROMPT (only when not connected) ===== */}
      {!isConnected && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div style={{ textAlign: 'center', maxWidth: '320px' }}>
            <div style={{ margin: '0 auto 20px' }}><PulseLogo size={64} /></div>
            <div style={{ fontSize: '22px', fontWeight: '800', marginBottom: '8px' }}>Predict BTC. Win ETH.</div>
            <div style={{ color: '#6b7280', fontSize: '13px', marginBottom: '24px', lineHeight: '1.5' }}>10-second prediction rounds. On-chain bets. Earn $PULSE points.</div>
            <button onClick={() => open({ view: 'Connect' })} style={{ width: '100%', padding: '16px', borderRadius: '14px', border: 'none', background: 'linear-gradient(135deg, #10b981, #059669)', color: '#fff', fontWeight: '700', fontSize: '16px', cursor: 'pointer', boxShadow: '0 4px 24px rgba(16,185,129,0.3)' }}>
              Connect Wallet to Play
            </button>
            {isTelegram && (
              <button onClick={() => { try { window.Telegram.WebApp.openLink('https://pulsebet.fun'); } catch(e) { window.open('https://pulsebet.fun', '_blank'); } }} style={{ width: '100%', marginTop: '10px', padding: '12px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.06)', background: 'transparent', color: '#6b7280', fontSize: '12px', cursor: 'pointer' }}>
                Open in Browser
              </button>
            )}
          </div>
        </div>
      )}

      {/* ===== WRONG NETWORK / LOW BALANCE ===== */}
      {isConnected && !isOnInk && (
        <div style={{ padding: '20px', textAlign: 'center' }}>
          <div style={{ color: '#fbbf24', fontWeight: '600', marginBottom: '10px' }}>Wrong Network</div>
          <button onClick={() => switchNetwork(inkSepolia)} style={{ padding: '12px 28px', borderRadius: '12px', border: 'none', background: '#fbbf24', color: '#000', fontWeight: '700', cursor: 'pointer' }}>Switch to Ink Sepolia</button>
        </div>
      )}
      {isConnected && isOnInk && balance < 0.0001 && (
        <div style={{ padding: '20px', textAlign: 'center' }}>
          <div style={{ color: '#ef4444', fontWeight: '600', marginBottom: '8px' }}>Need Testnet ETH</div>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
            <button onClick={() => window.open('https://inkonchain.com/faucet', '_blank')} style={{ padding: '10px 20px', borderRadius: '12px', border: 'none', background: '#ef4444', color: '#fff', fontWeight: '600', cursor: 'pointer', fontSize: '12px' }}>Get ETH</button>
            <button onClick={() => refetchBalance()} style={{ padding: '10px 20px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.08)', background: 'transparent', color: '#6b7280', fontWeight: '600', cursor: 'pointer', fontSize: '12px' }}>Refresh</button>
          </div>
        </div>
      )}

      {/* ===== MAIN GAME (connected + on Ink + has balance) ===== */}
      {isConnected && isOnInk && balance >= 0.0001 && (
        <>
          {/* THREE-COLUMN LAYOUT (Desktop) or SINGLE COLUMN (Mobile) */}
          <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: '12px', padding: '8px 8px', overflowY: 'auto' }}>
            {/* LEFT SIDEBAR — Only on desktop */}
            {isDesktop && (
              <div style={{ flexShrink: 0 }}>
                <EcosystemSidebar  winRate={wins + losses > 0 ? Math.round(wins / (wins + losses) * 100) : 0} streak={currentStreak} />
              </div>
            )}

            {/* CENTER COLUMN — Chart + Controls */}
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {/* Round history strip */}
              {lastResults.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '2px', padding: '4px 0', flexShrink: 0 }}>
                  {lastResults.map(function(r, i) {
                    return (
                      <div key={i} style={{ width: '16px', height: '16px', borderRadius: '4px', background: r === 'up' ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)', border: r === 'up' ? '1px solid rgba(16,185,129,0.3)' : '1px solid rgba(239,68,68,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '7px', color: r === 'up' ? '#10b981' : '#ef4444', fontWeight: '700' }}>
                        {r === 'up' ? '▲' : '▼'}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Chart */}
              <div style={{ flex: 1, minHeight: '180px', borderRadius: '14px', overflow: 'hidden', background: 'rgba(255,255,255,0.015)', border: '1px solid rgba(255,255,255,0.04)' }}>
                <PriceChart prices={priceHistory} lockPrice={snapshotPrice} phase={phase} roundResult={roundResult} />
              </div>

              {/* SOCIAL FEED — recent bets from other players */}
              {recentBets.length > 0 && (
                <div style={{ padding: '0 4px', flexShrink: 0, overflow: 'hidden' }}>
                  <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch', padding: '3px 0' }}>
                    {recentBets.slice(0, 8).map(function(b, i) {
                      var isUp = b.side === 'up';
                      return (
                        <div key={i} style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: '4px', padding: '3px 8px', borderRadius: '8px', background: isUp ? 'rgba(16,185,129,0.06)' : 'rgba(239,68,68,0.06)', border: isUp ? '1px solid rgba(16,185,129,0.12)' : '1px solid rgba(239,68,68,0.12)', animation: 'fadeIn 0.3s ease' }}>
                          <span style={{ fontSize: '8px' }}>{isUp ? '🟢' : '🔴'}</span>
                          <span style={{ fontSize: '9px', color: '#9ca3af', fontFamily: 'monospace' }}>{b.name || '0x???'}</span>
                          <span style={{ fontSize: '9px', fontWeight: '700', color: isUp ? '#10b981' : '#ef4444' }}>{b.amount} {isUp ? 'UP' : 'DN'}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* PRICE ROW + COUNTDOWN */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 4px 4px', flexShrink: 0 }}>
                <div>
                  <div style={{ fontSize: '9px', color: '#4b5563', letterSpacing: '1.5px' }}>{asset}/USD</div>
                  <div key={priceKey} style={{ fontSize: '24px', fontWeight: '800', letterSpacing: '-1px', lineHeight: 1, animation: priceDir ? (priceDir === 'up' ? 'priceFlashGreen 0.5s ease-out' : 'priceFlashRed 0.5s ease-out') : 'none' }}>
                    {price > 0 ? '$' + price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '...'}
                  </div>
      {activeBetInfo && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", padding: "6px 12px", borderRadius: "10px", background: activeBetInfo.direction === "up" ? "rgba(16,185,129,0.08)" : "rgba(239,68,68,0.08)", border: activeBetInfo.direction === "up" ? "1px solid rgba(16,185,129,0.2)" : "1px solid rgba(239,68,68,0.2)", marginBottom: "8px" }}>
          <span style={{ fontSize: "11px", fontWeight: "700", color: activeBetInfo.direction === "up" ? "#10b981" : "#ef4444" }}>YOUR BET: {activeBetInfo.direction.toUpperCase()}</span>
          <span style={{ fontSize: "11px", color: "#9ca3af" }}>|</span>
          <span style={{ fontSize: "11px", fontWeight: "700", color: "#e5e7eb" }}>{activeBetInfo.amount} ETH</span>
        </div>
      )}

                  {lastBetResult && (
              <div style={{ padding: "8px 16px", borderRadius: "10px", fontSize: "14px", fontWeight: "800", textAlign: "center", marginBottom: "8px", animation: "pulse 1.5s ease infinite", background: lastBetResult === "won" ? "rgba(16,185,129,0.15)" : "rgba(239,68,68,0.15)", color: lastBetResult === "won" ? "#10b981" : "#ef4444", border: lastBetResult === "won" ? "1px solid rgba(16,185,129,0.3)" : "1px solid rgba(239,68,68,0.3)" }}>
                {lastBetResult === "won" ? "YOU WON! +2x" : "LOST - Better luck next round!"}
              </div>
            )}
            {snapshotPrice && phase !== 'betting' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
                      <span style={{ fontSize: '10px', color: '#6b7280' }}>Entry ${snapshotPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      <span style={{ fontSize: '12px', fontWeight: '800', padding: '1px 6px', borderRadius: '6px', background: price >= snapshotPrice ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)', color: price >= snapshotPrice ? '#10b981' : '#ef4444', border: price >= snapshotPrice ? '1px solid rgba(16,185,129,0.25)' : '1px solid rgba(239,68,68,0.25)' }}>
                        {(() => { var diff = price - snapshotPrice; return (diff >= 0 ? '+$' : '-$') + Math.abs(diff).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); })()}
                      </span>
                    </div>
                  )}
                </div>

                {/* Compact circular countdown */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {/* Win/Loss badge */}
                  {bet && phase === 'results' && roundResult && (
                    <div style={{ padding: '4px 12px', borderRadius: '10px', fontSize: '12px', fontWeight: '800', animation: 'slideIn 0.3s ease', background: bet === roundResult ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)', color: bet === roundResult ? '#10b981' : '#ef4444', border: bet === roundResult ? '1px solid rgba(16,185,129,0.3)' : '1px solid rgba(239,68,68,0.3)' }}>
                      {bet === roundResult ? 'WON' : 'LOST'}
                    </div>
                  )}

                  <div style={{ position: 'relative', width: '54px', height: '54px' }}>
                    <svg width="54" height="54" style={{ transform: 'rotate(-90deg)' }}>
                      <circle cx="27" cy="27" r={ringR} fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="3" />
                      <circle cx="27" cy="27" r={ringR} fill="none"
                        stroke={phase === 'betting' ? '#10b981' : phase === 'results' ? (roundResult === 'up' ? '#10b981' : '#ef4444') : '#fbbf24'}
                        strokeWidth="3" strokeLinecap="round"
                        strokeDasharray={ringC} strokeDashoffset={ringC * (1 - countdownPct)}
                        style={{ transition: 'stroke-dashoffset 1s linear, stroke 0.3s' }}
                      />
                    </svg>
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                      {phase === 'results' ? (
                        <span style={{ fontSize: '18px' }}>{roundResult === 'up' ? '📈' : '📉'}</span>
                      ) : (
                        <span style={{ fontSize: '18px', fontWeight: '800', color: phase === 'betting' ? '#10b981' : '#fbbf24', animation: countdown <= 3 && phase === 'betting' ? 'countdownPulse 0.5s infinite' : 'none' }}>{countdown}</span>
                      )}
                    </div>
                  </div>

                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '9px', letterSpacing: '1px', fontWeight: '700', color: phase === 'betting' ? '#10b981' : phase === 'results' ? (roundResult === 'up' ? '#10b981' : '#ef4444') : '#fbbf24' }}>
                      {phase === 'betting' ? 'BET NOW' : phase === 'locked' ? 'LOCKED' : phase === 'resolving' ? 'RESOLVING' : roundResult ? roundResult.toUpperCase() : 'RESULTS'}
                    </div>
                    {bet && phase !== 'results' && phase !== 'betting' && (
                      <div style={{ fontSize: '9px', color: bet === 'up' ? '#10b981' : '#ef4444', marginTop: '1px' }}>
                        {betAmount} on {bet.toUpperCase()}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* AMOUNT + BET BUTTONS */}
              <div style={{ padding: '4px 0 0', flexShrink: 0 }}>
                {/* Amount selector */}
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px", padding: "6px 10px", borderRadius: "8px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
                  <div style={{ textAlign: "center" }}><div style={{ fontSize: "8px", color: "#6b7280", letterSpacing: "1px" }}>POOL UP</div><div style={{ fontSize: "12px", fontWeight: "700", color: "#10b981" }}>{pool.up ? pool.up.toFixed(3) : "0"} ETH</div></div>
                  <div style={{ textAlign: "center" }}><div style={{ fontSize: "8px", color: "#6b7280", letterSpacing: "1px" }}>TOTAL</div><div style={{ fontSize: "12px", fontWeight: "700", color: "#e5e7eb" }}>{((pool.up || 0) + (pool.down || 0)).toFixed(3)} ETH</div></div>
                  <div style={{ textAlign: "center" }}><div style={{ fontSize: "8px", color: "#6b7280", letterSpacing: "1px" }}>POOL DOWN</div><div style={{ fontSize: "12px", fontWeight: "700", color: "#ef4444" }}>{pool.down ? pool.down.toFixed(3) : "0"} ETH</div></div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'center', gap: '4px', marginBottom: '6px' }}>
                  {[{eth: 0.001, label: '$2'}, {eth: 0.005, label: '$5'}, {eth: 0.01, label: '$10'}, {eth: 0.05, label: '$25'}].map(function(opt) { return (
                  <button key={opt.eth} className="amount-btn" onClick={function() { setBetAmount(opt.eth); }}
                    style={{ padding: '6px 10px', borderRadius: '8px', border: '1px solid', borderColor: betAmount === opt.eth ? '#3b82f6' : 'rgba(255,255,255,0.08)', background: betAmount === opt.eth ? 'rgba(59,130,246,0.15)' : 'rgba(255,255,255,0.03)', color: betAmount === opt.eth ? '#60a5fa' : '#9ca3af', fontSize: '11px', fontWeight: '700', cursor: 'pointer', transition: 'all 0.2s' }}>
                    {opt.label}<span style={{fontSize: '8px', opacity: 0.6, display: 'block'}}>{opt.eth} ETH</span>
                  </button>
                ); })}}
                </div>

                {/* UP / DOWN */}
                <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                  <button className="pulse-btn-up" onClick={() => placeBet('up')} disabled={!bettingActive}
                    style={{ flex: 1, padding: '14px', borderRadius: '14px', border: bet === 'up' ? '2px solid #10b981' : '2px solid transparent', background: bet === 'up' ? 'rgba(16,185,129,0.12)' : 'linear-gradient(160deg, #10b981, #059669)', color: '#fff', fontSize: '16px', fontWeight: '800', cursor: bettingActive ? 'pointer' : 'not-allowed', opacity: bettingActive ? 1 : (bet === 'up' ? 0.85 : 0.25), transition: 'all 0.2s', boxShadow: bettingActive ? '0 4px 16px rgba(16,185,129,0.2)' : 'none', animation: bettingActive ? 'pulseGlow 3s infinite' : 'none' }}
                  >📈 UP</button>
                  <button className="pulse-btn-down" onClick={() => placeBet('down')} disabled={!bettingActive}
                    style={{ flex: 1, padding: '14px', borderRadius: '14px', border: bet === 'down' ? '2px solid #ef4444' : '2px solid transparent', background: bet === 'down' ? 'rgba(239,68,68,0.12)' : 'linear-gradient(160deg, #ef4444, #dc2626)', color: '#fff', fontSize: '16px', fontWeight: '800', cursor: bettingActive ? 'pointer' : 'not-allowed', opacity: bettingActive ? 1 : (bet === 'down' ? 0.85 : 0.25), transition: 'all 0.2s', boxShadow: bettingActive ? '0 4px 16px rgba(239,68,68,0.2)' : 'none', animation: bettingActive ? 'pulseGlowRed 3s infinite' : 'none' }}
                  >📉 DOWN</button>
                </div>
              </div>

              {/* BOTTOM BAR: Points + $PULSE + Referral */}
              <div style={{ padding: '0', flexShrink: 0, display: 'flex', gap: '6px', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{ padding: '3px 10px', borderRadius: '12px', background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.12)' }}>
                    <span style={{ color: '#fbbf24', fontSize: '12px', fontWeight: '700' }}>{points}</span>
                    <span style={{ color: '#92702a', fontSize: '9px', marginLeft: '3px' }}>PTS</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '3px 8px', borderRadius: '12px', background: 'rgba(168,85,247,0.06)', border: '1px solid rgba(168,85,247,0.1)' }}>
                    <span style={{ fontSize: '10px', fontWeight: '700', color: '#a855f7' }}>$PULSE</span>
                    <span style={{ fontSize: '8px', padding: '1px 4px', borderRadius: '4px', background: 'rgba(168,85,247,0.2)', color: '#c084fc', fontWeight: '600' }}>SOON</span>
                  </div>
                </div>
                <button onClick={function() { setShowIdeas(!showIdeas); }} style={{ padding: '3px 10px', borderRadius: '12px', border: '1px solid rgba(168,85,247,0.12)', background: 'rgba(168,85,247,0.04)', color: '#a855f7', fontSize: '10px', fontWeight: '600', cursor: 'pointer' }}>
                  Ideas
                </button>
                <button onClick={function() { setShowReferral(!showReferral); }} style={{ padding: '3px 10px', borderRadius: '12px', border: '1px solid rgba(16,185,129,0.12)', background: 'rgba(16,185,129,0.04)', color: '#10b981', fontSize: '10px', fontWeight: '600', cursor: 'pointer' }}>
                  👥 Invite
                </button>
              </div>

              {/* Claim Winnings (only during results if won) */}
              {bet && roundResult && bet === roundResult && phase === 'results' && claimRoundId && (
                <div style={{ padding: '0', textAlign: 'center', animation: 'slideIn 0.3s ease', flexShrink: 0 }}>
                  <button onClick={claimWinnings} disabled={!!claimStatus}
                    style={{ width: '100%', padding: '12px', borderRadius: '12px', border: 'none', background: claimStatus === 'confirmed' ? '#10b981' : 'linear-gradient(135deg, #fbbf24, #f59e0b)', color: '#000', fontWeight: '800', fontSize: '14px', cursor: claimStatus ? 'not-allowed' : 'pointer', boxShadow: '0 4px 16px rgba(251,191,36,0.25)' }}
                  >{claimStatus === 'pending' ? 'Confirm in Wallet...' : claimStatus === 'confirming' ? 'Claiming...' : claimStatus === 'confirmed' ? 'Claimed!' : claimStatus === 'error' ? 'Claim Failed' : 'Claim Winnings'}</button>
                </div>
              )}
            </div>

            {/* RIGHT SIDEBAR — Only on desktop */}
            {isDesktop && (
              <div style={{ flexShrink: 0 }}>
                <LiveFeedSidebar recentBets={recentBets} points={points} winRate={wins + losses > 0 ? Math.round(wins / (wins + losses) * 100) : 0} streak={currentStreak} />
            <ChatBox />
              </div>
            )}
          </div>
        </>
      )}

      {/* Referral overlay */}
      {showReferral && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)', zIndex: 90, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', animation: 'fadeIn 0.2s ease' }}>
          <div className="glass-card" style={{ borderRadius: '20px', padding: '24px', maxWidth: '400px', width: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div style={{ fontSize: '16px', fontWeight: '700' }}>Invite Friends</div>
              <button onClick={function() { setShowReferral(false); }} style={{ background: 'none', border: 'none', color: '#6b7280', fontSize: '18px', cursor: 'pointer' }}>✕</button>
            </div>
            <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '12px' }}>Earn 10% bonus points for every friend who plays. Points convert to $PULSE at TGE.</div>
            <div style={{ display: 'flex', gap: '6px', marginBottom: '12px' }}>
              <div style={{ flex: 1, padding: '10px', borderRadius: '10px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)', fontSize: '10px', fontFamily: 'monospace', color: '#9ca3af', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                https://pulsebet.fun?ref={address ? address.slice(0, 8) : ''}
              </div>
              <button onClick={function() { navigator.clipboard.writeText('https://pulsebet.fun?ref=' + (address ? address.slice(0, 8) : '')).catch(function() {}); haptic('notification', 'success'); }} style={{ padding: '10px 14px', borderRadius: '10px', border: 'none', background: '#10b981', color: '#000', fontWeight: '700', fontSize: '11px', cursor: 'pointer' }}>Copy</button>
            </div>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button onClick={function() { window.open('https://t.me/share/url?url=' + encodeURIComponent('https://pulsebet.fun?ref=' + (address ? address.slice(0, 8) : '')) + '&text=' + encodeURIComponent('Predict BTC in 10 seconds on Pulse! Earn $PULSE points.'), '_blank'); }} style={{ flex: 1, padding: '10px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.03)', color: '#fff', fontSize: '12px', cursor: 'pointer', fontWeight: '600' }}>Telegram</button>
              <button onClick={function() { window.open('https://twitter.com/intent/tweet?text=' + encodeURIComponent('Predicting BTC price in 10 seconds on @PulseBet! Earn $PULSE points.\n\nhttps://pulsebet.fun?ref=' + (address ? address.slice(0, 8) : '')), '_blank'); }} style={{ flex: 1, padding: '10px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.03)', color: '#fff', fontSize: '12px', cursor: 'pointer', fontWeight: '600' }}>X / Twitter</button>
            </div>
          </div>
        </div>
      )}

      {/* Ideas Forum Overlay */}
      {showIdeas && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)', backdropFilter: 'blur(8px)', zIndex: 90, display: 'flex', flexDirection: 'column', padding: '20px', animation: 'fadeIn 0.2s ease', overflowY: 'auto' }}>
          <div style={{ maxWidth: '500px', width: '100%', margin: '0 auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <div>
                <div style={{ fontSize: '18px', fontWeight: '800', color: '#a855f7' }}>Ideas Forum</div>
                <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '2px' }}>Vote with your points (QORUM)</div>
              </div>
              <button onClick={function() { setShowIdeas(false); }} style={{ background: 'none', border: 'none', color: '#6b7280', fontSize: '20px', cursor: 'pointer' }}>X</button>
            </div>
            <div style={{ padding: '16px', borderRadius: '12px', background: 'rgba(168,85,247,0.06)', border: '1px solid rgba(168,85,247,0.15)', marginBottom: '16px' }}>
              <div style={{ fontSize: '12px', color: '#c084fc', fontWeight: '700', marginBottom: '8px' }}>How QORUM Works</div>
              <div style={{ fontSize: '11px', color: '#9ca3af', lineHeight: '1.5' }}>Spend your earned points to vote on ideas. More points = more voting power. Top ideas get built into Pulse.</div>
            </div>
            {[
              { id: 1, title: 'Multi-asset predictions (ETH, SOL)', cat: 'feature', votes: 342, voters: 28 },
              { id: 2, title: 'Tournament mode with prize pools', cat: 'feature', votes: 289, voters: 21 },
              { id: 3, title: 'Social trading - copy top players', cat: 'feature', votes: 256, voters: 19 },
              { id: 4, title: 'Mobile push notifications for rounds', cat: 'improvement', votes: 198, voters: 15 },
              { id: 5, title: 'Weekly leaderboard with $PULSE rewards', cat: 'market', votes: 175, voters: 12 },
              { id: 6, title: 'Longer timeframe markets (1h, 4h)', cat: 'market', votes: 156, voters: 11 }
            ].map(function(idea) {
              return (
                <div key={idea.id} style={{ padding: '12px', borderRadius: '10px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', marginBottom: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '12px', fontWeight: '600', color: '#e5e7eb', marginBottom: '4px' }}>{idea.title}</div>
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                        <span style={{ fontSize: '9px', padding: '2px 6px', borderRadius: '4px', background: idea.cat === 'feature' ? 'rgba(59,130,246,0.1)' : idea.cat === 'market' ? 'rgba(168,85,247,0.1)' : 'rgba(251,191,36,0.1)', color: idea.cat === 'feature' ? '#60a5fa' : idea.cat === 'market' ? '#c084fc' : '#fbbf24', fontWeight: '600' }}>{idea.cat}</span>
                        <span style={{ fontSize: '9px', color: '#6b7280' }}>{idea.voters} voters</span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
                      <button style={{ width: '28px', height: '20px', borderRadius: '4px', border: '1px solid rgba(16,185,129,0.2)', background: 'rgba(16,185,129,0.06)', color: '#10b981', fontSize: '10px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
                      <span style={{ fontSize: '12px', fontWeight: '800', color: '#a855f7' }}>{idea.votes}</span>
                      <button style={{ width: '28px', height: '20px', borderRadius: '4px', border: '1px solid rgba(239,68,68,0.2)', background: 'rgba(239,68,68,0.06)', color: '#ef4444', fontSize: '10px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>-</button>
                    </div>
                  </div>
                </div>
              );
            })}
            <div style={{ textAlign: 'center', marginTop: '12px', fontSize: '11px', color: '#4b5563' }}>Submit ideas in our Telegram group</div>
          </div>
        </div>
      )}

      {/* Transaction Status Overlay */}
      {txStatus && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', backdropFilter: 'blur(8px)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 100, animation: 'fadeIn 0.2s ease' }}>
          {txStatus === 'pending' && (
            <div style={{ textAlign: 'center', animation: 'slideIn 0.3s ease' }}>
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>⏳</div>
              <div style={{ fontSize: '20px', fontWeight: '700', color: '#fbbf24' }}>Confirm in Wallet</div>
              <div style={{ fontSize: '13px', color: '#6b7280', marginTop: '8px' }}>{betAmount} ETH on {bet ? bet.toUpperCase() : '...'}</div>
            </div>
          )}
          {txStatus === 'confirming' && (
            <div style={{ textAlign: 'center', animation: 'slideIn 0.3s ease' }}>
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>⛓</div>
              <div style={{ fontSize: '20px', fontWeight: '700', color: '#06b6d4' }}>Confirming on Ink</div>
              <div style={{ fontSize: '10px', color: '#4b5563', marginTop: '8px', fontFamily: 'monospace' }}>{txHash ? (txHash.slice(0, 10) + '...' + txHash.slice(-8)) : ''}</div>
            </div>
          )}
          {txStatus === 'confirmed' && (
            <div style={{ textAlign: 'center', animation: 'slideIn 0.3s ease' }}>
              <div style={{ fontSize: '56px', marginBottom: '12px' }}>🎉</div>
              <div style={{ fontSize: '24px', fontWeight: '800', color: '#10b981' }}>Bet Placed!</div>
              <div style={{ fontSize: '18px', color: '#fbbf24', marginTop: '6px', fontWeight: '700' }}>+{Math.floor(betAmount * 1000)} pts</div>
              {txHash && (
                <button onClick={function() { window.open('https://explorer-sepolia.inkonchain.com/tx/' + txHash, '_blank'); }} style={{ marginTop: '12px', padding: '8px 16px', borderRadius: '10px', border: '1px solid rgba(6,182,212,0.3)', background: 'rgba(6,182,212,0.1)', color: '#06b6d4', fontSize: '11px', cursor: 'pointer' }}>View on Explorer</button>
              )}
            </div>
          )}
          {txStatus === 'error' && (
            <div style={{ textAlign: 'center', animation: 'slideIn 0.3s ease' }}>
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>❌</div>
              <div style={{ fontSize: '18px', fontWeight: '700', color: '#ef4444' }}>{txErrorMsg}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ============================================
// APP WITH PROVIDERS
// ============================================
function App() {
  // In Telegram, skip landing page and go straight to game
  var inTG = typeof window !== 'undefined' && !!(window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData);
  var [showGame, setShowGame] = useState(inTG);

  return (
    <ErrorBoundary>
      <WagmiProvider config={wagmiAdapter.wagmiConfig}>
        <QueryClientProvider client={queryClient}>
          {showGame ? <PulseGame /> : <LandingPage onEnter={function() { setShowGame(true); }} />}
        </QueryClientProvider>
      </WagmiProvider>
    </ErrorBoundary>
  );
}

export default App;
