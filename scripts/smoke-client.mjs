/**
 * Client 半的冒烟测试。
 *
 * `client.js` 是浏览器产物（`window.__ModuleLoader__.load`），没有导出，
 * 因此这里用 `node:vm` 造一个最小的浏览器环境把它跑起来，再驱动
 * factory → apply，检查它到底向 DSH 注册了什么。
 *
 * 覆盖：
 *   1. bundle 以包名注册 factory，且 factory 无模块副作用
 *   2. 插件导出形式正确（inject 数组 + apply 函数）
 *   3. 两个皮肤变体各自产生完整的 token 覆盖层
 *   4. Theme 巡检要求「必须同时提供 light 与 dark」的 14 个 token 全部就位
 *   5. 每个皮肤的两套调色板 key 完全一致（新增皮肤时最容易漏的地方）
 *   6. 字体开关：只在 wenkai 时下发 --dsw-font-family；system 时不下发
 *   7. 立绘开关：bg-base 永远是 6 位 hex（不透明，防止画布透白）
 *   8. locale 字典覆盖 UI 里实际用到的每一个 t() key（zh 与 en 都覆盖）
 *   9. slot 注册落在 settings.general.item 与 settings.section
 *  10. 卸载：effect disposer 清掉样式表与 token 层
 *
 * 用法: node scripts/smoke-client.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const PACKAGE_NAME = "dsh-yexueqing-skin";
const CLIENT_SOURCE = readFileSync(
  fileURLToPath(new URL("../client.js", import.meta.url)),
  "utf8",
);

/**
 * 从 Client 源码里抽出真正的存储键。
 * 硬编码键名会在改版时静默失效（夹具写旧键 → 客户端读新键 → 所有用例
 * 退化成默认状态，看起来像功能坏了）。这里直接对齐源码，杜绝漂移。
 */
const STORAGE_KEY = /const STORAGE_KEY = "([^"]+)"/.exec(CLIENT_SOURCE)[1];

let failures = 0;
function check(name, condition, detail = "") {
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// ── 浏览器环境替身 ───────────────────────────────────────────────────────

/** 最小 React：只需让组件定义期不抛错，本测试不渲染。 */
const ReactStub = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
  useState: (initial) => [typeof initial === "function" ? initial() : initial, () => {}],
  useEffect: () => {},
  useReducer: (reducer, initial) => [initial, () => {}],
};

/** 记录所有创建出来的 <style>，用于断言插入与卸载。 */
function createDocument() {
  const styles = [];
  const head = {
    appendChild(node) {
      node.parentNode = head;
      styles.push(node);
    },
    removeChild(node) {
      node.parentNode = null;
      const i = styles.indexOf(node);
      if (i >= 0) styles.splice(i, 1);
    },
  };
  return {
    head,
    styles,
    createElement(tag) {
      return {
        tagName: tag,
        attributes: {},
        textContent: "",
        parentNode: null,
        setAttribute(name, value) {
          this.attributes[name] = value;
        },
        getAttribute(name) {
          return this.attributes[name] ?? null;
        },
      };
    },
  };
}

/**
 * 在沙箱里执行 client.js，返回 { factory, document, storage }。
 * 每次都新建上下文，因此两侧互不污染。
 */
function bootBundle({ persisted = null } = {}) {
  const document = createDocument();
  const storage = new Map();
  if (persisted !== null) storage.set(STORAGE_KEY, persisted);

  const window = {
    __ModuleLoader__: { load: (definition) => (window.__captured = definition) },
    localStorage: {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    },
  };

  const sandbox = {
    window,
    document,
    console,
    JSON,
    Object,
    Array,
    Number,
    String,
    Boolean,
    Math,
    RegExp,
    Set,
    Map,
    Error,
    Uint8Array,
    TextDecoder,
  };
  vm.runInNewContext(CLIENT_SOURCE, vm.createContext(sandbox), { filename: "client.js" });

  const definition = window.__captured;
  const factory = definition?.factory;
  return { definition, factory, document, storage };
}

/** 造一个能记录所有注册行为的 ctx 替身。 */
function makeCtx() {
  const record = {
    overrideTokens: [],
    register: [],
    locale: [],
    effects: [],
    injects: [],
    onEvents: [],
  };

  /** theme/change 的监听器，按注册顺序保存（模拟 Event 的 emit 顺序）。 */
  const listeners = [];
  /** 主题快照的 revision，覆盖层每次变化都前进（ui-theme 的 publish 语义）。 */
  let revision = 0;

  /** 忠实模拟：overrideTokens 会**同步** emit theme/change。 */
  const emitThemeChange = (nextRevision) => {
    let delivered = 0;
    for (const listener of [...listeners]) {
      delivered++;
      listener({ revision: nextRevision, preference: "dark", fontSize: 16 });
    }
    return delivered;
  };
  record.emitThemeChange = emitThemeChange;
  record.currentRevision = () => revision;

  const ctx = {
    effect(fn, label) {
      const dispose = fn();
      record.effects.push({ label, dispose });
      return dispose;
    },
    on(name, listener) {
      record.onEvents.push(name);
      if (name === "theme/change") listeners.push(listener);
      return () => {
        const i = listeners.indexOf(listener);
        if (i >= 0) listeners.splice(i, 1);
      };
    },
    slots: {
      inject(key, callback) {
        record.injects.push(key);
        const dispose = callback();
        return dispose;
      },
      register(options, Component) {
        record.register.push({ options, Component });
        return () => {};
      },
    },
    theme: {
      getTheme() {
        return { revision, preference: "dark", fontSize: 16 };
      },
      overrideTokens(source, tokens) {
        record.overrideTokens.push({ source, tokens });
        // 真实现会 recompose 快照并 emit，这里照做 —— 正是它考验防重入。
        revision += 1;
        emitThemeChange(revision);
        return () => {
          record.overrideTokens.push({ source, tokens, disposed: true });
        };
      },
    },
    locale: {
      bind: () => (key) => key,
      register(namespace, dicts) {
        record.locale.push({ namespace, dicts });
        return () => {};
      },
    },
  };

  return { ctx, record };
}

// ── 启动一次并 apply ─────────────────────────────────────────────────────

function applyWith(persisted) {
  const boot = bootBundle({ persisted });
  const require = (name) => {
    if (name === "react") return ReactStub;
    throw new Error(`未预期的 require("${name}")：静态包 Client 半只应 require react`);
  };
  const plugin = boot.factory(require);
  const { ctx, record } = makeCtx();
  plugin.apply(ctx);
  return { boot, plugin, record };
}

const REQUIRED_ALIAS_TOKENS = [
  "--dsw-alias-bg-base",
  "--dsw-alias-bg-layer-1",
  "--dsw-alias-bg-layer-2",
  "--dsw-alias-bg-overlay",
  "--dsw-alias-border-l1",
  "--dsw-alias-border-l2",
  "--dsw-alias-brand-primary",
  "--dsw-alias-label-primary",
  "--dsw-alias-state-error-primary",
  "--dsw-alias-state-success-primary",
  "--dsw-alias-state-warn-primary",
  "--dsw-specific-sidebar-fill",
];

/**
 * 信息保真：这两个 token 是 DSH 表达"次要 / 未激活"的层级，覆盖它们必然
 * 等于把权限、模型、标签这类高频检索目标调淡。需求是"固定 UI 文字不要变淡"，
 * 所以必须留给 base.css 原值 —— 这条断言禁止它们重新滑回覆盖层。
 */
const FORBIDDEN_TOKENS = [
  "--dsw-alias-label-secondary",
  "--dsw-alias-state-idle-primary",
];

console.log("\n[1] bundle 形态");
const boot = bootBundle();
check("以包名注册 factory", boot.definition?.id === PACKAGE_NAME, `id=${boot.definition?.id}`);
check("factory 是函数", typeof boot.factory === "function");
check("执行 bundle 不产生 <style>（无模块副作用）", boot.document.styles.length === 0);
check("执行 bundle 不写 localStorage", boot.storage.size === 0);

console.log("\n[2] 插件导出形式");
const springRun = applyWith(null);
// 持久化键必须带版本号：旧形状（art 曾是 boolean）里一个 art:false 会被
// 迁移成 "off"，画面永远不显示，且从界面上很难联想到是历史设置导致的。
check(
  "STORAGE_KEY 带版本号（作废历史状态，避免旧 art:false 被迁移成 off）",
  /dsh-yexueqing-skin\.state\.v\d+/.test(STORAGE_KEY),
  STORAGE_KEY,
);
check("inject 是数组", Array.isArray(springRun.plugin.inject));
check(
  "inject 声明 slots / theme / locale",
  ["slots", "theme", "locale"].every((k) => springRun.plugin.inject.includes(k)),
  springRun.plugin.inject.join(", "),
);
check("apply 是函数", typeof springRun.plugin.apply === "function");

console.log("\n[3] slot 注册");
check(
  "注册了 settings.general.item（开关行）",
  springRun.record.injects.includes("settings.general.item"),
);
check(
  "注册了 settings.section（皮肤页）",
  springRun.record.injects.includes("settings.section"),
);
// 画面不再占用任何 slot —— 它挂在 html 的背景与负 z-index 伪元素上，
// 结构上位于全部内容之下。占用 slot 必然盖住文字（上一版的错误）。
check(
  "没有占用内容之上的 slot（shell.overlay / sidebar / main / root）",
  !["shell.overlay", "sidebar", "main", "root"].some((k) =>
    springRun.record.injects.includes(k),
  ),
  springRun.record.injects.join(", "),
);
check("两个 slot 各注册一个条目", springRun.record.register.length === 2,
  `得到 ${springRun.record.register.length}`);
const section = springRun.record.register.find((r) => r.options.name === "settings.section");
check("皮肤页 id/order 正确", section?.options.id === "yexueqing" && section?.options.order === 41);
check("皮肤页 label 是 thunk（跟随语言切换）", typeof section?.options.label === "function");
const row = springRun.record.register.find((r) => r.options.name === "settings.general.item");
check("开关行 id 正确", row?.options.id === "yexueqing-appearance");
check("两个设置注册都是 React 组件", typeof row?.Component === "function" && typeof section?.Component === "function");

console.log("\n[4] token 层（春庭藤影 · 默认状态）");
const springLayer = springRun.record.overrideTokens[0];
check("层标识正确", springLayer?.source === "dsh-yexueqing-skin", springLayer?.source);
check("只注册一层", springRun.record.overrideTokens.length === 1);
for (const token of REQUIRED_ALIAS_TOKENS) {
  const entry = springLayer?.tokens[token];
  check(
    `${token} 同时提供 light 与 dark`,
    entry !== undefined && typeof entry.light === "string" && typeof entry.dark === "string",
    JSON.stringify(entry),
  );
}
check(
  "theme 覆盖层里的 token 全部是 {light,dark} 形状",
  Object.values(springLayer.tokens).every(
    (value) => value && typeof value.light === "string" && typeof value.dark === "string",
  ),
);

console.log("\n[5] 两个变体各自成层，且调色板 key 一致");
const snowRun = applyWith(JSON.stringify({ enabled: true, skin: "snow", font: "wenkai", art: "medium" }));
const snowLayer = snowRun.record.overrideTokens[0];
// 注意：不能用 bg-base 比较 —— 立绘开启时它被刻意置为 transparent（两个变体相同）。
// 用画布实底与抬升表面比较，它们才是承载皮肤配色的地方。
check("雪霁变体的画布实底与春庭不同",
  snowLayer.tokens["--yxq-base-solid"].light !== springLayer.tokens["--yxq-base-solid"].light,
  `${snowLayer.tokens["--yxq-base-solid"].light} vs ${springLayer.tokens["--yxq-base-solid"].light}`);
check("雪霁变体的抬升表面与春庭不同",
  snowLayer.tokens["--dsw-alias-bg-layer-1"].light !==
    springLayer.tokens["--dsw-alias-bg-layer-1"].light);
check("雪霁变体的 brand 与春庭不同",
  snowLayer.tokens["--dsw-alias-brand-primary"].dark !== springLayer.tokens["--dsw-alias-brand-primary"].dark);
check(
  "两套变体覆盖的 token 集合完全相同",
  JSON.stringify(Object.keys(springLayer.tokens).sort()) ===
    JSON.stringify(Object.keys(snowLayer.tokens).sort()),
);
check(
  "每个 token 的 light/dark 都不为空",
  Object.values(snowLayer.tokens).every((v) => v.light.length > 0 && v.dark.length > 0),
);
check(
  "两个变体各自指向自己的原图",
  String(springLayer.tokens["--yxq-art-image"].light).includes("skin-spring.jpg") &&
    String(snowLayer.tokens["--yxq-art-image"].light).includes("skin-snow.jpg"),
);

console.log("\n[5b] 信息保真：固定 UI 文字不被调淡");
for (const token of FORBIDDEN_TOKENS) {
  check(
    `没有覆盖 ${token}（留给 base.css 原值）`,
    springLayer.tokens[token] === undefined,
    JSON.stringify(springLayer.tokens[token]),
  );
}
check(
  "暗色主文字比 DSH 默认更亮（#fff 级别的对比）",
  springLayer.tokens["--dsw-alias-label-primary"].dark.toLowerCase() > "#e0e0e0",
  springLayer.tokens["--dsw-alias-label-primary"].dark,
);

console.log("\n[6] 字体开关");
check(
  "wenkai 时下发 --dsw-font-family",
  typeof springLayer.tokens["--dsw-font-family"]?.light === "string" &&
    springLayer.tokens["--dsw-font-family"].light.includes("LXGW WenKai GB"),
);
const systemFontRun = applyWith(
  JSON.stringify({ enabled: true, skin: "spring", font: "system", art: "medium" }),
);
check(
  "system 时**不下发** --dsw-font-family（回到 base.css 原生字体栈）",
  systemFontRun.record.overrideTokens[0].tokens["--dsw-font-family"] === undefined,
);

console.log("\n[7] 立绘开关、画布安全与「文字在图片之上」的机制");
// bg-base 透明是"画面能被看见"的前提：应用的大块容器全用它铺满。
check(
  "art 开启时 bg-base = transparent（否则画面被应用容器整片挡住）",
  springLayer.tokens["--dsw-alias-bg-base"].light === "transparent" &&
    springLayer.tokens["--dsw-alias-bg-base"].dark === "transparent",
  springLayer.tokens["--dsw-alias-bg-base"].light,
);
// 透明是嵌套安全的：transparent 与 transparent 复合仍是 transparent。
// 半透明会逐层叠加（0.85³ ≈ 99.7% 不透），画布在最里层直接消失。
check(
  "抬升表面保持不透明（承载文字的卡片要干净底）",
  /^#[0-9a-f]{6}$/i.test(springLayer.tokens["--dsw-alias-bg-layer-1"].light) &&
    /^#[0-9a-f]{6}$/i.test(springLayer.tokens["--dsw-alias-bg-layer-2"].light),
  `${springLayer.tokens["--dsw-alias-bg-layer-1"].light} / ${springLayer.tokens["--dsw-alias-bg-layer-2"].light}`,
);
check(
  "画布另有不透明实底 --yxq-base-solid（bg-base 透明后防 canvas 透白）",
  /^#[0-9a-f]{6}$/i.test(springLayer.tokens["--yxq-base-solid"].light) &&
    /^#[0-9a-f]{6}$/i.test(springLayer.tokens["--yxq-base-solid"].dark),
  springLayer.tokens["--yxq-base-solid"].dark,
);
check(
  "art 开启时下发原图 URL",
  String(springLayer.tokens["--yxq-art-image"].light).includes("skin-spring.jpg"),
  String(springLayer.tokens["--yxq-art-image"].light),
);
check(
  "不再下发任何抠图素材 token（最终版只需一张原图）",
  springLayer.tokens["--yxq-scene-image"] === undefined &&
    springLayer.tokens["--yxq-figure-image"] === undefined,
);
check(
  "medium 档下发边饰强度",
  springLayer.tokens["--yxq-band-opacity"].light === "0.78",
  springLayer.tokens["--yxq-band-opacity"].light,
);
check(
  "medium 档晕影 alpha 由档位算出（不是调色板里的死值）",
  // 底色按"画面中心区暗部"采样压暗（暖橄榄褐 #E4DFCE），alpha 也调轻了
  springLayer.tokens["--yxq-art-veil-core"].light === "rgba(228, 223, 206, 0.70)" &&
    springLayer.tokens["--yxq-art-veil-edge"].light === "rgba(228, 223, 206, 0.16)",
  `${springLayer.tokens["--yxq-art-veil-core"].light} / ${springLayer.tokens["--yxq-art-veil-edge"].light}`,
);
// 需求核心：抠图在晕影之上，所以晕影中心必须比四周厚（保护正文），
// 而抠图为高不透明度，从而"比原图更明显"。
check(
  "晕影中心比四周厚（正文区被压得更暗）",
  Number(springLayer.tokens["--yxq-art-veil-core"].light.match(/[\d.]+\)$/)[0].slice(0, -1)) >
    Number(springLayer.tokens["--yxq-art-veil-edge"].light.match(/[\d.]+\)$/)[0].slice(0, -1)),
);

const noArtRun = applyWith(
  JSON.stringify({ enabled: true, skin: "spring", font: "wenkai", art: "off" }),
);
check(
  'art 关闭（字符串 "off"）时原图为 none',
  noArtRun.record.overrideTokens[0].tokens["--yxq-art-image"].light === "none",
  noArtRun.record.overrideTokens[0].tokens["--yxq-art-image"].light,
);
check(
  "art 关闭时边饰强度为 0",
  noArtRun.record.overrideTokens[0].tokens["--yxq-band-opacity"].light === "0",
);
check(
  'art 关闭时 bg-base 恢复为不透明 hex（回归防线："off" 是字符串，别被当成真值）',
  /^#[0-9a-f]{6}$/i.test(noArtRun.record.overrideTokens[0].tokens["--dsw-alias-bg-base"].light),
  noArtRun.record.overrideTokens[0].tokens["--dsw-alias-bg-base"].light,
);

const strongRun = applyWith(
  JSON.stringify({ enabled: true, skin: "snow", font: "wenkai", art: "strong" }),
);
const strongLayer = strongRun.record.overrideTokens[0];
check(
  "strong 档抠图比 medium 更明显",
  Number(strongLayer.tokens["--yxq-band-opacity"].light) >
    Number(springLayer.tokens["--yxq-band-opacity"].light),
);
check(
  "strong 档晕影更薄（原图露得更多）",
  Number(strongLayer.tokens["--yxq-art-veil-core"].dark.match(/[\d.]+\)$/)[0].slice(0, -1)) <
    Number(springLayer.tokens["--yxq-art-veil-core"].dark.match(/[\d.]+\)$/)[0].slice(0, -1)),
);
const legacyArtRun = applyWith(
  JSON.stringify({ enabled: true, skin: "spring", font: "wenkai", art: true }),
);
check(
  "旧版 boolean art:true 平滑迁移到 medium",
  legacyArtRun.record.overrideTokens[0].tokens["--yxq-band-opacity"].light === "0.78",
);

console.log("\n[8] 关闭开关时零注册");
const offRun = applyWith(
  JSON.stringify({ enabled: false, skin: "spring", font: "wenkai", art: "medium" }),
);
check("关闭时不注册 token 层", offRun.record.overrideTokens.length === 0,
  `得到 ${offRun.record.overrideTokens.length}`);
check(
  "关闭时仍插入控件样式（设置页本身要能看）",
  offRun.boot.document.styles.some((s) => s.textContent.includes(".yxq-switch")),
);

console.log("\n[9] 样式表插入与卸载");
const allStyles = springRun.boot.document.styles.map((s) => s.textContent).join("\n");
check("插入了控件样式", allStyles.includes(".yxq-switch"));
check("插入了 @font-face", allStyles.includes("@font-face"));
check(
  "@font-face 指向子集字体",
  allStyles.includes("LXGWWenKaiGB-Regular.subset.ttf"),
  "检查 src 顺序",
);
check("插入了选区样式", allStyles.includes("::selection"));
check("插入了滚动条渐变", allStyles.includes("::-webkit-scrollbar-thumb"));
check("插入了输入框焦点态", allStyles.includes("focus-visible"));
check(
  "样式表带 data-plugin 标记（loader 认领 / HMR 清理）",
  springRun.boot.document.styles.every((s) => s.getAttribute("data-plugin") === PACKAGE_NAME),
);

console.log("\n[9b] 画面层：结构上位于全部内容之下（所有文字在图片之上）");
const decorStyles = springRun.boot.document.styles
  .map((s) => s.textContent)
  .filter((css) => css.includes("body::before") || css.includes("body::after"))
  .join("\n");

// 核心保证：画面挂在 html 的背景 + 负 z-index 伪元素上。
// 负 z-index 的伪元素绘制在「父元素背景之上、全部正常流内容之下」，
// 因此"文字在图片之上"由绘制顺序决定，而不是靠调不透明度。
check(
  "原图、晕影与左侧护罩同在 body::after 的背景层里（层序：护罩 → 晕影 → 原图）",
  /body::after\{[^}]*background-image:linear-gradient\(to right[^;]*radial-gradient[^;]*var\(--yxq-art-image\)/.test(
    decorStyles,
  ),
  (decorStyles.match(/body::after\{[^}]*background-image:[^;]*/) ?? [""])[0].slice(0, 140),
);
// 回归防线：Windows 标题栏模式下，全屏框架 .frame 的背景用的是
// sidebar-fill 而**不是** bg-base。只把 bg-base 改透明，框架依然不透明，
// 画面照样被整片挡住 —— 这一点是拿浏览器实测诊断确认的。
check(
  "art 开启时 sidebar-fill 也透明（.frame 用的是它，不只 bg-base）",
  springLayer.tokens["--dsw-specific-sidebar-fill"].dark === "transparent" &&
    springLayer.tokens["--dsw-specific-sidebar-fill"].light === "transparent",
  springLayer.tokens["--dsw-specific-sidebar-fill"].dark,
);
check(
  "html 与 body 都有不透明底色（bg-base 已透明，画布必须另有实底）",
  (decorStyles.match(/background-color:var\(--yxq-base-solid\)/g) ?? []).length >= 2,
);
check("晕影是 body::after", decorStyles.includes("body::after{"));
check("抠图是 body::before", decorStyles.includes("body::before{"));
check(
  "晕影在负层 z-index:-2",
  /body::after\{[^}]*z-index:-2/.test(decorStyles),
);
check(
  "抠图在负层 z-index:-1（因此位于晕影之上，不被压暗）",
  /body::before\{[^}]*z-index:-1/.test(decorStyles),
);
// 最终版回归单图观感：边饰层用的是**原图** + 四边带遮罩，
// 而不是把抠出的人物贴上去（抠图分层版保留在 git 标签 v1.1.0-cutouts）。
const bandRule = /body::before\{([^}]*)\}/.exec(decorStyles)?.[1] ?? "";
check(
  "边饰层用原图 + 四边带遮罩（三条线性渐变并集）",
  bandRule.includes("background-image:var(--yxq-art-image)") &&
    (bandRule.match(/linear-gradient\(to (left|right|bottom)/g) ?? []).length >= 3,
  bandRule.slice(0, 120),
);
check(
  "边饰层不再引用抠图素材",
  !decorStyles.includes("yxq-figure-image") && !decorStyles.includes("yxq-scene-image"),
);
check(
  "边饰层不透明度走 --yxq-band-opacity",
  bandRule.includes("opacity:var(--yxq-band-opacity)"),
);
check(
  "body 建立堆叠上下文 isolation:isolate（否则负层伪元素落在 body 背景之下）",
  /body\{[^}]*isolation:isolate/.test(decorStyles),
);
check("画面层不拦截交互", decorStyles.includes("pointer-events:none"));
// 右侧对话定位横线（turn rail）：颜色原先写死在 border-l4 上，
// 且未激活态被 scaleX(.6) 缩到 12px，压在深晕影上几乎看不见。
check(
  "turn rail 的历史横线读我们的颜色 token",
  /\[class\*="_marks"\] button:before\{[^}]*background:var\(--yxq-rail-mark\)/.test(decorStyles) ||
    /\[class\*="_marks"\] button:before\{[^}]*background:var\(--yxq-rail-mark\)/.test(decorStyles),
);
check(
  "turn rail 用结构 + 后缀选择器（不引用完整哈希类名）",
  decorStyles.includes('[class*="_marks"]') && !/\.xpvNua_|\.Dc7zOa_|\.cJsG2q_/.test(decorStyles),
);
check(
  "turn rail 保留当前/预览/历史三档宽度差异（只提亮不抹平）",
  (decorStyles.match(/scaleX\(\.75\)/) ?? []).length === 1 &&
    (decorStyles.match(/scaleX\(\.9\)/) ?? []).length === 1 &&
    (decorStyles.match(/scaleX\(1\)/) ?? []).length === 1,
);
check(
  "已加载但非当前的横线不再被额外压暗（只对 Unloaded 降透明）",
  /class\*="markUnloaded"[^}]*opacity:\.85/.test(decorStyles),
);
check(
  "rail 三色 token 已下发",
  ["--yxq-rail-mark", "--yxq-rail-active", "--yxq-rail-preview"].every(
    (token) => springLayer.tokens[token] !== undefined,
  ),
);
check(
  "rail 当前项与历史项颜色明显不同（对比度）",
  springLayer.tokens["--yxq-rail-active"].dark !== springLayer.tokens["--yxq-rail-mark"].dark,
);
// 主题注册表只有 34 个 token，而界面大量使用更细的层级。overrideTokens
// 允许任意名字（validateOverrides 只校验 {light,dark} 形状），因此这些
// 也能走同一层下发 —— 这正是"底部轮数行/标签页发灰看不清"的解法。
check(
  "下发注册表之外的细层级 token（label-tertiary / caption / dimmed / 按钮填色 / 悬停）",
  [
    "--dsw-alias-label-tertiary",
    "--dsw-alias-label-caption",
    "--dsw-alias-label-primary-dimmed",
    "--dsw-alias-button-elevated-fill",
    "--dsw-alias-interactive-bg-hover",
  ].every((token) => springLayer.tokens[token] !== undefined),
);
check(
  "label-tertiary 比主题默认更亮（固定 UI 只提亮、不变淡）",
  springLayer.tokens["--dsw-alias-label-tertiary"].dark === "#A8BDB2",
  springLayer.tokens["--dsw-alias-label-tertiary"].dark,
);
check(
  "「新对话」按钮改成贴画面的半透明填色（不再是原生灰）",
  String(springLayer.tokens["--dsw-alias-button-elevated-fill"].dark).startsWith("rgba("),
  springLayer.tokens["--dsw-alias-button-elevated-fill"].dark,
);
// 右侧对话横线（turn rail）里"历史对话条"用的是 border-l4，原来是近黑的深绿
check(
  "border-l4 提亮到能在画面上看清（turn rail 的历史对话条）",
  springLayer.tokens["--dsw-alias-border-l4"].dark === "#4E6A5C",
  springLayer.tokens["--dsw-alias-border-l4"].dark,
);

// 需求核心：抠图边缘要有渐入，把硬边与背后的原图衔接起来。
const cutoutRule = /body::before\{([^}]*)\}/.exec(decorStyles)?.[1] ?? "";
const DIRS = ["right", "left", "bottom", "top"];
function declaredValue(rule, property) {
  const i = rule.indexOf(`${property}:`);
  if (i === -1) return "";
  const end = rule.indexOf(";", i);
  return rule.slice(i, end === -1 ? rule.length : end);
}

// 回归防线：上一版把画面放进 shell.overlay（内容之上的浮层），直接盖住对话文字。
check(
  "不再注册 shell.overlay（那是内容之上的浮层，会盖住文字）",
  !springRun.record.injects.includes("shell.overlay"),
  springRun.record.injects.join(", "),
);
check("样式表里不再有 .yxq-decor 装饰层", !allStyles.includes(".yxq-decor"));

// 回归防线：第一版的云纹贴图在界面上看起来像一片时钟，用户明确不要。
check(
  "不再有铺满整帧的重复云纹贴图",
  !allStyles.includes("yxq-motif") && !allStyles.includes("background-repeat:repeat;"),
  "发现重复贴图动机",
);

console.log("\n[9c] 互斥：重压栈让本层始终在栈顶，且不靠 !important 抢 token");
// 危险的是**自定义属性**上的 !important（会压平 ui-theme 的局部重绑）；
// 组件属性（border-color / box-shadow / outline）上的 !important 是焦点态
// 所需，无害，因此只针对 `--*: ... !important` 断言。
const tokenImportant = allStyles.match(/--[a-zA-Z0-9-]+\s*:\s*[^;{}]*!important/g) ?? [];
check(
  "没有任何自定义属性用 !important 抢栈（避免压平局部重绑）",
  tokenImportant.length === 0,
  tokenImportant.slice(0, 3).join(" | "),
);
check("监听了 theme/change", springRun.record.onEvents.includes("theme/change"));

// 模拟"别人改动了主题"：revision 前进，我们的监听器应当重新压栈。
const layersBefore = springRun.record.overrideTokens.length;
const emitted = springRun.record.emitThemeChange(springRun.record.currentRevision() + 100);
check("theme/change 能派发到监听器", emitted > 0, `监听器数 ${emitted}`);
const stackedAfter = springRun.record.overrideTokens.length;
check("别人的主题变化后我们重新压栈", stackedAfter > layersBefore,
  `${layersBefore} -> ${stackedAfter}`);
check(
  "重压栈是有限的（防重入生效，没有递归风暴）",
  stackedAfter - layersBefore <= 2,
  `多出 ${stackedAfter - layersBefore} 次调用`,
);

// 我们自己引发的那次 theme/change（revision 未前进）绝不能再次触发压栈。
const beforeSelfTrigger = springRun.record.overrideTokens.length;
springRun.record.emitThemeChange(springRun.record.currentRevision());
check(
  "revision 未前进时不重复压栈（无自激循环）",
  springRun.record.overrideTokens.length === beforeSelfTrigger,
);

// 关闭开关后，主题变化不应再触发任何层。
offRun.record.emitThemeChange(5000);
check(
  "关闭开关后 theme/change 不再压栈",
  offRun.record.overrideTokens.length === 0,
  `得到 ${offRun.record.overrideTokens.length}`,
);

const beforeDispose = springRun.boot.document.styles.length;
for (const { dispose } of springRun.record.effects) {
  if (typeof dispose === "function") dispose();
}
check("effect disposer 移除全部样式表", springRun.boot.document.styles.length === 0,
  `${beforeDispose} -> ${springRun.boot.document.styles.length}`);
check(
  "卸载时 token 层也被移除",
  springRun.record.overrideTokens.some((entry) => entry.disposed === true),
);

console.log("\n[10] locale 字典覆盖 UI 实际用到的 key");
const localeEntry = springRun.record.locale[0];
check("注册了 locale 命名空间", localeEntry?.namespace === "yexueqing-skin");
check("同时提供 zh 与 en", Boolean(localeEntry?.dicts?.zh) && Boolean(localeEntry?.dicts?.en));

// 从源码里抽出所有 t("...") 的字面量 key，确保字典没有漏项。
const usedKeys = new Set();
for (const match of CLIENT_SOURCE.matchAll(/\bt\(\s*"([^"]+)"/g)) usedKeys.add(match[1]);
// 皮肤文案是拼出来的（t(`skin.${id}.name`)），补上两个变体的实际 key。
for (const id of ["spring", "snow"]) {
  usedKeys.add(`skin.${id}.name`);
  usedKeys.add(`skin.${id}.desc`);
}
console.log(`     UI 用到 ${usedKeys.size} 个 key`);
for (const [language, dict] of Object.entries(localeEntry.dicts)) {
  // 允许插值文案（函数），但必须真的返回字符串。
  const missing = [...usedKeys].filter((key) => {
    const value = dict[key];
    if (typeof value === "string") return false;
    if (typeof value === "function") return typeof value(3) !== "string";
    return true;
  });
  check(`${language} 字典无缺失`, missing.length === 0, missing.join(", "));
}
const zhKeys = Object.keys(localeEntry.dicts.zh).sort();
const enKeys = Object.keys(localeEntry.dicts.en).sort();
check("zh 与 en 的 key 集合一致", JSON.stringify(zhKeys) === JSON.stringify(enKeys));

console.log("\n[11] 持久化状态校验");
const corrupt = applyWith("{ this is not json");
check("损坏的 JSON 回退到默认值而不是抛错", corrupt.record.overrideTokens.length === 1);
const unknownSkin = applyWith(
  JSON.stringify({ enabled: true, skin: "does-not-exist", font: "wenkai", art: "medium" }),
);
check("未知皮肤 id 回退到第一个变体", unknownSkin.record.overrideTokens.length === 1);

console.log("\n[12] 互斥：自动关闭其他皮肤插件（走官方 Remote）");
{
  // 造一个只含"另一个皮肤 + 一个主题 + 我们自己"的插件表。
  const makeRemote = () => {
    const rows = [
      {
        entryId: "include:liang-intensity-skin",
        moduleName: "@leon___/dsh-client-liang-intensity-skin",
        enabled: true,
      },
      {
        entryId: "include:dsh-official-homepage-theme",
        moduleName: "dsh-official-homepage-theme",
        enabled: true,
      },
      {
        entryId: "include:yexueqing-skin",
        moduleName: "dsh-yexueqing-skin",
        enabled: true,
      },
    ];
    const calls = [];
    const manager = {
      async listPlugins() {
        return rows.map((r) => ({ ...r }));
      },
      async setPluginEnabled(entryId, enabled) {
        calls.push([entryId, enabled]);
        const row = rows.find((r) => r.entryId === entryId);
        if (row) row.enabled = enabled;
        return { changed: true, application: "applied" };
      },
    };
    return { rows, calls, remote: { pluginManager: manager } };
  };

  /** apply 并注入一个带 remote 的 ctx，等待互斥的异步部分跑完。 */
  async function applyWithRemote(persisted, remote) {
    const boot = bootBundle({ persisted });
    const require = (name) => {
      if (name === "react") return ReactStub;
      throw new Error(`未预期的 require("${name}")`);
    };
    const plugin = boot.factory(require);
    const { ctx, record } = makeCtx();
    ctx.get = (name) => (name === "remote" ? remote : undefined);
    plugin.apply(ctx);
    // reconcileSkins 是 fire-and-forget 的，让微任务队列跑完。
    await new Promise((resolve) => setTimeout(resolve, 20));
    return { boot, plugin, record, ctx };
  }

  const run = makeRemote();
  await applyWithRemote(null, run.remote);
  check(
    "另一个皮肤被自动关闭",
    run.calls.some(([id, on]) => id === "include:liang-intensity-skin" && on === false),
    JSON.stringify(run.calls),
  );
  check(
    "主题类插件不被误关（只匹配 skin，不匹配 theme）",
    !run.calls.some(([id]) => id === "include:dsh-official-homepage-theme"),
    JSON.stringify(run.calls),
  );
  check(
    "绝不关闭自己",
    !run.calls.some(([id]) => id === "include:yexueqing-skin"),
    JSON.stringify(run.calls),
  );
  check(
    "被关闭的行记进状态以便恢复",
    run.rows.find((r) => r.entryId === "include:liang-intensity-skin").enabled === false,
  );

  // 关闭独占开关 → 把我们关掉的恢复回去
  const restore = makeRemote();
  await applyWithRemote(
    JSON.stringify({
      enabled: true,
      skin: "spring",
      font: "wenkai",
      art: "medium",
      exclusive: false,
      disabledRows: ["include:liang-intensity-skin"],
    }),
    restore.remote,
  );
  check(
    "关闭独占开关时恢复之前被关掉的皮肤",
    restore.calls.some(([id, on]) => id === "include:liang-intensity-skin" && on === true),
    JSON.stringify(restore.calls),
  );

  // 关闭总开关 → 同样恢复
  const offRestore = makeRemote();
  await applyWithRemote(
    JSON.stringify({
      enabled: false,
      skin: "spring",
      font: "wenkai",
      art: "medium",
      disabledRows: ["include:liang-intensity-skin"],
    }),
    offRestore.remote,
  );
  check(
    "关闭总开关时恢复之前被关掉的皮肤",
    offRestore.calls.some(([id, on]) => id === "include:liang-intensity-skin" && on === true),
    JSON.stringify(offRestore.calls),
  );

  // 没有 remote 的部署不能抛错
  const noRemote = await applyWithRemote(null, undefined);
  check("没有 remote 命名空间时静默跳过且不抛错", noRemote.record.overrideTokens.length === 1);
}

console.log(failures === 0 ? "\n全部通过" : `\n${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
