export class TradeChart {
  constructor(container) {
    this.container = container;
    this.chart = null;
    this.series = null;
    this.candles = [];
    this._ro = null;
  }

  mount() {
    if (!this.container || typeof LightweightCharts === "undefined") return;
    this.destroy();
    this.chart = LightweightCharts.createChart(this.container, {
      layout: {
        background: { color: "transparent" },
        textColor: "#9aadc8"
      },
      grid: {
        vertLines: { color: "rgba(148,163,184,0.12)" },
        horzLines: { color: "rgba(148,163,184,0.12)" }
      },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
      crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
      width: this.container.clientWidth,
      height: this.container.clientHeight
    });
    this.series = this.chart.addCandlestickSeries({
      upColor: "#34d399",
      downColor: "#f87171",
      borderUpColor: "#34d399",
      borderDownColor: "#f87171",
      wickUpColor: "#34d399",
      wickDownColor: "#f87171"
    });
    this._ro = new ResizeObserver(() => {
      if (!this.chart || !this.container) return;
      this.chart.applyOptions({
        width: this.container.clientWidth,
        height: this.container.clientHeight
      });
    });
    this._ro.observe(this.container);
  }

  destroy() {
    this._ro?.disconnect();
    this._ro = null;
    this.chart?.remove();
    this.chart = null;
    this.series = null;
    this.candles = [];
  }

  setHistory(rows) {
    this.candles = rows.slice();
    this.series?.setData(
      rows.map((c) => ({
        time: c.time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close
      }))
    );
    this.chart?.timeScale().fitContent();
  }

  updateCandle(c) {
    if (!this.series) return;
    const point = {
      time: c.time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close
    };
    this.series.update(point);
    const last = this.candles[this.candles.length - 1];
    if (last && last.time === c.time) {
      this.candles[this.candles.length - 1] = { ...c };
    } else if (!last || c.time > last.time) {
      this.candles.push({ ...c });
      if (this.candles.length > 500) this.candles.shift();
    }
  }

  snapshot(limit = 40) {
    return this.candles.slice(-limit).map((c) => ({
      t: c.time,
      o: c.open,
      h: c.high,
      l: c.low,
      c: c.close,
      v: c.volume || 0
    }));
  }
}
