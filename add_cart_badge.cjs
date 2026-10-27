const fs = require('fs');
const files = ['index.html','payment.html','dtdshopcc.html','chat.html','trade.html','track.html','smtp.html'];
const cartHtml = `          <a href="/cart" class="topbar-link" id="cartLink" style="position:relative">
            🛒 Cart <span id="cartBadge" style="position:absolute;top:-6px;right:-8px;background:var(--neon);color:var(--bg);font-size:0.65rem;font-weight:800;padding:0.125rem 0.4rem;border-radius:50%;min-width:1.2rem;height:1.2rem;display:flex;align-items:center;justify-content:center">0</span>
          </a>
`;
for (const f of files) {
  let c = fs.readFileSync(f, 'utf8');
  c = c.replace('        <div class="topbar-actions">\n          <button id="btnMenuToggle"', cartHtml + '        <div class="topbar-actions">\n          <button id="btnMenuToggle"');
  fs.writeFileSync(f, c);
  console.log('updated ' + f);
}
