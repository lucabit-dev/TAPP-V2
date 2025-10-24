const WebSocket = require('ws');

class ToplistService {
  constructor() {
    this.baseUrl = 'wss://app.chartswatcher.com';
    this.userID = '68a9bba1b2c529407770fddb';
    this.apiKey = '68ac935db2c5294077b0cd51';
    // Subscribe to five FLOAT config IDs (A–E)
    this.configIDs = [
      '68ecefc9420a933c6c60a971',
      '68ecefcb420a933c6c60a997',
      '68ecefcd420a933c6c60aaaa',
      '68ecefce420a933c6c60aabb',
      '68eceff9420a933c6c60b6eb'
    ];
    this.ws = null;
    this.toplistByConfig = {};
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = Number.POSITIVE_INFINITY;
    this.reconnectDelay = 5000; // 5 seconds initial, exponential backoff up to ~15s
    this.toplistListeners = [];
    this.statusListeners = [];
    // When true, skip the next automatic reconnect (used for manual restarts)
    this.suppressReconnectOnce = false;
  }

  async connect() {
    return new Promise((resolve, reject) => {
      const wsUrl = `${this.baseUrl}/api/v1/websocket?user_id=${this.userID}&api_key=${this.apiKey}`;
      
      console.log('🔌 Connecting to ChartsWatcher Toplist WebSocket...');
      console.log('URL:', wsUrl);
      console.log('Config IDs:', this.configIDs.join(', '));
      
      this.ws = new WebSocket(wsUrl);
      
      this.ws.on('open', () => {
        console.log('✅ Connected to ChartsWatcher Toplist WebSocket');
        this.isConnected = true;
        this.reconnectAttempts = 0;
        
        // Subscribe to all FLOAT toplists
        this.subscribeToToplists();
        resolve();
      });
      
      this.ws.on('message', (data) => {
        try {
          const message = JSON.parse(data);
          this.handleMessage(message);
        } catch (error) {
          console.error('Error parsing Toplist WebSocket message:', error);
        }
      });
      
      this.ws.on('close', (code, reason) => {
        console.log(`❌ Toplist WebSocket connection closed. Code: ${code}, Reason: ${reason}`);
        this.isConnected = false;
        this.handleReconnect();
      });
      
      this.ws.on('error', (error) => {
        console.error('❌ Toplist WebSocket error:', error);
        // Only auto-reconnect if not suppressed for a manual restart
        if (!this.suppressReconnectOnce) {
          this.handleReconnect();
        }
        reject(error);
      });
      
      // Set a timeout for connection
      setTimeout(() => {
        if (!this.isConnected) {
          reject(new Error('Toplist WebSocket connection timeout'));
        }
      }, 10000); // 10 second timeout
    });
  }

  subscribeToToplists() {
    if (!this.isConnected || !this.ws) {
      console.error('Cannot subscribe to toplist: WebSocket not connected');
      return;
    }

    this.configIDs.forEach((configId) => {
      const subscribeMessage = {
        "@type": "Toplist",
        "config_id": configId,
        "action": "subscribe"
      };
      console.log('📡 Subscribing to toplist for config:', configId);
      this.ws.send(JSON.stringify(subscribeMessage));
    });
  }

  unsubscribeFromToplists() {
    if (!this.isConnected || !this.ws) {
      return;
    }

    this.configIDs.forEach((configId) => {
      const unsubscribeMessage = {
        "@type": "Toplist",
        "config_id": configId,
        "action": "unsubscribe"
      };
      console.log('📡 Unsubscribing from toplist for config:', configId);
      this.ws.send(JSON.stringify(unsubscribeMessage));
    });
  }

  handleMessage(message) {
    console.log('📨 Received toplist message:', message['@type']);

    switch (message['@type']) {
      case 'ToplistConfirm':
        this.handleToplistConfirm(message);
        break;
      case 'ToplistUpdate':
        this.handleToplistUpdate(message);
        break;
      default:
        console.log('Unknown toplist message type:', message['@type']);
    }
  }

  handleToplistConfirm(message) {
    if (message.success) {
      console.log(`✅ Toplist ${message.action} successful: ${message.msg}`);
      if (message.action === 'subscribe') {
        console.log('📊 Column descriptions:', message.column_desc);
      }
    } else {
      console.error('❌ Toplist action failed:', message.msg);
    }
  }

  handleToplistUpdate(message) {
    if (!message.config_id) {
      console.log('Ignoring toplist update without config_id');
      return;
    }

    const rows = message.rows || [];
    this.toplistByConfig[message.config_id] = rows;
    console.log(`📊 Toplist update for ${message.config_id}: ${rows.length} rows`);

    // Notify listeners with the update
    this.notifyToplistListeners(message);
  }

  handleReconnect() {
    // Optionally skip one reconnect (manual restart path)
    if (this.suppressReconnectOnce) {
      this.suppressReconnectOnce = false;
      console.log('↩️  Skipping one auto-reconnect (manual restart)');
      return;
    }
    // Always attempt to reconnect with backoff
    this.reconnectAttempts++;
    const delay = Math.min(15000, this.reconnectDelay * Math.pow(2, Math.max(0, this.reconnectAttempts - 1)));
    console.log(`🔄 Attempting to reconnect toplist (#${this.reconnectAttempts}) in ${Math.round(delay/1000)} seconds...`);
    setTimeout(() => {
      this.connect().catch(error => {
        console.error('Toplist reconnection failed:', error);
        // Will continue backing off
      });
    }, delay);
  }

  async restart() {
    try {
      console.log('🔁 Restarting Toplist WebSocket connection...');
      // Suppress auto-reconnect triggered by the intentional close
      this.suppressReconnectOnce = true;
      this.disconnect();
      // Single connect attempt, do not trigger auto-reconnect if it fails here
      this.suppressReconnectOnce = true;
      await this.connect();
      // Re-enable auto-reconnect for future unexpected drops
      this.suppressReconnectOnce = false;
      console.log('✅ Toplist WebSocket restarted');
      return true;
    } catch (e) {
      console.error('❌ Failed to restart Toplist WebSocket:', e);
      // Do not auto-reconnect here; this was a manual single attempt
      this.suppressReconnectOnce = false;
      return false;
    }
  }

  async fetchToplistData() {
    // If we have data, return shallow copy per config
    const hasAny = Object.keys(this.toplistByConfig).length > 0;
    if (hasAny) {
      const copy = {};
      Object.keys(this.toplistByConfig).forEach(k => copy[k] = [...this.toplistByConfig[k]]);
      return copy;
    }

    if (!this.isConnected) {
      try {
        await this.connect();
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (error) {
        console.error('Failed to connect to ChartsWatcher Toplist WebSocket:', error);
        throw new Error('Unable to connect to ChartsWatcher Toplist WebSocket. Please check credentials and network connection.');
      }
    }

    const copy = {};
    Object.keys(this.toplistByConfig).forEach(k => copy[k] = [...this.toplistByConfig[k]]);
    return copy;
  }

  disconnect() {
    if (this.ws) {
      // Ensure the close won't schedule a reconnect if we're intentionally restarting
      this.unsubscribeFromToplists();
      this.ws.close();
      this.ws = null;
      this.isConnected = false;
      console.log('🔌 Disconnected from ChartsWatcher Toplist WebSocket');
    }
  }

  // Method to get connection status
  getConnectionStatus() {
    return {
      isConnected: this.isConnected,
      reconnectAttempts: this.reconnectAttempts,
      toplistRowCountByConfig: Object.fromEntries(Object.entries(this.toplistByConfig).map(([k, v]) => [k, v.length])),
      configIDs: this.configIDs
    };
  }

  // Event listener methods
  onToplistUpdate(listener) {
    this.toplistListeners.push(listener);
  }

  onStatusChange(listener) {
    this.statusListeners.push(listener);
  }

  // Notify toplist listeners
  notifyToplistListeners(toplistUpdate) {
    this.toplistListeners.forEach(listener => {
      try {
        listener(toplistUpdate);
      } catch (error) {
        console.error('Error in toplist listener:', error);
      }
    });
  }

  // Notify status listeners
  notifyStatusListeners(status) {
    this.statusListeners.forEach(listener => {
      try {
        listener(status);
      } catch (error) {
        console.error('Error in status listener:', error);
      }
    });
  }
}

module.exports = ToplistService;


