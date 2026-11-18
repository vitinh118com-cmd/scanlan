# HACHIHI Network Tool

Web (React + TS + Vite PWA) + Windows Agent (.NET, 127.0.0.1:47800).

## Chạy web
    cd apps/web && npm install && npm run dev      # http://127.0.0.1:5173

## Chạy Agent
    cd agent/src/Hachihi.Agent.Host && dotnet run  # hiện mã ghép cặp 6 số

## Deploy Vercel
Root Directory `apps/web`, Framework Vite, Build `npm run build`, Output `dist`.
Thêm domain Vercel vào `AllowedOrigins` trong `agent/src/Hachihi.Agent.Host/appsettings.json`.
