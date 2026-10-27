const fs = require('fs');
const files = ['index.html','payment.html','dtdshopcc.html','chat.html','trade.html','track.html','smtp.html'];
const pwaHead = `  <link rel="manifest" href="/manifest.json" />
  <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
  <meta name="mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black" />
  <meta name="apple-mobile-web-app-title" content="DTD Store" />
`;
const pwaBody = `  <script>
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/service-worker.js").then((r) => console.log("SW ready:", r.scope)).catch((e) => console.log("SW err:", e));
    }
  </script>
`;
for (const f of files) {
  let c = fs.readFileSync(f, 'utf8');
  c = c.replace('</head>', pwaHead + '</head>');
  c = c.replace('</body>', pwaBody + '</body>');
  fs.writeFileSync(f, c);
  console.log('updated ' + f);
}
