#!/bin/bash
cd /opt/mindcanvas/web
npm run build && cp -r dist/* /var/www/mindcanvas/
echo "部署完成"
