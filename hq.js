const fetch = require('node-fetch');
const fs = require('fs').promises;
const chalk = require('chalk');

const API_URL = "https://api.hackquest.io/graphql";
const DAILY_MISSION_ID = "e3fab3d3-e986-4076-9551-b265edaf454d";

const FEED_COST = 5;
const REFRESH_RATE = 1000; 

const headers = {
    "accept": "application/graphql-response+json",
    "content-type": "application/json",
    "accept-language": "en-US,en;q=0.9",
    "sec-ch-ua": "\"Chromium\";v=\"134\", \"Not:A-Brand\";v=\"24\", \"Brave\";v=\"134\"",
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": "\"Windows\"",
    "Referer": "https://www.hackquest.io/",
    "Referrer-Policy": "strict-origin-when-cross-origin"
};

async function readBearerToken() {
    try {
        const data = await fs.readFile('token.txt', 'utf8');
        const tokens = data.split('\n').map(token => token.trim()).filter(token => token);
        return tokens.length > 0 ? tokens[0] : null;
    } catch (error) {
        console.error(chalk.red('[ERROR] Failed to read token.txt:', error.message));
        return null;
    }
}

async function getPetData(accessToken) {
    console.log(chalk.yellow('[INFO] Fetching pet data...'));
    const petQuery = {
        query: `
            query MyPet {
                myPet {
                    exp
                    expNextLevel
                    id
                    level
                    name
                    userId
                }
            }
        `
    };

    const petHeaders = { ...headers, "authorization": `Bearer ${accessToken}` };
    const response = await fetch(API_URL, { method: "POST", headers: petHeaders, body: JSON.stringify(petQuery) });
    const data = await response.json();

    if (!data.data?.myPet) {
        console.error(chalk.red('[ERROR] Failed to fetch pet data:', data.errors ? data.errors[0].message : 'Unknown error'));
        return null;
    }
    return data.data.myPet;
}

async function getUserProfileById(accessToken, userId) {
    console.log(chalk.yellow('[INFO] Fetching user profile...'));
    const profileQuery = {
        query: `
            query GetUser($id: String!) {
                user: findUser(id: $id) {
                    id
                    username
                    nickname
                    avatar
                }
            }
        `,
        variables: { id: userId }
    };

    const profileHeaders = { ...headers, "authorization": `Bearer ${accessToken}` };
    const response = await fetch(API_URL, { method: "POST", headers: profileHeaders, body: JSON.stringify(profileQuery) });
    const data = await response.json();

    if (!data.data?.user) {
        return await getUserProfileAlternate(accessToken);
    }
    return data.data.user;
}

async function getUserProfileAlternate(accessToken) {
    console.log(chalk.yellow('[INFO] Trying alternative profile fetch method...'));
    
    try {
        const tokenParts = accessToken.split('.');
        if (tokenParts.length === 3) {
            const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64').toString());
            return {
                id: payload.id || 'Unknown',
                username: payload.name || 'Unknown',
                nickname: null
            };
        }
    } catch (error) {
        console.error(chalk.red('[ERROR] Failed to decode token:', error.message));
    }
    
    return {
        id: 'Unknown',
        username: 'Unknown',
        nickname: null
    };
}

async function claimDailyMission(accessToken) {
    console.log(chalk.yellow('[INFO] Claiming daily mission...'));
    const claimQuery = {
        query: `
            mutation ClaimMissionReward($missionId: String!) {
                claimMissionReward(missionId: $missionId) {
                    coin
                    exp
                }
            }
        `,
        variables: { missionId: DAILY_MISSION_ID }
    };

    const claimHeaders = { ...headers, "authorization": `Bearer ${accessToken}` };
    const response = await fetch(API_URL, { method: "POST", headers: claimHeaders, body: JSON.stringify(claimQuery) });
    const data = await response.json();

    if (!data.data?.claimMissionReward) {
        console.error(chalk.red('[ERROR] Failed to claim daily mission:', data.errors ? data.errors[0].message : 'Unknown error'));
        return null;
    }
    return data.data.claimMissionReward;
}

async function feedPet(accessToken, amount) {
    const feedQuery = {
        query: `
            mutation FeedPet($amount: Float!) {
                feedPet(amount: $amount) {
                    userId
                    level
                    exp
                }
            }
        `,
        variables: { amount }
    };

    const feedHeaders = { ...headers, "authorization": `Bearer ${accessToken}` };
    const response = await fetch(API_URL, { method: "POST", headers: feedHeaders, body: JSON.stringify(feedQuery) });
    const data = await response.json();

    if (!data.data?.feedPet) {
        const errorMsg = data.errors ? data.errors[0].message : 'Unknown error';
        console.log(chalk.red(`[INFO] Feed stopped: ${errorMsg}`));
        return null;
    }
    return data.data.feedPet;
}

function printHeader() {
    console.log(chalk.cyan.bold('==============================================='));
    console.log(chalk.cyan.bold('      HackQuest Auto Bot | Airdrop Insiders    '));
    console.log(chalk.cyan.bold('==============================================='));
}

function printFooter() {
    console.log(chalk.cyan.bold('==============================================='));
}

function formatTime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function startCountdown() {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    
    const offset = 7 * 60 * 60 * 1000; 
    const tomorrowUTC7 = new Date(tomorrow.getTime() + offset);
    
    let secondsRemaining = Math.floor((tomorrowUTC7 - now) / 1000);
    
    console.log(chalk.magenta('\n[COUNTDOWN] Waiting for next daily claim...'));
    
    process.stdout.write('\r');
    
    const intervalId = setInterval(() => {
        if (secondsRemaining <= 0) {
            clearInterval(intervalId);
            console.log(chalk.green('\n[SUCCESS] Countdown complete! Running daily claim...'));
            runDailyTasks();
            return;
        }
        
        const timeFormatted = formatTime(secondsRemaining);
        const progressBar = createProgressBar(secondsRemaining, 86400); 
        
        process.stdout.clearLine(0);
        process.stdout.cursorTo(0);
        process.stdout.write(`${chalk.yellow('⏳ Next daily claim in:')} ${chalk.cyan(timeFormatted)} ${progressBar}`);
        
        secondsRemaining--;
    }, REFRESH_RATE);
}

function createProgressBar(secondsRemaining, totalSeconds) {
    const barLength = 20;
    const progress = Math.max(0, 1 - (secondsRemaining / totalSeconds));
    const filledLength = Math.floor(barLength * progress);
    
    const filledBar = '█'.repeat(filledLength);
    const emptyBar = '░'.repeat(barLength - filledLength);
    
    return chalk.cyan(`[${filledBar}${emptyBar}] ${Math.floor(progress * 100)}%`);
}

async function checkActiveMissions(accessToken) {
    console.log(chalk.yellow('[INFO] Checking active missions...'));
    const missionsQuery = {
        query: `
            query GetMissions {
                missions {
                    id
                    name
                    isActive
                    isDailyClaimed
                }
            }
        `
    };

    const missionsHeaders = { ...headers, "authorization": `Bearer ${accessToken}` };
    const response = await fetch(API_URL, { method: "POST", headers: missionsHeaders, body: JSON.stringify(missionsQuery) });
    const data = await response.json();

    if (!data.data?.missions) {
        return await checkActiveMissionsAlternate(accessToken);
    }
    
    const dailyMission = data.data.missions.find(m => m.id === DAILY_MISSION_ID);
    return dailyMission;
}

async function checkActiveMissionsAlternate(accessToken) {
    console.log(chalk.yellow('[INFO] Trying alternative missions query...'));
    const missionsQuery = {
        query: `
            query GetMissionList {
                getMissionList {
                    missions {
                        id
                        name
                        isActive
                        isDailyClaimed
                    }
                }
            }
        `
    };

    const missionsHeaders = { ...headers, "authorization": `Bearer ${accessToken}` };
    
    try {
        const response = await fetch(API_URL, { method: "POST", headers: missionsHeaders, body: JSON.stringify(missionsQuery) });
        const data = await response.json();

        if (data.data?.getMissionList?.missions) {
            const dailyMission = data.data.getMissionList.missions.find(m => m.id === DAILY_MISSION_ID);
            return dailyMission;
        }
    } catch (error) {
        console.error(chalk.red('[ERROR] Failed to fetch missions with alternative query:', error.message));
    }
    
    console.log(chalk.yellow('[INFO] Unable to verify mission status, will attempt direct claim'));
    
    return {
        id: DAILY_MISSION_ID,
        name: "Daily Login",
        isActive: true,
        isDailyClaimed: false
    };
}

async function getWalletBalance(accessToken) {
    console.log(chalk.yellow('[INFO] Checking wallet balance...'));
    const walletQuery = {
        query: `
            query GetWallet {
                wallet {
                    coin
                }
            }
        `
    };

    const walletHeaders = { ...headers, "authorization": `Bearer ${accessToken}` };
    
    try {
        const response = await fetch(API_URL, { method: "POST", headers: walletHeaders, body: JSON.stringify(walletQuery) });
        const data = await response.json();

        if (data.data?.wallet) {
            return data.data.wallet.coin;
        }
    } catch (error) {
        console.error(chalk.red('[ERROR] Failed to fetch wallet balance:', error.message));
    }
    
    return null;
}

async function runDailyTasks() {
    printHeader();

    const accessToken = await readBearerToken();
    if (!accessToken) {
        console.error(chalk.red('[ERROR] No valid bearer token found in token.txt'));
        printFooter();
        startCountdown(); 
        return;
    }
    console.log(chalk.green('[SUCCESS] Bearer token loaded:', accessToken.slice(0, 20) + '...'));

    const petData = await getPetData(accessToken);
    if (!petData) {
        printFooter();
        startCountdown();
        return;
    }

    const userData = await getUserProfileById(accessToken, petData.userId);
    
    console.log(chalk.green('\nUser & Pet Data:'));
    console.log(chalk.white(`- User ID: ${userData.id}`));
    console.log(chalk.white(`- Username: ${userData.username}`));
    console.log(chalk.white(`- Nickname: ${userData.nickname || 'Not available'}`));
    console.log(chalk.white(`- Pet: ${petData.name} (Level ${petData.level}, Exp ${petData.exp}/${petData.expNextLevel})`));

    const dailyMission = await checkActiveMissions(accessToken);
    
    if (dailyMission && (!dailyMission.isDailyClaimed || dailyMission.isDailyClaimed === undefined)) {
        const dailyReward = await claimDailyMission(accessToken);
        if (dailyReward) {
            console.log(chalk.green('\n[SUCCESS] Daily Mission Claimed:'));
            console.log(chalk.white(`- Coins: +${dailyReward.coin}`));
            console.log(chalk.white(`- Exp: +${dailyReward.exp}`));
        } else {
            console.log(chalk.yellow('\n[INFO] Failed to claim daily mission or already claimed'));
        }
    } else {
        console.log(chalk.yellow('\n[INFO] Daily mission already claimed or not available'));
    }

    const balance = await getWalletBalance(accessToken);
    if (balance !== null) {
        console.log(chalk.white(`\n- Current Balance: ${balance} coins`));
        
        const maxFeeds = Math.floor(balance / FEED_COST);
        console.log(chalk.white(`- Maximum Possible Feeds: ${maxFeeds}`));
    }

    console.log(chalk.yellow('\n[INFO] Starting pet feeding...'));
    let feedCount = 0;

    while (true) {
        const feedResult = await feedPet(accessToken, FEED_COST);
        if (!feedResult) {
            break; 
        }

        feedCount++;
        console.log(chalk.green(`[SUCCESS] Fed pet ${feedCount} time(s):`));
        console.log(chalk.white(`- Level: ${feedResult.level}`));
        console.log(chalk.white(`- Exp: ${feedResult.exp}`));
        await new Promise(resolve => setTimeout(resolve, 500)); 
    }

    if (feedCount === 0) {
        console.log(chalk.red('[INFO] No feeding occurred (possibly no coins or error)'));
    } else {
        console.log(chalk.green(`[SUMMARY] Successfully fed pet ${feedCount} time(s)`));
    }

    printFooter();
    
    startCountdown();
}

runDailyTasks().catch(error => {
    console.error(chalk.red('[ERROR] Main process failed:', error.message));
    printFooter();
    startCountdown(); 
});