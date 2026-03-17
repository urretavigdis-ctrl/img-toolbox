# 部署说明：Vercel 前端 + Render 后端

这个项目现在按 **前后端分离** 方式部署：

- **前端（Vercel）**：静态页面，输出目录为 `public/`
- **后端（Render）**：Node API + Python/OpenCV

核心路线不变：
- 前端负责上传、画遮罩、透明还原
- 后端负责 `POST /api/inpaint` 的 Telea 修复

---

## 0. 先统一一个前提

当前 **Git 仓库根目录就是本项目目录本身**。

所以部署平台里不要再把这些路径写成：
- `img-toolbox-app/public`
- `img-toolbox-app/render.yaml`
- Root Directory = `img-toolbox-app`

这些写法都是旧路径残留，导入当前仓库时会把平台带到一个不存在的嵌套目录。

你应该按下面理解：

```text
repo-root/
├─ public/
├─ scripts/
├─ package.json
├─ requirements.txt
├─ server.js
├─ telea_inpaint.py
├─ render.yaml
└─ vercel.json
```

---

## 1. 目录职责

```text
repo-root/
├─ public/                 # 前端静态资源（部署到 Vercel）
│  ├─ index.html
│  ├─ app.js
│  ├─ styles.css
│  └─ runtime-config.js    # 运行时 API Base URL 配置
├─ scripts/
│  ├─ prepare-frontend.mjs
│  └─ verify-runtime-config.mjs
├─ server.js               # Node API 服务
├─ telea_inpaint.py        # Python/OpenCV Telea 修复脚本
├─ requirements.txt        # Python 依赖
├─ package.json            # Node 依赖
├─ render.yaml             # Render Blueprint 示例
└─ vercel.json             # Vercel 构建配置
```

---

## 2. 环境变量约定

### 前端（Vercel）

关键变量：

- `IMGEXE_API_BASE_URL`
  - 用途：告诉浏览器后端 API 的公网地址
  - 示例：`https://your-render-service.onrender.com`
  - 值要求：只填 **源站 origin**，不要带 `/api/inpaint`
  - 正确：`https://your-render-service.onrender.com`
  - 错误：`https://your-render-service.onrender.com/api/inpaint`

前端不会直接在浏览器里读取 Vercel env，而是构建前执行：

```bash
npm run prepare:frontend
```

该脚本会把环境变量写入：

- `public/runtime-config.js`

浏览器启动时再从这个文件读取 `apiBaseUrl`。

### 运行时配置兜底逻辑

- 本地一体运行：`IMGEXE_API_BASE_URL` 可留空，前端自动走同源 `/api/inpaint`
- Vercel 生产构建：若 `IMGEXE_API_BASE_URL` 为空，构建会直接失败，避免再次生成“空 apiBaseUrl”的坏包
- 如果你想在别的 CI 环境也强制校验，可额外设置：

```text
IMGEXE_STRICT_RUNTIME_CONFIG=true
```

### 后端（Render）

建议使用这些环境变量：

- `NODE_ENV=production`
- `PORT`：Render 会自动注入
- `INPAINT_TIMEOUT_MS=60000`
- `CORS_ALLOW_ORIGINS=https://你的-vercel-域名`
- `INPAINT_PYTHON`：可选；若你想强制指定 Python 路径再设置

目前后端默认会自动寻找：
1. `INPAINT_PYTHON`
2. 项目内 `.venv/bin/python`
3. 系统 `python3.12 / python3.11 / python3 / python`

---

## 3. 本地联调方式

在仓库根目录执行：

```bash
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install -U pip
python -m pip install -r requirements.txt
npm install
npm start
```

默认后端地址：

- `http://localhost:3100`

如果你想模拟前后端分离的前端配置：

```bash
IMGEXE_API_BASE_URL=http://localhost:3100 npm run prepare:frontend
node scripts/verify-runtime-config.mjs
```

然后直接打开 `public/index.html`，或把 `public/` 放到任意静态服务器中测试。

---

## 4. 部署后端到 Render

### 方案 A：直接新建 Web Service（推荐）

在 Render 控制台创建一个 **Web Service**，配置建议如下：

- **Root Directory**: 留空
- **Runtime**: `Node`
- **Build Command**:

```bash
npm ci
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

- **Start Command**:

```bash
npm start
```

- **Health Check Path**:

```text
/api/health
```

- **Instance**：先用 `Starter` 就够

### 推荐环境变量

```text
NODE_ENV=production
INPAINT_TIMEOUT_MS=60000
CORS_ALLOW_ORIGINS=https://your-vercel-project.vercel.app
```

### 验证方式

部署完成后先测：

```bash
curl https://your-render-service.onrender.com/api/health
```

期望返回：

```json
{"ok":true,"algo":"telea","python":"..."}
```

### Render 注意事项

1. **冷启动**：Starter 方案可能会慢一点，属正常现象。
2. **Python 依赖安装**：`opencv-python-headless` 安装时间会比纯 Node 服务更长。
3. **超时**：大图或大面积遮罩时，建议保留 `INPAINT_TIMEOUT_MS=60000` 甚至再提高。
4. **磁盘写入**：当前后端只在系统 tmp 目录写临时文件，适合 Render 这种短生命周期容器。

### Blueprint 文件

仓库里已给出：

- `render.yaml`

可直接作为 Render Blueprint 参考。当前版本已经移除了旧的嵌套 `rootDir` 残留。

---

## 5. 部署前端到 Vercel

前端是纯静态站点，建议在 Vercel 中：

- **Root Directory**: 留空
- **Framework Preset**: `Other`
- **Install Command**:

```bash
npm ci
```

- **Build Command**:

```bash
npm run prepare:frontend
```

- **Output Directory**:

```text
public
```

### 前端环境变量

在 Vercel 项目里添加：

```text
IMGEXE_API_BASE_URL=https://your-render-service.onrender.com
```

> 只填域名 origin，不要带 `/api/inpaint`。

### 部署顺序

建议按这个顺序：

1. 先部署 Render 后端
2. 拿到 Render 公网域名
3. 再把它填入 Vercel 的 `IMGEXE_API_BASE_URL`
4. 重新部署 Vercel

---

## 6. API Base URL 方案说明

当前前端采用的是：

- 默认：`/api/inpaint`（同源）
- 若 `runtime-config.js` 中有 `apiBaseUrl`：改为 `${apiBaseUrl}/api/inpaint`

也就是说：

- **本地一体运行**：不用配，直接走同源
- **Vercel + Render 分离部署**：把 `apiBaseUrl` 指向 Render 域名 origin

这样做的好处：

1. 不改核心算法和接口协议
2. 本地开发仍然简单
3. 部署时只需要改一个环境变量
4. 前端保持纯静态，不必强行引入 React / Next / SSR

---

## 7. 发布检查清单

### 后端 Render

- [ ] `npm ci` 成功
- [ ] `pip install -r requirements.txt` 成功
- [ ] `/api/health` 返回 `ok: true`
- [ ] 上传一张图和 mask 后 `/api/inpaint` 能返回二进制结果

### 前端 Vercel

- [ ] `IMGEXE_API_BASE_URL` 已指向正确 Render 域名 origin
- [ ] `npm run prepare:frontend` 成功
- [ ] `node scripts/verify-runtime-config.mjs` 输出正确域名
- [ ] 页面能正常上传图片
- [ ] 点击“去除水印”会请求 Render，而不是 Vercel 自身同源 `/api/inpaint`
- [ ] 结果可以预览与下载

---

## 8. 最小排障手册

### 情况 A：Vercel 页面还能请求到 `/api/inpaint`
说明前端打包时 `runtime-config.js` 里的 `apiBaseUrl` 仍为空。

排查顺序：
1. 确认 Vercel 里是否配置了 `IMGEXE_API_BASE_URL`
2. 确认值是不是 origin，而不是 `/api/inpaint` 全路径
3. 重新部署 Vercel
4. 查看构建日志里是否出现：
   - `[prepare-frontend] wrote ... with apiBaseUrl=https://...`
5. 如有需要，下载产物或打开站点源码，检查 `runtime-config.js`

### 情况 B：浏览器报跨域
说明 Render 侧 `CORS_ALLOW_ORIGINS` 没配对。

示例：
```text
CORS_ALLOW_ORIGINS=https://your-vercel-project.vercel.app
```

如果有自定义域名，可逗号分隔多个 origin：
```text
CORS_ALLOW_ORIGINS=https://app.example.com,https://your-vercel-project.vercel.app
```

### 情况 C：Render 健康检查失败
优先看：
1. `npm ci` 是否成功
2. `python -m pip install -r requirements.txt` 是否成功
3. `curl https://your-render-service.onrender.com/api/health` 返回的错误字段是什么

---

## 9. 未来若要继续拆分

现在这版已经够支撑 Vercel + Render。

如果后续还要继续工程化，可以再考虑：

- 把前端单独提成 `frontend/`
- 把后端单独提成 `backend/`
- 增加 CORS 白名单
- 增加任务队列 / 限流 / 文件对象存储
- 为 Render 改成 Docker 部署，进一步锁定 Python 版本

但这些都不是当前上线所必需的。
