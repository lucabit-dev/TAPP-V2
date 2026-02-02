#!/usr/bin/env node
/**
 * Diagnostic script: Test buy tracking flow
 * Run with: node scripts/test-buy-tracking.js [SYMBOL]
 * 
 * Requires: Server running on localhost:3001, or set API_URL env var
 * 
 * This script:
 * 1. Executes a test buy via /api/buys/test
 * 2. Captures and logs the full API response
 * 3. Checks if order_id is present and in expected format
 * 4. Optionally polls order status
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const API_URL = process.env.API_URL || 'http://localhost:3001/api';
const SYMBOL = (process.argv[2] || 'AAPL').toUpperCase();

async function main() {
  console.log('='.repeat(60));
  console.log('BUY TRACKING DIAGNOSTIC');
  console.log('='.repeat(60));
  console.log(`API: ${API_URL}`);
  console.log(`Symbol: ${SYMBOL}`);
  console.log('');

  // 1. Health check
  try {
    const baseUrl = API_URL.replace(/\/api\/?$/, '');
    const healthRes = await fetch(`${baseUrl}/api/health`);
    const health = await healthRes.json();
    console.log('✅ Server health:', JSON.stringify(health, null, 2));
  } catch (e) {
    console.error('❌ Server not reachable:', e.message);
    console.log('\nMake sure the server is running: npm start');
    process.exit(1);
  }

  // 2. Execute test buy
  console.log('\n📤 Sending test buy...');
  const buyRes = await fetch(`${API_URL}/buys/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol: SYMBOL })
  });

  const buyData = await buyRes.json().catch(() => ({}));
  console.log('\n📋 BUY RESPONSE:');
  console.log('  Status:', buyRes.status, buyRes.statusText);
  console.log('  Body:', JSON.stringify(buyData, null, 2));

  // 3. Analyze response for tracking (match server's extraction logic)
  const responseData = buyData?.data?.response || buyData?.response || buyData;
  const orderId = buyData?.data?.orderId ?? responseData?.order_id ?? responseData?.OrderID ?? responseData?.orderId ?? buyData?.order_id ?? buyData?.orderId;
  const notifyStatus = buyData?.data?.notifyStatus ?? buyData?.notifyStatus ?? String(buyRes.status);

  console.log('\n🔍 TRACKING ANALYSIS:');
  console.log('  order_id found:', orderId ?? 'MISSING');
  console.log('  order_id value:', orderId);
  console.log('  Status starts with 2xx:', notifyStatus.startsWith('2'));
  console.log('  Would be TRACKED:', !!(orderId != null && String(notifyStatus).startsWith('2')));
  
  if (!orderId) {
    console.log('\n⚠️  ORDER NOT TRACKED: No order_id in response');
    console.log('   Keys in response:', responseData ? Object.keys(responseData) : 'N/A');
  } else if (!String(notifyStatus).startsWith('2')) {
    console.log('\n⚠️  ORDER NOT TRACKED: Status is not 2xx:', notifyStatus);
  } else {
    console.log('\n✅ Order would be tracked. Check server logs for:');
    console.log('   📌 [DEBUG] Tracking manual buy order', orderId, 'for', SYMBOL);
  }

  console.log('\n' + '='.repeat(60));
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
