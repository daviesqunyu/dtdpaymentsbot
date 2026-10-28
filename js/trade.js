// DTD Store Trade Page - Spot Desk / Binance Market Data
document.addEventListener('DOMContentLoaded', () => {
  initTrade();
});

function initTrade() {
  // Fetch Binance ticker data
  fetchBinanceTickers();
  
  // Auto-refresh every 15 seconds
  setInterval(fetchBinanceTickers, 15000);
}

async function fetchBinanceTickers() {
  const tickerBody = document.getElementById('tickerBody');
  if (!tickerBody) return;
  
  try {
    const res = await fetch('https://api.binance.com/api/v3/ticker/24hr');
    const tickers = await res.json();
    const symbols = ['BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT','DOGEUSDT'];
    
    tickerBody.innerHTML = symbols.map(s => {
      const t = tickers.find(x => x.symbol === s);
      if (!t) return '<tr><td colspan="5" class="text-cyber-muted text-sm">—</td></tr>';
      
      const change = Number(t.priceChangePercent);
      const color = change >= 0 ? 'var(--neon-green)' : 'var(--neon-red)';
      
      return `
        <tr style="background:var(--cyber-bg);border-bottom:1px solid var(--cyber-border);">
          <td style="color:var(--cyber-text);"><span class="mono">${s}</span></td>
          <td style="color:var(--cyber-neon);"><span class="mono">${Number(t.lastPrice).toFixed(2)}</span></td>
          <td style="color:${color};font-weight:600;">${change.toFixed(2)}%</td>
          <td style="color:var(--cyber-text);"><span class="mono">${Number(t.bidPrice).toFixed(2)}</span></td>
          <td style="color:var(--cyber-text);"><span class="mono">${Number(t.askPrice).toFixed(2)}</span></td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    tickerBody.innerHTML = '<tr><td colspan="5" class="text-cyber-muted text-sm">Unable to load market data.</td></tr>';
  }
}

function formatNumber(num) {
  return Number(num).toFixed(2);
}