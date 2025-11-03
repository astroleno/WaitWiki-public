// WaitWiki Background Script
// 知涟 WaitWiki - 后台服务
//
// 主要功能：
// - RSS定时更新机制（每天8点和18点）
// - 扩展设置管理
// - 平台检测和消息处理

console.log('[WaitWiki Background] Script loaded');

chrome.runtime.onInstalled.addListener(() => {
  console.log('[WaitWiki] Extension installed');
  
  // 设置默认设置（默认只启用RSS）
  chrome.storage.sync.set({
    enabled: true,
    showSourceInfo: true,
    showIcon: true,
    darkMode: false,
    cardSize: 'medium',
    displayDuration: '10',
    language: 'zh',
    contentTypes: ['rss']
  });
  
  // 初始化RSS更新时间记录
  chrome.storage.local.set({
    rssLastUpdateCheck: 0,
    rssMorningUpdated: false,
    rssEveningUpdated: false,
    apiLastUpdateCheck: 0,
    apiMorningUpdated: false,
    apiEveningUpdated: false
  });
  
  // 创建定时任务（每小时检查一次）
  chrome.alarms.create('checkRSSUpdate', {
    periodInMinutes: 60
  });
  
  console.log('[WaitWiki] RSS update alarm created');
});

// 监听来自content script和popup的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getSettings') {
    chrome.storage.sync.get([
      'enabled',
      'showSourceInfo',
      'showIcon',
      'darkMode',
      'cardSize',
      'displayDuration',
      'language',
      'contentTypes'
    ], (result) => {
      sendResponse(result);
    });
    return true;
  }
  
  if (request.action === 'saveSettings') {
    chrome.storage.sync.set(request.settings, () => {
      sendResponse({ success: true });
    });
    return true;
  }
  
  if (request.action === 'toggleExtension') {
    chrome.storage.sync.get(['enabled'], (result) => {
      const newState = !result.enabled;
      chrome.storage.sync.set({ enabled: newState }, () => {
        sendResponse({ enabled: newState });
      });
    });
    return true;
  }
  
  // 处理立即更新RSS的请求
  if (request.action === 'updateRSS') {
    console.log('[WaitWiki] Manual RSS update triggered');
    updateRSSFeeds().then(() => {
      sendResponse({ success: true });
    }).catch((error) => {
      console.error('[WaitWiki] Manual RSS update failed:', error);
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }
  
  // 处理RSS获取请求（通过background.js避免CORS限制）
  if (request.action === 'fetchRSSFeed') {
    const { url } = request;
    fetchRSSFeedInBackground(url).then((result) => {
      sendResponse(result);
    }).catch((error) => {
      console.error('[WaitWiki] Failed to fetch RSS in background:', error);
      sendResponse({ success: false, error: error.message, items: [] });
    });
    return true; // 保持消息通道开放
  }
  
  // 处理自定义API获取请求（通过background.js避免CORS限制）
  if (request.action === 'fetchCustomAPI') {
    const { url } = request;
    fetchCustomAPIInBackground(url).then((result) => {
      sendResponse(result);
    }).catch((error) => {
      console.error('[WaitWiki] Failed to fetch Custom API in background:', error);
      sendResponse({ success: false, error: error.message, jsonData: null });
    });
    return true; // 保持消息通道开放
  }
  
  // 处理日志消息
  if (request.action === 'waitwiki_log') {
    const { level, message, extra } = request;
    const logPrefix = '[WaitWiki Content]';
    
    if (level === 'error') {
      console.error(logPrefix, message, extra || '');
    } else if (level === 'warn') {
      console.warn(logPrefix, message, extra || '');
    } else {
      console.log(logPrefix, message, extra || '');
    }
    return false;
  }
});

// 监听标签页更新
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    // 检查是否是支持的AI平台
    const supportedPlatforms = [
      'chat.openai.com',
      'claude.ai',
      'bard.google.com',
      'gemini.google.com',
      'copilot.microsoft.com',
      'bing.com',
      'chat.deepseek.com',
      'grok.x.ai',
      'yuanbao.tencent.com',
      'kimi.ai',
      'kimi.moonshot.cn'
    ];
    
    const isSupported = supportedPlatforms.some(platform => 
      tab.url.includes(platform)
    );
    
    if (isSupported) {
      // 向content script发送消息
      chrome.tabs.sendMessage(tabId, { 
        action: 'platformDetected',
        platform: tab.url 
      }).catch(() => {
        // 忽略错误，可能是页面还没有加载content script
      });
    }
  }
});

// 处理扩展图标点击
chrome.action.onClicked.addListener((tab) => {
  // 打开popup而不是执行动作
  chrome.action.openPopup();
});

// 检查权限并初始化定时任务
chrome.runtime.onStartup.addListener(() => {
  console.log('[WaitWiki] Extension startup');
  
  chrome.permissions.contains({
    origins: [
      'https://chat.openai.com/*',
      'https://claude.ai/*',
      'https://bard.google.com/*',
      'https://gemini.google.com/*',
      'https://copilot.microsoft.com/*',
      'https://www.bing.com/*',
      'https://chat.deepseek.com/*',
      'https://grok.x.ai/*',
      'https://yuanbao.tencent.com/*',
      'https://kimi.ai/*',
      'https://kimi.moonshot.cn/*'
    ]
  }, (hasPermissions) => {
    if (!hasPermissions) {
      console.log('[WaitWiki] Missing required permissions');
    }
  });
  
  // 确保定时任务存在
  chrome.alarms.get('checkRSSUpdate', (alarm) => {
    if (!alarm) {
      chrome.alarms.create('checkRSSUpdate', {
        periodInMinutes: 60
      });
      console.log('[WaitWiki] RSS update alarm recreated on startup');
    }
  });
  
  // 立即检查是否需要更新RSS和API
  checkAndUpdateRSS();
  checkAndUpdateAPI();
});

// ========== RSS定时更新机制 ==========

/**
 * 监听定时任务
 */
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'checkRSSUpdate') {
    console.log('[WaitWiki] RSS update alarm triggered');
    checkAndUpdateRSS();
    checkAndUpdateAPI();
  }
});

/**
 * 检查并更新RSS
 * 规则：每天8点和18点或之后联网的第一次更新
 */
async function checkAndUpdateRSS() {
  try {
    const now = new Date();
    const currentHour = now.getHours();
    const today = now.toDateString();
    
    // 获取上次更新记录
    const result = await chrome.storage.local.get([
      'rssLastUpdateDate',
      'rssMorningUpdated',
      'rssEveningUpdated'
    ]);
    
    const lastUpdateDate = result.rssLastUpdateDate || '';
    let morningUpdated = result.rssMorningUpdated || false;
    let eveningUpdated = result.rssEveningUpdated || false;
    
    // 如果是新的一天，重置更新标记
    if (lastUpdateDate !== today) {
      morningUpdated = false;
      eveningUpdated = false;
      await chrome.storage.local.set({
        rssLastUpdateDate: today,
        rssMorningUpdated: false,
        rssEveningUpdated: false
      });
      console.log('[WaitWiki] New day, reset update flags');
    }
    
    let shouldUpdate = false;
    let updateType = '';
    
    // 检查是否应该进行早晨更新（8点或之后）
    if (currentHour >= 8 && !morningUpdated) {
      shouldUpdate = true;
      updateType = 'morning';
      morningUpdated = true;
    }
    // 检查是否应该进行晚上更新（18点或之后）
    else if (currentHour >= 18 && !eveningUpdated) {
      shouldUpdate = true;
      updateType = 'evening';
      eveningUpdated = true;
    }
    
    if (shouldUpdate) {
      console.log(`[WaitWiki] Triggering ${updateType} RSS update at ${currentHour}:00`);
      
      // 更新标记
      await chrome.storage.local.set({
        rssMorningUpdated: morningUpdated,
        rssEveningUpdated: eveningUpdated,
        rssLastUpdateTime: Date.now()
      });
      
      // 执行更新
      await updateRSSFeeds();
      
      console.log(`[WaitWiki] ${updateType} RSS update completed`);
    } else {
      console.log(`[WaitWiki] No RSS update needed at ${currentHour}:00 (morning: ${morningUpdated}, evening: ${eveningUpdated})`);
    }
  } catch (error) {
    console.error('[WaitWiki] Failed to check RSS update:', error);
  }
}

/**
 * 更新所有RSS订阅
 */
async function updateRSSFeeds() {
  try {
    // 获取RSS订阅列表
    const result = await chrome.storage.local.get(['rssFeeds']);
    const feeds = result.rssFeeds || [];
    
    if (feeds.length === 0) {
      console.log('[WaitWiki] No RSS feeds to update');
      return;
    }
    
    const enabledFeeds = feeds.filter(feed => feed.enabled);
    console.log(`[WaitWiki] Updating ${enabledFeeds.length} RSS feeds...`);
    
    let totalUpdated = 0;
    
    // 逐个更新RSS源（避免并发过多）
    for (const feed of enabledFeeds) {
      try {
        const response = await fetch(feed.url, {
          signal: AbortSignal.timeout(10000)
        });
        
        if (response.ok) {
          feed.lastUpdate = Date.now();
          totalUpdated++;
          console.log(`[WaitWiki] Updated RSS: ${feed.name}`);
        } else {
          console.warn(`[WaitWiki] Failed to update RSS ${feed.name}: HTTP ${response.status}`);
        }
      } catch (error) {
        console.error(`[WaitWiki] Failed to update RSS ${feed.name}:`, error.message);
      }
      
      // 添加延迟，避免请求过快
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // 保存更新后的订阅列表
    await chrome.storage.local.set({ rssFeeds: feeds });
    
    console.log(`[WaitWiki] RSS update finished: ${totalUpdated}/${enabledFeeds.length} feeds updated`);
    
    // 通知所有标签页刷新RSS内容
    const tabs = await chrome.tabs.query({});
    tabs.forEach(tab => {
      chrome.tabs.sendMessage(tab.id, { 
        action: 'rssUpdated',
        timestamp: Date.now()
      }).catch(() => {
        // 忽略错误，某些标签页可能没有content script
      });
    });
    
  } catch (error) {
    console.error('[WaitWiki] Failed to update RSS feeds:', error);
    throw error;
  }
}

/**
 * 在background.js中获取RSS（避免CORS限制）
 * @param {string} url - RSS地址
 * @returns {Promise<Object>} RSS内容
 */
async function fetchRSSFeedInBackground(url) {
  try {
    console.log('[WaitWiki] Fetching RSS in background:', url);
    
    // 设置请求超时
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10秒超时
    
    // 发起请求（background.js不受CORS限制）
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/rss+xml, application/xml, text/xml, application/atom+xml'
      }
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    // 获取XML内容
    const xmlText = await response.text();
    
    // 解析XML（在background中创建DOM解析器）
    // 注意：background.js中没有DOM，需要使用XML解析库或发送给content script解析
    // 这里先返回原始XML，让content script解析
    return {
      success: true,
      xmlText: xmlText,
      url: url
    };
  } catch (error) {
    console.error('[WaitWiki] Failed to fetch RSS feed in background:', url, error);
    
    let errorMessage = '获取RSS失败';
    if (error.name === 'AbortError') {
      errorMessage = '请求超时';
    } else if (error.message.includes('NetworkError')) {
      errorMessage = '网络错误';
    } else if (error.message.includes('CORS')) {
      errorMessage = '跨域访问被拒绝';
    }
    
    return { success: false, error: errorMessage, items: [] };
  }
}

/**
 * 在background.js中获取自定义API（避免CORS限制）
 * @param {string} url - API地址
 * @returns {Promise<Object>} API内容
 */
async function fetchCustomAPIInBackground(url) {
  try {
    console.log('[WaitWiki] Fetching Custom API in background:', url);
    
    // 设置请求超时
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10秒超时
    
    // 发起请求（background.js不受CORS限制）
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json'
      }
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    // 获取JSON内容
    const jsonData = await response.json();
    
    return {
      success: true,
      jsonData: jsonData,
      url: url
    };
  } catch (error) {
    console.error('[WaitWiki] Failed to fetch Custom API in background:', url, error);
    
    let errorMessage = '获取API数据失败';
    if (error.name === 'AbortError') {
      errorMessage = '请求超时';
    } else if (error.message.includes('NetworkError')) {
      errorMessage = '网络错误';
    } else if (error.message.includes('CORS')) {
      errorMessage = '跨域访问被拒绝';
    }
    
    return {
      success: false,
      error: errorMessage,
      jsonData: null,
      url: url
    };
  }
}

// ========== 自定义API定时更新机制 ==========

/**
 * 检查并更新自定义API
 * 规则：每天8点和18点或之后联网的第一次更新
 */
async function checkAndUpdateAPI() {
  try {
    const now = new Date();
    const currentHour = now.getHours();
    const today = now.toDateString();
    
    // 获取上次更新记录
    const result = await chrome.storage.local.get([
      'apiLastUpdateDate',
      'apiMorningUpdated',
      'apiEveningUpdated'
    ]);
    
    const lastUpdateDate = result.apiLastUpdateDate || '';
    let morningUpdated = result.apiMorningUpdated || false;
    let eveningUpdated = result.apiEveningUpdated || false;
    
    // 如果是新的一天，重置更新标记
    if (lastUpdateDate !== today) {
      morningUpdated = false;
      eveningUpdated = false;
      await chrome.storage.local.set({
        apiLastUpdateDate: today,
        apiMorningUpdated: false,
        apiEveningUpdated: false
      });
      console.log('[WaitWiki] New day, reset API update flags');
    }
    
    let shouldUpdate = false;
    let updateType = '';
    
    // 检查是否应该进行早晨更新（8点或之后）
    if (currentHour >= 8 && !morningUpdated) {
      shouldUpdate = true;
      updateType = 'morning';
      morningUpdated = true;
    }
    // 检查是否应该进行晚上更新（18点或之后）
    else if (currentHour >= 18 && !eveningUpdated) {
      shouldUpdate = true;
      updateType = 'evening';
      eveningUpdated = true;
    }
    
    if (shouldUpdate) {
      console.log(`[WaitWiki] Triggering ${updateType} API update at ${currentHour}:00`);
      
      // 更新标记
      await chrome.storage.local.set({
        apiMorningUpdated: morningUpdated,
        apiEveningUpdated: eveningUpdated,
        apiLastUpdateTime: Date.now()
      });
      
      // 执行更新
      await updateAPIs();
      
      console.log(`[WaitWiki] ${updateType} API update completed`);
    } else {
      console.log(`[WaitWiki] No API update needed at ${currentHour}:00 (morning: ${morningUpdated}, evening: ${eveningUpdated})`);
    }
  } catch (error) {
    console.error('[WaitWiki] Failed to check API update:', error);
  }
}

/**
 * 更新所有自定义API
 */
async function updateAPIs() {
  try {
    // 获取自定义API列表
    const result = await chrome.storage.local.get(['customAPIs']);
    const apis = result.customAPIs || [];
    
    if (apis.length === 0) {
      console.log('[WaitWiki] No custom APIs to update');
      return;
    }
    
    const enabledAPIs = apis.filter(api => api.enabled);
    console.log(`[WaitWiki] Updating ${enabledAPIs.length} custom APIs...`);
    
    let totalUpdated = 0;
    
    // 逐个更新API（避免并发过多）
    for (const api of enabledAPIs) {
      try {
        const response = await fetch(api.url, {
          signal: AbortSignal.timeout(10000),
          headers: {
            'Accept': 'application/json'
          }
        });
        
        if (response.ok) {
          api.lastUpdate = Date.now();
          totalUpdated++;
          console.log(`[WaitWiki] Updated API: ${api.name}`);
        } else {
          console.warn(`[WaitWiki] Failed to update API ${api.name}: HTTP ${response.status}`);
        }
      } catch (error) {
        console.error(`[WaitWiki] Failed to update API ${api.name}:`, error.message);
      }
      
      // 添加延迟，避免请求过快
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // 保存更新后的API列表
    await chrome.storage.local.set({ customAPIs: apis });
    
    console.log(`[WaitWiki] API update finished: ${totalUpdated}/${enabledAPIs.length} APIs updated`);
    
    // 通知所有标签页刷新API内容
    const tabs = await chrome.tabs.query({});
    tabs.forEach(tab => {
      chrome.tabs.sendMessage(tab.id, { 
        action: 'apiUpdated',
        timestamp: Date.now()
      }).catch(() => {
        // 忽略错误，某些标签页可能没有content script
      });
    });
    
  } catch (error) {
    console.error('[WaitWiki] Failed to update APIs:', error);
    throw error;
  }
}