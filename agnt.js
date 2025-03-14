const axios = require('axios');
const cron = require('node-cron');
const fs = require('fs').promises;
require('dotenv').config();

const headers = {
  "accept": "application/json, text/plain, */*",
  "accept-language": "en-US,en;q=0.5",
  "priority": "u=1, i",
  "sec-ch-ua": "\"Chromium\";v=\"134\", \"Not:A-Brand\";v=\"24\", \"Brave\";v=\"134\"",
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": "\"Windows\"",
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-site",
  "sec-gpc": "1",
  "origin": "https://quests.agnthub.ai",
  "referer": "https://quests.agnthub.ai/",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36"
};

const BASE_URL = "https://hub-api.agnthub.ai";

async function loadCookie() {
  try {
    const cookie = await fs.readFile('token.txt', 'utf8');
    headers.cookie = cookie.trim();
  } catch (error) {
    console.error('Error loading cookie from token.txt:', error.message);
    process.exit(1);
  }
}

async function makeRequest(url, method = "POST") {
  try {
    console.log(`Executing task: ${url}`);
    const response = await axios({
      method: method,
      url: url,
      headers: headers
    });
    console.log(`Task completed successfully: ${response.status}`);
    console.log("Response data:", JSON.stringify(response.data, null, 2));
    return response.data;
  } catch (error) {
    console.error(`Error executing task ${url}:`, error.message);
    if (error.response) {
      console.error(`Status code: ${error.response.status}`);
      console.error(`Response data:`, error.response.data);
    }
    return null;
  }
}

async function getUserData() {
  try {
    const response = await axios({
      method: "GET",
      url: `${BASE_URL}/api/users`,
      headers: headers
    });
    console.log("User data retrieved successfully");
    console.log(`Current points: ${response.data.points}`);
    return response.data;
  } catch (error) {
    console.error("Error retrieving user data:", error.message);
    return null;
  }
}

async function getDailyRewards() {
  try {
    const response = await axios({
      method: "GET",
      url: `${BASE_URL}/api/daily-rewards`,
      headers: headers
    });
    console.log("Daily rewards data retrieved successfully");
    return response.data;
  } catch (error) {
    console.error("Error retrieving daily rewards data:", error.message);
    return null;
  }
}

async function getMyTasks() {
  try {
    const response = await axios({
      method: "GET",
      url: `${BASE_URL}/api/tasks/my`,
      headers: headers
    });
    console.log("Task list retrieved successfully");
    return response.data;
  } catch (error) {
    console.error("Error retrieving task list:", error.message);
    return null;
  }
}

async function completeTask(task) {
  try {
    console.log(`Processing task: ${task.id} - ${task.title || 'Unnamed task'}`);
    console.log(`Current status: ${task.status}, Type: ${task.type}, TaskStatus: ${task.taskStatus}`);
    
    let apiUrl = null;
    let needsVerification = false;
    
    if (task.type === 'MAKE_AI_LAUGH') {
      apiUrl = `${BASE_URL}/api/tasks/make-ai-laugh/${task.id}`;
    } else if (task.taskStatus === "ACTIVE") {
      if (task.type === "SOCIAL" || task.type === "LEARN_EARN") {
        if (!task.status || task.status === "NOT_STARTED") {
          apiUrl = `${BASE_URL}/api/tasks/start/${task.id}`;
          needsVerification = true;
        } else if (task.status === "IN_PROGRESS") {
          apiUrl = `${BASE_URL}/api/tasks/complete/${task.id}`;
          needsVerification = true;
        }
      }
      else if (!task.status || task.status === "NOT_STARTED") {
        apiUrl = `${BASE_URL}/api/tasks/start/${task.id}`;
        needsVerification = true;
      } else if (task.status === "IN_PROGRESS") {
        apiUrl = `${BASE_URL}/api/tasks/complete/${task.id}`;
        needsVerification = true;
      }
    } 
    
    if (task.status === "DONE" && !task.claimed) {
      apiUrl = `${BASE_URL}/api/tasks/claim/${task.id}`;
    }
    
    if (!apiUrl) {
      console.log(`No action needed for task ${task.id} with status: ${task.status}`);
      return null;
    }
    
    const result = await makeRequest(apiUrl, "POST");
    
    if (needsVerification && result) {
      console.log(`Verifying task status for ${task.id}`);
      await new Promise(resolve => setTimeout(resolve, 2000));
      const updatedTask = await verifyTaskStatus(task.id);
      
      if (updatedTask && updatedTask.status === "DONE" && !updatedTask.claimed) {
        console.log(`Task ${task.id} is done but not claimed, claiming now...`);
        await makeRequest(`${BASE_URL}/api/tasks/claim/${task.id}`, "POST");
      }
      
      return updatedTask;
    }
    
    return result;
  } catch (error) {
    console.error(`Error completing task ${task.id}:`, error.message);
    return null;
  }
}

async function verifyTaskStatus(taskId) {
  try {
    const taskData = await getMyTasks();
    if (!taskData) return null;
    
    const categories = ['available', 'inProgress', 'done'];
    for (const category of categories) {
      if (!taskData[category]) continue;
      
      const found = taskData[category].find(t => t.id === taskId);
      if (found) {
        console.log(`Verified task ${taskId} status: ${found.status}, claimed: ${found.claimed}`);
        return found;
      }
    }
    
    console.log(`Task ${taskId} not found in any category`);
    return null;
  } catch (error) {
    console.error(`Error verifying task status for ${taskId}:`, error.message);
    return null;
  }
}

async function processAvailableTasks() {
  const userBefore = await getUserData();
  const taskData = await getMyTasks();
  
  if (!taskData || typeof taskData !== 'object') {
    console.error("Failed to retrieve task list or invalid response");
    return;
  }
  
  const availableTasks = taskData.available || [];
  const inProgressTasks = taskData.inProgress || [];
  const doneTasks = taskData.done || [];
  
  console.log(`Found ${availableTasks.length} available tasks`);
  console.log(`Found ${inProgressTasks.length} in-progress tasks`);
  console.log(`Found ${doneTasks.length} completed tasks`);
  
  const tasksToProcess = [...inProgressTasks, ...availableTasks];
  const unclaimedTasks = doneTasks.filter(task => !task.claimed);
  if (unclaimedTasks.length > 0) {
    console.log(`Found ${unclaimedTasks.length} completed but unclaimed tasks`);
    tasksToProcess.push(...unclaimedTasks);
  }
  
  for (const task of tasksToProcess) {
    await completeTask(task);
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  const userAfter = await getUserData();
  
  if (userBefore && userAfter) {
    const pointsDifference = userAfter.points - userBefore.points;
    console.log(`Points before: ${userBefore.points}, Points after: ${userAfter.points}`);
    console.log(`Earned ${pointsDifference} points in this session`);
  }
  
  console.log("Finished processing all tasks");
}

async function claimDailyRewards() {
  const rewardsData = await getDailyRewards();
  if (rewardsData && !rewardsData.todayClaimed) {
    console.log("Claiming daily rewards");
    const result = await makeRequest(`${BASE_URL}/api/daily-rewards/claim`);
    if (result) {
      console.log(`Daily rewards claimed successfully: ${result.points} points`);
    }
  } else {
    console.log("Daily rewards already claimed or status couldn't be retrieved");
  }
}

async function executeAllTasks() {
  console.log("Starting task execution at", new Date().toISOString());
  
  const userData = await getUserData();
  if (!userData) {
    console.error("Failed to get user data. Aborting task execution.");
    return;
  }
  
  await claimDailyRewards();
  await processAvailableTasks();
  
  const finalUserData = await getUserData();
  console.log(`Session complete. Current points: ${finalUserData ? finalUserData.points : 'unknown'}`);
  console.log("All tasks executed at", new Date().toISOString());
}

function displayBanner() {
  console.log("========================================");
  console.log("     AGNT Hub Bot - Airdrop Insiders    ");
  console.log("========================================");
}

async function main() {
  await loadCookie();
  displayBanner();
  console.log("AgntHub auto-complete task bot started");
  
  await executeAllTasks();
  
  cron.schedule('*/10 * * * *', async () => {
    displayBanner();
    console.log("Running scheduled tasks every 10 minutes");
    await executeAllTasks();
  });
  
  console.log("Bot is running and will execute tasks every 10 minutes");
}

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

main().catch(err => {
  console.error("Error in main application:", err);
});