#!/usr/bin/env bash
echo "$(date +"%F %T.%N") Script started"
#export PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
#export PUPPETEER_EXECUTABLE_PATH=/opt/google/chrome/chrome
echo "$(date +"%F %T.%N") node index.js"
node index.js
echo "$(date +"%F %T.%N") node weather.js"
node weather.js
echo "$(date +"%F %T.%N") Script completed"
