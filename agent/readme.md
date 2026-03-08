pm2 start agent.js --name "kiosk-agent"
pm2 stop kiosk-agent
pm2 delete kiosk-agent
pm2 list
pm2 logs kiosk-agent
pm2 monitor
