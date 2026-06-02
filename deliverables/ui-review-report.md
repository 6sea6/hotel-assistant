# 宾馆比较助手 — UI 设计评审与优化方案

> 评审人: UI Designer | 日期: 2026-06-02 | 版本: v8.8.1

---

## 一、总体评价

项目已具备较完整的设计 Token 体系（`tokens.css`）和 10 套主题系统（`themes.css`），CSS 架构按组件/页面分文件组织合理。但在**语义 Token 完整性、色彩一致性、排版体系、可访问性、暗色模式**等方面存在系统性缺陷。以下分维度详细评审并提出优化方案。

---

## 二、评审维度与发现

### 2.1 设计 Token 系统 — 评分: ★★★☆☆ (3/5)

**现状**: `tokens.css` 定义了 34 个 CSS 变量，覆盖颜色、圆角、阴影、动画时长等基础属性。

**问题**:

| # | 问题 | 严重度 | 说明 |
|---|------|--------|------|
| T-1 | **缺失排版 Token** | P1 | 无 `--font-size-*` / `--font-weight-*` / `--line-height-*` / `--letter-spacing-*` 系统定义。14 个不同字号散落在各 CSS 文件中硬编码（11px–22px），无法全局调控 |
| T-2 | **缺失间距 Token** | P1 | 无 `--space-*` 系统定义。padding/margin/gap 使用 16 种不同数值（2px–60px），毫无规律 |
| T-3 | **缺失排版字体 Token** | P2 | `--font-family-primary` 等未定义，body 中直接硬编码字体栈 |
| T-4 | **缺失交互状态 Token** | P2 | 无 `--color-focus-ring` / `--color-hover-overlay` / `--opacity-disabled` 等语义化交互 Token |
| T-5 | **阴影层级不足** | P3 | 仅 sm/md/lg 三级，缺少 xs（微弱）和 xl（弹窗）层级 |

**优化方案**:

```css
/* tokens.css — 补充排版系统 */
:root {
  /* Typography */
  --font-family-primary: 'Segoe UI', -apple-system, BlinkMacSystemFont, 'Microsoft YaHei', sans-serif;
  --font-family-mono: 'Courier New', Consolas, monospace;

  --font-size-xs: 11px;    /* badge, caption */
  --font-size-sm: 12px;    /* secondary label, hint */
  --font-size-base: 13px;  /* body default */
  --font-size-md: 14px;    /* primary body */
  --font-size-lg: 16px;    /* section title */
  --font-size-xl: 18px;    /* card title */
  --font-size-2xl: 20px;   /* page title */
  --font-size-3xl: 22px;   /* hero heading */

  --font-weight-regular: 400;
  --font-weight-medium: 500;
  --font-weight-semibold: 600;
  --font-weight-bold: 700;
  --font-weight-extrabold: 800;

  --line-height-tight: 1.25;
  --line-height-normal: 1.5;
  --line-height-relaxed: 1.65;

  /* Spacing (4px base unit) */
  --space-0: 0;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
  --space-10: 40px;
  --space-12: 48px;
  --space-16: 64px;

  /* Interaction */
  --color-focus-ring: color-mix(in srgb, var(--primary-color) 40%, transparent);
  --opacity-disabled: 0.55;
  --opacity-hover: 0.08;

  /* Shadows */
  --shadow-xs: 0 1px 2px rgba(0, 0, 0, 0.03);
  --shadow-xl: 0 20px 40px rgba(0, 0, 0, 0.12);
}
```

---

### 2.2 色彩一致性 — 评分: ★★☆☆☆ (2/5)

**现状**: 主题系统架构完善（10 套主题），但存在大量硬编码颜色值绕过 Token。

**硬编码颜色统计**:

| 硬编码色值 | 出现位置 | 用途 |
|-----------|---------|------|
| `#ffb800` | hotel-cards.css, hotel-table.css, app-modals.css | 收藏标记、top3 徽章、confirm 按钮 |
| `#ff7d00` | hotel-cards.css, hotel-table.css, app-modals.css | 收藏名称、top3 渐变 |
| `#00b42a` | hotel-cards.css, hotel-table.css | 模板徽章 |
| `#22c55e` | ai-assistant.css (×6 处) | 成功状态、完成步骤 |
| `#d93636` | app-shell.css | danger hover |
| `#165dff` | notifications.css | info 通知 |
| `#8a2be2` / `#1677ff` | app-modals.css | 感谢名单彩色 |
| `#64748b` | ai-assistant.css | 取消状态 |
| `#2f80ed` | ai-assistant.css | running 图标 |
| `#7b8794` | ai-assistant.css | pending 图标 |
| `#94a3b8` | ai-assistant.css | cancelled 步骤 |

**问题**:

| # | 问题 | 严重度 | 说明 |
|---|------|--------|------|
| C-1 | **11+ 硬编码颜色绕过 Token** | P0 | 切换主题时这些颜色不会跟随变化，严重破坏主题一致性 |
| C-2 | **缺少语义色彩 Token** | P1 | 无 `--color-success` / `--color-warning` / `--color-info` 定义，每个组件自行硬编码 |
| C-3 | **dark 主题是假的** | P0 | `data-theme='dark'` 的变量值与 `oak-brown` 完全一致，不是暗色模式 |
| C-4 | **colorful-mode 使用 gradient 作为 Token 值** | P2 | `--topbar-bg` 和 `--bg-secondary` 使用了 `linear-gradient()`，导致不支持渐变的属性（如 `border-color`）解析失败 |

**优化方案**:

```css
/* tokens.css — 补充语义色彩 */
:root {
  --color-success: #22c55e;
  --color-success-bg: color-mix(in srgb, var(--color-success) 10%, var(--bg-primary));
  --color-warning: #ffb800;
  --color-warning-text: #4a3a18;
  --color-danger: #f53f3f;
  --color-danger-hover: #d93636;
  --color-info: #165dff;
  --color-info-bg: color-mix(in srgb, var(--color-info) 10%, var(--bg-primary));

  /* 语义衍生 */
  --color-favorite: #ff7d00;
  --color-favorite-bg: rgba(255, 125, 0, 0.05);
  --color-template-badge: #00b42a;
  --color-top3-from: #ff7d00;
  --color-top3-to: #ffb800;
}
```

然后逐一替换所有硬编码颜色为 Token 引用。

---

### 2.3 排版体系 — 评分: ★★☆☆☆ (2/5)

**现状**: 无排版 Token，字体大小在 CSS 中随意指定。

**字号使用统计**（从 CSS 文件中提取）:

| 字号 | 出现次数 | 典型用途 |
|------|---------|---------|
| 11px | 2 | queue badge, template badge |
| 12px | 12+ | info label, hint, badge, tertiary text |
| 13px | 10+ | secondary label, filter label, card meta |
| 14px | 15+ | body, form label, row text |
| 15px | 3 | original room, card text |
| 16px | 4 | section title, price value |
| 18px | 4 | card name, modal title, header h2 |
| 20px | 2 | app title, author name |
| 22px | 2 | AI assistant header h2, prefilter h2 |
| 24px | 1 | empty state h3 |

**问题**:

| # | 问题 | 严重度 | 说明 |
|---|------|--------|------|
| T-6 | **字号层级混乱** | P1 | 12px/13px/14px 三个相近尺寸无明确层级区分，各自用途不清晰 |
| T-7 | **font-weight 使用过度** | P2 | 使用了 400/500/600/700/800/900 六档，视觉区分度低且增加维护负担 |
| T-8 | **行高不一致** | P3 | 同级别文字行高在 1.25–1.8 间波动（1.25/1.45/1.55/1.6/1.65/1.7/1.75/1.8） |

**优化方案**: 建立 5 级字号 + 3 档字重 + 3 档行高的排版体系（见上方 Token 补充），全局替换硬编码值。

---

### 2.4 可访问性 (Accessibility) — 评分: ★★☆☆☆ (2/5)

**问题**:

| # | 问题 | 严重度 | 说明 |
|---|------|--------|------|
| A-1 | **缺少 focus-visible 样式** | P0 | `.btn`、`.input`、`.custom-select-option` 等可交互元素无 `:focus-visible` 定义，仅 `.input:focus` 有焦点环，按钮完全无焦点指示器 |
| A-2 | **通知组件硬编码颜色无对比度保障** | P1 | `.notification-warning` 使用 `#ffb800` 背景 + `#1d2129` 文字，对比度约 3.2:1，勉强达标但部分主题下可能不达标 |
| A-3 | **自定义 select 无 ARIA 焦点管理** | P1 | `.custom-select-button` 有 `role` 但缺少完整的 `aria-activedescendant` 联动 |
| A-4 | **未设置 `prefers-reduced-motion`** | P1 | `@keyframes spin`、`slideUp`、`fadeIn` 等动画无 media query 保护，对运动敏感用户不友好 |
| A-5 | **checkbox 尺寸偏小** | P3 | 部分原生 checkbox 仅 16px × 16px，低于 44px 最小触控区域建议 |
| A-6 | **模态框缺少焦点陷阱** | P2 | modal 打开后 Tab 键可聚焦到背景内容 |

**优化方案**:

```css
/* 全局焦点样式 */
.btn:focus-visible,
.input:focus-visible,
.custom-select-button:focus-visible,
.task-queue-main:focus-visible {
  outline: 2px solid var(--color-focus-ring);
  outline-offset: 2px;
}

/* 运动偏好 */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

### 2.5 暗色模式 — 评分: ★☆☆☆☆ (1/5)

**问题**:

| # | 问题 | 严重度 | 说明 |
|---|------|--------|------|
| D-1 | **dark 主题内容完全是 oak-brown 的复制** | P0 | 所有变量值与 oak-brown 一致，这不是暗色模式 |
| D-2 | **暗色模式需要反转 Token 体系** | P0 | 即使修改 dark 主题变量，大量硬编码颜色（#22c55e、#00b42a 等）也不会反转 |
| D-3 | **colorful-mode 使用渐变作为 Token 值** | P1 | `--topbar-bg: linear-gradient(...)` 在非渐变属性上会失效 |

**优化方案**: 在 `themes.css` 中为 `[data-theme='dark']` 编写完整的暗色调色板：

```css
[data-theme='dark'] {
  --primary-color: #7ba8d4;
  --primary-hover: #5c8fbe;
  --accent-color: #d4a06a;
  --accent-hover: #bc8850;
  --window-bg: #1a1f2e;
  --topbar-bg: #242b3d;
  --topbar-bg-strong: #2a3350;
  --topbar-text: #e8ecf2;
  --topbar-button-bg: rgba(255, 255, 255, 0.08);
  --topbar-button-hover: rgba(255, 255, 255, 0.14);
  --topbar-button-border: rgba(255, 255, 255, 0.12);
  --topbar-divider: rgba(255, 255, 255, 0.08);
  --bg-primary: #1e2433;
  --bg-secondary: #161b28;
  --bg-tertiary: #252d3f;
  --text-primary: #e4e8ef;
  --text-secondary: #9aa3b4;
  --text-tertiary: #6b7589;
  --text-disabled: #4a5062;
  --border-color: #2e3649;
  --border-light: #252c3c;
  --modal-divider-color: rgba(0, 0, 0, 0.7);
}
```

并同步将硬编码的语义色替换为 Token。

---

### 2.6 组件一致性 — 评分: ★★★☆☆ (3/5)

**问题**:

| # | 问题 | 严重度 | 说明 |
|---|------|--------|------|
| B-1 | **按钮体系碎片化** | P1 | 存在 `.btn`、`.btn-sm`、`.btn-xs`、`.btn-icon`、`.ai-ghost-button`、`.task-prefilter-button`、`.task-clear-button`、`.task-start-button`、`.list-prefilter-primary-button` 等 10+ 种按钮变体，样式定义分散，尺寸/圆角/字号不统一 |
| B-2 | **模态框尺寸定义不一致** | P3 | `.modal-content` 默认 `max-width: 860px`，但 `.modal-large` 为 `800px`（反而更小） |
| B-3 | **卡片圆角不一致** | P3 | hotel-card 使用 `--radius-lg`(12px)，AI task card 使用 `16px`，prefilter card 使用 `18px`，template item 使用 `--radius-md`(8px) |
| B-4 | **开关组件重复定义** | P2 | `.switch-label` 定义在 `settings-prefilter.css`，但仅在 `app-modals.css` 的设置弹窗中使用，应归入组件样式 |

**优化方案**: 建立统一的按钮变体系统：

```css
/* 统一按钮系统 */
.btn { /* 基础: 40px 高度, 12px 圆角, 14px 字号 */ }
.btn--sm { /* 36px 高度, 10px 圆角, 13px 字号 */ }
.btn--xs { /* 30px 高度, 8px 圆角, 12px 字号 */ }

.btn--primary { background: var(--primary-color); color: #fff; }
.btn--secondary { background: var(--bg-tertiary); border: 1px solid var(--border-color); }
.btn--ghost { background: transparent; border: 1px solid var(--border-color); }
.btn--danger { background: var(--danger-color); color: #fff; }
.btn--accent { background: var(--accent-color); color: #fff; }
```

---

### 2.7 响应式设计 — 评分: ★★★☆☆ (3/5)

**现状**: 有 3 个断点（1400px、900px、768px）和部分 720px、600px 断点。

**问题**:

| # | 问题 | 严重度 | 说明 |
|---|------|--------|------|
| R-1 | **断点不统一** | P2 | 存在 1400/1200/900/768/720/600 六个不同断点，无明确策略 |
| R-2 | **AI 采集页面布局在窄屏下易溢出** | P2 | `.task-start-grid` 的三列布局在 <900px 时才变为单列，720–900px 区间布局局促 |
| R-3 | **模态框在极窄窗口下可能溢出** | P3 | `.modal-content { width: 90% }` 无 `min-width` 下限保护 |

**优化方案**: 统一断点体系：

```css
/* Breakpoints: 640px / 768px / 1024px / 1280px */
/* Mobile-first: 基础样式为窄屏，通过 min-width 递进增强 */
```

---

### 2.8 交互体验 — 评分: ★★★☆☆ (3/5)

**问题**:

| # | 问题 | 严重度 | 说明 |
|---|------|--------|------|
| I-1 | **hover 反馈不统一** | P2 | 部分元素 hover 有 translateY(-1px/-2px)，部分只有背景变化，部分无反馈 |
| I-2 | **loading 状态覆盖不完整** | P2 | 部分按钮有 `.is-refreshing` spinner，部分无 loading 态 |
| I-3 | **模态框关闭仅靠 × 按钮和底部按钮** | P3 | 不支持 Esc 键关闭（需 JS 配合），也不支持点击遮罩关闭 |

---

## 三、优先级排序的实施路线图

### Phase 1 — 基础修复 (P0, 1–2 天)

1. **C-1**: 将所有硬编码颜色替换为 Token 引用
2. **D-1**: 为 dark 主题编写真实的暗色变量
3. **A-1**: 为所有可交互元素添加 `:focus-visible` 样式
4. **A-4**: 添加 `prefers-reduced-motion` 媒体查询

### Phase 2 — 系统完善 (P1, 3–5 天)

5. **T-1/T-2**: 补充排版 Token 和间距 Token
6. **C-2**: 补充语义色彩 Token（success/warning/danger/info）
7. **T-6**: 建立清晰的字号层级，全局替换
8. **A-2/A-3**: 通知组件对比度修正 + custom select ARIA 完善
9. **B-1**: 统一按钮变体系统
10. **B-2**: 修正模态框尺寸逻辑（large > default > medium > small）
11. **B-4**: 将 switch 组件移入组件样式文件

### Phase 3 — 体验提升 (P2, 5–7 天)

12. **T-7/T-8**: 收敛 font-weight 和 line-height 层级
13. **R-1/R-2**: 统一断点体系 + 修复窄屏布局
14. **I-1/I-2/I-3**: 统一交互反馈 + loading 态 + Esc 关闭
15. **C-4**: 修复 colorful-mode 的 gradient-as-Token 问题
16. **A-6**: 模态框焦点陷阱

### Phase 4 — 锦上添花 (P3)

17. **B-3**: 统一卡片圆角层级
18. **T-5**: 扩展阴影层级
19. **A-5**: 增大 checkbox/radio 触控区域
20. **R-3**: 模态框最小宽度保护

---

## 四、关键设计原则建议

1. **Token 先行**: 任何视觉属性必须通过 Token 定义，禁止在组件 CSS 中硬编码颜色、字号、间距
2. **语义化命名**: 使用 `--color-success` 而非 `--color-green-500`，让主题切换自然生效
3. **渐进增强**: 基础样式保障可访问性和可用性，动画和视觉装饰作为增强层
4. **4px 网格系统**: 所有间距为 4 的整数倍，确保视觉节奏一致
5. **暗色模式作为一等公民**: 每个新增组件/颜色都必须同时验证 light 和 dark 下的表现

---

## 五、总结

| 维度 | 当前评分 | 优化后预期 |
|------|---------|-----------|
| Token 系统 | ★★★☆☆ | ★★★★★ |
| 色彩一致性 | ★★☆☆☆ | ★★★★☆ |
| 排版体系 | ★★☆☆☆ | ★★★★☆ |
| 可访问性 | ★★☆☆☆ | ★★★★☆ |
| 暗色模式 | ★☆☆☆☆ | ★★★★☆ |
| 组件一致性 | ★★★☆☆ | ★★★★☆ |
| 响应式设计 | ★★★☆☆ | ★★★★☆ |
| 交互体验 | ★★★☆☆ | ★★★★☆ |

**综合评分: 2.5/5 → 4.2/5**

核心问题集中在**硬编码颜色**和**缺失暗色模式**，这是影响最大的两个系统性缺陷。建议从 Phase 1 开始优先处理。
