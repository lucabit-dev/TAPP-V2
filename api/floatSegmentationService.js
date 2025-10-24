class FloatSegmentationService {
  constructor() {
    this.groups = {
      '68ecefc9420a933c6c60a971': { key: 'A', name: 'Lista A', range: '0–2M' },
      '68ecefcb420a933c6c60a997': { key: 'B', name: 'Lista B', range: '2–6M' },
      '68ecefcd420a933c6c60aaaa': { key: 'C', name: 'Lista C', range: '6–12M' },
      '68ecefce420a933c6c60aabb': { key: 'D', name: 'Lista D', range: '12–50M' },
      '68eceff9420a933c6c60b6eb': { key: 'E', name: 'Lista E', range: '50–150M' }
    };
    this.defaultThresholds = {
      A: { change5mPct: 0.5, trades1m: 50, vol5m: 200000, changeFromOpenPct: 0.5 },
      B: { change5mPct: 0.4, trades1m: 40, vol5m: 150000, changeFromOpenPct: 0.4 },
      C: { change5mPct: 0.3, trades1m: 35, vol5m: 120000, changeFromOpenPct: 0.3 },
      D: { change5mPct: 0.25, trades1m: 30, vol5m: 100000, changeFromOpenPct: 0.25 },
      E: { change5mPct: 0.2, trades1m: 25, vol5m: 80000, changeFromOpenPct: 0.2 }
    };
    this.thresholds = { ...this.defaultThresholds };
  }

  setThresholds(groupKey, values) {
    if (!this.thresholds[groupKey]) return;
    this.thresholds[groupKey] = { ...this.thresholds[groupKey], ...values };
  }

  getThresholds() {
    return this.thresholds;
  }

  getGroupInfoByConfig(configId) {
    return this.groups[configId];
  }

  // Momentum checks using candles
  computeMomentum(candles1m, candles5m, lastClose) {
    const now5 = candles5m.slice(-2); // last two 5m candles
    const now1 = candles1m.slice(-1);
    let change5mPct = null;
    let vol5m = null;
    let trades1m = null;
    let changeFromOpenPct = null;

    if (now5.length >= 2) {
      const prevClose = now5[0].close;
      const currClose = now5[1].close;
      if (prevClose && currClose) {
        change5mPct = ((currClose - prevClose) / prevClose) * 100;
      }
      vol5m = (now5[0].volume || 0) + (now5[1].volume || 0);
    }
    if (now1.length === 1) {
      trades1m = now1[0].transactions || null;
    }
    if (candles1m.length > 0) {
      const sessionOpen = candles1m[0].open;
      if (sessionOpen && lastClose) {
        changeFromOpenPct = ((lastClose - sessionOpen) / sessionOpen) * 100;
      }
    }

    return { change5mPct, vol5m, trades1m, changeFromOpenPct };
  }

  meetsMomentum(groupKey, momentum) {
    const t = this.thresholds[groupKey];
    if (!t) return false;
    const checks = [
      momentum.change5mPct !== null && momentum.change5mPct >= t.change5mPct,
      momentum.trades1m !== null && momentum.trades1m >= t.trades1m,
      momentum.vol5m !== null && momentum.vol5m >= t.vol5m,
      momentum.changeFromOpenPct !== null && momentum.changeFromOpenPct >= t.changeFromOpenPct
    ];
    return checks.every(Boolean);
  }
}

module.exports = FloatSegmentationService;




