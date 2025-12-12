const WebSocket = require('ws');

class L2Service {
  constructor() {
    this.apiKey = process.env.INBITME_API_KEY;
    this.baseUrl = 'wss://sections-bot.inbitme.com';
    this.ws = null;
    this.currentSymbol = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = Number.POSITIVE_INFINITY;
    this.reconnectDelay = 5000;
    this.dataListeners = [];
    this.statusListeners = [];
    this.suppressReconnectOnce = false;
    this.latestData = null;
  }

  // Subscribe to data updates
  onData(callback) {
    this.dataListeners.push(callback);
    // Immediately send latest data if available
    if (this.latestData) {
      callback(this.latestData);
    }
  }

  // Subscribe to status updates
  onStatus(callback) {
    this.statusListeners.push(callback);
  }

  // Notify all data listeners
  notifyDataListeners(data) {
    this.latestData = data;
    this.dataListeners.forEach(callback => {
      try {
        callback(data);
      } catch (error) {
        console.error('Error in L2 data listener:', error);
      }
    });
  }

  // Notify all status listeners
  notifyStatusListeners(status) {
    this.statusListeners.forEach(callback => {
      try {
        callback(status);
      } catch (error) {
        console.error('Error in L2 status listener:', error);
      }
    });
  }

  async connect(symbol) {
    if (!this.apiKey) {
      console.error('❌ INBITME_API_KEY not configured');
      this.notifyStatusListeners({ 
        isConnected: false, 
        error: 'API key not configured' 
      });
      return;
    }

    if (!symbol) {
      console.error('❌ Symbol is required to connect to L2 stream');
      this.notifyStatusListeners({ 
        isConnected: false, 
        error: 'Symbol is required' 
      });
      return;
    }

    // If already connected to the same symbol, do nothing
    if (this.isConnected && this.currentSymbol === symbol && this.ws && this.ws.readyState === WebSocket.OPEN) {
      console.log(`✅ Already connected to L2 stream for ${symbol}`);
      return;
    }

    // Disconnect existing connection if symbol changed
    if (this.ws && this.currentSymbol !== symbol) {
      this.disconnect();
    }

    this.currentSymbol = symbol;

    return new Promise((resolve, reject) => {
      const streamType = 'marketdepth';
      const wsUrl = `${this.baseUrl}/ws/${streamType}/${symbol}?api_key=${this.apiKey}`;
      
      console.log(`🔌 Connecting to L2 market depth WebSocket for ${symbol}...`);
      console.log(`URL: ${wsUrl.replace(this.apiKey, '***')}`);
      
      this.ws = new WebSocket(wsUrl);
      
      this.ws.on('open', () => {
        console.log(`✅ Connected to L2 market depth stream for ${symbol}`);
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.notifyStatusListeners({ 
          isConnected: true, 
          symbol: symbol,
          error: null 
        });
        resolve();
      });
      
      this.ws.on('message', (data) => {
        try {
          const message = JSON.parse(data);
          
          // Ignore heartbeat messages (can come as string "heartbeat" or object with heartbeat property)
          if (typeof message === 'string' && message.toLowerCase().trim() === 'heartbeat') {
            console.log('[L2] Heartbeat received (string), ignoring');
            return;
          }
          if (typeof message === 'object' && (message.heartbeat || message.type === 'heartbeat' || message.Heartbeat)) {
            console.log('[L2] Heartbeat received (object), ignoring');
            return;
          }
          
          console.log('[L2] Evento recibido (raw):', JSON.stringify(message, null, 2));
          console.log('[L2] Message keys:', Object.keys(message));
          
          // Process and normalize the market depth data
          const processedData = this.processMarketDepthData(message, symbol);
          console.log('[L2] Processed data:', JSON.stringify(processedData, null, 2));
          this.notifyDataListeners(processedData);
        } catch (error) {
          console.error('❌ Error parsing L2 WebSocket message:', error);
          console.error('Raw data:', data.toString());
        }
      });
      
      this.ws.on('close', (code, reason) => {
        console.log(`❌ L2 WebSocket connection closed for ${symbol}. Code: ${code}, Reason: ${reason}`);
        this.isConnected = false;
        this.notifyStatusListeners({ 
          isConnected: false, 
          symbol: symbol,
          error: `Connection closed: ${reason || code}` 
        });
        
        // Auto-reconnect unless suppressed
        if (!this.suppressReconnectOnce && this.currentSymbol) {
          this.handleReconnect();
        }
      });
      
      this.ws.on('error', (error) => {
        console.error(`❌ L2 WebSocket error for ${symbol}:`, error);
        this.notifyStatusListeners({ 
          isConnected: false, 
          symbol: symbol,
          error: error.message 
        });
        
        // Only auto-reconnect if not suppressed for a manual restart
        if (!this.suppressReconnectOnce) {
          this.handleReconnect();
        }
        reject(error);
      });
      
      // Set a timeout for connection
      setTimeout(() => {
        if (!this.isConnected) {
          reject(new Error('L2 WebSocket connection timeout'));
        }
      }, 10000); // 10 second timeout
    });
  }

  processMarketDepthData(message, symbol) {
    // Handle the actual Inbitme market depth format:
    // {
    //   "Bids": [{ "Price": "484.5", "TotalSize": "80", ... }, ...],
    //   "Asks": [{ "Price": "485", "TotalSize": "181", ... }, ...]
    // }
    
    const processed = {
      symbol: symbol,
      timestamp: new Date().toISOString(),
      raw: message, // Keep raw data for reference
      bids: [],
      asks: [],
      spread: null,
      midPrice: null
    };

    // Process Bids (capital B) - array of objects with Price and TotalSize as strings
    if (message.Bids && Array.isArray(message.Bids)) {
      processed.bids = message.Bids.map(bid => ({
        price: parseFloat(bid.Price),
        quantity: parseFloat(bid.TotalSize),
        earliestTime: bid.EarliestTime,
        latestTime: bid.LatestTime,
        side: bid.Side,
        biggestSize: parseFloat(bid.BiggestSize),
        smallestSize: parseFloat(bid.SmallestSize),
        numParticipants: bid.NumParticipants,
        totalOrderCount: bid.TotalOrderCount,
        raw: bid
      })).filter(bid => !isNaN(bid.price) && !isNaN(bid.quantity));
    }
    // Fallback to lowercase 'bids' if present
    else if (message.bids && Array.isArray(message.bids)) {
      processed.bids = message.bids.map(bid => {
        const price = bid.Price || bid.price || bid[0];
        const quantity = bid.TotalSize || bid.totalSize || bid.quantity || bid.size || bid[1];
        return {
          price: parseFloat(price),
          quantity: parseFloat(quantity),
          earliestTime: bid.EarliestTime || bid.earliestTime,
          latestTime: bid.LatestTime || bid.latestTime,
          side: bid.Side || bid.side,
          biggestSize: parseFloat(bid.BiggestSize || bid.biggestSize || 0),
          smallestSize: parseFloat(bid.SmallestSize || bid.smallestSize || 0),
          numParticipants: bid.NumParticipants || bid.numParticipants || 0,
          totalOrderCount: bid.TotalOrderCount || bid.totalOrderCount || 0,
          raw: bid
        };
      }).filter(bid => !isNaN(bid.price) && !isNaN(bid.quantity));
    }

    // Process Asks (capital A) - array of objects with Price and TotalSize as strings
    if (message.Asks && Array.isArray(message.Asks)) {
      processed.asks = message.Asks.map(ask => ({
        price: parseFloat(ask.Price),
        quantity: parseFloat(ask.TotalSize),
        earliestTime: ask.EarliestTime,
        latestTime: ask.LatestTime,
        side: ask.Side,
        biggestSize: parseFloat(ask.BiggestSize),
        smallestSize: parseFloat(ask.SmallestSize),
        numParticipants: ask.NumParticipants,
        totalOrderCount: ask.TotalOrderCount,
        raw: ask
      })).filter(ask => !isNaN(ask.price) && !isNaN(ask.quantity));
    }
    // Fallback to lowercase 'asks' if present
    else if (message.asks && Array.isArray(message.asks)) {
      processed.asks = message.asks.map(ask => {
        const price = ask.Price || ask.price || ask[0];
        const quantity = ask.TotalSize || ask.totalSize || ask.quantity || ask.size || ask[1];
        return {
          price: parseFloat(price),
          quantity: parseFloat(quantity),
          earliestTime: ask.EarliestTime || ask.earliestTime,
          latestTime: ask.LatestTime || ask.latestTime,
          side: ask.Side || ask.side,
          biggestSize: parseFloat(ask.BiggestSize || ask.biggestSize || 0),
          smallestSize: parseFloat(ask.SmallestSize || ask.smallestSize || 0),
          numParticipants: ask.NumParticipants || ask.numParticipants || 0,
          totalOrderCount: ask.TotalOrderCount || ask.totalOrderCount || 0,
          raw: ask
        };
      }).filter(ask => !isNaN(ask.price) && !isNaN(ask.quantity));
    }

    // Sort bids descending (highest first) and asks ascending (lowest first)
    processed.bids.sort((a, b) => b.price - a.price);
    processed.asks.sort((a, b) => a.price - b.price);

    // Calculate spread and mid price
    if (processed.bids.length > 0 && processed.asks.length > 0) {
      const bestBid = processed.bids[0].price;
      const bestAsk = processed.asks[0].price;
      processed.spread = bestAsk - bestBid;
      processed.midPrice = (bestBid + bestAsk) / 2;
    }

    console.log('[L2] Processed result:', {
      bidsCount: processed.bids.length,
      asksCount: processed.asks.length,
      spread: processed.spread,
      midPrice: processed.midPrice
    });

    return processed;
  }

  handleReconnect() {
    if (!this.currentSymbol) {
      return; // No symbol set, don't reconnect
    }

    this.reconnectAttempts++;
    const delay = Math.min(this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1), 15000);
    
    console.log(`🔄 Attempting to reconnect L2 WebSocket for ${this.currentSymbol} (attempt ${this.reconnectAttempts}) in ${delay}ms...`);
    
    setTimeout(() => {
      if (this.currentSymbol) {
        this.connect(this.currentSymbol).catch(error => {
          console.error(`❌ L2 reconnection failed for ${this.currentSymbol}:`, error);
        });
      }
    }, delay);
  }

  disconnect() {
    this.suppressReconnectOnce = true;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
    this.currentSymbol = null;
    this.notifyStatusListeners({ 
      isConnected: false, 
      symbol: null,
      error: null 
    });
  }

  getCurrentSymbol() {
    return this.currentSymbol;
  }

  getStatus() {
    return {
      isConnected: this.isConnected,
      symbol: this.currentSymbol,
      reconnectAttempts: this.reconnectAttempts
    };
  }
}

module.exports = L2Service;
