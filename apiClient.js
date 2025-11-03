// Custom API Client for WaitWiki
// 负责自定义 JSON API 的获取、解析和内容转换
//
// 主要功能：
// - 获取自定义 JSON API 数据
// - 解析 JSON 格式内容
// - 转换为统一的卡片格式
// - 错误处理和超时控制

window.WaitWikiAPIClient = {
  // API 缓存，避免频繁请求
  apiCache: new Map(),
  
  // 缓存有效期（1小时）
  cacheExpiry: 60 * 60 * 1000,
  
  /**
   * 检查扩展上下文是否有效
   * @returns {boolean} 上下文是否有效
   */
  isContextValid() {
    try {
      return chrome.runtime && chrome.runtime.id !== undefined;
    } catch (e) {
      return false;
    }
  },
  
  /**
   * 获取自定义 API 列表
   * @returns {Promise<Array>} API 列表
   */
  async getAPIs() {
    try {
      // 检查扩展上下文是否有效
      if (!this.isContextValid()) {
        console.warn('[Custom API] Extension context invalidated, returning empty APIs');
        return [];
      }
      
      const result = await chrome.storage.local.get(['customAPIs']);
      return result.customAPIs || [];
    } catch (error) {
      // 静默处理扩展上下文失效错误
      if (error.message && error.message.includes('Extension context invalidated')) {
        console.warn('[Custom API] Extension context invalidated');
        return [];
      }
      console.error('[Custom API] Failed to get APIs:', error);
      return [];
    }
  },
  
  /**
   * 保存自定义 API 列表
   * @param {Array} apis - API 列表
   */
  async saveAPIs(apis) {
    try {
      // 检查扩展上下文是否有效
      if (!this.isContextValid()) {
        console.warn('[Custom API] Extension context invalidated, skipping save');
        return;
      }
      
      await chrome.storage.local.set({ customAPIs: apis });
      console.log('[Custom API] APIs saved:', apis.length);
    } catch (error) {
      // 静默处理扩展上下文失效错误
      if (error.message && error.message.includes('Extension context invalidated')) {
        console.warn('[Custom API] Extension context invalidated, skipping save');
        return;
      }
      console.error('[Custom API] Failed to save APIs:', error);
    }
  },
  
  /**
   * 验证 URL 格式
   * @param {string} url - URL 字符串
   * @returns {boolean} 是否为有效 URL
   */
  isValidURL(url) {
    try {
      new URL(url);
      return url.startsWith('http://') || url.startsWith('https://');
    } catch {
      return false;
    }
  },
  
  /**
   * 获取自定义 API 数据
   * @param {string} url - API 地址
   * @returns {Promise<Object>} 解析后的数据
   */
  async fetchAPI(url) {
    try {
      // 检查缓存
      const cached = this.apiCache.get(url);
      if (cached && (Date.now() - cached.timestamp) < this.cacheExpiry) {
        console.log('[Custom API] Using cached data for:', url);
        return cached.data;
      }
      
      // 检查扩展上下文
      if (!this.isContextValid()) {
        throw new Error('Extension context invalidated');
      }
      
      console.log('[Custom API] Fetching API via background:', url);
      const result = await new Promise((resolve, reject) => {
        try {
          chrome.runtime.sendMessage(
            { action: 'fetchCustomAPI', url: url },
            (response) => {
              if (chrome.runtime.lastError) {
                if (chrome.runtime.lastError.message.includes('Extension context invalidated')) {
                  reject(new Error('Extension context invalidated'));
                } else {
                  reject(new Error(chrome.runtime.lastError.message));
                }
              } else {
                resolve(response);
              }
            }
          );
        } catch (error) {
          reject(error);
        }
      });
      
      if (!result.success) {
        throw new Error(result.error || '获取API数据失败');
      }
      
      const jsonData = result.jsonData;
      
      // 解析 JSON
      let parsedData;
      try {
        parsedData = typeof jsonData === 'string' ? JSON.parse(jsonData) : jsonData;
      } catch (parseError) {
        throw new Error('API 返回的数据格式无效');
      }
      
      // 验证数据结构
      if (!Array.isArray(parsedData)) {
        throw new Error('API 返回的数据必须是数组格式');
      }
      
      // 解析每个 source 的数据
      const parsedResult = this.parseAPIContent(parsedData);
      
      // 缓存结果
      this.apiCache.set(url, {
        data: { success: true, ...parsedResult },
        timestamp: Date.now()
      });
      
      return { success: true, ...parsedResult };
      
    } catch (error) {
      console.error('[Custom API] Failed to fetch API:', url, error);
      return {
        success: false,
        error: error.message || '获取API数据失败',
        sources: []
      };
    }
  },
  
  /**
   * 解析自定义 API 内容
   * @param {Array} jsonData - JSON 数据数组
   * @returns {Object} 解析后的内容
   */
  parseAPIContent(jsonData) {
    try {
      const sources = [];
      
      for (const sourceData of jsonData) {
        // 验证数据结构
        if (!sourceData.status || sourceData.status !== 'success') {
          console.warn('[Custom API] Skipping invalid source:', sourceData);
          continue;
        }
        
        if (!sourceData.id || !Array.isArray(sourceData.items)) {
          console.warn('[Custom API] Invalid source structure:', sourceData);
          continue;
        }
        
        const sourceId = sourceData.id;
        const items = sourceData.items.map(item => ({
          id: item.id || item.url || '',
          title: item.title || '无标题',
          url: item.url || item.id || '',
          source: sourceId,
          pubDate: sourceData.updatedTime ? new Date(sourceData.updatedTime).toISOString() : ''
        }));
        
        sources.push({
          id: sourceId,
          items: items
        });
      }
      
      // 合并所有 items
      const allItems = [];
      for (const source of sources) {
        allItems.push(...source.items);
      }
      
      return {
        sources: sources,
        items: allItems
      };
    } catch (error) {
      console.error('[Custom API] Failed to parse API content:', error);
      return { sources: [], items: [] };
    }
  },
  
  /**
   * 将 API 项转换为卡片格式
   * @param {Object} item - API 项
   * @returns {Object} 卡片对象
   */
  convertToCard(item) {
    return {
      type: 'api',
      title: item.title || '无标题',
      content: '', // API 卡片只显示标题+URL，不需要描述内容
      source: item.source || '未知来源',
      url: item.url || '',
      language: 'zh',
      pubDate: item.pubDate || ''
    };
  },
  
  /**
   * 获取所有启用的自定义 API 卡片
   * @returns {Promise<Array>} 卡片数组
   */
  async fetchAllAPICards() {
    try {
      // 检查扩展上下文是否有效
      if (!this.isContextValid()) {
        console.warn('[Custom API] Extension context invalidated, cannot fetch cards');
        return [];
      }
      
      const apis = await this.getAPIs();
      const enabledAPIs = apis.filter(api => api.enabled);
      
      if (enabledAPIs.length === 0) {
        console.log('[Custom API] No enabled APIs');
        return [];
      }
      
      // 并发获取所有 API（但限制并发数）
      const allCards = [];
      
      for (const api of enabledAPIs) {
        try {
          // 每次循环都检查上下文（但不阻止处理后续源）
          if (!this.isContextValid()) {
            console.warn(`[Custom API] Extension context invalidated, skipping API: ${api.name}`);
            continue; // 跳过当前 API，继续处理下一个
          }
          
          const result = await this.fetchAPI(api.url);
          if (result.success && result.items) {
            // 按 source 分组，确保每个 source 都有卡片被选择
            const sourceGroups = new Map();
            result.items.forEach(item => {
              const source = item.source || '未知来源';
              if (!sourceGroups.has(source)) {
                sourceGroups.set(source, []);
              }
              sourceGroups.get(source).push(item);
            });
            
            // 从每个 source 中均匀选择卡片（每个 source 最多选10张，确保多样性）
            const maxCardsPerSource = 10;
            const selectedCards = [];
            
            sourceGroups.forEach((items, source) => {
              // 每个 source 最多选10张，如果数量少于10张则全选
              const cardsToSelect = Math.min(items.length, maxCardsPerSource);
              // 随机选择，而不是总是选前几个
              const shuffled = [...items].sort(() => Math.random() - 0.5);
              const selected = shuffled.slice(0, cardsToSelect);
              selectedCards.push(...selected);
              
              console.log(`[Custom API] Selected ${selected.length} cards from source: ${source} (total: ${items.length})`);
            });
            
            const cards = selectedCards.map(item => this.convertToCard(item));
            allCards.push(...cards);
            
            // 更新最后更新时间
            api.lastUpdate = Date.now();
            console.log(`[Custom API] Successfully fetched ${cards.length} cards from ${api.name} (${sourceGroups.size} sources)`);
          } else {
            console.warn(`[Custom API] Failed to fetch API ${api.name}: ${result.error || 'Unknown error'}`);
          }
        } catch (error) {
          // 静默处理扩展上下文失效，但不阻止处理后续源
          if (error.message && error.message.includes('Extension context invalidated')) {
            console.warn(`[Custom API] Extension context invalidated, skipping API: ${api.name}`);
            continue; // 跳过当前 API，继续处理下一个
          }
          console.warn(`[Custom API] Failed to fetch API ${api.name}:`, error.message || error);
          // 继续处理下一个 API，不中断整个流程
        }
        
        // 添加延迟，避免过快请求
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      // 保存更新时间（只在上下文有效时）
      if (this.isContextValid()) {
        await this.saveAPIs(apis);
      }
      
      console.log(`[Custom API] Fetched ${allCards.length} cards from ${enabledAPIs.length} API(s)`);
      return allCards;
      
    } catch (error) {
      console.error('[Custom API] Failed to fetch all API cards:', error);
      return [];
    }
  }
};

