import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;
const APP_VERSION = '0.3.3';

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Serve static extension files so the user can "see" them in the preview if they browse
app.use('/files', express.static(process.cwd()));

app.get('/', (req, res) => {
  const readme = fs.readFileSync(path.join(process.cwd(), 'README.md'), 'utf-8');
  const readmeHtml = escapeHtml(readme)
    .replace(/# (.+)/, '<h1 class="text-3xl font-bold mb-4">$1</h1>')
    .split('\n')
    .map(line => {
      if (line.startsWith('## ')) return `<h2 class="text-2xl font-semibold mt-8 mb-4 border-b pb-2">${line.substring(3)}</h2>`;
      if (line.startsWith('- ')) return `<li class="ml-4">${line.substring(2)}</li>`;
      if (line.match(/^\d\. /)) return `<li class="ml-4 list-decimal">${line.substring(3)}</li>`;
      return `<p class="mb-2">${line}</p>`;
    })
    .join('');
  
  res.send(`
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Playable Engine Scanner - Dev Guide</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/github-markdown-css/5.2.0/github-markdown.min.css">
      <style>
        .markdown-body {
          box-sizing: border-box;
          min-width: 200px;
          max-width: 980px;
          margin: 0 auto;
          padding: 45px;
        }
        @media (max-width: 767px) {
          .markdown-body { padding: 15px; }
        }
      </style>
    </head>
    <body class="bg-gray-50">
      <div class="max-w-5xl mx-auto py-12 px-4 sm:px-6 lg:px-8">
        <div class="bg-white shadow rounded-lg overflow-hidden">
          <div class="px-4 py-5 sm:p-6">
            <article class="markdown-body">
              ${readmeHtml}
            </article>
          </div>
          <div class="bg-gray-100 px-4 py-4 sm:px-6 flex justify-between items-center">
            <p class="text-sm text-gray-500">Playable Engine Scanner v${APP_VERSION}</p>
            <div class="flex gap-4">
              <a href="/files/manifest.json" target="_blank" class="text-blue-600 hover:underline text-sm font-medium">View Manifest</a>
              <a href="/files/README.md" target="_blank" class="text-blue-600 hover:underline text-sm font-medium">View README</a>
            </div>
          </div>
        </div>
      </div>
    </body>
    </html>
  `);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running at http://0.0.0.0:${PORT}`);
});
