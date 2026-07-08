const fs = require('fs');
let html = fs.readFileSync('index.html', 'utf8');
if (!html.includes('.markdown-body summary')) {
    html = html.replace('</head>', `
    <style>
      .markdown-body details {
          margin-bottom: 1rem;
      }
      .markdown-body summary {
          display: list-item !important;
          cursor: pointer;
          font-weight: bold;
          outline: none;
      }
      .markdown-body summary::marker, .markdown-body summary::-webkit-details-marker {
          display: list-item !important;
      }
    </style>
  </head>`);
    fs.writeFileSync('index.html', html);
}
