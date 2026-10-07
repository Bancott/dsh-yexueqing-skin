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
├── index.js              # Host 半：静态素材路由（画面素材 + 字体）
├── client.js             # Client 半：皮肤本体（ModuleLoader bundle）
├── icon.svg              # 插件卡片图标（package.json 的顶层 icon）
├── LICENSE / .gitignore / .gitattributes
├── README.md
├── locale/{zh,en}.json   # 插件卡片标题与描述
├── scripts/              # smoke-host / smoke-client / subset-font / sample-veil
└── assets/
    ├── skin-spring.jpg             # 春庭藤影 原图（经四边带遮罩做边饰）
    ├── skin-snow.jpg               # 雪霁寒江 原图
    └── LXGWWenKaiGB-Regular.subset.ttf   # 霞鹜文楷GB（子集化）
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
│     字体 @font-face、选区 / 滚动条 / 焦点态，以及 html 上的画面三层样式。
│     样式表随皮肤变体整体替换，因此不会残留上一个变体的规则。
```

关闭开关时 ①② 都被 disposer 移除，`--dsw-*` 回到 base.css 原值。

### 2. 画面分层：结构上保证「所有文字都在所有图片之上」

> **最终版是单图边饰。** 每个皮肤只用一张原图，经**四边带遮罩**在画面四周
> 显现（中心留白）—— 这正是第一版（`v1.0.0`）的观感。曾经做过的
> **抠图分层版**（抠出背景 + 人物、alpha 羽化、置于晕影之上）完整保留在
> git 标签 **`v1.1.0-cutouts`**，需要时可取回；它的毛病是把人物硬贴上去，
> 观感不如整幅画自然收边。

需求有硬性优先级：**任何文字都必须压在图片之上**。这决定了画面**不能**放在
`shell.overlay` —— 那个 slot 的定义就是"位于所有列之上"，放进去必然盖住正文
（实测过：对话内容被人物遮住）。

现在画面挂在 **`body`** 上，靠 CSS 绘制顺序拿到保证：

| 绘制顺序（自下而上） | 内容 |
|---|---|
| `body` 背景 | 不透明底色（`--yxq-base-solid`） |
| `body::after`（`z-index:-2`） | 左侧护罩 + **晕影** + **原图**（三个背景层） |
| `body::before`（`z-index:-1`） | **边饰**：同一张原图，经四边带遮罩只在四周显现 |
| `body` 的正常流内容 | 应用外壳与**全部文字** |

**为什么这样就成立**：`z-index` 为负的伪元素绘制在「父元素背景之上、全部
正常流内容之下」。所以"文字在图片之上"是**绘制顺序**决定的，与调参无关。

**为什么必须挂在 `body` 而不是 `html`**：ui-theme 的 Host 半会在任何脚本之前
注入 `body{background-color:#151517}`。挂在 `html` 上的画面会被它整片盖住；
而 `html` 的负层伪元素位于**根堆叠上下文**，仍在 `body` 背景**之下**。
所以画面必须挂在 `body` 上，并让 `body` 建立堆叠上下文
（`isolation:isolate`），负层子盒才会正确落在 `body` 背景之上、内容之下。

**为什么 `bg-base` 与 `sidebar-fill` 都必须 `transparent`**：
`--dsw-alias-bg-base` 被 `.frame`、`.centerCol`、会话根、各页面用来铺满视口，
只要不透明就把画面整片挡住。而且**必须是 `transparent`、不能是半透明** ——
这些容器是嵌套的，半透明会逐层叠加（`0.85³ ≈ 99.7%` 不透），画面在最里层
直接消失；`transparent` 与 `transparent` 复合仍是 `transparent`，**与嵌套深度
无关**。

更隐蔽的是：**Windows 标题栏模式下全屏框架 `.frame` 用的是
`--dsw-specific-sidebar-fill`，不是 `bg-base`**。只改 `bg-base` 时 `.frame`
依旧不透明（实测 computed 值 = 皮肤自己的 sidebarFill），画面照样全黑 ——
两个 token 必须一起透明。测试里有断言守着（第 8 节坑 3）。

代价是工具卡这类同样用 `bg-base` 的小容器也会变透。它们的文字仍在画面之上，
可读性由晕影负责。真正承载正文的**卡片、气泡、弹窗**用的是
`bg-layer-*` / `settings-card-fill` / `bg-overlay` —— 这些**保持不透明**，
所以正文区永远有一块干净的底。

**边饰的四边带遮罩**由三条线性渐变按 add（并集）合成：右侧一整条 + 上下两条 +
左侧极窄一抹；右侧加权是因为两张画的人物都在右边。中心留白，整幅画从边缘
自然收进去。

**晕影的底色不是拍脑袋定的，是采样出来的**（`scripts/sample-veil.py`）：
取每张画**中心区域**（对话栏实际覆盖处）最暗的 40% 像素平均，再压暗加饱和。
中心区域是关键 —— 整幅画的最暗部可能在边角，而那里反而被四边带遮住。

| 皮肤 | 采样值 | `veil`（暗色） |
|---|---|---|
| 春庭藤影 | `#79756C` | `#4A483A` 暖橄榄褐 |
| 雪霁寒江 | `#9EACC2` | `#3E4856` 冷蓝灰 |

这样对话栏的底色是从画里"长出来"的，而不是压一层黑。

强度档位在皮肤页可实时切换：

| 档 | 晕影中心 | 晕影中段 | 晕影四周 | 边饰 |
|---|---|---|---|---|
| 弱 | 0.84 | 0.56 | 0.26 | 0.55 |
| 中（默认） | 0.70 | 0.42 | 0.16 | 0.78 |
| 强 | 0.60 | 0.32 | 0.10 | 0.94 |

晕影的**颜色**取自调色板的 `veil`，**alpha** 由档位决定 —— 所以"画面强度"
是一个旋钮，而"什么颜色"是皮肤自己的事。

> **素材的实际前提是宽高比一致，不是像素尺寸相同。**
> 两张原图都是 7664×4304，共用一套 `background-position`；
> 用 `background-size: cover` 映射到容器，宽高比一致才能保证切换变体时
> 取景完全一致。替换素材若破坏宽高比，切换变体会像"画面跳了一下" ——
> host 测试里有断言守着这条。

### 3. 信息保真：固定 UI 文字不跟着皮肤变淡

需求：权限、模型、账号、标签、轮数、上下文占用、输入框这类"固定 UI"
要保持原样，方便一眼扫到关键信息（只有字体要换 —— 字体走 `--dsw-font-family`，
与本条无关）。

**做法一：不覆盖表达"次要"的 token。** 下面两个 token 正是 DSH 用来表达
次要 / 未激活的层级，覆盖它们必然等于"主动调淡"：

```
--dsw-alias-label-secondary      次要文字（标签、元信息、提示）
--dsw-alias-state-idle-primary   未激活状态
```

它们被显式列进 `INFO_FIDELITY_TOKENS` 并**排除**在覆盖层外，让 base.css
原值生效，对比度即为原生水平。测试里有一条断言禁止它们滑回覆盖层。

**做法二：其余被覆盖的颜色，暗色下一律不比原生更暗。** 例如
`--dsw-alias-label-primary` 的暗色值是 `#F2F8F5`，比 DSH 默认的 `#E1E5EE`
更亮；边框与状态色同理。因此不存在"用了皮肤之后某个文字变淡"的情形。

**做法三：把"更弱的一档"反过来提亮。** 主题注册表只暴露 34 个 token，
而界面实际大量使用更细的层级，它们此前完全不受皮肤控制 —— 这正是
"底部轮数那一行、标签页、面包屑发灰看不清"的根因。查清后按需提亮：

| token | 界面上的位置 |
|---|---|
| `--dsw-alias-label-tertiary` | **底部轮数 / 步数 / tok 统计行**、标签页、面包屑、文件大小 |
| `--dsw-alias-label-caption` | 更弱的说明文字、2px 分隔点 |
| `--dsw-alias-label-primary-dimmed` | 文件名、内容预览 |
| `--dsw-alias-button-elevated-fill` | **「新对话」按钮的填色**（原来是原生灰） |
| `--dsw-alias-interactive-bg-hover` | 悬停态填色 |
| `--dsw-alias-border-l4` | **右侧对话定位横线（turn rail）里的"历史对话条"** |

另有三条自定义 token 专供 turn rail，让它"当前 / 预览 / 历史"三档颜色分明：
`--yxq-rail-active`（当前，淡金） / `--yxq-rail-preview`（预览） /
`--yxq-rail-mark`（历史）。三档**宽度**差异原样保留，只提亮与加宽一点点。

**晕影底色是采样出来的，不是拍的。** `scripts/sample-veil.py`（一次性工具，需 Pillow）取每张画
"中心区域（对话栏覆盖处）最暗的 40%"的平均色，压暗并加饱和后作为晕影底色：

| 皮肤 | 采样值 | 晕影底色（暗色） |
|---|---|---|
| 春庭藤影 | `#79756C` | `#4A483A` 暖橄榄褐（在脚本建议值 `#4B4840` 上再偏绿一点，呼应藤叶） |
| 雪霁寒江 | `#9EACC2` | `#3E4856` 冷蓝灰（脚本建议 `#414955`，略微加深以保住正文对比度） |

这样对话栏的底色是从画里"长出来"的，而不是压一层黑。

它们**不在注册表里，却一样能覆盖** —— 见下方「注册表之外的 token」。
注意方向：这些是**提亮**，与"不主动调淡"的要求一致；
`label-secondary` / `state-idle-primary` 仍然不覆盖。

### 4. 互斥怎么实现：重压栈，而不是 `!important`

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

### 5. 覆盖的 token

- **别名 token**：`bg-base` / `bg-layer-1` / `bg-layer-2` / `bg-overlay` /
  `border-l1..l4` / `brand-primary` / `label-primary` /
  `state-{error,success,warn}-primary` / `specific-sidebar-fill`
- **基础样式表实际消费的延伸别名**：
  `settings-card-fill` / `settings-card-stroke` / `focus-ring-color` /
  `dsh-scrollbar-thumb(-hover)` / `bg-document-selection` / `switch-thumb`
- **受支持的重绑点**：`--dsw-elevation-stroke-color`（高层级表面的发丝描边 →
  面板边框随主题色）
- **刻意不覆盖**：`--dsw-alias-label-secondary`、`--dsw-alias-state-idle-primary`
  （见第 3 节信息保真）
- **插件自有装饰 token**：`--yxq-accent`、`--yxq-accent-soft`、
  `--yxq-art-image` / `--yxq-art-position`、`--yxq-base-solid`、
  `--yxq-scene-image` / `--yxq-scene-position`、
  `--yxq-figure-image` / `--yxq-figure-position`、
  `--yxq-band-opacity` / `--yxq-band-edge`、`--yxq-art-veil-{edge,mid,core}`。
  它们走同一覆盖层，因此也自动跟随明暗与开关。

### 5b. 注册表之外的 token（本插件最实用的一处发现）

`overrideTokens` 的文档原文是：

> stacks partial token layers over the active theme **without touching the registry**

而 `validateOverrides` 只校验 `{ light, dark }` 形状、`composeActive` 直接
合并任意名字、ThemePresenter 把合并结果整份写成 `body` 的**内联自定义属性**。

**结论：任何 CSS 自定义属性都能走这一层下发**，于是自动获得
「跟随明暗 + 随开关装卸 + 与其他皮肤抢栈」的全部好处，不必自己写样式表、
也不必自己处理 `data-ds-dark-theme`。

`EXTRA_TOKEN_MAP` 就是这个机制的落点：

```js
const EXTRA_TOKEN_MAP = {
  textTertiary:   "--dsw-alias-label-tertiary",
  textCaption:    "--dsw-alias-label-caption",
  textDimmed:     "--dsw-alias-label-primary-dimmed",
  buttonElevated: "--dsw-alias-button-elevated-fill",
  hoverFill:      "--dsw-alias-interactive-bg-hover",
};
```

排查时的有效手段：`Theme.listTokens` 巡检返回的是**当前生效**的 token 名单 ——
覆盖成功后新 token 会直接出现在列表里，一眼可验（这五个确实出现了）。

**边界一：token 只能改"可变量"，改不了几何。** 像 turn rail 里
`transform: scaleX(.6)` 这种宽度、`height:2px` 这种尺寸，token 无从下手。

**边界二（本插件唯一的例外）：一条结构选择器。**
右侧对话定位横线（turn rail）的颜色**能**由 token 改（它就是 `border-l4`），
但"未激活 12px / 未加载 8px"的宽度让它在深晕影上仍然难认。为此加了一条规则：

```css
[class*="_marks"] button:before{ ... }
```

选择器**只做结构 + 后缀匹配**，不写完整的哈希类名：

- `[class*="_marks"]` 在全库中**唯一**命中这排横线的容器
  （已核对：`_mark` / `_marker` / `_markdownPayload` 都不会误伤）；
- `button` 限定为按钮（markdown 之类是 `div`/`pre`，不受影响）。

因此 CSS-module 的**哈希前缀**随 DSH 升版变化也不影响命中；
万一本地类名被改名，这几条规则**静默失效** —— 只影响观感，不会坏界面。
这是"原则"与"用户明确提了两次"之间的一次有意取舍，代价写在这里。

---

### 6. 字体

字体通过 `--dsw-font-family` 这一个 token 切换：

- 开关为「霞鹜文楷GB」时，覆盖层里放入
  `"LXGW WenKai GB", <原生系统字体栈>`；
- 开关为「默认字体」时，该 token **从覆盖层里整个消失**，
  base.css 的原生 UI 字体栈自动生效 —— 这就是"切回默认字体"，不需要二次覆盖。

`--dsw-font-family-brand` 派生自 `var(--dsw-font-family)`，因此品牌文字同样跟随。
换字体**不影响**第 3 节的信息保真：字号与颜色都不动。

### 7. 装饰

- **选区 / 滚动条**：主题色系线性渐变（`::selection`、`::-webkit-scrollbar-thumb`）。
- **输入框焦点态**：`input / textarea / select / [contenteditable]:focus-visible`
  上淡金色描边 + 柔和外环，即国风细线感。
- **画面三层**：`body` 背景（不透明底色）、`body::after`（护罩 + 晕影 + 原图）、
  `body::before`（边饰），全部在负 z-index 层（见第 2 节）。
- **右侧对话定位横线**（turn rail）：用一条**结构 + 后缀匹配**的选择器
  `[class*="_marks"] button:before` 提亮并略微加宽三档横线。这是全文唯一
  引用 DSH 内部类名的地方，取舍与代价见第 5b 节。
- **面板描边**：`--dsw-alias-border-l1..l4`、`--dsw-alias-settings-card-stroke`
  与可重绑的 `--dsw-elevation-stroke-color` 一起把面板/卡片描边染成主题色。
- **插件自身面板**：皮肤卡片底边一条主题色渐变发丝线、选中态的淡金描边 + 外发光。

除上面那条 turn rail 规则之外，样式只作用于**通用元素与伪元素选择器** ——
DSH 升版最多让装饰退化，不会让界面坏掉。


#### 关于云纹：已移除

第一版把「如意云头」做成 72×32 的 SVG 重复贴图铺满整帧，结果在界面上
一眼看成**一片时钟**（规律排列的弧线），用户明确不要，已整体删除。
国风线条需求改由 token 描边 + 焦点态线条 + 卡片发丝线承担。
如果日后想重新引入纹样，**不要做成整帧重复贴图**——那必然读成周期性图案。

### 8. 踩过的坑（都有测试断言守着）

**坑 1 · 画面放进 `shell.overlay` → 盖住对话文字。**
`shell.overlay` 是「位于所有列之上」的浮层。放进去必然压住正文，这个位置
**永远**无法满足「文字在图片之上」。

**坑 2 · 画面挂在 `html` 上 → 被 ui-theme 注入的 body 背景色整片盖住。**
ui-theme 的 Host 半会注入 `body{background-color:#151517}`。而 `html` 的负
z-index 伪元素落在**根堆叠上下文**的负层 —— 那是在 body 背景**之下**，
同样被盖住。所以画面必须挂在 `body` 上，且 `body` 要建立堆叠上下文
（`isolation:isolate`），负层子盒才会正确地落在 body 背景之上、内容之下。

**坑 3 · 只把 `--dsw-alias-bg-base` 改透明 → 画面依然全黑。**
最难找的一个。**Windows 标题栏模式下，全屏框架 `.frame` 的背景是用
`--dsw-specific-sidebar-fill` 画的，不是 `--dsw-alias-bg-base`。** 只改
bg-base，`.frame` 仍然是不透明的皮肤色（实测 `#111B18`），把画面整片挡住
—— 等于自己的 token 覆盖层挡住了自己的画面。
⇒ 开启画面时**两个 token 都要透明**。测试里有断言守着这一条。

**坑 4 · 遮罩/晕影的径向渐变半径超过视口 → 该露的地方全被压住。**
曾用 `radial-gradient(120% 100% at 50% 45%, ...)` 做遮罩，椭圆半径是视口的
120%×100%，于是「透明区」覆盖几乎整屏。**同样的错误在晕影上又犯了一次**：
`radial-gradient(120% 95% ...)` 让「四周最薄」那一档的 alpha 根本取不到，
整屏都压在 0.56~0.67。写径向渐变时务必按视口尺寸验算停止点的可达性。

**坑 5 · 纹样做成整帧重复贴图 → 读成「一片时钟」。** 已整体删除。

**坑 6 · 用 `!important` 抢 token 优先级 → 压平局部重绑。**
ui-theme 文档化了若干**局部重绑**的 token（高层级表面把
`--dsh-scrollbar-thumb(-hover)` 重绑为 l2、菜单材质重绑
`--dsw-elevation-stroke-color`）。全量 `!important` 会把它们一并压平，
破坏菜单与浮层的材质。改用重压栈（第 4 节）。

**坑 7 · 把「次要 / 未激活」token 一起覆盖 → 固定 UI 变淡。** 见第 3 节。

**坑 8 · 改状态形状时不换存储键 → 旧值被迁移成「关闭」。**
`art` 曾是 boolean，`readState` 把 `art: false` 迁移成 `"off"`，于是画面
永远不显示，而**从界面上很难联想到是历史设置导致的**。现在 `STORAGE_KEY`
带版本号（`.v2`）—— **每次改状态形状都要递增它**。

#### 排查纯视觉问题的方法（值得留着）

浏览器端没有可用的自动化读取通道；而 Host 半的模块在进程内被缓存，
改代码后**不重启就不会重新 import**（实测：同一个 `apply` 里新加的路由
不生效，而旧路由照常工作）。所以「画面不显示」这类问题靠猜会绕很久。

有效做法：让 **Client 半把浏览器里算出的状态 POST 到一个独立的 loopback
端口**（`Content-Type: text/plain` + `mode: "no-cors"` 构成 CORS 简单请求，
不触发预检，请求必定送达），由一个临时 Node 服务落盘。关键采样项：

- `getComputedStyle(document.body, "::after")` —— 伪元素有没有生成、背景是什么；
- **全 DOM 扫描「面积 > 半屏且背景不透明」的元素** —— 一眼定位盖住画面的元凶；
- 关键元素上各 token 的**实际取值**（`getPropertyValue`），以及
  `computedStyle` 的结果 —— 两者不一致就说明有更近的祖先或更高优先级的规则；
- 用 `new Image()` 探素材能否加载（看 `naturalWidth`）——比 resource timing 可靠，
  自定义 scheme（`dsh-app://`）的资源不一定进 resource timing。

坑 3 就是这么在一步之内定位的（`--dsw-alias-bg-base` 是 `transparent`，但
`.frame` 的 computed `background-color` 恰好等于 `--dsw-specific-sidebar-fill`）。

诊断代码必须**缺任何一个 API 就整体跳过** —— 它绝不允许影响皮肤本身
（曾经因为沙箱没有 `setTimeout` 而把整条测试跑崩）。发布前删干净，
`scripts/smoke-host.mjs` 里有断言禁止残留诊断路由。

## 安装

包名：**`dsh-yexueqing-skin`**（bundle + Web Client 插件，无需构建步骤，装上即用）

### 方式一：从 GitHub 安装（推荐）

```sh
dsh plugin --profile <你的 profile> add 'github:<Bancott>/dsh-yexueqing-skin'
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
4. **素材授权（重要）**：`assets/` 下六张图都是《逆水寒》叶雪青素材，
   版权归原作方。公开分发前请确认授权。不便随仓库分发时的降级方式：
   - 删掉全部六张 → 插件优雅降级为**纯配色皮肤**（`index.js` 的
     `ASSET_SPECS` 逐项探测，缺文件只是不注册那条路由），
     但 `SKINS` 里的 `scene` / `figure` 字段仍会拼出 URL 并 404 ——
     如需彻底干净，把 `ART_STRENGTHS` 的默认档改成 `off`。
   - 只删边饰（保留 `skin-*.jpg`）→ 退化成"单一原图 + 晕影"，仍然可用。
5. 字体已按 SIL OFL 1.1 随包分发子集，`LICENSE` 里已附声明。
6. 仓库体积约 28 MB。GitHub 单文件上限 100 MB、仓库建议 <1 GB，均无问题；
   但若想压到 10 MB 以内，把四张边饰降到 2732px 后再提交。

---

## 新增一个皮肤

三步，不需要碰机制代码：

1. **`client.js` → `SKINS` 数组**加一项：

   ```js
   {
     id: "moon",
     art: "skin-moon.jpg",            // 原图：环境氛围底衬
     scene: "scene-moon.png",         // 抠出的背景（RGBA）
     figure: "figure-moon.png",       // 抠出的人物（RGBA，不受晕影遮挡）
     artPosition: "center 25%",
     scenePosition: "center 25%",     // 三张同尺寸同构图，对位一致
     figurePosition: "center 25%",
     palette: {
       light: { /* 与现有皮肤同名的语义 key，全部必填 */ },
       dark:  { /* … */ },
     },
   }
   ```

   语义 key 清单见 `TOKEN_MAP` 与 `DECOR_TOKEN_MAP`（`base` `layer1` `layer2`
   `overlay` `sidebarFill` `border1..4` `cardFill` `cardStroke` `brand`
   `textPrimary` `error` `success` `warn` `focusRing` `scrollThumb`
   `scrollThumbHover` `selection` `switchThumb` `accent` `accentSoft`
   `elevationStroke`，以及晕影三层 `veilEdge` `veilMid` `veilCore`）。

   > 注意 `textSecondary` 与 `idle` **刻意不在表里** —— 它们是"次要/未激活"
   > 层级，覆盖就等于把固定 UI 调淡（见第 3 节）。

2. **`client.js` → locale 字典**（`zh` 与 `en` 两份）各加两条：
   `"skin.moon.name"`、`"skin.moon.desc"`。

3. 三张素材放进 `assets/`，并加进 `index.js` 的 `ASSET_SPECS`。
   边饰必须保留 alpha 通道（RGBA PNG），且与原图**同尺寸同构图**。

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

- **`bg-base` 透明会让工具卡之类的小容器也变透**。这是"画面能被看见"的必要
  代价：那些容器与全屏框架共用同一个 token，无法按尺寸区分。承载正文的卡片、
  气泡、弹窗用的是另外几个 token，仍然不透明，所以正文区始终有干净的底。
  如果某类卡片观感不佳，是调整晕影强度（档位）而不是改回不透明。
- **画面靠 `z-index` 负值的伪元素**，因此依赖"应用根容器不建立会截断负层级的
  堆叠上下文"这一前提。当前 ui-layout 的 `.frame` 只有 `position:relative`
  而没有 `z-index`，成立；若将来 DSH 给根容器加了 `z-index` 或
  `isolation:isolate`，画面会被压到看不见（表现为"皮肤只剩配色"）。
- **宿主面板内部直接叠纹样**缺钩子。目前装饰落在 token 描边
  （`border-l1..l4`、`settings-card-stroke`、`elevation-stroke-color`）
  与插件自身面板上；在没有钩子前不去覆盖宿主元素的 `background-image`，
  否则会盖掉组件自己的背景。
- **素材体积 28 MB**（两张原图 + 四张 5465×3069 边饰 + 字体）。边饰在界面上
  最多铺到视口宽度，降到 2732px 可再省约 3/4 体积且肉眼无差。本仓库刻意
  **不引入会改动美术素材的隐式构建步骤** —— 想要更小体积请自行降采样后替换，
  文件名不变，`index.js` 的 `ASSET_SPECS` 无需改动。
- 边饰**必须保留 alpha 通道**。若替换成不透明图，人物会变成一块方图压住界面 ——
  这是这套方案唯一不可省的素材要求。
- 字体已子集化到 3.62 MB（`npm run subset-font` 可重新生成），并经 brotli
  压缩到约 1.89 MB 传输。若日后要做 WOFF2，`@font-face` 的 `src` 已按
  `woff2 → ttf` 顺序声明，把 `.subset.woff2` 放进 `assets/` 即可自动优先。
- 互斥的第二级会**改写用户的插件开关状态**（虽然可逆）。若用户不希望任何
  自动改动，关掉「独占皮肤」开关即可，此时仍保留第一级的 token 栈顶互斥。
- 边缘渐入宽度（`edge`）对两张立绘是同一个值。若将来某张边饰的硬边特别窄，
  把 `edge` 做成**每皮肤**字段即可，机制无需改动。