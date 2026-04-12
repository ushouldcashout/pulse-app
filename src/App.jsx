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
    '--w3m-accent': '#a855f7',
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
// STOCKS CONFIG
// ============================================
const STOCK_TICKERS = [
  { symbol: 'TSLA', name: 'Tesla', color: '#e31937' },
  { symbol: 'NVDA', name: 'Nvidia', color: '#76b900' },
  { symbol: 'COIN', name: 'Coinbase', color: '#0052ff' },
  { symbol: 'MSTR', name: 'Strategy', color: '#d9222a' },
  { symbol: 'PLTR', name: 'Palantir', color: '#101010' },
  { symbol: 'AMD', name: 'AMD', color: '#ed1c24' },
  { symbol: 'HOOD', name: 'Robinhood', color: '#00c805' },
  { symbol: 'GME', name: 'GameStop', color: '#ff0000' },
  { symbol: 'AMC', name: 'AMC', color: '#ff1f1f' },
  { symbol: 'SPY', name: 'S&P 500', color: '#4a90d9' },
  { symbol: 'QQQ', name: 'Nasdaq 100', color: '#0092cf' },
];

function getMarketStatus() {
  var now = new Date();
  // Convert to ET
  var etStr = now.toLocaleString('en-US', { timeZone: 'America/New_York' });
  var et = new Date(etStr);
  var day = et.getDay(); // 0=Sun, 6=Sat
  var h = et.getHours();
  var m = et.getMinutes();
  var mins = h * 60 + m;

  if (day === 0 || day === 6) {
    // Calculate mins until Monday 9:30
    var daysToMon = day === 0 ? 1 : 2;
    var minsUntil = daysToMon * 24 * 60 + (9 * 60 + 30 - mins);
    var hUntil = Math.floor(minsUntil / 60);
    var mUntil = minsUntil % 60;
    return { open: false, status: 'weekend', label: 'Opens Mon ' + hUntil + 'h ' + mUntil + 'm', event: null, etTime: h + ':' + (m < 10 ? '0' : '') + m + ' ET' };
  }

  var open930 = 9 * 60 + 30;
  var close1600 = 16 * 60;
  var lunchStart = 11 * 60 + 30;
  var lunchEnd = 13 * 60 + 30;
  var powerHourStart = 15 * 60;
  var openBellEnd = 10 * 60;
  var etTime = h + ':' + (m < 10 ? '0' : '') + m + ' ET';

  if (mins < open930) {
    var mu = open930 - mins;
    return { open: false, status: 'premarket', label: 'Opens in ' + Math.floor(mu / 60) + 'h ' + (mu % 60) + 'm', event: null, etTime: etTime, minsUntilOpen: mu };
  }
  if (mins >= close1600) {
    return { open: false, status: 'afterhours', label: 'Markets closed', event: null, etTime: etTime };
  }

  // Market is open
  var event = null;
  var eventLabel = '';
  if (mins < openBellEnd) {
    event = 'opening-bell';
    eventLabel = 'OPENING BELL';
  } else if (mins >= lunchStart && mins < lunchEnd) {
    event = 'lunch';
    eventLabel = 'LUNCH BREAK';
  } else if (mins >= powerHourStart) {
    event = 'power-hour';
    eventLabel = 'POWER HOUR';
  }

  var minsLeft = close1600 - mins;
  return { open: true, status: 'open', label: 'Market Open', event: event, eventLabel: eventLabel, etTime: etTime, minsUntilClose: minsLeft };
}

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
    <rect width="40" height="40" rx="10" fill="#1a0533" />
    <rect x="1.5" y="1.5" width="37" height="37" rx="8.5" fill="none" stroke="url(#logoBorder)" strokeWidth="3" />
    <path d="M8 22h6l3-10 5 18 4-14 3 6h3" stroke="url(#logoPulse)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    <defs>
      <linearGradient id="logoBorder" x1="0" y1="0" x2="40" y2="40">
        <stop stopColor="#a855f7" />
        <stop offset="1" stopColor="#ec4899" />
      </linearGradient>
      <linearGradient id="logoPulse" x1="8" y1="12" x2="32" y2="28">
        <stop stopColor="#c084fc" />
        <stop offset="1" stopColor="#f472b6" />
      </linearGradient>
    </defs>
  </svg>
)

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
      fetch('https://api.llama.fi/tvl/nado').then(r => r.json()).catch(() => null),
    ]).then(([tydroData, inkData, nadoData]) => {
      if (tydroData && !isNaN(tydroData)) {
        setTydroTVL(parseFloat(tydroData));
      } else {
        setTydroTVL(385000000);
      }

      if (inkData && Array.isArray(inkData)) {
        const ink = inkData.find(c => c.name === 'Ink');
        if (ink) setInkTVL(parseFloat(ink.tvl) || 455000000);
        else setInkTVL(455000000);
      } else {
        setInkTVL(455000000);
      }

      if (nadoData && !isNaN(nadoData)) {
        setNadoVolume(parseFloat(nadoData));
      } else {
        setNadoVolume(58000000);
      }

      setLoading(false);
    });
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 60000);
    return () => clearInterval(interval);
  }, [fetchData]);

  return { tydroTVL, inkTVL, nadoVolume, loading };
};

const useNadoData = () => {
  const [nadoTVL, setNadoTVL] = useState(58000000);
  const [nadoChain, setNadoChain] = useState('Ink');
  const [topPair, setTopPair] = useState('BTC/USD');

  useEffect(() => {
    const fetchNadoData = () => {
      fetch('https://api.llama.fi/protocol/nado')
        .then(r => r.json())
        .then(data => {
          if (data.currentChainTvls) {
            const total = Object.values(data.currentChainTvls).reduce((s, v) => s + v, 0);
            if (total > 0) setNadoTVL(total);
          }
          if (data.chains && data.chains.length > 0) setNadoChain(data.chains[0]);
        })
        .catch(() => {});
    };

    fetchNadoData();
    const interval = setInterval(fetchNadoData, 60000);
    return () => clearInterval(interval);
  }, []);

  return { nadoTVL, nadoChain, topPair };
};

// ============================================
// SIDEBAR COMPONENTS
// ============================================
const EcosystemSidebar = () => {
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
          <span>Nado TVL</span>
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
          <span className="sidebar-stat-value">62%</span>
        </div>
        <div className="sidebar-stat">
          <span>Streak</span>
          <span className="sidebar-stat-value">+3</span>
        </div>
      </div>
    </div>
  );
};

const LiveFeedSidebar = ({ recentBets, points, winRate = 62 }) => {
  const { nadoTVL, nadoChain, topPair } = useNadoData();

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

      {/* Nado Quick Stats */}
      <div className="sidebar-card">
        <div style={{ fontSize: '10px', fontWeight: '800', color: '#a855f7', letterSpacing: '2px', marginBottom: '12px', textTransform: 'uppercase' }}>
          Nado DEX
        </div>
        <div className="sidebar-stat">
          <span>TVL</span>
          <span className="sidebar-stat-value">{formatUSD(nadoTVL)}</span>
        </div>
        <div className="sidebar-stat">
          <span>Chain</span>
          <span className="sidebar-stat-value">{nadoChain}</span>
        </div>
        <div className="sidebar-stat">
          <span>Top Pair</span>
          <span className="sidebar-stat-value">{topPair}</span>
        </div>
      </div>

      {/* DeFi Predictions - LIVE */}
      <div onClick={() => { window.location.href = '/defi-markets.html'; }} style={{ cursor: 'pointer', display: 'block' }}>
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
      </div>

      {/* Ideas & Voting */}
      <div onClick={() => { window.location.href = '/ideas.html'; }} style={{ cursor: 'pointer', display: 'block' }}>
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
      </div>
    </div>
  );
};

// ============================================
// LANDING PAGE
// ============================================
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
          10-SECOND CRYPTO PREDICTIONS
        </div>
        <p style={{ fontSize: '18px', color: '#9ca3af', maxWidth: '500px', margin: '0 auto 32px', lineHeight: 1.5 }}>
          Predict if BTC goes <span style={{ color: '#10b981', fontWeight: '700' }}>UP</span> or <span style={{ color: '#ef4444', fontWeight: '700' }}>DOWN</span> in 10 seconds.
          <br />Win ETH. Earn <span style={{ color: '#a855f7', fontWeight: '700' }}>$PULSE</span> points. Climb the leaderboard.
        </p>

        <button className="landing-btn" onClick={onEnter} style={{
          padding: '16px 48px', fontSize: '18px', fontWeight: '800', border: 'none', borderRadius: '16px',
          background: 'linear-gradient(135deg, #fbbf24, #f59e0b, #fbbf24)', backgroundSize: '200% 200%',
          animation: 'gradientShift 3s ease infinite', color: '#000', cursor: 'pointer',
          boxShadow: '0 8px 32px rgba(251,191,36,0.3)', transition: 'all 0.2s ease', position: 'relative'
        }}>
          🚀 Launch App
        </button>

        <div style={{ marginTop: '12px', fontSize: '11px', color: '#4b5563' }}>
          Ink Sepolia Testnet • No real funds at risk
        </div>
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

      {/* HOW IT WORKS */}
      <div style={{ padding: '40px 20px', maxWidth: '700px', margin: '0 auto' }}>
        <h2 style={{ textAlign: 'center', fontSize: '24px', fontWeight: '800', marginBottom: '32px' }}>
          ⚡ HOW IT WORKS
        </h2>
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', justifyContent: 'center' }}>
          {[
            { step: '1', title: 'CONNECT', desc: 'Link your wallet in one tap. Works with MetaMask, WalletConnect, or Coinbase.', icon: '🔗', color: '#06b6d4' },
            { step: '2', title: 'PREDICT', desc: 'BTC going UP or DOWN in the next 10 seconds? Pick your side and bet ETH.', icon: '🎯', color: '#fbbf24' },
            { step: '3', title: 'WIN', desc: 'Called it right? Claim your ETH winnings + earn $PULSE points instantly.', icon: '💰', color: '#10b981' },
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
          <a href="https://twitter.com/PulseBet" target="_blank" rel="noopener noreferrer" style={{
            padding: '10px 20px', borderRadius: '12px', background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)', color: '#fff', textDecoration: 'none',
            fontSize: '13px', fontWeight: '600', transition: 'all 0.2s ease'
          }}>𝕏 Twitter</a>
        </div>
        <div style={{ fontSize: '11px', color: '#374151' }}>
          Built on Ink • Powered by degen energy • © 2025 Pulse
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
const PulseGame = function(props) {
  var gameMode = props.gameMode || 'crypto';
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
  const [phase, setPhase] = useState('betting');
  const [countdown, setCountdown] = useState(20);
  const [price, setPrice] = useState(0);
  const [snapshotPrice, setSnapshotPrice] = useState(null);
  const [roundNumber, setRoundNumber] = useState(0);
  const [pool, setPool] = useState({ up: 0, down: 0 });
  const [asset, setAsset] = useState('BTC');
  const [bet, setBet] = useState(null);
  const [betAmount, setBetAmount] = useState(0.001);
  const BET_LABELS = { 0.001: '$2', 0.005: '$5', 0.01: '$25', 0.05: '$50' };
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
  const [showFaucet, setShowFaucet] = useState(false);
  const [faucetCopied, setFaucetCopied] = useState(false);
  const [faucetUrlCopied, setFaucetUrlCopied] = useState(false);
  const [recentBets, setRecentBets] = useState([]); // social feed: [{side, amount, name}]

  // Stocks mode state
  var [stockTicker, setStockTicker] = useState('TSLA');
  var [marketStatus, setMarketStatus] = useState(function() { return gameMode === 'stocks' ? getMarketStatus() : null; });
  var isStocks = gameMode === 'stocks';
  var activeAsset = isStocks ? stockTicker : 'BTC';
  const [betHistory, setBetHistory] = useState(function() {
    try { return JSON.parse(localStorage.getItem('pulse_bet_history') || '[]'); } catch(e) { return []; }
  });
  const [showHistory, setShowHistory] = useState(false);
  const lastHistoryRoundRef = useRef(null);
  const [resultToast, setResultToast] = useState(null); // { won, side, amount, entryPrice, exitPrice }
  const resultToastTimerRef = useRef(null);

  useEffect(() => { try { const p = localStorage.getItem('pulse_points'); if (p) setPoints(parseInt(p)); } catch(e){} }, []);
  useEffect(() => { try { localStorage.setItem('pulse_points', points.toString()); } catch(e){} }, [points]);
  useEffect(() => { try { localStorage.setItem('pulse_bet_history', JSON.stringify(betHistory.slice(0, 100))); } catch(e){} }, [betHistory]);

  // Stocks: poll market status every 30s
  useEffect(function() {
    if (!isStocks) return;
    setMarketStatus(getMarketStatus());
    var interval = setInterval(function() { setMarketStatus(getMarketStatus()); }, 30000);
    return function() { clearInterval(interval); };
  }, [isStocks]);

  // Stocks: resubscribe WS when ticker changes
  useEffect(function() {
    if (!isStocks) return;
    if (wsRef.current && wsRef.current.readyState === 1) {
      wsRef.current.send(JSON.stringify({ type: 'subscribe', asset: stockTicker }));
      // Reset price state for new ticker
      setPrice(0);
      setSnapshotPrice(null);
      setPriceHistory([]);
      setPriceDir(null);
      prevPriceRef.current = 0;
    }
  }, [stockTicker, isStocks]);

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
      // Clear tx overlay after 3s but KEEP bet so win/lose UI can match against roundResult
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
      setClaimRoundId(null);
      setClaimStatus(null);
    }
    if (phase === 'results' || phase === 'resolving') {
      // Round resolved — determine result
      if (snapshotPrice && price) {
        var res = price > snapshotPrice ? 'up' : 'down';
        setRoundResult(res);
        // Append to bet history (deduped per round) if user placed a bet
        if (bet && roundNumber && lastHistoryRoundRef.current !== roundNumber) {
          lastHistoryRoundRef.current = roundNumber;
          var won = bet === res;
          var entry = {
            round: roundNumber,
            side: bet,
            amount: betAmount,
            entryPrice: snapshotPrice,
            exitPrice: price,
            won: won,
            payout: won ? betAmount * 2 : 0,
            timestamp: Date.now(),
            asset: asset,
          };
          setBetHistory(function(prev) { return [entry].concat(prev).slice(0, 100); });
          // Sticky result toast — persists into next round so user can't miss it
          if (resultToastTimerRef.current) clearTimeout(resultToastTimerRef.current);
          setResultToast(entry);
          haptic('notification', won ? 'success' : 'error');
          resultToastTimerRef.current = setTimeout(function() { setResultToast(null); }, 12000);
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
        ws.onopen = () => { if (mounted) { setWsConnected(true); ws.send(JSON.stringify({ type: 'subscribe', asset: activeAsset })); }};
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
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', borderLeft: '1px solid rgba(255,255,255,0.08)', paddingLeft: '12px' }}>
          <button onClick={() => { window.location.href = '/defi-markets.html'; }} style={{ background: 'none', border: 'none', color: '#9ca3af', fontSize: '12px', fontWeight: '600', cursor: 'pointer', transition: 'color 0.2s', padding: '4px 8px' }} onMouseEnter={(e) => e.target.style.color = '#10b981'} onMouseLeave={(e) => e.target.style.color = '#9ca3af'}>
            DeFi Markets
          </button>
          <button onClick={() => { window.location.href = '/ideas.html'; }} style={{ background: 'none', border: 'none', color: '#9ca3af', fontSize: '12px', fontWeight: '600', cursor: 'pointer', transition: 'color 0.2s', padding: '4px 8px' }} onMouseEnter={(e) => e.target.style.color = '#10b981'} onMouseLeave={(e) => e.target.style.color = '#9ca3af'}>
            Ideas
          </button>
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
      {/* ===== MAIN GAME (connected + on Ink) ===== */}
      {isConnected && isOnInk && (
        <>
        {balance < 0.0001 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', padding: '8px 16px', background: 'rgba(239,68,68,0.08)', borderBottom: '1px solid rgba(239,68,68,0.15)' }}>
            <span style={{ color: '#ef4444', fontWeight: '600', fontSize: '12px' }}>Need Testnet ETH to place bets</span>
            <button onClick={function() { setShowFaucet(true); haptic('impact', 'light'); }} style={{ padding: '5px 14px', borderRadius: '8px', border: 'none', background: '#ef4444', color: '#fff', fontWeight: '600', cursor: 'pointer', fontSize: '11px' }}>Get ETH</button>
            <button onClick={() => refetchBalance()} style={{ padding: '5px 14px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.08)', background: 'transparent', color: '#6b7280', fontWeight: '600', cursor: 'pointer', fontSize: '11px' }}>Refresh</button>
          </div>
        )}
          {/* STOCKS: Market Status Banner + Ticker Selector */}
          {isStocks && (
            <div style={{ flexShrink: 0 }}>
              {/* Market status bar */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 12px', background: marketStatus && marketStatus.open ? 'rgba(16,185,129,0.06)' : 'rgba(239,68,68,0.06)', borderBottom: '1px solid ' + (marketStatus && marketStatus.open ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)') }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: marketStatus && marketStatus.open ? '#10b981' : '#ef4444', display: 'inline-block', animation: marketStatus && marketStatus.open ? 'pulseGlow 1.4s ease-in-out infinite' : 'none' }} />
                  <span style={{ fontSize: '10px', fontWeight: '700', color: marketStatus && marketStatus.open ? '#10b981' : '#ef4444' }}>{marketStatus ? marketStatus.label : 'Loading...'}</span>
                  {marketStatus && marketStatus.event && (
                    <span style={{ fontSize: '8px', fontWeight: '800', padding: '2px 6px', borderRadius: '4px', letterSpacing: '0.5px', background: marketStatus.event === 'opening-bell' ? 'rgba(251,191,36,0.2)' : marketStatus.event === 'power-hour' ? 'rgba(168,85,247,0.2)' : 'rgba(107,114,128,0.15)', color: marketStatus.event === 'opening-bell' ? '#fbbf24' : marketStatus.event === 'power-hour' ? '#a855f7' : '#6b7280', animation: (marketStatus.event === 'opening-bell' || marketStatus.event === 'power-hour') ? 'pulseGlow 1.4s ease-in-out infinite' : 'none' }}>{marketStatus.eventLabel}</span>
                  )}
                </div>
                <span style={{ fontSize: '9px', color: '#6b7280', fontFamily: 'monospace' }}>{marketStatus ? marketStatus.etTime : ''} {'\u00B7'} 30s rounds</span>
              </div>

              {/* Stock ticker selector — horizontal scroll */}
              <div style={{ display: 'flex', gap: '4px', overflowX: 'auto', scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch', padding: '6px 8px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                {STOCK_TICKERS.map(function(t) {
                  var sel = stockTicker === t.symbol;
                  return (
                    <button key={t.symbol} onClick={function() { setStockTicker(t.symbol); haptic('impact', 'light'); }} style={{ flexShrink: 0, padding: '4px 10px', borderRadius: '8px', border: sel ? '1px solid rgba(168,85,247,0.5)' : '1px solid rgba(255,255,255,0.06)', background: sel ? 'rgba(168,85,247,0.15)' : 'rgba(255,255,255,0.03)', color: sel ? '#c084fc' : '#9ca3af', fontSize: '10px', fontWeight: '700', cursor: 'pointer', transition: 'all 0.2s', whiteSpace: 'nowrap' }}>
                      {t.symbol}
                    </button>
                  );
                })}
              </div>

              {/* Lunch pause overlay */}
              {marketStatus && marketStatus.event === 'lunch' && (
                <div style={{ padding: '10px 12px', background: 'rgba(107,114,128,0.08)', borderBottom: '1px solid rgba(107,114,128,0.12)', textAlign: 'center' }}>
                  <div style={{ fontSize: '11px', color: '#9ca3af', fontWeight: '600' }}>{'\u{1F374}'} Lunch Pause — low volatility window</div>
                  <div style={{ fontSize: '9px', color: '#6b7280', marginTop: '2px' }}>Rounds still active but expect flat price action. Power Hour starts at 3:00 PM ET.</div>
                </div>
              )}

              {/* Markets closed overlay */}
              {marketStatus && !marketStatus.open && (
                <div style={{ padding: '24px 16px', textAlign: 'center' }}>
                  <div style={{ fontSize: '32px', marginBottom: '8px' }}>{marketStatus.status === 'weekend' ? '\u{1F3D6}' : '\u{1F319}'}</div>
                  <div style={{ fontSize: '16px', fontWeight: '800', color: '#fff', marginBottom: '4px' }}>Markets Closed</div>
                  <div style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '12px' }}>{marketStatus.label}</div>
                  <div style={{ fontSize: '10px', color: '#6b7280' }}>Switch to Crypto for 24/7 trading {'\u{2193}'}</div>
                </div>
              )}
            </div>
          )}

          {/* THREE-COLUMN LAYOUT (Desktop) or SINGLE COLUMN (Mobile) */}
          <div style={{ flex: 1, minHeight: 0, gap: '12px', padding: '8px 8px', overflowY: 'auto', display: (isStocks && marketStatus && !marketStatus.open) ? 'none' : 'flex' }}>
            {/* LEFT SIDEBAR — Only on desktop */}
            {isDesktop && (
              <div style={{ flexShrink: 0 }}>
                <EcosystemSidebar />
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <div style={{ fontSize: '9px', color: '#4b5563', letterSpacing: '1.5px' }}>{isStocks ? stockTicker : asset}/USD</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                      <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#10b981', animation: 'pulseGlow 1.4s ease-in-out infinite', display: 'inline-block' }} />
                      <span style={{ fontSize: '8px', color: '#10b981', fontWeight: '700', letterSpacing: '0.5px' }}>LIVE</span>
                    </div>
                  </div>
                  <div key={priceKey} style={{ fontSize: '24px', fontWeight: '800', letterSpacing: '-1px', lineHeight: 1, animation: priceDir ? (priceDir === 'up' ? 'priceFlashGreen 0.5s ease-out' : 'priceFlashRed 0.5s ease-out') : 'none' }}>
                    {price > 0 ? '$' + price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '...'}
                  </div>
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
                        {BET_LABELS[betAmount]} on {bet.toUpperCase()}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* LIVE POOL SPLIT — crowd sentiment */}
              <div style={{ padding: '2px 4px 0', flexShrink: 0 }}>
                {(function() {
                  var poolUp = Number(pool && pool.up) || 0;
                  var poolDown = Number(pool && pool.down) || 0;
                  var totalPool = poolUp + poolDown;
                  var upPct = totalPool > 0 ? (poolUp / totalPool * 100) : 50;
                  var downPct = 100 - upPct;
                  return (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px', fontSize: '10px' }}>
                        <span style={{ color: '#10b981', fontWeight: '700' }}>UP {Math.round(upPct)}%</span>
                        <span style={{ color: '#4b5563', fontWeight: '600', fontSize: '9px', letterSpacing: '1px' }}>LIVE POOL</span>
                        <span style={{ color: '#ef4444', fontWeight: '700' }}>{Math.round(downPct)}% DOWN</span>
                      </div>
                      <div style={{ position: 'relative', height: '6px', borderRadius: '3px', background: 'rgba(255,255,255,0.04)', overflow: 'hidden', display: 'flex' }}>
                        <div style={{ width: upPct + '%', background: 'linear-gradient(90deg, #10b981, rgba(16,185,129,0.7))', transition: 'width 0.5s ease' }} />
                        <div style={{ width: downPct + '%', background: 'linear-gradient(90deg, rgba(239,68,68,0.7), #ef4444)', transition: 'width 0.5s ease' }} />
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '3px', fontSize: '9px', color: '#6b7280' }}>
                        <span>{poolUp.toFixed(3)} ETH</span>
                        <span>{poolDown.toFixed(3)} ETH</span>
                      </div>
                    </>
                  );
                })()}
              </div>

              {/* AMOUNT + BET BUTTONS */}
              <div style={{ padding: '4px 0 0', flexShrink: 0 }}>
                {/* Amount selector */}
                <div style={{ display: 'flex', justifyContent: 'center', gap: '4px', marginBottom: '6px' }}>
                  {[0.001, 0.005, 0.01, 0.05].map(amt => (
                    <button key={amt} className="amount-btn" onClick={() => setBetAmount(amt)}
                      style={{ padding: '5px 12px', borderRadius: '8px', border: betAmount === amt ? '1px solid rgba(16,185,129,0.4)' : '1px solid rgba(255,255,255,0.05)', background: betAmount === amt ? 'rgba(16,185,129,0.12)' : 'rgba(255,255,255,0.02)', color: betAmount === amt ? '#10b981' : '#6b7280', fontWeight: '600', fontSize: '11px', cursor: 'pointer' }}
                    >{BET_LABELS[amt]}</button>
                  ))}
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
                <div style={{ display: 'flex', gap: '6px' }}>
                  {(function() {
                    var wins = betHistory.filter(function(h) { return h.won; }).length;
                    var total = betHistory.length;
                    return (
                      <button onClick={function() { setShowHistory(true); haptic('impact', 'light'); }} style={{ padding: '3px 10px', borderRadius: '12px', border: '1px solid rgba(168,85,247,0.18)', background: 'rgba(168,85,247,0.06)', color: '#c084fc', fontSize: '10px', fontWeight: '600', cursor: 'pointer' }}>
                        📊 History{total > 0 ? ' ' + wins + '/' + total : ''}
                      </button>
                    );
                  })()}
                  <button onClick={function() { setShowReferral(!showReferral); }} style={{ padding: '3px 10px', borderRadius: '12px', border: '1px solid rgba(16,185,129,0.12)', background: 'rgba(16,185,129,0.04)', color: '#10b981', fontSize: '10px', fontWeight: '600', cursor: 'pointer' }}>
                    👥 Invite
                  </button>
                </div>
              </div>

              {/* Win Result Display */}
              {bet && roundResult && bet === roundResult && (phase === 'results' || phase === 'resolving') && (function() {
                var margin = (price && snapshotPrice) ? (price - snapshotPrice) : 0;
                var marginAbs = Math.abs(margin);
                var sideLabel = bet === 'up' ? 'UP' : 'DOWN';
                var sideEmoji = bet === 'up' ? '\u{1F4C8}' : '\u{1F4C9}';
                return (
                  <div style={{ padding: '14px', textAlign: 'center', animation: 'slideIn 0.3s ease, glow 1.5s ease infinite', flexShrink: 0, background: 'rgba(16,185,129,0.15)', borderRadius: '12px', border: '2px solid rgba(16,185,129,0.5)' }}>
                    <div style={{ fontSize: '40px', marginBottom: '4px' }}>&#10024;</div>
                    <div style={{ fontSize: '28px', fontWeight: '900', color: '#10b981', marginBottom: '2px' }}>YOU WON!</div>
                    <div style={{ fontSize: '12px', color: '#6fddce', fontWeight: '700', marginBottom: '8px' }}>
                      You bet {sideEmoji} {sideLabel} &middot; +{(betAmount).toFixed(3)} ETH profit
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-around', alignItems: 'center', padding: '8px', borderRadius: '8px', background: 'rgba(0,0,0,0.25)', marginBottom: claimRoundId ? '10px' : '0', fontSize: '11px' }}>
                      <div>
                        <div style={{ color: '#6b7280', fontSize: '9px', letterSpacing: '0.5px' }}>ENTRY</div>
                        <div style={{ color: '#fff', fontWeight: '700' }}>${snapshotPrice ? snapshotPrice.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'}</div>
                      </div>
                      <div style={{ color: '#10b981', fontSize: '14px' }}>&rarr;</div>
                      <div>
                        <div style={{ color: '#6b7280', fontSize: '9px', letterSpacing: '0.5px' }}>EXIT</div>
                        <div style={{ color: '#fff', fontWeight: '700' }}>${price ? price.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'}</div>
                      </div>
                      <div>
                        <div style={{ color: '#6b7280', fontSize: '9px', letterSpacing: '0.5px' }}>BY</div>
                        <div style={{ color: '#10b981', fontWeight: '800' }}>{margin >= 0 ? '+' : '-'}${marginAbs.toFixed(2)}</div>
                      </div>
                    </div>
                    {claimRoundId && (
                      <button onClick={claimWinnings} disabled={!!claimStatus}
                        style={{ width: '100%', padding: '12px', borderRadius: '10px', border: 'none', background: claimStatus === 'confirmed' ? '#10b981' : 'linear-gradient(135deg, #10b981, #059669)', color: '#000', fontWeight: '800', fontSize: '14px', cursor: claimStatus ? 'not-allowed' : 'pointer', boxShadow: '0 4px 16px rgba(16,185,129,0.4)', transition: 'all 0.2s' }}
                      >{claimStatus === 'pending' ? 'Confirm in Wallet...' : claimStatus === 'confirming' ? 'Claiming...' : claimStatus === 'confirmed' ? 'Claimed!' : claimStatus === 'error' ? 'Claim Failed' : 'Claim ' + (betAmount * 2).toFixed(3) + ' ETH'}</button>
                    )}
                  </div>
                );
              })()}

              {/* Lose Result Display */}
              {bet && roundResult && bet !== roundResult && (phase === 'results' || phase === 'resolving') && (function() {
                var margin = (price && snapshotPrice) ? (price - snapshotPrice) : 0;
                var marginAbs = Math.abs(margin);
                var sideLabel = bet === 'up' ? 'UP' : 'DOWN';
                var sideEmoji = bet === 'up' ? '\u{1F4C8}' : '\u{1F4C9}';
                var actualLabel = roundResult === 'up' ? 'UP' : 'DOWN';
                return (
                  <div style={{ padding: '14px', textAlign: 'center', animation: 'slideIn 0.3s ease', flexShrink: 0, background: 'rgba(239,68,68,0.12)', borderRadius: '12px', border: '2px solid rgba(239,68,68,0.4)' }}>
                    <div style={{ fontSize: '40px', marginBottom: '4px' }}>&#128546;</div>
                    <div style={{ fontSize: '28px', fontWeight: '900', color: '#ef4444', marginBottom: '2px' }}>YOU LOST</div>
                    <div style={{ fontSize: '12px', color: '#fca5a5', fontWeight: '700', marginBottom: '8px' }}>
                      You bet {sideEmoji} {sideLabel} &middot; price went {actualLabel} &middot; -{(betAmount).toFixed(3)} ETH
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-around', alignItems: 'center', padding: '8px', borderRadius: '8px', background: 'rgba(0,0,0,0.25)', fontSize: '11px' }}>
                      <div>
                        <div style={{ color: '#6b7280', fontSize: '9px', letterSpacing: '0.5px' }}>ENTRY</div>
                        <div style={{ color: '#fff', fontWeight: '700' }}>${snapshotPrice ? snapshotPrice.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'}</div>
                      </div>
                      <div style={{ color: '#ef4444', fontSize: '14px' }}>&rarr;</div>
                      <div>
                        <div style={{ color: '#6b7280', fontSize: '9px', letterSpacing: '0.5px' }}>EXIT</div>
                        <div style={{ color: '#fff', fontWeight: '700' }}>${price ? price.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'}</div>
                      </div>
                      <div>
                        <div style={{ color: '#6b7280', fontSize: '9px', letterSpacing: '0.5px' }}>BY</div>
                        <div style={{ color: '#ef4444', fontWeight: '800' }}>{margin >= 0 ? '+' : '-'}${marginAbs.toFixed(2)}</div>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* RIGHT SIDEBAR — Only on desktop */}
            {isDesktop && (
              <div style={{ flexShrink: 0 }}>
                <LiveFeedSidebar recentBets={recentBets} points={points} />
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

      {/* Faucet overlay */}
      {showFaucet && (
        <div onClick={function() { setShowFaucet(false); }} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)', zIndex: 90, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', animation: 'fadeIn 0.2s ease' }}>
          <div onClick={function(e) { e.stopPropagation(); }} className="glass-card" style={{ borderRadius: '20px', padding: '24px', maxWidth: '420px', width: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div style={{ fontSize: '16px', fontWeight: '700' }}>Get Testnet ETH</div>
              <button onClick={function() { setShowFaucet(false); }} style={{ background: 'none', border: 'none', color: '#6b7280', fontSize: '18px', cursor: 'pointer' }}>X</button>
            </div>

            {/* Current balance */}
            <div style={{ padding: '14px', borderRadius: '12px', background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.15)', marginBottom: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: '10px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '2px' }}>Your Balance</div>
                <div style={{ fontSize: '18px', fontWeight: '700', color: balance < 0.0001 ? '#ef4444' : '#10b981' }}>{Number(balance).toFixed(6)} ETH</div>
              </div>
              <button onClick={function() { refetchBalance(); haptic('impact', 'light'); }} style={{ padding: '8px 14px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)', color: '#9ca3af', fontWeight: '600', cursor: 'pointer', fontSize: '11px' }}>Refresh</button>
            </div>

            {/* Address helper */}
            <div style={{ fontSize: '11px', color: '#9ca3af', marginBottom: '6px' }}>1. Copy your wallet address</div>
            <div style={{ display: 'flex', gap: '6px', marginBottom: '14px' }}>
              <div style={{ flex: 1, padding: '10px', borderRadius: '10px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)', fontSize: '10px', fontFamily: 'monospace', color: '#9ca3af', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {address || ''}
              </div>
              <button onClick={function() { if (address) { navigator.clipboard.writeText(address).catch(function() {}); setFaucetCopied(true); haptic('notification', 'success'); setTimeout(function() { setFaucetCopied(false); }, 1500); } }} style={{ padding: '10px 14px', borderRadius: '10px', border: 'none', background: faucetCopied ? '#10b981' : '#fbbf24', color: '#000', fontWeight: '700', fontSize: '11px', cursor: 'pointer', minWidth: '64px' }}>{faucetCopied ? 'Copied' : 'Copy'}</button>
            </div>

            {/* Copy faucet URL */}
            <div style={{ fontSize: '11px', color: '#9ca3af', marginBottom: '6px' }}>2. Copy the faucet URL and open it in your browser</div>
            <div style={{ display: 'flex', gap: '6px', marginBottom: '14px' }}>
              <div style={{ flex: 1, padding: '10px', borderRadius: '10px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)', fontSize: '10px', fontFamily: 'monospace', color: '#9ca3af', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                inkonchain.com/faucet
              </div>
              <button onClick={function(e) { e.stopPropagation(); try { navigator.clipboard.writeText('https://inkonchain.com/faucet').catch(function() {}); } catch(err) {} setFaucetUrlCopied(true); haptic('notification', 'success'); setTimeout(function() { setFaucetUrlCopied(false); }, 1500); }} style={{ padding: '10px 14px', borderRadius: '10px', border: 'none', background: faucetUrlCopied ? '#10b981' : '#fbbf24', color: '#000', fontWeight: '700', fontSize: '11px', cursor: 'pointer', minWidth: '64px' }}>{faucetUrlCopied ? 'Copied' : 'Copy'}</button>
            </div>

            {/* Final step */}
            <div style={{ fontSize: '11px', color: '#9ca3af', marginBottom: '6px' }}>3. Come back here and refresh your balance</div>
            <button onClick={function() { refetchBalance(); haptic('impact', 'medium'); }} style={{ width: '100%', padding: '12px', borderRadius: '12px', border: '1px solid rgba(16,185,129,0.25)', background: 'rgba(16,185,129,0.08)', color: '#10b981', fontWeight: '700', cursor: 'pointer', fontSize: '13px' }}>I Got My ETH - Refresh Balance</button>

            <div style={{ fontSize: '10px', color: '#6b7280', textAlign: 'center', marginTop: '14px', lineHeight: '1.5' }}>Faucet gives ~0.05 testnet ETH per request. Enough for 50+ bets. No real money involved.</div>
          </div>
        </div>
      )}

      {/* History overlay */}
      {showHistory && (function() {
        var wins = betHistory.filter(function(h) { return h.won; }).length;
        var losses = betHistory.length - wins;
        var winRate = betHistory.length > 0 ? Math.round((wins / betHistory.length) * 100) : 0;
        var netPnl = betHistory.reduce(function(acc, h) { return acc + (h.won ? h.amount : -h.amount); }, 0);
        return (
          <div onClick={function() { setShowHistory(false); }} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)', zIndex: 90, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', animation: 'fadeIn 0.2s ease' }}>
            <div onClick={function(e) { e.stopPropagation(); }} className="glass-card" style={{ borderRadius: '20px', padding: '20px', maxWidth: '460px', width: '100%', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexShrink: 0 }}>
                <div style={{ fontSize: '16px', fontWeight: '700' }}>📊 Bet History</div>
                <button onClick={function() { setShowHistory(false); }} style={{ background: 'none', border: 'none', color: '#6b7280', fontSize: '18px', cursor: 'pointer' }}>X</button>
              </div>

              {/* Summary stats */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: '14px', flexShrink: 0 }}>
                <div style={{ padding: '10px', borderRadius: '10px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)', textAlign: 'center' }}>
                  <div style={{ fontSize: '9px', color: '#6b7280', letterSpacing: '0.5px', marginBottom: '2px' }}>RECORD</div>
                  <div style={{ fontSize: '14px', fontWeight: '800', color: '#fff' }}><span style={{ color: '#10b981' }}>{wins}W</span> · <span style={{ color: '#ef4444' }}>{losses}L</span></div>
                </div>
                <div style={{ padding: '10px', borderRadius: '10px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)', textAlign: 'center' }}>
                  <div style={{ fontSize: '9px', color: '#6b7280', letterSpacing: '0.5px', marginBottom: '2px' }}>WIN RATE</div>
                  <div style={{ fontSize: '14px', fontWeight: '800', color: winRate >= 50 ? '#10b981' : '#fbbf24' }}>{winRate}%</div>
                </div>
                <div style={{ padding: '10px', borderRadius: '10px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)', textAlign: 'center' }}>
                  <div style={{ fontSize: '9px', color: '#6b7280', letterSpacing: '0.5px', marginBottom: '2px' }}>NET P&amp;L</div>
                  <div style={{ fontSize: '14px', fontWeight: '800', color: netPnl >= 0 ? '#10b981' : '#ef4444' }}>{netPnl >= 0 ? '+' : ''}{netPnl.toFixed(3)}</div>
                </div>
              </div>

              {/* Scrollable list */}
              <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
                {betHistory.length === 0 && (
                  <div style={{ textAlign: 'center', padding: '32px 12px', color: '#6b7280', fontSize: '12px' }}>
                    <div style={{ fontSize: '32px', marginBottom: '8px' }}>📭</div>
                    No bets yet. Place your first bet to start your history!
                  </div>
                )}
                {betHistory.map(function(h, i) {
                  var when = new Date(h.timestamp);
                  var timeAgo = (function() {
                    var sec = Math.floor((Date.now() - h.timestamp) / 1000);
                    if (sec < 60) return sec + 's ago';
                    if (sec < 3600) return Math.floor(sec / 60) + 'm ago';
                    if (sec < 86400) return Math.floor(sec / 3600) + 'h ago';
                    return Math.floor(sec / 86400) + 'd ago';
                  })();
                  var sideEmoji = h.side === 'up' ? '📈' : '📉';
                  var sideLabel = h.side === 'up' ? 'UP' : 'DOWN';
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderRadius: '10px', background: h.won ? 'rgba(16,185,129,0.06)' : 'rgba(239,68,68,0.05)', border: '1px solid ' + (h.won ? 'rgba(16,185,129,0.18)' : 'rgba(239,68,68,0.15)'), marginBottom: '6px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: '20px' }}>{h.won ? '✅' : '❌'}</div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: '12px', fontWeight: '700', color: '#fff' }}>{sideEmoji} {sideLabel} · {h.amount.toFixed(3)} ETH</div>
                          <div style={{ fontSize: '10px', color: '#6b7280', marginTop: '2px' }}>
                            ${h.entryPrice ? h.entryPrice.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'} → ${h.exitPrice ? h.exitPrice.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'}
                          </div>
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: '8px' }}>
                        <div style={{ fontSize: '13px', fontWeight: '800', color: h.won ? '#10b981' : '#ef4444' }}>{h.won ? '+' : '-'}{h.amount.toFixed(3)}</div>
                        <div style={{ fontSize: '9px', color: '#4b5563', marginTop: '2px' }}>{timeAgo}</div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {betHistory.length > 0 && (
                <button onClick={function() { if (typeof window !== 'undefined' && window.confirm && window.confirm('Clear all bet history? This cannot be undone.')) { setBetHistory([]); haptic('notification', 'warning'); } }} style={{ marginTop: '12px', padding: '8px', borderRadius: '8px', border: '1px solid rgba(239,68,68,0.2)', background: 'rgba(239,68,68,0.04)', color: '#ef4444', fontSize: '11px', fontWeight: '600', cursor: 'pointer', flexShrink: 0 }}>Clear History</button>
              )}
            </div>
          </div>
        );
      })()}

      {/* Sticky result toast — persists across round transitions so user can't miss outcome */}
      {resultToast && (
        <div
          onClick={function() { if (resultToastTimerRef.current) clearTimeout(resultToastTimerRef.current); setResultToast(null); }}
          style={{
            position: 'fixed',
            top: '70px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 95,
            padding: '12px 18px',
            borderRadius: '14px',
            background: resultToast.won ? 'linear-gradient(135deg, rgba(16,185,129,0.95), rgba(5,150,105,0.95))' : 'linear-gradient(135deg, rgba(239,68,68,0.95), rgba(185,28,28,0.95))',
            border: '2px solid ' + (resultToast.won ? 'rgba(110,231,183,0.8)' : 'rgba(252,165,165,0.8)'),
            boxShadow: '0 8px 32px ' + (resultToast.won ? 'rgba(16,185,129,0.4)' : 'rgba(239,68,68,0.4)'),
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            cursor: 'pointer',
            animation: 'slideIn 0.4s ease',
            maxWidth: '92vw',
          }}
        >
          <div style={{ fontSize: '28px', lineHeight: '1' }}>{resultToast.won ? '\u{1F389}' : '\u{1F614}'}</div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: '14px', fontWeight: '900', letterSpacing: '0.5px', lineHeight: '1.1' }}>
              {resultToast.won ? 'YOU WON' : 'YOU LOST'} &middot; {resultToast.won ? '+' : '-'}{resultToast.amount.toFixed(3)} ETH
            </div>
            <div style={{ fontSize: '10px', opacity: 0.9, marginTop: '3px', fontWeight: '600' }}>
              {(resultToast.side === 'up' ? '\u{1F4C8} UP' : '\u{1F4C9} DOWN')} &middot; ${resultToast.entryPrice ? resultToast.entryPrice.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'} &rarr; ${resultToast.exitPrice ? resultToast.exitPrice.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'}
            </div>
          </div>
          <div style={{ fontSize: '14px', opacity: 0.7, marginLeft: '4px' }}>&times;</div>
        </div>
      )}

      {/* Transaction Status Overlay */}
      {txStatus && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', backdropFilter: 'blur(8px)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 100, animation: 'fadeIn 0.2s ease' }}>
          {txStatus === 'pending' && (
            <div style={{ textAlign: 'center', animation: 'slideIn 0.3s ease' }}>
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>⏳</div>
              <div style={{ fontSize: '20px', fontWeight: '700', color: '#fbbf24' }}>Confirm in Wallet</div>
              <div style={{ fontSize: '13px', color: '#6b7280', marginTop: '8px' }}>{BET_LABELS[betAmount]} on {bet ? bet.toUpperCase() : '...'}</div>
                <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '4px' }}>{betAmount} ETH</div>
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
  var [gameMode, setGameMode] = useState('crypto'); // 'crypto' | 'stocks'

  return (
    <ErrorBoundary>
      <WagmiProvider config={wagmiAdapter.wagmiConfig}>
        <QueryClientProvider client={queryClient}>
          {showGame ? (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh', width: '100%' }}>
              <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', position: 'relative' }}>
                <PulseGame key={gameMode} gameMode={gameMode} />
              </div>
              {/* Bottom Nav — Crypto / Stocks */}
              <div style={{ flexShrink: 0, display: 'flex', borderTop: '1px solid rgba(255,255,255,0.06)', background: 'rgba(8,8,12,0.95)', backdropFilter: 'blur(12px)', padding: '0 0 env(safe-area-inset-bottom, 0)' }}>
                <button onClick={function() { setGameMode('crypto'); }} style={{ flex: 1, padding: '10px 0 8px', border: 'none', background: gameMode === 'crypto' ? 'rgba(16,185,129,0.08)' : 'transparent', color: gameMode === 'crypto' ? '#10b981' : '#4b5563', fontWeight: '700', fontSize: '11px', cursor: 'pointer', borderTop: gameMode === 'crypto' ? '2px solid #10b981' : '2px solid transparent', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px', transition: 'all 0.2s' }}>
                  <span style={{ fontSize: '16px' }}>{'\u26A1'}</span>
                  <span>Crypto</span>
                </button>
                <button onClick={function() { setGameMode('stocks'); }} style={{ flex: 1, padding: '10px 0 8px', border: 'none', background: gameMode === 'stocks' ? 'rgba(168,85,247,0.08)' : 'transparent', color: gameMode === 'stocks' ? '#a855f7' : '#4b5563', fontWeight: '700', fontSize: '11px', cursor: 'pointer', borderTop: gameMode === 'stocks' ? '2px solid #a855f7' : '2px solid transparent', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px', transition: 'all 0.2s' }}>
                  <span style={{ fontSize: '16px' }}>{'\u{1F4C8}'}</span>
                  <span>Stocks</span>
                </button>
              </div>
            </div>
          ) : <LandingPage onEnter={function() { setShowGame(true); }} />}
        </QueryClientProvider>
      </WagmiProvider>
    </ErrorBoundary>
  );
}

export default App;
