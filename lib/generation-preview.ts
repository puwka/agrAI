import type { AspectRatio } from "../features/dashboard/types";

export function buildPreviewDataUrl(
  modelName: string,
  prompt: string,
  aspectRatio: AspectRatio,
) {
  const sizeByAspect: Record<AspectRatio, { width: number; height: number }> = {
    "21:9": { width: 1680, height: 720 },
    "16:9": { width: 1280, height: 720 },
    "4:3": { width: 1024, height: 768 },
    "3:2": { width: 1200, height: 800 },
    "1:1": { width: 1024, height: 1024 },
    "2:3": { width: 800, height: 1200 },
    "3:4": { width: 768, height: 1024 },
    "9:16": { width: 720, height: 1280 },
  };
  const { width, height } = sizeByAspect[aspectRatio];
  const promptText = prompt.trim() || "Ваш промпт появится здесь";

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <defs>
        <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stop-color="#09090b" />
          <stop offset="50%" stop-color="#18181b" />
          <stop offset="100%" stop-color="#7c3aed" stop-opacity="0.65" />
        </linearGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#bg)" rx="32" />
      <circle cx="${width * 0.76}" cy="${height * 0.25}" r="${Math.min(width, height) * 0.11}" fill="#c084fc" fill-opacity="0.20" />
      <circle cx="${width * 0.22}" cy="${height * 0.7}" r="${Math.min(width, height) * 0.17}" fill="#7c3aed" fill-opacity="0.18" />
      <rect x="${width * 0.08}" y="${height * 0.1}" width="${width * 0.84}" height="${height * 0.8}" rx="28" fill="rgba(10,10,10,0.32)" stroke="rgba(255,255,255,0.12)" />
      <text x="${width * 0.12}" y="${height * 0.26}" fill="#ffffff" font-size="${Math.max(width * 0.035, 28)}" font-family="Arial, Helvetica, sans-serif" font-weight="700">${modelName}</text>
      <text x="${width * 0.12}" y="${height * 0.34}" fill="#c4b5fd" font-size="${Math.max(width * 0.018, 18)}" font-family="Arial, Helvetica, sans-serif">Preview • ${aspectRatio}</text>
      <foreignObject x="${width * 0.12}" y="${height * 0.42}" width="${width * 0.7}" height="${height * 0.24}">
        <div xmlns="http://www.w3.org/1999/xhtml" style="color:#e4e4e7;font-family:Arial,Helvetica,sans-serif;font-size:${Math.max(width * 0.018, 18)}px;line-height:1.55;">
          ${promptText.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}
        </div>
      </foreignObject>
    </svg>
  `;

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
