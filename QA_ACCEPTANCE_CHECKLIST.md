# Round 6 QA / 对照验收清单

更新时间：2026-03-17

本轮用户反馈聚焦两件事：
1. 页面是否已经从“修长型网页”压回更接近参考站的**宽屏工作台**
2. 图片是否已经能**完整显示**，不再出现底部被裁掉/丢失的问题

参考对象：`https://imgexe.com/zh/remove-watermark`
当前对照对象：`img-toolbox-app/public/index.html` + `public/styles.css` + `public/app.js`

---

## 一、已明显改善

### 1) 整体框架已经明显从“长网页”转向“宽屏工作台”
**结论：已明显改善**

对照当前代码可见：
- `:root` 中 `--shell-width: 1760px`，整体容器已明确按宽屏工作台思路展开
- `.layout` 采用 `88px + 主工作台 + 88px` 三栏结构，而不是单列落地页
- `.topbar` 高度压到 `54px`
- `.footer-bar` 已补回，页面不再像“内容一直往下长”的半成品 demo
- 默认主题已回到 `html class="dark"`，首屏气质比上一轮更贴参考站
- `.editor-grid` 直接进入 “主画布 + 右控制栏” 的工作区结构，主方向正确

这说明：
- 第一眼已经不是之前那种偏修长、偏介绍页的页面比例
- 用户要的“更像参考站的桌面工作台”这个方向，**已经肉眼可见地往前走了一步**

### 2) Hero 区确实被压薄了
**结论：已明显改善，但未完全收干净**

相较上一轮 checklist 里提到的“hero strip 拉长页面”，当前：
- `.hero-strip` 已只有两列，且 padding 压到 `9px 12px 8px`
- badge 也收敛成 2 枚，说明区比前几轮更薄

说明这块已经从“介绍型产品页”往“工具台前置说明条”靠近，不再是最夸张的拉高来源。

---

## 二、仍未解决

### 1) 图片“首次载入即完整显示”这件事，按当前代码判断**仍未彻底解决**
**结论：仍未解决**

这是本轮最关键的 QA 发现。

问题链路在 `public/app.js`：

```js
async function loadFile(file) {
  ...
  await applyBitmapAsWorkingImage(bitmap);
  ...
  els.workspace.classList.remove('hidden');
}
```

而 `applyBitmapAsWorkingImage(bitmap)` 里面会立即调用：

```js
relayoutCanvases();
```

但此时：
- `#workspace` 还没显示
- `wrap.clientWidth / wrap.clientHeight` 很可能是 `0`

对应 `relayoutCanvases()` 内部逻辑：

```js
const width = wrap.clientWidth;
const height = wrap.clientHeight;
if (!width || !height) return;
```

这意味着：
- **首次载入图片时，缩放布局函数很可能直接提前 return**
- canvas 的 CSS 尺寸没有在“显示后”重新计算
- 用户看到的就可能是按原始像素尺寸顶进去的画布
- 在工作区容器高度有限时，图片下边缘仍然可能被挤出可视区，看起来像“底部丢了”

这条问题为什么重要：
- 不是纯视觉猜测，而是当前执行顺序本身就有风险
- 只有后续触发 `window.resize` 时，`relayoutCanvases()` 才有机会重新跑一遍
- 所以现在更像是“偶尔会恢复”，不是“首次打开就稳定完整显示”

### 2) 结果图区域也共享同一套 relayout 时机问题
**结论：仍未解决**

`relayoutCanvases()` 同时负责：
- `editWrap` 下的 `mainCanvas` / `maskCanvas`
- `resultWrap` 下的 `resultCanvas`

也就是说，不只是原图编辑区，**结果预览区**也受到同样的首次布局时机影响。

如果用户反馈的是：
- 原图底部丢了
- 或处理后结果底部丢了

那么当前代码都还不能算完全兜住。

---

## 三、下轮还需压

### 1) 页面虽然已转宽，但纵向高度仍然偏大，还没到“参考站那种很紧的桌面壳体”
**结论：下轮还需压**

几个还会继续把页面往高处拉的点：
- `.dropzone { min-height: 618px; }`
- `.drop-inner { padding: 36px 20px 26px; }`
- 空态主标题 `.drop-main` 仍然偏大：`clamp(24px, 2.4vw, 34px)`
- 工作区里仍保留一整段 `.hero-strip`

这会带来一个结果：
- 虽然页面骨架已经是宽屏工作台了
- 但工作区的“纵向占用”还是偏多
- 视觉上已不是“修长型网页”，却还没有压到参考站那种更短、更硬、更像桌面模块的程度

### 2) 空态仍偏“上传展示区”，不够像参考站那种直接开工的编辑器底板
**结论：下轮还需压**

当前空态区仍有这些特征：
- `拖拽图片到工作台` 文案权重较高
- `选择图片` 主按钮面积仍偏显眼
- 中央空态整体比较“欢迎页”

这不会阻止功能，但会让工作台显得比参考站更“展示页化”。

### 3) 右侧面板已经紧了不少，但仍有轻微“组件拼装感”
**结论：下轮还需压**

当前右栏确实已经比前几轮更密，尤其：
- `.block + .block { margin-top: 6px; }`
- 各控件高度普遍压到 31~33px

但仍保留：
- `stats-block` 三卡
- 每段 section 独立描边
- TIPS 区仍占一块完整高度

所以它已进入“像工作台控制栏”的范围，但还没完全进入参考站那种一整块连续设备面板的感觉。

---

## 四、针对本轮两项核心问题的最终判定

### A. 页面是否已经从修长型变成更接近参考站的宽屏工作台？
**判定：已明显改善，但还没压到最终版。**

原因：
- 三栏结构、深色首屏、窄顶栏、补 footer，这些关键方向都已经对了
- 但 dropzone / 空态 / hero-strip 仍让中部高度略高，离参考站那种更短更硬的壳体还差半步

### B. 图片是否已经能完整显示，不再丢底部区域？
**判定：仍未解决。**

原因：
- 当前 `loadFile()` 中先 `applyBitmapAsWorkingImage()`、后显示 `workspace`
- 导致 `relayoutCanvases()` 很可能在容器仍为隐藏状态时拿到 0 尺寸并直接退出
- 这会让“首次载入时完整缩放显示”没有被真正保证
- 因此用户提到的“图片底部丢失”从代码逻辑看仍有复现条件

---

## 五、建议主控直接盯的下一轮修正点

### 必修 1：把 relayout 时机后移
建议至少满足其一：
- 先显示 `workspace`，再调用 `applyBitmapAsWorkingImage()` / `relayoutCanvases()`
- 或在 `els.workspace.classList.remove('hidden')` 之后显式再调用一次 `relayoutCanvases()`
- 更稳一点可放到 `requestAnimationFrame()` 里，确保容器已完成 layout

### 必修 2：继续压工作区纵向高度
建议优先压：
- `dropzone` 的 `min-height`
- `drop-inner` padding
- `drop-main` 字号
- `hero-strip` 是否继续瘦身或并入标题条

### 可延后：进一步去组件化右侧控制栏
这项不影响本轮用户的两条核心反馈，但会影响“和参考站有多像”的上限。

---

## 六、一句话总评

- **宽屏工作台：已经明显改善，方向是对的。**
- **图片完整显示：按当前代码判断还没真正修死，首次载入仍有丢底部的风险。**
- **下轮最该打的不是再加新东西，而是先把 relayout 时机修正，再继续压中部高度。**
