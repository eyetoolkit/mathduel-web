/* ═══════════════════════════════════════════════════════════════
   战绩分享卡片生成器
   使用 Canvas 生成分享图片，支持下载和复制
   ═══════════════════════════════════════════════════════════════ */
(function() {
  'use strict';
  
  const COLORS = {
    primary: '#1E40AF',
    accent: '#F59E0B',
    bg: '#FAFAFA',
    text: '#0F172A',
    success: '#10B981',
    white: '#FFFFFF'
  };
  
  function generateCard(options) {
    const {
      title = '数学对决',
      game = '',
      score = 0,
      time = 0,
      level = '',
      streak = 0,
      width = 600,
      height = 315
    } = options;
    
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    
    // Background gradient
    const grad = ctx.createLinearGradient(0, 0, width, height);
    grad.addColorStop(0, COLORS.primary);
    grad.addColorStop(1, '#3B82F6');
    ctx.fillStyle = grad;
    ctx.roundRect(0, 0, width, height, 16);
    ctx.fill();
    
    // Decorative circles
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath();
    ctx.arc(width - 60, 60, 80, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(80, height - 40, 60, 0, Math.PI * 2);
    ctx.fill();
    
    // Title
    ctx.fillStyle = COLORS.white;
    ctx.font = 'bold 28px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(title, 40, 50);
    
    // Game name
    if (game) {
      ctx.font = '20px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fillText(game, 40, 85);
    }
    
    // Stats grid
    const stats = [];
    if (score > 0) stats.push({ label: '得分', value: score.toString() });
    if (time > 0) stats.push({ label: '用时', value: formatTime(time) });
    if (level) stats.push({ label: '关卡', value: level.toString() });
    if (streak > 0) stats.push({ label: '连胜', value: streak.toString() });
    
    if (stats.length > 0) {
      const startX = 40;
      const startY = 140;
      const cardWidth = 120;
      const gap = 15;
      
      stats.forEach((s, i) => {
        const x = startX + i * (cardWidth + gap);
        
        // Stat card
        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        ctx.roundRect(x, startY, cardWidth, 80, 8);
        ctx.fill();
        
        // Value
        ctx.fillStyle = COLORS.white;
        ctx.font = 'bold 24px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(s.value, x + cardWidth / 2, startY + 40);
        
        // Label
        ctx.font = '14px system-ui, sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.fillText(s.label, x + cardWidth / 2, startY + 65);
      });
    }
    
    // Footer
    ctx.textAlign = 'left';
    ctx.font = '14px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillText('数学对决', 40, height - 25);
    
    // Date
    ctx.textAlign = 'right';
    ctx.fillText(new Date().toLocaleDateString('zh-CN'), width - 40, height - 25);
    
    return canvas;
  }
  
  function formatTime(seconds) {
    if (seconds < 60) return seconds + 's';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }
  
  function showShareDialog(canvas) {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:10002;display:flex;align-items:center;justify-content:center;padding:1rem;';
    
    const dialog = document.createElement('div');
    dialog.style.cssText = 'background:white;padding:1.5rem;border-radius:12px;max-width:400px;width:100%;text-align:center;';
    
    const img = document.createElement('img');
    img.src = canvas.toDataURL('image/png');
    img.style.cssText = 'width:100%;border-radius:8px;margin-bottom:1rem;';
    
    const title = document.createElement('h3');
    title.textContent = '分享战绩';
    title.style.cssText = 'margin:0 0 1rem;color:#0F172A;';
    
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:0.5rem;justify-content:center;';
    
    // Download button
    const dlBtn = document.createElement('button');
    dlBtn.textContent = '📥 下载图片';
    dlBtn.style.cssText = 'padding:0.5rem 1rem;background:#1E40AF;color:white;border:none;border-radius:6px;cursor:pointer;font-weight:600;';
    dlBtn.onclick = () => {
      const a = document.createElement('a');
      a.download = 'game-score-' + Date.now() + '.png';
      a.href = canvas.toDataURL('image/png');
      a.click();
    };
    
    // Copy button
    const cpBtn = document.createElement('button');
    cpBtn.textContent = '📋 复制图片';
    cpBtn.style.cssText = 'padding:0.5rem 1rem;background:#10B981;color:white;border:none;border-radius:6px;cursor:pointer;font-weight:600;';
    cpBtn.onclick = async () => {
      try {
        const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
        await navigator.clipboard.write([new ClipboardItem({'image/png': blob})]);
        cpBtn.textContent = '✅ 已复制';
        setTimeout(() => cpBtn.textContent = '📋 复制图片', 2000);
      } catch(e) {
        alert('复制失败，请手动下载');
      }
    };
    
    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = 'position:absolute;top:0.75rem;right:0.75rem;background:none;border:none;font-size:1.5rem;cursor:pointer;color:#64748B;';
    closeBtn.onclick = () => overlay.remove();
    
    // Share button (Web Share API)
    const shareBtn = document.createElement('button');
    shareBtn.textContent = '🔗 分享';
    shareBtn.style.cssText = 'padding:0.5rem 1rem;background:#F59E0B;color:white;border:none;border-radius:6px;cursor:pointer;font-weight:600;';
    shareBtn.onclick = async () => {
      try {
        const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
        const file = new File([blob], 'game-score.png', { type: 'image/png' });
        await navigator.share({ files: [file], title: '我的游戏战绩' });
      } catch(e) {
        // Fallback: download
        dlBtn.click();
      }
    };
    
    btnRow.appendChild(dlBtn);
    btnRow.appendChild(cpBtn);
    if (navigator.share) btnRow.appendChild(shareBtn);
    btnRow.appendChild(closeBtn);
    
    dialog.appendChild(title);
    dialog.appendChild(img);
    dialog.appendChild(btnRow);
    overlay.appendChild(dialog);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
  }
  
  // Expose API
  window.ShareCard = {
    generate: generateCard,
    show: showShareDialog,
    quick: (game, score, time) => {
      const canvas = generateCard({ game, score, time });
      showShareDialog(canvas);
    }
  };
})();
