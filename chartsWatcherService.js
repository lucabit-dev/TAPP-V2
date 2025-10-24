const WebSocket = require('ws');

class ChartsWatcherService {
  constructor() {
    this.baseUrl = 'wss://app.chartswatcher.com';
    this.userID = process.env.CHARTSWATCHER_USER_ID || '68a9bba1b2c529407770fddb';
    this.apiKey = process.env.CHARTSWATCHER_API_KEY || '68ac935db2c5294077b0cd51';
    this.configID = process.env.CHARTSWATCHER_CONFIG_ID || '68d2f1d1e0373f708e67d801';
    this.ws = null;
    this.alerts = [];
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 5000; // 5 seconds
    this.alertListeners = [];
    this.statusListeners = [];
  }

  async connect() {
    return new Promise((resolve, reject) => {
      const wsUrl = `${this.baseUrl}/api/v1/websocket?user_id=${this.userID}&api_key=${this.apiKey}`;
      
      console.log('🔌 Connecting to ChartsWatcher WebSocket...');
      console.log('URL:', wsUrl);
      
      this.ws = new WebSocket(wsUrl);
      
      this.ws.on('open', () => {
        console.log('✅ Connected to ChartsWatcher WebSocket');
        this.isConnected = true;
        this.reconnectAttempts = 0;
        
        // Subscribe to alerts for the specific config
        this.subscribeToAlerts();
        resolve();
      });
      
      this.ws.on('message', (data) => {
        try {
          const message = JSON.parse(data);
          this.handleMessage(message);
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
          console.error('Raw message data:', data.toString());
        }
      });
      
      this.ws.on('close', (code, reason) => {
        console.log(`❌ WebSocket connection closed. Code: ${code}, Reason: ${reason}`);
        this.isConnected = false;
        this.handleReconnect();
      });
      
      this.ws.on('error', (error) => {
        console.error('❌ WebSocket error:', error);
        reject(error);
      });
      
      // Set a timeout for connection
      setTimeout(() => {
        if (!this.isConnected) {
          reject(new Error('WebSocket connection timeout'));
        }
      }, 10000); // 10 second timeout
    });
  }

  subscribeToAlerts() {
    if (!this.isConnected || !this.ws) {
      console.error('Cannot subscribe: WebSocket not connected');
      return;
    }

    const subscribeMessage = {
      "@type": "Alert",
      "config_id": this.configID,
      "action": "subscribe"
    };

    console.log('📡 Subscribing to alerts for config:', this.configID);
    this.ws.send(JSON.stringify(subscribeMessage));
  }

  unsubscribeFromAlerts() {
    if (!this.isConnected || !this.ws) {
      return;
    }

    const unsubscribeMessage = {
      "@type": "Alert",
      "config_id": this.configID,
      "action": "unsubscribe"
    };

    console.log('📡 Unsubscribing from alerts for config:', this.configID);
    this.ws.send(JSON.stringify(unsubscribeMessage));
  }

  handleMessage(message) {
    console.log('📨 Received message:', message['@type']);

    switch (message['@type']) {
      case 'AlertConfirm':
        this.handleAlertConfirm(message);
        break;
      case 'NewAlert':
        this.handleNewAlert(message);
        break;
      default:
        console.log('Unknown message type:', message['@type']);
    }
  }

  handleAlertConfirm(message) {
    if (message.success) {
      console.log(`✅ ${message.action} successful: ${message.msg}`);
      if (message.action === 'subscribed') {
        console.log('📊 Column descriptions:', message.column_desc);
      }
    } else {
      console.error('❌ Alert action failed:', message.msg);
    }
  }

  handleNewAlert(message) {
    try {
      if (message.config_id !== this.configID) {
        console.log('Ignoring alert for different config:', message.config_id);
        return;
      }

      console.log('🚨 New alert received:', JSON.stringify(message.row, null, 2));
      
      // Transform the alert data to our expected format
      const alert = this.transformAlertData(message);
      
      // Only process valid alerts
      if (!alert) {
        console.error('❌ Failed to transform alert data, skipping...');
        return;
      }
      
      this.alerts.push(alert);
      
      // Notify alert listeners
      this.notifyAlertListeners(alert);
      
      console.log(`📈 Total alerts received: ${this.alerts.length}`);
    } catch (error) {
      console.error('❌ Error handling new alert:', error);
      console.error('Message:', JSON.stringify(message, null, 2));
    }
  }

  transformAlertData(message) {
    try {
      // Safely access message properties
      if (!message || !message.row) {
        console.error('❌ Invalid message structure: missing row data');
        return null;
      }
      
      const row = message.row;
      const columns = Array.isArray(row.columns) ? row.columns : [];
      
      // Extract all relevant fields from columns
      let symbol = 'UNKNOWN';
      let price = null;
      let volume = null;
      let change = null;
      let changePercent = null;
      let open = null;
      let high = null;
      let low = null;
      let close = null;
      let time = null;
      
      // Log all columns for debugging
      console.log('📋 Alert columns received:', columns.map(c => ({ key: c.key || 'unknown', value: c.value })));
      
      columns.forEach(column => {
        if (!column || !column.key) return;
        
        const key = column.key;
        const value = column.value;
        
        // Skip if value is null or undefined
        if (value === null || value === undefined || value === '') return;
        
        // Extract different fields based on column key
        if (key === 'SymbolColumn') {
          symbol = value;
        } else if (key === 'PriceNOOPTION' || key === 'Price') {
          const parsed = parseFloat(value);
          if (!isNaN(parsed)) price = parsed;
        } else if (key === 'Volume' || key === 'VolumeColumn' || key === 'PreMarketVolumeNOOPTION' || key === 'AbsVolumeFilterDAY1') {
          // Parse volume values (handle formats like "74.97 M", "0.58M")
          const cleanValue = String(value).replace(/[^0-9.KMB]/gi, '');
          let parsed = parseFloat(cleanValue);
          if (!isNaN(parsed)) {
            // Convert K, M, B to actual numbers
            if (String(value).toUpperCase().includes('M')) {
              parsed = parsed * 1000000;
            } else if (String(value).toUpperCase().includes('K')) {
              parsed = parsed * 1000;
            } else if (String(value).toUpperCase().includes('B')) {
              parsed = parsed * 1000000000;
            }
            volume = parsed;
          }
        } else if (key === 'Change' || key === 'ChangeColumn') {
          const parsed = parseFloat(value);
          if (!isNaN(parsed)) change = parsed;
        } else if (key === 'ChangePercent' || key === 'ChangePercentColumn' || key === 'Change%' || key === 'PrzChangeFilterMIN5' || key === 'PrzChangeFilterMIN10') {
          // Parse percentage values (handle formats like "-1.37 %", "32.19 %")
          const cleanValue = String(value).replace(/[^0-9.\-]/g, '');
          const parsed = parseFloat(cleanValue);
          if (!isNaN(parsed)) changePercent = parsed;
        } else if (key === 'Open' || key === 'OpenColumn') {
          const parsed = parseFloat(value);
          if (!isNaN(parsed)) open = parsed;
        } else if (key === 'High' || key === 'HighColumn') {
          const parsed = parseFloat(value);
          if (!isNaN(parsed)) high = parsed;
        } else if (key === 'Low' || key === 'LowColumn') {
          const parsed = parseFloat(value);
          if (!isNaN(parsed)) low = parsed;
        } else if (key === 'Close' || key === 'CloseColumn') {
          const parsed = parseFloat(value);
          if (!isNaN(parsed)) close = parsed;
        } else if (key === 'Time' || key === 'TimeColumn' || key === 'Timestamp') {
          time = value;
        } else if (key === 'AbsRangeFilterMIN5') {
          // This might be a range indicator, we can extract it for additional info
          const cleanValue = String(value).replace(/[^0-9.]/g, '');
          const parsed = parseFloat(cleanValue);
          if (!isNaN(parsed) && !high && !low) {
            // Could use this as a range indicator if no other range data
          }
        }
      });
      
      // Use the alert time from ChartsWatcher if available, otherwise use current time
      let alertTimestamp = new Date().toISOString(); // Default to now
      
      if (time) {
        try {
          // Try to parse the time value
          const parsedDate = new Date(time);
          
          // Check if the date is valid
          if (!isNaN(parsedDate.getTime())) {
            alertTimestamp = parsedDate.toISOString();
          } else {
            console.warn(`⚠️ Invalid time value from ChartsWatcher: ${time}, using current time`);
          }
        } catch (dateError) {
          console.warn(`⚠️ Error parsing time value: ${time}, using current time`, dateError);
        }
      }
      
      console.log(`🚨 Transformed alert for ${symbol}: Price=$${price || 'N/A'}, Volume=${volume || 'N/A'}, Time=${alertTimestamp}`);

      return {
        ticker: symbol,
        symbol: symbol,
        timestamp: alertTimestamp,
        time: alertTimestamp,
        created_at: alertTimestamp,
        instrument: symbol,
        price: price,
        volume: volume,
        change: change,
        changePercent: changePercent,
        open: open,
        high: high,
        low: low,
        close: close,
        alert_type: 'websocket_alert',
        color: row.color || '#00ff00',
        text_color: row.text_color || '#ffffff',
        config_id: message.config_id,
        raw_columns: columns // Keep raw columns for debugging
      };
    } catch (error) {
      console.error('❌ Error transforming alert data:', error);
      console.error('Message:', JSON.stringify(message, null, 2));
      return null;
    }
  }

  handleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('❌ Max reconnection attempts reached. Giving up.');
      return;
    }

    this.reconnectAttempts++;
    console.log(`🔄 Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts}) in ${this.reconnectDelay/1000} seconds...`);

    setTimeout(() => {
      this.connect().catch(error => {
        console.error('Reconnection failed:', error);
      });
    }, this.reconnectDelay);
  }

  async fetchAlerts() {
    // If we have alerts from WebSocket, return them
    if (this.alerts.length > 0) {
      console.log(`📊 Returning ${this.alerts.length} alerts from WebSocket`);
      return [...this.alerts]; // Return a copy
    }

    // If not connected, try to connect
    if (!this.isConnected) {
      try {
        await this.connect();
        // Wait a bit for alerts to come in
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (error) {
        console.error('Failed to connect to ChartsWatcher WebSocket:', error);
        throw new Error('Unable to connect to ChartsWatcher WebSocket. Please check credentials and network connection.');
      }
    }

    return [...this.alerts]; // Return a copy
  }

  disconnect() {
    if (this.ws) {
      this.unsubscribeFromAlerts();
      this.ws.close();
      this.ws = null;
      this.isConnected = false;
      console.log('🔌 Disconnected from ChartsWatcher WebSocket');
    }
  }

  // Helper method to extract ticker symbol from alert data
  extractTicker(alert) {
    return alert.ticker || alert.symbol || alert.instrument || 'UNKNOWN';
  }

  // Helper method to extract alert timestamp
  extractTimestamp(alert) {
    return alert.timestamp || alert.time || alert.created_at || new Date().toISOString();
  }

  // Method to get connection status
  getConnectionStatus() {
    return {
      isConnected: this.isConnected,
      reconnectAttempts: this.reconnectAttempts,
      alertCount: this.alerts.length,
      configID: this.configID
    };
  }

  // Event listener methods
  onAlert(listener) {
    this.alertListeners.push(listener);
  }

  onStatusChange(listener) {
    this.statusListeners.push(listener);
  }

  // Notify alert listeners
  notifyAlertListeners(alert) {
    this.alertListeners.forEach(listener => {
      try {
        listener(alert);
      } catch (error) {
        console.error('Error in alert listener:', error);
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

module.exports = ChartsWatcherService;