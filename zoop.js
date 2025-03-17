const fs = require('fs');
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');

const CONFIG = {
  authEndpoint: "https://tgapi.zoop.com/api/oauth/telegram",
  spinEndpoint: "https://tgapi.zoop.com/api/users/spin",
  taskEndpoint: "https://tgapi.zoop.com/api/tasks",
  queryPath: "./token.txt",
  proxyPath: "./proxies.txt",
  retryDelay: 5000, // 5 seconds between retries on failure
  spinDelayMin: 2000, // Minimum delay between spins (2 seconds)
  spinDelayMax: 5000, // Maximum delay between spins (5 seconds)
  checkInterval: 3600000, // Check every 1 hour if no spins available
  dailyCheckInterval: 1800000, // Check daily claim every 30 minutes
  spinCheckInterval: 300000, // Check spin availability every 5 minutes
  logFile: "./bot_log.txt",
  headers: {
    "accept": "*/*",
    "accept-language": "en-US,en;q=0.9",
    "content-type": "application/json",
    "sec-ch-ua": "\"Chromium\";v=\"133\", \"Microsoft Edge WebView2\";v=\"133\", \"Not(A:Brand\";v=\"99\", \"Microsoft Edge\";v=\"133\"",
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": "\"Windows\"",
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-site",
    "Referer": "https://tgapp.zoop.com/",
    "Referrer-Policy": "strict-origin-when-cross-origin"
  }
};

const BANNER = `
=====================================
  Zoop Auto Spin + Daily | Airdrop Insider
=====================================
`;

function logMessage(message) {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] ${message}`;
  const styledOutput = `[${timestamp}] ===> ${message}`;
  console.log(styledOutput);
  fs.appendFileSync(CONFIG.logFile, logEntry + "\n");
}

function getRandomDelay(min, max) {
  return Math.floor(Math.random() * (max - min + 1) + min);
}

function getQueryId() {
  try {
    const queryId = fs.readFileSync(CONFIG.queryPath, 'utf8').trim();
    return queryId;
  } catch (error) {
    logMessage(`Error reading query file: ${error.message}`);
    throw new Error("Failed to read query file. Make sure token.txt exists with a valid query ID.");
  }
}

function parseUserIdFromQuery(queryId) {
  try {
    const params = new URLSearchParams(queryId);
    const userData = params.get('user');
    if (!userData) throw new Error("No user data found in query ID");
    const user = JSON.parse(decodeURIComponent(userData));
    return user.id;
  } catch (error) {
    logMessage(`Error parsing userId from query: ${error.message}`);
    throw error;
  }
}

function loadProxies() {
  try {
    if (!fs.existsSync(CONFIG.proxyPath)) {
      logMessage("No proxies.txt found. Running without proxy.");
      return null;
    }
    const proxies = fs.readFileSync(CONFIG.proxyPath, 'utf8').split('\n').map(line => line.trim()).filter(line => line);
    if (proxies.length === 0) {
      logMessage("proxies.txt is empty. Running without proxy.");
      return null;
    }
    const proxy = proxies[Math.floor(Math.random() * proxies.length)];
    return parseProxy(proxy);
  } catch (error) {
    logMessage(`Error loading proxies: ${error.message}`);
    return null;
  }
}

function parseProxy(proxyString) {
  let protocol = 'http';
  let host, port, username, password;

  if (proxyString.startsWith('http://') || proxyString.startsWith('socks4://') || proxyString.startsWith('socks5://')) {
    const [proto, rest] = proxyString.split('://');
    protocol = proto;
    const parts = rest.split(':');
    if (parts.length >= 2) {
      host = parts[0];
      port = parts[1];
      if (parts.length === 4) {
        username = parts[2];
        password = parts[3];
      }
    }
  } else {
    const parts = proxyString.split(':');
    if (parts.length >= 2) {
      host = parts[0];
      port = parts[1];
      if (parts.length === 4) {
        username = parts[2];
        password = parts[3];
      }
    }
  }

  if (!host || !port) {
    logMessage(`Invalid proxy format: ${proxyString}`);
    return null;
  }

  const proxyUrl = username && password 
    ? `${protocol}://${username}:${password}@${host}:${port}`
    : `${protocol}://${host}:${port}`;
  
  logMessage(`Using proxy: ${proxyUrl}`);
  return new HttpsProxyAgent(proxyUrl);
}

async function getAccessTokenAndInfo(queryId, proxyAgent) {
  try {
    const payload = { initData: queryId };
    const config = proxyAgent ? { headers: CONFIG.headers, httpsAgent: proxyAgent } : { headers: CONFIG.headers };
    const response = await axios.post(CONFIG.authEndpoint, payload, config);
    const token = response.data.data.access_token;
    const info = response.data.data.information;
    logMessage(`Access token retrieved successfully`);
    logMessage(`User Info - Username: ${info.username}, Points: ${info.point}, Spins: ${info.spin}, IsCheat: ${info.isCheat}`);
    return { token, info };
  } catch (error) {
    logMessage(`Error getting access token: ${error.response?.data?.message || error.message}`);
    throw error;
  }
}

async function checkDailyInfo(token, userId, proxyAgent) {
  try {
    const headers = { ...CONFIG.headers, "authorization": `Bearer ${token}` };
    const taskEndpoint = `${CONFIG.taskEndpoint}/${userId}`;
    const config = proxyAgent ? { headers, httpsAgent: proxyAgent } : { headers };
    
    logMessage(`Checking daily info from endpoint: ${taskEndpoint}`);
    const response = await axios.get(taskEndpoint, config);
    
    const taskData = response.data.data;
    logMessage(`Daily task data: ${JSON.stringify(taskData)}`);
    
    const dailyClaimInfo = {
      dailyClaimed: taskData.claimed,
      dayClaim: taskData.dayClaim,
      dailyIndex: taskData.dailyIndex
    };
    
    logMessage(`Daily claim status: ${dailyClaimInfo.dailyClaimed ? 'Claimed' : 'Not Claimed'}`);
    logMessage(`Daily claim date: ${dailyClaimInfo.dayClaim}`);
    logMessage(`Daily index: ${dailyClaimInfo.dailyIndex}`);
    
    return dailyClaimInfo;
  } catch (error) {
    logMessage(`Error checking daily info: ${error.response?.data?.message || error.message}`);
    throw error;
  }
}

async function claimDailyTask(token, userId, proxyAgent, dailyIndex) {
  try {
    const headers = { ...CONFIG.headers, "authorization": `Bearer ${token}` };
    const dailyTaskEndpoint = `${CONFIG.taskEndpoint}/rewardDaily/${userId}`;
    const payload = { index: dailyIndex };
    const config = proxyAgent ? { headers, httpsAgent: proxyAgent } : { headers };
    
    logMessage(`Attempting to claim daily task for day ${dailyIndex}...`);
    logMessage(`Payload: ${JSON.stringify(payload)}`);
    
    const response = await axios.post(dailyTaskEndpoint, payload, config);
    
    logMessage(`Daily task claimed successfully!`);
    logMessage(`Response: ${JSON.stringify(response.data)}`);
    
    return response.data;
  } catch (error) {
    logMessage(`Error claiming daily task: ${error.response?.data?.message || error.message}`);
    throw error;
  }
}

async function performSpin(token, userId, proxyAgent) {
  try {
    const headers = { ...CONFIG.headers, "authorization": `Bearer ${token}` };
    const currentDate = new Date().toISOString();
    const payload = { userId, date: currentDate };
    const config = proxyAgent ? { headers, httpsAgent: proxyAgent } : { headers };
    
    const delay = getRandomDelay(CONFIG.spinDelayMin, CONFIG.spinDelayMax);
    logMessage(`Waiting for ${delay/1000} seconds before spinning...`);
    await new Promise(resolve => setTimeout(resolve, delay));
    
    logMessage("Attempting to perform spin...");
    const response = await axios.post(CONFIG.spinEndpoint, payload, config);
    
    const reward = response.data.data.circle.name || "Unknown";
    logMessage(`Spin completed successfully! Reward: ${reward} points`);
    return response.data;
  } catch (error) {
    logMessage(`Error performing spin: ${error.response?.data?.message || error.message}`);
    throw error;
  }
}

async function executeWithRetry(fn, ...args) {
  let attempts = 0;
  const maxAttempts = 3;
  
  while (attempts < maxAttempts) {
    try {
      return await fn(...args);
    } catch (error) {
      attempts++;
      if (attempts >= maxAttempts) {
        logMessage(`Failed after ${maxAttempts} attempts. Giving up.`);
        throw error;
      }
      logMessage(`Attempt ${attempts} failed. Retrying in ${CONFIG.retryDelay/1000} seconds...`);
      await new Promise(resolve => setTimeout(resolve, CONFIG.retryDelay));
    }
  }
}

async function checkAndClaimDaily(token, userId, proxyAgent) {
  try {
    const dailyInfo = await executeWithRetry(checkDailyInfo, token, userId, proxyAgent);
    const todayDate = new Date().toISOString().split('T')[0];
    
    if (dailyInfo.dailyClaimed) {
      logMessage(`Daily task already claimed for today (${todayDate})`);
      return dailyInfo;
    }
    
    if (dailyInfo.dayClaim === todayDate) {
      let dailyIndex = dailyInfo.dailyIndex;
      
      if (!dailyIndex && dailyIndex !== 0) {
        logMessage(`Warning: dailyIndex not found in API response. Using default value 1.`);
        dailyIndex = 1;
      }
      
      logMessage(`Found dailyIndex ${dailyIndex} from API response. Using this for daily claim.`);
      await executeWithRetry(claimDailyTask, token, userId, proxyAgent, dailyIndex);
      
      const updatedDailyInfo = await executeWithRetry(checkDailyInfo, token, userId, proxyAgent);
      if (updatedDailyInfo.dailyClaimed) {
        logMessage(`Daily claim successful for day ${dailyIndex}!`);
      } else {
        logMessage(`Daily claim attempt failed. Will retry on next check.`);
      }
      
      return updatedDailyInfo;
    } else {
      logMessage(`Daily task not yet available for today (${todayDate}). Current date in system: ${dailyInfo.dayClaim}`);
      return dailyInfo;
    }
  } catch (error) {
    logMessage(`Error in daily claim process: ${error.message}`);
    throw error;
  }
}

async function useAllSpins(token, userId, proxyAgent, spinCount) {
  try {
    logMessage(`Starting to use all available ${spinCount} spins...`);
    
    let remainingSpins = spinCount;
    
    while (remainingSpins > 0) {
      await executeWithRetry(performSpin, token, userId, proxyAgent);
      remainingSpins--;
      logMessage(`Spin completed. Remaining spins: ${remainingSpins}`);
    }
    
    logMessage(`All spins have been used successfully!`);
    return true;
  } catch (error) {
    logMessage(`Error using all spins: ${error.message}`);
    throw error;
  }
}

async function checkSpinCount(queryId, proxyAgent) {
  const { info } = await executeWithRetry(getAccessTokenAndInfo, queryId, proxyAgent);
  return info.spin;
}

async function runBot() {
  console.log(BANNER);
  
  try {
    logMessage("Bot initialized successfully!");
    
    const queryId = getQueryId();
    const userId = parseUserIdFromQuery(queryId);
    logMessage(`User ID extracted: ${userId}`);
    
    const proxyAgent = loadProxies();
    
    let { token, info } = await executeWithRetry(getAccessTokenAndInfo, queryId, proxyAgent);
    let spinCount = info.spin;
    
    let dailyInfo = await checkAndClaimDaily(token, userId, proxyAgent);
    
    spinCount = await checkSpinCount(queryId, proxyAgent);
    logMessage(`Initial spin count: ${spinCount}`);
    
    while (true) {
      const currentTime = new Date();
      const currentDateStr = currentTime.toISOString().split('T')[0];
      
      if (currentTime.getHours() % 2 === 0 && currentTime.getMinutes() < 5) {
        logMessage("Refreshing access token...");
        const refreshedAuth = await executeWithRetry(getAccessTokenAndInfo, queryId, proxyAgent);
        token = refreshedAuth.token;
        info = refreshedAuth.info;
        spinCount = info.spin;
      }
      
      if (!dailyInfo.dailyClaimed || dailyInfo.dayClaim !== currentDateStr) {
        logMessage("Checking daily claim status...");
        dailyInfo = await checkAndClaimDaily(token, userId, proxyAgent);
        
        spinCount = await checkSpinCount(queryId, proxyAgent);
        logMessage(`After daily claim check, current spin count: ${spinCount}`);
      }
      
      if (spinCount > 0) {
        logMessage(`Found ${spinCount} available spins. Starting to use them all...`);
        await useAllSpins(token, userId, proxyAgent, spinCount);
        
        spinCount = await checkSpinCount(queryId, proxyAgent);
        logMessage(`After using spins, current spin count: ${spinCount}`);
      } else {
        logMessage("No spin tickets available. Waiting for next check...");
      }
      
      logMessage(`Waiting for ${CONFIG.spinCheckInterval/1000} seconds before checking for new spins...`);
      await new Promise(resolve => setTimeout(resolve, CONFIG.spinCheckInterval));
      
      spinCount = await checkSpinCount(queryId, proxyAgent);
      logMessage(`Periodic spin check: ${spinCount} spin(s) available`);
      
      if (Math.random() < 0.5) { 
        await new Promise(resolve => setTimeout(resolve, CONFIG.dailyCheckInterval));
        logMessage("Performing routine daily claim check...");
        dailyInfo = await checkAndClaimDaily(token, userId, proxyAgent);
      }
    }
  } catch (error) {
    logMessage(`Bot encountered an error: ${error.message}`);
    logMessage("Attempting to restart bot in 60 seconds...");
    setTimeout(runBot, 60000);
  }
}

if (!fs.existsSync(CONFIG.logFile)) {
  fs.writeFileSync(CONFIG.logFile, "");
}

runBot();

process.on('SIGINT', () => {
  logMessage("Bot stopped by user");
  process.exit(0);
});