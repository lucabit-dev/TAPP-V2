#!/usr/bin/env node

/**
 * Environment Variables Validation Script
 * Run with: node scripts/check-env.js
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[36m',
};

function check(varName, required = true) {
  const value = process.env[varName];
  const exists = value !== undefined && value !== '';
  
  if (required && !exists) {
    console.log(`${colors.red}❌ ${varName}${colors.reset} - Missing (required)`);
    return false;
  } else if (!required && !exists) {
    console.log(`${colors.yellow}⚠️  ${varName}${colors.reset} - Not set (optional)`);
    return true;
  } else {
    const masked = varName.includes('SECRET') || varName.includes('KEY') || varName.includes('PASSWORD')
      ? `${value.substring(0, 4)}...${value.substring(value.length - 4)}`
      : value;
    console.log(`${colors.green}✅ ${varName}${colors.reset} - ${masked}`);
    return true;
  }
}

console.log(`${colors.blue}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
console.log(`${colors.blue}🔍 Environment Variables Check${colors.reset}`);
console.log(`${colors.blue}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}\n`);

// Check if .env file exists
const envPath = path.join(__dirname, '..', '.env');
const envExists = fs.existsSync(envPath);
if (envExists) {
  console.log(`${colors.green}✅ .env file found${colors.reset}\n`);
} else {
  console.log(`${colors.yellow}⚠️  .env file not found in root directory${colors.reset}`);
  console.log(`${colors.yellow}   Create one based on ENV_SETUP.md${colors.reset}\n`);
}

console.log(`${colors.blue}Backend Variables (Root .env):${colors.reset}`);
console.log('─'.repeat(70));

let backendOk = true;
backendOk &= check('POLYGON_API_KEY');
backendOk &= check('CHARTSWATCHER_USER_ID');
backendOk &= check('CHARTSWATCHER_API_KEY');
backendOk &= check('CHARTSWATCHER_CONFIG_ID');
backendOk &= check('MONGODB_URI');
backendOk &= check('JWT_SECRET');
backendOk &= check('PNL_API_KEY');
check('PNL_WS_BASE_URL', false);
check('PORT', false);
check('NODE_ENV', false);
check('WS_HEARTBEAT_MS', false);
check('ENABLE_VERIFICATION', false);

console.log(`\n${colors.blue}Frontend Variables (Client .env):${colors.reset}`);
console.log('─'.repeat(70));

const clientEnvPath = path.join(__dirname, '..', 'client', '.env');
const clientEnvExists = fs.existsSync(clientEnvPath);
if (clientEnvExists) {
  console.log(`${colors.green}✅ client/.env file found${colors.reset}\n`);
  // Note: We can't read Vite env vars from Node.js, user needs to check manually
  console.log(`${colors.yellow}⚠️  Frontend variables are checked by Vite at build time${colors.reset}`);
  console.log(`${colors.yellow}   Ensure client/.env has:${colors.reset}`);
  console.log(`${colors.yellow}   - VITE_API_BASE_URL=http://localhost:3001/api${colors.reset}`);
  console.log(`${colors.yellow}   - VITE_WS_BASE_URL=ws://localhost:3001${colors.reset}\n`);
} else {
  console.log(`${colors.yellow}⚠️  client/.env file not found${colors.reset}`);
  console.log(`${colors.yellow}   Create client/.env with:${colors.reset}`);
  console.log(`${colors.yellow}   VITE_API_BASE_URL=http://localhost:3001/api${colors.reset}`);
  console.log(`${colors.yellow}   VITE_WS_BASE_URL=ws://localhost:3001${colors.reset}\n`);
}

console.log(`${colors.blue}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);

if (backendOk) {
  console.log(`${colors.green}✅ Backend environment looks good!${colors.reset}`);
  console.log(`${colors.green}   You can start the server with: npm run dev${colors.reset}\n`);
} else {
  console.log(`${colors.red}❌ Some required backend variables are missing${colors.reset}`);
  console.log(`${colors.yellow}   Check ENV_SETUP.md for setup instructions${colors.reset}\n`);
}

process.exit(backendOk ? 0 : 1);

