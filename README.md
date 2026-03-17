# img-toolbox-app

高相似复刻 `imgexe.com` 的图像工具站项目目录。

当前优先落地模块：`去除水印.exe`

## 当前实现方向
- UI：高相似工作台风格
- 去除模式 1：扩散修复（服务端 Telea inpaint）
- 去除模式 2：透明还原（前端本地反向 alpha 混合）

## 部署架构
当前推荐部署方式已经整理为：

- **Vercel**：部署前端静态页面（`public/`）
- **Render**：部署 Node + Python 后端（`/api/inpaint`）

详细说明见：

- [`DEPLOYMENT.md`](./DEPLOYMENT.md)
- [`render.yaml`](./render.yaml)

## 目录
- `public/`：前端静态页面资源
- `public/runtime-config.js`：前端运行时配置，主要用于 API Base URL
- `scripts/prepare-frontend.mjs`：根据 `IMGEXE_API_BASE_URL` 生成前端运行时配置
- `server.js`：Node 服务，提供 `/api/inpaint` 和 `/api/health`
- `telea_inpaint.py`：Python/OpenCV 的 Telea 修复脚本
- `requirements.txt`：Python 依赖
- `package.json`：Node 依赖与脚本
- `render.yaml`：Render Blueprint 示例
- `example/`：本地 smoke test 示例输入

## 前后端分离约定
### 前端
- 入口目录：`public/`
- 默认 API：同源 `/api/inpaint`
- 若设置 `IMGEXE_API_BASE_URL`，前端会改为请求 `${IMGEXE_API_BASE_URL}/api/inpaint`

### 后端
- 继续沿用当前接口：`POST /api/inpaint`
- 保持表单字段不变：
  - `image`
  - `mask`
  - `format`

这样可以在**不改核心方法路线**的前提下，把前端挂 Vercel、后端挂 Render。

## /api/inpaint 接口
- 方法：`POST`
- Content-Type：`multipart/form-data`
- 表单字段：
  - `image`: 原图文件
  - `mask`: 蒙版文件
  - `format`: `jpeg | jpg | png | webp`
- 响应：二进制图片
- 响应头：`X-Inpaint-Algo: telea`

### mask 约定
推荐使用：
- 黑底白字
- 或透明底白字

服务端会：
- 自动读取 mask
- 自动缩放到原图尺寸（最近邻）
- 转灰度
- 二值化
- 白色区域视为要修复的区域

## 本地运行（推荐：项目独立 venv）
这条链依赖 Python + OpenCV。最稳妥的做法是**只在项目目录里建虚拟环境**，避免污染系统 Python。

> **建议优先使用 Python 3.11 / 3.12。**
> 系统 Python 过新时，OpenCV 很可能拿不到现成 wheel，容易退回源码编译，安装慢且容易失败。

### 1) 安装 Node 依赖
```bash
cd 图像工具箱
npm install
```

### 2) 创建并启用 Python 虚拟环境
```bash
cd 图像工具箱
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install -U pip
python -m pip install -r requirements.txt
```

### 3) 启动本地一体服务
```bash
npm start
```

默认地址：`http://localhost:3100`

前端默认附带 `public/runtime-config.js`，本地一体运行时无需额外配置；如果要切到前后端分离地址，可执行：

```bash
npm run prepare:frontend
# 或：IMGEXE_API_BASE_URL=https://your-api.example.com npm run prepare:frontend
```

### 4) 若要模拟分离部署，生成前端 API 配置
```bash
IMGEXE_API_BASE_URL=http://localhost:3100 npm run prepare:frontend
```

## Python 选择逻辑
`server.js` 会按下面顺序找 Python：
1. `INPAINT_PYTHON` 环境变量
2. `img-toolbox-app/.venv/bin/python`
3. `img-toolbox-app/.venv/bin/python3`
4. 当前工作目录下的 `.venv/bin/python`
5. `python3.12`
6. `python3.11`
7. `python3.13`
8. `python3`
9. `python`

如果没找到，接口会直接返回清晰错误，并提示如何创建 venv。

### 指定自定义 Python
```bash
INPAINT_PYTHON=/absolute/path/to/python npm start
```

## 本地验证路径

### 验证 1：先单独跑 Python 脚本
```bash
cd 图像工具箱
source .venv/bin/activate
python telea_inpaint.py \
  --input /absolute/path/to/input.png \
  --mask /absolute/path/to/mask.png \
  --output /tmp/telea-out.png \
  --format png
```

### 验证 2：再测 Node API
```bash
curl -X POST http://localhost:3100/api/inpaint \
  -F "image=@/absolute/path/to/input.png" \
  -F "mask=@/absolute/path/to/mask.png" \
  -F "format=png" \
  --output /tmp/api-out.png
```

### 验证 3：看健康检查
```bash
curl http://localhost:3100/api/health
```

当前实现成功时会返回类似：
```json
{"ok":true,"algo":"telea","python":"/absolute/path/to/python"}
```

## 关键实现细节
- 后端算法：`cv2.inpaint(..., cv2.INPAINT_TELEA)`
- Python 脚本当前会校验：
  - 输入图是否可读
  - mask 是否可读
  - format 是否支持
  - 阈值化后 mask 是否为空
- 输入若带 alpha：
  - 修复在 RGB/BGR 通道完成
  - 若导出为 `png`，会保留原图 alpha 通道
- mask 会按灰度读取并二值化；若尺寸不一致，会先按最近邻缩放到原图尺寸
- Node 侧当前会处理：
  - `image` / `mask` 缺失
  - Python 启动失败
  - 常见依赖缺失（如 `cv2`）报错提示
  - Multer 上传大小限制（单次最多 25MB）

## 常见报错与处理

### 1) `No module named 'cv2'`
说明服务实际调用的 Python 环境里没装 OpenCV：
```bash
cd 图像工具箱
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install -U pip
python -m pip install -r requirements.txt
npm start
```

### 2) `Python runtime not found for /api/inpaint`
说明服务没找到可用解释器。优先直接按 README 创建 `.venv`。
也可以手动指定：
```bash
INPAINT_PYTHON=/你的/python npm start
```

### 3) `mask is empty after thresholding`
说明蒙版在二值化后没有有效白色区域。通常是：
- 蒙版传错了
- 蒙版内容太淡
- 白色区域没覆盖到水印

建议重新导出黑底白字或透明底白字的蒙版。

## 已知限制
- 当前前端已接上 `/api/inpaint`，并支持继续细修；但核心仍是单图手工涂抹，不含批处理。
- Telea 更适合小面积、纹理连续的水印；大面积复杂遮挡不如生成式修复。
- 当前没有接入更重的生成式修复后端，稳定性优先于“无痕极限效果”。
- 透明还原依赖手动估计水印颜色与透明度，适合规则、浅色半透明水印，不保证一次到位。
