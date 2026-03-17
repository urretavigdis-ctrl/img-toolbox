# Mac mini 本地部署（Docker + Nginx）

## 目标
在 Mac mini 上本地自托管这个网站：
- `app` 容器：Node + Python/OpenCV
- `nginx` 容器：对外暴露 80 端口

## 前提
需要先安装 Docker Desktop for Mac。

验证命令：
```bash
docker --version
docker compose version
```

## 启动
在项目目录执行：
```bash
docker compose up -d --build
```

## 检查
```bash
docker compose ps
curl http://localhost/api/health
```

健康检查成功时会返回：
```json
{"ok":true,"algo":"telea","python":"..."}
```

## 访问
浏览器打开：
```text
http://localhost
```

如果同局域网其他设备要访问，把 `localhost` 换成这台 Mac mini 的局域网 IP。

## 常用命令
查看日志：
```bash
docker compose logs -f
```

停止：
```bash
docker compose down
```

重启并重新构建：
```bash
docker compose up -d --build
```

## 说明
- 当前先走 HTTP，不上 HTTPS
- 当前 `CORS_ALLOW_ORIGINS` 设为 `*`，因为现在是本地一体部署
- 后面如果你要外网访问，再单独补：
  - Tailscale
  - 端口映射
  - DDNS / 域名 / HTTPS
