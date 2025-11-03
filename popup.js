// WaitWiki Popup Script

// 加载设置
function loadSettings() {
  chrome.storage.sync.get([
    'enabled',
    'showSourceInfo',
    'showIcon',
    'darkMode',
    'cardSize',
    'displayDuration',
    'contentTypes'
  ], (result) => {
    document.getElementById('enableToggle').checked = result.enabled !== false;
    document.getElementById('showInfoToggle').checked = result.showSourceInfo !== false;
    document.getElementById('showIconToggle').checked = result.showIcon !== false;
    document.getElementById('darkModeToggle').checked = result.darkMode === true;
    
    // 设置卡片大小
    const size = result.cardSize || 'medium';
    document.querySelector(`input[name="artworkSize"][value="${size}"]`).checked = true;
    
    // 设置展示时长
    const duration = result.displayDuration || '10';
    document.querySelector(`input[name="displayDuration"][value="${duration}"]`).checked = true;
    
    // 设置内容类型（默认只启用RSS）
    const contentTypes = result.contentTypes || ['rss'];
    const allContentTypes = ['rss', 'api', 'wikipedia', 'quotes', 'facts', 'advice', 'catfacts', 'trivia', 'cocktails', 'datafacts', 'gathas'];
    
    allContentTypes.forEach(type => {
      const checkbox = document.getElementById(`contentType-${type}`);
      if (checkbox) {
        checkbox.checked = contentTypes.includes(type);
      }
    });
    
    // 应用暗夜模式
    applyDarkMode(result.darkMode === true);
  });
}

// 保存设置
function saveSettings() {
  const cardSizeElement = document.querySelector('input[name="artworkSize"]:checked');
  const durationElement = document.querySelector('input[name="displayDuration"]:checked');
  
  // 收集选中的内容类型
  const allContentTypes = ['rss', 'api', 'wikipedia', 'quotes', 'facts', 'advice', 'catfacts', 'trivia', 'cocktails', 'datafacts', 'gathas'];
  const selectedContentTypes = allContentTypes.filter(type => {
    const checkbox = document.getElementById(`contentType-${type}`);
    return checkbox && checkbox.checked;
  });
  
  const settings = {
    enabled: document.getElementById('enableToggle').checked,
    showSourceInfo: document.getElementById('showInfoToggle').checked,
    showIcon: document.getElementById('showIconToggle').checked,
    darkMode: document.getElementById('darkModeToggle').checked,
    cardSize: cardSizeElement ? cardSizeElement.value : 'medium',
    displayDuration: durationElement ? durationElement.value : '10',
    contentTypes: selectedContentTypes.length > 0 ? selectedContentTypes : ['rss'] // 默认至少保留RSS
  };
  
  chrome.storage.sync.set(settings, () => {
    console.log('Settings saved');
    
    // 应用暗夜模式
    applyDarkMode(settings.darkMode);
    
    // 通知所有标签页的设置变更
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, { 
          action: 'settingsChanged', 
          settings: settings 
        }).catch(() => {
          // 忽略错误，某些标签页可能没有content script
        });
      });
    });
  });
}

// 应用暗夜模式
function applyDarkMode(isDark) {
  if (isDark) {
    document.body.classList.add('dark-mode');
  } else {
    document.body.classList.remove('dark-mode');
  }
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  
  // 绑定事件
  document.getElementById('enableToggle').addEventListener('change', saveSettings);
  document.getElementById('showInfoToggle').addEventListener('change', saveSettings);
  document.getElementById('showIconToggle').addEventListener('change', saveSettings);
  document.getElementById('darkModeToggle').addEventListener('change', saveSettings);
  
  // 绑定卡片大小选择器事件
  document.querySelectorAll('input[name="artworkSize"]').forEach(radio => {
    radio.addEventListener('change', saveSettings);
  });
  
  // 绑定展示时长选择器事件
  document.querySelectorAll('input[name="displayDuration"]').forEach(radio => {
    radio.addEventListener('change', saveSettings);
  });
  
  // 绑定内容类型复选框事件
  const allContentTypes = ['rss', 'api', 'wikipedia', 'quotes', 'facts', 'advice', 'catfacts', 'trivia', 'cocktails', 'datafacts', 'gathas'];
  allContentTypes.forEach(type => {
    const checkbox = document.getElementById(`contentType-${type}`);
    if (checkbox) {
      checkbox.addEventListener('change', saveSettings);
    }
  });
  
  // 初始化RSS管理功能
  initRSSManager();
  
  // 初始化自定义API管理功能
  initAPIManager();
});

// ========== RSS管理功能 ==========

/**
 * 初始化RSS管理器
 */
function initRSSManager() {
  // 加载RSS订阅列表
  loadRSSList();
  
  // 绑定添加按钮事件
  document.getElementById('addRssBtn').addEventListener('click', handleAddRSS);
  
  // 支持回车键添加
  document.getElementById('rssUrlInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      handleAddRSS();
    }
  });
}

/**
 * 缩短URL显示（只显示域名部分，进一步优化）
 * @param {string} url - 完整URL
 * @returns {string} 缩短后的URL
 */
function shortenURL(url) {
  try {
    const urlObj = new URL(url);
    let hostname = urlObj.hostname.replace(/^www\./, '');
    
    // 如果域名太长（超过20个字符），只显示主域名部分
    // 例如：focus-api.aitoshuu.workers.dev -> aitoshuu.workers.dev
    // 或者：api.example.com -> example.com
    if (hostname.length > 20) {
      const parts = hostname.split('.');
      // 如果有多级域名，只保留最后两级（主域名+TLD）
      if (parts.length > 2) {
        hostname = parts.slice(-2).join('.');
      }
      // 如果还是太长，直接截断
      if (hostname.length > 20) {
        hostname = hostname.substring(0, 17) + '...';
      }
    }
    
    return hostname;
  } catch {
    // 如果解析失败，返回前20个字符
    return url.length > 20 ? url.substring(0, 17) + '...' : url;
  }
}

/**
 * 缩短名称显示（避免超出面板宽度）
 * @param {string} name - 完整名称
 * @param {number} maxLength - 最大长度，默认25
 * @returns {string} 缩短后的名称
 */
function shortenName(name, maxLength = 25) {
  if (!name || name.length <= maxLength) {
    return name;
  }
  // 如果名称太长，截断并添加省略号
  return name.substring(0, maxLength - 3) + '...';
}

/**
 * 加载并显示RSS订阅列表
 */
async function loadRSSList() {
  try {
    const result = await chrome.storage.local.get(['rssFeeds']);
    const feeds = result.rssFeeds || [];
    
    const listContainer = document.getElementById('rssList');
    
    if (feeds.length === 0) {
      listContainer.innerHTML = '<div class="rss-empty">暂无订阅，请添加RSS源</div>';
      return;
    }
    
    // 生成RSS列表HTML
    listContainer.innerHTML = feeds.map(feed => {
      const shortUrl = shortenURL(feed.url);
      return `
      <div class="rss-item" data-id="${feed.id}">
        <div class="rss-item-info">
          <div class="rss-item-name" title="${feed.name}">${feed.name}</div>
          <div class="rss-item-url" title="${feed.url}">${shortUrl}</div>
        </div>
        <div class="rss-item-actions">
          <label class="rss-toggle">
            <input type="checkbox" ${feed.enabled ? 'checked' : ''} onchange="toggleRSSFeed('${feed.id}', this.checked)">
            <span class="rss-slider"></span>
          </label>
          <button class="rss-delete-btn" onclick="deleteRSSFeed('${feed.id}')" title="删除">🗑️</button>
        </div>
      </div>
    `;
    }).join('');
  } catch (error) {
    console.error('Failed to load RSS list:', error);
    showRSSStatus('加载订阅列表失败', 'error');
  }
}

/**
 * 处理添加RSS订阅
 */
async function handleAddRSS() {
  const urlInput = document.getElementById('rssUrlInput');
  const url = urlInput.value.trim();
  
  if (!url) {
    showRSSStatus('请输入RSS地址', 'error');
    return;
  }
  
  // 显示添加中状态
  const addBtn = document.getElementById('addRssBtn');
  const originalText = addBtn.textContent;
  addBtn.textContent = '添加中...';
  addBtn.disabled = true;
  
  try {
    // 验证URL格式
    try {
      new URL(url);
    } catch {
      showRSSStatus('无效的URL格式', 'error');
      addBtn.textContent = originalText;
      addBtn.disabled = false;
      return;
    }
    
    // 获取现有订阅
    const result = await chrome.storage.local.get(['rssFeeds']);
    const feeds = result.rssFeeds || [];
    
    // 检查是否已存在
    if (feeds.some(feed => feed.url === url)) {
      showRSSStatus('该RSS源已存在', 'error');
      addBtn.textContent = originalText;
      addBtn.disabled = false;
      return;
    }
    
    // 尝试获取RSS内容验证（简单验证）
    try {
      const response = await fetch(url, { 
        method: 'HEAD',
        signal: AbortSignal.timeout(5000)
      });
      
      if (!response.ok) {
        throw new Error('无法访问RSS源');
      }
    } catch (fetchError) {
      console.warn('RSS validation failed:', fetchError);
      // 继续添加，因为有些RSS源可能不支持HEAD请求
    }
    
    // 从URL提取域名作为名称
    const urlObj = new URL(url);
    const feedName = urlObj.hostname.replace('www.', '');
    
    // 添加新订阅
    const newFeed = {
      id: Date.now().toString(),
      url: url,
      name: feedName,
      enabled: true,
      addedAt: Date.now(),
      lastUpdate: 0
    };
    
    feeds.push(newFeed);
    await chrome.storage.local.set({ rssFeeds: feeds });
    
    // 清空输入框
    urlInput.value = '';
    
    // 重新加载列表
    await loadRSSList();
    
    // 显示成功消息
    showRSSStatus(`成功添加：${feedName}`, 'success');
    
    // 触发后台立即更新RSS内容
    chrome.runtime.sendMessage({ action: 'updateRSS' });
    
  } catch (error) {
    console.error('Failed to add RSS:', error);
    showRSSStatus('添加失败：' + error.message, 'error');
  } finally {
    addBtn.textContent = originalText;
    addBtn.disabled = false;
  }
}

/**
 * 切换RSS订阅状态
 */
window.toggleRSSFeed = async function(feedId, enabled) {
  try {
    const result = await chrome.storage.local.get(['rssFeeds']);
    const feeds = result.rssFeeds || [];
    
    const feed = feeds.find(f => f.id === feedId);
    if (feed) {
      feed.enabled = enabled;
      await chrome.storage.local.set({ rssFeeds: feeds });
      showRSSStatus(`已${enabled ? '启用' : '禁用'}：${feed.name}`, 'success');
    }
  } catch (error) {
    console.error('Failed to toggle RSS feed:', error);
    showRSSStatus('操作失败', 'error');
  }
};

/**
 * 删除RSS订阅
 */
window.deleteRSSFeed = async function(feedId) {
  if (!confirm('确定要删除这个RSS订阅吗？')) {
    return;
  }
  
  try {
    const result = await chrome.storage.local.get(['rssFeeds']);
    const feeds = result.rssFeeds || [];
    
    const feed = feeds.find(f => f.id === feedId);
    const filteredFeeds = feeds.filter(f => f.id !== feedId);
    
    await chrome.storage.local.set({ rssFeeds: filteredFeeds });
    await loadRSSList();
    
    if (feed) {
      showRSSStatus(`已删除：${feed.name}`, 'success');
    }
  } catch (error) {
    console.error('Failed to delete RSS feed:', error);
    showRSSStatus('删除失败', 'error');
  }
};

/**
 * 显示RSS状态消息
 */
function showRSSStatus(message, type) {
  const statusEl = document.getElementById('rssStatus');
  statusEl.textContent = message;
  statusEl.className = `rss-status ${type}`;
  
  // 3秒后自动隐藏
  setTimeout(() => {
    statusEl.className = 'rss-status';
  }, 3000);
}

// ========== 自定义API管理功能 ==========

/**
 * 初始化自定义API管理器
 */
function initAPIManager() {
  // 加载API列表
  loadAPIList();
  
  // 绑定添加按钮事件
  document.getElementById('addApiBtn').addEventListener('click', handleAddAPI);
  
  // 支持回车键添加
  document.getElementById('apiUrlInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      handleAddAPI();
    }
  });
}

/**
 * 加载并显示自定义API列表
 */
async function loadAPIList() {
  try {
    const result = await chrome.storage.local.get(['customAPIs']);
    const apis = result.customAPIs || [];
    
    const listContainer = document.getElementById('apiList');
    
    if (apis.length === 0) {
      listContainer.innerHTML = '<div class="rss-empty">暂无API，请添加API源</div>';
      return;
    }
    
    // 生成API列表HTML
    listContainer.innerHTML = apis.map(api => {
      const shortUrl = shortenURL(api.url);
      const shortName = shortenName(api.name, 25); // API名称最多显示25个字符
      return `
      <div class="rss-item" data-id="${api.id}">
        <div class="rss-item-info">
          <div class="rss-item-name" title="${api.name}">${shortName}</div>
          <div class="rss-item-url" title="${api.url}">${shortUrl}</div>
        </div>
        <div class="rss-item-actions">
          <label class="rss-toggle">
            <input type="checkbox" ${api.enabled ? 'checked' : ''} onchange="toggleAPI('${api.id}', this.checked)">
            <span class="rss-slider"></span>
          </label>
          <button class="rss-delete-btn" onclick="deleteAPI('${api.id}')" title="删除">🗑️</button>
        </div>
      </div>
    `;
    }).join('');
  } catch (error) {
    console.error('Failed to load API list:', error);
    showAPIStatus('加载API列表失败', 'error');
  }
}

/**
 * 处理添加自定义API
 */
async function handleAddAPI() {
  const urlInput = document.getElementById('apiUrlInput');
  const url = urlInput.value.trim();
  
  if (!url) {
    showAPIStatus('请输入API地址', 'error');
    return;
  }
  
  // 显示添加中状态
  const addBtn = document.getElementById('addApiBtn');
  const originalText = addBtn.textContent;
  addBtn.textContent = '添加中...';
  addBtn.disabled = true;
  
  try {
    // 验证URL格式
    try {
      new URL(url);
    } catch {
      showAPIStatus('无效的URL格式', 'error');
      addBtn.textContent = originalText;
      addBtn.disabled = false;
      return;
    }
    
    // 获取现有API
    const result = await chrome.storage.local.get(['customAPIs']);
    const apis = result.customAPIs || [];
    
    // 检查是否已存在
    if (apis.some(api => api.url === url)) {
      showAPIStatus('该API已存在', 'error');
      addBtn.textContent = originalText;
      addBtn.disabled = false;
      return;
    }
    
    // 从URL提取域名作为名称
    const urlObj = new URL(url);
    const apiName = urlObj.hostname.replace('www.', '');
    
    // 添加新API
    const newAPI = {
      id: Date.now().toString(),
      url: url,
      name: apiName,
      enabled: true,
      addedAt: Date.now(),
      lastUpdate: 0
    };
    
    apis.push(newAPI);
    await chrome.storage.local.set({ customAPIs: apis });
    
    // 清空输入框
    urlInput.value = '';
    
    // 重新加载列表
    await loadAPIList();
    
    // 显示成功消息
    showAPIStatus(`成功添加：${apiName}`, 'success');
    
  } catch (error) {
    console.error('Failed to add API:', error);
    showAPIStatus('添加失败：' + error.message, 'error');
  } finally {
    addBtn.textContent = originalText;
    addBtn.disabled = false;
  }
}

/**
 * 切换自定义API状态
 */
window.toggleAPI = async function(apiId, enabled) {
  try {
    const result = await chrome.storage.local.get(['customAPIs']);
    const apis = result.customAPIs || [];
    
    const api = apis.find(a => a.id === apiId);
    if (api) {
      api.enabled = enabled;
      await chrome.storage.local.set({ customAPIs: apis });
      showAPIStatus(`已${enabled ? '启用' : '禁用'}：${api.name}`, 'success');
    }
  } catch (error) {
    console.error('Failed to toggle API:', error);
    showAPIStatus('操作失败', 'error');
  }
};

/**
 * 删除自定义API
 */
window.deleteAPI = async function(apiId) {
  if (!confirm('确定要删除这个API吗？')) {
    return;
  }
  
  try {
    const result = await chrome.storage.local.get(['customAPIs']);
    const apis = result.customAPIs || [];
    
    const api = apis.find(a => a.id === apiId);
    const filteredAPIs = apis.filter(a => a.id !== apiId);
    
    await chrome.storage.local.set({ customAPIs: filteredAPIs });
    await loadAPIList();
    
    if (api) {
      showAPIStatus(`已删除：${api.name}`, 'success');
    }
  } catch (error) {
    console.error('Failed to delete API:', error);
    showAPIStatus('删除失败', 'error');
  }
};

/**
 * 显示API状态消息
 */
function showAPIStatus(message, type) {
  const statusEl = document.getElementById('apiStatus');
  statusEl.textContent = message;
  statusEl.className = `rss-status ${type}`;
  
  // 3秒后自动隐藏
  setTimeout(() => {
    statusEl.className = 'rss-status';
  }, 3000);
}