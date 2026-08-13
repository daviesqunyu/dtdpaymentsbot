export class TradeChart {
  constructor(container) {
    this.container = container;
    this.chart = null;
    this.series = null;
    this.volumeSeries = null;
    this.candles = [];
    this.mode = "candles";
    this._ro = null;
  }

  mount() {
    if (!this.container) return false;
    if (typeof LightweightCharts === "undefined") {
      this._showLibError();
      return false;
    }
    this.destroy(false);
    const width = Math.max(this.container.clientWidth || 0, 320);
    const height = Math.max(this.container.clientHeight || 0, 320);
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
      width,
      height
    });
    this._applyModeSeries();
    this.volumeSeries = this.chart.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
      color: "rgba(100, 116, 139, 0.55)"
    });
    this.chart.priceScale("volume").applyOptions({
      scaleMargins: { top: 0.78, bottom: 0 }
    });
    this.chart.priceScale("right").applyOptions({
      scaleMargins: { top: 0.08, bottom: 0.22 }
    });
    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(this.container);
    if (this.candles.length) this.setHistory(this.candles);
    return true;
  }

  _showLibError() {
    const status = document.getElementById("tradeChartStatus");
    if (status) {
      status.hidden = false;
      status.textContent = "Chart library failed to load — refresh the page.";
    }
  }

  _applyModeSeries() {
    if (!this.chart) return;
    if (this.series) {
      try {
        this.chart.removeSeries(this.series);
      } catch {
        /* ignore */
      }
      this.series = null;
    }
    if (this.mode === "line") {
      this.series = this.chart.addLineSeries({
        color: "#38bdf8",
        lineWidth: 2,
        crosshairMarkerVisible: true
      });
    } else if (this.mode === "area") {
      this.series = this.chart.addAreaSeries({
        lineColor: "#38bdf8",
        topColor: "rgba(56, 189, 248, 0.35)",
        bottomColor: "rgba(56, 189, 248, 0.02)",
        lineWidth: 2
      });
    } else {
      this.series = this.chart.addCandlestickSeries({
        upColor: "#34d399",
        downColor: "#f87171",
        borderUpColor: "#34d399",
        borderDownColor: "#f87171",
        wickUpColor: "#34d399",
        wickDownColor: "#f87171"
      });
    }
  }

  setMode(mode) {
    const next = ["candles", "line", "area"].includes(mode) ? mode : "candles";
    if (next === this.mode && this.series) return;
    this.mode = next;
    if (!this.chart) {
      this.mount();
      return;
    }
    this._applyModeSeries();
    this.setHistory(this.candles);
  }

  resize() {
    if (!this.chart || !this.container) return;
    const width = Math.max(this.container.clientWidth || 0, 320);
    const height = Math.max(this.container.clientHeight || 0, 280);
    this.chart.applyOptions({ width, height });
  }

  destroy(clearData = true) {
    this._ro?.disconnect();
    this._ro = null;
    this.chart?.remove();
    this.chart = null;
    this.series = null;
    this.volumeSeries = null;
    if (clearData) this.candles = [];
  }

  _pricePoints(rows) {
    if (this.mode === "candles") {
      return rows.map((c) => ({
        time: c.time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close
      }));
    }
    return rows.map((c) => ({ time: c.time, value: c.close }));
  }

  _volumePoints(rows) {
    return rows.map((c) => ({
      time: c.time,
      value: Number(c.volume) || 0,
      color:
        c.close >= c.open
          ? "rgba(52, 211, 153, 0.35)"
          : "rgba(248, 113, 113, 0.35)"
    }));
  }

  setHistory(rows) {
    this.candles = (rows || []).slice();
    if (!this.chart || !this.series) {
      this.mount();
    }
    this.series?.setData(this._pricePoints(this.candles));
    this.volumeSeries?.setData(this._volumePoints(this.candles));
    this.resize();
    this.chart?.timeScale().fitContent();
  }

  updateCandle(c) {
    if (!this.series) {
      this.mount();
      if (!this.series) return;
    }
    if (this.mode === "candles") {
      this.series.update({
        time: c.time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close
      });
    } else {
      this.series.update({ time: c.time, value: c.close });
    }
    this.volumeSeries?.update({
      time: c.time,
      value: Number(c.volume) || 0,
      color:
        c.close >= c.open
          ? "rgba(52, 211, 153, 0.35)"
          : "rgba(248, 113, 113, 0.35)"
    });
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
