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

// In Telegram WebView there are no injected wallets â only WalletConnect works
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
// CSS ANIMATIONS
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
// PRICE CHART (Canvas) â Pro version with axes
// ============================================ÓÓÓÐ¦6öç7B&6T6'BÒ²&6W2ÂÆö6µ&6RÂ6RÂ&÷VæE&W7VÇBÒÓâ°¢6öç7B6çf5&VbÒW6U&VbçVÆÂ° ¢W6TVffV7BÓâ°¢6öç7B6çf2Ò6çf5&Vbæ7W'&VçC°¢b6çf2&WGW&ã°¢6öç7B7GÒ6çf2ævWD6öçFWBs&Br°¢6öç7B&V7BÒ6çf2ævWD&÷VæFæt6ÆVçE&V7B°¢6öç7BG"ÒvæF÷ræFWf6UVÅ&FòÇÂ°¢6çf2çvGFÒ&V7BçvGF¢G#°¢6çf2æVvBÒ&V7BæVvB¢G#°¢7Gç66ÆRG"ÂG"°¢6öç7BrÒ&V7BçvGF°¢6öç7BÒ&V7BæVvC° ¢òòÆ÷WC¢6'B&VvFÖ&vç2f÷"W0¢6öç7BÔÂÒÂÕ"Òc"ÂÕBÒÂÔ"Ò##°¢6öç7B5rÒrÒÔÂÒÕ#°¢6öç7B4ÒÒÕBÒÔ#° ¢7Gæ6ÆV%&V7BÂÂrÂ° ¢b&6W2ÇÂ&6W2æÆVæwFÂ"°¢7GæfÆÅ7GÆRÒr3332s°¢7GæföçBÒsÖÆR×77FVÒÂ6ç2×6W&bs°¢7GçFWDÆvâÒv6VçFW"s°¢7GæfÆÅFWBuvFærf÷"&6RFFââârÂrò"Âò"°¢&WGW&ã°¢Ð ¢6öç7BÖâÒÖFæÖâââç&6W2°¢6öç7BÖÒÖFæÖââç&6W2°¢6öç7B&ævRÒÖÒÖâÇÂ°¢6öç7BBÒ&ævR¢ã#°¢6öç7BÖâÒÖâÒC°¢6öç7BÖÒÖ²C°¢6öç7B&ævRÒÖÒÖã° ¢6öç7BFõÒÓâÔÂ²ò&6W2æÆVæwFÒ¢5s°¢6öç7BFõÒÓâÕB²4ÒÒÖâò&ævR¢4° ¢òòÒÒÒÔ3¢B&6RÆ&VÇ2öâ&vBÒÒÐ¢7GçFWDÆvâÒvÆVgBs°¢7GæföçBÒsÖÆR×77FVÒÂ6ç2×6W&bs°¢f÷"f"Ò²ÂC²²²°¢f"fÂÒÖâ²&ævR¢ò2°¢f"ÒFõfÂ°¢òòw&BÆæP¢7Gç7G&ö¶U7GÆRÒw&v&#SRÃ#SRÃ#SRÃãBs°¢7GæÆæUvGFÒ°¢7Gæ&VvåF°¢7GæÖ÷fUFòÔÂÂ°¢7GæÆæUFòÔÂ²5rÂ°¢7Gç7G&ö¶R°¢òòÆ&VÀ¢7GæfÆÅ7GÆRÒr3F#SSc2s°¢7GæfÆÅFWBrBr²fÂçFôfVB"ÂÔÂ²5r²bÂ²2°¢Ð ¢òòÒÒÒÔ3¢FÖRÆ&VÇ2ÒÒÐ¢7GçFWDÆvâÒv6VçFW"s°¢7GæföçBÒsÖÆR×77FVÒÂ6ç2×6W&bs°¢7GæfÆÅ7GÆRÒr33sCSs°¢f"F÷FÅ6V2Ò&6W2æÆVæwF²òòã&6RW"6V6öæ@¢f"7FW2ÒÖFæÖâRÂ&6W2æÆVæwFÒ°¢f÷"f"Ò²ÃÒ7FW3²²²°¢f"GÒÖFç&÷VæB&6W2æÆVæwFÒ¢ò7FW2°¢f"6V4vòÒ&6W2æÆVæwFÒÒG°¢f"ÒFõG°¢òòF6²Ö&°¢7Gç7G&ö¶U7GÆRÒw&v&#SRÃ#SRÃ#SRÃãbs°¢7Gæ&VvåF°¢7GæÖ÷fUFòÂÕB²4°¢7GæÆæUFòÂÕB²4²B°¢7Gç7G&ö¶R°¢òòÆ&VÀ¢7GæfÆÅFWB6V4vòÓÓÒòvæ÷rr¢rÒr²6V4vò²w2rÂÂÕB²4²R°¢Ð ¢òòÒÒÒÆö6²&6RòVçG'ÆæRÒÒÐ¢bÆö6µ&6Rbb6RÓÒv&WGFærr°¢f"ÇÒFõÆö6µ&6R°¢òòU¦öæP¢7GæfÆÅ7GÆRÒw&v&bÃRÃ#ÃãRs°¢7GæfÆÅ&V7BÔÂÂÕBÂ5rÂÇÒÕB°¢òòDõtâ¦öæP¢7GæfÆÅ7GÆRÒw&v&#3ÃcÃcÃãRs°¢7GæfÆÅ&V7BÔÂÂÇÂ5rÂÕB²4ÒÇ°¢òòF6VBVçG'ÆæP¢7Gç7G&ö¶U7GÆRÒw&v&#CRÃSÃÃãrs°¢7GæÆæUvGFÒãS°¢7Gç6WDÆæTF6³RÂ5Ò°¢7Gæ&VvåF°¢7GæÖ÷fUFòÔÂÂÇ°¢7GæÆæUFòÔÂ²5rÂÇ°¢7Gç7G&ö¶R°¢7Gç6WDÆæTF6µÒ°¢òòVçG'&6RÆ&VÂ&vB6FRÂöâFRÆæR¢7GæfÆÅ7GÆRÒw&v&#CRÃSÃÃãs°¢7GæföçBÒv&öÆBÖÆR×77FVÒÂ6ç2×6W&bs°¢7GçFWDÆvâÒvÆVgBs°¢7GæfÆÅFWBtVçG'Br²Æö6µ&6RçFôfVB"ÂÔÂ²5r²BÂÇÒB°¢òò¦öæRÆ&VÇ0¢7GæföçBÒsÖÆR×77FVÒÂ6ç2×6W&bs°¢7GçFWDÆvâÒv6VçFW"s°¢7GæfÆÅ7GÆRÒw&v&bÃRÃ#ÃãBs°¢7GæfÆÅFWBuUrÂÔÂ²#ÂÇÒ°¢7GæfÆÅ7GÆRÒw&v&#3ÃcÃcÃãBs°¢7GæfÆÅFWBtDõtârÂÔÂ²#ÂÇ²B°¢Ð ¢òòÒÒÒ&6RÆæRÒÒÐ¢f"Æ7E&6RÒ&6W5·&6W2æÆVæwFÒÓ°¢f"ÆæT6öÆ÷"ÒÆö6µ&6RÇÂ6RÓÓÒv&WGFærròr3f#fCBr¢Æ7E&6RâÆö6µ&6Ròr3#r¢r6VcCCCBs° ¢7Gç6F÷t6öÆ÷"ÒÆæT6öÆ÷#°¢7Gç6F÷t&ÇW"Ò°¢7Gç7G&ö¶U7GÆRÒÆæT6öÆ÷#°¢7GæÆæUvGFÒ#°¢7GæÆæT6Òw&÷VæBs°¢7GæÆæT¦öâÒw&÷VæBs°¢7Gæ&VvåF°¢&6W2æf÷$V6gVæ7FöâÂ°¢f"ÒFõ°¢f"ÒFõ°¢ÓÓÒò7GæÖ÷fUFòÂ¢7GæÆæUFòÂ°¢Ò°¢7Gç7G&ö¶R°¢7Gç6F÷t&ÇW"Ò° ¢òòÒÒÒw&FVçBfÆÂVæFW"ÆæRÒÒÐ¢7GæÆæUFòFõ&6W2æÆVæwFÒÂÕB²4°¢7GæÆæUFòFõÂÕB²4°¢7Gæ6Æ÷6UF°¢f"w&BÒ7Gæ7&VFTÆæV$w&FVçBÂÕBÂÂÕB²4°¢f"fÆÄ2ÒÆæT6öÆ÷"ÓÓÒr3#ròw&v&bÃRÃ#Âr¢ÆæT6öÆ÷"ÓÓÒr6VcCCCBròw&v&#3ÃcÃcÂr¢w&v&bÃ"Ã#"Âs°¢w&BæFD6öÆ÷%7F÷ÂfÆÄ2²sã"r°¢w&BæFD6öÆ÷%7F÷ãrÂfÆÄ2²sã2r°¢w&BæFD6öÆ÷%7F÷Âw&v&ÃÃÃr°¢7GæfÆÅ7GÆRÒw&C°¢7GæfÆÂ° ¢òòÒÒÒ7W'&VçB&6RF÷BÒÒÐ¢f"ÇÒFõ&6W2æÆVæwFÒ°¢f"ÇÒFõÆ7E&6R° ¢7Gæ&VvåF°¢7Gæ&2ÇÂÇÂbÂÂÖFå¢"°¢7GæfÆÅ7GÆRÒfÆÄ2²sã#Rs°¢7GæfÆÂ°¢7Gæ&VvåF°¢7Gæ&2ÇÂÇÂ2ÂÂÖFå¢"°¢7GæfÆÅ7GÆRÒÆæT6öÆ÷#°¢7GæfÆÂ° ¢òòÒÒÒ7W'&VçB&6RÆ&VÂ&vB6FRÒÒÐ¢7GæfÆÅ7GÆRÒr3s°¢f"Æ&VÅrÒs#°¢f"Æ&VÄÒ°¢f"Æ&VÅÒÇÒÆ&VÄò#°¢òò6Æ×Fò6'B&V¢bÆ&VÅÂÕBÆ&VÅÒÕC°¢bÆ&VÅ²Æ&VÄâÕB²4Æ&VÅÒÕB²4ÒÆ&VÄ°¢òò&6¶w&÷VæBÆÂÖçVÂ&÷VæFVB&V7Bf÷"'&÷w6W"6ö×B¢7GæfÆÅ7GÆRÒÆæT6öÆ÷#°¢f"Ç"ÒÔÂ²5r²"Â'"ÒC°¢7Gæ&VvåF°¢7GæÖ÷fUFòÇ"²'"ÂÆ&VÅ°¢7GæÆæUFòÇ"²Æ&VÅrÒ'"ÂÆ&VÅ°¢7GçVG&F47W'fUFòÇ"²Æ&VÅrÂÆ&VÅÂÇ"²Æ&VÅrÂÆ&VÅ²'"°¢7GæÆæUFòÇ"²Æ&VÅrÂÆ&VÅ²Æ&VÄÒ'"°¢7GçVG&F47W'fUFòÇ"²Æ&VÅrÂÆ&VÅ²Æ&VÄÂÇ"²Æ&VÅrÒ'"ÂÆ&VÅ²Æ&VÄ°¢7GæÆæUFòÇ"²'"ÂÆ&VÅ²Æ&VÄ°¢7GçVG&F47W'fUFòÇ"ÂÆ&VÅ²Æ&VÄÂÇ"ÂÆ&VÅ²Æ&VÄÒ'"°¢7GæÆæUFòÇ"ÂÆ&VÅ²'"°¢7GçVG&F47W'fUFòÇ"ÂÆ&VÅÂÇ"²'"ÂÆ&VÅ°¢7Gæ6Æ÷6UF°¢7GæfÆÂ°¢òò&6RFW@¢7GæfÆÅ7GÆRÒr3s°¢7GæföçBÒv&öÆBÖÆR×77FVÒÂÖöæ÷76Rs°¢7GçFWDÆvâÒvÆVgBs°¢7GæfÆÅFWBrBr²Æ7E&6RçFôfVB"ÂÔÂ²5r²bÂÆ&VÅ²2° ¢òò÷&¦öçFÂÆæRg&öÒF÷BFòÆ&VÀ¢7Gç7G&ö¶U7GÆRÒÆæT6öÆ÷#°¢7GæÆæUvGFÒ°¢7Gç6WDÆæTF6³"Â%Ò°¢7Gæ&VvåF°¢7GæÖ÷fUFòÇ²BÂÇ°¢7GæÆæUFòÔÂ²5r²"ÂÇ°¢7Gç7G&ö¶R°¢7Gç6WDÆæTF6µÒ° ¢ÒÂ·&6W2ÂÆö6µ&6RÂ6UÒ° ¢&WGW&â¢ÆFb7GÆS×·²vGF¢sRrÂVvC¢sRrÂÖäVvC¢sr×Óà¢Æ6çf2&Vc×¶6çf5&VgÒ7GÆS×·²vGF¢sRrÂVvC¢sRrÂF7Æ¢v&Æö6²r×Òóà¢ÂöFcà¢°§Ó° ¢òòÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÐ¢òòU%$õ"$õTäD%¢òòÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÐ¦6Æ72W'&÷$&÷VæF'WFVæG2&V7Bä6ö×öæVçB°¢6öç7G'V7F÷"&÷2²7WW"&÷2²F2ç7FFRÒ²4W'&÷#¢fÇ6RÂW'&÷#¢çVÆÂÓ²Ð¢7FF2vWDFW&fVE7FFTg&öÔW'&÷"W'&÷"²&WGW&â²4W'&÷#¢G'VRÂW'&÷"Ó²Ð¢&VæFW"°¢bF2ç7FFRæ4W'&÷"°¢&WGW&â¢ÆFb7GÆS×·²FFæs¢sCrÂ&6¶w&÷VæC¢r3rÂ6öÆ÷#¢r6ffbrÂÖäVvC¢sfr×Óà¢Æ"7GÆS×·²6öÆ÷#¢r6VcCCCBr×ÓäW'&÷#Âö#à¢Ç&R7GÆS×·²6öÆ÷#¢r6f&&c#BrÂföçE6¦S¢s'rÂvFU76S¢w&R×w&r×Óç·F2ç7FFRæW'&÷#òçFõ7G&ærÓÂ÷&Sà¢Æ'WGFöâöä6Æ6³×²ÓâvæF÷ræÆö6Föâç&VÆöBÒ7GÆS×·²Ö&våF÷¢s#rÂFFæs¢s#rÂ&6¶w&÷VæC¢r3#rÂ&÷&FW#¢væöæRrÂ&÷&FW%&FW3¢srÂ6öÆ÷#¢r3r×Óå&VÆöCÂö'WGFöãà¢ÂöFcà¢°¢Ð¢&WGW&âF2ç&÷2æ6ÆG&Vã°¢Ð§Ð ¢òòÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÐ¢òòDTÄTu$Ò4D°¢òòÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÐ¦6öç7BW6UFVÆVw&ÒÒÓâ°¢6öç7B¶5&VGÂ6WD5&VGÒÒW6U7FFRfÇ6R°¢6öç7B¶5FVÆVw&ÒÂ6WD5FVÆVw&ÕÒÒW6U7FFRfÇ6R° ¢W6TVffV7BÓâ°¢6öç7BFrÒvæF÷råFVÆVw&ÓòåvV$°¢bFrbbFrææDFF°¢6WD5FVÆVw&ÒG'VR°¢Frç&VG°¢FræWæB°¢bFræF6&ÆUfW'F6Å7vW2FræF6&ÆUfW'F6Å7vW2°¢Ð¢6WD5&VGG'VR°¢ÒÂµÒ° ¢6öç7BF2ÒW6T6ÆÆ&6²GRÒv×7BrÂ7GÆRÒvÖVFVÒrÓâ°¢G'°¢6öç7BFrÒvæF÷råFVÆVw&ÓòåvV$°¢bFsòäF4fVVF&6²°¢bGRÓÓÒv×7BrFräF4fVVF&6²æ×7Dö67W'&VB7GÆR°¢VÇ6RFräF4fVVF&6²ææ÷Ff6Föäö67W'&VB7GÆR°¢Ð¢Ò6F6R·Ð¢ÒÂµÒ° ¢&WGW&â²5&VGÂF2Â5FVÆVw&ÒÓ°§Ó° ¢òòÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÐ¢òòÔâtÔR4ôÕôäTå@¢òòÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÐ¦6öç7BVÇ6TvÖRÒÓâ°¢6öç7B²5&VGÂF2Â5FVÆVw&ÒÒÒW6UFVÆVw&Ò° ¢6öç7B²÷VâÒÒW6T¶B°¢6öç7B²FG&W72Â46öææV7FVBÒÒW6T¶D66÷VçB°¢6öç7B²6äBÂ7vF6æWGv÷&²ÒÒW6T¶DæWGv÷&²°¢6öç7B²F66öææV7BÒÒW6TF66öææV7B° ¢òòF&V7B%2&Ææ6RfWF6'76W2vvÖG&ç7÷'B77VW2vF7W7FöÒ6ç2¢6öç7B¶&Ææ6RÂ6WD&Ææ6UÒÒW6U7FFR°¢6öç7BfWF6&Ææ6RÒW6T6ÆÆ&6²Óâ°¢bFG&W72²6WD&Ææ6R²&WGW&ã²Ð¢fWF6vGG3¢ò÷'2ÖvVÂ×6WöÆææ¶öæ6âæ6öÒrÂ°¢ÖWFöC¢uõ5BrÀ¢VFW'3¢²t6öçFVçBÕGRs¢vÆ6Föâö§6öârÒÀ¢&öG¢¥4ôâç7G&ævg²§6öç'3¢s"ãrÂC¢ÂÖWFöC¢vWFövWD&Ææ6RrÂ&×3¢¶FG&W72ÂvÆFW7BuÒÒ¢Ò¢çFVâgVæ7Föâ"²&WGW&â"æ§6öâ²Ò¢çFVâgVæ7FöâFF°¢bFFç&W7VÇB°¢f"vVÒ&tçBFFç&W7VÇB°¢f"WFÒçVÖ&W"vVòS°¢6öç6öÆRæÆöruµVÇ6UÒ%2&Ææ6Rf÷"rÂFG&W72Âs¢rÂWFÂtUDr°¢6WD&Ææ6RWF°¢Ð¢Ò¢æ6F6gVæ7FöâR²6öç6öÆRæW'&÷"uµVÇ6UÒ&Ææ6RfWF6W'&÷#¢rÂR²Ò°¢ÒÂ¶FG&W75Ò° ¢W6TVffV7BÓâ°¢fWF6&Ææ6R°¢f"çFW'fÂÒ6WDçFW'fÂfWF6&Ææ6RÂS²òò&Vg&W6WfW'W0¢&WGW&âgVæ7Föâ²6ÆV$çFW'fÂçFW'fÂ²Ó°¢ÒÂ¶fWF6&Ææ6UÒ° ¢f"&VfWF6&Ææ6RÒfWF6&Ææ6S° ¢òòöâÖ6âG&ç67Föâöö·0¢6öç7B²6VæEG&ç67FöâÂFF¢G6Â5VæFæs¢5GVæFærÂW'&÷#¢GW'&÷"Â&W6WC¢&W6WEGÒÒW6U6VæEG&ç67Föâ°¢6öç7B²4ÆöFæs¢5G6öæf&ÖærÂ57V66W73¢5G6öæf&ÖVBÂ4W'&÷#¢5G&WfW'FVBÒÒW6UvDf÷%G&ç67Föå&V6VB²6¢G6Ò°¢6öç7B4öäæ²Ò6äBÓÓÒæµ6WöÆæC° ¢6öç7B·öçG2Â6WEöçG5ÒÒW6U7FFR°¢6öç7B·6RÂ6WE6UÒÒW6U7FFRv&WGFærr°¢6öç7B¶6÷VçFF÷vâÂ6WD6÷VçFF÷våÒÒW6U7FFR#°¢6öç7B·&6RÂ6WE&6UÒÒW6U7FFR°¢6öç7B·6æ6÷E&6RÂ6WE6æ6÷E&6UÒÒW6U7FFRçVÆÂ°¢6öç7B·&÷VæDçVÖ&W"Â6WE&÷VæDçVÖ&W%ÒÒW6U7FFR°¢6öç7B·ööÂÂ6WEööÅÒÒW6U7FFR²W¢ÂF÷vã¢Ò°¢6öç7B¶76WBÂ6WD76WEÒÒW6U7FFRt%D2r°¢6öç7B¶&WBÂ6WD&WEÒÒW6U7FFRçVÆÂ°¢6öç7B¶&WDÖ÷VçBÂ6WD&WDÖ÷VçEÒÒW6U7FFRã°¢6öç7B·&÷VæE&W7VÇBÂ6WE&÷VæE&W7VÇEÒÒW6U7FFRçVÆÂ²òòwWrÂvF÷vârÂçVÆÀ¢6öç7B¶Æ7E&W7VÇG2Â6WDÆ7E&W7VÇG5ÒÒW6U7FFRµÒ²òò'&öb&V6VçB&W7VÇG0¢6öç7B·G7FGW2Â6WEG7FGW5ÒÒW6U7FFRçVÆÂ²òòçVÆÂÂwVæFærrÂv6öæf&ÖærrÂv6öæf&ÖVBrÂvW'&÷"p¢6öç7B·GW'&÷$×6rÂ6WEGW'&÷$×6uÒÒW6U7FFRrr°¢6öç7B·w46öææV7FVBÂ6WEw46öææV7FVEÒÒW6U7FFRfÇ6R°¢6öç7B¶6ÆÕ&÷VæDBÂ6WD6ÆÕ&÷VæDEÒÒW6U7FFRçVÆÂ²òòöâÖ6â&÷VæBBf÷"6ÆÖæp¢6öç7B¶6ÆÕ7FGW2Â6WD6ÆÕ7FGW5ÒÒW6U7FFRçVÆÂ²òòçVÆÂÂwVæFærrÂv6öæf&ÖærrÂv6öæf&ÖVBrÂvW'&÷"p¢6öç7Bw5&VbÒW6U&VbçVÆÂ°¢6öç7B&We6U&VbÒW6U&Vbv&WGFærr°¢6öç7BGGU&VbÒW6U&Vbv&WBr²òòv&WBrÂv6ÆÒp¢6öç7B&We&6U&VbÒW6U&Vb°¢6öç7B·&6TF"Â6WE&6TF%ÒÒW6U7FFRçVÆÂ²òòwWrÂvF÷vârÂçVÆÀ¢6öç7B·&6T¶WÂ6WE&6T¶WÒÒW6U7FFR²òòG&vvW'2&RÖæÖFöâöâ&6R6ævP¢6öç7B·&6T7F÷'Â6WE&6T7F÷'ÒÒW6U7FFRµÒ²òòÆ7B&6W2f÷"6'@¢6öç7B·6÷u&VfW'&ÂÂ6WE6÷u&VfW'&ÅÒÒW6U7FFRfÇ6R°¢6öç7B·&V6VçD&WG2Â6WE&V6VçD&WG5ÒÒW6U7FFRµÒ²òò6ö6ÂfVVC¢··6FRÂÖ÷VçBÂæÖWÕÐ ¢W6TVffV7BÓâ²G'²6öç7BÒÆö6Å7F÷&vRævWDFVÒwVÇ6U÷öçG2r²b6WEöçG2'6TçB²Ò6F6R·ÒÒÂµÒ°¢W6TVffV7BÓâ²G'²Æö6Å7F÷&vRç6WDFVÒwVÇ6U÷öçG2rÂöçG2çFõ7G&ær²Ò6F6R·ÒÒÂ·öçG5Ò° ¢òòG&6²G&ç67FöâÆfV76ÆP¢W6TVffV7BÓâ°¢bGGU&Vbæ7W'&VçBÓÓÒv6ÆÒr°¢òòæFÆR6ÆÒGÆfV76ÆR6W&FVÇ¢b5GVæFær6WD6ÆÕ7FGW2wVæFærr°¢VÇ6Rb5G6öæf&Öær6WD6ÆÕ7FGW2v6öæf&Öærr°¢VÇ6Rb5G6öæf&ÖVB°¢6WD6ÆÕ7FGW2v6öæf&ÖVBr°¢F2væ÷Ff6FöârÂw7V66W72r°¢&VfWF6&Ææ6R°¢6WEFÖV÷WBgVæ7Föâ²6WD6ÆÕ7FGW2çVÆÂ²&W6WEG²GGU&Vbæ7W'&VçBÒv&WBs²ÒÂ3°¢ÒVÇ6Rb5G&WfW'FVB°¢6WD6ÆÕ7FGW2vW'&÷"r°¢F2væ÷Ff6FöârÂvW'&÷"r°¢6WEFÖV÷WBgVæ7Föâ²6WD6ÆÕ7FGW2çVÆÂ²&W6WEG²GGU&Vbæ7W'&VçBÒv&WBs²ÒÂ3°¢Ð¢&WGW&ã°¢Ð¢òòæ÷&ÖÂ&WBGÆfV76ÆP¢b5GVæFær6WEG7FGW2wVæFærr°¢VÇ6Rb5G6öæf&Öær6WEG7FGW2v6öæf&Öærr°¢VÇ6Rb5G6öæf&ÖVB°¢6WEG7FGW2v6öæf&ÖVBr°¢òòv&BöçG2æB&VfWF6&Ææ6RgFW"6öæf&ÖFöà¢6WEöçG2gVæ7Föâ²&WGW&â²ÖFæfÆö÷"&WDÖ÷VçB¢²Ò°¢F2væ÷Ff6FöârÂw7V66W72r°¢&VfWF6&Ææ6R°¢òò6ÆV"gFW"26V6öæG0¢6WEFÖV÷WBgVæ7Föâ²6WEG7FGW2çVÆÂ²6WD&WBçVÆÂ²&W6WEG²ÒÂ3°¢ÒVÇ6Rb5G&WfW'FVB°¢6WEG7FGW2vW'&÷"r°¢6WEGW'&÷$×6ruG&ç67Föâ&WfW'FVBöâÖ6âr°¢F2væ÷Ff6FöârÂvW'&÷"r°¢6WEFÖV÷WBgVæ7Föâ²6WEG7FGW2çVÆÂ²6WD&WBçVÆÂ²6WEGW'&÷$×6rrr²&W6WEG²ÒÂ3°¢Ð¢ÒÂ¶5GVæFærÂ5G6öæf&ÖærÂ5G6öæf&ÖVBÂ5G&WfW'FVEÒ° ¢òòæFÆRG&ç67FöâW'&÷'0¢W6TVffV7BÓâ°¢bGW'&÷"°¢f"×6rÒGW'&÷"ç6÷'DÖW76vRÇÂGW'&÷"æÖW76vRÇÂuG&ç67FöâfÆVBs°¢b×6rææ6ÇVFW2uW6W"&V¦V7FVBrÇÂ×6rææ6ÇVFW2wW6W"&V¦V7FVBr×6rÒuG&ç67Föâ&V¦V7FVBs°¢VÇ6Rb×6rææ6ÇVFW2vç7Vff6VçBgVæG2r×6rÒtç7Vff6VçB&Ææ6Rs°¢6WEGW'&÷$×6r×6r°¢6WEG7FGW2vW'&÷"r°¢F2væ÷Ff6FöârÂvW'&÷"r°¢6WEFÖV÷WBgVæ7Föâ²6WEG7FGW2çVÆÂ²6WD&WBçVÆÂ²6WEGW'&÷$×6rrr²&W6WEG²ÒÂ3°¢Ð¢ÒÂ·GW'&÷%Ò° ¢òò&W6WB&WBvVâæWr&÷VæB7F'G2²G&6²&÷VæB7F÷'¢W6TVffV7BÓâ°¢b6RÓÓÒv&WGFærrbb&We6U&Vbæ7W'&VçBÓÒv&WGFærr°¢òòæWr&÷VæB7F'FVB(	B6fR&Wf÷W2&W7VÇBFò7F÷'¢b&÷VæE&W7VÇB°¢6WDÆ7E&W7VÇG2gVæ7Föâ&Wb²&WGW&â·&÷VæE&W7VÇEÒæ6öæ6B&Wbç6Æ6RÂ²Ò°¢Ð¢òò6ÆV"&Wf÷W2&W@¢bG7FGW2²6WD&WBçVÆÂ²Ð¢6WE&÷VæE&W7VÇBçVÆÂ°¢6WD6ÆÕ&÷VæDBçVÆÂ°¢6WD6ÆÕ7FGW2çVÆÂ°¢Ð¢b6RÓÓÒw&W7VÇG2rÇÂ6RÓÓÒw&W6öÇfærr°¢òò&÷VæB&W6öÇfVB(	BFWFW&ÖæR&W7VÇ@¢b6æ6÷E&6Rbb&6R°¢f"&W2Ò&6Râ6æ6÷E&6RòwWr¢vF÷vâs°¢6WE&÷VæE&W7VÇB&W2°¢Ð¢Ð¢&We6U&Vbæ7W'&VçBÒ6S°¢ÒÂ·6UÒ° ¢W6TVffV7BÓâ°¢ÆWBFÖV÷WC²ÆWBÖ÷VçFVBÒG'VS°¢6öç7B6öææV7Eu2ÒÓâ°¢bÖ÷VçFVB&WGW&ã°¢G'°¢6öç7Bw2ÒæWrvV%6ö6¶WBu5õU$Â°¢w5&Vbæ7W'&VçBÒw3°¢w2æöæ÷VâÒÓâ²bÖ÷VçFVB²6WEw46öææV7FVBG'VR²w2ç6VæB¥4ôâç7G&ævg²GS¢w7V'67&&RrÂ76WC¢t%D2rÒ²×Ó°¢w2æöæÖW76vRÒRÓâ°¢bÖ÷VçFVB&WGW&ã°¢G'°¢6öç7BBÒ¥4ôâç'6RRæFF° ¢òòæFÆRvÖU7FFR6VçBWfW'6V6öæB'&6¶VæB¢bBçGRÓÓÒvvÖU7FFRrbbBæFF°¢f"rÒBæFF°¢bræ7W'&VçE&6R°¢b&We&6U&Vbæ7W'&VçBbbræ7W'&VçE&6RÓÒ&We&6U&Vbæ7W'&VçB°¢6WE&6TF"ræ7W'&VçE&6Râ&We&6U&Vbæ7W'&VçBòwWr¢vF÷vâr°¢6WE&6T¶WgVæ7Föâ²²&WGW&â²²²Ò°¢Ð¢&We&6U&Vbæ7W'&VçBÒræ7W'&VçE&6S°¢6WE&6Rræ7W'&VçE&6R°¢6WE&6T7F÷'gVæ7Föâ&Wb²&WGW&â&Wbæ6öæ6B¶ræ7W'&VçE&6UÒç6Æ6RÓ²Ò°¢Ð¢brç6R6WE6Rrç6R°¢bræ6÷VçFF÷vâÓÒVæFVfæVB6WD6÷VçFF÷vâræ6÷VçFF÷vâ°¢brç6æ6÷E&6R6WE6æ6÷E&6Rrç6æ6÷E&6R°¢brç&÷VæDçVÖ&W"6WE&÷VæDçVÖ&W"rç&÷VæDçVÖ&W"°¢brçööÂ6WEööÂrçööÂ°¢bræ76WB6WD76WBræ76WB°¢bræ&WG2bbræ&WG2ç&V6VçD&WG26WE&V6VçD&WG2ræ&WG2ç&V6VçD&WG2°¢Ð ¢òòæFÆR&6RF6·26VçBWfW'S×2¢bBçGRÓÓÒw&6RrbbBæFF°¢6WE&6RBæFFç&6RÇÂBç&6R°¢ÒVÇ6RbBçGRÓÓÒw&6RrbbBç&6R°¢6WE&6RBç&6R°¢Ð ¢òòæFÆRööÂWFFW0¢bBçGRÓÓÒwööÅWFFRrbbBæFF°¢6WEööÂBæFFçööÂÇÂBæFF°¢Ð ¢Ò6F6W'"·Ð¢Ó°¢w2æöæ6Æ÷6RÒÓâ²bÖ÷VçFVB²6WEw46öææV7FVBfÇ6R²FÖV÷WBÒ6WEFÖV÷WB6öææV7Eu2Â3²×Ó°¢Ò6F6R²bÖ÷VçFVBFÖV÷WBÒ6WEFÖV÷WB6öææV7Eu2Â3²Ð¢Ó°¢6öææV7Eu2°¢&WGW&âÓâ²Ö÷VçFVBÒfÇ6S²w5&Vbæ7W'&VçCòæ6Æ÷6R²6ÆV%FÖV÷WBFÖV÷WB²Ó°¢ÒÂµÒ° ¢òòfWF6öâÖ6â7W'&VçE&÷VæBfF&V7B%0¢6öç7BfWF6öä6å&÷VæBÒW6T6ÆÆ&6²Óâ°¢f"6ÆÄFFÒVæ6öFTgVæ7FöäFF²&¢TÅ4Uô$ÂgVæ7FöäæÖS¢v7W'&VçE&÷VæBrÂ&w3¢µÒÒ°¢&WGW&âfWF6vGG3¢ò÷'2ÖvVÂ×6WöÆææ¶öæ6âæ6öÒrÂ°¢ÖWFöC¢uõ5BrÀ¢VFW'3¢²t6öçFVçBÕGRs¢vÆ6Föâö§6öârÒÀ¢&öG¢¥4ôâç7G&ævg²§6öç'3¢s"ãrÂC¢"ÂÖWFöC¢vWFö6ÆÂrÂ&×3¢·²Fó¢4ôåE$5EôDE$U52ÂFF¢6ÆÄFFÒÂvÆFW7BuÒÒ¢Ò¢çFVâgVæ7Föâ"²&WGW&â"æ§6öâ²Ò¢çFVâgVæ7Föâ&W7²&WGW&â&W7ç&W7VÇBòçVÖ&W"&tçB&W7ç&W7VÇB¢çVÆÃ²Ò¢æ6F6gVæ7FöâR²6öç6öÆRæW'&÷"uµVÇ6UÒfWF6öä6å&÷VæBW'&÷#¢rÂR²&WGW&âçVÆÃ²Ò°¢ÒÂµÒ° ¢6öç7BÆ6T&WBÒF"Óâ°¢b6RÓÒv&WGFærrÇÂ&WBÇÂG7FGW2&WGW&ã°¢b46öææV7FVB²÷Vâ²&WGW&ã²Ð¢b4öäæ²²7vF6æWGv÷&²æµ6WöÆ²&WGW&ã²Ð¢b&WDÖ÷VçBâ&Ææ6R²ÆW'Btç7Vff6VçB&Ææ6Rr²&WGW&ã²Ð ¢F2v×7BrÂvÖVFVÒr°¢6WD&WBF"°¢6WEG7FGW2wVæFærr°¢6WEGW'&÷$×6rrr°¢GGU&Vbæ7W'&VçBÒv&WBs° ¢òòfWF6öâÖ6â&÷VæBB6òvR6â6ÆÒÆFW ¢fWF6öä6å&÷VæBçFVâgVæ7Föâ&B°¢b&B²6WD6ÆÕ&÷VæDB&B²6öç6öÆRæÆöruµVÇ6UÒ&WGFæröâöâÖ6â&÷VæBrÂ&B²Ð¢Ò° ¢G'°¢f"FFÒVæ6öFTgVæ7FöäFF°¢&¢TÅ4Uô$À¢gVæ7FöäæÖS¢wÆ6T&WBrÀ¢&w3¢¶F"ÓÓÒwWrò¢%ÒÀ¢Ò° ¢6VæEG&ç67Föâ°¢Fó¢4ôåE$5EôDE$U52À¢FF¢FFÀ¢fÇVS¢'6TWFW"&WDÖ÷VçBçFõ7G&ærÀ¢Ò°¢Ò6F6R°¢6öç6öÆRæW'&÷"uµVÇ6UÒÆ6T&WBW'&÷#¢rÂR°¢6WEG7FGW2vW'&÷"r°¢6WEGW'&÷$×6rRæÖW76vRÇÂtfÆVBFò6VæBG&ç67Föâr°¢6WEFÖV÷WBgVæ7Föâ²6WEG7FGW2çVÆÂ²6WD&WBçVÆÂ²6WEGW'&÷$×6rrr²ÒÂ3°¢Ð¢Ó° ¢6öç7B6ÆÕvæææw2ÒÓâ°¢b6ÆÕ&÷VæDBÇÂ6ÆÕ7FGW2&WGW&ã°¢GGU&Vbæ7W'&VçBÒv6ÆÒs°¢6WD6ÆÕ7FGW2wVæFærr° ¢G'°¢f"FFÒVæ6öFTgVæ7FöäFF°¢&¢TÅ4Uô$À¢gVæ7FöäæÖS¢v6ÆÒrÀ¢&w3¢´&tçB6ÆÕ&÷VæDBÒÀ¢Ò° ¢6VæEG&ç67Föâ°¢Fó¢4ôåE$5EôDE$U52À¢FF¢FFÀ¢Ò°¢Ò6F6R°¢6öç6öÆRæW'&÷"uµVÇ6UÒ6ÆÒW'&÷#¢rÂR°¢6WD6ÆÕ7FGW2vW'&÷"r°¢6WEFÖV÷WBgVæ7Föâ²6WD6ÆÕ7FGW2çVÆÂ²ÒÂ3°¢Ð¢Ó° ¢b5&VG°¢&WGW&â¢ÆFb7GÆS×·²VvC¢sfrÂ&6¶w&÷VæC¢w&FÂÖw&FVçBVÆÆ6RBSRRÂ3BRÂ3cRrÂF7Æ¢vfÆWrÂÆväFV×3¢v6VçFW"rÂ§W7Fg6öçFVçC¢v6VçFW"r×Óà¢ÆFb7GÆS×·²FWDÆvã¢v6VçFW"r×Óà¢ÆFb7GÆS×·²Ö&vã¢sWFògrÂæÖFöã¢wVÇ6TvÆ÷r'2æfæFRrÂ&÷&FW%&FW3¢sgrÂvGF¢sSgrÂVvC¢sSgrÂF7Æ¢vfÆWrÂÆväFV×3¢v6VçFW"rÂ§W7Fg6öçFVçC¢v6VçFW"r×ÓãÅVÇ6TÆövò6¦S×³SgÒóãÂöFcà¢ÆFb7GÆS×·²6öÆ÷#¢r3#rÂföçE6¦S¢srÂföçEvVvC¢scrÂÆWGFW%76æs¢sGr×ÓåTÅ4SÂöFcà¢ÂöFcà¢ÂöFcà¢°¢Ð ¢6öç7BWF&ÂÒ&Ææ6Rò&Ææ6RçFôfVBB¢ss°¢6öç7B6÷'DFG&W72ÒFG&W72òG¶FG&W72ç6Æ6RÃbÒâââG¶FG&W72ç6Æ6RÓBÖ¢rs°¢6öç7B&WGFæt7FfRÒ6RÓÓÒv&WGFærrbb&WBbbG7FGW3°¢6öç7BÖ6÷VçFF÷vâÒ6RÓÓÒv&WGFærrò#¢6RÓÓÒvÆö6¶VBrò¢6RÓÓÒw&W6öÇfærròR¢S°¢6öç7B6÷VçFF÷vå7BÒÖ6÷VçFF÷vââò6÷VçFF÷vâòÖ6÷VçFF÷vâ¢°¢6öç7B&æu"Ò##°¢6öç7B&æt2Ò"¢ÖFå¢&æu#° ¢&WGW&â¢ÆFb7GÆS×·²VvC¢sfrÂÖVvC¢sfrÂ÷fW&fÆ÷s¢vWFòrÂ&6¶w&÷VæC¢w&FÂÖw&FVçBVÆÆ6RBSRRÂ3cc"RÂ3sRrÂ6öÆ÷#¢r6ffbrÂföçDfÖÇ¢rÖÆR×77FVÒÂ&Ææ´Ö577FVÔföçBÂ6ç2×6W&brÂF7Æ¢vfÆWrÂfÆWF&V7Föã¢v6öÇVÖâr×Óà¢Ç7GÆSçµTÅ4Uõ5EÄU7ÓÂ÷7GÆSà ¢²ò¢ÓÓÓÓÒTDU"$"ÓÓÓÓÒ¢÷Ð¢ÆFb7GÆS×·²FFæs¢sGrÂF7Æ¢vfÆWrÂ§W7Fg6öçFVçC¢w76RÖ&WGvVVârÂÆväFV×3¢v6VçFW"rÂfÆW6&æ³¢×Óà¢ÆFb7GÆS×·²F7Æ¢vfÆWrÂÆväFV×3¢v6VçFW"rÂv¢sr×Óà¢ÅVÇ6TÆövò6¦S×³#Òóà¢Ç7â7GÆS×·²föçEvVvC¢ssrÂföçE6¦S¢sWr×ÓåVÇ6SÂ÷7ãà¢Ç7â7GÆS×·²föçE6¦S¢srÂ&6¶w&÷VæC¢w&v&#SÃÃ3bÃã"rÂ6öÆ÷#¢r6f&&c#BrÂFFæs¢s'grÂ&÷&FW%&FW3¢srÂföçEvVvC¢scrÂÆWGFW%76æs¢sr×ÓåDU5DäUCÂ÷7ãà¢ÂöFcà¢¶46öææV7FVBò¢ÆFb7GÆS×·²F7Æ¢vfÆWrÂv¢sgrÂÆväFV×3¢v6VçFW"r×Óà¢ÆFb7GÆS×·²F7Æ¢vfÆWrÂÆväFV×3¢v6VçFW"rÂv¢sGr×Óà¢Ç7â7GÆS×·²vGF¢sWrÂVvC¢sWrÂ&÷&FW%&FW3¢sSRrÂ&6¶w&÷VæC¢w46öææV7FVBòr3#r¢r6VcCCCBrÂæÖFöã¢w46öææV7FVBòv'&VFR'2æfæFRr¢væöæRr×ÓãÂ÷7ãà¢Ç7â7GÆS×·²föçE6¦S¢srÂ6öÆ÷#¢r3f#s#r×Óå"7·&÷VæDçVÖ&W'ÓÂ÷7ãà¢ÂöFcà¢Æ'WGFöâöä6Æ6³×²Óâ÷Vâ²fWs¢t66÷VçBrÒÒ7GÆS×·²FFæs¢sGrÂ&÷&FW%&FW3¢sGrÂföçEvVvC¢scrÂ6öÆ÷#¢r3#rÂ&÷&FW#¢s6öÆB&v&bÃRÃ#ÃãRrÂ7W'6÷#¢wöçFW"rÂföçE6¦S¢srÂ&6¶w&÷VæC¢w&v&bÃRÃ#Ããbr×Óà¢¶WF&ÇÒUD¢Âö'WGFöãà¢Æ'WGFöâöä6Æ6³×²Óâ²G'²F66öææV7B²ö&¦V7Bæ¶W2Æö6Å7F÷&vRæfÇFW"gVæ7Föâ²²&WGW&â²ç7F'G5vFwv4rÇÂ²ç7F'G5vFts6ÒrÇÂ²ç7F'G5vFus4Òr²Òæf÷$V6gVæ7Föâ²²Æö6Å7F÷&vRç&VÖ÷fTFVÒ²²Ò²Ò6F6R²væF÷ræÆö6Föâç&VÆöB²Ò×Ò7GÆS×·²&6¶w&÷VæC¢w&v&#3ÃcÃcÃãrÂFFæs¢sGrÂ&÷&FW%&FW3¢sGrÂ6öÆ÷#¢r6VcCCCBrÂ&÷&FW#¢s6öÆB&v&#3ÃcÃcÃãrÂ7W'6÷#¢wöçFW"rÂföçE6¦S¢sr×Óà¢)ÉP¢Âö'WGFöãà¢ÂöFcà¢¢¢Æ'WGFöâöä6Æ6³×²Óâ÷Vâ²fWs¢t6öææV7BrÒÒ7GÆS×·²FFæs¢sggrÂ&÷&FW%&FW3¢sGrÂ&÷&FW#¢væöæRrÂ&6¶w&÷VæC¢vÆæV"Öw&FVçB3VFVrÂ3#Â3SccrÂ6öÆ÷#¢r6ffbrÂföçEvVvC¢ssrÂföçE6¦S¢s'rÂ7W'6÷#¢wöçFW"r×Óà¢6öææV7@¢Âö'WGFöãà¢Ð¢ÂöFcà ¢²ò¢ÓÓÓÓÒ4ôääT5B$ôÕBöæÇvVâæ÷B6öææV7FVBÓÓÓÓÒ¢÷Ð¢²46öææV7FVBbb¢ÆFb7GÆS×·²fÆW¢ÂF7Æ¢vfÆWrÂÆväFV×3¢v6VçFW"rÂ§W7Fg6öçFVçC¢v6VçFW"rÂFFæs¢s#r×Óà¢ÆFb7GÆS×·²FWDÆvã¢v6VçFW"rÂÖvGF¢s3#r×Óà¢ÆFb7GÆS×·²Ö&vã¢sWFò#r×ÓãÅVÇ6TÆövò6¦S×³cGÒóãÂöFcà¢ÆFb7GÆS×·²föçE6¦S¢s#'rÂföçEvVvC¢srÂÖ&vä&÷GFöÓ¢sr×Óå&VF7B%D2âvâUDãÂöFcà¢ÆFb7GÆS×·²6öÆ÷#¢r3f#s#rÂföçE6¦S¢s7rÂÖ&vä&÷GFöÓ¢s#GrÂÆæTVvC¢sãRr×Óã×6V6öæB&VF7Föâ&÷VæG2âöâÖ6â&WG2âV&âETÅ4RöçG2ãÂöFcà¢Æ'WGFöâöä6Æ6³×²Óâ÷Vâ²fWs¢t6öææV7BrÒÒ7GÆS×·²vGF¢sRrÂFFæs¢sgrÂ&÷&FW%&FW3¢sGrÂ&÷&FW#¢væöæRrÂ&6¶w&÷VæC¢vÆæV"Öw&FVçB3VFVrÂ3#Â3SccrÂ6öÆ÷#¢r6ffbrÂföçEvVvC¢ssrÂföçE6¦S¢sgrÂ7W'6÷#¢wöçFW"rÂ&÷6F÷s¢sG#G&v&bÃRÃ#Ãã2r×Óà¢6öææV7BvÆÆWBFòÆ¢Âö'WGFöãà¢¶5FVÆVw&Òbb¢Æ'WGFöâöä6Æ6³×²Óâ²G'²væF÷råFVÆVw&ÒåvV$æ÷VäÆæ²vGG3¢ò÷VÇ6V&WBægVâr²Ò6F6R²væF÷ræ÷VâvGG3¢ò÷VÇ6V&WBægVârÂuö&Ææ²r²Ò×Ò7GÆS×·²vGF¢sRrÂÖ&våF÷¢srÂFFæs¢s'rÂ&÷&FW%&FW3¢s'rÂ&÷&FW#¢s6öÆB&v&#SRÃ#SRÃ#SRÃãbrÂ&6¶w&÷VæC¢wG&ç7&VçBrÂ6öÆ÷#¢r3f#s#rÂföçE6¦S¢s'rÂ7W'6÷#¢wöçFW"r×Óà¢÷Vââ'&÷w6W ¢Âö'WGFöãà¢Ð¢ÂöFcà¢ÂöFcà¢Ð ¢²ò¢ÓÓÓÓÒu$ôäräUEtõ$²òÄõr$Ää4RÓÓÓÓÒ¢÷Ð¢¶46öææV7FVBbb4öäæ²bb¢ÆFb7GÆS×·²FFæs¢s#rÂFWDÆvã¢v6VçFW"r×Óà¢ÆFb7GÆS×·²6öÆ÷#¢r6f&&c#BrÂföçEvVvC¢scrÂÖ&vä&÷GFöÓ¢sr×Óåw&öæræWGv÷&³ÂöFcà¢Æ'WGFöâöä6Æ6³×²Óâ7vF6æWGv÷&²æµ6WöÆÒ7GÆS×·²FFæs¢s'#rÂ&÷&FW%&FW3¢s'rÂ&÷&FW#¢væöæRrÂ&6¶w&÷VæC¢r6f&&c#BrÂ6öÆ÷#¢r3rÂföçEvVvC¢ssrÂ7W'6÷#¢wöçFW"r×Óå7vF6Fòæ²6WöÆÂö'WGFöãà¢ÂöFcà¢Ð¢¶46öææV7FVBbb4öäæ²bb&Ææ6RÂãbb¢ÆFb7GÆS×·²FFæs¢s#rÂFWDÆvã¢v6VçFW"r×Óà¢ÆFb7GÆS×·²6öÆ÷#¢r6VcCCCBrÂföçEvVvC¢scrÂÖ&vä&÷GFöÓ¢sr×ÓäæVVBFW7FæWBUDÂöFcà¢ÆFb7GÆS×·²F7Æ¢vfÆWrÂv¢srÂ§W7Fg6öçFVçC¢v6VçFW"r×Óà¢Æ'WGFöâöä6Æ6³×²ÓâvæF÷ræ÷VâvGG3¢òöæ¶öæ6âæ6öÒöfV6WBrÂuö&Ææ²rÒ7GÆS×·²FFæs¢s#rÂ&÷&FW%&FW3¢s'rÂ&÷&FW#¢væöæRrÂ&6¶w&÷VæC¢r6VcCCCBrÂ6öÆ÷#¢r6ffbrÂföçEvVvC¢scrÂ7W'6÷#¢wöçFW"rÂföçE6¦S¢s'r×ÓävWBUDÂö'WGFöãà¢Æ'WGFöâöä6Æ6³×²Óâ&VfWF6&Ææ6RÒ7GÆS×·²FFæs¢s#rÂ&÷&FW%&FW3¢s'rÂ&÷&FW#¢s6öÆB&v&#SRÃ#SRÃ#SRÃãrÂ&6¶w&÷VæC¢wG&ç7&VçBrÂ6öÆ÷#¢r3f#s#rÂföçEvVvC¢scrÂ7W'6÷#¢wöçFW"rÂföçE6¦S¢s'r×Óå&Vg&W6Âö'WGFöãà¢ÂöFcà¢ÂöFcà¢Ð ¢²ò¢ÓÓÓÓÒÔâtÔR6öææV7FVB²öâæ²²2&Ææ6RÓÓÓÓÒ¢÷Ð¢¶46öææV7FVBbb4öäæ²bb&Ææ6RãÒãbb¢Ãà¢²ò¢4%B(	BF¶W2Ö÷7BöbFR67&VVâ¢÷Ð¢ÆFb7GÆS×·²fÆW¢ÂÖäVvC¢ÂFFæs¢sGrÂF7Æ¢vfÆWrÂfÆWF&V7Föã¢v6öÇVÖâr×Óà¢²ò¢&÷VæB7F÷'7G&¢÷Ð¢¶Æ7E&W7VÇG2æÆVæwFâbb¢ÆFb7GÆS×·²F7Æ¢vfÆWrÂÆväFV×3¢v6VçFW"rÂ§W7Fg6öçFVçC¢v6VçFW"rÂv¢s'rÂFFæs¢sGrÂfÆW6&æ³¢×Óà¢¶Æ7E&W7VÇG2æÖgVæ7Föâ"Â°¢&WGW&â¢ÆFb¶W×¶Ò7GÆS×·²vGF¢sgrÂVvC¢sgrÂ&÷&FW%&FW3¢sGrÂ&6¶w&÷VæC¢"ÓÓÒwWròw&v&bÃRÃ#ÃãRr¢w&v&#3ÃcÃcÃãRrÂ&÷&FW#¢"ÓÓÒwWròs6öÆB&v&bÃRÃ#Ãã2r¢s6öÆB&v&#3ÃcÃcÃã2rÂF7Æ¢vfÆWrÂÆväFV×3¢v6VçFW"rÂ§W7Fg6öçFVçC¢v6VçFW"rÂföçE6¦S¢swrÂ6öÆ÷#¢"ÓÓÒwWròr3#r¢r6VcCCCBrÂföçEvVvC¢ssr×Óà¢·"ÓÓÒwWrò~)k"r¢~)kÂwÐ¢ÂöFcà¢°¢ÒÐ¢ÂöFcà¢Ð ¢²ò¢6'B¢÷Ð¢ÆFb7GÆS×·²fÆW¢ÂÖäVvC¢srÂ&÷&FW%&FW3¢sGrÂ÷fW&fÆ÷s¢vFFVârÂ&6¶w&÷VæC¢w&v&#SRÃ#SRÃ#SRÃãRrÂ&÷&FW#¢s6öÆB&v&#SRÃ#SRÃ#SRÃãBr×Óà¢Å&6T6'B&6W3×·&6T7F÷'ÒÆö6µ&6S×·6æ6÷E&6WÒ6S×·6WÒ&÷VæE&W7VÇC×·&÷VæE&W7VÇGÒóà¢ÂöFcà¢ÂöFcà ¢²ò¢4ô4ÂdTTB(	B&V6VçB&WG2g&öÒ÷FW"ÆW'2¢÷Ð¢·&V6VçD&WG2æÆVæwFâbb¢ÆFb7GÆS×·²FFæs¢srÂfÆW6&æ³¢Â÷fW&fÆ÷s¢vFFVâr×Óà¢ÆFb7GÆS×·²F7Æ¢vfÆWrÂv¢sgrÂ÷fW&fÆ÷u¢vWFòrÂ67&öÆÆ&%vGF¢væöæRrÂvV&¶D÷fW&fÆ÷u67&öÆÆæs¢wF÷V6rÂFFæs¢s7r×Óà¢·&V6VçD&WG2ç6Æ6RÂæÖgVæ7Föâ"Â°¢f"5WÒ"ç6FRÓÓÒwWs°¢&WGW&â¢ÆFb¶W×¶Ò7GÆS×·²fÆW6&æ³¢ÂF7Æ¢vfÆWrÂÆväFV×3¢v6VçFW"rÂv¢sGrÂFFæs¢s7rÂ&÷&FW%&FW3¢srÂ&6¶w&÷VæC¢5Wòw&v&bÃRÃ#Ããbr¢w&v&#3ÃcÃcÃãbrÂ&÷&FW#¢5Wòs6öÆB&v&bÃRÃ#Ãã"r¢s6öÆB&v&#3ÃcÃcÃã"rÂæÖFöã¢vfFTâã72V6Rr×Óà¢Ç7â7GÆS×·²föçE6¦S¢sr×Óç¶5Wò	ùú"r¢	ùKBwÓÂ÷7ãà¢Ç7â7GÆS×·²föçE6¦S¢srÂ6öÆ÷#¢r366brÂföçDfÖÇ¢vÖöæ÷76Rr×Óç¶"ææÖRÇÂsóóòwÓÂ÷7ãà¢Ç7â7GÆS×·²föçE6¦S¢srÂföçEvVvC¢ssrÂ6öÆ÷#¢5Wòr3#r¢r6VcCCCBr×Óç¶"æÖ÷VçGÒ¶5WòuUr¢tDâwÓÂ÷7ãà¢ÂöFcà¢°¢ÒÐ¢ÂöFcà¢ÂöFcà¢Ð ¢²ò¢$4R$õr²4õTåDDõtâ¢÷Ð¢ÆFb7GÆS×·²F7Æ¢vfÆWrÂ§W7Fg6öçFVçC¢w76RÖ&WGvVVârÂÆväFV×3¢v6VçFW"rÂFFæs¢sGrÂfÆW6&æ³¢×Óà¢ÆFcà¢ÆFb7GÆS×·²föçE6¦S¢srÂ6öÆ÷#¢r3F#SSc2rÂÆWGFW%76æs¢sãWr×Óç¶76WGÒõU4CÂöFcà¢ÆFb¶W×·&6T¶WÒ7GÆS×·²föçE6¦S¢s#GrÂföçEvVvC¢srÂÆWGFW%76æs¢rÓrÂÆæTVvC¢ÂæÖFöã¢&6TF"ò&6TF"ÓÓÒwWròw&6TfÆ6w&VVâãW2V6RÖ÷WBr¢w&6TfÆ6&VBãW2V6RÖ÷WBr¢væöæRr×Óà¢·&6RâòrBr²&6RçFôÆö6ÆU7G&ærvVâÕU2rÂ²Öæ×VÔg&7FöäFvG3¢"ÂÖ×VÔg&7FöäFvG3¢"Ò¢râââwÐ¢ÂöFcà¢·6æ6÷E&6Rbb6RÓÒv&WGFærrbb¢ÆFb7GÆS×·²F7Æ¢vfÆWrÂÆväFV×3¢v6VçFW"rÂv¢sgrÂÖ&våF÷¢s'r×Óà¢Ç7â7GÆS×·²föçE6¦S¢srÂ6öÆ÷#¢r3f#s#r×ÓäVçG'G·6æ6÷E&6RçFôÆö6ÆU7G&ærvVâÕU2rÂ²Öæ×VÔg&7FöäFvG3¢"ÂÖ×VÔg&7FöäFvG3¢"ÒÓÂ÷7ãà¢Ç7â7GÆS×·²föçE6¦S¢s'rÂföçEvVvC¢srÂFFæs¢sgrÂ&÷&FW%&FW3¢sgrÂ&6¶w&÷VæC¢&6RãÒ6æ6÷E&6Ròw&v&bÃRÃ#Ãã"r¢w&v&#3ÃcÃcÃã"rÂ6öÆ÷#¢&6RãÒ6æ6÷E&6Ròr3#r¢r6VcCCCBrÂ&÷&FW#¢&6RãÒ6æ6÷E&6Ròs6öÆB&v&bÃRÃ#Ãã#Rr¢s6öÆB&v&#3ÃcÃcÃã#Rr×Óà¢²Óâ²f"FfbÒ&6RÒ6æ6÷E&6S²&WGW&âFfbãÒòr²Br¢rÒBr²ÖFæ'2FfbçFôÆö6ÆU7G&ærvVâÕU2rÂ²Öæ×VÔg&7FöäFvG3¢"ÂÖ×VÔg&7FöäFvG3¢"Ò²ÒÐ¢Â÷7ãà¢ÂöFcà¢Ð¢ÂöFcà ¢²ò¢6ö×7B6&7VÆ"6÷VçFF÷vâ¢÷Ð¢ÆFb7GÆS×·²F7Æ¢vfÆWrÂÆväFV×3¢v6VçFW"rÂv¢sr×Óà¢²ò¢vâôÆ÷72&FvR¢÷Ð¢¶&WBbb6RÓÓÒw&W7VÇG2rbb&÷VæE&W7VÇBbb¢ÆFb7GÆS×·²FFæs¢sG'rÂ&÷&FW%&FW3¢srÂföçE6¦S¢s'rÂföçEvVvC¢srÂæÖFöã¢w6ÆFTâã72V6RrÂ&6¶w&÷VæC¢&WBÓÓÒ&÷VæE&W7VÇBòw&v&bÃRÃ#ÃãRr¢w&v&#3ÃcÃcÃãRrÂ6öÆ÷#¢&WBÓÓÒ&÷VæE&W7VÇBòr3#r¢r6VcCCCBrÂ&÷&FW#¢&WBÓÓÒ&÷VæE&W7VÇBòs6öÆB&v&bÃRÃ#Ãã2r¢s6öÆB&v&#3ÃcÃcÃã2r×Óà¢¶&WBÓÓÒ&÷VæE&W7VÇBòutôâr¢tÄõ5BwÐ¢ÂöFcà¢Ð ¢ÆFb7GÆS×·²÷6Föã¢w&VÆFfRrÂvGF¢sSGrÂVvC¢sSGr×Óà¢Ç7frvGFÒ#SB"VvCÒ#SB"7GÆS×·²G&ç6f÷&Ó¢w&÷FFRÓFVrr×Óà¢Æ6&6ÆR7Ò##r"7Ò##r"#×·&æu'ÒfÆÃÒ&æöæR"7G&ö¶SÒ'&v&#SRÃ#SRÃ#SRÃãB"7G&ö¶UvGFÒ#2"óà¢Æ6&6ÆR7Ò##r"7Ò##r"#×·&æu'ÒfÆÃÒ&æöæR ¢7G&ö¶S×·6RÓÓÒv&WGFærròr3#r¢6RÓÓÒw&W7VÇG2rò&÷VæE&W7VÇBÓÓÒwWròr3#r¢r6VcCCCBr¢r6f&&c#BwÐ¢7G&ö¶UvGFÒ#2"7G&ö¶TÆæV6Ò'&÷VæB ¢7G&ö¶TF6'&×·&æt7Ò7G&ö¶TF6öfg6WC×·&æt2¢Ò6÷VçFF÷vå7BÐ¢7GÆS×·²G&ç6Föã¢w7G&ö¶RÖF6öfg6WB2ÆæV"Â7G&ö¶Rã72r×Ð¢óà¢Â÷7fsà¢ÆFb7GÆS×·²÷6Föã¢v'6öÇWFRrÂç6WC¢ÂF7Æ¢vfÆWrÂfÆWF&V7Föã¢v6öÇVÖârÂÆväFV×3¢v6VçFW"rÂ§W7Fg6öçFVçC¢v6VçFW"r×Óà¢·6RÓÓÒw&W7VÇG2rò¢Ç7â7GÆS×·²föçE6¦S¢sr×Óç·&÷VæE&W7VÇBÓÓÒwWrò	ù8r¢	ù8wÓÂ÷7ãà¢¢¢Ç7â7GÆS×·²föçE6¦S¢srÂföçEvVvC¢srÂ6öÆ÷#¢6RÓÓÒv&WGFærròr3#r¢r6f&&c#BrÂæÖFöã¢6÷VçFF÷vâÃÒ2bb6RÓÓÒv&WGFærròv6÷VçFF÷våVÇ6RãW2æfæFRr¢væöæRr×Óç¶6÷VçFF÷vçÓÂ÷7ãà¢Ð¢ÂöFcà¢ÂöFcà ¢ÆFb7GÆS×·²FWDÆvã¢w&vBr×Óà¢ÆFb7GÆS×·²föçE6¦S¢srÂÆWGFW%76æs¢srÂföçEvVvC¢ssrÂ6öÆ÷#¢6RÓÓÒv&WGFærròr3#r¢6RÓÓÒw&W7VÇG2rò&÷VæE&W7VÇBÓÓÒwWròr3#r¢r6VcCCCBr¢r6f&&c#Br×Óà¢·6RÓÓÒv&WGFærròt$UBäõrr¢6RÓÓÒvÆö6¶VBròtÄô4´TBr¢6RÓÓÒw&W6öÇfærròu$U4ôÅdärr¢&÷VæE&W7VÇBò&÷VæE&W7VÇBçFõWW$66R¢u$U5TÅE2wÐ¢ÂöFcà¢¶&WBbb6RÓÒw&W7VÇG2rbb6RÓÒv&WGFærrbb¢ÆFb7GÆS×·²föçE6¦S¢srÂ6öÆ÷#¢&WBÓÓÒwWròr3#r¢r6VcCCCBrÂÖ&våF÷¢sr×Óà¢¶&WDÖ÷VçGÒöâ¶&WBçFõWW$66RÐ¢ÂöFcà¢Ð¢ÂöFcà¢ÂöFcà¢ÂöFcà ¢²ò¢ÔõTåB²$UB%UEDôå2¢÷Ð¢ÆFb7GÆS×·²FFæs¢sGrÂfÆW6&æ³¢×Óà¢²ò¢Ö÷VçB6VÆV7F÷"¢÷Ð¢ÆFb7GÆS×·²F7Æ¢vfÆWrÂ§W7Fg6öçFVçC¢v6VçFW"rÂv¢sGrÂÖ&vä&÷GFöÓ¢sgr×Óà¢µ³ãÂãRÂãÂãUÒæÖ×BÓâ¢Æ'WGFöâ¶W×¶×GÒ6Æ74æÖSÒ&Ö÷VçBÖ'Fâ"öä6Æ6³×²Óâ6WD&WDÖ÷VçB×BÐ¢7GÆS×·²FFæs¢sW'rÂ&÷&FW%&FW3¢srÂ&÷&FW#¢&WDÖ÷VçBÓÓÒ×Bòs6öÆB&v&bÃRÃ#ÃãBr¢s6öÆB&v&#SRÃ#SRÃ#SRÃãRrÂ&6¶w&÷VæC¢&WDÖ÷VçBÓÓÒ×Bòw&v&bÃRÃ#Ãã"r¢w&v&#SRÃ#SRÃ#SRÃã"rÂ6öÆ÷#¢&WDÖ÷VçBÓÓÒ×Bòr3#r¢r3f#s#rÂföçEvVvC¢scrÂföçE6¦S¢srÂ7W'6÷#¢wöçFW"r×Ð¢ç¶×GÓÂö'WGFöãà¢Ð¢ÂöFcà ¢²ò¢UòDõtâ¢÷Ð¢ÆFb7GÆS×·²F7Æ¢vfÆWrÂv¢sr×Óà¢Æ'WGFöâ6Æ74æÖSÒ'VÇ6RÖ'Fâ×W"öä6Æ6³×²ÓâÆ6T&WBwWrÒF6&ÆVC×²&WGFæt7FfWÐ¢7GÆS×·²fÆW¢ÂFFæs¢sGrÂ&÷&FW%&FW3¢sGrÂ&÷&FW#¢&WBÓÓÒwWròs'6öÆB3#r¢s'6öÆBG&ç7&VçBrÂ&6¶w&÷VæC¢&WBÓÓÒwWròw&v&bÃRÃ#Ãã"r¢vÆæV"Öw&FVçBcFVrÂ3#Â3SccrÂ6öÆ÷#¢r6ffbrÂföçE6¦S¢sgrÂföçEvVvC¢srÂ7W'6÷#¢&WGFæt7FfRòwöçFW"r¢væ÷BÖÆÆ÷vVBrÂ÷6G¢&WGFæt7FfRò¢&WBÓÓÒwWròãR¢ã#RÂG&ç6Föã¢vÆÂã'2rÂ&÷6F÷s¢&WGFæt7FfRòsGg&v&bÃRÃ#Ãã"r¢væöæRrÂæÖFöã¢&WGFæt7FfRòwVÇ6TvÆ÷r72æfæFRr¢væöæRr×Ð¢ï	ù8UÂö'WGFöãà¢Æ'WGFöâ6Æ74æÖSÒ'VÇ6RÖ'FâÖF÷vâ"öä6Æ6³×²ÓâÆ6T&WBvF÷vârÒF6&ÆVC×²&WGFæt7FfWÐ¢7GÆS×·²fÆW¢ÂFFæs¢sGrÂ&÷&FW%&FW3¢sGrÂ&÷&FW#¢&WBÓÓÒvF÷vâròs'6öÆB6VcCCCBr¢s'6öÆBG&ç7&VçBrÂ&6¶w&÷VæC¢&WBÓÓÒvF÷vâròw&v&#3ÃcÃcÃã"r¢vÆæV"Öw&FVçBcFVrÂ6VcCCCBÂ6F3#c#brÂ6öÆ÷#¢r6ffbrÂföçE6¦S¢sgrÂföçEvVvC¢srÂ7W'6÷#¢&WGFæt7FfRòwöçFW"r¢væ÷BÖÆÆ÷vVBrÂ÷6G¢&WGFæt7FfRò¢&WBÓÓÒvF÷vâròãR¢ã#RÂG&ç6Föã¢vÆÂã'2rÂ&÷6F÷s¢&WGFæt7FfRòsGg&v&#3ÃcÃcÃã"r¢væöæRrÂæÖFöã¢&WGFæt7FfRòwVÇ6TvÆ÷u&VB72æfæFRr¢væöæRr×Ð¢ï	ù8DõtãÂö'WGFöãà¢ÂöFcà¢ÂöFcà ¢²ò¢$õEDôÒ$#¢öçG2²ETÅ4R²&VfW'&Â¢÷Ð¢ÆFb7GÆS×·²FFæs¢srÂfÆW6&æ³¢ÂF7Æ¢vfÆWrÂv¢sgrÂÆväFV×3¢v6VçFW"rÂ§W7Fg6öçFVçC¢w76RÖ&WGvVVâr×Óà¢ÆFb7GÆS×·²F7Æ¢vfÆWrÂÆväFV×3¢v6VçFW"rÂv¢sr×Óà¢ÆFb7GÆS×·²FFæs¢s7rÂ&÷&FW%&FW3¢s'rÂ&6¶w&÷VæC¢w&v&#SÃÃ3bÃãrÂ&÷&FW#¢s6öÆB&v&#SÃÃ3bÃã"r×Óà¢Ç7â7GÆS×·²6öÆ÷#¢r6f&&c#BrÂföçE6¦S¢s'rÂföçEvVvC¢ssr×Óç·öçG7ÓÂ÷7ãà¢Ç7â7GÆS×·²6öÆ÷#¢r3#s&rÂföçE6¦S¢srÂÖ&väÆVgC¢s7r×ÓåE3Â÷7ãà¢ÂöFcà¢ÆFb7GÆS×·²F7Æ¢vfÆWrÂÆväFV×3¢v6VçFW"rÂv¢sGrÂFFæs¢s7rÂ&÷&FW%&FW3¢s'rÂ&6¶w&÷VæC¢w&v&cÃRÃ#CrÃãbrÂ&÷&FW#¢s6öÆB&v&cÃRÃ#CrÃãr×Óà¢Ç7â7GÆS×·²föçE6¦S¢srÂföçEvVvC¢ssrÂ6öÆ÷#¢r6SVcrr×ÓâETÅ4SÂ÷7ãà¢Ç7â7GÆS×·²föçE6¦S¢srÂFFæs¢sGrÂ&÷&FW%&FW3¢sGrÂ&6¶w&÷VæC¢w&v&cÃRÃ#CrÃã"rÂ6öÆ÷#¢r63Ff2rÂföçEvVvC¢scr×Óå4ôôãÂ÷7ãà¢ÂöFcà¢ÂöFcà¢Æ'WGFöâöä6Æ6³×¶gVæ7Föâ²6WE6÷u&VfW'&Â6÷u&VfW'&Â²×Ò7GÆS×·²FFæs¢s7rÂ&÷&FW%&FW3¢s'rÂ&÷&FW#¢s6öÆB&v&bÃRÃ#Ãã"rÂ&6¶w&÷VæC¢w&v&bÃRÃ#ÃãBrÂ6öÆ÷#¢r3#rÂföçE6¦S¢srÂföçEvVvC¢scrÂ7W'6÷#¢wöçFW"r×Óà¢	ùRçfFP¢Âö'WGFöãà¢ÂöFcà ¢²ò¢6ÆÒvæææw2öæÇGW&ær&W7VÇG2bvöâ¢÷Ð¢¶&WBbb&÷VæE&W7VÇBbb&WBÓÓÒ&÷VæE&W7VÇBbb6RÓÓÒw&W7VÇG2rbb6ÆÕ&÷VæDBbb¢ÆFb7GÆS×·²FFæs¢srÂFWDÆvã¢v6VçFW"rÂæÖFöã¢w6ÆFTâã72V6RrÂfÆW6&æ³¢×Óà¢Æ'WGFöâöä6Æ6³×¶6ÆÕvæææw7ÒF6&ÆVC×²6ÆÕ7FGW7Ð¢7GÆS×·²vGF¢sRrÂFFæs¢s'rÂ&÷&FW%&FW3¢s'rÂ&÷&FW#¢væöæRrÂ&6¶w&÷VæC¢6ÆÕ7FGW2ÓÓÒv6öæf&ÖVBròr3#r¢vÆæV"Öw&FVçB3VFVrÂ6f&&c#BÂ6cSS"rÂ6öÆ÷#¢r3rÂföçEvVvC¢srÂföçE6¦S¢sGrÂ7W'6÷#¢6ÆÕ7FGW2òvæ÷BÖÆÆ÷vVBr¢wöçFW"rÂ&÷6F÷s¢sGg&v&#SÃÃ3bÃã#Rr×Ð¢ç¶6ÆÕ7FGW2ÓÓÒwVæFærròt6öæf&ÒâvÆÆWBâââr¢6ÆÕ7FGW2ÓÓÒv6öæf&Öærròt6ÆÖærâââr¢6ÆÕ7FGW2ÓÓÒv6öæf&ÖVBròt6ÆÖVBr¢6ÆÕ7FGW2ÓÓÒvW'&÷"ròt6ÆÒfÆVBr¢t6ÆÒvæææw2wÓÂö'WGFöãà¢ÂöFcà¢Ð¢Âóà¢Ð ¢²ò¢&VfW'&Â÷fW&Æ¢÷Ð¢·6÷u&VfW'&Âbb¢ÆFb7GÆS×·²÷6Föã¢vfVBrÂç6WC¢Â&6¶w&÷VæC¢w&v&ÃÃÃãRrÂ&6¶G&÷fÇFW#¢v&ÇW"rÂ¤æFW¢ÂF7Æ¢vfÆWrÂÆväFV×3¢v6VçFW"rÂ§W7Fg6öçFVçC¢v6VçFW"rÂFFæs¢s#rÂæÖFöã¢vfFTâã'2V6Rr×Óà¢ÆFb6Æ74æÖSÒ&vÆ72Ö6&B"7GÆS×·²&÷&FW%&FW3¢s#rÂFFæs¢s#GrÂÖvGF¢sCrÂvGF¢sRr×Óà¢ÆFb7GÆS×·²F7Æ¢vfÆWrÂ§W7Fg6öçFVçC¢w76RÖ&WGvVVârÂÆväFV×3¢v6VçFW"rÂÖ&vä&÷GFöÓ¢sgr×Óà¢ÆFb7GÆS×·²föçE6¦S¢sgrÂföçEvVvC¢ssr×ÓäçfFRg&VæG3ÂöFcà¢Æ'WGFöâöä6Æ6³×¶gVæ7Föâ²6WE6÷u&VfW'&ÂfÇ6R²×Ò7GÆS×·²&6¶w&÷VæC¢væöæRrÂ&÷&FW#¢væöæRrÂ6öÆ÷#¢r3f#s#rÂföçE6¦S¢srÂ7W'6÷#¢wöçFW"r×Óî)ÉSÂö'WGFöãà¢ÂöFcà¢ÆFb7GÆS×·²föçE6¦S¢s'rÂ6öÆ÷#¢r3f#s#rÂÖ&vä&÷GFöÓ¢s'r×ÓäV&âR&öçW2öçG2f÷"WfW'g&VæBvòÆ2âöçG26öçfW'BFòETÅ4RBDtRãÂöFcà¢ÆFb7GÆS×·²F7Æ¢vfÆWrÂv¢sgrÂÖ&vä&÷GFöÓ¢s'r×Óà¢ÆFb7GÆS×·²fÆW¢ÂFFæs¢srÂ&÷&FW%&FW3¢srÂ&6¶w&÷VæC¢w&v&#SRÃ#SRÃ#SRÃãBrÂ&÷&FW#¢s6öÆB&v&#SRÃ#SRÃ#SRÃãbrÂföçE6¦S¢srÂföçDfÖÇ¢vÖöæ÷76RrÂ6öÆ÷#¢r366brÂ÷fW&fÆ÷s¢vFFVârÂFWD÷fW&fÆ÷s¢vVÆÆ62rÂvFU76S¢væ÷w&r×Óà¢GG3¢ò÷VÇ6V&WBægVã÷&Vc×¶FG&W72òFG&W72ç6Æ6RÂ¢rwÐ¢ÂöFcà¢Æ'WGFöâöä6Æ6³×¶gVæ7Föâ²æfvF÷"æ6Æ&ö&Bçw&FUFWBvGG3¢ò÷VÇ6V&WBægVã÷&VcÒr²FG&W72òFG&W72ç6Æ6RÂ¢rræ6F6gVæ7Föâ·Ò²F2væ÷Ff6FöârÂw7V66W72r²×Ò7GÆS×·²FFæs¢sGrÂ&÷&FW%&FW3¢srÂ&÷&FW#¢væöæRrÂ&6¶w&÷VæC¢r3#rÂ6öÆ÷#¢r3rÂföçEvVvC¢ssrÂföçE6¦S¢srÂ7W'6÷#¢wöçFW"r×Óä6÷Âö'WGFöãà¢ÂöFcà¢ÆFb7GÆS×·²F7Æ¢vfÆWrÂv¢sgr×Óà¢Æ'WGFöâöä6Æ6³×¶gVæ7Föâ²væF÷ræ÷VâvGG3¢ò÷BæÖR÷6&R÷W&Ã÷W&ÃÒr²Væ6öFUU$6ö×öæVçBvGG3¢ò÷VÇ6V&WBægVã÷&VcÒr²FG&W72òFG&W72ç6Æ6RÂ¢rr²rgFWCÒr²Væ6öFUU$6ö×öæVçBu&VF7B%D2â6V6öæG2öâVÇ6RV&âETÅ4RöçG2ârÂuö&Ææ²r²×Ò7GÆS×·²fÆW¢ÂFFæs¢srÂ&÷&FW%&FW3¢srÂ&÷&FW#¢s6öÆB&v&#SRÃ#SRÃ#SRÃãbrÂ&6¶w&÷VæC¢w&v&#SRÃ#SRÃ#SRÃã2rÂ6öÆ÷#¢r6ffbrÂföçE6¦S¢s'rÂ7W'6÷#¢wöçFW"rÂföçEvVvC¢scr×ÓåFVÆVw&ÓÂö'WGFöãà¢Æ'WGFöâöä6Æ6³×¶gVæ7Föâ²væF÷ræ÷VâvGG3¢ò÷GvGFW"æ6öÒöçFVçB÷GvVWC÷FWCÒr²Væ6öFUU$6ö×öæVçBu&VF7Fær%D2&6Râ6V6öæG2öâVÇ6T&WBV&âETÅ4RöçG2åÆåÆæGG3¢ò÷VÇ6V&WBægVã÷&VcÒr²FG&W72òFG&W72ç6Æ6RÂ¢rrÂuö&Ææ²r²×Ò7GÆS×·²fÆW¢ÂFFæs¢srÂ&÷&FW%&FW3¢srÂ&÷&FW#¢s6öÆB&v&#SRÃ#SRÃ#SRÃãbrÂ&6¶w&÷VæC¢w&v&#SRÃ#SRÃ#SRÃã2rÂ6öÆ÷#¢r6ffbrÂföçE6¦S¢s'rÂ7W'6÷#¢wöçFW"rÂföçEvVvC¢scr×ÓåòGvGFW#Âö'WGFöãà¢ÂöFcà¢ÂöFcà¢ÂöFcà¢Ð ¢²ò¢G&ç67Föâ7FGW2÷fW&Æ¢÷Ð¢·G7FGW2bb¢ÆFb7GÆS×·²÷6Föã¢vfVBrÂç6WC¢Â&6¶w&÷VæC¢w&v&ÃÃÃã"rÂ&6¶G&÷fÇFW#¢v&ÇW"rÂF7Æ¢vfÆWrÂfÆWF&V7Föã¢v6öÇVÖârÂÆväFV×3¢v6VçFW"rÂ§W7Fg6öçFVçC¢v6VçFW"rÂ¤æFW¢ÂæÖFöã¢vfFTâã'2V6Rr×Óà¢·G7FGW2ÓÓÒwVæFærrbb¢ÆFb7GÆS×·²FWDÆvã¢v6VçFW"rÂæÖFöã¢w6ÆFTâã72V6Rr×Óà¢ÆFb7GÆS×·²föçE6¦S¢sCrÂÖ&vä&÷GFöÓ¢sgr×Óî(û3ÂöFcà¢ÆFb7GÆS×·²föçE6¦S¢s#rÂföçEvVvC¢ssrÂ6öÆ÷#¢r6f&&c#Br×Óä6öæf&ÒâvÆÆWCÂöFcà¢ÆFb7GÆS×·²föçE6¦S¢s7rÂ6öÆ÷#¢r3f#s#rÂÖ&våF÷¢sr×Óç¶&WDÖ÷VçGÒUDöâ¶&WBò&WBçFõWW$66R¢râââwÓÂöFcà¢ÂöFcà¢Ð¢·G7FGW2ÓÓÒv6öæf&Öærrbb¢ÆFb7GÆS×·²FWDÆvã¢v6VçFW"rÂæÖFöã¢w6ÆFTâã72V6Rr×Óà¢ÆFb7GÆS×·²föçE6¦S¢sCrÂÖ&vä&÷GFöÓ¢sgr×Óî)¹3ÂöFcà¢ÆFb7GÆS×·²föçE6¦S¢s#rÂföçEvVvC¢ssrÂ6öÆ÷#¢r3f#fCBr×Óä6öæf&Öæröâæ³ÂöFcà¢ÆFb7GÆS×·²föçE6¦S¢srÂ6öÆ÷#¢r3F#SSc2rÂÖ&våF÷¢srÂföçDfÖÇ¢vÖöæ÷76Rr×Óç·G6òG6ç6Æ6RÂ²râââr²G6ç6Æ6RÓ¢rwÓÂöFcà¢ÂöFcà¢Ð¢·G7FGW2ÓÓÒv6öæf&ÖVBrbb¢ÆFb7GÆS×·²FWDÆvã¢v6VçFW"rÂæÖFöã¢w6ÆFTâã72V6Rr×Óà¢ÆFb7GÆS×·²föçE6¦S¢sSgrÂÖ&vä&÷GFöÓ¢s'r×Óï	øèÂöFcà¢ÆFb7GÆS×·²föçE6¦S¢s#GrÂföçEvVvC¢srÂ6öÆ÷#¢r3#r×Óä&WBÆ6VBÂöFcà¢ÆFb7GÆS×·²föçE6¦S¢srÂ6öÆ÷#¢r6f&&c#BrÂÖ&våF÷¢sgrÂföçEvVvC¢ssr×Óâ·´ÖFæfÆö÷"&WDÖ÷VçB¢ÒG3ÂöFcà¢·G6bb¢Æ'WGFöâöä6Æ6³×¶gVæ7Föâ²væF÷ræ÷VâvGG3¢òöWÆ÷&W"×6WöÆææ¶öæ6âæ6öÒ÷Gòr²G6Âuö&Ææ²r²×Ò7GÆS×·²Ö&våF÷¢s'rÂFFæs¢sgrÂ&÷&FW%&FW3¢srÂ&÷&FW#¢s6öÆB&v&bÃ"Ã#"Ãã2rÂ&6¶w&÷VæC¢w&v&bÃ"Ã#"ÃãrÂ6öÆ÷#¢r3f#fCBrÂföçE6¦S¢srÂ7W'6÷#¢wöçFW"r×ÓåfWröâWÆ÷&W#Âö'WGFöãà¢Ð¢ÂöFcà¢Ð¢·G7FGW2ÓÓÒvW'&÷"rbb¢ÆFb7GÆS×·²FWDÆvã¢v6VçFW"rÂæÖFöã¢w6ÆFTâã72V6Rr×Óà¢ÆFb7GÆS×·²föçE6¦S¢sCrÂÖ&vä&÷GFöÓ¢sgr×Óî)ØÃÂöFcà¢ÆFb7GÆS×·²föçE6¦S¢srÂföçEvVvC¢ssrÂ6öÆ÷#¢r6VcCCCBr×Óç·GW'&÷$×6wÓÂöFcà¢ÂöFcà¢Ð¢ÂöFcà¢Ð¢ÂöFcà¢°§Ó° ¢òòÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÐ¢òòtD$õdDU%0¢òòÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÐ¦gVæ7Föâ°¢&WGW&â¢ÄW'&÷$&÷VæF'à¢ÅvvÖ&÷fFW"6öæfs×·vvÖFFW"çvvÖ6öæfwÓà¢ÅVW'6ÆVçE&÷fFW"6ÆVçC×·VW'6ÆVçGÓà¢ÅVÇ6TvÖRóà¢ÂõVW'6ÆVçE&÷fFW#à¢ÂõvvÖ&÷fFW#à¢ÂôW'&÷$&÷VæF'à¢°§Ð ¦W÷'BFVfVÇB
