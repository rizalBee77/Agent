const axios = require('axios');
const fs = require('fs').promises;
const readline = require('readline');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const BASE_URL = 'https://hamster.xar.name/index.php/api/v1';

const defaultHeaders = {
    'accept': 'application/json, text/plain, */*',
    'accept-language': 'en-US,en;q=0.6',
    'content-type': 'application/json',
    'priority': 'u=1, i',
    'sec-ch-ua': '"Chromium";v="134", "Not:A-Brand";v="24", "Brave";v="134"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'cross-site',
    'sec-gpc': '1',
    'Referer': 'https://web.melodai.pro/',
    'Referrer-Policy': 'strict-origin-when-cross-origin'
};

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

const createLogger = (accountId) => ({
    info: (msg) => console.log(`[Account ${accountId}] [ℹ] ${msg}`),
    success: (msg) => console.log(`[Account ${accountId}] [✔] ${msg}`),
    error: (msg) => console.log(`[Account ${accountId}] [✘] ${msg}`),
    warn: (msg) => console.log(`[Account ${accountId}] [⚠] ${msg}`),
    section: (msg) => console.log(`\n[Account ${accountId}] === ${msg} ===\n`)
});

async function readAccountsFromFile(filename) {
    try {
        const content = await fs.readFile(filename, 'utf8');
        const lines = content.trim().split('\n');
        return lines.map(line => {
            const [token, member_id] = line.trim().split('|');
            return { token: token.startsWith('bearer ') ? token : `bearer ${token}`, member_id };
        }).filter(acc => acc.token && acc.member_id);
    } catch (error) {
        console.error(`Failed to read ${filename}: ${error.message}`);
        return [];
    }
}

async function readProxies(filename) {
    try {
        const content = await fs.readFile(filename, 'utf8');
        return content.trim().split('\n').map(line => line.trim()).filter(line => line);
    } catch (error) {
        console.error(`Failed to read ${filename}: ${error.message}`);
        return [];
    }
}

function getProxyAgent(proxy) {
    if (!proxy) return null;
    try {
        if (proxy.startsWith('http')) {
            return new HttpsProxyAgent(proxy);
        } else if (proxy.startsWith('socks4') || proxy.startsWith('socks5')) {
            return new SocksProxyAgent(proxy);
        } else {
            const parts = proxy.split(':');
            if (parts.length === 2) {
                return new HttpsProxyAgent(`http://${parts[0]}:${parts[1]}`);
            } else if (parts.length === 4) {
                return new HttpsProxyAgent(`http://${parts[2]}:${parts[3]}@${parts[0]}:${parts[1]}`);
            }
        }
        console.warn(`Invalid proxy format: ${proxy}, using no proxy`);
        return null;
    } catch (error) {
        console.error(`Failed to create proxy agent for ${proxy}: ${error.message}`);
        return null;
    }
}

async function getTasks(token, member_id, proxy, log) {
    log.info('Fetching task list...');
    try {
        const response = await axios.post(`${BASE_URL}/getTaskList`, {
            member_id: member_id.toString()
        }, {
            headers: { ...defaultHeaders, 'authorization': token },
            httpsAgent: getProxyAgent(proxy)
        });
        if (response.data.code === 200) {
            return response.data.data;
        } else {
            log.error(`Failed to fetch tasks: ${response.data.msg || 'Unknown error'}`);
            return [];
        }
    } catch (error) {
        log.error(`Error fetching tasks: ${error.response?.data?.msg || error.message}`);
        return [];
    }
}

async function completeTask(token, member_id, task_id, task_name, proxy, log) {
    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        log.info(`Completing task "${task_name}" (Attempt ${attempt}/${maxRetries})...`);
        try {
            const response = await axios.post(`${BASE_URL}/completeTask`, {
                en: 2,
                member_id: member_id.toString(),
                task_id
            }, {
                headers: { ...defaultHeaders, 'authorization': token },
                httpsAgent: getProxyAgent(proxy)
            });
            if (response.data.code === 200) return true;
            log.warn(`Failed to complete task "${task_name}": ${response.data.msg || 'Unknown error'}`);
        } catch (error) {
            log.warn(`Error completing task "${task_name}": ${error.response?.data?.msg || error.message}`);
        }
        await delay(2000);
    }
    return false;
}

async function claimReward(token, member_id, task_id, task_name, proxy, log) {
    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        log.info(`Claiming reward for task "${task_name}" (Attempt ${attempt}/${maxRetries})...`);
        try {
            const response = await axios.post(`${BASE_URL}/claimReward`, {
                member_id: member_id.toString(),
                task_id,
                en: 2
            }, {
                headers: { ...defaultHeaders, 'authorization': token },
                httpsAgent: getProxyAgent(proxy)
            });
            if (response.data.code === 200) return response.data.data.rewards;
            log.warn(`Failed to claim reward for "${task_name}": ${response.data.msg || 'Unknown error'}`);
        } catch (error) {
            log.warn(`Error claiming reward for "${task_name}": ${error.response?.data?.msg || error.message}`);
        }
        await delay(2000);
    }
    return 0;
}

async function getMiningPoolCountdown(token, member_id, proxy, log) {
    log.info('Fetching mining pool countdown time...');
    try {
        const response = await axios.post(`${BASE_URL}/pool_mining_index`, {
            member_id: member_id.toString(),
            en: 2
        }, {
            headers: { ...defaultHeaders, 'authorization': token },
            httpsAgent: getProxyAgent(proxy)
        });

        if (response.data.code === 200) {
            return response.data.data.pool_mining.countDownTime;
        } else {
            log.error(`Failed to fetch countdown: ${response.data.msg || 'Unknown error'}`);
            return -1; 
        }
    } catch (error) {
        log.error(`Error fetching countdown: ${error.response?.data?.msg || error.message}`);
        return -1; 
    }
}

async function getUserCoin(token, member_id, proxy, log) {
    log.info('Fetching user coin and crystal balance...');
    try {
        const response = await axios.post(`${BASE_URL}/getUserCoin`, {
            member_id: member_id.toString()
        }, {
            headers: { ...defaultHeaders, 'authorization': token },
            httpsAgent: getProxyAgent(proxy)
        });

        if (response.data.code === 200) {
            const { coin, crystal } = response.data.data;
            log.info(`Current balance - Coins: ${coin}, Crystals: ${crystal}`);
            return { coin, crystal };
        } else {
            log.error(`Failed to fetch balance: ${response.data.msg || 'Unknown error'}`);
            return null;
        }
    } catch (error) {
        log.error(`Error fetching balance: ${error.response?.data?.msg || error.message}`);
        return null;
    }
}

async function animateCountdown(seconds, log) {
    return new Promise((resolve) => {
        let remaining = seconds;
        process.stdout.write(`${log.prefix} [ℹ] Countdown: ${remaining} seconds remaining\r`);
        
        const interval = setInterval(() => {
            remaining--;
            process.stdout.write(`${log.prefix} [ℹ] Countdown: ${remaining} seconds remaining\r`);
            if (remaining <= 0) {
                clearInterval(interval);
                process.stdout.write('\n'); 
                resolve();
            }
        }, 1000);
    });
}

async function addMiningPool(token, member_id, proxy, log) {
    log.info('Adding mining pool...');
    try {
        const response = await axios.post(`${BASE_URL}/add_receive`, {
            member_id: member_id.toString(),
            pool_id: member_id.toString(),
            en: 2
        }, {
            headers: { ...defaultHeaders, 'authorization': token },
            httpsAgent: getProxyAgent(proxy)
        });

        if (response.data.code === 200) {
            return {
                coin_id: response.data.data.coin_id,
                receive_id: response.data.data.money
            };
        } else {
            log.error(`Failed to add mining pool: ${JSON.stringify(response.data)}`);
            return null;
        }
    } catch (error) {
        log.error(`Error adding mining pool: ${error.response?.data?.msg || error.message}`);
        return null;
    }
}

async function claimMiningPoolDirect(token, member_id, receive_id, coin_id, proxy, log) {
    const maxRetries = 5;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        log.info(`Claiming mining pool coin (Attempt ${attempt}/${maxRetries})...`);
        try {
            const response = await axios.post(`${BASE_URL}/pool_mining_received`, {
                member_id: member_id.toString(),
                en: 2,
                receive_id,
                coin_id
            }, {
                headers: { ...defaultHeaders, 'authorization': token },
                httpsAgent: getProxyAgent(proxy)
            });

            if (response.data.code === 200) {
                return response.data.data.amount;
            } else {
                log.error(`Failed to claim mining pool: ${JSON.stringify(response.data)}`);
            }
        } catch (error) {
            log.error(`Error claiming mining pool: ${error.response?.data?.msg || error.message}`);
        }
        await delay(3000); 
    }
    return 0;
}

async function processAccount(token, member_id, proxies) {
    const proxy = proxies.length > 0 ? proxies[Math.floor(Math.random() * proxies.length)] : null;
    const log = createLogger(member_id); 
    log.info(`Using proxy: ${proxy || 'None'}`);

    log.section(`Processing Account`);
    const tasks = await getTasks(token, member_id, proxy, log);
    if (tasks.length === 0) {
        log.warn('No tasks available or failed to fetch task list');
    }
    for (const task of tasks) {
        if (task.completed === 0) {
            const completed = await completeTask(token, member_id, task.id, task.task_name, proxy, log);
            if (completed) {
                const reward = await claimReward(token, member_id, task.id, task.task_name, proxy, log);
                if (reward > 0) {
                    log.success(`Task "${task.task_name}" completed - Reward: ${reward}`);
                } else {
                    log.error(`Failed to claim reward for "${task.task_name}"`);
                }
            } else {
                log.error(`Failed to complete task "${task.task_name}" after multiple attempts`);
            }
            await delay(1000);
        } else {
            log.info(`Task "${task.task_name}" already completed`);
        }
    }

    log.section(`Starting Mining Pool Claim Loop`);
    while (true) { 
        let countdown = await getMiningPoolCountdown(token, member_id, proxy, log);
        if (countdown > 0) {
            log.info(`Countdown started: ${countdown} seconds remaining`);
            await animateCountdown(countdown, log);
            log.info('Countdown finished, proceeding to add and claim mining pool...');
        } else if (countdown === 0) {
            log.info('No countdown active, proceeding to add and claim mining pool...');
        } else {
            log.warn('Unable to fetch countdown time, retrying in 5 seconds...');
            await delay(5000);
            continue;
        }

        const poolData = await addMiningPool(token, member_id, proxy, log);
        if (poolData) {
            const amount = await claimMiningPoolDirect(token, member_id, poolData.receive_id, poolData.coin_id, proxy, log);
            if (amount > 0) {
                log.success(`Mining pool coin claimed - Amount: ${amount}`);
            } else {
                log.warn('Failed to claim mining pool coin');
            }
        } else {
            log.warn('Failed to add mining pool, retrying in 5 seconds...');
            await delay(5000);
            continue;
        }

        await getUserCoin(token, member_id, proxy, log);

        log.info('Waiting 5 seconds before next cycle...');
        await delay(5000); 
    }
}

async function main() {
    console.log('\n=== MelodAI Auto Bot - AirdorpInsiders ===\n');
    console.log('[ℹ] Select run mode:');
    console.log('[ℹ] 1. Single account (manual input)');
    console.log('[ℹ] 2. Multi account (from accounts.txt)');

    const mode = await new Promise(resolve => rl.question('[?] Enter mode (1 or 2): ', resolve));
    const proxies = await readProxies('proxies.txt');
    console.log(`[ℹ] Loaded ${proxies.length} proxies from proxies.txt`);

    if (mode === '1') {
        const token = await new Promise(resolve => rl.question('[?] Enter bearer token: ', resolve));
        if (!token) {
            console.error('[✘] Token cannot be empty');
            rl.close();
            return;
        }
        const memberId = await new Promise(resolve => rl.question('[?] Enter member_id: ', resolve));
        if (!memberId) {
            console.error('[✘] Member ID cannot be empty');
            rl.close();
            return;
        }
        console.log(`[ℹ] Using token: ${token.substring(0, 20)}...`);
        console.log(`[ℹ] Member ID: ${memberId}`);
        await processAccount(token.startsWith('bearer ') ? token : `bearer ${token}`, memberId, proxies);
    } else if (mode === '2') {
        const accounts = await readAccountsFromFile('accounts.txt');
        if (accounts.length === 0) {
            console.error('[✘] No valid accounts found in accounts.txt. Format: token|member_id per line');
            rl.close();
            return;
        }
        console.log(`[ℹ] Loaded ${accounts.length} accounts from accounts.txt`);
        
        await Promise.all(accounts.map(account => processAccount(account.token, account.member_id, proxies)));
    } else {
        console.error('[✘] Invalid mode selected. Please choose 1 or 2.');
    }
    rl.close();
}

main().catch(error => {
    console.error(`[✘] Fatal error: ${error.message}`);
    rl.close();
});