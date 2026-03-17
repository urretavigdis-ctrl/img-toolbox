# 图像工具箱

高相似复刻 `imgexe.com` 的图像工具站项目目录。

当前优先落地模块：`去除水印.exe`

## 当前实现方向
- UI：高相似工作台风格
- 去除模式 1：扩散修复（服务端 Telea inpaint）
- 去除模式 2：透明还原（前端本地反向 alpha 混合）

## 目录
- `public/`：前端静态页面资源
- `server.js`：本地 Node 服务，提供 `/api/inpaint`
- `telea_inpaint.py`：Python/OpenCV 的 Telea 修复脚本
- `requirements.txt`：Python 依赖
- `package.json`：Node 依赖与启动脚本

## /api/inpaint 接口
- 方法：`POST`
- Content-Type：`multipart/form-data`
- 表单字段：
  - `image`: 原图文件
  - `mask`: 黑底白字或透明底白字都可以，最终会按灰度二值化处理
  - `format`: `jpeg | png | webp`
- 响应：二进制图片
- 响应头：`X-Inpaint-Algo: telea`

### curl 调试示例
```bash
curl -X POST http://localhost:3100/api/inpaint \
  -F "image=@./example/input.png" \
  -F "mask=@./example/mask.png" \
  -F "format=png" \
  --output result.png
```

## 本地运行（推荐方案：项目独立 venv）
这条链依赖 Python + OpenCV。最稳妥的做法是**只在项目目录里建虚拟环境**，避免污染系统 Python。

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

> Apple Silicon / macOS 上优先使用上面的 venv 方案。`opencv-python-headless` 通常够用，而且不会额外拉 GUI 依赖。
>
> **建议优先用 Python 3.11 / 3.12。** 这台机器上的系统 `python3` 是 3.14，而当前 OpenCV wheel 在 3.14 上可能缺失，导致退回源码编译，安装又慢又容易失败。
>
> 当前 `requirements.txt` 已固定到 `opencv-python-headless==4.10.0.84`，这是在本机 Python 3.11 / Apple Silicon 下更稳妥、能直接拿到 wheel 的版本。

### 3) 启动服务
```bash
npm start
```

默认地址：`http://localhost:3100`

## Python 选择逻辑
`server.js` 会按下面顺序找 Python：
1. `INPAINT_PYTHON` 环境变量
2. `图像工具箱/.venv/bin/python`
3. `图像工具箱/.venv/bin/python3`
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

## 实现细节
- 后端算法：`cv2.inpaint(..., cv2.INPAINT_TELEA)`
- mask 会先二值化，再喂给 Telea FMM
- mask 尺寸与原图不一致时，会自动按最近邻缩放到原图尺寸
- 输入若带 alpha：
  - 修复在 RGB/BGR 通道完成
  - 若导出为 `png`，会保留原图 alpha 通道

## 已知限制
- 当前仓库重点补的是 `/api/inpaint` 后端链路；前端 `public/app.js` 若未补齐，页面交互仍可能不完整。
- Telea 更适合小面积、纹理连续的水印；大面积复杂遮挡不如生成式修复。

## 快速排错
### 报错：`No module named 'cv2'`
说明 Python 依赖没装在服务实际使用的解释器里。最稳妥处理：
```bash
cd 图像工具箱
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install -U pip
python -m pip install -r requirements.txt
npm start
```

### 报错：找不到 Python
直接按上面的 venv 步骤创建，或者用 `INPAINT_PYTHON=/你的/python` 指定解释器。

### 想先单独验证 Python 脚本
```bash
cd 图像工具箱
source .venv/bin/activate
python telea_inpaint.py --input ./example/input.png --mask ./example/mask.png --output ./example/out.png --format png
```
