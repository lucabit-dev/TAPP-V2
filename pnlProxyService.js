const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const User = require('./auth/user.model');

class PnLProxyService {
  constructor() {
    this.apiKey = process.env.PNL_API_KEY;
    this.wsBaseUrl = process.env.PNL_WS_BASE_URL || 'wss://sections-bot.inbitme.com';
    this.proxyConnections = new Map(); // clientWs -> externalWs mapping
  }

  // Verify JWT token from WebSocket connection
  async verifyToken(token) {
    if (!token) return null;
    try {
      const secret = process.env.JWT_SECRET || 'dev_secret';
      const payload = jwt.verify(token, secret);
      const user = await User.findById(payload.sub).select('_id email');
      return user ? { id: user._id.toString(), email: user.email } : null;
    } catch {
      return null;
    }
  }

  // Create a proxy connection: frontend client <-> external P&L service
  async handleProxyConnection(clientWs, req, path) {
    console.log(`🔗 PnL Proxy connection attempt - URL: ${req.url}, Path: ${path}`);
    console.log(`   Client WebSocket readyState: ${clientWs.readyState} (1=OPEN, 0=CONNECTING)`);
    
    // Extract token from query string
    let token = null;
    if (req.url && req.url.includes('?')) {
      const urlParts = req.url.split('?');
      const params = new URLSearchParams(urlParts[1]);
      token = params.get('token');
      console.log(`🔑 Token extracted from query: ${token ? 'Found' : 'Not found'}`);
    }
    
    // Try headers as fallback
    if (!token && req.headers) {
      const authHeader = req.headers['authorization'] || req.headers['sec-websocket-protocol'];
      if (authHeader) {
        token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
        console.log(`🔑 Token extracted from header: ${token ? 'Found' : 'Not found'}`);
      }
    }
    
    // Verify authentication
    const user = await this.verifyToken(token);
    if (!user) {
      console.error(`❌ Authentication failed for PnL proxy connection`);
      clientWs.close(1008, 'Authentication required');
      return;
    }

    console.log(`✅ Authenticated user for PnL proxy: ${user.email}`);
    
    if (!this.apiKey) {
      console.error(`❌ PNL_API_KEY not configured`);
      clientWs.close(1008, 'API key not configured');
      return;
    }

    // Determine the endpoint (positions or orders) from path or URL
    const isPositions = (path && path.includes('/positions')) || (req.url && req.url.includes('/positions'));
    const externalPath = isPositions ? '/ws/positions' : '/ws/orders';
    const externalUrl = `${this.wsBaseUrl}${externalPath}?api_key=${encodeURIComponent(this.apiKey)}`;

    console.log(`🔗 Proxying ${isPositions ? 'positions' : 'orders'} WebSocket to:`, externalUrl.replace(this.apiKey, '***'));

    try {
      console.log(`🔌 Creating external WebSocket connection...`);
      const externalWs = new WebSocket(externalUrl);

      // Forward messages from external service to frontend client
      externalWs.on('message', (data) => {
        try {
          // Convert Buffer/ArrayBuffer to string for logging
          const messageStr = Buffer.isBuffer(data) ? data.toString('utf8') : data.toString();
          let messagePreview = messageStr;
          try {
            const parsed = JSON.parse(messageStr);
            messagePreview = JSON.stringify(parsed, null, 2).substring(0, 200);
          } catch {
            // Not JSON, use raw string (limited length)
            messagePreview = messageStr.substring(0, 200);
          }
          console.log(`📥 External ${isPositions ? 'positions' : 'orders'} message received (${data.length || messageStr.length} bytes):`, messagePreview);
          
          if (clientWs.readyState === WebSocket.OPEN) {
            // Always send as text/string to ensure browser receives it as string, not Blob
            // Convert Buffer to string if needed
            const textData = Buffer.isBuffer(data) ? data.toString('utf8') : 
                           (typeof data === 'string' ? data : data.toString());
            clientWs.send(textData);
            console.log(`✅ Message forwarded to client as text`);
          } else {
            console.warn(`⚠️ Client WebSocket not open (state: ${clientWs.readyState}), message not forwarded`);
          }
        } catch (error) {
          console.error(`❌ Error forwarding message to client:`, error);
        }
      });

      // Forward messages from frontend client to external service
      clientWs.on('message', (data) => {
        try {
          console.log(`📤 Client message received, forwarding to external service`);
          if (externalWs.readyState === WebSocket.OPEN) {
            externalWs.send(data);
          } else {
            console.warn(`⚠️ External WebSocket not open (state: ${externalWs.readyState})`);
          }
        } catch (error) {
          console.error(`❌ Error forwarding client message:`, error);
        }
      });

      // Handle external connection open
      externalWs.on('open', () => {
        console.log(`✅ External ${isPositions ? 'positions' : 'orders'} WebSocket connected successfully`);
        console.log(`   External readyState: ${externalWs.readyState}, Client readyState: ${clientWs.readyState}`);
        // Both connections should be open now, ready for data forwarding
        if (clientWs.readyState === WebSocket.OPEN) {
          console.log(`✅ Both connections open - ready for bidirectional data forwarding`);
        } else {
          console.warn(`⚠️ External connected but client not open yet (state: ${clientWs.readyState})`);
        }
      });

      // Handle external connection errors
      externalWs.on('error', (error) => {
        console.error(`❌ External ${isPositions ? 'positions' : 'orders'} WebSocket error:`, error);
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(JSON.stringify({ type: 'proxy_error', error: 'External connection failed' }));
        }
      });

      // Handle external connection close
      externalWs.on('close', (code, reason) => {
        console.log(`🔌 External ${isPositions ? 'positions' : 'orders'} WebSocket closed:`, code, reason?.toString());
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.close(code, reason);
        }
      });

      // Handle client disconnect
      const cleanup = () => {
        console.log(`🔌 Client ${isPositions ? 'positions' : 'orders'} WebSocket closed`);
        if (externalWs.readyState === WebSocket.OPEN || externalWs.readyState === WebSocket.CONNECTING) {
          externalWs.close();
        }
        this.proxyConnections.delete(clientWs);
      };

      // Handle client close
      clientWs.on('close', cleanup);
      
      // Handle external close
      externalWs.on('close', () => {
        console.log(`🔌 External ${isPositions ? 'positions' : 'orders'} WebSocket closed`);
        if (clientWs.readyState === WebSocket.OPEN || clientWs.readyState === WebSocket.CONNECTING) {
          clientWs.close();
        }
        this.proxyConnections.delete(clientWs);
      });

      // Store the connection mapping
      this.proxyConnections.set(clientWs, externalWs);

    } catch (error) {
      console.error(`❌ Failed to create proxy connection:`, error);
      clientWs.close(1011, 'Proxy connection failed');
    }
  }
}

module.exports = PnLProxyService;

