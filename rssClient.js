// RSS Client for WaitWiki
// 负责RSS源的获取、解析和内容转换
//
// 主要功能：
// - 获取RSS/Atom feeds
// - 解析XML格式内容
// - 转换为统一的卡片格式
// - 错误处理和超时控制
//
// 支持的格式：
// - RSS 2.0
// - RSS 1.0
// - Atom

window.WaitWikiRSSClient = {
  // RSS缓存，避免频繁请求
  rssCache: new Map(),
  
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
   * 获取RSS订阅列表
   * @returns {Promise<Array>} RSS订阅列表
   */
  async getRSSFeeds() {
    try {
      // 检查扩展上下文是否有效
      if (!this.isContextValid()) {
        console.warn('[RSS] Extension context invalidated, returning empty feeds');
        return [];
      }
      
      const result = await chrome.storage.local.get(['rssFeeds']);
      return result.rssFeeds || [];
    } catch (error) {
      // 静默处理扩展上下文失效错误
      if (error.message && error.message.includes('Extension context invalidated')) {
        console.warn('[RSS] Extension context invalidated');
        return [];
      }
      console.error('[RSS] Failed to get RSS feeds:', error);
      return [];
    }
  },
  
  /**
   * 保存RSS订阅列表
   * @param {Array} feeds - RSS订阅列表
   */
  async saveRSSFeeds(feeds) {
    try {
      // 检查扩展上下文是否有效
      if (!this.isContextValid()) {
        console.warn('[RSS] Extension context invalidated, skipping save');
        return;
      }
      
      await chrome.storage.local.set({ rssFeeds: feeds });
      console.log('[RSS] Feeds saved:', feeds.length);
    } catch (error) {
      // 静默处理扩展上下文失效错误
      if (error.message && error.message.includes('Extension context invalidated')) {
        console.warn('[RSS] Extension context invalidated, skipping save');
        return;
      }
      console.error('[RSS] Failed to save RSS feeds:', error);
    }
  },
  
  /**
   * 添加RSS订阅
   * @param {string} url - RSS地址
   * @param {string} name - 订阅名称（可选）
   * @returns {Promise<Object>} 添加结果
   */
  async addRSSFeed(url, name = '') {
    try {
      // 检查扩展上下文是否有效
      if (!this.isContextValid()) {
        return { success: false, error: '扩展上下文已失效，请重新加载扩展' };
      }
      
      // 验证URL格式
      if (!this.isValidURL(url)) {
        return { success: false, error: '无效的URL格式' };
      }
      
      // 获取现有订阅
      const feeds = await this.getRSSFeeds();
      
      // 检查是否已存在
      if (feeds.some(feed => feed.url === url)) {
        return { success: false, error: '该RSS源已存在' };
      }
      
      // 尝试获取RSS内容验证
      const testResult = await this.fetchRSSFeed(url);
      if (!testResult.success) {
        return { success: false, error: testResult.error || 'RSS源无法访问' };
      }
      
      // 使用RSS中的标题或用户提供的名称
      const feedName = name || testResult.feedTitle || this.extractDomainName(url);
      
      // 添加新订阅
      const newFeed = {
        id: Date.now().toString(),
        url: url,
        name: feedName,
        enabled: true,
        addedAt: Date.now(),
        lastUpdate: Date.now()
      };
      
      feeds.push(newFeed);
      await this.saveRSSFeeds(feeds);
      
      return { success: true, feed: newFeed };
    } catch (error) {
      console.error('[RSS] Failed to add feed:', error);
      return { success: false, error: error.message };
    }
  },
  
  /**
   * 删除RSS订阅
   * @param {string} feedId - 订阅ID
   */
  async removeRSSFeed(feedId) {
    try {
      if (!this.isContextValid()) {
        return { success: false, error: '扩展上下文已失效' };
      }
      
      const feeds = await this.getRSSFeeds();
      const filteredFeeds = feeds.filter(feed => feed.id !== feedId);
      await this.saveRSSFeeds(filteredFeeds);
      
      // 清除缓存（使用URL而不是ID作为key）
      // this.rssCache.delete(feedId);
      
      return { success: true };
    } catch (error) {
      // 静默处理扩展上下文失效
      if (error.message && error.message.includes('Extension context invalidated')) {
        return { success: false, error: '扩展上下文已失效' };
      }
      console.error('[RSS] Failed to remove feed:', error);
      return { success: false, error: error.message };
    }
  },
  
  /**
   * 更新RSS订阅状态
   * @param {string} feedId - 订阅ID
   * @param {boolean} enabled - 是否启用
   */
  async toggleRSSFeed(feedId, enabled) {
    try {
      if (!this.isContextValid()) {
        return { success: false, error: '扩展上下文已失效' };
      }
      
      const feeds = await this.getRSSFeeds();
      const feed = feeds.find(f => f.id === feedId);
      if (feed) {
        feed.enabled = enabled;
        await this.saveRSSFeeds(feeds);
      }
      return { success: true };
    } catch (error) {
      // 静默处理扩展上下文失效
      if (error.message && error.message.includes('Extension context invalidated')) {
        return { success: false, error: '扩展上下文已失效' };
      }
      console.error('[RSS] Failed to toggle feed:', error);
      return { success: false, error: error.message };
    }
  },
  
  /**
   * 获取RSS内容（通过background.js避免CORS限制）
   * @param {string} url - RSS地址
   * @returns {Promise<Object>} RSS内容
   */
  async fetchRSSFeed(url) {
    try {
      // 检查缓存
      const cached = this.rssCache.get(url);
      if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
        console.log('[RSS] Using cached feed:', url);
        return { success: true, items: cached.items, feedTitle: cached.feedTitle };
      }
      
      // 检查扩展上下文是否有效
      if (!this.isContextValid()) {
        throw new Error('Extension context invalidated');
      }
      
      // 通过background.js获取RSS（避免CORS限制）
      console.log('[RSS] Fetching RSS via background:', url);
      const result = await new Promise((resolve, reject) => {
        try {
          chrome.runtime.sendMessage(
            { action: 'fetchRSSFeed', url: url },
            (response) => {
              if (chrome.runtime.lastError) {
                // 静默处理扩展上下文失效
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
        throw new Error(result.error || '获取RSS失败');
      }
      
      // 解析XML（在content script中解析，因为background.js没有DOM）
      const xmlText = result.xmlText;
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
      
      // 检查解析错误
      const parseError = xmlDoc.querySelector('parsererror');
      if (parseError) {
        console.error('[RSS] XML parse error:', parseError.textContent);
        throw new Error('XML解析失败');
      }
      
      // 解析RSS/Atom内容
      const parsedResult = this.parseRSSContent(xmlDoc);
      
      // 缓存结果
      this.rssCache.set(url, {
        items: parsedResult.items,
        feedTitle: parsedResult.feedTitle,
        timestamp: Date.now()
      });
      
      console.log('[RSS] Successfully fetched and parsed RSS:', url, parsedResult.items.length, 'items');
      return { success: true, ...parsedResult };
    } catch (error) {
      console.error('[RSS] Failed to fetch feed:', url, error);
      
      // 提供更友好的错误信息
      let errorMessage = '获取RSS失败';
      if (error.name === 'AbortError') {
        errorMessage = '请求超时';
      } else if (error.message.includes('NetworkError')) {
        errorMessage = '网络错误';
      } else if (error.message.includes('CORS')) {
        errorMessage = '跨域访问被拒绝';
      } else {
        errorMessage = error.message || '获取RSS失败';
      }
      
      return { success: false, error: errorMessage, items: [] };
    }
  },
  
  /**
   * 解析RSS/Atom XML内容
   * @param {Document} xmlDoc - XML文档对象
   * @returns {Object} 解析后的内容
   */
  parseRSSContent(xmlDoc) {
    try {
      // 判断是RSS还是Atom
      const isAtom = xmlDoc.querySelector('feed') !== null;
      const isRSS = xmlDoc.querySelector('rss') !== null || xmlDoc.querySelector('rdf\\:RDF') !== null;
      
      let feedTitle = '';
      let items = [];
      
      if (isAtom) {
        // 解析Atom格式
        feedTitle = this.getTextContent(xmlDoc.querySelector('feed > title')) || 'Atom Feed';
        const entries = xmlDoc.querySelectorAll('entry');
        
        items = Array.from(entries).map(entry => ({
          title: this.getTextContent(entry.querySelector('title')) || '无标题',
          link: this.getAtomLink(entry),
          description: this.getTextContent(entry.querySelector('summary, content')) || '',
          pubDate: this.getTextContent(entry.querySelector('published, updated')) || '',
          source: feedTitle
        }));
      } else if (isRSS) {
        // 解析RSS 2.0格式
        feedTitle = this.getTextContent(xmlDoc.querySelector('channel > title, rss > title')) || 'RSS Feed';
        const entries = xmlDoc.querySelectorAll('item');
        
        items = Array.from(entries).map(entry => ({
          title: this.getTextContent(entry.querySelector('title')) || '无标题',
          link: this.getTextContent(entry.querySelector('link')) || '',
          description: this.getTextContent(entry.querySelector('description, content\\:encoded')) || '',
          pubDate: this.getTextContent(entry.querySelector('pubDate, dc\\:date')) || '',
          source: feedTitle
        }));
      } else {
        console.warn('[RSS] Unknown feed format');
        return { feedTitle: 'Unknown Feed', items: [] };
      }
      
      // 清理HTML标签（描述中可能包含HTML）
      items = items.map(item => ({
        ...item,
        description: this.cleanHTML(item.description),
        cleanTitle: this.cleanHTML(item.title)
      }));
      
      console.log(`[RSS] Parsed ${items.length} items from ${feedTitle}`);
      
      return { feedTitle, items };
    } catch (error) {
      console.error('[RSS] Failed to parse RSS content:', error);
      return { feedTitle: 'Error', items: [] };
    }
  },
  
  /**
   * 获取Atom格式的链接
   * @param {Element} entry - entry元素
   * @returns {string} 链接地址
   */
  getAtomLink(entry) {
    const link = entry.querySelector('link[rel="alternate"], link:not([rel])');
    if (link) {
      return link.getAttribute('href') || '';
    }
    return '';
  },
  
  /**
   * 获取文本内容（处理CDATA）
   * @param {Element} element - XML元素
   * @returns {string} 文本内容
   */
  getTextContent(element) {
    if (!element) return '';
    
    // 处理CDATA
    const cdataContent = element.textContent || element.innerHTML;
    return cdataContent.trim();
  },
  
  /**
   * 清理HTML标签
   * @param {string} html - 包含HTML的字符串
   * @returns {string} 纯文本
   */
  cleanHTML(html) {
    if (!html) return '';
    
    // 创建临时元素来解析HTML
    const temp = document.createElement('div');
    temp.innerHTML = html;
    
    // 获取纯文本
    let text = temp.textContent || temp.innerText || '';
    
    // 清理多余空白
    text = text.replace(/\s+/g, ' ').trim();
    
    // 限制长度
    if (text.length > 200) {
      text = text.substring(0, 200) + '...';
    }
    
    return text;
  },
  
  /**
   * 将RSS项转换为卡片格式
   * @param {Object} item - RSS项
   * @returns {Object} 卡片对象
   */
  convertToCard(item) {
    return {
      type: 'rss',
      title: item.cleanTitle || item.title,
      content: item.description || '暂无描述',
      source: item.source,
      url: item.link,
      language: 'zh',
      pubDate: item.pubDate
    };
  },
  
  /**
   * 获取所有启用的RSS卡片
   * @returns {Promise<Array>} 卡片数组
   */
  async fetchAllRSSCards() {
    try {
      // 检查扩展上下文是否有效
      if (!this.isContextValid()) {
        console.warn('[RSS] Extension context invalidated, cannot fetch cards');
        return [];
      }
      
      const feeds = await this.getRSSFeeds();
      const enabledFeeds = feeds.filter(feed => feed.enabled);
      
      if (enabledFeeds.length === 0) {
        console.log('[RSS] No enabled feeds');
        return [];
      }
      
      // 并发获取所有RSS源（但限制并发数）
      const allCards = [];
      
      for (const feed of enabledFeeds) {
        try {
          // 每次循环都检查上下文（但不阻止处理后续源）
          if (!this.isContextValid()) {
            console.warn(`[RSS] Extension context invalidated, skipping feed: ${feed.name}`);
            continue; // 跳过当前源，继续处理下一个
          }
          
          const result = await this.fetchRSSFeed(feed.url);
          if (result.success && result.items) {
            // 只取最新的5篇文章
            const recentItems = result.items.slice(0, 5);
            const cards = recentItems.map(item => this.convertToCard(item));
            allCards.push(...cards);
            
            // 更新最后更新时间
            feed.lastUpdate = Date.now();
            console.log(`[RSS] Successfully fetched ${cards.length} cards from ${feed.name}`);
          } else {
            console.warn(`[RSS] Failed to fetch feed ${feed.name}: ${result.error || 'Unknown error'}`);
          }
        } catch (error) {
          // 静默处理扩展上下文失效，但不阻止处理后续源
          if (error.message && error.message.includes('Extension context invalidated')) {
            console.warn(`[RSS] Extension context invalidated, skipping feed: ${feed.name}`);
            continue; // 跳过当前源，继续处理下一个
          }
          console.warn(`[RSS] Failed to fetch feed ${feed.name}:`, error.message || error);
          // 继续处理下一个源，不中断整个流程
        }
        
        // 添加延迟，避免过快请求
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      // 保存更新时间（只在上下文有效时）
      if (this.isContextValid()) {
        await this.saveRSSFeeds(feeds);
      }
      
      console.log(`[RSS] Fetched ${allCards.length} cards from ${enabledFeeds.length} feeds`);
      return allCards;
    } catch (error) {
      // 静默处理扩展上下文失效错误
      if (error.message && error.message.includes('Extension context invalidated')) {
        console.warn('[RSS] Extension context invalidated');
        return [];
      }
      console.error('[RSS] Failed to fetch RSS cards:', error);
      return [];
    }
  },
  
  /**
   * 验证URL格式
   * @param {string} url - 待验证的URL
   * @returns {boolean} 是否有效
   */
  isValidURL(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.protocol === 'http:' || urlObj.protocol === 'https:';
    } catch {
      return false;
    }
  },
  
  /**
   * 从URL提取域名
   * @param {string} url - URL地址
   * @returns {string} 域名
   */
  extractDomainName(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.replace('www.', '');
    } catch {
      return 'RSS Feed';
    }
  },
  
  /**
   * 清除RSS缓存
   */
  clearCache() {
    this.rssCache.clear();
    console.log('[RSS] Cache cleared');
  }
};

console.log('[RSS] RSS Client loaded');

