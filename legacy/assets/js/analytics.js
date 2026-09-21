/* ═══════════════════════════════════════════════════════════════
   轻量级 analytics — 本地存储 + 可选上报
   无第三方依赖，纯前端实现
   ═══════════════════════════════════════════════════════════════ */
(function() {
  'use strict';
  
  const STORAGE_KEY = 'ga_data';
  const SESSION_KEY = 'ga_session';
  
  function getData() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } 
    catch(e) { return {}; }
  }
  
  function setData(d) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(d)); } 
    catch(e) {}
  }
  
  // Track page view
  function trackPageView(page) {
    const data = getData();
    const today = new Date().toISOString().slice(0, 10);
    
    // Daily views
    if (!data.daily) data.daily = {};
    if (!data.daily[today]) data.daily[today] = { views: 0, pages: {} };
    data.daily[today].views++;
    data.daily[today].pages[page] = (data.daily[today].pages[page] || 0) + 1;
    
    // Total views
    data.totalViews = (data.totalViews || 0) + 1;
    
    // Page totals
    if (!data.pages) data.pages = {};
    data.pages[page] = (data.pages[page] || 0) + 1;
    
    // Unique visitors (by session)
    const sessionId = sessionStorage.getItem(SESSION_KEY);
    if (!sessionId) {
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      sessionStorage.setItem(SESSION_KEY, id);
      data.uniqueVisitors = (data.uniqueVisitors || 0) + 1;
    }
    
    setData(data);
  }
  
  // Track event
  function trackEvent(category, action, label) {
    const data = getData();
    if (!data.events) data.events = [];
    data.events.push({
      category, action, label,
      time: Date.now(),
      page: location.pathname
    });
    // Keep last 500 events
    if (data.events.length > 500) data.events = data.events.slice(-500);
    setData(data);
  }
  
  // Get stats summary
  function getStats() {
    const data = getData();
    const today = new Date().toISOString().slice(0, 10);
    return {
      totalViews: data.totalViews || 0,
      uniqueVisitors: data.uniqueVisitors || 0,
      todayViews: (data.daily || {})[today]?.views || 0,
      pages: data.pages || {},
      recentEvents: (data.events || []).slice(-20)
    };
  }
  
  // Auto-track page view
  const page = location.pathname;
  trackPageView(page === '/' ? 'home' : page);
  
  // Expose API
  window.GameAnalytics = { trackPageView, trackEvent, getStats };
})();
