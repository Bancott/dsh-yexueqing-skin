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
  if (persisted !== null) storage.set("dsh-yexueqing-skin.state", persisted);

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
  "--dsw-alias-label-secondary",
  "--dsw-alias-state-error-primary",
  "--dsw-alias-state-idle-primary",
  "--dsw-alias-state-success-primary",
  "--dsw-alias-state-warn-primary",
  "--dsw-specific-sidebar-fill",
];

console.log("\n[1] bundle 形态");
const boot = bootBundle();
check("以包名注册 factory", boot.definition?.id === PACKAGE_NAME, `id=${boot.definition?.id}`);
check("factory 是函数", typeof boot.factory === "function");
check("执行 bundle 不产生 <style>（无模块副作用）", boot.document.styles.length === 0);
check("执行 bundle 不写 localStorage", boot.storage.size === 0);

console.log("\n[2] 插件导出形式");
const springRun = applyWith(null);
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
check(
  "注册了 shell.overlay（装饰层，在所有列之上）",
  springRun.record.injects.includes("shell.overlay"),
);
check("三个 slot 各注册一个条目", springRun.record.register.length === 3,
  `得到 ${springRun.record.register.length}`);
const decor = springRun.record.register.find((r) => r.options.name === "shell.overlay");
check("装饰层 id 正确", decor?.options.id === "yexueqing-decor");
check(
  "装饰层 order 为负（排在对话框等浮层之下）",
  typeof decor?.options.order === "number" && decor.options.order < 0,
  `order=${decor?.options.order}`,
);
check("装饰层是 React 组件", typeof decor?.Component === "function");
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
const snowRun = applyWith(JSON.stringify({ enabled: true, skin: "snow", font: "wenkai", art: true, motif: true }));
const snowLayer = snowRun.record.overrideTokens[0];
check("雪霁变体的 bg-base 与春庭不同",
  snowLayer.tokens["--dsw-alias-bg-base"].light !== springLayer.tokens["--dsw-alias-bg-base"].light,
  `${snowLayer.tokens["--dsw-alias-bg-base"].light} vs ${springLayer.tokens["--dsw-alias-bg-base"].light}`);
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

console.log("\n[6] 字体开关");
check(
  "wenkai 时下发 --dsw-font-family",
  typeof springLayer.tokens["--dsw-font-family"]?.light === "string" &&
    springLayer.tokens["--dsw-font-family"].light.includes("LXGW WenKai GB"),
);
const systemFontRun = applyWith(
  JSON.stringify({ enabled: true, skin: "spring", font: "system", art: true, motif: true }),
);
check(
  "system 时**不下发** --dsw-font-family（回到 base.css 原生字体栈）",
  systemFontRun.record.overrideTokens[0].tokens["--dsw-font-family"] === undefined,
);

console.log("\n[7] 立绘开关与画布安全");
check(
  "art 开启时 bg-base 仍是 6 位 hex（不透明，防止画布透白）",
  /^#[0-9a-f]{6}$/i.test(springLayer.tokens["--dsw-alias-bg-base"].light),
  springLayer.tokens["--dsw-alias-bg-base"].light,
);
check(
  "art 开启时抬升表面转成 rgba",
  springLayer.tokens["--dsw-alias-bg-layer-1"].light.startsWith("rgba("),
  springLayer.tokens["--dsw-alias-bg-layer-1"].light,
);
check(
  "art 开启时下发立绘 URL",
  String(springLayer.tokens["--yxq-art-image"].light).includes("skin-spring.jpg"),
);
check(
  "medium 档下发两层不透明度",
  springLayer.tokens["--yxq-art-wash-opacity"].light === "0.12" &&
    springLayer.tokens["--yxq-art-band-opacity"].light === "0.50",
  `${springLayer.tokens["--yxq-art-wash-opacity"].light} / ${springLayer.tokens["--yxq-art-band-opacity"].light}`,
);

const noArtRun = applyWith(
  JSON.stringify({ enabled: true, skin: "spring", font: "wenkai", art: "off", motif: false }),
);
check(
  "art 关闭（字符串 \"off\"）时立绘 token 为 none",
  noArtRun.record.overrideTokens[0].tokens["--yxq-art-image"].light === "none",
  noArtRun.record.overrideTokens[0].tokens["--yxq-art-image"].light,
);
check(
  "art 关闭时不透明度为 0",
  noArtRun.record.overrideTokens[0].tokens["--yxq-art-band-opacity"].light === "0",
);
check(
  "art 关闭时表面保持不透明 hex（回归防线：\"off\" 是字符串，别被当成真值）",
  /^#[0-9a-f]{6}$/i.test(noArtRun.record.overrideTokens[0].tokens["--dsw-alias-bg-layer-1"].light),
  noArtRun.record.overrideTokens[0].tokens["--dsw-alias-bg-layer-1"].light,
);

const strongRun = applyWith(
  JSON.stringify({ enabled: true, skin: "snow", font: "wenkai", art: "strong" }),
);
check(
  "strong 档比 medium 更明显",
  Number(strongRun.record.overrideTokens[0].tokens["--yxq-art-band-opacity"].light) >
    Number(springLayer.tokens["--yxq-art-band-opacity"].light),
);
const legacyArtRun = applyWith(
  JSON.stringify({ enabled: true, skin: "spring", font: "wenkai", art: true }),
);
check(
  "旧版 boolean art:true 平滑迁移到 medium",
  legacyArtRun.record.overrideTokens[0].tokens["--yxq-art-band-opacity"].light === "0.50",
);

console.log("\n[8] 关闭开关时零注册");
const offRun = applyWith(
  JSON.stringify({ enabled: false, skin: "spring", font: "wenkai", art: true, motif: true }),
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

console.log("\n[9b] 装饰层：四边带 + 薄纱，且不再有云纹贴图");
const decorStyles = springRun.boot.document.styles
  .map((s) => s.textContent)
  .filter((css) => css.includes(".yxq-decor"))
  .join("\n");
check("存在 .yxq-decor 根层", decorStyles.includes(".yxq-decor{"));
check("存在整屏薄纱 .yxq-decor__wash", decorStyles.includes(".yxq-decor__wash"));
check("存在四边带 .yxq-decor__band", decorStyles.includes(".yxq-decor__band"));
check(
  "薄纱用 wash 不透明度 token",
  decorStyles.includes("opacity:var(--yxq-art-wash-opacity)"),
);
check(
  "四边带用 band 不透明度 token",
  decorStyles.includes("opacity:var(--yxq-art-band-opacity)"),
);
check("装饰层不拦截交互", decorStyles.includes("pointer-events:none"));
// 回归防线：第一版的云纹贴图在界面上看起来像一片时钟，用户明确不要。
check(
  "不再有铺满整帧的重复云纹贴图",
  !allStyles.includes("yxq-motif") && !allStyles.includes("background-repeat:repeat;"),
  "发现重复贴图动机",
);
// 回归防线：装饰绝不能回到 body 背景上 —— 应用根容器会整片盖住它。
check(
  "没有把立绘挂回 body 背景（会被应用根容器盖住）",
  !allStyles.includes("background-attachment"),
  "发现 background-attachment，说明旧实现又回来了",
);
// 回归防线：第一版的径向遮罩半径超过视口，把立绘整片遮掉了。
check(
  "四边带遮罩是矩形带，不是会遮满全屏的径向渐变",
  decorStyles.includes("linear-gradient(to left") &&
    decorStyles.includes("linear-gradient(to bottom") &&
    !/mask-image:radial-gradient/.test(decorStyles),
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
