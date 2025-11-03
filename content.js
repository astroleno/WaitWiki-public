// WaitWiki Content Script V1.2.1 - Knowledge Cards for LLM Waiting Time
// 知涟 WaitWiki - 在AI对话期间展示有趣知识
// 
// 主要功能：
// - 多API数据源集成（维基百科、名言、趣闻、建议、动物、问答、调酒）
// - 智能防重复算法
// - 超时处理和错误恢复
// - 缓存机制和预加载策略
// - 响应式UI和深色模式支持
//
// 技术特性：
// - 安全的DOM操作（防XSS）
// - 扩展上下文失效检测
// - 定时器管理和内存泄漏防护
// - 平台自适应检测

console.log('[WaitWiki] Content script loaded');

class WaitWiki {
  constructor() {
    console.log('[WaitWiki] Constructor called');
    // 基础配置
    this.settings = { 
      enabled: true, 
      showSourceInfo: true, 
      showIcon: true, 
      darkMode: false, 
      cardSize: 'medium', 
      language: 'zh',
      contentTypes: ['rss'],
      displayDuration: '10'
    };

    // 缓存配置
    this.maxCacheSize = 300;
    this.cachedCards = new Map();
    this.globalCacheKey = 'waitwiki_global_cache_v1';
    
    // 防重复机制
    this.lastCardIndex = -1;
    this.recentCards = new Set();
    this.maxRecentCards = 50;
    this.recentContents = new Set();
    this.maxRecentContents = 50;
    // 短期去重：维护最近展示的标题队列，避免短时间内重复
    this.recentTitleQueue = [];
    this.recentTitleQueueSize = 5;
    
    // 批量更新配置
    this.batchUpdateConfig = {
      clickCount: 0,
      batchSize: 15, // 从10次改为15次，减少更新频率
      wikipediaTarget: 80,
      otherTarget: 8,
      lastBatchUpdate: 0,
      batchUpdateInterval: 60000 // 60秒间隔（从30秒改为60秒）
    };
    
    // 定时更新配置
    this.periodicUpdateConfig = {
      enabled: true,
      interval: 180000, // 3分钟间隔（从30秒改为3分钟，减少API调用频率）
      minCacheThreshold: 50, // 缓存低于50时开始定时更新（从30改为50）
      maxCacheThreshold: 250, // 缓存高于250时停止定时更新
      updateTimer: null,
      lastPeriodicUpdate: 0,
      apiCallDelay: 2000 // API调用间隔2秒，避免并发请求
    };
    
    // 性能统计
    this.performanceStats = {
      totalCardsFetched: 0,
      apiCallCount: 0,
      cacheHitRate: 0,
      averageLoadTime: 0,
      // 运行中会使用到以下字段，提前初始化避免 NaN/undefined
      apiSuccessCount: 0,
      apiFailureCount: 0,
      totalResponseTime: 0,
      averageResponseTime: 0,
      lastResetTime: Date.now()
    };
    
    // 缓存命中统计，fetchKnowledgeCard 中会读写这些字段
    this.cacheStats = {
      hits: 0,
      misses: 0,
      failures: 0
    };
    
    // 用户统计
    this.userStats = {
      cardDisplayCount: 0,
      userPreferences: new Map(),
      // 记录各内容类型被展示的次数，供推荐算法使用
      favoriteContentTypes: new Map()
    };
    
    // 对话状态
    this.conversationState = 'idle';
    this.isShowingCard = false;
    this.hideTimer = null;
    
    // UI元素
    this.ui = {
      container: null,
      content: null,
      source: null,
      icon: null
    };
    
    // 重试机制配置
    this.retryConfig = {
      maxAttempts: 3,
      baseDelay: 1000,
      maxDelay: 10000,
      backoffFactor: 2,
      jitter: true
    };
    
    // 失败API记录
    this.failedApis = new Map();
    
    // 错误类型枚举
    this.ErrorTypes = {
      NETWORK: 'network',
      TIMEOUT: 'timeout',
      HTTP_404: 'http_404',
      HTTP_OTHER: 'http_other',
      CORS: 'cors',
      UNKNOWN: 'unknown'
    };

    // 调试与后台日志
    this.debug = true; // 启用调试模式，确保能看到日志
    this.log = (...args) => { if (this.debug) console.log('[WaitWiki]', ...args); };
    this.warn = (...args) => { if (this.debug) console.warn('[WaitWiki]', ...args); };
    this.report = (level, message, extra) => {
      try {
        if (chrome && chrome.runtime && chrome.runtime.id && chrome.runtime.sendMessage) {
          chrome.runtime.sendMessage({ action: 'waitwiki_log', level, message, extra });
        }
      } catch (e) { /* 静默 */ }
    };
    
                // 本地备用内容库（由全局对象提供，减少在内容脚本中硬编码）
    this.localContent = window.WaitWikiLocalContent || {};
    
    // API配置（改为全局对象来源，避免在内容脚本重复硬编码）
    this.apiEndpoints = window.WaitWikiEndpoints || this.apiEndpoints;
    
    // V1.0: 平台检测配置（沿用ArtBreeze的成熟配置）
    this.platformConfig = {
      chatgpt: {
        sendButton: 'button[data-testid="send-button"]',
        inputArea: '#prompt-textarea',
        responseContainer: '[data-message-author-role="assistant"]',
        generatingIndicator: 'button[data-testid="stop-button"]',
      },
      claude: {
        sendButton: 'button[data-testid="send-button"]',
        inputArea: 'div[contenteditable="true"]',
        responseContainer: 'div[data-is-streaming="true"]',
        generatingIndicator: 'button[aria-label="Stop generating"]',
      },
      gemini: {
        sendButton: 'button[aria-label="Send message"]',
        inputArea: 'rich-textarea',
        responseContainer: 'model-response',
        generatingIndicator: '.loading-dots',
      },
      deepseek: {
        sendButton: 'button:has(svg)',
        inputArea: 'textarea',
        responseContainer: '.message.assistant',
        generatingIndicator: '.loading',
      },
      copilot: {
        sendButton: 'button[type="submit"]',
        inputArea: '#userInput',
        responseContainer: '.ac-container',
        generatingIndicator: '.typing-indicator',
      },
      kimi: {
        sendButton: 'button[data-testid="send-button"]',
        inputArea: 'textarea',
        responseContainer: '.message-assistant',
        generatingIndicator: '.generating',
      },
      grok: {
        sendButton: 'button[data-testid="send-button"]',
        inputArea: 'div[contenteditable="true"]',
        responseContainer: '.grok-response',
        generatingIndicator: '.generating',
      },
      yuanbao: {
        sendButton: 'button[type="submit"]',
        inputArea: 'textarea',
        responseContainer: '.message-assistant',
        generatingIndicator: '.generating',
      },
    };

    this.init();
  }

  async init() {
    console.log('[WaitWiki] Init started');
    await this.loadSettings();
    console.log('[WaitWiki] Settings loaded:', this.settings);
    this.createUISafe();
    console.log('[WaitWiki] UI created');
    this.setupEventListeners();
    await this.primeCsvCaches();
    
    // 加载全局缓存
    await this.loadGlobalCache();
    
    // 加载展示时长设置
    await this.loadDisplayDuration();
    
    // 根据设置决定是否显示图标
    this.applySettings();
    
    // 在所有网站都设置通用Enter键监听
    this.setupUniversalEnterListener();
    
    // 页面卸载时保存缓存
    window.addEventListener('beforeunload', () => {
      this.saveGlobalCache();
    });
    
    const platform = this.detectPlatform();
    await this.loadKnowledgeCards();
    
    // 预加载本地内容到缓存
    this.preloadLocalContent();
    
    // 启动定时更新机制
    this.startPeriodicUpdate();
    
    // 强制预加载更多内容，确保内容丰富度
    setTimeout(() => {
      this.forcePreloadMoreContent();
    }, 2000);
  }
  // 预热CSV缓存到 storage.local，后续优先读取，避免 runtime.getURL 依赖
  async primeCsvCaches() {
    if (window.WaitWikiCsvLoader && window.WaitWikiCsvLoader.primeCsvCaches) {
      await window.WaitWikiCsvLoader.primeCsvCaches();
    }
  }

  // 通用：通过 runtime.getURL 加载 CSV 并解析
  async tryLoadCsvViaUrl(filename, mapLineFn) {
    if (window.WaitWikiCsvLoader && window.WaitWikiCsvLoader.tryLoadCsvViaUrl) {
      return await window.WaitWikiCsvLoader.tryLoadCsvViaUrl(filename, mapLineFn);
    }
    return null;
  }

  detectPlatform() {
    if (typeof window.detectPlatform === 'function') {
      return window.detectPlatform();
    }
    return null;
  }

  async loadSettings() {
    try {
      // 检查扩展上下文
      if (!this.isExtensionContextValid()) {
        console.warn('[WaitWiki] Extension context invalidated, using default settings');
        return;
      }
      
      const data = await chrome.storage.sync.get(['enabled', 'showSourceInfo', 'showIcon', 'darkMode', 'cardSize', 'language', 'contentTypes']);
      this.settings.enabled = data.enabled !== false;
      this.settings.showSourceInfo = data.showSourceInfo !== false;
      this.settings.showIcon = data.showIcon !== false;
      this.settings.darkMode = data.darkMode === true;
      this.settings.cardSize = data.cardSize || 'medium';
      this.settings.language = data.language || 'zh';
      this.settings.contentTypes = data.contentTypes || ['rss'];
    } catch (error) {
      // 静默处理扩展上下文失效
      if (error.message && error.message.includes('Extension context invalidated')) {
        console.warn('[WaitWiki] Extension context invalidated during loadSettings');
        return;
      }
      console.error('[WaitWiki] Failed to load settings:', error);
    }
  }

  async loadDisplayDuration() {
    try {
      // 检查扩展上下文
      if (!this.isExtensionContextValid()) {
        return;
      }
      
      const data = await chrome.storage.sync.get(['displayDuration']);
      this.settings.displayDuration = data.displayDuration || '10';
    } catch (error) {
      // 静默处理扩展上下文失效
      if (error.message && error.message.includes('Extension context invalidated')) {
        console.warn('[WaitWiki] Extension context invalidated during loadDisplayDuration');
        return;
      }
      console.error('[WaitWiki] Failed to load display duration:', error);
    }
  }

  // 加载全局缓存
  async loadGlobalCache() {
    try {
      // 检查扩展上下文
      if (!this.isExtensionContextValid()) {
        console.warn('[WaitWiki] Extension context invalidated, skipping load global cache');
        return;
      }
      
      const result = await chrome.storage.local.get([
        this.globalCacheKey, 
        'waitwiki_performance_stats_v1',
        'waitwiki_user_stats_v1'
      ]);
      
      // 恢复内存缓存
      const cacheData = result[this.globalCacheKey] || {};
      for (const [key, card] of Object.entries(cacheData)) {
        this.cachedCards.set(key, card);
      }
      
      // 恢复性能统计
      if (result.waitwiki_performance_stats_v1) {
        this.performanceStats = { ...this.performanceStats, ...result.waitwiki_performance_stats_v1 };
      }
      
      // 恢复用户统计
      if (result.waitwiki_user_stats_v1) {
        const userStats = result.waitwiki_user_stats_v1;
        this.userStats = { ...this.userStats, ...userStats };
        if (userStats.favoriteContentTypes) {
          this.userStats.favoriteContentTypes = new Map(Object.entries(userStats.favoriteContentTypes));
        }
      }
    } catch (error) {
      // 静默处理扩展上下文失效
      if (error.message && error.message.includes('Extension context invalidated')) {
        console.warn('[WaitWiki] Extension context invalidated during load global cache');
        return;
      }
      console.warn('Failed to load global cache:', error);
    }
  }

  // 保存全局缓存
  async saveGlobalCache() {
    try {
      // 检查扩展上下文是否有效
      if (!this.isExtensionContextValid()) {
        return; // 扩展上下文已失效，直接返回
      }
      
      const cacheData = {};
      let savedCount = 0;
      
      // 限制缓存大小，只保存最近的300张卡片
      const maxCacheSize = 300;
      const entries = Array.from(this.cachedCards.entries()).slice(-maxCacheSize);
      
      for (const [key, card] of entries) {
        cacheData[key] = card;
        savedCount++;
      }
      
      // 保存缓存数据
      await chrome.storage.local.set({ [this.globalCacheKey]: cacheData });
      
      // 保存性能统计（每小时保存一次）
      const now = Date.now();
      if (now - this.performanceStats.lastResetTime > 3600000) { // 1小时
        const statsKey = 'waitwiki_performance_stats_v1';
        const userStatsKey = 'waitwiki_user_stats_v1';
        
        await chrome.storage.local.set({
          [statsKey]: this.performanceStats,
          [userStatsKey]: {
            ...this.userStats,
            favoriteContentTypes: Object.fromEntries(this.userStats.favoriteContentTypes)
          }
        });
        
        // 重置统计
        this.performanceStats.lastResetTime = now;
      }
    } catch (error) {
      // 静默处理扩展上下文失效错误
      if (error.message.includes('Extension context invalidated')) {
        return;
      }
      console.warn('Failed to save global cache:', error);
    }
  }

  setupUniversalEnterListener() {
    document.addEventListener('keydown', (e) => {
      if (document.hidden || !document.hasFocus()) {
        return;
      }
      
      if (!this.settings.enabled || e.key !== 'Enter' || e.shiftKey || e.ctrlKey) {
        return;
      }
      
      const target = e.target;
      
      if (target !== document.activeElement) {
        // 不直接返回，继续检查
      }
      
      const isTextInput = this.isTextInputElement(target);
      
      if (isTextInput) {
        const platform = this.detectPlatform();
        
        if (platform) {
          this.showPopup();
        }
      }
    }, true);
    
    // 添加更宽泛的监听器用于ChatGPT
    document.addEventListener('keyup', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && this.settings.enabled) {
        const platform = this.detectPlatform();
        if (platform === 'chatgpt') {
          const target = e.target;
          
          if (target.closest('.ProseMirror') || 
              target.closest('[data-testid="prompt-textarea"]') ||
              target.isContentEditable) {
            
            this.showPopup();
          }
        }
      }
    }, true);
  }
  
  isTextInputElement(element) {
    // 基本检查
    if (element.tagName === 'TEXTAREA' || element.tagName === 'INPUT') {
      return true;
    }
    
    // contenteditable检查
    if (element.contentEditable === 'true' || element.getAttribute('contentededitable') === 'true') {
      return true;
    }
    
    // 特定平台的特殊元素（沿用ArtBreeze逻辑）
    const platform = this.detectPlatform();
    if (platform === 'chatgpt') {
      if (element.classList.contains('ProseMirror') || 
          element.closest('.ProseMirror') ||
          element.closest('[data-testid="prompt-textarea"]') ||
          element.id === 'prompt-textarea' ||
          element.closest('#prompt-textarea') ||
          element.closest('[data-testid="composer-text-input"]') ||
          element.closest('[data-testid="chat-input"]') ||
          element.closest('[class*="input"]') ||
          element.closest('[class*="textarea"]') ||
          element.closest('[class*="composer"]') ||
          (element.getAttribute('spellcheck') === 'false' && element.tagName === 'DIV') ||
          (element.tagName === 'DIV' && element.getAttribute('contenteditable') === 'true') ||
          (element.tagName === 'P' && element.closest('[contenteditable="true"]'))) {
        return true;
      }
    }
    
    // 通用检查
    if (element.getAttribute('role') === 'textbox' ||
        element.closest('[role="textbox"]') ||
        element.matches('[data-testid*="input"]') ||
        element.matches('[placeholder]') ||
        element.closest('textarea') ||
        element.closest('[contenteditable="true"]') ||
        (element.tagName === 'DIV' && element.isContentEditable)) {
      return true;
    }
    
    return false;
  }

  showPopup() {
    this.onConversationStart();
    
    // 增加点击计数
    this.batchUpdateConfig.clickCount++;
    
    // 每次显示popup时，强制获取新卡片
    this.currentCard = null; // 清除当前卡片
    this.showCard(true); // 强制显示新卡片
    
    // 检查缓存状态和更新条件
    const cacheSize = this.cachedCards.size;
    const isCacheFull = cacheSize >= this.periodicUpdateConfig.maxCacheThreshold;
    
    // 缓存满后的批量更新逻辑
    if (isCacheFull && this.batchUpdateConfig.clickCount >= this.batchUpdateConfig.batchSize) {
      console.log(`Cache is full (${cacheSize}), triggering batch update after ${this.batchUpdateConfig.clickCount} clicks`);
      this.performBatchUpdate();
      this.batchUpdateConfig.clickCount = 0; // 重置计数
    } 
    // 缓存未满时的更新逻辑
    else if (!isCacheFull) {
      // 每次点击都预加载一张新卡片
    this.preloadOneMoreCard();
      
      // 如果点击次数达到阈值，触发批量更新
      if (this.batchUpdateConfig.clickCount >= this.batchUpdateConfig.batchSize) {
        console.log(`Cache not full (${cacheSize}), triggering batch update after ${this.batchUpdateConfig.clickCount} clicks`);
        this.performBatchUpdate();
        this.batchUpdateConfig.clickCount = 0; // 重置计数
      }
    }
    
    // 根据设置决定是否自动隐藏
    if (this.settings.displayDuration !== 'always') {
      const duration = parseInt(this.settings.displayDuration) * 1000;
      
      // 清除之前的定时器
      if (this.hideTimer) {
        clearTimeout(this.hideTimer);
      }
      
      this.hideTimer = setTimeout(() => {
        this.onConversationEnd(null);
        this.hideTimer = null;
      }, duration);
    }
  }

  // 每次触发时预加载一张新卡片
  async preloadOneMoreCard() {
    // 检查扩展上下文
    if (!this.isExtensionContextValid()) {
      return;
    }
    
    // 获取未缓存且未失败的API类型
    const availableTypes = this.settings.contentTypes.filter(type => {
      const isFailed = this.failedApis.has(type);
      return !isFailed;
    });
    
    if (availableTypes.length > 0) {
      const randomType = availableTypes[Math.floor(Math.random() * availableTypes.length)];
      
      try {
        // 直接调用API获取新卡片，不使用缓存
        await this.fetchNewCardFromAPI(randomType);
      } catch (error) {
        // 静默处理扩展上下文失效
        if (error.message && error.message.includes('Extension context invalidated')) {
          return;
        }
        console.warn(`Failed to preload card from ${randomType}:`, error);
      }
    } else {
      // 清理旧的失败记录
      this.cleanupFailedApis();
    }
  }
  
  // 清理旧的失败API记录（超过1小时）
  cleanupFailedApis() {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    
    for (const [apiType, record] of this.failedApis.entries()) {
      if (record.lastAttempt < oneHourAgo) {
        this.failedApis.delete(apiType);
      }
    }
  }

  // V1.0: Safe UI creation using createElement
  createUISafe() {
    console.log('[WaitWiki] Creating UI elements...');
    // Container
    const container = document.createElement('div');
    container.id = 'waitwiki-card-container';
    this.ui.container = container;

    // Frame
    const frame = document.createElement('div');
    frame.className = 'waitwiki-card-frame';
    this.ui.frame = frame;

    // Content Container
    const contentContainer = document.createElement('div');
    contentContainer.className = 'waitwiki-card-content';

    // Loader
    const loader = document.createElement('div');
    loader.className = 'waitwiki-loader';
    this.ui.loader = loader;

    // Title
    const title = document.createElement('h3');
    title.className = 'waitwiki-card-title';
    this.ui.title = title;

    // Content
    const content = document.createElement('div');
    content.className = 'waitwiki-card-content';
    this.ui.content = content;

    // Source
    const source = document.createElement('p');
    source.className = 'waitwiki-card-source';
    this.ui.source = source;

    contentContainer.append(loader, title, content, source);
    frame.appendChild(contentContainer);
    container.appendChild(frame);
    document.body.appendChild(container);

    // Circular Icon
    const icon = document.createElement('div');
    icon.id = 'waitwiki-circular-icon';
    const iconImg = document.createElement('img');
    iconImg.className = 'waitwiki-icon-image';
    
    // 检查扩展上下文是否有效
    try {
      if (this.isExtensionContextValid()) {
        iconImg.src = chrome.runtime.getURL('icons/logo48.png');
      } else {
        console.warn('[WaitWiki] Extension context invalidated, cannot load icon image');
      }
    } catch (error) {
      console.warn('[WaitWiki] Failed to get icon URL:', error);
    }
    
    iconImg.alt = 'WaitWiki';
    icon.appendChild(iconImg);
    document.body.appendChild(icon);
    this.ui.icon = icon;
    console.log('[WaitWiki] Icon element created and appended to body:', icon);
    console.log('[WaitWiki] Icon display:', window.getComputedStyle(icon).display);
  }

  setupEventListeners() {
    this.ui.icon.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!this.settings.enabled) {
        return;
      }
      
      this.isShowingCard ? this.hideCard() : this.showCard(true);
    });

    // 监听存储变更
    try {
      if (this.isExtensionContextValid()) {
        chrome.storage.onChanged.addListener((changes) => {
          try {
            if (!this.isExtensionContextValid()) {
              return;
            }
            
            Object.keys(changes).forEach(key => {
              if (this.settings.hasOwnProperty(key)) this.settings[key] = changes[key].newValue;
            });
            this.applySettings();

            // 若内容类型发生变化，立即清理缓存中的禁用类型
            if (changes.contentTypes) {
              this.purgeCacheBySettings();
            }
          } catch (e) {
            // 静默处理扩展上下文失效
            if (e.message && e.message.includes('Extension context invalidated')) {
              return;
            }
            console.warn('[WaitWiki] Failed to handle storage change:', e);
          }
        });
        
        // 监听来自popup的消息
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
          try {
            if (!this.isExtensionContextValid()) {
              return;
            }
            
            if (request.action === 'settingsChanged') {
              this.settings = { ...this.settings, ...request.settings };
              this.applySettings();
              // popup显式发来设置变更时，同步清理缓存
              if (request.settings && request.settings.contentTypes) {
                this.purgeCacheBySettings();
              }
            }
            
            // 处理RSS更新通知
            if (request.action === 'rssUpdated') {
              console.log('[WaitWiki] RSS updated notification received');
              // 可以触发重新获取RSS内容
            }
            
            // 处理API更新通知
            if (request.action === 'apiUpdated') {
              console.log('[WaitWiki] API updated notification received, refreshing API cards');
              // 定时更新后，主动获取新内容
              this.fetchAPICardsWithRequest().then(cards => {
                if (cards.length > 0) {
                  // 更新缓存
                  cards.forEach(card => {
                    const cardKey = `${card.type}_${card.title}_${card.url}`;
                    this.cachedCards.set(cardKey, card);
                  });
                  console.log(`[WaitWiki] Updated ${cards.length} API cards after scheduled update`);
                }
              }).catch(error => {
                console.warn('[WaitWiki] Failed to refresh API cards after update:', error);
              });
            }
          } catch (e) {
            // 静默处理扩展上下文失效
            if (e.message && e.message.includes('Extension context invalidated')) {
              return;
            }
            console.warn('[WaitWiki] Failed to handle runtime message:', e);
          }
        });
        
        // 监听存储变更以更新展示时长设置
        chrome.storage.onChanged.addListener((changes) => {
          try {
            if (!this.isExtensionContextValid()) {
              return;
            }
            
            if (changes.displayDuration) {
              this.settings.displayDuration = changes.displayDuration.newValue || '10';
            }
          } catch (e) {
            // 静默处理扩展上下文失效
            if (e.message && e.message.includes('Extension context invalidated')) {
              return;
            }
          }
        });
      }
    } catch (error) {
      console.warn('[WaitWiki] Failed to setup event listeners:', error);
    }
  }
  
  applySettings() {
    console.log('[WaitWiki] applySettings called:', {
      enabled: this.settings.enabled,
      showIcon: this.settings.showIcon,
      iconExists: !!this.ui.icon
    });
    if (!this.settings.enabled) {
      this.hideCard();
      this.hideCircularIcon();
    } else {
      if (this.settings.showIcon) {
        this.showCircularIcon();
        console.log('[WaitWiki] Icon should be visible now');
      } else {
        this.hideCircularIcon();
        console.log('[WaitWiki] Icon hidden by settings');
      }
    }
    this.updateSourceInfoVisibility();
    this.applyDarkMode();
    this.applyCardSize();
    // 设置变化后，若当前卡片类型被禁用，则立即隐藏或更换
    try {
      if (this.currentCard && this.settings.contentTypes && !this.settings.contentTypes.includes(this.currentCard.type)) {
        // 当前展示的卡片类型已被禁用
        this.hideCard();
        this.currentCard = null;
      }
    } catch (e) {
      console.warn('[WaitWiki] applySettings post-check failed:', e);
    }
  }

  showCard(forceNew = false) {
    if (!this.settings.enabled) {
      return;
    }
    
    // 防止重复显示
    if (this.isShowingCard || this.isLoadingCard) {
      return;
    }
    
    // 如果强制刷新，清除当前卡片
    if (forceNew) {
      this.currentCard = null;
    }
    
    // 预选择知识卡片
    if (forceNew || !this.currentCard) {
      this.selectRandomCard(forceNew);
    }
    
    if (!this.currentCard) {
      return;
    }
    
    // 标记正在加载
    this.isLoadingCard = true;
    
    // 显示卡片内容
    this.displayCardContent();
  }

  hideCard() {
    this.isShowingCard = false;
    this.isLoadingCard = false;
    this.ui.container.classList.remove('waitwiki-show');
    if (this.settings.enabled && this.settings.showIcon) {
      this.showCircularIcon();
    }
  }

  // 绑定外部点击事件处理器
  bindOutsideClickHandler() {
    document.removeEventListener('click', this.boundOutsideClickHandler);
    
    this.boundOutsideClickHandler = this.handleOutsideClick.bind(this);
    
    document.addEventListener('click', this.boundOutsideClickHandler, { once: true });
  }

  handleOutsideClick(event) {
    if (this.ui.container.contains(event.target) || this.ui.icon.contains(event.target)) {
      setTimeout(() => this.bindOutsideClickHandler(), 0);
      return;
    }
    this.hideCard();
  }

  showCircularIcon() { 
    if (this.ui.icon) {
      this.ui.icon.style.display = 'flex';
      console.log('[WaitWiki] showCircularIcon called, icon display set to flex');
    } else {
      console.warn('[WaitWiki] showCircularIcon called but icon element is null');
    }
  }
  
  hideCircularIcon() { 
    if (this.ui.icon) {
      this.ui.icon.style.display = 'none';
      console.log('[WaitWiki] hideCircularIcon called');
    }
  }

  // 主要的数据获取函数
  async loadKnowledgeCards() {
    const promises = this.settings.contentTypes.map(type => this.fetchKnowledgeCard(type));
    
    try {
      const results = await Promise.allSettled(promises);
      const successfulResults = results.filter(result => result.status === 'fulfilled').map(result => result.value);
      
      this.knowledgeCards = successfulResults.flat().filter(card => card && card.title);
      
      // 如果缓存中卡片不足50张，开始预加载
      if (this.cachedCards.size < 50) {
        this.startSmartPreload();
      }
    } catch (error) {
      console.warn('Failed to load knowledge cards:', error);
      this.knowledgeCards = this.getFallbackCards();
    }
  }

  // 从各个API获取知识卡片
  async fetchKnowledgeCard(type) {
    const startTime = Date.now();
    this.performanceStats.apiCallCount++;
    
    const cacheKey = `${type}_${Date.now()}`;
    
    // 检查缓存（但允许获取新内容）
    if (this.cachedCards.size > 0) {
      const cachedCards = Array.from(this.cachedCards.values()).filter(card => card.type === type);
      if (cachedCards.length > 0) {
        this.cacheStats.hits++;
        // 不直接返回，继续获取新内容
      }
    }
    
    this.cacheStats.misses++;

    try {
      let cards = [];
      
      // RSS优先从订阅源获取，无本地备用内容
      if (type === 'rss') {
        try {
          cards = await this.fetchRSSCards();
        } catch (e) {
          console.warn('Failed to fetch RSS cards:', e);
          cards = [];
        }
      }
      // 自定义API从API源获取，无本地备用内容
      else if (type === 'api') {
        try {
          // 先检查缓存
          const cachedAPICards = Array.from(this.cachedCards.values()).filter(card => card.type === 'api');
          
          // 如果缓存为空，首次加载时请求一次API（仅在初始化时）
          if (cachedAPICards.length === 0 && window.WaitWikiAPIClient && window.WaitWikiAPIClient.fetchAllAPICards) {
            console.log('[Custom API] No cached cards, fetching API for initial load');
            cards = await window.WaitWikiAPIClient.fetchAllAPICards();
          } else {
            // 有缓存时，只使用缓存（定时更新由background.js控制）
            cards = await this.fetchAPICards();
          }
        } catch (e) {
          console.warn('Failed to fetch API cards:', e);
          cards = [];
        }
      }
      // datafacts/gathas 优先使用CSV加载，其它类型优先本地
      else if (type === 'datafacts') {
        try {
          cards = await this.fetchDataFactCards();
        } catch (e) {
          cards = this.getLocalContent(type);
        }
      } else if (type === 'gathas') {
        try {
          cards = await this.fetchGathasCards();
        } catch (e) {
          cards = this.getLocalContent(type);
        }
      } else {
        cards = this.getLocalContent(type);
      }
      
      // 如果本地/CSV内容不足，尝试API获取
      if (!cards || cards.length === 0) {
        try {
          // 使用全局内容类型映射，去除硬编码
          if (window.WaitWikiContentTypes && window.WaitWikiContentTypes.isSupported(type)) {
            const methodName = window.WaitWikiContentTypes.getApiMethod(type);
            if (methodName && typeof this[methodName] === 'function') {
              cards = await this[methodName]();
            }
          }
        } catch (apiError) {
          console.warn(`API failed for ${type}, using local content:`, apiError);
          // API失败时使用本地内容
          cards = this.getLocalContent(type);
        }
      }
      
      // 如果API和本地内容都没有，返回空数组
      if (!cards || cards.length === 0) {
        cards = this.getLocalContent(type);
      }
      
      // 更新性能统计
      const responseTime = Date.now() - startTime;
      this.performanceStats.apiSuccessCount++;
      this.performanceStats.totalResponseTime += responseTime;
      this.performanceStats.averageResponseTime = 
        this.performanceStats.totalResponseTime / this.performanceStats.apiSuccessCount;
      
      // 缓存成功获取的卡片
      cards.forEach(card => {
        const cardKey = `${type}_${card.title}_${Date.now()}`;
        this.cachedCards.set(cardKey, card);
      });
      
      return cards;
    } catch (error) {
      // 更新失败统计
      this.performanceStats.apiFailureCount++;
      this.cacheStats.failures++;
      
      console.warn(`Failed to fetch ${type} cards:`, error);
      this.failedApis.set(type, {
        count: (this.failedApis.get(type)?.count || 0) + 1,
        lastAttempt: Date.now(),
        error: error.message
      });
      
      // 失败时返回本地内容
      return this.getLocalContent(type);
    }
  }
  
  // 获取本地备用内容
  getLocalContent(type) {
    const localCards = this.localContent[type] || [];
    if (localCards.length === 0) {
      return [];
    }
    
    // 返回所有本地卡片，增加内容多样性
    return localCards.map(card => ({
      ...card,
      language: this.settings.language,
      url: ''
    }));
  }

  // 从API获取新卡片（优先使用缓存）
  async fetchNewCardFromAPI(type) {
    try {
      let cards = [];
      
      // RSS特殊处理
      if (type === 'rss') {
        // 先检查缓存
        const cachedRSSCards = Array.from(this.cachedCards.values()).filter(card => card.type === 'rss');
        if (cachedRSSCards.length >= 30) {
          console.log(`[RSS] Using ${cachedRSSCards.length} cached RSS cards`);
          return cachedRSSCards;
        }
        // 缓存不足时才请求
        cards = await this.fetchRSSCards();
        // 如果请求失败但有缓存，返回缓存
        if (cards.length === 0 && cachedRSSCards.length > 0) {
          console.log(`[RSS] API failed, using ${cachedRSSCards.length} cached RSS cards as fallback`);
          return cachedRSSCards;
        }
        return cards;
      }
      
      // 自定义API特殊处理（fetchAPICards 已经内置了缓存检查逻辑）
      if (type === 'api') {
        cards = await this.fetchAPICards();
        return cards;
      }
      
      // 使用全局配置替代硬编码映射
      if (window.WaitWikiContentTypes && window.WaitWikiContentTypes.isSupported(type)) {
        const methodName = window.WaitWikiContentTypes.getApiMethod(type);
        if (methodName && this[methodName]) {
          cards = await this[methodName]();
        }
      }
      return cards;
    } catch (error) {
      console.warn(`Failed to fetch new card from ${type}:`, error);
      this.failedApis.set(type, {
        count: (this.failedApis.get(type)?.count || 0) + 1,
        lastAttempt: Date.now(),
        error: error.message
      });
      return [];
    }
  }

  // 获取Wikipedia卡片
  async fetchWikipediaCards() {
    if (window.WaitWikiApiClients && window.WaitWikiApiClients.fetchWikipediaCards) {
      return await window.WaitWikiApiClients.fetchWikipediaCards(this.settings.language);
    }
    return [];
  }

  // 获取名言卡片
  async fetchQuoteCards() {
    if (window.WaitWikiApiClients && window.WaitWikiApiClients.fetchQuoteCards) {
      return await window.WaitWikiApiClients.fetchQuoteCards();
    }
    return [];
  }

  // 获取趣闻卡片
  async fetchFactCards() {
    if (window.WaitWikiApiClients && window.WaitWikiApiClients.fetchFactCards) {
      return await window.WaitWikiApiClients.fetchFactCards();
    }
    return [];
  }

  // 获取建议卡片
  async fetchAdviceCards() {
    if (window.WaitWikiApiClients && window.WaitWikiApiClients.fetchAdviceCards) {
      return await window.WaitWikiApiClients.fetchAdviceCards();
    }
    return [];
  }

  // 获取猫咪趣闻卡片
  async fetchCatFactCards() {
    if (window.WaitWikiApiClients && window.WaitWikiApiClients.fetchCatFactCards) {
      return await window.WaitWikiApiClients.fetchCatFactCards();
    }
    return [];
  }

  // 获取知识问答卡片
  async fetchTriviaCards() {
    if (window.WaitWikiApiClients && window.WaitWikiApiClients.fetchTriviaCards) {
      return await window.WaitWikiApiClients.fetchTriviaCards();
    }
    return [];
  }

  // 获取鸡尾酒卡片
  async fetchCocktailCards() {
    if (window.WaitWikiApiClients && window.WaitWikiApiClients.fetchCocktailCards) {
      return await window.WaitWikiApiClients.fetchCocktailCards();
    }
    return [];
  }

  // 获取数据真相卡片
  async fetchDataFactCards() {
    if (window.WaitWikiApiClients && window.WaitWikiApiClients.fetchDataFactCards) {
      return await window.WaitWikiApiClients.fetchDataFactCards();
    }
    return [];
  }
  
  // 获取偈语卡片（优先CSV）
  async fetchGathasCards() {
    if (window.WaitWikiApiClients && window.WaitWikiApiClients.fetchGathasCards) {
      return await window.WaitWikiApiClients.fetchGathasCards();
    }
    return [];
  }
  
  // 获取RSS卡片
  async fetchRSSCards() {
    try {
      if (window.WaitWikiRSSClient && window.WaitWikiRSSClient.fetchAllRSSCards) {
        const cards = await window.WaitWikiRSSClient.fetchAllRSSCards();
        console.log(`[RSS] Fetched ${cards.length} RSS cards`);
        return cards;
      }
      return [];
    } catch (error) {
      console.error('[RSS] Failed to fetch RSS cards:', error);
      return [];
    }
  }
  
  // 获取自定义API卡片（仅使用缓存，不主动请求API）
  // API更新由background.js定时执行（每天8点和18点）
  async fetchAPICards() {
    try {
      // 只使用缓存，不主动请求API
      // API的更新由background.js的定时机制控制（每天8点和18点）
      const cachedAPICards = Array.from(this.cachedCards.values()).filter(card => card.type === 'api');
      
      if (cachedAPICards.length > 0) {
        console.log(`[Custom API] Using ${cachedAPICards.length} cached API cards (API only updates at 8:00 and 18:00)`);
        return cachedAPICards;
      }
      
      // 如果没有缓存，返回空数组（等待定时更新或初始化时加载）
      console.log(`[Custom API] No cached API cards available (waiting for scheduled update)`);
      return [];
    } catch (error) {
      console.error('[Custom API] Failed to get API cards from cache:', error);
      return [];
    }
  }
  
  // 主动请求API内容（仅在定时更新时调用）
  async fetchAPICardsWithRequest() {
    try {
      if (window.WaitWikiAPIClient && window.WaitWikiAPIClient.fetchAllAPICards) {
        const cards = await window.WaitWikiAPIClient.fetchAllAPICards();
        console.log(`[Custom API] Fetched ${cards.length} API cards from API (scheduled update)`);
        return cards;
      }
      return [];
    } catch (error) {
      console.error('[Custom API] Failed to fetch API cards:', error);
      return [];
    }
  }
  
  // 从CSV文件加载数据真相
  async loadDataFactsFromCSV() {
    if (window.WaitWikiCsvLoader && window.WaitWikiCsvLoader.loadDataFactsFromCSV) {
      return await window.WaitWikiCsvLoader.loadDataFactsFromCSV();
    }
    return null;
  }

  // 智能预加载策略
  async startSmartPreload() {
    // 检查扩展上下文
    if (!this.isExtensionContextValid()) {
      console.warn('[WaitWiki] Extension context invalidated, skipping smart preload');
      return;
    }
    
    const availableTypes = this.settings.contentTypes.filter(type => {
      const isFailed = this.failedApis.has(type);
      return !isFailed;
    });
    
    if (availableTypes.length === 0) {
      return;
    }
    
    // 统计当前各类型缓存数量
    const typeCounts = new Map();
    for (const [key, card] of this.cachedCards.entries()) {
      const type = card.type;
      typeCounts.set(type, (typeCounts.get(type) || 0) + 1);
    }
    
    // 优先预加载Wikipedia（如果数量不足）
    const wikipediaCount = typeCounts.get('wikipedia') || 0;
    if (wikipediaCount < 30) { // 如果Wikipedia少于30条，优先预加载
      console.log(`Preloading Wikipedia (current: ${wikipediaCount})`);
      try {
        if (this.isExtensionContextValid()) {
          await this.fetchWikipediaCards();
        }
      } catch (error) {
        if (error.message && error.message.includes('Extension context invalidated')) {
          console.warn('[WaitWiki] Extension context invalidated');
          return;
        }
        console.warn('Failed to preload Wikipedia:', error);
      }
    }
    
    // 使用智能推荐算法选择其他预加载类型
    const recommendedType = this.getRecommendedContentType();
    if (!recommendedType) {
      return;
    }
    
    // 每次只预加载一张卡片，间隔更长时间
    let loadIndex = 0;
    const loadNext = async () => {
      // 检查扩展上下文
      if (!this.isExtensionContextValid()) {
        console.warn('[WaitWiki] Extension context invalidated, stopping preload');
        return;
      }
      
      if (loadIndex >= 5) { // 增加预加载数量，确保内容丰富度
        return;
      }
      
      try {
        // 优先预加载推荐类型
        const typeToLoad = loadIndex === 0 ? recommendedType : 
          availableTypes[Math.floor(Math.random() * availableTypes.length)];
        
        await this.fetchNewCardFromAPI(typeToLoad);
        loadIndex++;
        
        // 根据网络状况调整间隔时间
        const interval = this.performanceStats.averageResponseTime > 2000 ? 5000 : 3000;
        setTimeout(loadNext, interval);
      } catch (error) {
        // 静默处理扩展上下文失效
        if (error.message && error.message.includes('Extension context invalidated')) {
          console.warn('[WaitWiki] Extension context invalidated during preload');
          return;
        }
        loadIndex++;
        setTimeout(loadNext, 2000);
      }
    };
    
    loadNext();
  }

  // 显示卡片内容
  displayCardContent() {
    if (!this.currentCard) {
      this.isLoadingCard = false;
      return;
    }
    
    // 内容质量评估
    const qualityScore = this.assessContentQuality(this.currentCard);
    if (qualityScore < 0.3) {
      // 质量太差的内容，尝试获取新卡片
      console.warn('Content quality too low, trying to get new card');
      this.selectRandomCard();
      if (this.currentCard) {
        this.displayCardContent();
      }
      return;
    }
    
    // 更新用户偏好统计
    this.updateUserPreferences(this.currentCard.type);
    
    // 更新UI内容
    // 对于有 URL 的卡片（API/RSS），让标题可点击
    if (this.currentCard.url && (this.currentCard.type === 'api' || this.currentCard.type === 'rss')) {
      // 安全地创建链接元素，避免XSS攻击
      const titleLink = document.createElement('a');
      titleLink.href = this.currentCard.url;
      titleLink.target = '_blank';
      titleLink.rel = 'noopener noreferrer';
      titleLink.textContent = this.currentCard.title;
      titleLink.style.color = 'inherit';
      titleLink.style.textDecoration = 'none';
      titleLink.style.cursor = 'pointer';
      
      this.ui.title.innerHTML = '';
      this.ui.title.appendChild(titleLink);
    } else {
      this.ui.title.textContent = this.currentCard.title;
    }
    
    // 对于 API 类型，隐藏 content 区域（因为内容为空，只显示标题+URL）
    if (this.currentCard.type === 'api') {
      this.ui.content.textContent = '';
      this.ui.content.style.display = 'none';
    } else {
      this.ui.content.textContent = this.currentCard.content;
      this.ui.content.style.display = '';
    }
    
    // 显示来源信息（如果有 URL，在来源区域显示可点击的 URL）
    if (this.currentCard.url) {
      // 安全地创建链接元素，避免XSS攻击
      const link = document.createElement('a');
      link.href = this.currentCard.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      // 显示简化的 URL（只显示域名部分，避免太长）
      try {
        const urlObj = new URL(this.currentCard.url);
        const displayUrl = urlObj.hostname.replace('www.', '');
        link.textContent = `${this.currentCard.source || '来源'} · ${displayUrl}`;
      } catch {
        link.textContent = `${this.currentCard.source || '来源'} · ${this.currentCard.url.substring(0, 30)}...`;
      }
      link.style.textDecoration = 'none';
      link.style.color = 'inherit';
      this.ui.source.innerHTML = '';
      this.ui.source.appendChild(link);
    } else {
      this.ui.source.textContent = `来源：${this.currentCard.source}`;
    }
    
    this.updateSourceInfoVisibility();
    
    // 隐藏加载器，显示内容
    this.ui.loader.style.opacity = '0';
    
    // 显示卡片
    this.isShowingCard = true;
    this.isLoadingCard = false;
    this.hideCircularIcon();
    this.ui.container.classList.add('waitwiki-show');
    
    // 绑定点击事件
    this.bindOutsideClickHandler();
  }
  
  // 内容质量评估算法
  assessContentQuality(card) {
    let score = 1.0;
    
    // 标题质量检查
    if (!card.title || card.title.length < 2) {
      score -= 0.3;
    } else if (card.title.length > 100) {
      score -= 0.1;
    }
    
    // 内容质量检查
    if (!card.content || card.content.length < 10) {
      score -= 0.4;
    } else if (card.content.length > 1000) {
      score -= 0.1;
    }
    
    // 内容重复性检查
    if (card.content.includes('暂无') || card.content.includes('No data')) {
      score -= 0.3;
    }
    
    // 特殊字符和格式检查
    const specialCharRatio = (card.content.match(/[^\w\s\u4e00-\u9fff]/g) || []).length / card.content.length;
    if (specialCharRatio > 0.3) {
      score -= 0.2;
    }
    
    return Math.max(0, score);
  }

  selectRandomCard(forceRefresh = false) {
    // 优先从缓存中选择
    const allCards = Array.from(this.cachedCards.values());

    if (allCards.length === 0 && this.knowledgeCards.length === 0) {
      return;
    }

    // 仅保留设置中启用的类型
    const allowedTypes = new Set(this.settings.contentTypes || []);
    let baseCandidates = allCards.length > 0 ? allCards : this.knowledgeCards;
    let availableCards = baseCandidates.filter(card => allowedTypes.has(card.type));

    // 如果过滤完没有可用卡片，直接返回（防止展示已禁用类型）
    if (availableCards.length === 0) {
      return;
    }
    
    // 如果强制刷新，排除当前卡片
    if (forceRefresh && this.currentCard) {
      availableCards = availableCards.filter(card => {
        return card.title !== this.currentCard.title && card.url !== this.currentCard.url;
      });
    }
    
    // 如果只有一张卡片，直接返回
    if (availableCards.length === 1) {
      this.currentCard = availableCards[0];
      this.addToRecentCards(this.currentCard.title);
      return;
    }
    
    // 如果强制刷新且过滤后没有其他卡片，放宽过滤条件
    if (forceRefresh && availableCards.length === 0) {
      // 重新获取可用卡片（不过滤当前卡片）
      availableCards = baseCandidates.filter(card => allowedTypes.has(card.type));
      // 只排除当前卡片
      if (this.currentCard) {
        availableCards = availableCards.filter(card => {
          return card.title !== this.currentCard.title && card.url !== this.currentCard.url;
        });
      }
      // 如果还是没有，则从所有卡片中选择（除了当前卡片）
      if (availableCards.length === 0) {
        availableCards = baseCandidates.filter(card => {
          return card.title !== this.currentCard?.title && card.url !== this.currentCard?.url;
        });
      }
    }
    
    // 智能过滤：优先选择未显示过的卡片，先避开短期队列
    // 如果强制刷新，放宽过滤条件，只排除最近显示的标题
    let filteredCards = availableCards.filter(card => {
      if (forceRefresh) {
        // 强制刷新时，只排除短期队列中的卡片
        return !this.recentTitleQueue.includes(card.title);
      } else {
        // 标题去重
        const titleNotRecent = !this.recentCards.has(card.title);
        const titleNotInShortQueue = !this.recentTitleQueue.includes(card.title);
        
        // 索引去重
        const indexNotRecent = availableCards.indexOf(card) !== this.lastCardIndex;
        
        // 内容相似度去重（防止内容重复）
        const contentNotSimilar = !this.isContentSimilar(card.content);
        
        return titleNotRecent && titleNotInShortQueue && indexNotRecent && contentNotSimilar;
      }
    });
    
    // 如果过滤后卡片太少，先尝试拉取新卡片再放宽
    if (filteredCards.length < Math.min(5, availableCards.length * 0.3)) {
      console.log('Filtered cards too few, preloading one more card before relaxing conditions');
      try {
        this.preloadOneMoreCard();
      } catch (e) {
        // 忽略
      }
      // 放宽到仅排除短期内出现过的标题
      filteredCards = availableCards.filter(card => !this.recentTitleQueue.includes(card.title));
    }
    
    // 如果还是没有足够卡片，清空记录重新开始
    if (filteredCards.length === 0) {
      console.log('No filtered cards available, clearing recent records');
      // 如果强制刷新，只排除当前卡片
      if (forceRefresh && this.currentCard) {
        filteredCards = availableCards.filter(card => {
          return card.title !== this.currentCard.title && card.url !== this.currentCard.url;
        });
      }
      
      // 如果还是没有卡片，清空记录重新开始
      if (filteredCards.length === 0) {
        this.recentCards.clear();
        this.recentContents.clear();
        // 清空短期队列，但保留最后一个，防止立刻复用同一张
        const lastRecent = this.recentTitleQueue[this.recentTitleQueue.length - 1];
        this.recentTitleQueue = lastRecent ? [lastRecent] : [];
        filteredCards = availableCards.filter(card => card.title !== lastRecent);
      }
    }
    
    // 优先选择Wikipedia和数据真相内容（增加出现占比）
    const priorityTypes = ['wikipedia', 'datafacts'];
    const priorityCards = filteredCards.filter(card => priorityTypes.includes(card.type));
    const otherCards = filteredCards.filter(card => !priorityTypes.includes(card.type));
    
    // 70%概率选择优先类型，30%概率选择其他类型
    let selectedCard;
    if (priorityCards.length > 0 && Math.random() < 0.7) {
      // 在优先类型中，Wikipedia占60%，datafacts占40%
      const wikipediaCards = priorityCards.filter(card => card.type === 'wikipedia');
      const datafactsCards = priorityCards.filter(card => card.type === 'datafacts');
      
      if (wikipediaCards.length > 0 && datafactsCards.length > 0) {
        // 两种类型都有，按比例选择
        selectedCard = Math.random() < 0.6 ? 
          wikipediaCards[Math.floor(Math.random() * wikipediaCards.length)] :
          datafactsCards[Math.floor(Math.random() * datafactsCards.length)];
      } else if (wikipediaCards.length > 0) {
        selectedCard = wikipediaCards[Math.floor(Math.random() * wikipediaCards.length)];
      } else if (datafactsCards.length > 0) {
        selectedCard = datafactsCards[Math.floor(Math.random() * datafactsCards.length)];
      } else {
        selectedCard = priorityCards[Math.floor(Math.random() * priorityCards.length)];
      }
    } else if (otherCards.length > 0) {
      // 选择其他类型，优先确保不同 source 的卡片都能被均匀选择
      // 先按 source 分组，确保不同来源的卡片都有机会被选中
      const sourceGroups = new Map();
      otherCards.forEach(card => {
        const source = card.source || '未知来源';
        if (!sourceGroups.has(source)) {
          sourceGroups.set(source, []);
        }
        sourceGroups.get(source).push(card);
      });
      
      // 统计每个 source 的卡片数量，用于加权选择
      const sources = Array.from(sourceGroups.keys());
      const sourceWeights = sources.map(source => {
        const cards = sourceGroups.get(source);
        // 使用反加权：source 卡片数量越多，权重越低（但保证至少有机会）
        // 这样可以让不同 source 都有更均等的选择机会
        return {
          source: source,
          cards: cards,
          weight: 1.0 / Math.sqrt(cards.length) // 使用平方根，让权重更均衡
        };
      });
      
      // 加权随机选择 source
      const totalWeight = sourceWeights.reduce((sum, item) => sum + item.weight, 0);
      let randomWeight = Math.random() * totalWeight;
      
      let selectedSourceItem = sourceWeights[0];
      for (const item of sourceWeights) {
        randomWeight -= item.weight;
        if (randomWeight <= 0) {
          selectedSourceItem = item;
          break;
        }
      }
      
      // 从选中的 source 中随机选择一张卡片
      const sourceCards = selectedSourceItem.cards;
      selectedCard = sourceCards[Math.floor(Math.random() * sourceCards.length)];
      
      console.log(`[WaitWiki] Selected card from source: ${selectedSourceItem.source} (${sourceCards.length} cards, weight: ${selectedSourceItem.weight.toFixed(3)})`);
      console.log(`[WaitWiki] Available sources: ${sources.length} (${sources.slice(0, 5).join(', ')}${sources.length > 5 ? '...' : ''})`);
    } else {
      // 如果没有其他类型，从优先类型中选择
      selectedCard = priorityCards[Math.floor(Math.random() * priorityCards.length)];
    }
    
    this.currentCard = selectedCard;
    
    // 更新lastCardIndex为在原数组中的位置
    this.lastCardIndex = availableCards.indexOf(this.currentCard);
    
    // 添加到最近显示记录
    this.addToRecentCards(this.currentCard.title);
    
    console.log(`Selected card: ${this.currentCard.title} (${this.currentCard.type}) - Priority selection`);
  }
  
  // 检查内容相似度
  isContentSimilar(content) {
    if (!this.recentContents) {
      this.recentContents = new Set();
    }
    
    // 提取内容的关键词（简单实现）
    const keywords = content.replace(/[^\w\s\u4e00-\u9fff]/g, '').split(/\s+/).slice(0, 5).join(' ');
    
    if (this.recentContents.has(keywords)) {
      return true;
    }
    
    this.recentContents.add(keywords);
    
    // 限制记录数量
    if (this.recentContents.size > 50) {
      const oldestKeyword = this.recentContents.values().next().value;
      this.recentContents.delete(oldestKeyword);
    }
    
    return false;
  }
  
  // 添加卡片到最近显示记录
  addToRecentCards(title) {
    this.recentCards.add(title);
    try {
      // 维护短期队列，避免短时间内重复
      this.recentTitleQueue.push(title);
      if (this.recentTitleQueue.length > this.recentTitleQueueSize) {
        this.recentTitleQueue.shift();
      }
    } catch (e) {
      // 忽略
    }
    
    // 如果超过最大记录数，删除最旧的记录
    if (this.recentCards.size > this.maxRecentCards) {
      const oldestTitle = this.recentCards.values().next().value;
      this.recentCards.delete(oldestTitle);
    }
  }
  
  // 智能内容推荐算法
  getRecommendedContentType() {
    const typeStats = new Map();
    
    // 统计各类型的使用频率
    for (const [key, card] of this.cachedCards.entries()) {
      const type = card.type;
      typeStats.set(type, (typeStats.get(type) || 0) + 1);
    }
    
    // 获取用户偏好（基于显示次数）
    const userPreferences = Array.from(this.userStats.favoriteContentTypes.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([type]) => type);
    
    // 结合缓存统计和用户偏好
    const availableTypes = this.settings.contentTypes.filter(type => 
      !this.failedApis.has(type)
    );
    
    if (availableTypes.length === 0) {
      return null;
    }
    
    // 优先推荐用户偏好的类型，但也要保持多样性
    const preferredTypes = userPreferences.filter(type => 
      availableTypes.includes(type)
    );
    
    if (preferredTypes.length > 0 && Math.random() < 0.7) {
      // 70%概率选择用户偏好的类型
      return preferredTypes[Math.floor(Math.random() * preferredTypes.length)];
    } else {
      // 30%概率随机选择，保持多样性
      return availableTypes[Math.floor(Math.random() * availableTypes.length)];
    }
  }
  
  // 更新用户偏好统计
  updateUserPreferences(contentType) {
    const currentCount = this.userStats.favoriteContentTypes.get(contentType) || 0;
    this.userStats.favoriteContentTypes.set(contentType, currentCount + 1);
    this.userStats.cardDisplayCount++;
  }
  
  updateSourceInfoVisibility() {
    if (this.ui.source) {
      this.ui.source.style.display = this.settings.showSourceInfo ? 'block' : 'none';
    }
  }

  applyDarkMode() {
    if (this.settings.darkMode) {
      document.body.classList.add('waitwiki-dark-mode');
    } else {
      document.body.classList.remove('waitwiki-dark-mode');
    }
    
    // 重新应用图标显示状态，确保在模式切换后图标正确显示
    if (this.settings.enabled && this.settings.showIcon && !this.isShowingCard) {
      this.showCircularIcon();
    }
  }

  applyCardSize() {
    if (this.ui.container) {
      this.ui.container.className = this.ui.container.className.replace(/\bwaitwiki-(small|medium|large)\b/g, '');
      this.ui.container.classList.add(`waitwiki-${this.settings.cardSize}`);
    }
  }

  // 事件处理函数（沿用ArtBreeze的逻辑）
  onConversationStart() {
    if (this.conversationState === 'generating' || !this.settings.enabled) return;
    this.conversationState = 'generating';
    this.showCard();
  }

  onConversationEnd(subObserver) {
    if (subObserver) {
      subObserver.disconnect();
    }
    if (this.conversationState === 'generating') {
      this.conversationState = 'idle';
      this.hideCard();
    }
  }

  // 获取备用卡片
  getFallbackCards() {
    return [
      {
        type: 'fallback',
        title: '知识卡片',
        content: '等待，不是浪费，而是遇见知识的涟漪。',
        source: 'WaitWiki',
        url: '',
        language: this.settings.language
      }
    ];
  }
  
  // 预加载本地内容到缓存
  preloadLocalContent() {
    // 仅预加载用户启用的内容类型（排除 datafacts 与 gathas，改走 CSV）
    const localTypes = (this.settings.contentTypes || []).filter(type => !!this.localContent[type] && type !== 'datafacts' && type !== 'gathas');
    localTypes.forEach(type => {
      const localCards = this.localContent[type];
      if (localCards && localCards.length > 0) {
        localCards.forEach(card => {
          const cardKey = `${type}_local_${card.title}_${Date.now()}`;
          this.cachedCards.set(cardKey, {
            ...card,
            language: this.settings.language,
            url: ''
          });
        });
      }
    });
    
    console.log(`Preloaded ${this.cachedCards.size} local cards to cache`);
  }
  
  // 检查扩展上下文是否有效
  isExtensionContextValid() {
    try {
      return chrome.runtime && chrome.runtime.id !== undefined;
    } catch (e) {
      return false;
    }
  }
  
  // 强制预加载更多内容
  async forcePreloadMoreContent() {
    console.log('Force preloading more content...');
    
    // 检查扩展上下文
    if (!this.isExtensionContextValid()) {
      console.warn('[WaitWiki] Extension context invalidated, skipping force preload');
      return;
    }
    
    // 统计当前各类型缓存数量
    const typeCounts = new Map();
    for (const [key, card] of this.cachedCards.entries()) {
      const type = card.type;
      typeCounts.set(type, (typeCounts.get(type) || 0) + 1);
    }
    
    // 优先预加载本地内容，减少API依赖
    for (const type of this.settings.contentTypes) {
      // 每次循环检查扩展上下文
      if (!this.isExtensionContextValid()) {
        console.warn('[WaitWiki] Extension context invalidated during force preload');
        break;
      }
      
      const currentCount = typeCounts.get(type) || 0;
      let targetCount;
      if (type === 'wikipedia') {
        targetCount = 60; // Wikipedia目标60条
      } else if (type === 'datafacts') {
        targetCount = 40; // 数据真相目标40条
      } else {
        targetCount = 20; // 其他类型目标20条
      }
      
      if (currentCount < targetCount) {
        const needed = targetCount - currentCount;
        console.log(`Force preloading ${type}: ${needed} cards needed`);
        
        // 优先使用本地内容
        const localCards = this.getLocalContent(type);
        if (localCards && localCards.length > 0) {
          const cardsToAdd = Math.min(needed, localCards.length);
          for (let i = 0; i < cardsToAdd; i++) {
            const card = localCards[i];
            const cardKey = `${type}_local_${card.title}_${Date.now()}_${i}`;
            this.cachedCards.set(cardKey, card);
          }
        }
        
        // 如果本地内容不足，尝试API
        if (currentCount + (localCards?.length || 0) < targetCount) {
          const apiNeeded = targetCount - currentCount - (localCards?.length || 0);
          for (let i = 0; i < Math.min(apiNeeded, 3); i++) { // 减少API调用次数
            // 检查扩展上下文
            if (!this.isExtensionContextValid()) {
              console.warn('[WaitWiki] Extension context invalidated during API fetch');
              break;
            }
            
            try {
              await this.fetchNewCardFromAPI(type);
              await new Promise(resolve => setTimeout(resolve, 1000)); // 增加间隔
            } catch (error) {
              // 静默处理扩展上下文失效
              if (error.message && error.message.includes('Extension context invalidated')) {
                console.warn('[WaitWiki] Extension context invalidated');
                break;
              }
              console.warn(`Failed to force preload ${type}:`, error);
              break;
            }
          }
        }
      }
    }
    
    console.log(`Force preload completed. Total cache size: ${this.cachedCards.size}`);
  }
  
  // 批量更新缓存内容
  async performBatchUpdate() {
    console.log('Starting batch update...');
    const now = Date.now();
    
    // 防止频繁更新（至少间隔60秒）
    if (now - this.batchUpdateConfig.lastBatchUpdate < 60000) {
      return;
    }
    
    this.batchUpdateConfig.lastBatchUpdate = now;
    
    // 统计当前各类型缓存数量
    const typeCounts = new Map();
    for (const [key, card] of this.cachedCards.entries()) {
      const type = card.type;
      typeCounts.set(type, (typeCounts.get(type) || 0) + 1);
    }
    
         // 优先更新Wikipedia（目标80条）
     const wikipediaCount = typeCounts.get('wikipedia') || 0;
     if (wikipediaCount < this.batchUpdateConfig.wikipediaTarget) {
       const needed = Math.min(8, this.batchUpdateConfig.wikipediaTarget - wikipediaCount); // 从15改为8
       console.log(`Updating Wikipedia: ${needed} cards needed`);
       
       for (let i = 0; i < needed; i++) {
         try {
           await this.fetchWikipediaCards();
           await new Promise(resolve => setTimeout(resolve, this.periodicUpdateConfig.apiCallDelay)); // 使用配置的延迟
         } catch (error) {
           console.warn('Failed to fetch Wikipedia card in batch update:', error);
           break;
         }
       }
     }
     
     // 优先更新数据真相（目标30条）
     const datafactsCount = typeCounts.get('datafacts') || 0;
     const datafactsTarget = 30;
     if (datafactsCount < datafactsTarget) {
       const needed = Math.min(5, datafactsTarget - datafactsCount); // 从10改为5
       console.log(`Updating datafacts: ${needed} cards needed`);
       
       for (let i = 0; i < needed; i++) {
         try {
           await this.fetchDataFactCards();
           await new Promise(resolve => setTimeout(resolve, this.periodicUpdateConfig.apiCallDelay)); // 使用配置的延迟
         } catch (error) {
           console.warn('Failed to fetch datafacts card in batch update:', error);
           break;
         }
       }
     }
     
     // 更新其他类型（每种目标8条）
     const otherTypes = this.settings.contentTypes.filter(type => type !== 'wikipedia' && type !== 'datafacts');
    for (const type of otherTypes) {
      const currentCount = typeCounts.get(type) || 0;
      if (currentCount < this.batchUpdateConfig.otherTarget) {
        const needed = Math.min(3, this.batchUpdateConfig.otherTarget - currentCount); // 从5改为3
        console.log(`Updating ${type}: ${needed} cards needed`);
        
        for (let i = 0; i < needed; i++) {
          try {
            await this.fetchNewCardFromAPI(type);
            await new Promise(resolve => setTimeout(resolve, this.periodicUpdateConfig.apiCallDelay)); // 使用配置的延迟
          } catch (error) {
            console.warn(`Failed to fetch ${type} card in batch update:`, error);
            break;
          }
        }
      }
    }
    
    console.log(`Batch update completed. Total cache size: ${this.cachedCards.size}`);
  }
  
  // 启动定时更新机制
  startPeriodicUpdate() {
    if (!this.periodicUpdateConfig.enabled) {
      return;
    }
    
    console.log('Starting periodic update mechanism...');
    
    // 清除可能存在的旧定时器
    if (this.periodicUpdateConfig.updateTimer) {
      clearInterval(this.periodicUpdateConfig.updateTimer);
    }
    
    // 启动定时器
    this.periodicUpdateConfig.updateTimer = setInterval(() => {
      this.performPeriodicUpdate();
    }, this.periodicUpdateConfig.interval);
    
    console.log(`Periodic update started with ${this.periodicUpdateConfig.interval / 1000}s interval`);
  }
  
  // 停止定时更新机制
  stopPeriodicUpdate() {
    if (this.periodicUpdateConfig.updateTimer) {
      clearInterval(this.periodicUpdateConfig.updateTimer);
      this.periodicUpdateConfig.updateTimer = null;
      console.log('Periodic update stopped');
    }
  }
  
  // 执行定时更新
  async performPeriodicUpdate() {
    const now = Date.now();
    const cacheSize = this.cachedCards.size;
    
    // 防止频繁更新（至少间隔2分钟）
    if (now - this.periodicUpdateConfig.lastPeriodicUpdate < 120000) {
      return;
    }
    
    // 检查缓存状态
    if (cacheSize >= this.periodicUpdateConfig.maxCacheThreshold) {
      console.log(`Cache is full (${cacheSize}), stopping periodic update`);
      this.stopPeriodicUpdate();
      return;
    }
    
    // 缓存未满时进行更新
    if (cacheSize < this.periodicUpdateConfig.maxCacheThreshold) {
      console.log(`Cache not full (${cacheSize}), performing periodic update...`);
      
      this.periodicUpdateConfig.lastPeriodicUpdate = now;
      
      // 统计当前各类型缓存数量
      const typeCounts = new Map();
      for (const [key, card] of this.cachedCards.entries()) {
        const type = card.type;
        typeCounts.set(type, (typeCounts.get(type) || 0) + 1);
      }
      
      // 优先更新Wikipedia（目标60条）
      const wikipediaCount = typeCounts.get('wikipedia') || 0;
      if (wikipediaCount < 60) {
        const needed = Math.min(2, 60 - wikipediaCount); // 从3改为2
        console.log(`Periodic update: Wikipedia needs ${needed} cards`);
        
        for (let i = 0; i < needed; i++) {
          try {
            await this.fetchWikipediaCards();
            await new Promise(resolve => setTimeout(resolve, this.periodicUpdateConfig.apiCallDelay)); // 使用配置的延迟
          } catch (error) {
            console.warn('Failed to fetch Wikipedia card in periodic update:', error);
            break;
          }
        }
      }
      
      // 更新数据真相（目标40条）
      const datafactsCount = typeCounts.get('datafacts') || 0;
      if (datafactsCount < 40) {
        const needed = Math.min(1, 40 - datafactsCount); // 从2改为1
        console.log(`Periodic update: Datafacts needs ${needed} cards`);
        
        for (let i = 0; i < needed; i++) {
          try {
            await this.fetchDataFactCards();
            await new Promise(resolve => setTimeout(resolve, this.periodicUpdateConfig.apiCallDelay)); // 使用配置的延迟
          } catch (error) {
            console.warn('Failed to fetch datafacts card in periodic update:', error);
            break;
          }
        }
      }
      
      // 更新其他类型（每种目标20条）
      const otherTypes = this.settings.contentTypes.filter(type => type !== 'wikipedia' && type !== 'datafacts');
      for (const type of otherTypes) {
        const currentCount = typeCounts.get(type) || 0;
        if (currentCount < 20) {
          const needed = Math.min(1, 20 - currentCount);
          console.log(`Periodic update: ${type} needs ${needed} cards`);
          
          for (let i = 0; i < needed; i++) {
            try {
              await this.fetchNewCardFromAPI(type);
              await new Promise(resolve => setTimeout(resolve, this.periodicUpdateConfig.apiCallDelay)); // 使用配置的延迟
            } catch (error) {
              console.warn(`Failed to fetch ${type} card in periodic update:`, error);
              break;
            }
          }
        }
      }
      
      console.log(`Periodic update completed. Total cache size: ${this.cachedCards.size}`);
    }
  }
  
  // 页面卸载时清理定时器
  cleanup() {
    this.stopPeriodicUpdate();
    this.saveGlobalCache();
  }

  // 根据当前设置清理缓存：移除禁用类型的卡片
  purgeCacheBySettings() {
    try {
      const allowed = new Set(this.settings.contentTypes || []);
      let removed = 0;
      for (const [key, card] of Array.from(this.cachedCards.entries())) {
        if (!allowed.has(card.type)) {
          this.cachedCards.delete(key);
          removed++;
        }
      }
      if (removed > 0) {
        console.log(`[WaitWiki] Purged ${removed} cached cards not in allowed types.`);
      }

      // 如果当前卡片类型被禁用，立即处理
      if (this.currentCard && !allowed.has(this.currentCard.type)) {
        this.hideCard();
        this.currentCard = null;
      }
    } catch (e) {
      console.warn('[WaitWiki] purgeCacheBySettings failed:', e);
    }
  }
}

// 初始化 WaitWiki
console.log('[WaitWiki] Starting initialization...');
console.log('[WaitWiki] Document ready state:', document.readyState);
console.log('[WaitWiki] Document body exists:', !!document.body);
const waitWiki = new WaitWiki();
console.log('[WaitWiki] WaitWiki instance created');

// 页面卸载时清理资源
window.addEventListener('beforeunload', () => {
  if (waitWiki) {
    waitWiki.cleanup();
  }
});