# 部署说明：Vercel 前端 + Render 后端

这个项目现在按 **前后端分离** 方式部署：

- **前端（Vercel）**：静态页面，目录为 `img-toolbox-app/public/`
- **后端（Render）**：Node API + Python/OpenCV，目录为 `img-toolbox-app/`

核心路线不变：
- 前端负责上传、画遮罩、透明还原
- 后端负责 `POST /api/inpaint` 的 Telea 修复

---

## 1. 目录职责

```text
img-toolbox-app/
├─ public/                # 前端静态资源（部署到 Vercel）
│  ├─ index.html
│  ├─ app.js
│  ├─ styles.css
│  └─ runtime-config.js   # 运行时 API Base URL 配置
├─ scripts/
│  └─ prepare-frontend.mjs # 用环境变量生成 runtime-config.js
├─ server.js              # Node API 服务
├─ telea_inpaint.py       # Python/OpenCV Telea 修复脚本
├─ requirements.txt       # Python 依赖
├─ package.json           # Node 依赖
└─ render.yaml            # Render Blueprint 示例
```

---

## 2. 环境变量约定

### 前端（Vercel）

前端唯一关键变量：

- `IMGEXE_API_BASE_URL`
  - 用途：告诉浏览器后端 API 的公网地址
  - 示例：`https://imgexe-watermark-api.onrender.com`
  - 留空：表示使用同源 `/api/...`，适合本地用 Node 直接托管前端时

前端不会直接在浏览器里读取 Vercel env，而是通过构建前执行：

```bash
npm run prepare:frontend
```

该脚本会把环境变量写入：

- `public/runtime-config.js`

浏览器启动时再从这个文件读取 `apiBaseUrl`。

仓库里也已提供一个默认的 `public/runtime-config.js`（空字符串 = 同源 `/api`），所以本地跑 `npm start` 时不会因为缺文件而报 404。

### 后端（Render）

建议使用这些环境变量：

- `NODE_ENV=production`
- `PORT`：Render 会自动注入
- `INPAINT_TIMEOUT_MS=60000`
- `INPAINT_PYTHON`：可选；若你想强制指定 Python 路径再设置

目前后端默认会自动寻找：
1. `INPAINT_PYTHON`
2. 项目内 `.venv/bin/python`
3. 系统 `python3.12 / python3.11 / python3 / python`

---

## 3. 本地联调方式

在后端目录启动 API：

```bash
cd img-toolbox-app
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install -U pip
python -m pip install -r requirements.txt
npm install
npm start
```

> 如果部署到 Vercel，仓库根目录下的 `vercel.json` 会强制执行：
>
> ```bash
> npm run prepare:frontend
> ```
>
> 并把 `public/` 作为输出目录，因此 `IMGEXE_API_BASE_URL` 必须在 Vercel 项目环境变量里配置好。

默认后端地址：

- `http://localhost:3100`

如果你想模拟前后端分离的前端配置：

```bash
cd img-toolbox-app
IMGEXE_API_BASE_URL=http://localhost:3100 npm run prepare:frontend
```

然后直接打开 `public/index.html`，或把 `public/` 放到任意静态服务器中测试。

---

## 4. 部署后端到 Render

### 方案 A：直接新建 Web Service（推荐）

在 Render 控制台创建一个 **Web Service**，配置建议如下：

- **Root Directory**: 留空（仓库根目录）
- **Runtime**: `Node`
- **Build Command**:

```bash
npm install
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
```

### 验证方式

部署完成后先测：

```bash
curl https://你的-render-域名.onrender.com/api/health
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

仓库里已给了示例：

- `img-toolbox-app/render.yaml`

可作为 Render Blueprint 导入参考，但如果控制台 UI 更顺手，直接照上面的参数填也行。

---

## 5. 部署前端到 Vercel

### 推荐方式

前端是纯静态站点，建议在 Vercel 中：

- **Root Directory**: 留空（仓库根目录）
- **Framework Preset**: `Other`
- **Build Command**:

```bash
npm install
npm run prepare:frontend
```

- **Output Directory**:

```text
public
```

### 前端环境变量

在 Vercel 项目里添加：

```text
IMGEXE_API_BASE_URL=https://你的-render-域名.onrender.com
```

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
- **Vercel + Render 分离部署**：把 `apiBaseUrl` 指向 Render 域名

这样做的好处：

1. 不改核心算法和接口协议
2. 本地开发仍然简单
3. 部署时只需要改一个环境变量
4. 前端保持纯静态，不必强行引入 React / Next / SSR

---

## 7. 发布检查清单

### 后端 Render

- [ ] `npm install` 成功
- [ ] `pip install -r requirements.txt` 成功
- [ ] `/api/health` 返回 `ok: true`
- [ ] 上传一张图和 mask 后 `/api/inpaint` 能返回二进制结果

### 前端 Vercel

- [ ] `IMGEXE_API_BASE_URL` 已指向正确 Render 域名
- [ ] 页面能正常上传图片
- [ ] 点击“去除水印”会请求 Render 而不是 Vercel 自身
- [ ] 结果可以预览与下载

---

## 8. 未来若要继续拆分

现在这版已经够支撑 Vercel + Render。

如果后续还要继续工程化，可以再考虑：

- 把前端单独提成 `frontend/`
- 把后端单独提成 `backend/`
- 增加 CORS 白名单
- 增加任务队列 / 限流 / 文件对象存储
- 为 Render 改成 Docker 部署，进一步锁定 Python 版本

但这些都不是当前上线所必需的。
