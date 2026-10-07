/**
 * 叶雪青主题皮肤 —— Client 半（浏览器 bundle）。
 *
 * 文件形态：`window.__ModuleLoader__.load({...})`，id 必须等于 package.json 的
 * package name。factory 是惰性的（只注册工厂，无模块副作用），因此插件在真正
 * 被使用之前什么都不运行 —— 这是 client-modules 的约定。
 *
 * ══════════════════════════════════════════════════════════════════════════
 * 架构：一个开关，两层机制，N 个皮肤
 * ══════════════════════════════════════════════════════════════════════════
 *
 *   ┌ 叶雪青主题（总开关，注册在 设置 → 通用 → 外观皮肤）
 *   │
 *   ├─ token 层  ctx.theme.overrideTokens(LAYER, tokens)
 *   │    每个皮肤为每个 token 提供 { light, dark } 一对值，因此皮肤
 *   │    自动跟随 DSH 原生的 浅色/深色/跟随系统，不需要自己管明暗状态。
 *   │    这是"叠在活动主题之上的一层覆盖"，不是独立主题 id —— 关掉开关
 *   │    这一层被整层移除，DSH 回到原生外观，默认皮肤零回归。
 *   │
 *   └─ 样式表层  insertStyle(css)（自建 <style data-plugin>）
 *        字体 @font-face、云纹动机（data URI）、立绘背景、插件自身控件样式。
 *        样式表随皮肤变体整体替换，因此不会残留上一个变体的规则。
 *
 * 新增皮肤 = 在下面 SKINS 里加一项（token 调色板 + 立绘文件名）
 *          + 在 locale 字典里加两条文案（name / desc）。
 *          不需要动任何机制代码。
 *
 * ══════════════════════════════════════════════════════════════════════════
 * 与 DSH 标准的对应（`cordis-plugin-development` skill）
 * ══════════════════════════════════════════════════════════════════════════
 *
 *  - 只通过 slot 贡献 UI：settings.general.item（开关行）
 *                        settings.section     （完整皮肤页）
 *  - 不 require 任何 `@deepseek-ai/dsh-client-*` 包：那些是别人的内部实现，
 *    会无预警变更；本插件只需要 React（平台模块表提供）与 ctx 服务。
 *  - 所有资源（styles 插入、slot 注册、locale 注册、theme 层）都经 ctx.effect
 *    注册并返回清理函数，卸载即完全还原。
 *  - 只使用 `--dsw-alias-*` 主题 token 与语义 token，不写死颜色（立绘与云纹
 *    属于 artwork，允许自带颜色）。
 *  - 样式只作用于通用元素/伪元素选择器（::selection、::-webkit-scrollbar-*、
 *    input:focus-visible …），不猜 DSH 的内部类名，因此 DSH 升版不会失效。
 */

/**
 * 素材路由前缀，必须与 index.js 的 DEFAULT_ASSET_BASE 一致。
 *
 * 外层 IIFE 只做一件事：让 package name 只有一个字面量。
 * loader 要求 `load({id})` 的 id 等于包名，而 <style> 的 `data-plugin`
 * 标记也要用同一个值，两处必须一致，因此提成常量。
 */
(function () {
  const PACKAGE_NAME = "dsh-yexueqing-skin";

  window.__ModuleLoader__.load({
    id: PACKAGE_NAME,
    factory(require) {
    const React = require("react");
    const h = React.createElement;

    // ════════════════════════════════════════════════════════════════════
    // 常量
    // ════════════════════════════════════════════════════════════════════

    const ASSET_BASE = "/plugins/yexueqing-skin/assets/";
    /** overrideTokens 的层标识：同一 source 重复调用会整体替换该层。 */
    const THEME_LAYER = "dsh-yexueqing-skin";
    /** 设置持久化键（浏览器本地，不写任何 profile 文件）。 */
    const STORAGE_KEY = "dsh-yexueqing-skin.state";
    const LOCALE_NS = "yexueqing-skin";
    /**
     * 立绘的**四边带**遮罩。
     *
     * 为什么需要它：装饰层渲染在 `shell.overlay`（内容之上），所以必须保证
     * 正文区完全干净。遮罩的多层默认以 `add`（并集）合成，于是三条渐变并起来
     * 就是"右边一整条带 + 上下两条带 + 左边极窄一抹"，中心完全透明。
     *
     * 右侧加权是刻意的：两张立绘的人物都在画面右侧，而左侧是侧栏（文字密集），
     * 所以强度放在右边，侧栏只吃到很淡的一层。
     *
     * 第一版用的是 `radial-gradient(120% 100% ...)` —— 椭圆半径超过视口，
     * 导致"透明区"覆盖整屏，立绘被整片遮掉（这正是"立绘没有显示"的原因）。
     * 矩形带没有这个问题。
     */
    const ART_BAND_MASK = [
      "linear-gradient(to left, #000 0%, rgba(0,0,0,0) 32%)",
      "linear-gradient(to bottom, #000 0%, rgba(0,0,0,0) 17%, rgba(0,0,0,0) 83%, #000 100%)",
      "linear-gradient(to right, rgba(0,0,0,0.40) 0%, rgba(0,0,0,0) 11%)",
    ].join(", ");

    /**
     * 立绘强度档位。`wash` 是整屏极淡的一层（给界面染上画面的气氛），
     * `band` 是四边带的强度（真正让人看见立绘）。
     */
    const ART_STRENGTHS = {
      soft: { wash: "0.08", band: "0.34" },
      medium: { wash: "0.12", band: "0.50" },
      strong: { wash: "0.18", band: "0.68" },
    };

    /** 字体族名，必须与 decorCss() 里 @font-face 的 family 完全一致。 */
    const WENKAI_FAMILY = "LXGW WenKai GB";
    /**
     * DSH 基础样式表里的原生 UI 字体栈（来自 ui-theme 的 base.css）。
     * 关掉字体开关时我们把 `--dsw-font-family` 从覆盖层里剔除，
     * 让 base.css 的原值生效 —— 因此这里只是文档用途，不参与注入。
     */
    const SYSTEM_FONT_STACK =
      '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Helvetica, Arial, sans-serif';
    const WENKAI_STACK = `"${WENKAI_FAMILY}", ${SYSTEM_FONT_STACK}`;

    // ════════════════════════════════════════════════════════════════════
    // 皮肤注册表 —— 唯一的扩展点
    // ════════════════════════════════════════════════════════════════════
    //
    // 语义 key 而不是直接写 DSH token 名：调色板可读、可复用，
    // 由下面的 TOKEN_MAP 统一映射到真实 token（见 composeTokens）。
    //
    // 每个皮肤取自一张立绘，两个变体各自独立设计：
    //
    //   spring  春庭藤影  ← 叶雪青.jpg
    //       日光明媚的木质回廊，紫藤垂落，新绿与淡青，
    //       白袍 + 藕荷色披帛 + 青色缘边。底色偏月白暖青，强调色取淡金（阳光）
    //       与藕粉（紫藤），主色取低饱和淡青 #A8C0B8。
    //
    //   snow    雪霁寒江  ← 叶雪青雪景.jpg
    //       雪后寒江、远山楼阁、素白花枝，
    //       白袍 + 深靛蓝腰带与金饰 + 霜紫内衬。底色偏月白冷蓝，
    //       强调色取淡金（腰饰）与霜紫（内衬），主色取偏蓝的淡青。
    //
    const SKINS = [
      {
        id: "spring",
        art: "skin-spring.jpg",
        thumb: "skin-spring.thumb.webp",
        /** 立绘对位（两张立绘的人物都在右侧）。 */
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
            border4: "#C6D6CB",
            cardFill: "#FFFFFF",
            cardStroke: "#D3E0D7",
            brand: "#5A8877",
            textPrimary: "#1F2925",
            textSecondary: "#4E5F57",
            error: "#B85F4C",
            idle: "#8A9C93",
            success: "#5C8C6E",
            warn: "#A9833F",
            focusRing: "#5A8877",
            scrollThumb: "#BCCDC2",
            scrollThumbHover: "#9FB8A9",
            selection: "rgba(140, 175, 158, 0.34)",
            switchThumb: "#FFFFFF",
            // 装饰用（非 DSH token，通过同一覆盖层下发，故同样自动跟随明暗）
            accent: "#B8933F",
            accentSoft: "rgba(184, 147, 63, 0.16)",
            elevationStroke: "rgba(90, 136, 119, 0.38)",
            artVeil:
              "linear-gradient(180deg, rgba(233,240,234,0.35) 0%, rgba(233,240,234,0.15) 45%, rgba(233,240,234,0.42) 100%)",
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
            border4: "#33473E",
            cardFill: "#18241F",
            cardStroke: "#2E4038",
            brand: "#A8C0B8",
            textPrimary: "#E9F1EC",
            textSecondary: "#A9BAB2",
            error: "#D08A79",
            idle: "#6F7E78",
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
            artVeil:
              "linear-gradient(180deg, rgba(13,21,19,0.30) 0%, rgba(13,21,19,0.12) 45%, rgba(13,21,19,0.38) 100%)",
          },
        },
      },
      {
        id: "snow",
        art: "skin-snow.jpg",
        thumb: "skin-snow.thumb.webp",
        /** 雪景构图人物在右侧偏上，花枝压在左上。 */
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
            border4: "#C3D1E0",
            cardFill: "#FFFFFF",
            cardStroke: "#D0DCE9",
            brand: "#51779E",
            textPrimary: "#1D2530",
            textSecondary: "#4B5866",
            error: "#B25E5E",
            idle: "#8494A5",
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
            artVeil:
              "linear-gradient(180deg, rgba(231,237,245,0.35) 0%, rgba(231,237,245,0.15) 45%, rgba(231,237,245,0.42) 100%)",
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
            border4: "#2C3846",
            cardFill: "#151E29",
            cardStroke: "#283646",
            brand: "#A9BED0",
            textPrimary: "#E7EDF5",
            textSecondary: "#A5B2C1",
            error: "#D08A8A",
            idle: "#6B7686",
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
            artVeil:
              "linear-gradient(180deg, rgba(11,17,25,0.30) 0%, rgba(11,17,25,0.12) 45%, rgba(11,17,25,0.38) 100%)",
          },
        },
      },
    ];

    /**
     * 语义 key -> DSH 主题 token 名。
     *
     * 前半段是 Theme 巡检报告要求「必须同时提供 light 与 dark」的 14 个别名 token；
     * 后半段是基础样式表中被组件实际消费的延伸别名（描边层级、设置卡材质、
     * 焦点环、滚动条、选区、开关滑块）。全部是真实存在的 DSH token，
     * 因此覆盖它们是受支持的扩展路径，而不是自造变量。
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
      textSecondary: "--dsw-alias-label-secondary",
      error: "--dsw-alias-state-error-primary",
      idle: "--dsw-alias-state-idle-primary",
      success: "--dsw-alias-state-success-primary",
      warn: "--dsw-alias-state-warn-primary",
      focusRing: "--dsw-focus-ring-color",
      scrollThumb: "--dsh-scrollbar-thumb",
      scrollThumbHover: "--dsh-scrollbar-thumb-hover",
      selection: "--dsw-alias-bg-document-selection",
      switchThumb: "--dsw-alias-switch-thumb",
    };

    /**
     * 装饰 token 映射。
     *
     * `--yxq-*` 是本插件自己的变量（不是 DSH token），但走同一个覆盖层下发，
     * 因此同样自动跟随明暗、同样随开关整层消失。
     *
     * `elevationStroke` 例外：它是 ui-theme 明确文档化的**可重绑** token
     * （`--dsw-elevation-stroke-color`，高层级表面用它画 0.5px 发丝描边），
     * 所以把面板描边染成主题色是受支持的做法，不需要猜任何内部类名。
     */
    const DECOR_TOKEN_MAP = {
      accent: "--yxq-accent",
      accentSoft: "--yxq-accent-soft",
      artVeil: "--yxq-art-veil",
      elevationStroke: "--dsw-elevation-stroke-color",
    };

    // ════════════════════════════════════════════════════════════════════
    // 状态：一个极小的订阅式存储
    // ════════════════════════════════════════════════════════════════════

    const DEFAULT_STATE = {
      /** 总开关：叶雪青主题 */
      enabled: true,
      /** 当前皮肤变体 id，取自 SKINS */
      skin: "spring",
      /** "wenkai" = 霞鹜文楷GB（换到本皮肤时默认） / "system" = 默认字体 */
      font: "wenkai",
      /** 立绘层：off | soft | medium | strong */
      art: "medium",
      /** 开启时自动关闭检测到的其他皮肤插件（互斥） */
      exclusive: true,
      /**
       * 由我们自动关闭的插件条目 id，用于关闭皮肤时原样恢复。
       * 这是我们对 profile 做过的唯一改动，必须记住才能撤销。
       */
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
      React.useEffect(
        () => ctx.on("locale/change", () => setTick((n) => n + 1)),
        [ctx],
      );
    }

    // ════════════════════════════════════════════════════════════════════
    // 机制 1：token 层
    // ════════════════════════════════════════════════════════════════════

    /**
     * `#RRGGBB` -> `rgba(r, g, b, alpha)`。
     * 立绘背景开启时把**抬升表面**转成半透明，让画面从面板下透出来；
     * 转换失败时原值返回 —— 宁可半透明失效，也不要产出无效颜色
     * 把整个 token 变成无效值。
     */
    function withAlpha(color, alpha) {
      const match = /^#([0-9a-f]{6})$/i.exec(color);
      if (match === null) return color;
      const n = Number.parseInt(match[1], 16);
      return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
    }

    /**
     * 把皮肤调色板编成 `overrideTokens` 需要的
     * `Record<token, { light, dark }>`。
     */
    function composeTokens(skin, state, assetBase) {
      const tokens = {};
      // 立绘档位（null = 关闭）。注意 `state.art` 是字符串，`if (state.art)`
      // 对 "off" 也是真 —— 必须先用档位表归一。
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

      // 立绘开启时让**抬升表面**半透明，画面从面板下透出。
      //
      // `bg-base` 刻意保持不透明：全仓有 12 处组件把它当背景用
      // （工具卡、会话根、侧栏、页面……），一旦带 alpha，嵌套容器会叠加出
      // 多层薄纱，卡片文字直接糊掉。而且它是画布的底，带 alpha 会让浏览器
      // canvas 底色从下面透出来。
      if (level !== null) {
        const glass = (hex, alpha) => (hex.startsWith("#") ? withAlpha(hex, alpha) : hex);
        for (const scheme of ["light", "dark"]) {
          const p = skin.palette[scheme];
          tokens["--dsw-alias-bg-layer-1"] = {
            ...tokens["--dsw-alias-bg-layer-1"],
            [scheme]: glass(p.layer1, 0.78),
          };
          tokens["--dsw-alias-bg-layer-2"] = {
            ...tokens["--dsw-alias-bg-layer-2"],
            [scheme]: glass(p.layer2, 0.84),
          };
          tokens["--dsw-specific-sidebar-fill"] = {
            ...tokens["--dsw-specific-sidebar-fill"],
            [scheme]: glass(p.sidebarFill, 0.66),
          };
        }
      }

      // 字体走同一个覆盖层：关掉时整个 token 从层里消失，
      // base.css 的原生 UI 字体栈自动生效 —— 这就是"切回默认字体"。
      if (state.font === "wenkai") {
        tokens["--dsw-font-family"] = { light: WENKAI_STACK, dark: WENKAI_STACK };
      }

      // 立绘的 URL / 对位 / 两层不透明度也由 token 下发，
      // 样式表因此不必知道 ASSET_BASE，也不必知道档位表。
      tokens["--yxq-art-image"] = {
        light: level === null ? "none" : `url("${assetBase}${skin.art}")`,
        dark: level === null ? "none" : `url("${assetBase}${skin.art}")`,
      };
      tokens["--yxq-art-position"] = { light: skin.artPosition, dark: skin.artPosition };
      tokens["--yxq-art-wash-opacity"] = {
        light: level === null ? "0" : level.wash,
        dark: level === null ? "0" : level.wash,
      };
      tokens["--yxq-art-band-opacity"] = {
        light: level === null ? "0" : level.band,
        dark: level === null ? "0" : level.band,
      };

      return tokens;
    }

    // ════════════════════════════════════════════════════════════════════
    // 机制 2：样式表（字体 + 云纹 + 立绘 + 插件自身控件）
    // ════════════════════════════════════════════════════════════════════

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

    /** 插件自身 UI 的样式（皮肤无关，只依赖 token）。 */
    function uiCss() {
      return `
/* ── 装饰层 ──────────────────────────────────────────────────────────
   注册在 shell.overlay：那是"横跨整帧、位于所有列之上、且在它们的滚动
   容器之外"的浮层，因此不会被应用根容器的不透明底色盖住。
   （应用根容器 .frame 用 background:var(--dsw-alias-bg-base) 铺满视口，
   挂在 body 背景上的图案会被它整片遮住 —— 这是实测结果。）

   注意：--dsw-alias-bg-base 不能被改成半透明。全仓有 12 处组件把它当
   背景用（工具卡、会话根、侧栏、页面……），一旦带 alpha，嵌套容器会
   叠加出多层薄纱，卡片文字直接糊掉。所以立绘只能走这个上层浮层。

   两层：
     __wash  整屏极淡，给界面染上画面的气氛
     __band  四边带 + 右侧加权，配合 ART_BAND_MASK 只在四周显现，
             中心（正文、列表、composer）完全透明
   层本身 pointer-events:none 且 order:-100（排在对话框/toast 之下）。 */
.yxq-decor{position:fixed;inset:0;pointer-events:none;overflow:hidden;z-index:0}
.yxq-decor__wash,.yxq-decor__band{position:absolute;inset:0;
  background-image:var(--yxq-art-veil),var(--yxq-art-image);
  background-repeat:no-repeat,no-repeat;
  background-size:cover,cover;
  background-position:var(--yxq-art-position),var(--yxq-art-position)}
.yxq-decor__wash{opacity:var(--yxq-art-wash-opacity)}
.yxq-decor__band{
  opacity:var(--yxq-art-band-opacity);
  -webkit-mask-image:${ART_BAND_MASK};
  mask-image:${ART_BAND_MASK}}

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
/* 国风细线：卡片底边一条主题色渐变发丝线（不再是重复的云纹贴图） */
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
     * 皮肤装饰层：字体、云纹、立绘背景，以及通用元素上的国风细节。
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

      // ── 画布云纹 ──
      // 刻意不存在。第一版把如意云头动机做成 72×32 的重复贴图铺满整帧，
      // 结果在界面上一眼看成一片"时钟"（规律排列的弧线）——用户明确不要。
      // 装饰需求改由 token 描边 + 焦点态线条 + 滚动条/选区渐变承担。

      // ── 选区 / 滚动条：主题色系渐变 ──
      parts.push(`
::selection{background:var(--dsw-alias-bg-document-selection);color:var(--dsw-alias-label-primary)}
*::-webkit-scrollbar-thumb{
  background-image:linear-gradient(180deg,var(--yxq-accent),var(--dsw-alias-brand-primary));
  background-clip:padding-box;border-radius:999px}
*::-webkit-scrollbar-thumb:hover{
  background-image:linear-gradient(180deg,var(--dsw-alias-brand-primary),var(--yxq-accent))}
*::-webkit-scrollbar-track{background:transparent}`);

      // ── 输入框 / 可编辑区的焦点态：淡金色描边 + 柔和外环 ──
      parts.push(`
input:focus-visible,textarea:focus-visible,select:focus-visible,
[contenteditable="true"]:focus-visible,[contenteditable=""]:focus-visible{
  border-color:var(--yxq-accent) !important;
  box-shadow:0 0 0 1px var(--yxq-accent),0 0 0 4px var(--yxq-accent-soft) !important;
  outline:none !important}`);

      return parts.join("\n");
    }

    // ════════════════════════════════════════════════════════════════════
    // 机制 3：皮肤互斥
    // ════════════════════════════════════════════════════════════════════

    /** 我们自己，必须排除 —— 包名里也有 "skin"。 */
    const SELF_MODULE = PACKAGE_NAME;
    /** 我们的 Loader 行 id（`cordis.patch.yml` 里的 id），entryId 形如 `include:yexueqing-skin`。 */
    const SELF_ROW_ID = "yexueqing-skin";
    /** 双重自我排除：包名精确匹配，或 entryId 命中我们的行 id。 */
    const isSelf = (name, entryId) => name === SELF_MODULE || entryId.includes(SELF_ROW_ID);

    /**
     * 判定某一行是不是"另一个皮肤"。
     *
     * 刻意只匹配 `skin` / `皮肤`，**不匹配 `theme`**：
     * 主题类插件（例如官方的 dsh-official-homepage-theme，只作用于首页 canvas）
     * 与本皮肤没有 token 冲突，不该被我们关掉。宁可少关，不可误关。
     */
    const SKIN_ROW_PATTERN = /skin|皮肤/i;

    /**
     * 互斥：开启本皮肤时自动关闭检测到的其他皮肤插件；关闭本皮肤时原样恢复。
     *
     * 走的是 DSH 官方 Web UI 自己那条 Remote ——
     * `ctx.remote.pluginManager.setPluginEnabled(entryId, enabled)`
     * （`dsh-client-ui-plugin-manager` 的 lib/client.js 就是这么切换插件开关的）。
     * 因此这里既不写 profile 文件、也不需要审批：它与用户在「插件」页手动
     * 点一下开关走的是**同一条**官方路径。
     *
     * 只关闭我们关掉过的行，并把它们的 entryId 记在状态里，关闭皮肤时逐一恢复，
     * 所以整个过程是可逆的、不破坏用户原有的插件选择。
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
          // 之前被我们关掉的：保持关闭并继续记着（用户可能手动又开了，尊重既定状态）。
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


    // ════════════════════════════════════════════════════════════════════
    // UI 组件
    // ════════════════════════════════════════════════════════════════════

    /**
     * 开关。语义与键盘行为对齐宿主原生开关：
     * role="switch" + aria-checked，Enter/Space 切换，button 自带焦点环。
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

    /**
     * 皮肤装饰层。
     *
     * 渲染进 `shell.overlay`（横跨整帧、位于所有列之上、在滚动容器之外），
     * 因此不受应用根容器不透明底色的遮挡。立绘的 URL、对位与两层不透明度
     * 全部来自 token 层，组件本身只决定"要不要这一层"。
     *
     * 两层顺序：整屏薄纱在下、四边带在上。
     */
    function SkinDecor() {
      const state = useSkinState();
      if (!state.enabled || state.art === "off") return null;
      return h(
        "div",
        { className: "yxq-decor", "aria-hidden": "true" },
        h("div", { className: "yxq-decor__wash" }),
        h("div", { className: "yxq-decor__band" }),
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

    /** 分段选择器（字体选项等）。 */
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

    /** 皮肤变体卡片：立绘缩略图 + 名称 + 一句描述。 */
    function SkinCard({ skin, active, t, onSelect }) {
      const thumb = `${ASSET_BASE}${skin.thumb}`;
      const fallback = `${ASSET_BASE}${skin.art}`;
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
          // 缩略图是可选优化产物；缺失时由 onError 回退到原始立绘。
          // 只换一次（dataset 标记）以免回退目标同样 404 时无限循环。
          h("img", {
            src: thumb,
            alt: "",
            loading: "lazy",
            decoding: "async",
            onError: (event) => {
              const node = event.currentTarget;
              if (node.dataset.yxqFallback === "1") return;
              node.dataset.yxqFallback = "1";
              node.src = fallback;
            },
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

    // ════════════════════════════════════════════════════════════════════
    // 装配
    // ════════════════════════════════════════════════════════════════════

    return {
      // 硬依赖：slots（贡献 UI）、theme（token 覆盖层）、locale（文案）。
      // 三者任一缺失时插件保持未激活，而不是抛错。
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
                "section.title": "叶雪青",
                "section.subtitle": "逆水寒 · 叶雪青主题皮肤",
                "section.master": "叶雪青主题",
                "section.masterHint": "关闭后完全回到 DSH 原生外观",
                "section.skin": "皮肤变体",
                "section.skinHint": "每张立绘一套独立配色",
                "section.font": "界面字体",
                "section.fontHint": "换到本皮肤时默认使用霞鹜文楷GB",
                "section.fontWenkai": "霞鹜文楷GB",
                "section.fontSystem": "默认字体",
                "section.artLevel": "立绘",
                "section.artLevelHint": "立绘只在画面四边显现，中心留白以免影响正文",
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
                  "皮肤以 token 层实现，开启时占据主题覆盖栈顶；关闭后完全回到默认界面，不残留任何样式。",
                "skin.spring.name": "春庭藤影",
                "skin.spring.desc": "日光回廊 · 紫藤垂落 · 淡青与藕荷",
                "skin.snow.name": "雪霁寒江",
                "skin.snow.desc": "雪后寒江 · 远山楼阁 · 霜蓝与淡金",
              },
              en: {
                "appearance.title": "Appearance skin",
                "appearance.hint": "Switch the whole UI to the Ye Xueqing theme",
                "section.title": "Ye Xueqing",
                "section.subtitle": "Justice Online · Ye Xueqing theme skin",
                "section.master": "Ye Xueqing theme",
                "section.masterHint": "Turn off to return fully to the default DSH look",
                "section.skin": "Skin variant",
                "section.skinHint": "One independent palette per artwork",
                "section.font": "Interface font",
                "section.fontHint": "LXGW WenKai GB is the default for this skin",
                "section.fontWenkai": "LXGW WenKai GB",
                "section.fontSystem": "Default font",
                "section.artLevel": "Artwork",
                "section.artLevelHint":
                  "The artwork shows only along the frame edges; the centre stays clear",
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
                  "Implemented as a token layer at the top of the override stack; switching it off returns the UI to the default with nothing left behind.",
                "skin.spring.name": "Wisteria Courtyard",
                "skin.spring.desc": "Sunlit veranda · wisteria · celadon and lotus pink",
                "skin.snow.name": "Snow on the Cold River",
                "skin.snow.desc": "Snow, distant pavilions · frost blue and pale gold",
              },
            }),
          "yexueqing-skin: 文案",
        );

        // ── 2. 插件自身控件样式（一次插入，随插件卸载移除）──
        ctx.effect(() => insertStyle(uiCss()), "yexueqing-skin: 控件样式");

        // ── 3. 皮肤本体：token 层 + 装饰样式表 ──
        // 两者都随 store 变化整体重建 —— 这是"同一 source 替换整层"的
        // 官方语义，也是变体切换不残留的关键。
        //
        // 清理必须覆盖**当前活着的那一层**：effect 返回的 cleanup 里既要退订
        // store，也要把已经建好的 token 层与样式表拆掉，否则插件卸载后
        // 会留下一层 token 覆盖和一张样式表（overrideTokens 的 disposer
        // 由调用方负责，Cordis 不会替我们回收）。
        ctx.effect(() => {
          let disposeLayer = null;
          let disposeDecor = null;
          /** 我们**自己**那次 overrideTokens 调用之后的 revision。 */
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
           * `theme/change`（ui-theme 的 publish()），所以这不是假想问题。
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
              disposeLayer = ctx.theme.overrideTokens(THEME_LAYER, composeTokens(skin, next, assetBase));
              // 记下本次调用后的 revision，用来识别"这是我们自己引发的变化"。
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
          // 整体替换并重新压到最顶 —— 这是官方为"重新取回优先级"提供的语义
          // （ui-theme 的 overrideTokens 文档）。因此在别人改动主题后重压一次，
          // 其他皮肤在同一 token 上就无法覆盖我们。
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

            // 抢栈限流：万一别的插件也监听 theme/change 重压栈，
            // 双方会互相顶到顶。限流让这种情况退化成低频抖动而不是活锁。
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

        // ── 4. 设置 → 通用 → 外观皮肤：一个开关 ──
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

        // ── 4. 互斥：自动关闭检测到的其他皮肤插件 ──
        // 只在 enabled / exclusive 真正翻转时跑一次，disabledRows 的写回
        // 不会再触发它（否则会白白反复列插件）。
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

        // ── 5. 装饰层：注册到 shell.overlay ──
        // 必须在内容之上的浮层里，否则会被应用根容器的不透明底色盖掉。
        // order 取负值：让装饰层排在 overlay 里所有其他条目的**下面**，
        // 这样对话框、提示等浮层仍然盖在皮肤之上，不会被立绘压住。
        ctx.slots.inject("shell.overlay", () =>
          ctx.slots.register(
            { name: "shell.overlay", id: "yexueqing-decor", order: -100 },
            SkinDecor,
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
                      h("div", { className: "yxq-row__text" }, h("div", { className: "yxq-note" }, t("section.footer"))),
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
