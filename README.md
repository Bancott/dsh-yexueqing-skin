# 叶雪青主题皮肤 · dsh-yexueqing-skin

逆水寒 · 叶雪青主题的 DSH Web UI 皮肤插件。一个总开关，两层机制，N 个皮肤变体。

- **两套独立设计**：`春庭藤影`（叶雪青.jpg）与 `雪霁寒江`（叶雪青雪景.jpg），各自
  一套完整调色板、立绘对位与装饰参数，互不共用数值。
- **一个开关**：注册在 `设置 → 通用 → 外观皮肤`，关闭后完全回到 DSH 原生外观。
- **字体可切**：启用皮肤时默认使用霞鹜文楷GB，可在皮肤页切回系统默认字体。
- **独占皮肤**：开启时自动停用检测到的其他皮肤插件，关闭时原样恢复（见第 7 节）。
- **立绘分档**：关闭 / 弱 / 中 / 强四档，只在画面四边显现，中心留白保证正文可读。
- **零默认皮肤回归**：皮肤实现为 `ctx.theme.overrideTokens()` 的**覆盖层**，
  不是内置主题的替代品，也不注册新的主题 id；关掉开关整层被移除。
- **无需构建**：`client.js` 是直接可用的浏览器 bundle，`index.js` 是纯 ESM，
  没有打包步骤、没有依赖。

---

## 目录结构

```
dsh-yexueqing-skin/
├── package.json          # bundle + client 清单（dsh.bundle / dsh.client）
├── cordis.patch.yml      # Loader patch：插入 yexueqing-skin 一行
├── index.js              # Host 半：静态素材路由（立绘 + 字体）
├── client.js             # Client 半：皮肤本体（ModuleLoader bundle）
├── icon.svg              # 插件卡片图标（package.json 的顶层 icon）
├── README.md
├── locale/
│   ├── zh.json           # 插件卡片标题与描述（中文）
│   └── en.json
└── assets/
    ├── skin-spring.jpg               # 春庭藤影 立绘
    ├── skin-snow.jpg                 # 雪霁寒江 立绘
    ├── LXGWWenKaiGB-Regular.ttf      # 霞鹜文楷GB
    └── skin-*.thumb.webp             # 可选：皮肤页卡片缩略图（缺失时回退原图）
```

两半的分工是硬边界，不是风格选择：

| | 能做什么 | 为什么 |
|---|---|---|
| `index.js`（Host 半） | `ctx.webServer.register()` 挂素材路由 | 浏览器半不能读磁盘，26MB 字体也不能进 bundle |
| `client.js`（Client 半） | `ctx.theme` / `ctx.slots` / `ctx.locale` / 自建 `<style>` | 皮肤是浏览器侧渲染的事，Host 不参与 |

---

## 机制

### 1. 一个开关，两层机制

```
叶雪青主题（总开关，settings.general.item）
│
├─ ① 主题服务层   ctx.theme.overrideTokens("dsh-yexueqing-skin", tokens)
│     每个 token 给 { light, dark } 一对值 → 自动跟随 DSH 原生的
│     浅色 / 深色 / 跟随系统，插件自己不存明暗状态。
│     同一 source 重复调用 = 该层整体替换并重新压到栈顶（互斥就靠这个）。
│
└─ ② 装饰样式表   decorCss(skin, state)
      字体 @font-face、选区 / 滚动条 / 焦点态，以及 shell.overlay 装饰层的样式。
      样式表随皮肤变体整体替换，因此不会残留上一个变体的规则。
```

关闭开关时 ①② 都被 disposer 移除，`--dsw-*` 回到 base.css 原值。

### 2. 互斥怎么实现：重压栈，而不是 `!important`

需求是「用我们的皮肤时其他皮肤失效，关掉后回退到默认」。实现方式是
`overrideTokens` 自带的一条语义：

> 同一 source 再次调用会替换该层并**重新压到最顶**（seq 单调递增，
> 后注册者逐 token 获胜）。

所以本插件在 `theme/change` 里重压一次自己的层（`stackLayer`），
别人改动主题后我们立刻回到栈顶。这需要处理两个真实的坑：

- **自激循环**：`overrideTokens` 会同步 emit `theme/change`（ui-theme 的
  `publish()`），所以重压栈会再次触发我们自己的监听器。`stackLayer` 用
  一个覆盖**整个调用**（含那次同步 emit）的防重入标志挡掉。
- **与其他插件互相抢栈**：万一将来有插件也这么做，会互相顶到顶。
  监听器带窗口限流（2 秒内最多 5 次），把这种情况退化成低频抖动而非活锁。

**为什么不用 `!important`。** 它确实能压过 ui-layout presenter 写的
行内样式，但 ui-theme 明确文档化了若干**局部重绑**的 token：
高层级表面（菜单、浮层、对话框）会把 `--dsh-scrollbar-thumb(-hover)`
重绑为 l2，菜单材质会重绑 `--dsw-elevation-stroke-color`。
`!important` 会把这类有意为之的局部重绑一并压平，破坏菜单与浮层的材质 ——
用一个全局副作用去换优先级，代价不对等。重压栈只影响"谁在栈顶"，
不改变层叠规则本身。

（唯一保留的 `!important` 在输入框焦点态的 `border-color` / `box-shadow` /
`outline` 上，那是组件属性，不涉及 token，测试里有明确断言禁止自定义属性
使用 `!important`。）

### 3. 覆盖的 token

- **Theme 巡检要求「必须同时提供 light 与 dark」的 14 个别名 token**：
  `bg-base` / `bg-layer-1` / `bg-layer-2` / `bg-overlay` / `border-l1` / `border-l2` /
  `brand-primary` / `label-primary` / `label-secondary` / `state-{error,idle,success,warn}-primary` /
  `specific-sidebar-fill`
- **基础样式表实际消费的延伸别名**：`border-l3` / `border-l4` /
  `settings-card-fill` / `settings-card-stroke` / `focus-ring-color` /
  `dsh-scrollbar-thumb(-hover)` / `bg-document-selection` / `switch-thumb`
- **受支持的重绑点**：`--dsw-elevation-stroke-color`（高层级表面的发丝描边 →
  面板边框随主题色）
- **插件自有装饰 token**：`--yxq-accent`（淡金/藕粉）、`--yxq-accent-soft`、
  `--yxq-motif-color`、`--yxq-motif-opacity`、`--yxq-art-veil`、`--yxq-art-image`、
  `--yxq-art-position`、`--yxq-art-wash-opacity`、`--yxq-art-band-opacity`。
  它们走同一覆盖层，因此也自动跟随明暗与开关。

### 4. 字体

字体通过 `--dsw-font-family` 这一个 token 切换：

- 开关为「霞鹜文楷GB」时，覆盖层里放入
  `"LXGW WenKai GB", <原生系统字体栈>`；
- 开关为「默认字体」时，该 token **从覆盖层与权威表里整个消失**，
  base.css 的原生 UI 字体栈自动生效 —— 这就是"切回默认字体"，不需要二次覆盖。

`--dsw-font-family-brand` 派生自 `var(--dsw-font-family)`，因此品牌文字同样跟随。

### 5. 装饰

- **选区 / 滚动条**：主题色系线性渐变（`::selection`、`::-webkit-scrollbar-thumb`）。
- **输入框焦点态**：`input / textarea / select / [contenteditable]:focus-visible`
  上淡金色描边 + 柔和外环，即国风细线感。
- **装饰层**：注册进 `shell.overlay` 的一个 `pointer-events:none` 固定层，
  内含**整屏薄纱**与**四边带**两层立绘（见第 6 节）。
- **面板描边**：`--dsw-alias-border-l1..l4`、`--dsw-alias-settings-card-stroke`
  与可重绑的 `--dsw-elevation-stroke-color` 一起把面板/卡片描边染成主题色。
- **插件自身面板**：皮肤卡片底边一条主题色渐变发丝线、选中态的淡金描边 + 外发光。

样式只作用于**通用元素与伪元素选择器**，不引用任何 DSH 内部类名 ——
DSH 升版最多让装饰退化，不会让界面坏掉。

#### 关于云纹：已移除

第一版把「如意云头」做成 72×32 的 SVG 重复贴图铺满整帧，结果在界面上
一眼看成**一片时钟**（规律排列的弧线），用户明确不要，已整体删除。
国风线条需求改由 token 描边 + 焦点态线条 + 卡片发丝线承担。
如果日后想重新引入纹样，**不要做成整帧重复贴图**——那必然读成周期性图案。

### 6. 立绘为什么必须渲染在 `shell.overlay`，以及两层结构

这是实测出来的约束，不是风格选择。

**(a) 为什么不能在 `body` 背景上。** ui-layout 的全屏框架容器是
`.frame{background:var(--dsw-alias-bg-base);height:100%}`，它盖在整个 `body`
之上。挂在 `body` 背景上的图案**会被它整片盖住**——第一版就是这么写的，
实测只有字体生效、立绘和纹样完全看不见。

**(b) 为什么不能把 `--dsw-alias-bg-base` 改成半透明。** 全仓有 **12 处**
组件把这个 token 当背景用（工具卡 `LqhxcW_card`、会话根 `Dc7zOa_root`、
侧栏 `qWvkEq_root`、文档预览、日程页……）。一旦它带 alpha，嵌套容器会
叠加出多层薄纱，卡片里的文字直接糊掉。

所以立绘只能走**内容之上的浮层**，并靠遮罩保证正文可读。两层结构：

| 层 | token | 作用 |
|---|---|---|
| `__wash` | `--yxq-art-wash-opacity` | 整屏极淡，给界面染上画面的气氛 |
| `__band` | `--yxq-art-band-opacity` | 四边带 + 右侧加权，真正让人看见立绘 |

四边带用 `ART_BAND_MASK`：三条**线性**渐变按 CSS 遮罩默认的 `add`（并集）
合成 —— 右边一整条 + 上下两条 + 左边极窄一抹，中心完全透明。
右侧加权是刻意的：两张立绘的人物都在右侧，左侧是文字密集的侧栏。

> **踩过的坑（写在这里防止回退）**：第一版遮罩用的是
> `radial-gradient(120% 100% at 50% 45%, ...)`。椭圆半径是视口的
> 120%×100%，于是"透明区"覆盖了几乎整屏，立绘被整片遮掉 ——
> 这就是「立绘还是没有显示」的直接原因。矩形带没有这个问题，
> 测试里有一条断言专门禁止径向遮罩回归。

强度档位（`ART_STRENGTHS`）：`off` / `soft`(0.08,0.34) /
`medium`(0.12,0.50) / `strong`(0.18,0.68)，在皮肤页可实时切换。

层本身 `pointer-events:none`（`shell.overlay` 本身也是点击穿透的），
并以 `order: -100` 排在 overlay 里所有其他条目的**下面**，
这样对话框、toast 等浮层仍然盖在皮肤之上。

### 7. 互斥：两级机制

需求是「启用本皮肤时其他皮肤失效，关掉后回退默认界面」，且不改别人的项目。

**第一级 · token 栈顶**（对所有走主题体系的皮肤有效）
本层在 `theme/change` 后重压一次，始终待在覆盖栈顶（第 2 节）。

**第二级 · 自动停用**（对绕过 token 体系、自带 DOM/样式表的皮肤有效）
开启皮肤时，通过
`ctx.remote.pluginManager.setPluginEnabled(entryId, false)`
自动关闭检测到的其他皮肤插件 —— 这正是 DSH 官方 Web UI 在「插件」页
切换开关时走的**同一条** Remote（`dsh-client-ui-plugin-manager` 的
`lib/client.js` 就这么调）。因此不写 profile 文件、也不需要审批。

- 识别规则：只匹配 `/skin|皮肤/i`，**刻意不匹配 `theme`** ——
  主题类插件（如官方首页主题）与本皮肤无 token 冲突，宁可少关不可误关。
- 双重自我排除：包名精确匹配，或 `entryId` 命中我们的行 id。
- **可逆**：被关掉的 `entryId` 记在状态里，关闭皮肤或关闭「独占皮肤」开关时
  逐一恢复。整个过程不碰别人仓库里的任何文件。
- 没有 Remote 的部署（无 Web 载体）静默跳过，皮肤本身照常工作。

已确认现状：`@leon___/dsh-client-liang-intensity-skin`（滑动变祖）本身就是
`enabled: false`；`dsh-official-homepage-theme` 只作用于首页 canvas，
不注册主题、不覆盖 token、不碰 `document.body`，与本皮肤无冲突。

---

## 安装

包名：**`dsh-yexueqing-skin`**（bundle + Web Client 插件，无需构建步骤，装上即用）

### 方式一：从 GitHub 安装（推荐）

```sh
dsh plugin --profile <你的 profile> add 'github:<你的用户名>/dsh-yexueqing-skin'
```

Desktop 版 profile 名是 `desktop`，Web 版是 `web`。例如：

```sh
dsh plugin --profile desktop add 'github:yourname/dsh-yexueqing-skin'
```

安装后确认它进入了 profile 的 `dsh.profile.bundles`：

```sh
dsh --profile desktop --dump-config | grep -A2 dsh-yexueqing-skin
```

然后**完全退出并重新打开** DSH（Web 版在运行 DSH 的终端按 Ctrl+C 再 `dsh web`）。

### 方式二：让 DSH 里的 agent 装本地目录

适合改源码迭代（`link:` 依赖，改完刷新页面即生效）：

```
action: install_bundle
target: <本仓库的绝对路径>
```

若该 profile 的 lockfile 与当前 registry 配置不一致，pnpm 的供应链校验会拒绝
整个 lockfile。这时给调用补一个 `registry` 参数即可（它只影响校验查询）：

```
action: install_bundle
target: <本仓库的绝对路径>
registry: https://registry.npmjs.org
```

### 方式三：皮肤市场

装了 [dshmarket](https://github.com/deepseek-ai/deepseek-harness) 后，在
「设置 → 插件 → 皮肤市场」里搜索本皮肤一键安装。

### 卸载

```sh
dsh plugin --profile desktop remove dsh-yexueqing-skin
```

卸载会把依赖与 bundle 选择一并摘除。皮肤自身的偏好存在浏览器
`localStorage`（键 `dsh-yexueqing-skin.state`），不写任何 profile 文件；
如需彻底清理，在浏览器控制台执行
`localStorage.removeItem("dsh-yexueqing-skin.state")`。

### 本插件的可调项

`cordis.patch.yml` 暴露两个键：

| 键 | 默认 | 作用 |
|---|---|---|
| `assetBase` | `/plugins/yexueqing-skin/assets/` | 素材路由前缀；改动须与 `client.js` 的 `ASSET_BASE` 同步 |
| `enabled` | `true` | 设为 `false` 时 Host 半不注册任何素材路由 |

其余偏好都在「设置 → 叶雪青」页里。

---

## 发布前清单（维护者）

以下几处是仓库里的占位符，发布前必须替换：

1. `package.json` → `author`、`repository.url`、`homepage`、`bugs`
   里的 `REPLACE-ME`，换成你的名字与 GitHub 用户名/仓库名。
2. `LICENSE` → `Copyright (c) 2026 REPLACE-ME`。
3. `README.md` → 「方式一」示例里的 `<你的用户名>`。
4. **立绘授权**：`assets/skin-spring.jpg`、`assets/skin-snow.jpg` 是《逆水寒》
   素材，版权归原作方。公开分发前请确认授权；不便随仓库分发就删掉这两张图——
   插件在素材缺失时会优雅降级为纯配色皮肤（`index.js` 的 `ASSET_SPECS`
   逐项探测，缺文件只是不注册那条路由）。
5. 字体已按 SIL OFL 1.1 随包分发子集，`LICENSE` 里已附声明。

---

## 新增一个皮肤

两步，不需要碰机制代码：

1. **`client.js` → `SKINS` 数组**加一项：

   ```js
   {
     id: "moon",
     art: "skin-moon.jpg",
     thumb: "skin-moon.thumb.webp",     // 可选
     artPosition: "center 25%",
     palette: {
       light: { /* 与现有皮肤同名的语义 key，全部必填 */ },
       dark:  { /* … */ },
     },
   }
   ```

   语义 key 清单见 `TOKEN_MAP` 与 `DECOR_TOKEN_MAP`
   （`base` `layer1` `layer2` `overlay` `sidebarFill` `border1..4` `cardFill`
   `cardStroke` `brand` `textPrimary` `textSecondary` `error` `idle` `success`
   `warn` `focusRing` `scrollThumb` `scrollThumbHover` `selection` `switchThumb`
   `accent` `accentSoft` `elevationStroke` `motifColor` `motifOpacity` `artVeil`）。

2. **`client.js` → locale 字典**（`zh` 与 `en` 两份）各加两条：
   `"skin.moon.name"`、`"skin.moon.desc"`。

3. 立绘放进 `assets/`，并加进 `index.js` 的 `ASSET_SPECS`。

皮肤页的卡片列表、持久化校验、变体切换都会自动带上新皮肤。

---

## 与 DSH 插件标准的对应

| 标准要求 | 本插件的做法 |
|---|---|
| bundle patch 插入行 | `cordis.patch.yml` 单行 `insert` |
| Host 半导出形式 | `export function apply(ctx, config)` + `export const inject = ["webServer"]`，不混用 default |
| 资源都在 `apply` 内经 `ctx.effect` 注册 | 素材路由、locale、控件样式、token 层、装饰样式表各自一个 effect，均返回 disposer |
| UI 只通过 slot 贡献 | `settings.general.item`（开关行）+ `settings.section`（皮肤页） |
| 不 require 别的 Client 包 | 只 `require("react")`（平台模块表提供） |
| 只用主题 token | 全部颜色来自 `--dsw-alias-*` / `--dsh-*` / `--yxq-*`，无写死颜色（立绘属 artwork） |
| 文案经 locale 服务 | `ctx.locale.register` + `ctx.locale.bind`；slot 的 `label` 用 thunk 自动跟随语言 |
| 可调项放 Config | `assetBase` / `enabled` 两个键，用户层 patch 覆盖后升级不丢 |
| 插件卡片元数据 | `package.json` 的 `icon` + `locale/{zh,en}.json` |

### 两点标准相关的说明

- **本插件不注册面向模型的工具。** 皮肤开关是纯用户偏好，
  `references/user-actions.md` 明确「纯视图交互不需要工具」，
  且授权类动作必须保持 user-only。因此没有 host 侧工具、
  也没有 `host.call` 通道（`host` builtin 是**动态** Cordis 包的能力，
  静态 bundle 的 Client 半没有它；持久化走 `localStorage`）。
- **不注册新的主题 id。** `theme.register` 用于「第三方主题」，
  而那是让用户在内置 Appearance 选择器里多一个条目；本皮肤要的是
  「一个开关控制整套外观 + 互斥」，因此用 `overrideTokens` 覆盖层
  ＋ `!important` 权威表。两者都是文档化的扩展点，这里选了与实际交互一致的那个。

---

## 已知限制与后续

- **立绘在内容之上**，这是 `shell.overlay` 路线的固有代价：DSH 的应用根容器
  铺满视口且不透明，而后者的 `--dsw-alias-bg-base` 又被 12 处组件当背景用，
  不能改成半透明。所以立绘只能浮在内容上方，靠四边带遮罩保护正文。
  想让立绘真正"压在内容下面"，需要一个明确留给插件的画布背景钩子。
- **宿主面板内部直接叠纹样**同样缺钩子。目前装饰落在 token 描边
  （`border-l1..l4`、`settings-card-stroke`、`elevation-stroke-color`）
  与插件自身面板上；在没有钩子前不去覆盖宿主元素的 `background-image`，
  否则会盖掉组件自己的背景。
- 字体已子集化到 3.62 MB（`npm run subset-font` 可重新生成），并经 brotli
  压缩到约 1.89 MB 传输。若日后要做 WOFF2，`@font-face` 的 `src` 已按
  `woff2 → ttf` 顺序声明，把 `.subset.woff2` 放进 `assets/` 即可自动优先。
- 皮肤页卡片目前直接用原始立绘，3 MB 级 JPEG 对首屏偏重；
  `assets/skin-*.thumb.webp` 已接好回退链路（`<img>` 的 `onError` 换 `src`），
  生成缩略图即可改善。
- 互斥的第二级会**改写用户的插件开关状态**（虽然可逆）。若用户不希望任何
  自动改动，关掉「独占皮肤」开关即可，此时仍保留第一级的 token 栈顶互斥。
- 立绘目前固定右侧加权（两张立绘的人物都在右侧）。若将来加入人物在左的
  立绘，需要把 `ART_BAND_MASK` 的加权方向也做成皮肤字段。
