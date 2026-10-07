/**
 * 叶雪青主题皮肤 —— Client 半（浏览器 bundle）。
 *
 * 文件形态：`window.__ModuleLoader__.load({...})`，id 必须等于 package.json 的
 * package name。factory 是惰性的（只注册工厂，无模块副作用）。
 *
 * ══════════════════════════════════════════════════════════════════════════
 * 架构：一个开关，两层机制，三层画面
 * ══════════════════════════════════════════════════════════════════════════
 *
 *   ① 主题服务层  ctx.theme.overrideTokens(LAYER, tokens)
 *        每个 token 给 { light, dark } 一对值 → 自动跟随 DSH 原生的
 *        浅色 / 深色 / 跟随系统。同一 source 重复调用 = 整层替换并重新
 *        压到栈顶（互斥就靠这条语义）。
 *
 *   ② 样式表层    insertStyle(css)
 *        字体 @font-face、选区 / 滚动条 / 焦点态，以及挂在 body 上的画面三层。
 *
 *   画面三层全部位于 body 的背景与负 z-index 伪元素上，因此**结构上**
 *   位于全部内容之下 —— "所有文字在所有图片之上"由绘制顺序保证。
 *   详见 uiCss() 顶部的说明（为什么必须是 body 而不是 html）。
 *
 * ══════════════════════════════════════════════════════════════════════════
 * 与 DSH 标准的对应
 * ══════════════════════════════════════════════════════════════════════════
 *
 *  - 只通过 slot 贡献 UI：settings.general.item（开关行）+ settings.section（皮肤页）。
 *    画面不占用任何 slot —— 占用内容之上的 slot 必然盖住文字。
 *  - 不 require 任何 `@deepseek-ai/dsh-client-*` 包，只 require("react")。
 *  - 所有资源都经 ctx.effect 注册并返回清理函数。
 *  - 样式只作用于通用元素 / 伪元素选择器，不引用任何 DSH 内部类名。
 */
(function () {
  const PACKAGE_NAME = "dsh-yexueqing-skin";

  window.__ModuleLoader__.load({
    id: PACKAGE_NAME,
    factory(require) {
      const React = require("react");
      const h = React.createElement;

      // ══════════════════════════════════════════════════════════════════
      // 常量
      // ══════════════════════════════════════════════════════════════════

      const ASSET_BASE = "/plugins/yexueqing-skin/assets/";
      /** overrideTokens 的层标识：同一 source 重复调用会整体替换该层。 */
      const THEME_LAYER = "dsh-yexueqing-skin";
      /**
       * 设置持久化键（浏览器本地，不写任何 profile 文件）。
       *
       * 带版本号是刻意的：前几版的状态形状不同（`art` 曾是 boolean、还有过
       * `motif` 字段）。旧值里一个 `art: false` 会被迁移成 `"off"`，
       * 于是画面永远不显示，而且**从界面上很难联想到是历史设置导致的**。
       * 换键等于把所有历史状态一次性作废，回到默认值。
       */
      const STORAGE_KEY = "dsh-yexueqing-skin.state.v2";
      const LOCALE_NS = "yexueqing-skin";

      /** 字体族名，必须与 decorCss() 里 @font-face 的 family 完全一致。 */
      const WENKAI_FAMILY = "LXGW WenKai GB";
      /** DSH 基础样式表里的原生 UI 字体栈（来自 ui-theme 的 base.css）。 */
      const SYSTEM_FONT_STACK =
        '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Helvetica, Arial, sans-serif';
      const WENKAI_STACK = `"${WENKAI_FAMILY}", ${SYSTEM_FONT_STACK}`;

      /**
       * 画面强度档位。
       *
       *   veilCore/Mid/Edge  晕影在三处的不透明度（对皮肤的 veil 底色取 alpha）。
       *                      中心最厚（护住正文），四周最薄（露出画面）。
       *   band               边饰层（原图 + 四边带遮罩）的不透明度。
       *                      它在晕影之上，所以四周的画面是清晰、不被压暗的。
       */
      const ART_STRENGTHS = {
        soft: { veilCore: "0.84", veilMid: "0.56", veilEdge: "0.26", band: "0.55" },
        medium: { veilCore: "0.70", veilMid: "0.42", veilEdge: "0.16", band: "0.78" },
        strong: { veilCore: "0.60", veilMid: "0.32", veilEdge: "0.10", band: "0.94" },
      };

      // ══════════════════════════════════════════════════════════════════
      // 皮肤注册表 —— 唯一的扩展点
      // ══════════════════════════════════════════════════════════════════
      //
      // 语义 key 而不是直接写 DSH token 名：调色板可读、可复用，
      // 由下面的 TOKEN_MAP / DECOR_TOKEN_MAP 统一映射到真实 token。
      //
      // 每个皮肤三张画面素材，全部同宽高比（因此共用一套对位参数）：
      //   art     原图铺满，环境氛围，被晕影压暗
      //   scene   抠出的重要背景（紫藤 / 雪枝），在晕影之上
      //   figure  抠出的人物，在晕影之上
      //
      //   spring  春庭藤影  ← 叶雪青.jpg
      //       日光回廊、紫藤垂落、新绿与淡青；白袍 + 藕荷披帛 + 青色缘边。
      //       底色偏月白暖青，强调色取淡金（阳光）与藕粉（紫藤）。
      //   snow    雪霁寒江  ← 叶雪青雪景.jpg
      //       雪后寒江、远山楼阁、素白花枝；白袍 + 深靛蓝腰带 + 霜紫内衬。
      //       底色偏月白冷蓝，强调色取淡金（腰饰）与霜紫（内衬）。
      //
      const SKINS = [
        {
          id: "spring",
          art: "skin-spring.jpg",
          artPosition: "center 22%",
          palette: {
            light: {
              base: "#E9F0EA",
              layer1: "#F7FAF8",
              layer2: "#DFE9E2",
              overlay: "#F9FCFA",
              sidebarFill: "#E2ECE5",
              border1: "#D5E1D9",
              border2: "#BCCDC2",
              border3: "#A6BCAE",
              border4: "#A9C0B3",
              cardFill: "#FFFFFF",
              cardStroke: "#D3E0D7",
              brand: "#5A8877",
              textPrimary: "#1F2925",
              error: "#B85F4C",
              success: "#5C8C6E",
              warn: "#A9833F",
              focusRing: "#5A8877",
              scrollThumb: "#BCCDC2",
              scrollThumbHover: "#9FB8A9",
              selection: "rgba(140, 175, 158, 0.34)",
              switchThumb: "#FFFFFF",
              accent: "#B8933F",
              accentSoft: "rgba(184, 147, 63, 0.16)",
              elevationStroke: "rgba(90, 136, 119, 0.38)",
              /** 晕影底色：采样画面中心区暗部（#79756C）压暗并加饱和 -> 暖橄榄褐。 */
              veil: "#E4DFCE",
              railMark: "#5E8672",
              railActive: "#B8933F",
              railPreview: "#7C9C8B",
              // ↓ 以下 token 不在主题注册表里，但 overrideTokens 允许任意名字
              //   （validateOverrides 只校验 {light,dark} 形状，composeActive 直接合并），
              //   于是同样能自动跟随明暗与开关。
              textTertiary: "#4E6B5D",
              textCaption: "#63796D",
              textDimmed: "#3A4F45",
              buttonElevated: "rgba(255, 255, 255, 0.62)",
              hoverFill: "rgba(90, 136, 119, 0.12)",
            },
            dark: {
              base: "#0D1513",
              layer1: "#16211E",
              layer2: "#1E2C27",
              overlay: "#1A2622",
              sidebarFill: "#111B18",
              border1: "#283832",
              border2: "#3A5047",
              border3: "#4A6357",
              border4: "#4E6A5C",
              cardFill: "#18241F",
              cardStroke: "#2E4038",
              brand: "#A8C0B8",
              textPrimary: "#F2F8F5",
              error: "#D08A79",
              success: "#83AE93",
              warn: "#D3B77C",
              focusRing: "#A8C0B8",
              scrollThumb: "#3A5047",
              scrollThumbHover: "#5C7469",
              selection: "rgba(168, 192, 184, 0.30)",
              switchThumb: "#DCE6DF",
              accent: "#DCC183",
              accentSoft: "rgba(220, 193, 131, 0.20)",
              elevationStroke: "rgba(168, 192, 184, 0.38)",
              veil: "#4A483A",
              railMark: "#9CC4AC",
              railActive: "#F2DCA0",
              railPreview: "#C6D6CB",
              textTertiary: "#A8BDB2",
              textCaption: "#8FA79B",
              textDimmed: "#CBDAD2",
              buttonElevated: "rgba(94, 128, 112, 0.42)",
              hoverFill: "rgba(150, 190, 170, 0.14)",
            },
          },
        },
        {
          id: "snow",
          art: "skin-snow.jpg",
          artPosition: "center 30%",
          palette: {
            light: {
              base: "#E7EDF5",
              layer1: "#F6F9FC",
              layer2: "#DCE5F0",
              overlay: "#F8FBFD",
              sidebarFill: "#E0E8F2",
              border1: "#D2DEEA",
              border2: "#B8C8D9",
              border3: "#A2B5C9",
              border4: "#A6BACF",
              cardFill: "#FFFFFF",
              cardStroke: "#D0DCE9",
              brand: "#51779E",
              textPrimary: "#1D2530",
              error: "#B25E5E",
              success: "#5A837B",
              warn: "#A8873F",
              focusRing: "#51779E",
              scrollThumb: "#B8C8D9",
              scrollThumbHover: "#9AB2CA",
              selection: "rgba(150, 178, 208, 0.36)",
              switchThumb: "#FFFFFF",
              accent: "#A8873F",
              accentSoft: "rgba(168, 135, 63, 0.16)",
              elevationStroke: "rgba(81, 119, 158, 0.38)",
              /** 晕影底色：采样画面中心区暗部（#9EACC2）压暗 -> 冷蓝灰。 */
              veil: "#DDE5EF",
              railMark: "#5E7A9C",
              railActive: "#A8873F",
              railPreview: "#7E92A8",
              textTertiary: "#4C6076",
              textCaption: "#62748A",
              textDimmed: "#38485A",
              buttonElevated: "rgba(255, 255, 255, 0.62)",
              hoverFill: "rgba(81, 119, 158, 0.12)",
            },
            dark: {
              base: "#0B1119",
              layer1: "#131C26",
              layer2: "#1B2531",
              overlay: "#17202B",
              sidebarFill: "#0F1721",
              border1: "#232F3D",
              border2: "#334154",
              border3: "#415063",
              border4: "#44586E",
              cardFill: "#151E29",
              cardStroke: "#283646",
              brand: "#A9BED0",
              textPrimary: "#F2F7FC",
              error: "#D08A8A",
              success: "#7FA8A0",
              warn: "#D0B67F",
              focusRing: "#A9BED0",
              scrollThumb: "#334154",
              scrollThumbHover: "#556883",
              selection: "rgba(169, 190, 208, 0.32)",
              switchThumb: "#DCE6F3",
              accent: "#D6C08F",
              accentSoft: "rgba(214, 192, 143, 0.20)",
              elevationStroke: "rgba(169, 190, 208, 0.38)",
              veil: "#3E4856",
              railMark: "#A2B8D4",
              railActive: "#EDD9A6",
              railPreview: "#C6D2E2",
              textTertiary: "#A9B9CB",
              textCaption: "#8FA2B8",
              textDimmed: "#CCD9E6",
              buttonElevated: "rgba(96, 122, 152, 0.42)",
              hoverFill: "rgba(150, 175, 205, 0.14)",
            },
          },
        },
      ];

      /**
       * 语义 key -> DSH 主题 token 名。
       *
       * 覆盖的是**结构 / 强调 / 状态**类 token。承载文字的卡片与气泡
       * （layer-1/2、cardFill、overlay）刻意保持不透明，给正文一块干净的底。
       */
      const TOKEN_MAP = {
        base: "--dsw-alias-bg-base",
        layer1: "--dsw-alias-bg-layer-1",
        layer2: "--dsw-alias-bg-layer-2",
        overlay: "--dsw-alias-bg-overlay",
        sidebarFill: "--dsw-specific-sidebar-fill",
        border1: "--dsw-alias-border-l1",
        border2: "--dsw-alias-border-l2",
        border3: "--dsw-alias-border-l3",
        border4: "--dsw-alias-border-l4",
        cardFill: "--dsw-alias-settings-card-fill",
        cardStroke: "--dsw-alias-settings-card-stroke",
        brand: "--dsw-alias-brand-primary",
        textPrimary: "--dsw-alias-label-primary",
        error: "--dsw-alias-state-error-primary",
        success: "--dsw-alias-state-success-primary",
        warn: "--dsw-alias-state-warn-primary",
        focusRing: "--dsw-focus-ring-color",
        scrollThumb: "--dsh-scrollbar-thumb",
        scrollThumbHover: "--dsh-scrollbar-thumb-hover",
        selection: "--dsw-alias-bg-document-selection",
        switchThumb: "--dsw-alias-switch-thumb",
      };

      /**
       * 装饰 token：`--yxq-*` 是本插件自己的变量，走同一覆盖层下发，
       * 因此同样自动跟随明暗与开关。
       *
       * `elevationStroke` 例外：它是 ui-theme 明确文档化的**可重绑** token
       * （`--dsw-elevation-stroke-color`，高层级表面用它画 0.5px 发丝描边），
       * 所以把面板描边染成主题色是受支持的做法，不需要猜任何内部类名。
       */
      const DECOR_TOKEN_MAP = {
        accent: "--yxq-accent",
        accentSoft: "--yxq-accent-soft",
        elevationStroke: "--dsw-elevation-stroke-color",
        railMark: "--yxq-rail-mark",
        railActive: "--yxq-rail-active",
        railPreview: "--yxq-rail-preview",
      };

      /**
       * **注册表之外**的 token —— 本插件最实用的一处发现。
       *
       * ui-theme 的 `overrideTokens` 明确是"把部分 token 层叠到当前主题之上、
       * 不触碰注册表"，而 `validateOverrides` 只校验 `{light, dark}` 形状、
       * `composeActive` 直接合并任意名字。于是**任何 CSS 自定义属性**都能走
       * 同一层下发：自动跟随明暗、自动随开关装卸。
       *
       * 主题注册表只暴露 34 个 token，而界面实际大量使用下面这些更细的层级，
       * 它们此前完全不受皮肤控制（这正是"固定 UI 文字发灰看不清"的根因）：
       *
       *   label-tertiary          次要/元信息文字（底部轮数统计行、标签页、面包屑）
       *   label-caption           更弱的说明文字与 2px 分隔点
       *   label-primary-dimmed    文件名、预览等"主体但弱一档"的文字
       *   button-elevated-fill    「新对话」这类抬升按钮的填色
       *   interactive-bg-hover    悬停态填色
       */
      const EXTRA_TOKEN_MAP = {
        textTertiary: "--dsw-alias-label-tertiary",
        textCaption: "--dsw-alias-label-caption",
        textDimmed: "--dsw-alias-label-primary-dimmed",
        buttonElevated: "--dsw-alias-button-elevated-fill",
        hoverFill: "--dsw-alias-interactive-bg-hover",
      };

      /**
       * **刻意不覆盖**的 token —— 信息保真的核心决定。
       *
       * 需求：权限、模型、账号、标签、轮数、上下文占用、输入框这类"固定 UI"
       * 不要跟着皮肤变淡。这两个 token 恰恰是 DSH 用来表达**次要 / 未激活**
       * 的层级，覆盖它们必然等于"主动调淡"：
       *
       *   --dsw-alias-label-secondary     次要文字（标签、元信息、提示）
       *   --dsw-alias-state-idle-primary  未激活状态
       *
       * 让 base.css 的原值生效，界面文字对比度就是原生水平。测试里有一条
       * 断言禁止它们重新出现在覆盖层里。
       */
      const INFO_FIDELITY_TOKENS = [
        "--dsw-alias-label-secondary",
        "--dsw-alias-state-idle-primary",
      ];

      // ══════════════════════════════════════════════════════════════════
      // 状态：一个极小的订阅式存储
      // ══════════════════════════════════════════════════════════════════

      const DEFAULT_STATE = {
        /** 总开关：叶雪青主题 */
        enabled: true,
        /** 当前皮肤变体 id，取自 SKINS */
        skin: "spring",
        /** "wenkai" = 霞鹜文楷GB（换到本皮肤时默认） / "system" = 默认字体 */
        font: "wenkai",
        /** 立绘强度：off | soft | medium | strong */
        art: "medium",
        /** 开启时自动关闭检测到的其他皮肤插件（互斥） */
        exclusive: true,
        /** 由我们自动关闭的插件条目 id，用于关闭皮肤时原样恢复。 */
        disabledRows: [],
      };

      const ART_LEVELS = ["off", "soft", "medium", "strong"];

      function readState() {
        let raw = null;
        try {
          raw = window.localStorage.getItem(STORAGE_KEY);
        } catch {
          // 隐私模式 / 存储被禁用：退回默认值，不影响皮肤本身。
          return { ...DEFAULT_STATE };
        }
        if (typeof raw !== "string") return { ...DEFAULT_STATE };

        let parsed;
        try {
          parsed = JSON.parse(raw);
        } catch {
          return { ...DEFAULT_STATE };
        }
        if (parsed === null || typeof parsed !== "object") return { ...DEFAULT_STATE };

        // 逐字段校验：皮肤列表可能缩减（用户卸载了某个变体），
        // 存下来的未知 id 必须回退而不是让整个插件炸掉。
        // 旧版本的 `art: true/false` 也在这里平滑迁移到新的档位字符串。
        const skin = SKINS.some((s) => s.id === parsed.skin) ? parsed.skin : DEFAULT_STATE.skin;
        let art = DEFAULT_STATE.art;
        if (typeof parsed.art === "string" && ART_LEVELS.includes(parsed.art)) art = parsed.art;
        else if (parsed.art === false) art = "off";
        else if (parsed.art === true) art = "medium";

        return {
          enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : DEFAULT_STATE.enabled,
          skin,
          font: parsed.font === "system" ? "system" : "wenkai",
          art,
          exclusive:
            typeof parsed.exclusive === "boolean" ? parsed.exclusive : DEFAULT_STATE.exclusive,
          disabledRows: Array.isArray(parsed.disabledRows)
            ? parsed.disabledRows.filter((row) => typeof row === "string")
            : [],
        };
      }

      function createStore(initial) {
        let state = initial;
        const listeners = new Set();
        return {
          get: () => state,
          set(patch) {
            const next = { ...state, ...patch };
            let changed = false;
            for (const key of Object.keys(next)) {
              if (next[key] !== state[key]) {
                changed = true;
                break;
              }
            }
            if (!changed) return;
            state = next;
            try {
              window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
            } catch {
              // 写失败只是不持久化，本次会话内仍然生效。
            }
            for (const listener of [...listeners]) listener(state);
          },
          subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
          },
        };
      }

      const store = createStore(readState());
      const skinById = (id) => SKINS.find((s) => s.id === id) ?? SKINS[0];

      /** 让组件订阅 store 并跟随重渲染。 */
      function useSkinState() {
        const [snapshot, setSnapshot] = React.useState(store.get);
        React.useEffect(() => store.subscribe(setSnapshot), []);
        return snapshot;
      }

      /** 让组件跟随 locale/change 重渲染（slot 的 label 是 thunk，不需要这个）。 */
      function useLocaleTick(ctx) {
        const [, setTick] = React.useState(0);
        React.useEffect(() => ctx.on("locale/change", () => setTick((n) => n + 1)), [ctx]);
      }

      // ══════════════════════════════════════════════════════════════════
      // 机制 1：token 层
      // ══════════════════════════════════════════════════════════════════

      /**
       * `#RRGGBB` -> `rgba(r, g, b, alpha)`。
       * 用于按档位给晕影底色套不同的 alpha。转换失败时原值返回 ——
       * 宁可 alpha 失效，也不要产出无效颜色把整个 token 变成无效值。
       */
      function withAlpha(color, alpha) {
        const match = /^#([0-9a-f]{6})$/i.exec(color);
        if (match === null) return color;
        const n = Number.parseInt(match[1], 16);
        return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
      }

      /** 把皮肤调色板编成 overrideTokens 需要的 `Record<token, {light,dark}>`。 */
      function composeTokens(skin, state, assetBase) {
        const tokens = {};
        // 立绘档位（null = 关闭）。注意 `state.art` 是字符串，
        // `if (state.art)` 对 "off" 也是真 —— 必须先用档位表归一。
        const level = ART_STRENGTHS[state.art] ?? null;

        const assign = (map, light, dark) => {
          for (const [key, token] of Object.entries(map)) {
            if (light[key] === undefined && dark[key] === undefined) continue;
            tokens[token] = {
              light: light[key] ?? dark[key],
              dark: dark[key] ?? light[key],
            };
          }
        };

        assign(TOKEN_MAP, skin.palette.light, skin.palette.dark);
        assign(DECOR_TOKEN_MAP, skin.palette.light, skin.palette.dark);
        assign(EXTRA_TOKEN_MAP, skin.palette.light, skin.palette.dark);

        // ── 关键决定：`bg-base` 置为**完全透明** ──────────────────────────
        //
        // 应用的大块容器（.frame / .centerCol / 会话根 Dc7zOa_root / 各页面）
        // 都用 `background: var(--dsw-alias-bg-base)` 铺满视口。只要它不透明，
        // 挂在 body 上的画面就被整片挡住。
        //
        // 必须是 `transparent` 而不是"半透明"：这些容器是**嵌套**的
        // （frame → centerCol → 会话根 → 工具卡）。半透明会逐层叠加
        // （0.85 叠三层 = 99.7% 不透），画面在最里层直接消失；
        // 而 transparent 与 transparent 复合仍是 transparent，与嵌套深度无关。
        //
        // 代价是工具卡这类也用 bg-base 的小容器会变透 —— 它们的文字仍在画面
        // 之上，可读性由晕影负责。真正承载文字的卡片 / 气泡 / 弹窗用的是
        // layer-* / cardFill / overlay，那些**保持不透明**。
        //
        // ── `--dsw-specific-sidebar-fill` 也必须一起透明 ────────────────────
        // 这是实测出来的：Windows 标题栏模式下，全屏框架 `.frame` 的背景是
        // 用 **sidebar-fill** 画的（不是 bg-base）。把 bg-base 改成 transparent
        // 之后，.frame 依然是不透明的 `#111B18`（= 本皮肤的 sidebarFill），
        // 于是画面照样被整片挡住 —— 等于自己的 token 覆盖层挡住了自己的画面。
        // 诊断证据：同一个 .frame 上 `--dsw-alias-bg-base` 是 transparent，
        // 而 computed background-color 恰恰等于 `--dsw-specific-sidebar-fill`。
        //
        // 副作用是侧栏也变透。侧栏文字密集，所以给 body::after 加了一层
        // 左侧护罩（见 uiCss），局部把画面压下去以保住可读性。
        if (level !== null) {
          tokens["--dsw-alias-bg-base"] = { light: "transparent", dark: "transparent" };
          tokens["--dsw-specific-sidebar-fill"] = { light: "transparent", dark: "transparent" };
        }

        // 字体走同一个覆盖层：关掉时整个 token 从层里消失，
        // base.css 的原生 UI 字体栈自动生效 —— 这就是"切回默认字体"。
        if (state.font === "wenkai") {
          tokens["--dsw-font-family"] = { light: WENKAI_STACK, dark: WENKAI_STACK };
        }

        // 三张画面素材的 URL / 对位 / 各层强度都由 token 下发，
        // 样式表因此不必知道 ASSET_BASE，也不必知道档位表。
        const img = (file) => (level === null ? "none" : `url("${assetBase}${file}")`);
        const same = (value) => ({ light: value, dark: value });

        tokens["--yxq-art-image"] = same(img(skin.art));
        tokens["--yxq-art-position"] = same(skin.artPosition);

        // 抠图层（背景 + 人物）的不透明度；它们在晕影之上，故不被压暗。
        tokens["--yxq-band-opacity"] = same(level === null ? "0" : level.band);

        // html / body 的**不透明**实底：bg-base 已透明，画布必须另有实底，
        // 否则图片没盖到的地方会透出浏览器 canvas（深色模式下是白色）
        // 以及 ui-theme 注入的 body 兜底色。
        tokens["--yxq-base-solid"] = {
          light: skin.palette.light.base,
          dark: skin.palette.dark.base,
        };

        // 晕影三层：底色取自皮肤调色板的 veil，alpha 由档位决定 ——
        // "画面强度"是一个旋钮，"什么颜色"是皮肤自己的事。
        const veilAt = (scheme, alpha) => withAlpha(skin.palette[scheme].veil, alpha);
        tokens["--yxq-art-veil-core"] = {
          light: veilAt("light", level?.veilCore ?? "0"),
          dark: veilAt("dark", level?.veilCore ?? "0"),
        };
        tokens["--yxq-art-veil-mid"] = {
          light: veilAt("light", level?.veilMid ?? "0"),
          dark: veilAt("dark", level?.veilMid ?? "0"),
        };
        tokens["--yxq-art-veil-edge"] = {
          light: veilAt("light", level?.veilEdge ?? "0"),
          dark: veilAt("dark", level?.veilEdge ?? "0"),
        };

        return tokens;
      }

      // ══════════════════════════════════════════════════════════════════
      // 机制 2：样式表
      // ══════════════════════════════════════════════════════════════════

      /**
       * 插入一张本插件持有的样式表。
       *
       * 注意：`styles.insert()` 那个 builtin 属于**动态** Cordis 包的符号面
       * （浏览器半作为 async 函数体求值时的参数），静态包的 Client 半没有它 ——
       * 静态半自己建 `<style>` 挂到 head。client-modules 用 `data-plugin`
       * 认领样式表以支持卸载与 HMR，因此创建时就打上标记；同时把移除交给
       * 调用方返回的 disposer。两条清理路径都成立，重复移除无副作用。
       */
      function insertStyle(css) {
        const style = document.createElement("style");
        style.setAttribute("data-plugin", PACKAGE_NAME);
        style.textContent = css;
        document.head.appendChild(style);
        return () => {
          if (style.parentNode !== null) style.parentNode.removeChild(style);
        };
      }

      /** 插件自身 UI 的样式 + 画面三层（皮肤无关，只依赖 token）。 */
      function uiCss() {
        return `
/* ══ 皮肤画面：结构上保证「所有文字都在所有图片之上」 ════════════════

   绘制顺序（自下而上）
     body 背景                 不透明底色 + 原图
     body::after   z-index:-2  晕影
     body::before  z-index:-1  抠出的背景 + 抠出的人物
     body 的正常流内容          应用外壳与**全部文字**

   ── 为什么必须是 body，而不是 html ──────────────────────────────────
   ui-theme 的 Host 半会把一段 head CSS 注入到任何脚本之前，其中有
   body 的 background-color（深色下是 #151517）—— 也就是 body 有一个
   不透明的背景色。它的高度是 100%，于是：
     1. 挂在 html 背景上的画面会被它整片盖住；
     2. html 的负 z-index 伪元素位于根堆叠上下文的负层，而 body 的背景
        绘制在其后（正常流块级盒），因此同样被盖住。
   两者叠起来的结果就是"立绘根本没有显示"（实测过）。

   ── 为什么画面全部放进伪元素，而不是 body 的背景 ────────────────────
   画面若挂在 body 自己的 background-image 上，就依赖"body 的背景不被
   任何更高优先级的规则覆盖"。实测里这种依赖不可靠（ui-theme 注入的
   head CSS 就动过 body 的背景）。所以原图与晕影一起放进 body::after
   （同一元素的两个背景层），抠图放进 body::before —— 两者都是 body
   堆叠上下文里的**负层子盒**，按规范必然绘制在 body 背景之上、全部
   内容之下。body 的背景只留一个不透明底色兜底。 */

html{background-color:var(--yxq-base-solid)}
body{isolation:isolate;background-color:var(--yxq-base-solid)}

/* 原图（下层）+ 晕影（中）+ 左侧护罩（上，保护文字密集的侧栏） */
body::after{
  content:"";position:fixed;inset:0;z-index:-2;pointer-events:none;
  background-image:linear-gradient(to right,var(--yxq-art-veil-core) 0%,transparent 22%),
    radial-gradient(120% 95% at 50% 42%,
      var(--yxq-art-veil-core) 0%, var(--yxq-art-veil-mid) 55%, var(--yxq-art-veil-edge) 100%),
    var(--yxq-art-image);
  background-size:100% 100%,100% 100%,cover;
  background-position:center,center,var(--yxq-art-position);
  background-repeat:no-repeat,no-repeat,no-repeat;
  background-attachment:fixed,fixed,fixed}

/* 边饰：原图经**四边带遮罩**只在画面四周显现，中心留白。
   这就是 v1.0.0 的观感 —— 一整幅画在边缘自然收进去，而不是贴一个人物上去。
   三条线性渐变按遮罩默认的 add（并集）合成：右侧一整条 + 上下两条 +
   左侧极窄一抹；右侧加权是因为两张画的人物都在右边。 */
body::before{
  content:"";position:fixed;inset:0;z-index:-1;pointer-events:none;
  background-image:var(--yxq-art-image);
  background-repeat:no-repeat;
  background-size:cover;
  background-position:var(--yxq-art-position);
  opacity:var(--yxq-band-opacity);
  -webkit-mask-image:linear-gradient(to left,#000 0%,rgba(0,0,0,0) 32%),
    linear-gradient(to bottom,#000 0%,rgba(0,0,0,0) 17%,rgba(0,0,0,0) 83%,#000 100%),
    linear-gradient(to right,rgba(0,0,0,0.40) 0%,rgba(0,0,0,0) 11%);
  mask-image:linear-gradient(to left,#000 0%,rgba(0,0,0,0) 32%),
    linear-gradient(to bottom,#000 0%,rgba(0,0,0,0) 17%,rgba(0,0,0,0) 83%,#000 100%),
    linear-gradient(to right,rgba(0,0,0,0.40) 0%,rgba(0,0,0,0) 11%)}

/* ── 右侧对话定位横线（turn rail）─────────────────────────────────────
   DSH 把这排横线的颜色写死在两个 token 上，而且未激活态还额外被
   scaleX(.6) 缩到 12px，压在同样深的晕影上几乎看不见：
     .mark:before        { background: border-l4;  scaleX(.6) }
     .markUnloaded:before{ opacity:.6;             scaleX(.4) }
     .markActive:before  { background: label-primary; scaleX(1) }
   border-l4 已在 token 层提亮，这里再补一层更明确的颜色与宽度。

   选择器只用 **结构 + 后缀匹配**，不引用完整的哈希类名：
   [class*="_marks"] 在全库里唯一命中这排横线的容器
   （_mark / _marker / _markdownPayload / _marks 之类都不会误伤），
   button 限定为按钮。哈希前缀随 DSH 版本变化也不影响命中；
   万一本地类名被改名，这几条规则就静默失效 —— 只影响观感，不会坏界面。

   刻意保留"当前 / 预览 / 历史"三档的宽度差异（1 / .9 / .75），
   只提亮、加宽一点点，不把它们抹平。 */
[class*="_marks"] button:before{
  background:var(--yxq-rail-mark);
  transform:translateY(-50%) scaleX(.75)}
[class*="_marks"] button[class*="markUnloaded"]:before{
  opacity:.85;
  transform:translateY(-50%) scaleX(.55)}
[class*="_marks"] button[class*="markPreview"]:before{
  background:var(--yxq-rail-preview);
  opacity:1;
  transform:translateY(-50%) scaleX(.9)}
[class*="_marks"] button[class*="markActive"]:before{
  background:var(--yxq-rail-active);
  transform:translateY(-50%) scaleX(1)}

.yxq-stack{display:flex;flex-direction:column;gap:14px;padding:2px 0 8px}
.yxq-row{display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:32px}
.yxq-row__text{display:flex;flex-direction:column;gap:3px;min-width:0}
.yxq-row__title{color:var(--dsw-alias-label-primary);font-size:14px;line-height:20px}
.yxq-row__hint{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}

.yxq-switch{position:relative;flex:none;box-sizing:border-box;width:40px;height:22px;padding:0;
  border:.5px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-layer-2);
  cursor:pointer;transition:background-color .18s ease,border-color .18s ease}
.yxq-switch:hover{border-color:var(--dsw-alias-border-l3)}
.yxq-switch:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:2px}
.yxq-switch[aria-checked="true"]{border-color:transparent;
  background-image:linear-gradient(135deg,var(--yxq-accent),var(--dsw-alias-brand-primary))}
.yxq-switch__thumb{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;
  background:var(--dsw-alias-switch-thumb,#fff);box-shadow:0 1px 2px rgba(0,0,0,.20);
  transition:transform .18s ease}
.yxq-switch[aria-checked="true"] .yxq-switch__thumb{transform:translateX(18px)}

.yxq-seg{display:inline-flex;padding:2px;gap:2px;border:.5px solid var(--dsw-alias-border-l2);
  border-radius:var(--dsw-radius-sm,8px);background:var(--dsw-alias-bg-layer-2)}
.yxq-seg__item{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary);
  font:inherit;font-size:13px;line-height:18px;padding:5px 12px;border-radius:6px;cursor:pointer;
  transition:background-color .16s ease,color .16s ease}
.yxq-seg__item:hover{color:var(--dsw-alias-label-primary)}
.yxq-seg__item[aria-pressed="true"]{color:var(--dsw-alias-label-primary);
  background:var(--dsw-alias-bg-layer-1);box-shadow:0 0 0 .5px var(--dsw-alias-border-l2)}
.yxq-seg__item:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:1px}

.yxq-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
.yxq-card{position:relative;display:flex;flex-direction:column;gap:0;padding:0;overflow:hidden;
  border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md,12px);
  background:var(--dsw-alias-settings-card-fill,var(--dsw-alias-bg-layer-2));cursor:pointer;text-align:left;
  font:inherit;transition:border-color .16s ease,box-shadow .16s ease}
.yxq-card:hover{border-color:var(--dsw-alias-border-l3)}
.yxq-card:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:2px}
.yxq-card[aria-pressed="true"]{border-color:var(--yxq-accent);
  box-shadow:0 0 0 1px var(--yxq-accent),0 0 0 5px var(--yxq-accent-soft)}
.yxq-card__art{position:relative;aspect-ratio:16/9;overflow:hidden;background:var(--dsw-alias-bg-layer-2)}
.yxq-card__art img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}
/* 国风细线：卡片底边一条主题色渐变发丝线 */
.yxq-card__art::after{content:"";position:absolute;left:0;right:0;bottom:0;height:2px;
  background-image:linear-gradient(90deg,transparent,var(--yxq-accent),transparent);
  opacity:.9;pointer-events:none}
.yxq-card__body{display:flex;flex-direction:column;gap:3px;padding:10px 12px 12px}
.yxq-card__name{color:var(--dsw-alias-label-primary);font-size:14px;line-height:20px}
.yxq-card__desc{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.yxq-card__mark{position:absolute;top:8px;right:8px;width:18px;height:18px;border-radius:50%;
  display:flex;align-items:center;justify-content:center;font-size:12px;line-height:1;
  color:var(--dsw-alias-label-primary);background:var(--yxq-accent-soft);
  border:.5px solid var(--yxq-accent);opacity:0;transition:opacity .16s ease}
.yxq-card[aria-pressed="true"] .yxq-card__mark{opacity:1}

.yxq-section{display:flex;flex-direction:column;gap:8px;padding-top:14px;
  border-top:.5px solid var(--dsw-alias-border-l1)}
.yxq-section__title{color:var(--dsw-alias-label-primary);font-size:13px;line-height:18px;font-weight:600}
.yxq-note{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.yxq-ghost{appearance:none;border:.5px solid var(--dsw-alias-border-l2);background:transparent;
  color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;padding:5px 12px;
  border-radius:var(--dsw-radius-sm,8px);cursor:pointer;transition:color .16s ease,border-color .16s ease}
.yxq-ghost:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l3)}
.yxq-ghost:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:2px}
.yxq-disabled{opacity:.5;pointer-events:none}
`;
      }

      /**
       * 皮肤装饰层：字体、选区、滚动条、焦点态。
       *
       * 刻意只使用通用元素与伪元素选择器 —— 不引用任何 DSH 内部类名，
       * 因此 DSH 升版最多让装饰退化，不会让界面坏掉。
       */
      function decorCss(skin, state, assetBase) {
        const parts = [];

        // ── 字体 ──
        // 随包发布的是子集化后的 TTF（24.6 MB -> 3.62 MB，覆盖 GB2312 全集 +
        // 拉丁 + 标点 + 常用符号）；集合外的字符由字体栈末尾的系统字体承接。
        // `.woff2` 是可选优化产物，存在时优先，缺失时浏览器自动落到 ttf。
        if (state.font === "wenkai") {
          parts.push(`
@font-face{
  font-family:"${WENKAI_FAMILY}";
  font-style:normal;
  font-weight:400;
  font-display:swap;
  src:url("${assetBase}LXGWWenKaiGB-Regular.subset.woff2") format("woff2"),
      url("${assetBase}LXGWWenKaiGB-Regular.subset.ttf") format("truetype");
}`);
        }

        // ── 选区 / 滚动条：主题色系渐变 ──
        parts.push(`
::selection{background:var(--dsw-alias-bg-document-selection);color:var(--dsw-alias-label-primary)}
*::-webkit-scrollbar-thumb{
  background-image:linear-gradient(180deg,var(--yxq-accent),var(--dsw-alias-brand-primary));
  background-clip:padding-box;border-radius:999px}
*::-webkit-scrollbar-thumb:hover{
  background-image:linear-gradient(180deg,var(--dsw-alias-brand-primary),var(--yxq-accent))}
*::-webkit-scrollbar-track{background:transparent}`);

        // ── 输入框 / 可编辑区的焦点态：淡金描边 + 柔和外环 ──
        parts.push(`
input:focus-visible,textarea:focus-visible,select:focus-visible,
[contenteditable="true"]:focus-visible,[contenteditable=""]:focus-visible{
  border-color:var(--yxq-accent) !important;
  box-shadow:0 0 0 1px var(--yxq-accent),0 0 0 4px var(--yxq-accent-soft) !important;
  outline:none !important}`);

        return parts.join("\n");
      }

      // ══════════════════════════════════════════════════════════════════
      // 机制 3：皮肤互斥
      // ══════════════════════════════════════════════════════════════════

      /** 我们自己，必须排除 —— 包名里也有 "skin"。 */
      const SELF_MODULE = PACKAGE_NAME;
      /** 我们的 Loader 行 id（cordis.patch.yml 的 id）。 */
      const SELF_ROW_ID = "yexueqing-skin";
      /** 双重自我排除：包名精确匹配，或 entryId 命中我们的行 id。 */
      const isSelf = (name, entryId) => name === SELF_MODULE || entryId.includes(SELF_ROW_ID);

      /**
       * 判定某一行是不是"另一个皮肤"。
       *
       * 刻意只匹配 `skin` / `皮肤`，**不匹配 `theme`**：主题类插件（例如官方的
       * dsh-official-homepage-theme，只作用于首页 canvas）与本皮肤没有 token
       * 冲突，不该被我们关掉。宁可少关，不可误关。
       */
      const SKIN_ROW_PATTERN = /skin|皮肤/i;

      /**
       * 互斥：开启本皮肤时自动关闭检测到的其他皮肤插件；关闭本皮肤时原样恢复。
       *
       * 走的是 DSH 官方 Web UI 自己那条 Remote ——
       * `ctx.remote.pluginManager.setPluginEnabled(entryId, enabled)`
       * （dsh-client-ui-plugin-manager 的 lib/client.js 就是这么切换插件开关的）。
       * 因此这里既不写 profile 文件、也不需要审批：它与用户在「插件」页手动
       * 点一下开关走的是**同一条**官方路径。
       */
      async function reconcileSkins(ctx, next) {
        const remote = typeof ctx.get === "function" ? ctx.get("remote") : undefined;
        const manager = remote === undefined ? undefined : remote.pluginManager;
        if (manager === undefined || typeof manager.setPluginEnabled !== "function") {
          // 没有 Remote 的部署（无 Web 载体）：静默跳过，皮肤本身照常工作。
          return;
        }

        const rows = await manager.listPlugins();
        if (!Array.isArray(rows)) return;

        const remembered = next.disabledRows;

        // 皮肤关掉、或用户关掉了独占开关 → 把我们关过的恢复回去。
        if (!next.enabled || !next.exclusive) {
          if (remembered.length === 0) return;
          for (const entryId of remembered) {
            try {
              await manager.setPluginEnabled(entryId, true);
            } catch (error) {
              console.warn(`[yexueqing-skin] 恢复插件 ${entryId} 失败`, error);
            }
          }
          store.set({ disabledRows: [] });
          return;
        }

        const stillDisabled = [];
        for (const row of rows) {
          const name = String(row?.moduleName ?? "");
          const entryId = String(row?.entryId ?? "");
          if (isSelf(name, entryId)) continue;
          if (!SKIN_ROW_PATTERN.test(name) && !SKIN_ROW_PATTERN.test(entryId)) continue;

          if (remembered.includes(entryId)) {
            // 之前被我们关掉的：保持关闭并继续记着。
            stillDisabled.push(entryId);
            continue;
          }
          if (row.enabled !== true) continue;

          try {
            const result = await manager.setPluginEnabled(entryId, false);
            if (result?.changed === true) {
              stillDisabled.push(entryId);
              console.info(`[yexueqing-skin] 已自动关闭冲突皮肤：${entryId}`);
            }
          } catch (error) {
            console.warn(`[yexueqing-skin] 关闭冲突皮肤 ${entryId} 失败`, error);
          }
        }

        if (JSON.stringify(stillDisabled) !== JSON.stringify(remembered)) {
          store.set({ disabledRows: stillDisabled });
        }
      }

      // ══════════════════════════════════════════════════════════════════
      // UI 组件
      // ══════════════════════════════════════════════════════════════════

      /**
       * 开关。语义与键盘行为对齐宿主原生开关：
       * role="switch" + aria-checked，button 自带焦点环。
       */
      function Switch({ checked, onChange, label }) {
        return h(
          "button",
          {
            type: "button",
            className: "yxq-switch",
            role: "switch",
            "aria-checked": checked ? "true" : "false",
            "aria-label": label,
            onClick: () => onChange(!checked),
          },
          h("span", { className: "yxq-switch__thumb" }),
        );
      }

      /** 设置行：左侧标题 + 说明，右侧控件。 */
      function Row({ title, hint, children }) {
        return h(
          "div",
          { className: "yxq-row" },
          h(
            "div",
            { className: "yxq-row__text" },
            h("div", { className: "yxq-row__title" }, title),
            hint ? h("div", { className: "yxq-row__hint" }, hint) : null,
          ),
          children,
        );
      }

      /** 分段选择器（字体选项、立绘档位）。 */
      function Segmented({ value, options, onChange }) {
        return h(
          "div",
          { className: "yxq-seg", role: "group" },
          options.map((option) =>
            h(
              "button",
              {
                key: option.value,
                type: "button",
                className: "yxq-seg__item",
                "aria-pressed": value === option.value ? "true" : "false",
                onClick: () => onChange(option.value),
              },
              option.label,
            ),
          ),
        );
      }

      /**
       * 皮肤变体卡片：原图缩略 + 名称 + 一句描述。
       *
       * 用原图而非单独的缩略图：缩略图需要额外的构建步骤，而设置页同时只会
       * 显示两个变体，浏览器对同一 URL 只取一次。
       */
      function SkinCard({ skin, active, t, onSelect }) {
        return h(
          "button",
          {
            type: "button",
            className: "yxq-card",
            "aria-pressed": active ? "true" : "false",
            onClick: () => onSelect(skin.id),
          },
          h(
            "span",
            { className: "yxq-card__art" },
            h("img", {
              src: `${ASSET_BASE}${skin.art}`,
              alt: "",
              loading: "lazy",
              decoding: "async",
            }),
          ),
          h("span", { className: "yxq-card__mark", "aria-hidden": "true" }, "✓"),
          h(
            "span",
            { className: "yxq-card__body" },
            h("span", { className: "yxq-card__name" }, t(`skin.${skin.id}.name`)),
            h("span", { className: "yxq-card__desc" }, t(`skin.${skin.id}.desc`)),
          ),
        );
      }


      // ══════════════════════════════════════════════════════════════════
      // 装配
      // ══════════════════════════════════════════════════════════════════

      return {
        // 硬依赖：slots（贡献 UI）、theme（token 覆盖层）、locale（文案）。
        inject: ["slots", "theme", "locale"],

        apply(ctx) {
          const t = ctx.locale.bind(LOCALE_NS);
          const assetBase = ASSET_BASE;

          // ── 1. 文案注册 ──
          ctx.effect(
            () =>
              ctx.locale.register(LOCALE_NS, {
                zh: {
                  "appearance.title": "外观皮肤",
                  "appearance.hint": "启用后全界面切换到叶雪青主题",
                  "section.title": "叶雪青主题",
                  "section.subtitle": "逆水寒 · 叶雪青主题皮肤",
                  "section.master": "叶雪青主题",
                  "section.masterHint": "关闭后完全回到 DSH 原生外观",
                  "section.skin": "皮肤变体",
                  "section.skinHint": "每张立绘一套独立配色",
                  "section.font": "界面字体",
                  "section.fontHint": "换到本皮肤时默认使用霞鹜文楷GB",
                  "section.fontWenkai": "霞鹜文楷GB",
                  "section.fontSystem": "默认字体",
                  "section.artLevel": "画面强度",
                  "section.artLevelHint": "原图被压暗做底衬，抠图压在其上因此更醒目",
                  "section.artOff": "关闭",
                  "section.artSoft": "弱",
                  "section.artMedium": "中",
                  "section.artStrong": "强",
                  "section.exclusive": "独占皮肤",
                  "section.exclusiveHint":
                    "开启时自动关闭检测到的其他皮肤插件，关闭本皮肤时原样恢复",
                  "section.exclusiveDone": (n) => `已自动关闭 ${n} 个冲突皮肤`,
                  "section.reset": "恢复默认",
                  "section.footer":
                    "画面位于全部内容之下，因此任何文字都在图片之上。以 token 覆盖层实现，关闭后完全回到默认界面。",
                  "skin.spring.name": "春庭藤影",
                  "skin.spring.desc": "日光回廊 · 紫藤垂落 · 淡青与藕荷",
                  "skin.snow.name": "雪霁寒江",
                  "skin.snow.desc": "雪后寒江 · 远山楼阁 · 霜蓝与淡金",
                },
                en: {
                  "appearance.title": "Appearance skin",
                  "appearance.hint": "Switch the whole UI to the Ye Xueqing theme",
                  "section.title": "Ye Xueqing Theme",
                  "section.subtitle": "Justice Online · Ye Xueqing theme skin",
                  "section.master": "Ye Xueqing theme",
                  "section.masterHint": "Turn off to return fully to the default DSH look",
                  "section.skin": "Skin variant",
                  "section.skinHint": "One independent palette per artwork",
                  "section.font": "Interface font",
                  "section.fontHint": "LXGW WenKai GB is the default for this skin",
                  "section.fontWenkai": "LXGW WenKai GB",
                  "section.fontSystem": "Default font",
                  "section.artLevel": "Artwork strength",
                  "section.artLevelHint":
                    "The original is dimmed as a backdrop, so the cut-outs on top stand out",
                  "section.artOff": "Off",
                  "section.artSoft": "Soft",
                  "section.artMedium": "Medium",
                  "section.artStrong": "Strong",
                  "section.exclusive": "Exclusive skin",
                  "section.exclusiveHint":
                    "Disables any other detected skin plugin while this one is on, and restores it when switched off",
                  "section.exclusiveDone": (n) => `Auto-disabled ${n} conflicting skin(s)`,
                  "section.reset": "Reset to defaults",
                  "section.footer":
                    "The artwork sits below all content, so every piece of text is above every image. Implemented as a token layer; switching it off returns the UI to the default.",
                  "skin.spring.name": "Wisteria Courtyard",
                  "skin.spring.desc": "Sunlit veranda · wisteria · celadon and lotus pink",
                  "skin.snow.name": "Snow on the Cold River",
                  "skin.snow.desc": "Snow, distant pavilions · frost blue and pale gold",
                },
              }),
            "yexueqing-skin: 文案",
          );

          // ── 2. 插件自身控件样式 + 画面三层（一次插入，随插件卸载移除）──
          ctx.effect(() => insertStyle(uiCss()), "yexueqing-skin: 控件样式与画面层");


          // ── 3. 皮肤本体：token 层 + 装饰样式表 ──
          // 两者都随 store 变化整体重建 —— 这是"同一 source 替换整层"的
          // 官方语义，也是变体切换不残留的关键。
          //
          // 清理必须覆盖**当前活着的那一层**：effect 返回的 cleanup 里既要退订
          // store，也要把已经建好的 token 层与样式表拆掉，否则插件卸载后会
          // 留下一层 token 覆盖和一张样式表。
          ctx.effect(() => {
            let disposeLayer = null;
            let disposeDecor = null;
            /** 我们自己那次 overrideTokens 调用之后的 revision。 */
            let stackedRevision = -1;
            /** 防重入：stackLayer 内部会同步 emit theme/change。 */
            let stacking = false;
            /** 抢栈限流：检测到与其他插件互相抢栈时主动退出，避免活锁。 */
            let restackCount = 0;
            let restackWindowStart = 0;

            /**
             * 建立/重建本插件的 token 覆盖层。
             *
             * 防重入标志覆盖**整个**调用，包括 overrideTokens 内部同步 emit
             * 的那次 theme/change：否则 sync → stackLayer → emit → 监听器 →
             * stackLayer 会递归下去。真实实现里 overrideTokens 会同步发
             * theme/change（ui-theme 的 publish()），所以这不是假想问题。
             */
            const stackLayer = (next) => {
              stacking = true;
              try {
                if (disposeLayer !== null) {
                  disposeLayer();
                  disposeLayer = null;
                }
                if (!next.enabled) {
                  stackedRevision = -1;
                  return;
                }
                const skin = skinById(next.skin);
                disposeLayer = ctx.theme.overrideTokens(
                  THEME_LAYER,
                  composeTokens(skin, next, assetBase),
                );
                stackedRevision = ctx.theme.getTheme().revision;
              } finally {
                stacking = false;
              }
            };

            const teardown = () => {
              if (disposeLayer !== null) {
                disposeLayer();
                disposeLayer = null;
              }
              if (disposeDecor !== null) {
                disposeDecor();
                disposeDecor = null;
              }
            };

            const sync = (next) => {
              teardown();
              if (!next.enabled) return;
              stackLayer(next);
              disposeDecor = insertStyle(decorCss(skinById(next.skin), next, assetBase));
            };

            sync(store.get());
            const unsubscribe = store.subscribe(sync);

            // ── 互斥：让本层始终待在覆盖栈顶 ──
            // overrideTokens 的 seq 单调递增，"再次调用同一 source" 会把该层
            // 整体替换并重新压到最顶 —— 官方为"重新取回优先级"提供的语义。
            //
            // 刻意**不用** `!important` 去抢优先级：ui-theme 明确文档化了若干
            // **局部重绑**的 token（高层级表面把 --dsh-scrollbar-thumb 重绑为 l2、
            // 菜单材质重绑 --dsw-elevation-stroke-color）。!important 会把这类
            // 有意为之的局部重绑一并压平，破坏菜单与浮层的材质。
            ctx.on("theme/change", (snapshot) => {
              if (stacking) return;
              const next = store.get();
              if (!next.enabled) return;
              if (snapshot.revision === stackedRevision) return;

              const now = Date.now();
              if (now - restackWindowStart > 2000) {
                restackWindowStart = now;
                restackCount = 0;
              }
              if (restackCount >= 5) return;
              restackCount++;

              stackLayer(next);
            });

            return () => {
              unsubscribe();
              teardown();
            };
          }, "yexueqing-skin: token 层与装饰样式表");

          // ── 4. 互斥：自动关闭检测到的其他皮肤插件 ──
          ctx.effect(() => {
            let lastKey = null;
            const run = (next) => {
              const key = `${next.enabled}|${next.exclusive}`;
              if (key === lastKey) return;
              lastKey = key;
              void reconcileSkins(ctx, next).catch((error) => {
                console.warn("[yexueqing-skin] 皮肤互斥检查失败", error);
              });
            };
            run(store.get());
            return store.subscribe(run);
          }, "yexueqing-skin: 皮肤互斥");

          // ── 5. 设置 → 通用 → 外观皮肤：一个开关 ──
          // settings.general.item 的行只负责自己画内部，宿主不给任何 props，
          // 文案、当前值与写入路径全由本组件自己负责。
          ctx.slots.inject("settings.general.item", () =>
            ctx.slots.register(
              { name: "settings.general.item", id: "yexueqing-appearance", order: 19 },
              function YeXueQingAppearanceRow() {
                useLocaleTick(ctx);
                const current = useSkinState();
                return h(Row, {
                  title: t("appearance.title"),
                  hint: t("appearance.hint"),
                  children: h(Switch, {
                    checked: current.enabled,
                    label: t("appearance.title"),
                    onChange: (enabled) => store.set({ enabled }),
                  }),
                });
              },
            ),
          );

          // ── 6. 设置 → 叶雪青：完整皮肤页 ──
          ctx.slots.inject("settings.section", () =>
            ctx.slots.register(
              {
                name: "settings.section",
                id: "yexueqing",
                order: 41,
                // thunk：外壳每次投影都重新读取，因此文案自动跟随语言切换。
                label: () => t("section.title"),
              },
              function YeXueQingSettingsPage() {
                useLocaleTick(ctx);
                const current = useSkinState();
                const disabled = !current.enabled;

                return h(
                  "div",
                  { className: "yxq-stack" },
                  h(Row, {
                    title: t("section.master"),
                    hint: t("section.masterHint"),
                    children: h(Switch, {
                      checked: current.enabled,
                      label: t("section.master"),
                      onChange: (enabled) => store.set({ enabled }),
                    }),
                  }),

                  h(
                    "div",
                    { className: disabled ? "yxq-stack yxq-disabled" : "yxq-stack" },
                    h(
                      "div",
                      { className: "yxq-section" },
                      h("div", { className: "yxq-section__title" }, t("section.skin")),
                      h("div", { className: "yxq-note" }, t("section.skinHint")),
                      h(
                        "div",
                        { className: "yxq-cards" },
                        SKINS.map((skin) =>
                          h(SkinCard, {
                            key: skin.id,
                            skin,
                            t,
                            active: current.skin === skin.id,
                            onSelect: (skin) => store.set({ skin }),
                          }),
                        ),
                      ),
                    ),

                    h(
                      "div",
                      { className: "yxq-section" },
                      h(Row, {
                        title: t("section.font"),
                        hint: t("section.fontHint"),
                        children: h(Segmented, {
                          value: current.font,
                          onChange: (font) => store.set({ font }),
                          options: [
                            { value: "wenkai", label: t("section.fontWenkai") },
                            { value: "system", label: t("section.fontSystem") },
                          ],
                        }),
                      }),
                    ),

                    h(
                      "div",
                      { className: "yxq-section" },
                      h(Row, {
                        title: t("section.artLevel"),
                        hint: t("section.artLevelHint"),
                        children: h(Segmented, {
                          value: current.art,
                          onChange: (art) => store.set({ art }),
                          options: [
                            { value: "off", label: t("section.artOff") },
                            { value: "soft", label: t("section.artSoft") },
                            { value: "medium", label: t("section.artMedium") },
                            { value: "strong", label: t("section.artStrong") },
                          ],
                        }),
                      }),
                      h(Row, {
                        title: t("section.exclusive"),
                        hint: t("section.exclusiveHint"),
                        children: h(Switch, {
                          checked: current.exclusive,
                          label: t("section.exclusive"),
                          onChange: (exclusive) => store.set({ exclusive }),
                        }),
                      }),
                      current.disabledRows.length > 0
                        ? h(
                            "div",
                            { className: "yxq-row" },
                            h(
                              "div",
                              { className: "yxq-row__text" },
                              h(
                                "div",
                                { className: "yxq-note" },
                                t("section.exclusiveDone")(current.disabledRows.length),
                              ),
                            ),
                          )
                        : null,
                      h(
                        "div",
                        { className: "yxq-row" },
                        h(
                          "div",
                          { className: "yxq-row__text" },
                          h("div", { className: "yxq-note" }, t("section.footer")),
                        ),
                        h(
                          "button",
                          {
                            type: "button",
                            className: "yxq-ghost",
                            onClick: () => store.set(DEFAULT_STATE),
                          },
                          t("section.reset"),
                        ),
                      ),
                    ),
                  ),
                );
              },
            ),
          );
        },
      };
    },
  });
})();
